import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { normalizeContent, applyParsedPlaces, isValidId } from "./domain/validate.mjs";
import { resolveAliases } from "./domain/operations.mjs";
import { applyContentRules } from "./domain/content-rules.mjs";
import { USERNAME_PATTERN } from "./auth/passwords.mjs";
import { ACCOUNT_ID_PATTERN, ACCOUNT_ROLES, ACCOUNT_STATUSES } from "./auth/accounts.mjs";
import { MCP_TOKEN_ID_PATTERN } from "./auth/mcp-tokens.mjs";
import { OAUTH_CLIENT_ID_PATTERN, OAUTH_GRANT_ID_PATTERN, OAUTH_REVOKE_REASONS, OAUTH_TOKEN_KINDS, PKCE_CHALLENGE_PATTERN } from "./auth/oauth.mjs";
import { AUDIT_ACTIONS, AUDIT_CHANNELS, AUDIT_OUTCOMES } from "./audit.mjs";
import { MEMBERSHIP_TABLES, TRIP_INVITE_ID } from "./trip-membership.mjs";
import { localPhotoPaths, PRIVATE_PHOTO } from "./domain/media.mjs";
import { validGrantScope, OAUTH_SCOPE } from "./auth/oauth-scopes.mjs";
import { SHARE_REVOKE_REASONS, SHARE_TABLES, SHARE_TRIGGERS } from "./trip-sharing.mjs";

// Schema history:
//   v1 trips + request_log (days used "plans")
//   v2 normalized trip content ("slots"), trips_archived index
//   v3 owner-managed viewer accounts (users) and single-use invitations (digest only)
//   v4 users.role ('viewer' default | 'content-manager'), per-account MCP credentials (digest only)
//      and the bounded, payload-free audit_log
//   v5 OAuth 2.1 tables only (registered public clients, grants, one-time codes and tokens, digest
//      only). Every earlier table, row, ID, version, epoch and retry record is untouched.
//   v6 trip_tombstones only (owner-only permanent deletion): stable trip ID, deleted version and
//      deletion time, never trip content. A tombstoned ID is never reused. Migration adds the empty
//      table; every existing row (trips, retry records, accounts, credentials, grants, audit) is
//      untouched.
//   v7 trip access, account memberships, digest-only join invitations, media bindings and bounded
//      join attempts. Existing trips get unknown creator metadata, no inferred members. Auth,
//      roles, credentials, OAuth, content versions and the separate Google ledger are unchanged.
// v8 expands OAuth grant/code validation to independently bound read/manage scopes. No rows,
// roles, grants or access assignments are rewritten. Compatible rollback must retain this policy.
// v9 adds trip_shares (one revocable anonymous read-only link per trip, SHA-256 digest only) and
//    three invalidation triggers (issuer revocation/epoch change, creator reassignment, member
//    removal). Additive only: no existing row is rewritten and every trip stays unshared. Rollback
//    retains this schema/ACL/share backend with the prior UI and current data. A v8 backend refuses
//    v9; restoring a historical snapshot is separate recovery and can revive older credentials.
export const SCHEMA_VERSION = 9;
const BASE_TABLES = "CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, version INTEGER NOT NULL, archived INTEGER NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS request_log (scope TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,request_id));";
const ACCOUNT_TABLES = "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('pending','approved','revoked')), session_epoch INTEGER NOT NULL DEFAULT 0, invitation_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); " +
  "CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at TEXT, used_by TEXT);";
const ROLE_COLUMN = "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('viewer','content-manager'))";
const V4_TABLES = "CREATE TABLE IF NOT EXISTS mcp_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), label TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, account_epoch INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at TEXT, last_used_at TEXT); " +
  "CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens(user_id); " +
  "CREATE TABLE IF NOT EXISTS audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT NOT NULL, channel TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL, reason TEXT, trip_id TEXT, request_id TEXT, version INTEGER, target TEXT, role TEXT);";
const V5_TABLES = "CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, client_name TEXT NOT NULL, redirect_uris TEXT NOT NULL, created_at TEXT NOT NULL, authorized_at TEXT); " +
  "CREATE TABLE IF NOT EXISTS oauth_grants (id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_clients(id), user_id TEXT NOT NULL REFERENCES users(id), account_epoch INTEGER NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, redirect_uri TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at TEXT, revoked_reason TEXT, last_used_at TEXT); " +
  "CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants(user_id); " +
  "CREATE TABLE IF NOT EXISTS oauth_codes (code_hash TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES oauth_clients(id), user_id TEXT NOT NULL REFERENCES users(id), account_epoch INTEGER NOT NULL, redirect_uri TEXT NOT NULL, resource TEXT NOT NULL, scope TEXT NOT NULL, code_challenge TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, grant_expires_at INTEGER NOT NULL, used_at TEXT, grant_id TEXT REFERENCES oauth_grants(id)); " +
  "CREATE TABLE IF NOT EXISTS oauth_tokens (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('access','refresh')), grant_id TEXT NOT NULL REFERENCES oauth_grants(id), created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, revoked_at TEXT); " +
  "CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens(grant_id);";
const V6_TABLES = "CREATE TABLE IF NOT EXISTS trip_tombstones (id TEXT PRIMARY KEY, deleted_version INTEGER NOT NULL CHECK (deleted_version > 0), deleted_at TEXT NOT NULL);";
const hasColumn = (db, table, column) => db.prepare("SELECT name FROM pragma_table_info(?)").all(table).some((row) => row.name === column);

export function openDatabase(filename, { origin } = {}) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  fs.chmodSync(filename, 0o600);
  // secure_delete (per connection, no schema change) overwrites freed pages, so a permanently deleted
  // trip's bytes do not linger in the main database file once SQLite checkpoints its WAL.
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON");
  const old = db.prepare("PRAGMA user_version").get().user_version;
  if (old > SCHEMA_VERSION) { db.close(); throw new Error("Database requires a newer application."); }
  // A pre-upgrade snapshot is kept for every older schema and is never deleted automatically.
  if (old > 0 && old < SCHEMA_VERSION) {
    const target = filename + ".before-v" + SCHEMA_VERSION + "-" + Date.now();
    db.exec("VACUUM INTO '" + target.replaceAll("'", "''") + "'");
    fs.chmodSync(target, 0o600);
    // The retained copy must be a usable rollback point before anything is changed.
    try { validateSnapshot(target); }
    catch (error) { db.close(); throw new Error("Pre-migration snapshot failed validation; the database was not changed. " + error.message); }
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
    // v5 adds OAuth tables only (CREATE ... IF NOT EXISTS, so re-running is a no-op).
    db.exec(V5_TABLES);
    if (old < 5) db.exec("PRAGMA user_version=5");
    // v6 adds the deletion tombstone table only (CREATE ... IF NOT EXISTS, so re-running is a no-op).
    db.exec(V6_TABLES);
    if (old < 6) db.exec("PRAGMA user_version=6");
    // v7 adds access metadata only. Legacy creator is unknown; no account is auto-enrolled.
    db.exec(MEMBERSHIP_TABLES);
    if(old<7){
      for(const row of db.prepare("SELECT id,data FROM trips").all()){
        db.prepare("INSERT OR IGNORE INTO trip_access VALUES(?,NULL,1)").run(row.id);
        for(const pathname of localPhotoPaths(JSON.parse(row.data),origin))db.prepare("INSERT OR IGNORE INTO trip_media VALUES(?,?)").run(row.id,pathname);
      }
      db.exec("PRAGMA user_version=7");
    }
    if(old<8)db.exec("PRAGMA user_version=8");
    // v9 adds the empty share table and its invalidation triggers only (IF NOT EXISTS: idempotent).
    db.exec(SHARE_TABLES);
    if(old<9)db.exec("PRAGMA user_version=9");
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
    if (version >= 5) validateOAuthTables(db,version);
    if (version >= 6) validateTombstones(db);
    if(version>=7)validateMembership(db);
    if(version>=9)validateShares(db);
  } finally { db.close(); }
}

// Schema v9: share rows reference live trips, hold only a SHA-256 digest (never a raw token), and
// a revoked row keeps no digest, issuer or expiry. The invalidation triggers must be present, so a
// restored copy can never silently lose fail-closed issuer invalidation.
function validateShares(db){
  const triggers=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(r=>r.name));
  for(const name of SHARE_TRIGGERS)if(!triggers.has(name))throw new Error("Missing share invalidation trigger in snapshot.");
  const trips=new Set(db.prepare("SELECT id FROM trips").all().map(r=>r.id)),users=new Set(db.prepare("SELECT id FROM users").all().map(r=>r.id));
  for(const r of db.prepare("SELECT trip_id,version,token_hash,issuer,issuer_epoch,created_at,expires_at,revoked_at,revoked_reason,updated_at FROM trip_shares").all()){
    const base=trips.has(r.trip_id)&&Number.isSafeInteger(r.version)&&r.version>0&&isTime(r.updated_at);
    const active=r.token_hash!==null&&isDigest(r.token_hash)&&r.revoked_at===null&&r.revoked_reason===null&&isTime(r.created_at)&&(r.expires_at===null||Number.isSafeInteger(r.expires_at))&&
      (r.issuer==="owner"?r.issuer_epoch===null:users.has(r.issuer)&&Number.isSafeInteger(r.issuer_epoch));
    const revoked=r.token_hash===null&&r.issuer===null&&r.issuer_epoch===null&&r.created_at===null&&r.expires_at===null&&isTime(r.revoked_at)&&SHARE_REVOKE_REASONS.includes(r.revoked_reason);
    if(!base||!(active||revoked))throw new Error("Invalid trip share in snapshot.");
  }
}

// Schema v6: a tombstone holds only a valid stable trip ID, a positive deleted version and a valid
// time, and its ID must not also be a live trip. Retry records of a deleted trip must be redacted:
// none may still return that trip's content.
function validateTombstones(db) {
  const deleted = new Set();
  for (const row of db.prepare("SELECT id,deleted_version,deleted_at FROM trip_tombstones").all()) {
    if (!isValidId(row.id) || !Number.isSafeInteger(row.deleted_version) || row.deleted_version < 1 || !isTime(row.deleted_at)) throw new Error("Invalid trip tombstone in snapshot.");
    deleted.add(row.id);
  }
  if (!deleted.size) return;
  const live = db.prepare("SELECT id FROM trips WHERE id=?");
  for (const id of deleted) if (live.get(id)) throw new Error("Invalid trip tombstone in snapshot.");
  for (const row of db.prepare("SELECT scope,result FROM request_log").all()) {
    let result = null;
    try { result = JSON.parse(row.result); } catch { throw new Error("Invalid retry record in snapshot."); }
    if (result?.deletedTrip) continue;
    const tripId = row.scope.startsWith("trip:") ? (result?.trip?.id??row.scope.slice(5)) : (row.scope === "create" || row.scope.startsWith("create:") || row.scope === "import" || row.scope.startsWith("import:")) ? result?.trip?.id : null;
    if (tripId && deleted.has(tripId)) throw new Error("Unredacted retry record for a deleted trip in snapshot.");
  }
}

const isTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isOptionalTime = (value) => value === null || isTime(value);
const isDigest = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

function validateMembership(db){
  if(db.prepare("PRAGMA foreign_key_check").all().length)throw new Error("Invalid membership references.");
  const trips=new Set(db.prepare("SELECT id FROM trips").all().map(r=>r.id));
  const users=new Set(db.prepare("SELECT id FROM users").all().map(r=>r.id));
  const members=db.prepare("SELECT * FROM trip_members").all();
  for(const row of members)if(!trips.has(row.trip_id)||!users.has(row.user_id)||!isTime(row.joined_at))throw new Error("Invalid trip member.");
  const access=db.prepare("SELECT * FROM trip_access").all();
  if(access.length!==trips.size)throw new Error("Missing trip access state.");
  for(const r of access)if(!trips.has(r.trip_id)||!Number.isSafeInteger(r.revision)||r.revision<1||(r.creator!==null&&r.creator!=="owner"&&(!users.has(r.creator)||!members.some(m=>m.trip_id===r.trip_id&&m.user_id===r.creator))))throw new Error("Invalid trip access state.");
  for(const r of db.prepare("SELECT * FROM trip_invitations").all())if(!TRIP_INVITE_ID.test(r.id)||!trips.has(r.trip_id)||!isDigest(r.token_hash)||(r.issuer!=="owner"&&!users.has(r.issuer))||!isTime(r.created_at)||!Number.isSafeInteger(r.expires_at)||!isOptionalTime(r.used_at)||!isOptionalTime(r.revoked_at)||(r.used_by!==null&&!users.has(r.used_by))||Boolean(r.used_by)!==Boolean(r.used_at))throw new Error("Invalid trip invitation.");
  for(const r of db.prepare("SELECT * FROM trip_media").all())if(!trips.has(r.trip_id)||!PRIVATE_PHOTO.test(r.pathname))throw new Error("Invalid trip media binding.");
  for(const r of db.prepare("SELECT * FROM trip_join_attempts").all())if(!users.has(r.user_id)||!Number.isSafeInteger(r.started_at)||!Number.isSafeInteger(r.attempts)||r.attempts<1)throw new Error("Invalid join attempt state.");
}

// Schema v5: every OAuth row must reference existing clients, grants and accounts, store only
// digests, and use the fixed scope/kind/reason vocabularies.
function validateOAuthTables(db,version) {
  const validScope=scope=>validGrantScope(scope)&&(version>=8||scope===OAUTH_SCOPE);
  const users = new Set(db.prepare("SELECT id FROM users").all().map((row) => row.id));
  const clients = new Set();
  for (const row of db.prepare("SELECT id,client_name,redirect_uris,created_at,authorized_at FROM oauth_clients").all()) {
    let uris = null;
    try { uris = JSON.parse(row.redirect_uris); } catch { /* rejected below */ }
    if (!OAUTH_CLIENT_ID_PATTERN.test(row.id) || typeof row.client_name !== "string" || row.client_name.length > 100 || !Array.isArray(uris) || !uris.length || uris.length > 5 ||
      !uris.every((uri) => typeof uri === "string" && uri.length <= 512 && /^https?:\/\//.test(uri)) || !isTime(row.created_at) || !isOptionalTime(row.authorized_at)) throw new Error("Invalid OAuth client in snapshot.");
    clients.add(row.id);
  }
  const grants = new Set();
  for (const row of db.prepare("SELECT id,client_id,user_id,account_epoch,scope,resource,redirect_uri,created_at,expires_at,revoked_at,revoked_reason,last_used_at FROM oauth_grants").all()) {
    if (!OAUTH_GRANT_ID_PATTERN.test(row.id) || !clients.has(row.client_id) || !users.has(row.user_id) || !Number.isInteger(row.account_epoch) || !validScope(row.scope) ||
      typeof row.resource !== "string" || !row.resource.endsWith("/mcp") || typeof row.redirect_uri !== "string" || !isTime(row.created_at) || !Number.isInteger(row.expires_at) ||
      !isOptionalTime(row.revoked_at) || (row.revoked_at === null ? row.revoked_reason !== null : !OAUTH_REVOKE_REASONS.includes(row.revoked_reason)) || !isOptionalTime(row.last_used_at)) throw new Error("Invalid OAuth grant in snapshot.");
    grants.add(row.id);
  }
  for (const row of db.prepare("SELECT code_hash,client_id,user_id,account_epoch,redirect_uri,resource,scope,code_challenge,created_at,expires_at,grant_expires_at,used_at,grant_id FROM oauth_codes").all()) {
    if (!isDigest(row.code_hash) || !clients.has(row.client_id) || !users.has(row.user_id) || !Number.isInteger(row.account_epoch) || !validScope(row.scope) ||
      !PKCE_CHALLENGE_PATTERN.test(row.code_challenge) || !isTime(row.created_at) || !Number.isInteger(row.expires_at) || !Number.isInteger(row.grant_expires_at) ||
      !isOptionalTime(row.used_at) || (row.grant_id !== null && !grants.has(row.grant_id))) throw new Error("Invalid OAuth code in snapshot.");
  }
  for (const row of db.prepare("SELECT token_hash,kind,grant_id,created_at,expires_at,used_at,revoked_at FROM oauth_tokens").all()) {
    if (!isDigest(row.token_hash) || !OAUTH_TOKEN_KINDS.includes(row.kind) || !grants.has(row.grant_id) || !isTime(row.created_at) || !Number.isInteger(row.expires_at) ||
      (row.used_at !== null && !Number.isInteger(row.used_at)) || !isOptionalTime(row.revoked_at)) throw new Error("Invalid OAuth token in snapshot.");
  }
}
