// Per-account MCP bearer credentials for content-manager accounts (schema v4 table mcp_tokens).
//
// - Only the owner issues them, only for an approved content-manager account, with a fixed 90-day
//   lifetime. The request chooses nothing but a label: never role, expiry, user or scope.
// - The secret ("stm_" + 256 random bits, base64url) is returned once at issuance. Only its SHA-256
//   digest is stored; it is never listed, logged or audited.
// - A credential is honoured only at /mcp (enforced by app.mjs) and only while: not revoked, not
//   expired, account approved, account role content-manager, and the account's session_epoch equals
//   the epoch recorded at issuance. Role change and revocation bump the epoch and also mark every
//   credential revoked, so re-approval or a role change back cannot revive an older credential.
// - Usage tracking is limited to a coarse lastUsedAt timestamp.
import crypto from "node:crypto";
import { conflict, notFound, validationError } from "../domain/errors.mjs";
import { ACCOUNT_ID_PATTERN } from "./accounts.mjs";

export const MCP_TOKEN_PREFIX = "stm_";
export const MCP_TOKEN_PATTERN = /^stm_[A-Za-z0-9_-]{43}$/;
export const MCP_TOKEN_ID_PATTERN = /^mct_[A-Za-z0-9_-]{16}$/;
export const MCP_TOKEN_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_ACTIVE_MCP_TOKENS = 10;
const MAX_LABEL = 64;
const LAST_USED_RESOLUTION_MS = 60_000;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const iso = (ms) => new Date(ms).toISOString();
const metadata = (row) => ({ id: row.id, label: row.label, createdAt: row.created_at, expiresAt: iso(row.expires_at), revokedAt: row.revoked_at ?? null, lastUsedAt: row.last_used_at ?? null });
const accountNotFound = () => notFound("account_not_found", "Account not found.");
const tokenNotFound = () => notFound("token_not_found", "Credential not found.");

export class McpTokenStore {
  constructor(db, { audit } = {}) { this.db = db; this.audit = audit; }

  atomically(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  requireAccount(userId) {
    if (typeof userId !== "string" || !ACCOUNT_ID_PATTERN.test(userId)) throw accountNotFound();
    const row = this.db.prepare("SELECT id,status,role,session_epoch FROM users WHERE id=?").get(userId);
    if (!row) throw accountNotFound();
    return row;
  }

  list(userId) {
    this.requireAccount(userId);
    return { tokens: this.db.prepare("SELECT id,label,created_at,expires_at,revoked_at,last_used_at FROM mcp_tokens WHERE user_id=? ORDER BY created_at DESC, id").all(userId).map(metadata) };
  }

  /** input: exactly { label }. Returns { token, secret }; the secret is never retrievable again. */
  issue(userId, input, now = Date.now()) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => key !== "label") || typeof input.label !== "string") {
      throw validationError("Send exactly { label } with a short descriptive label.");
    }
    const label = input.label.trim();
    if (!label || label.length > MAX_LABEL || /[\u0000-\u001f\u007f]/.test(label)) throw validationError("Labels contain 1 to " + MAX_LABEL + " visible characters.");
    return this.atomically(() => {
      const account = this.requireAccount(userId);
      if (account.status !== "approved" || account.role !== "content-manager") throw conflict("token_not_allowed", "Credentials can only be issued to approved content-manager accounts.");
      const active = this.db.prepare("SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id=? AND revoked_at IS NULL AND expires_at > ?").get(userId, now).n;
      if (active >= MAX_ACTIVE_MCP_TOKENS) throw conflict("too_many_tokens", "Revoke an existing credential before issuing another.");
      const secret = MCP_TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
      const id = "mct_" + crypto.randomBytes(12).toString("base64url");
      const createdAt = iso(now);
      const expiresAt = now + MCP_TOKEN_LIFETIME_MS;
      this.db.prepare("INSERT INTO mcp_tokens (id,user_id,label,token_hash,account_epoch,created_at,expires_at,revoked_at,last_used_at) VALUES (?,?,?,?,?,?,?,NULL,NULL)")
        .run(id, userId, label, digest(secret), account.session_epoch, createdAt, expiresAt);
      this.audit?.record({ actor: "owner", channel: "http", action: "token.issue", outcome: "accepted", target: id });
      return { token: { id, label, createdAt, expiresAt: iso(expiresAt) }, secret };
    });
  }

  /** Idempotent: revoking an already revoked credential returns its unchanged metadata. */
  revoke(userId, tokenId, now = Date.now()) {
    return this.atomically(() => {
      this.requireAccount(userId);
      if (typeof tokenId !== "string" || !MCP_TOKEN_ID_PATTERN.test(tokenId)) throw tokenNotFound();
      const row = this.db.prepare("SELECT id,revoked_at FROM mcp_tokens WHERE id=? AND user_id=?").get(tokenId, userId);
      if (!row) throw tokenNotFound();
      const changed = !row.revoked_at;
      if (changed) this.db.prepare("UPDATE mcp_tokens SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(iso(now), tokenId);
      this.audit?.record({ actor: "owner", channel: "http", action: "token.revoke", outcome: changed ? "accepted" : "unchanged", target: tokenId });
      return { token: metadata(this.db.prepare("SELECT id,label,created_at,expires_at,revoked_at,last_used_at FROM mcp_tokens WHERE id=?").get(tokenId)) };
    });
  }

  /**
   * Returns null for anything that is not a known credential; otherwise { ok, reason, userId,
   * username, tokenId }. Only a valid credential updates lastUsedAt.
   */
  authenticate(secret, now = Date.now(), { touch = true } = {}) {
    if (typeof secret !== "string" || !MCP_TOKEN_PATTERN.test(secret)) return null;
    const row = this.db.prepare("SELECT t.id,t.user_id,t.account_epoch,t.expires_at,t.revoked_at,t.last_used_at,u.username,u.status,u.role,u.session_epoch FROM mcp_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=?").get(digest(secret));
    if (!row) return null;
    const base = { userId: row.user_id, username: row.username, tokenId: row.id };
    let reason = "";
    if (row.revoked_at) reason = "token_revoked";
    else if (!(row.expires_at > now)) reason = "token_expired";
    else if (row.status !== "approved" || row.role !== "content-manager" || row.session_epoch !== row.account_epoch) reason = "account_inactive";
    if (reason) return { ok: false, reason, ...base };
    if (touch && (!row.last_used_at || !(Date.parse(row.last_used_at) > now - LAST_USED_RESOLUTION_MS))) {
      try { this.db.prepare("UPDATE mcp_tokens SET last_used_at=? WHERE id=?").run(iso(now), row.id); }
      catch { /* usage metadata is advisory; a busy database must not deny a valid credential */ }
    }
    return { ok: true, reason: "", ...base };
  }
}
