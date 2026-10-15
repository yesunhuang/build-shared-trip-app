// Durable, payload-free audit metadata (schema v4 table audit_log in db.mjs).
//
// An event records only: timestamp, a stable actor reference ("owner", an account ID or
// "anonymous"), the channel ("http" or "mcp"), an action from a fixed enum, an outcome from a fixed
// enum, an optional error code, and optional trip ID / requestId / resulting version / target ID
// (account or credential ID) / role enum. Every field is checked against a strict pattern before it
// is stored, so request or response bodies, titles, raw URLs, credentials, digests, invitation
// codes, cookies and error stacks cannot be written even by mistake. Retention is bounded to
// MAX_AUDIT_EVENTS rows (oldest removed first).
import { isValidId } from "./domain/validate.mjs";
import { validationError } from "./domain/errors.mjs";

export const AUDIT_ACTIONS = Object.freeze([
  "trip.create", "trip.import", "trip.change", "trip.archive", "trip.unarchive", "trip.replace_content",
  "account.approve", "account.revoke", "account.role", "invitation.create",
  "token.issue", "token.revoke", "access.denied", "auth.refused"
]);
export const AUDIT_OUTCOMES = Object.freeze(["accepted", "replayed", "unchanged", "refused"]);
export const AUDIT_CHANNELS = Object.freeze(["http", "mcp"]);
export const MAX_AUDIT_EVENTS = 5000;
export const DEFAULT_AUDIT_LIMIT = 100;
export const MAX_AUDIT_LIMIT = 500;

const ACTOR = /^(?:owner|anonymous|usr_[A-Za-z0-9_-]{8,40})$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REASON = /^[a-z][a-z_]{0,47}$/;
const TARGET = /^(?:usr|inv|mct)_[A-Za-z0-9_-]{8,40}$/;
const ROLES = ["viewer", "content-manager"];
// Refusals that a misbehaving client could repeat in a loop are throttled per actor/action/reason
// so they cannot flush earlier events out of the bounded log.
const THROTTLED = new Set(["access.denied", "auth.refused"]);
const THROTTLE_MS = 60_000;

const keep = (value, test) => (test(value) ? value : null);
export const safeRequestId = (value) => (typeof value === "string" && REQUEST_ID.test(value) ? value : null);
export const safeTripId = (value) => (isValidId(value) ? value : null);
export const safeTarget = (value) => (typeof value === "string" && TARGET.test(value) ? value : null);

export class AuditLog {
  constructor(db, { clock = Date.now } = {}) {
    this.db = db; this.clock = clock;
    this.recent = new Map();
  }

  /** Inserts one event. Throws on storage failure (callers inside a transaction then roll back). */
  record(event) {
    if (!AUDIT_ACTIONS.includes(event.action) || !AUDIT_OUTCOMES.includes(event.outcome)) throw new Error("Invalid audit event.");
    const row = [
      new Date(this.clock()).toISOString(),
      keep(event.actor, (v) => typeof v === "string" && ACTOR.test(v)) ?? "anonymous",
      AUDIT_CHANNELS.includes(event.channel) ? event.channel : "http",
      event.action, event.outcome,
      keep(event.reason, (v) => typeof v === "string" && REASON.test(v)),
      safeTripId(event.tripId), safeRequestId(event.requestId),
      keep(event.version, (v) => Number.isSafeInteger(v) && v > 0),
      safeTarget(event.target),
      keep(event.role, (v) => ROLES.includes(v))
    ];
    const inserted = this.db.prepare("INSERT INTO audit_log (at,actor,channel,action,outcome,reason,trip_id,request_id,version,target,role) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(...row);
    const cutoff = Number(inserted.lastInsertRowid) - MAX_AUDIT_EVENTS;
    if (cutoff > 0) this.db.prepare("DELETE FROM audit_log WHERE seq <= ?").run(cutoff);
  }

  /** Best effort, for refusals outside any write transaction: never throws and never masks the original error. */
  safeRecord(event) {
    try {
      if (THROTTLED.has(event.action)) {
        const now = Date.now(); // in-memory throttling uses the real clock, independent of an injected test clock
        for (const [key, until] of this.recent) if (until < now) this.recent.delete(key);
        const key = event.actor + "|" + event.action + "|" + event.reason;
        if (this.recent.has(key)) return;
        if (this.recent.size > 10_000) this.recent.clear();
        this.recent.set(key, now + THROTTLE_MS);
      }
      this.record(event);
    } catch { /* audit storage problems must not change the response */ }
  }

  list(limitParam) {
    let limit = DEFAULT_AUDIT_LIMIT;
    if (limitParam !== null && limitParam !== undefined) {
      if (!/^\d{1,4}$/.test(limitParam) || Number(limitParam) < 1 || Number(limitParam) > MAX_AUDIT_LIMIT) throw validationError("limit must be an integer from 1 to " + MAX_AUDIT_LIMIT + ".");
      limit = Number(limitParam);
    }
    const events = this.db.prepare("SELECT seq,at,actor,channel,action,outcome,reason,trip_id,request_id,version,target,role FROM audit_log ORDER BY seq DESC LIMIT ?").all(limit)
      .map((row) => ({ id: row.seq, at: row.at, actor: row.actor, channel: row.channel, action: row.action, outcome: row.outcome, reason: row.reason,
        tripId: row.trip_id, requestId: row.request_id, version: row.version, target: row.target, role: row.role }));
    return { events };
  }
}
