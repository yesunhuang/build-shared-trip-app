// In-memory browser sessions and attempt limiting.
//
// Sessions intentionally live only in process memory, as in earlier releases: they expire after
// 12 hours and a restart (or restore) invalidates every issued cookie. Viewer sessions record the
// account's revocation epoch; app.mjs re-reads the account on every protected request, so an owner
// revocation takes effect immediately even for a session that is still in this map.
import crypto from "node:crypto";
import { DomainError } from "../domain/errors.mjs";

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_COOKIE = "shared_trip_session";

export class SessionStore {
  constructor({ ttlMs = SESSION_TTL_MS, maxSessions = 200, maxPerAccount = 10 } = {}) {
    this.ttlMs = ttlMs; this.maxSessions = maxSessions; this.maxPerAccount = maxPerAccount;
    this.sessions = new Map();
  }
  sweep(now = Date.now()) {
    for (const [key, value] of this.sessions) if (value.expires < now) this.sessions.delete(key);
  }
  /** data: { role: "owner" } or { role: "viewer" | "content-manager", userId, epoch }. Returns the opaque cookie value. */
  create(data, now = Date.now()) {
    this.sweep(now);
    if (data.userId) {
      const own = [...this.sessions].filter(([, value]) => value.userId === data.userId);
      while (own.length >= this.maxPerAccount) this.sessions.delete(own.shift()[0]);
    }
    while (this.sessions.size >= this.maxSessions) this.sessions.delete(this.sessions.keys().next().value);
    const key = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(key, { ...data, expires: now + this.ttlMs });
    return key;
  }
  get(key, now = Date.now()) {
    if (!key) return undefined;
    const value = this.sessions.get(key);
    if (!value) return undefined;
    if (value.expires < now) { this.sessions.delete(key); return undefined; }
    return value;
  }
  delete(key) { if (key) this.sessions.delete(key); }
  deleteForAccount(userId) {
    for (const [key, value] of this.sessions) if (value.userId === userId) this.sessions.delete(key);
  }
}

/** Fixed-window failure counter keyed by client address. Memory is bounded by maxKeys. */
export class AttemptLimiter {
  constructor({ limit, windowMs, message, maxKeys = 10_000 }) {
    this.limit = limit; this.windowMs = windowMs; this.message = message; this.maxKeys = maxKeys;
    this.entries = new Map();
  }
  sweep(now) { for (const [key, value] of this.entries) if (value.until < now) this.entries.delete(key); }
  check(key, now = Date.now()) {
    this.sweep(now);
    const entry = this.entries.get(key);
    if (entry && entry.count >= this.limit) throw new DomainError("rate_limited", 429, this.message);
  }
  fail(key, now = Date.now()) {
    let entry = this.entries.get(key);
    if (!entry || entry.until < now) entry = { count: 0, until: now + this.windowMs };
    entry.count++;
    this.entries.delete(key); this.entries.set(key, entry);
    while (this.entries.size > this.maxKeys) this.entries.delete(this.entries.keys().next().value);
  }
}
