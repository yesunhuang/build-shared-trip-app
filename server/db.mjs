import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { normalizeContent, applyParsedPlaces } from "./domain/validate.mjs";
import { resolveAliases } from "./domain/operations.mjs";
import { applyContentRules } from "./domain/content-rules.mjs";
import { USERNAME_PATTERN } from "./auth/passwords.mjs";
import { ACCOUNT_ID_PATTERN, ACCOUNT_ROLES, ACCOUNT_STATUSES } from "./auth/accounts.mjs";
import { MCP_TOKEN_ID_PATTERN } from "./auth/mcp-tokens.mjs";
import { AUDIT_ACTIONS, AUDIT_CHANNELS, AUDIT_OUTCOMES } from "./audit.mjs";

// Schema history:
//   v1 trips + request_log (days used "plans")
//   v2 normalized trip content ("slots"), trips_archived index
//   v3 owner-managed viewer accounts (users) and single-use invitations (digest only)
//   v4 users.role ('viewer' default | 'content-manager'), per-account MCP credentials (digest only)
//      and the bounded, payload-free audit_log
export const SCHEMA_VERSION = 4;
const BASE_TABLES = "CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, version INTEGER NOT NULL, archived INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS request_log (scope TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,request_id));";
const ACCOUNT_TABLES = "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','approved','revoked')), session_epoch INTEGER NOT NULL DEFAULT 0, invitation_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); " +
  "CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT, used_by TEXT);";
const ROLE_COLUMN = "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','content-manager'))";
const V4_TABLES = "CREATE TABLE IF NOT EXISTS mcp_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, account_epoch INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at TEXT, last_used_at TEXT); " +
  "CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens(user_id); " +
  "CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, channel TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, trip_id TEXT, request_id TEXT, version INTEGER, target TEXT, role TEXT);";
const hasColumn = (db, table, column) => db.prepare("SELECT name FROM pragma_table_info(?)").all(table).some((row) => row.name === column);

export function openDatabase(filename) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  fs.chmodSync(filename, 0o600);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON");
  const old = db.prepare("PRAGMA user_version").get().user_version;
  if (old > SCHEMA_VERSION) { db.close(); throw new Error("Database requires a newer application."); }
  // A pre-upgrade snapshot is kept for every older schema and is never deleted automatically.
  if (old > 0 && old < SCHEMA_VERSION) {
    const target = filename + ".before-v" + SCHEMA_VERSION + "-" + Date.now();
    db.exec("VACUUM INTO '" + target.replaceAll("'", "''") + "'");
    fs.chmodSync(target, 0o600);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(BASE_TABLES);
    if (old < 2) {
      for (const row of db.prepare("SELECT id,data FROM trips").all()) {
        const trip = JSON.parse(row.data);
        for (const day of trip.days || []) {
          if (!day.slots && day.plans) { day.slots = day.plans; delete day.plans; }
        }
        const { content, issues, parsedPlaces } = normalizeContent(resolveAliases(trip));
        issues.throwIfAny("Prior-version content cannot be migrated.");
        applyParsedPlaces(content,parsedPlaces,new Map());
        applyContentRules(null,content);
        const at = new Date().toISOString();
        const migrated = { ...content, id:trip.id, version:trip.version, archived:trip.archived, createdAt:trip.createdAt||at, updatedAt:trip.updatedAt||at };
        db.prepare("UPDATE trips SET data=? WHERE id=?").run(JSON.stringify(migrated), row.id);
      }
      db.exec("CREATE INDEX IF NOT EXISTS trips_archived ON trips(archived); PRAGMA user_version=2");
    }
    // v3 only adds tables: trip rows, IDs, versions, archive state and retry records are untouched.
    db.exec(ACCOUNT_TABLES);
    if (old < 3) db.exec("PRAGMA user_version=3");
    // v4 adds a defaulted column and new tables only. Existing accounts become viewers and keep their
    // IDs, statuses, hashes and session epochs; trips, versions and retry records are untouched.
    if (!hasColumn(db, "users", "role")) db.exec(ROLE_COLUMN);
    db.exec(V4_TABLES);
    if (old < 4) db.exec("PRAGMA user_version=4");
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }
  return db;
}

export async function snapshotDatabase(filename, target) {
  if (fs.existsSync(target)) throw new Error("Snapshot target already exists.");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename, { readOnly: true });
  try { await backup(db, target); fs.chmodSync(target, 0o600); validateSnapshot(target); }
  finally { db.close(); }
}

export function validateSnapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Invalid database snapshot.");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    if (version < 1 || version > SCHEMA_VERSION) throw new Error("Unsupported snapshot schema.");
    for (const row of db.prepare("SELECT id,version,data FROM trips").all()) {
      const trip = JSON.parse(row.data);
      if (trip.id !== row.id || trip.version !== row.version || !Array.isArray(trip.days)) throw new Error("Invalid trip in snapshot.");
      for (const day of trip.days) if (!day.slots && day.plans) {day.slots=day.plans;delete day.plans;}
      normalizeContent(resolveAliases(trip)).issues.throwIfAny("Invalid snapshot content.");
    }
    db.prepare("SELECT scope,request_id,fingerprint,result FROM request_log LIMIT 1").all();
    if (version >= 3) {
      for (const row of db.prepare("SELECT id,username,password_hash,status,session_epoch FROM users").all()) {
        if (!ACCOUNT_ID_PATTERN.test(row.id) || !USERNAME_PATTERN.test(row.username) || !String(row.password_hash).startsWith("scrypt$") ||
          !ACCOUNT_STATUSES.includes(row.status) || !Number.isInteger(row.session_epoch)) throw new Error("Invalid account in snapshot.");
      }
      db.prepare("SELECT id,token_hash,created_at,expires_at,used_at,used_by FROM invitations LIMIT 1").all();
    }
    if (version >= 4) {
      const users = new Map(db.prepare("SELECT id,role FROM users").all().map((row) => [row.id, row.role]));
      for (const role of users.values()) if (!ACCOUNT_ROLES.includes(role)) throw new Error("Invalid account role in snapshot.");
      for (const row of db.prepare("SELECT id,user_id,label,token_hash,account_epoch,created_at,expires_at,revoked_at,last_used_at FROM mcp_tokens").all()) {
        if (!MCP_TOKEN_ID_PATTERN.test(row.id) || !users.has(row.user_id) || typeof row.label !== "string" || !row.label || row.label.length > 64 ||
          !/^[0-9a-f]{64}$/.test(row.token_hash) || !Number.isInteger(row.account_epoch) || !Number.isInteger(row.expires_at) ||
          !Number.isFinite(Date.parse(row.created_at)) || (row.revoked_at !== null && !Number.isFinite(Date.parse(row.revoked_at))) ||
          (row.last_used_at !== null && !Number.isFinite(Date.parse(row.last_used_at)))) throw new Error("Invalid credential in snapshot.");
      }
      for (const row of db.prepare("SELECT seq,at,actor,channel,action,outcome FROM audit_log").all()) {
        if (!Number.isInteger(row.seq) || !Number.isFinite(Date.parse(row.at)) || typeof row.actor !== "string" || !AUDIT_CHANNELS.includes(row.channel) ||
          !AUDIT_ACTIONS.includes(row.action) || !AUDIT_OUTCOMES.includes(row.outcome)) throw new Error("Invalid audit event in snapshot.");
      }
    }
  } finally { db.close(); }
}
