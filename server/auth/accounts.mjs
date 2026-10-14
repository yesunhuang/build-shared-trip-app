// Durable owner-managed viewer accounts and single-use invitations (schema v3 tables in db.mjs).
//
// - Invitations store only a SHA-256 digest of a random 256-bit token. The token is returned once,
//   at creation; it is unrelated to the owner bearer token and cannot be listed again.
// - Redeeming an invitation creates a *pending* account. Only an explicit owner approval makes it
//   usable; there is no self-registration and no automatic approval.
// - Revocation bumps session_epoch so every session issued earlier stays invalid even if the owner
//   later approves the account again.
// Account rows returned from public methods never include password hashes or invitation digests.
import crypto from "node:crypto";
import { DomainError, conflict, notFound, validationError } from "../domain/errors.mjs";

export const ACCOUNT_STATUSES = Object.freeze(["pending", "approved", "revoked"]);
export const ACCOUNT_ID_PATTERN = /^usr_[A-Za-z0-9_-]{8,40}$/;
export const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
export const DEFAULT_INVITATION_HOURS = 72;
export const MAX_INVITATION_HOURS = 168;
const MAX_OPEN_INVITATIONS = 50;
const MAX_ACCOUNTS = 500;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const randomId = (prefix) => prefix + crypto.randomBytes(12).toString("base64url");
const publicAccount = (row) => ({ id: row.id, username: row.username, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at });

export function invitationInvalid() {
  return new DomainError("invitation_invalid", 403, "This invitation is invalid, already used or expired.");
}

export class AccountStore {
  constructor(db) { this.db = db; }

  atomically(action) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = action(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  createInvitation(input = {}, now = Date.now()) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw validationError("Invitation options must be an object.");
    const hours = input.expiresInHours ?? DEFAULT_INVITATION_HOURS;
    if (!Number.isInteger(hours) || hours < 1 || hours > MAX_INVITATION_HOURS) throw validationError("expiresInHours must be an integer from 1 to " + MAX_INVITATION_HOURS + ".");
    const token = crypto.randomBytes(32).toString("base64url");
    const id = randomId("inv_");
    const expiresAt = now + hours * 3_600_000;
    return this.atomically(() => {
      const open = this.db.prepare("SELECT COUNT(*) AS n FROM invitations WHERE used_at IS NULL AND expires_at > ?").get(now).n;
      if (open >= MAX_OPEN_INVITATIONS) throw conflict("too_many_invitations", "Too many unused invitations. Wait for some to be used or expire.");
      this.db.prepare("INSERT INTO invitations (id,token_hash,created_at,expires_at,used_at,used_by) VALUES (?,?,?,?,NULL,NULL)")
        .run(id, digest(token), new Date(now).toISOString(), expiresAt);
      return { invitation: { id, token, expiresAt: new Date(expiresAt).toISOString() } };
    });
  }

  invitationUsable(token, now = Date.now()) {
    if (typeof token !== "string" || !INVITATION_TOKEN_PATTERN.test(token)) return false;
    return Boolean(this.db.prepare("SELECT id FROM invitations WHERE token_hash=? AND used_at IS NULL AND expires_at > ?").get(digest(token), now));
  }

  usernameTaken(username) {
    return Boolean(this.db.prepare("SELECT id FROM users WHERE username=?").get(username));
  }

  /** Re-validates the invitation inside one transaction, so concurrent redemptions cannot both succeed. */
  redeemInvitation({ token, username, passwordHash }, now = Date.now()) {
    return this.atomically(() => {
      if (!this.invitationUsable(token, now)) throw invitationInvalid();
      const invitation = this.db.prepare("SELECT id FROM invitations WHERE token_hash=?").get(digest(token));
      if (this.usernameTaken(username)) throw conflict("username_unavailable", "Choose a different username.");
      if (this.db.prepare("SELECT COUNT(*) AS n FROM users").get().n >= MAX_ACCOUNTS) throw conflict("too_many_accounts", "No more accounts can be created.");
      const id = randomId("usr_");
      const at = new Date(now).toISOString();
      this.db.prepare("INSERT INTO users (id,username,password_hash,status,session_epoch,invitation_id,created_at,updated_at) VALUES (?,?,?,'pending',0,?,?,?)")
        .run(id, username, passwordHash, invitation.id, at, at);
      const used = this.db.prepare("UPDATE invitations SET used_at=?, used_by=? WHERE id=? AND used_at IS NULL").run(at, id, invitation.id);
      if (used.changes !== 1) throw invitationInvalid();
      return { account: { username, status: "pending" } };
    });
  }

  /** Internal: includes the password hash. Never send this object to a client. */
  loginRecord(username) {
    return this.db.prepare("SELECT id,username,password_hash,status,session_epoch FROM users WHERE username=?").get(username);
  }

  sessionRecord(id) {
    return this.db.prepare("SELECT id,username,status,session_epoch FROM users WHERE id=?").get(id);
  }

  listAccounts(now = Date.now()) {
    const accounts = this.db.prepare("SELECT id,username,status,created_at,updated_at FROM users ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, username").all().map(publicAccount);
    const invitations = this.db.prepare("SELECT id,created_at,expires_at FROM invitations WHERE used_at IS NULL AND expires_at > ? ORDER BY expires_at").all(now)
      .map((row) => ({ id: row.id, createdAt: row.created_at, expiresAt: new Date(row.expires_at).toISOString() }));
    return { accounts, invitations };
  }

  setStatus(id, status, now = Date.now()) {
    if (typeof id !== "string" || !ACCOUNT_ID_PATTERN.test(id)) throw notFound("account_not_found", "Account not found.");
    return this.atomically(() => {
      const row = this.db.prepare("SELECT id FROM users WHERE id=?").get(id);
      if (!row) throw notFound("account_not_found", "Account not found.");
      const at = new Date(now).toISOString();
      if (status === "revoked") this.db.prepare("UPDATE users SET status='revoked', session_epoch=session_epoch+1, updated_at=? WHERE id=?").run(at, id);
      else this.db.prepare("UPDATE users SET status='approved', updated_at=? WHERE id=? AND status<>'approved'").run(at, id);
      return { account: publicAccount(this.db.prepare("SELECT id,username,status,created_at,updated_at FROM users WHERE id=?").get(id)) };
    });
  }
  approve(id, now) { return this.setStatus(id, "approved", now); }
  revoke(id, now) { return this.setStatus(id, "revoked", now); }
}
