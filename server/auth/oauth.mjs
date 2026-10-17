// Durable OAuth 2.1 state for the self-hosted MCP resource (schema v5 tables in db.mjs).
//
// Scope of what OAuth can grant: exactly the existing content-manager permissions (the six MCP
// content tools on accessible member trips) for one explicitly configured account
// (SHARED_TRIP_OAUTH_USERNAME). OAuth never grants owner, account, invitation, credential, audit,
// media or other administration, and OAuth access tokens are honoured only at /mcp.
//
// - Registered clients (RFC 7591, public, token_endpoint_auth_method "none") persist. Only clients
//   that never completed a consent may be evicted, and only when the registration table is full.
// - Authorization codes, access tokens and refresh tokens are 256-bit random values with a
//   recognizable prefix. Only their SHA-256 digests are stored; they are never listed or audited.
// - A code is single use, valid for CODE_TTL_MS, and bound to client, redirect URI, resource,
//   scope, S256 challenge, account and the account's session epoch. Exchange is atomic: the code is
//   burned before any binding is checked, so a failed attempt cannot be retried, and replaying a
//   code that already produced a grant ends that grant.
// - A grant is the refresh-token family. Its lifetime is absolute (GRANT_LIFETIME_MS from consent);
//   rotation never extends it. Each refresh rotates atomically; presenting an already rotated refresh
//   token ends the whole grant, including every access token.
// - Access tokens live ACCESS_TTL_MS (never beyond the grant) and are checked on every request
//   against token, grant, resource, scope and the account's current status, role, epoch and the
//   configured username, so revocation and role changes apply immediately.
import crypto from "node:crypto";
import { notFound } from "../domain/errors.mjs";
import { ACCOUNT_ID_PATTERN } from "./accounts.mjs";

export const OAUTH_SCOPE = "trips:manage";
export const OAUTH_CLIENT_ID_PATTERN = /^ocl_[A-Za-z0-9_-]{22}$/;
export const OAUTH_GRANT_ID_PATTERN = /^oag_[A-Za-z0-9_-]{16}$/;
export const OAUTH_ACCESS_PATTERN = /^sta_[A-Za-z0-9_-]{43}$/;
export const OAUTH_REFRESH_PATTERN = /^str_[A-Za-z0-9_-]{43}$/;
export const OAUTH_CODE_PATTERN = /^stc_[A-Za-z0-9_-]{43}$/;
export const OAUTH_REVOKE_REASONS = Object.freeze(["owner", "client", "refresh_reuse", "code_replay", "account_changed", "grant_limit"]);
export const OAUTH_TOKEN_KINDS = Object.freeze(["access", "refresh"]);
export const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
export const ACCESS_TTL_MS = 15 * MINUTE;
export const CODE_TTL_MS = 3 * MINUTE;
export const GRANT_LIFETIME_MS = 90 * DAY;
export const MAX_OAUTH_CLIENTS = 1000;
export const MAX_ACTIVE_GRANTS_PER_ACCOUNT = 20;
const UNUSED_CLIENT_EVICTION_MS = DAY;
const ENDED_GRANT_RETENTION_MS = 30 * DAY;
const USED_CODE_RETENTION_MS = DAY;
const LAST_USED_RESOLUTION_MS = MINUTE;
const MAX_LISTED_GRANTS = 100;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const random = (bytes) => crypto.randomBytes(bytes).toString("base64url");
const iso = (ms) => new Date(ms).toISOString();
const failure = (error, reason) => ({ ok: false, error, reason });

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(code_verifier))) compared in constant time. */
export function pkceMatches(verifier, challenge) {
  if (typeof verifier !== "string" || !PKCE_VERIFIER_PATTERN.test(verifier) || typeof challenge !== "string" || !PKCE_CHALLENGE_PATTERN.test(challenge)) return false;
  const actual = Buffer.from(crypto.createHash("sha256").update(verifier, "ascii").digest("base64url"));
  const expected = Buffer.from(challenge);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function grantMetadata(row, now) {
  return {
    id: row.id, clientId: row.client_id, clientName: row.client_name ?? null, redirectUri: row.redirect_uri, scope: row.scope, resource: row.resource,
    createdAt: row.created_at, expiresAt: iso(row.expires_at), revokedAt: row.revoked_at ?? null, revokedReason: row.revoked_reason ?? null,
    lastUsedAt: row.last_used_at ?? null, active: !row.revoked_at && row.expires_at > now
  };
}

export class OAuthStore {
  /**
   * audit: AuditLog (accepted events are recorded inside the same transaction).
   * username: the normalized configured OAuth username, or "" when no account is eligible.
   */
  constructor(db, { audit, username = "" } = {}) { this.db = db; this.audit = audit; this.username = username; }

  atomically(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** The single eligibility rule for consent, exchange, refresh and every /mcp request. */
  eligible(account, epoch) {
    return Boolean(this.username) && Boolean(account) && account.username === this.username && account.status === "approved" &&
      account.role === "content-manager" && (epoch === undefined || account.session_epoch === epoch);
  }

  // ----------------------------------------------------------------------------------------------
  // Clients

  /** input: { clientName, redirectUris } already validated by the HTTP layer. Returns the stored client. */
  registerClient({ clientName, redirectUris }, now) {
    return this.atomically(() => {
      let count = this.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get().n;
      if (count >= MAX_OAUTH_CLIENTS) {
        // Only registrations that never reached a consent are evictable; used registrations persist.
        const stale = this.db.prepare("SELECT id FROM oauth_clients WHERE authorized_at IS NULL AND created_at < ? ORDER BY created_at, id LIMIT 1").get(iso(now - UNUSED_CLIENT_EVICTION_MS));
        if (stale) { this.db.prepare("DELETE FROM oauth_clients WHERE id=? AND authorized_at IS NULL").run(stale.id); count--; }
      }
      if (count >= MAX_OAUTH_CLIENTS) return null;
      const id = "ocl_" + random(16);
      const createdAt = iso(now);
      this.db.prepare("INSERT INTO oauth_clients (id,client_name,redirect_uris,created_at,authorized_at) VALUES (?,?,?,?,NULL)").run(id, clientName, JSON.stringify(redirectUris), createdAt);
      this.audit?.record({ actor: "anonymous", channel: "http", action: "oauth.register", outcome: "accepted", target: id });
      return { id, clientName, redirectUris: [...redirectUris], createdAt };
    });
  }

  getClient(id) {
    if (typeof id !== "string" || !OAUTH_CLIENT_ID_PATTERN.test(id)) return null;
    const row = this.db.prepare("SELECT id,client_name,redirect_uris,created_at FROM oauth_clients WHERE id=?").get(id);
    if (!row) return null;
    let redirectUris = [];
    try { redirectUris = JSON.parse(row.redirect_uris); } catch { return null; }
    if (!Array.isArray(redirectUris) || !redirectUris.every((value) => typeof value === "string")) return null;
    return { id: row.id, clientName: row.client_name, redirectUris, createdAt: row.created_at };
  }

  // ----------------------------------------------------------------------------------------------
  // Authorization codes

  /** Called only after explicit sign-in and an explicit "allow". Returns the one-time code, or null if the account is no longer eligible. */
  issueCode({ clientId, userId, epoch, redirectUri, resource, scope, codeChallenge }, now) {
    return this.atomically(() => {
      const account = this.db.prepare("SELECT id,username,status,role,session_epoch FROM users WHERE id=?").get(userId);
      if (!this.eligible(account, epoch) || !this.getClient(clientId)) return null;
      const code = "stc_" + random(32);
      this.db.prepare("INSERT INTO oauth_codes (code_hash,client_id,user_id,account_epoch,redirect_uri,resource,scope,code_challenge,created_at,expires_at,grant_expires_at,used_at,grant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)")
        .run(digest(code), clientId, userId, epoch, redirectUri, resource, scope, codeChallenge, iso(now), now + CODE_TTL_MS, now + GRANT_LIFETIME_MS);
      this.db.prepare("UPDATE oauth_clients SET authorized_at=? WHERE id=? AND authorized_at IS NULL").run(iso(now), clientId);
      this.audit?.record({ actor: userId, channel: "http", action: "oauth.consent", outcome: "accepted", target: clientId });
      return code;
    });
  }

  endGrant(grantId, reason, now) {
    const at = iso(now);
    const changed = this.db.prepare("UPDATE oauth_grants SET revoked_at=?, revoked_reason=? WHERE id=? AND revoked_at IS NULL").run(at, reason, grantId).changes;
    this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE grant_id=? AND revoked_at IS NULL").run(at, grantId);
    return changed > 0;
  }

  mint(grant, now) {
    const access = "sta_" + random(32);
    const refresh = "str_" + random(32);
    const accessExpires = Math.min(now + ACCESS_TTL_MS, grant.expires_at);
    const insert = this.db.prepare("INSERT INTO oauth_tokens (token_hash,kind,grant_id,created_at,expires_at,used_at,revoked_at) VALUES (?,?,?,?,?,NULL,NULL)");
    insert.run(digest(access), "access", grant.id, iso(now), accessExpires);
    insert.run(digest(refresh), "refresh", grant.id, iso(now), grant.expires_at);
    return { access, refresh, expiresIn: Math.max(1, Math.floor((accessExpires - now) / 1000)), scope: grant.scope, grantId: grant.id, userId: grant.user_id };
  }

  /**
   * Atomic authorization_code exchange. Returns { ok: true, access, refresh, expiresIn, scope,
   * grantId, userId } or { ok: false, error, reason } where error is an OAuth error code.
   */
  exchangeCode({ code, clientId, redirectUri, resource, codeVerifier }, now) {
    if (typeof code !== "string" || !OAUTH_CODE_PATTERN.test(code)) return failure("invalid_grant", "code_unknown");
    return this.atomically(() => {
      const row = this.db.prepare("SELECT * FROM oauth_codes WHERE code_hash=?").get(digest(code));
      if (!row) return failure("invalid_grant", "code_unknown");
      if (row.used_at) {
        if (row.grant_id && this.endGrant(row.grant_id, "code_replay", now)) {
          this.audit?.record({ actor: row.user_id, channel: "http", action: "oauth.grant.revoke", outcome: "accepted", reason: "code_replay", target: row.grant_id });
        }
        return { ...failure("invalid_grant", "code_replay"), grantId: row.grant_id ?? null };
      }
      // Burn first: any binding failure below leaves the code unusable.
      this.db.prepare("UPDATE oauth_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL").run(iso(now), row.code_hash);
      if (!(row.expires_at > now)) return failure("invalid_grant", "code_expired");
      if (row.client_id !== clientId) return failure("invalid_grant", "client_mismatch");
      if (row.redirect_uri !== redirectUri) return failure("invalid_grant", "redirect_mismatch");
      if (row.resource !== resource) return failure("invalid_target", "resource_mismatch");
      if (!pkceMatches(codeVerifier, row.code_challenge)) return failure("invalid_grant", "pkce_failed");
      const account = this.db.prepare("SELECT id,username,status,role,session_epoch FROM users WHERE id=?").get(row.user_id);
      if (!this.eligible(account, row.account_epoch)) return failure("invalid_grant", "account_inactive");
      // Bounded number of concurrently active grants per account: the oldest one is ended.
      const active = this.db.prepare("SELECT id FROM oauth_grants WHERE user_id=? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at, id").all(row.user_id, now);
      for (const old of active.slice(0, Math.max(0, active.length - MAX_ACTIVE_GRANTS_PER_ACCOUNT + 1))) {
        this.endGrant(old.id, "grant_limit", now);
        this.audit?.record({ actor: row.user_id, channel: "http", action: "oauth.grant.revoke", outcome: "accepted", reason: "grant_limit", target: old.id });
      }
      const grant = { id: "oag_" + random(12), client_id: row.client_id, user_id: row.user_id, scope: row.scope, expires_at: row.grant_expires_at };
      this.db.prepare("INSERT INTO oauth_grants (id,client_id,user_id,account_epoch,scope,resource,redirect_uri,created_at,expires_at,revoked_at,revoked_reason,last_used_at) VALUES (?,?,?,?,?,?,?,?,?,NULL,NULL,NULL)")
        .run(grant.id, row.client_id, row.user_id, row.account_epoch, row.scope, row.resource, row.redirect_uri, iso(now), row.grant_expires_at);
      this.db.prepare("UPDATE oauth_codes SET grant_id=? WHERE code_hash=?").run(grant.id, row.code_hash);
      const minted = this.mint(grant, now);
      this.audit?.record({ actor: row.user_id, channel: "http", action: "oauth.token", outcome: "accepted", target: grant.id });
      return { ok: true, ...minted };
    });
  }

  /** Atomic refresh-token rotation. scope/resource are optional but must match when supplied. */
  refresh({ token, clientId, resource, scope }, now) {
    if (typeof token !== "string" || !OAUTH_REFRESH_PATTERN.test(token)) return failure("invalid_grant", "refresh_unknown");
    return this.atomically(() => {
      const row = this.db.prepare("SELECT t.token_hash,t.expires_at,t.used_at,t.revoked_at,g.id AS grant_id,g.client_id,g.user_id,g.account_epoch,g.scope,g.resource,g.expires_at AS grant_expires_at,g.revoked_at AS grant_revoked_at " +
        "FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id WHERE t.token_hash=? AND t.kind='refresh'").get(digest(token));
      if (!row) return failure("invalid_grant", "refresh_unknown");
      const base = { grantId: row.grant_id, userId: row.user_id };
      if (row.client_id !== clientId) return { ...failure("invalid_grant", "client_mismatch"), ...base };
      if (resource !== undefined && resource !== row.resource) return { ...failure("invalid_target", "resource_mismatch"), ...base };
      if (scope !== undefined && scope !== row.scope) return { ...failure("invalid_scope", "scope_mismatch"), ...base };
      if (row.used_at !== null) {
        const ended = this.endGrant(row.grant_id, "refresh_reuse", now);
        if (ended) this.audit?.record({ actor: row.user_id, channel: "http", action: "oauth.grant.revoke", outcome: "accepted", reason: "refresh_reuse", target: row.grant_id });
        return { ...failure("invalid_grant", "refresh_reuse"), ...base };
      }
      if (row.revoked_at || row.grant_revoked_at) return { ...failure("invalid_grant", "grant_revoked"), ...base };
      if (!(row.grant_expires_at > now) || !(row.expires_at > now)) return { ...failure("invalid_grant", "grant_expired"), ...base };
      const account = this.db.prepare("SELECT id,username,status,role,session_epoch FROM users WHERE id=?").get(row.user_id);
      if (!this.eligible(account, row.account_epoch)) return { ...failure("invalid_grant", "account_inactive"), ...base };
      if (this.db.prepare("UPDATE oauth_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL").run(now, row.token_hash).changes !== 1) return { ...failure("invalid_grant", "refresh_reuse"), ...base };
      const minted = this.mint({ id: row.grant_id, user_id: row.user_id, scope: row.scope, expires_at: row.grant_expires_at }, now);
      this.db.prepare("UPDATE oauth_grants SET last_used_at=? WHERE id=?").run(iso(now), row.grant_id);
      this.audit?.record({ actor: row.user_id, channel: "http", action: "oauth.refresh", outcome: "accepted", target: row.grant_id });
      return { ok: true, ...minted };
    });
  }

  /**
   * RFC 7009 revocation by the client the token was issued to. A refresh token ends its grant; an
   * access token is revoked alone. Unknown tokens and tokens of other clients are a silent no-op.
   */
  revokeToken({ token, clientId }, now) {
    if (typeof token !== "string" || !(OAUTH_ACCESS_PATTERN.test(token) || OAUTH_REFRESH_PATTERN.test(token))) return false;
    return this.atomically(() => {
      const row = this.db.prepare("SELECT t.token_hash,t.kind,t.revoked_at,g.id AS grant_id,g.client_id,g.user_id FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id WHERE t.token_hash=?").get(digest(token));
      if (!row || row.client_id !== clientId) return false;
      if (row.kind === "refresh") this.endGrant(row.grant_id, "client", now);
      else this.db.prepare("UPDATE oauth_tokens SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL").run(iso(now), row.token_hash);
      this.audit?.record({ actor: row.user_id, channel: "http", action: "oauth.revoke", outcome: "accepted", target: row.grant_id });
      return true;
    });
  }

  /**
   * Validates an access token for one request. Returns null for anything that is not a known access
   * token, otherwise { ok, reason, userId, username, grantId }.
   */
  authenticateAccess(token, now, { resource, touch = true } = {}) {
    if (typeof token !== "string" || !OAUTH_ACCESS_PATTERN.test(token)) return null;
    const row = this.db.prepare("SELECT t.expires_at,t.revoked_at,g.id AS grant_id,g.user_id,g.account_epoch,g.scope,g.resource,g.expires_at AS grant_expires_at,g.revoked_at AS grant_revoked_at,g.last_used_at," +
      "u.username,u.status,u.role,u.session_epoch FROM oauth_tokens t JOIN oauth_grants g ON g.id=t.grant_id JOIN users u ON u.id=g.user_id WHERE t.token_hash=? AND t.kind='access'").get(digest(token));
    if (!row) return null;
    const base = { userId: row.user_id, username: row.username, grantId: row.grant_id };
    let reason = "";
    if (row.revoked_at || row.grant_revoked_at) reason = "oauth_token_revoked";
    else if (!(row.expires_at > now) || !(row.grant_expires_at > now)) reason = "oauth_token_expired";
    else if (row.resource !== resource || row.scope !== OAUTH_SCOPE) reason = "oauth_audience_mismatch";
    else if (!this.eligible(row, row.account_epoch)) reason = "account_inactive";
    if (reason) return { ok: false, reason, ...base };
    if (touch && (!row.last_used_at || !(Date.parse(row.last_used_at) > now - LAST_USED_RESOLUTION_MS))) {
      try { this.db.prepare("UPDATE oauth_grants SET last_used_at=? WHERE id=?").run(iso(now), row.grant_id); }
      catch { /* usage metadata is advisory */ }
    }
    return { ok: true, reason: "", ...base };
  }

  // ----------------------------------------------------------------------------------------------
  // Owner administration (metadata only)

  requireAccount(userId) {
    if (typeof userId !== "string" || !ACCOUNT_ID_PATTERN.test(userId) || !this.db.prepare("SELECT id FROM users WHERE id=?").get(userId)) throw notFound("account_not_found", "Account not found.");
  }

  grantRow(grantId) {
    return this.db.prepare("SELECT g.*,c.client_name FROM oauth_grants g LEFT JOIN oauth_clients c ON c.id=g.client_id WHERE g.id=?").get(grantId);
  }

  listGrants(userId, now) {
    this.requireAccount(userId);
    const rows = this.db.prepare("SELECT g.*,c.client_name FROM oauth_grants g LEFT JOIN oauth_clients c ON c.id=g.client_id WHERE g.user_id=? ORDER BY g.created_at DESC, g.id LIMIT ?").all(userId, MAX_LISTED_GRANTS);
    return { grants: rows.map((row) => grantMetadata(row, now)) };
  }

  /** Idempotent owner revocation of one grant and all of its tokens. */
  revokeGrant(userId, grantId, now) {
    return this.atomically(() => {
      this.requireAccount(userId);
      const row = typeof grantId === "string" && OAUTH_GRANT_ID_PATTERN.test(grantId) ? this.grantRow(grantId) : undefined;
      if (!row || row.user_id !== userId) throw notFound("grant_not_found", "Grant not found.");
      const changed = this.endGrant(grantId, "owner", now);
      this.audit?.record({ actor: "owner", channel: "http", action: "oauth.grant.revoke", outcome: changed ? "accepted" : "unchanged", target: grantId });
      return { grant: grantMetadata(this.grantRow(grantId), now) };
    });
  }

  // ----------------------------------------------------------------------------------------------
  // Bounded storage

  //
  // Replay detection must outlive cleanup for as long as the grant it protects can be used:
  // - Used (rotated) refresh-token digests are kept until their own expires_at, which is the grant's
  //   absolute 90-day horizon, so a rotated token replayed at any point while the grant is live is
  //   still recognized and ends the family. Expired access tokens go as soon as they expire.
  // - Used code digests keep their code -> grant link while that grant is live (not revoked, not
  //   expired), so a replayed code still ends the grant it produced. Codes without a live grant are
  //   removed USED_CODE_RETENTION_MS after expiry.
  // Storage stays bounded by the grant horizon, MAX_ACTIVE_GRANTS_PER_ACCOUNT and the removal of
  // ended grants (and everything they own) ENDED_GRANT_RETENTION_MS after they end.
  sweep(now) {
    try {
      this.atomically(() => {
        this.db.prepare("DELETE FROM oauth_tokens WHERE expires_at <= ?").run(now);
        this.db.prepare("DELETE FROM oauth_codes WHERE expires_at < ? AND (grant_id IS NULL OR grant_id NOT IN (SELECT id FROM oauth_grants WHERE revoked_at IS NULL AND expires_at > ?))").run(now - USED_CODE_RETENTION_MS, now);
        const ended = "(expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?))";
        this.db.prepare("DELETE FROM oauth_tokens WHERE grant_id IN (SELECT id FROM oauth_grants WHERE " + ended + ")").run(now - ENDED_GRANT_RETENTION_MS, iso(now - ENDED_GRANT_RETENTION_MS));
        this.db.prepare("UPDATE oauth_codes SET grant_id=NULL WHERE grant_id IN (SELECT id FROM oauth_grants WHERE " + ended + ")").run(now - ENDED_GRANT_RETENTION_MS, iso(now - ENDED_GRANT_RETENTION_MS));
        this.db.prepare("DELETE FROM oauth_grants WHERE " + ended).run(now - ENDED_GRANT_RETENTION_MS, iso(now - ENDED_GRANT_RETENTION_MS));
      });
    } catch { /* cleanup is best effort; a busy database must not fail a request */ }
  }
}
