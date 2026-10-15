// Content-manager accounts and per-account MCP credentials: real HTTP and MCP requests against the
// actual service with fictional data only.
//
// Covers: all-trip (current and future) read/write over HTTP and MCP in both directions, including
// create, import, export, edit, delete, replace_content, archive/unarchive and protected media; the
// denial matrix (anonymous, viewer, pending, revoked, manager cookie at MCP, manager credential at
// HTTP routes and owner login, account/credential/audit administration); 90-day expiry with an
// injected clock; role-change and revocation invalidation and re-approval non-revival; owner and
// viewer compatibility; digest-only credential persistence; payload-free audit with atomic write
// semantics; conflicts, atomic rollback and durable identical retries; restart persistence,
// snapshot validation and a fictional schema-v3 -> current (SCHEMA_VERSION) upgrade.
//
// Credential safety: generated secrets, cookies and passwords are never passed to assertion messages
// or compared with assert.equal/deepEqual; assertions use booleans, statuses and generic labels.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { SCHEMA_VERSION, snapshotDatabase, validateSnapshot } from "../server/db.mjs";
import { MAX_AUDIT_EVENTS } from "../server/audit.mjs";

// Current-version assertions follow the exported schema constant; the v3 fixture keeps its old version.
assert.ok(Number.isInteger(SCHEMA_VERSION) && SCHEMA_VERSION >= 4, "exported SCHEMA_VERSION is a current schema number");
const preUpgradeSnapshotPattern = new RegExp("^shared-trip\\.sqlite\\.before-v" + SCHEMA_VERSION + "-\\d+$");

// Fixture-only downgrade helper for disposable test databases: drops every table a newer schema added
// under the oauth_ prefix (discovered from sqlite_master, never guessed) so the fixture is a genuine
// old schema. Foreign keys are suspended only for these drops and then restored to their prior setting.
const OAUTH_TABLE = /^oauth_[a-z_]+$/;
const oauthTables = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name).filter((name) => OAUTH_TABLE.test(name));
function dropOAuthTablesForFixture(db) {
  const names = oauthTables(db);
  if (names.length === 0) return;
  const foreignKeys = db.prepare("PRAGMA foreign_keys").get().foreign_keys;
  db.exec("PRAGMA foreign_keys=OFF");
  try {
    for (const name of names) db.exec("DROP TABLE IF EXISTS \"" + name.replaceAll("\"", "\"\"") + "\"");
    if (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get().n) {
      const forget = db.prepare("DELETE FROM sqlite_sequence WHERE name=?");
      for (const name of names) forget.run(name);
    }
  } finally {
    db.exec("PRAGMA foreign_keys=" + (foreignKeys ? "ON" : "OFF"));
  }
  assert.deepEqual(oauthTables(db), [], "fixture downgrade removed every oauth_ table");
}

const repoRoot = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-manager-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
const photoDir = path.join(temporary, "fictional-photos");
fs.mkdirSync(photoDir);
const photoName = "c0ffee00d1ce5eed.webp";
const photoBytes = Buffer.from("fictional-manager-media-bytes");
fs.writeFileSync(path.join(photoDir, photoName), photoBytes);

let clockOffset = 0;
const clock = () => Date.now() + clockOffset;
const configFor = (name) => ({ ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, name), SHARED_TRIP_PORT: "0" }), photoDir, clock });
const running = [];
const sdkClients = [];
async function start(name) { const runtime = await startServer(configFor(name)); running.push(runtime); return runtime; }
async function stop(runtime) { running.splice(running.indexOf(runtime), 1); await runtime.close(); }

// Every generated credential, cookie value and password, for leak scans. Never printed.
const secrets = [ownerToken];
const remember = (value) => { secrets.push(value); return value; };
const newPassword = () => remember("Fictional-" + crypto.randomBytes(12).toString("base64url"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS = 90 * DAY_MS;
const MANAGER_SECRET = /^stm_[A-Za-z0-9_-]{43}$/;
const CAPS_MANAGER = { readTrips: true, exportTrips: true, editTrips: true, importTrips: true, manageAccounts: false, mcp: false };
const CAPS_VIEWER = { readTrips: true, exportTrips: true, editTrips: false, importTrips: false, manageAccounts: false, mcp: false };
const CAPS_OWNER_COOKIE = { readTrips: true, exportTrips: true, editTrips: true, importTrips: true, manageAccounts: true, mcp: false };
const ACCOUNT_KEYS = ["createdAt", "id", "role", "status", "updatedAt", "username"];
const TOKEN_KEYS = ["createdAt", "expiresAt", "id", "label", "lastUsedAt", "revokedAt"];
const EVENT_KEYS = ["action", "actor", "at", "channel", "id", "outcome", "reason", "requestId", "role", "target", "tripId", "version"];
const SIX_TOOLS = ["apply_trip_changes", "create_trip", "export_trip", "get_trip", "import_trip", "list_trips"];
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fictional-probe", version: "1.0.0" } } };
const mcpAccept = { Accept: "application/json, text/event-stream" };

/** Generic status assertion: prints only the label, status and error code, never bodies. */
function check(response, status, label) {
  assert.ok(response.status === status, label + " (expected " + status + ", got " + response.status + ", code " + (response.body?.error?.code ?? "none") + ")");
  return response.body;
}
const codeOf = (response) => response.body?.error?.code ?? "none";

function client(base) {
  async function call(route, { method = "GET", body, headers = {} } = {}) {
    const sent = Object.fromEntries(Object.entries({ ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }).filter(([, value]) => value !== undefined));
    const response = await fetch(base + route, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = method === "HEAD" ? "" : await response.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    const pathname = new URL(route, base).pathname;
    if (/^\/(?:api|mcp|photos)(?:\/|$)/.test(pathname) && pathname !== "/photos/manifest.js") assert.ok(response.headers.get("cache-control") === "no-store", method + " " + pathname + " must be no-store");
    return { status: response.status, headers: response.headers, body: json, text };
  }
  const api = {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } }),
    bearer: (secret, route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + secret, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
    signIn: (username, password) => call("/api/login", { method: "POST", headers: { Origin: base }, body: { username, password } }),
    async invite() {
      const body = check(await api.owner("/api/invitations", { method: "POST", body: {} }), 201, "owner invitation");
      remember(body.invitation.token); return body.invitation;
    },
    async login(account, role = "content-manager") {
      const response = await api.signIn(account.username, account.password);
      check(response, 200, "sign-in " + account.username);
      assert.equal(response.body.role, role, "sign-in role for " + account.username);
      return remember((response.headers.get("set-cookie") || "").split(";")[0]);
    },
    async ownerCookie() {
      const response = await call("/api/login", { method: "POST", headers: { Origin: base }, body: { token: ownerToken } });
      check(response, 200, "owner token sign-in");
      return remember((response.headers.get("set-cookie") || "").split(";")[0]);
    },
    async accounts() { return check(await api.owner("/api/users"), 200, "list accounts").accounts; },
    async makeAccount(username, { role, approve = true } = {}) {
      const invitation = await api.invite();
      const password = newPassword();
      check(await call("/api/accept-invite", { method: "POST", headers: { Origin: base }, body: { invitation: invitation.token, username, password } }), 201, "redeem " + username);
      const id = (await api.accounts()).find((account) => account.username === username).id;
      if (role) check(await api.owner("/api/users/" + id + "/role", { method: "POST", body: { role } }), 200, "assign role " + username);
      if (approve) check(await api.owner("/api/users/" + id + "/approve", { method: "POST" }), 200, "approve " + username);
      return { id, username, password };
    },
    async issue(userId, label) {
      const response = await api.owner("/api/users/" + userId + "/mcp-tokens", { method: "POST", body: { label } });
      check(response, 201, "issue credential " + label);
      remember(response.body.secret);
      return { id: response.body.token.id, secret: response.body.secret, meta: response.body.token, keys: Object.keys(response.body).sort() };
    },
    async tokens(userId) { return check(await api.owner("/api/users/" + userId + "/mcp-tokens"), 200, "list credentials").tokens; },
    /** Raw MCP initialize; returns only the status. */
    async mcpStatus(headers = {}) { return (await call("/mcp", { method: "POST", body: initialize, headers: { ...mcpAccept, ...headers } })).status; },
    async trip(id) { return check(await api.owner("/api/trips/" + id), 200, "owner read trip").trip; },
    async tripCount() { return check(await api.owner("/api/trips"), 200, "owner list").trips.length; },
    async audit(limit = 500) { return check(await api.owner("/api/audit?limit=" + limit), 200, "audit list").events; }
  };
  return api;
}

async function mcpSession(base, secret) {
  const sdk = new Client({ name: "fictional-content-manager", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + secret } } }));
  sdkClients.push(sdk);
  return {
    sdk,
    async tool(name, args) {
      const result = await sdk.callTool({ name, arguments: args });
      return { isError: Boolean(result.isError), data: result.structuredContent || JSON.parse(result.content[0].text) };
    },
    async close() { sdkClients.splice(sdkClients.indexOf(sdk), 1); await sdk.close(); }
  };
}

function fileContainsAny(files, values) {
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const data = fs.readFileSync(file);
    if (values.some((value) => data.includes(Buffer.from(value)))) return true;
  }
  return false;
}
function databaseText(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
    .map(({ name }) => JSON.stringify(db.prepare("SELECT * FROM \"" + name.replaceAll("\"", "\"\"") + "\"").all())).join("\n");
}

let runtime = await start("main");
let api = client(runtime.url);
try {
  // ---------------------------------------------------------------------------------------------
  // Fictional content created by the owner before any content-manager role exists.
  const TITLES = ["Fictional Alpha Coast", "Fictional Beta Hills", "Fictional Gamma Draft", "Fictional Delta Future", "Fictional Epsilon Draft", "Fictional Outage Trip", "Fictional Legacy Shore"];
  let alpha = check(await api.owner("/api/trips", { method: "POST", body: { requestId: "cm-alpha", trip: { title: TITLES[0] } } }), 201, "owner create alpha").trip;
  alpha = check(await api.owner("/api/trips/" + alpha.id + "/changes", { method: "POST", body: { requestId: "cm-alpha-seed", expectedVersion: 1, changes: [
    { type: "upsert_day", day: { id: "cm-day", date: "2032-03-04", slots: [
      { id: "cm-plan-a", name: "Invented harbor walk", time: "11:00", review: "Invented notes", i18n: { ja: { name: "架空の散歩" } } },
      { id: "cm-plan-b", name: "Invented bakery", time: "09:00" }] } },
    { type: "upsert_reminder", reminder: { id: "cm-todo", item: "Invented ferry ticket", dueDate: "2032-03-01", done: false } }] } }), 200, "seed alpha").trip;
  assert.deepEqual(alpha.days[0].slots.map((slot) => slot.id), ["cm-plan-b", "cm-plan-a"], "plans sorted by time");
  let beta = check(await api.owner("/api/trips", { method: "POST", body: { requestId: "cm-beta", trip: { title: TITLES[1] } } }), 201, "owner create beta").trip;
  beta = check(await api.owner("/api/trips/" + beta.id + "/changes", { method: "POST", body: { requestId: "cm-beta-archive", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] } }), 200, "owner archive beta").trip;

  // ---------------------------------------------------------------------------------------------
  // Accounts and roles.
  const manager = await api.makeAccount("fictional.manager", { role: "content-manager" });
  const viewer = await api.makeAccount("fictional.reader");
  const pending = await api.makeAccount("fictional.pending", { role: "content-manager", approve: false });
  const retired = await api.makeAccount("fictional.retired", { role: "content-manager" });
  check(await api.owner("/api/users/" + retired.id + "/revoke", { method: "POST" }), 200, "revoke retired manager");
  const listed = await api.accounts();
  for (const account of listed) assert.deepEqual(Object.keys(account).sort(), ACCOUNT_KEYS, "account summary fields");
  const byName = (name) => listed.find((account) => account.username === name);
  assert.equal(byName("fictional.manager").role, "content-manager");
  assert.equal(byName("fictional.reader").role, "viewer", "new accounts default to viewer");
  assert.equal(byName("fictional.pending").role, "content-manager", "role can be assigned before approval");
  assert.equal(byName("fictional.pending").status, "pending", "assigning a role does not approve");
  assert.equal(byName("fictional.retired").status, "revoked");

  for (const body of [{ role: "owner" }, { role: "admin" }, { role: "Content-Manager" }, {}, { role: "content-manager", status: "approved" }, { role: "viewer", userId: manager.id }, { role: ["content-manager"] }]) {
    assert.equal((await api.owner("/api/users/" + viewer.id + "/role", { method: "POST", body })).status, 422, "invalid role body is refused");
  }
  assert.equal((await api.owner("/api/users/" + viewer.id + "/role", { method: "POST" })).status, 415, "role change requires JSON");
  assert.equal((await api.owner("/api/users/usr_doesnotexist0/role", { method: "POST", body: { role: "viewer" } })).status, 404);
  assert.equal((await api.accounts()).find((account) => account.id === viewer.id).role, "viewer", "owner rights are never granted via the role route");
  const roleResponse = check(await api.owner("/api/users/" + pending.id + "/role", { method: "POST", body: { role: "content-manager" } }), 200, "idempotent role assignment");
  assert.deepEqual(Object.keys(roleResponse).sort(), ["account"]); assert.deepEqual(Object.keys(roleResponse.account).sort(), ACCOUNT_KEYS);
  console.log("Roles: viewer default, owner-only assignment before approval, strict { role } bodies and no owner grant passed.");

  // ---------------------------------------------------------------------------------------------
  // Sessions and capabilities.
  let managerCookie = await api.login(manager);
  const managerSession = check(await api.as(managerCookie, "/api/session"), 200, "manager session");
  assert.deepEqual(managerSession, { authenticated: true, role: "content-manager", username: "fictional.manager", capabilities: CAPS_MANAGER });
  const viewerCookie = await api.login(viewer, "viewer");
  assert.deepEqual(check(await api.as(viewerCookie, "/api/session"), 200, "viewer session"), { authenticated: true, role: "viewer", username: "fictional.reader", capabilities: CAPS_VIEWER });
  const ownerCookie = await api.ownerCookie();
  assert.deepEqual(check(await api.as(ownerCookie, "/api/session"), 200, "owner session").capabilities, CAPS_OWNER_COOKIE);
  assert.equal(check(await api.owner("/api/session"), 200, "owner bearer session").capabilities.mcp, true, "owner bearer keeps MCP capability");
  for (const account of [pending, retired]) {
    const refused = await api.signIn(account.username, account.password);
    assert.equal(refused.status, 403, account.username + " cannot sign in"); assert.equal(refused.headers.get("set-cookie"), null);
  }
  console.log("Sessions: manager and viewer roles and capabilities, owner compatibility, pending/revoked refusal passed.");

  // ---------------------------------------------------------------------------------------------
  // Manager HTTP writes on owner-created (current) trips, new trips and owner trips created later.
  const webEdit = { requestId: "cm-web-edit", expectedVersion: alpha.version, changes: [{ type: "upsert_plan", dayId: "cm-day", plan: { id: "cm-plan-a", name: "Invented harbor stroll", time: "08:30" } }] };
  const edited = check(await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: webEdit }), 200, "manager edits an owner trip");
  alpha = edited.trip;
  assert.deepEqual(alpha.days[0].slots.map((slot) => slot.id), ["cm-plan-a", "cm-plan-b"], "time change re-sorts plans");
  assert.equal(alpha.days[0].slots[0].i18n, undefined, "source edit drops the dependent translation");
  assert.deepEqual(check(await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: webEdit }), 200, "identical retry"), edited, "identical retry replays the durable result");
  const reused = await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: { ...webEdit, changes: [{ type: "update_trip", fields: { shortName: "Other" } }] } });
  assert.equal(reused.status, 409); assert.equal(codeOf(reused), "request_id_conflict");
  const stale = await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: { requestId: "cm-web-stale", expectedVersion: 1, changes: [{ type: "update_trip", fields: { shortName: "Stale" } }] } });
  assert.equal(stale.status, 409); assert.equal(codeOf(stale), "version_conflict");
  const rolledBack = await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: { requestId: "cm-web-atomic", expectedVersion: alpha.version, changes: [
    { type: "upsert_reminder", reminder: { id: "cm-must-not-exist", item: "Invented phantom" } }, { type: "upsert_day", day: { id: "cm-bad-day", date: "2032-02-30" } }] } });
  assert.equal(rolledBack.status, 422, "invalid batch is refused");
  const afterRollback = await api.trip(alpha.id);
  assert.equal(afterRollback.version, alpha.version, "refused batch does not change the version");
  assert.ok(!afterRollback.reminders.some((item) => item.id === "cm-must-not-exist"), "refused batch is atomic");
  alpha = check(await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: { requestId: "cm-web-delete", expectedVersion: alpha.version, changes: [{ type: "delete_plan", dayId: "cm-day", planId: "cm-plan-b" }] } }), 200, "manager deletes content").trip;
  assert.deepEqual(alpha.days[0].slots.map((slot) => slot.id), ["cm-plan-a"]);
  const replacement = structuredClone(alpha); replacement.reminders[0].item = "Invented ferry ticket, replaced";
  alpha = check(await api.as(managerCookie, "/api/trips/" + alpha.id + "/changes", { method: "POST", body: { requestId: "cm-web-replace", expectedVersion: alpha.version, changes: [{ type: "replace_content", trip: replacement }] } }), 200, "manager replaces content").trip;
  assert.equal(alpha.reminders[0].item, "Invented ferry ticket, replaced");
  beta = check(await api.as(managerCookie, "/api/trips/" + beta.id + "/changes", { method: "POST", body: { requestId: "cm-web-unarchive", expectedVersion: beta.version, changes: [{ type: "archive_trip", archived: false }] } }), 200, "manager unarchives").trip;
  assert.equal(beta.archived, false);
  beta = check(await api.as(managerCookie, "/api/trips/" + beta.id + "/changes", { method: "POST", body: { requestId: "cm-web-archive", expectedVersion: beta.version, changes: [{ type: "archive_trip", archived: true }] } }), 200, "manager archives").trip;
  assert.equal(beta.archived, true);
  assert.equal((await api.as(managerCookie, "/api/trips/" + beta.id + "/changes", { method: "POST", body: { requestId: "cm-web-archived-edit", expectedVersion: beta.version, changes: [{ type: "update_trip", fields: { shortName: "Blocked" } }] } })).status, 409, "archived trips stay read-only until unarchived");
  const gamma = check(await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-web-create", trip: { title: TITLES[2] } } }), 201, "manager creates a trip").trip;
  assert.equal(check(await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-web-create", trip: { title: TITLES[2] } } }), 201, "identical create retry").trip.id, gamma.id, "durable create retry");
  assert.equal((await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-web-no-origin", trip: { title: "x" } }, headers: { Origin: undefined } })).status, 403, "manager cookie writes require same-origin");
  const exported = check(await api.as(managerCookie, "/api/trips/" + alpha.id + "/export"), 200, "manager export");
  assert.equal(exported.format, "shared-trip-export"); assert.equal(exported.trip.id, alpha.id);
  const importedWeb = check(await api.as(managerCookie, "/api/import", { method: "POST", body: { requestId: "cm-web-import", data: exported } }), 201, "manager import");
  assert.notEqual(importedWeb.trip.id, alpha.id, "import never overwrites"); assert.equal(importedWeb.trip.title, alpha.title);
  assert.equal(check(await api.as(managerCookie, "/api/import", { method: "POST", body: { requestId: "cm-web-import", data: exported } }), 201, "identical import retry").trip.id, importedWeb.trip.id, "durable import retry");
  const media = await api.as(managerCookie, "/photos/" + photoName);
  assert.equal(media.status, 200); assert.equal(media.headers.get("content-type"), "image/webp"); assert.ok(media.text === photoBytes.toString(), "manager reads protected media");
  assert.equal((await api.as(managerCookie, "/photos/" + photoName, { method: "HEAD" })).status, 200);
  let delta = check(await api.owner("/api/trips", { method: "POST", body: { requestId: "cm-delta", trip: { title: TITLES[3] } } }), 201, "owner creates a later trip").trip;
  delta = check(await api.as(managerCookie, "/api/trips/" + delta.id + "/changes", { method: "POST", body: { requestId: "cm-web-future", expectedVersion: 1, changes: [{ type: "update_trip", fields: { shortName: "Delta" } }] } }), 200, "manager edits a trip created after the role assignment").trip;
  const managerList = check(await api.as(managerCookie, "/api/trips"), 200, "manager list").trips.map((trip) => trip.id);
  for (const id of [alpha.id, beta.id, gamma.id, delta.id, importedWeb.trip.id]) assert.ok(managerList.includes(id), "manager lists every trip, including archived");
  for (const [route, body] of [["/api/trips", { requestId: "viewer-create", trip: { title: "x" } }], ["/api/import", { requestId: "viewer-import", data: exported }], ["/api/trips/" + delta.id + "/changes", { requestId: "viewer-edit", expectedVersion: delta.version, changes: [{ type: "archive_trip", archived: true }] }]]) {
    assert.equal((await api.as(viewerCookie, route, { method: "POST", body })).status, 403, "viewer stays read-only");
  }
  console.log("Manager HTTP: edit/delete/replace/archive/unarchive/create/import/export/media on current and future trips, conflicts, atomic rollback and durable retries passed; viewers stay read-only.");

  // ---------------------------------------------------------------------------------------------
  // Administration is owner-only.
  const administration = [
    ["GET", "/api/users"], ["GET", "/api/users/"], ["POST", "/api/invitations", {}], ["POST", "/api/users/" + viewer.id + "/approve", {}], ["POST", "/api/users/" + viewer.id + "/revoke", {}],
    ["POST", "/api/users/" + viewer.id + "/role", { role: "content-manager" }], ["POST", "/api/users/" + manager.id + "/role", { role: "content-manager" }],
    ["POST", "/api/users/" + pending.id + "/approve", {}], ["GET", "/api/users/" + manager.id + "/mcp-tokens"], ["POST", "/api/users/" + manager.id + "/mcp-tokens", { label: "Self issued" }],
    ["POST", "/api/users/" + manager.id + "/mcp-tokens/mct_AAAAAAAAAAAAAAAA/revoke", {}], ["GET", "/api/audit"], ["GET", "/api/audit?limit=5"],
    ["DELETE", "/api/trips/" + alpha.id], ["PUT", "/api/trips/" + alpha.id, {}], ["PATCH", "/api/trips/" + alpha.id, {}], ["POST", "/api/trips/" + alpha.id + "/purge", {}],
    ["POST", "/api/restore", {}], ["POST", "/api/backup", {}], ["POST", "/api/trips/" + alpha.id + "/export", {}], ["POST", "/photos/" + photoName, {}]
  ];
  for (const [method, route, body] of administration) {
    const asManager = await api.as(managerCookie, route, { method, body });
    assert.equal(asManager.status, 403, "manager cookie " + method + " " + route.split("?")[0]);
    assert.equal(codeOf(asManager), "forbidden");
    assert.equal((await api.as(viewerCookie, route, { method, body })).status, 403, "viewer " + method + " " + route.split("?")[0]);
    assert.equal((await api.call(route, { method, body, headers: { Origin: api.base } })).status, 401, "anonymous " + method + " " + route.split("?")[0]);
  }
  assert.equal((await api.accounts()).find((account) => account.id === pending.id).status, "pending", "manager cannot approve accounts");
  console.log("Account, invitation, role, credential, audit, purge and restore administration is refused for manager and viewer sessions.");

  // ---------------------------------------------------------------------------------------------
  // Credential issuance: owner-only, approved content managers only, exactly 90 days, digest only.
  assert.deepEqual(await api.tokens(manager.id), [], "no credentials initially");
  for (const [target, status, code] of [[viewer.id, 409, "token_not_allowed"], [pending.id, 409, "token_not_allowed"], [retired.id, 409, "token_not_allowed"], ["usr_doesnotexist0", 404, "account_not_found"]]) {
    const response = await api.owner("/api/users/" + target + "/mcp-tokens", { method: "POST", body: { label: "Fictional refused" } });
    assert.equal(response.status, status, "credential issuance refused for an ineligible target"); assert.equal(codeOf(response), code);
  }
  for (const body of [{ label: "x", expiresAt: "2099-01-01T00:00:00.000Z" }, { label: "x", expiresInDays: 365 }, { label: "x", role: "owner" }, { label: "x", userId: viewer.id }, { label: "x", scope: "admin" },
    { label: "" }, { label: "   " }, { label: "x".repeat(65) }, { label: "bad\nlabel" }, { label: 5 }, {}, []]) {
    assert.equal((await api.owner("/api/users/" + manager.id + "/mcp-tokens", { method: "POST", body })).status, 422, "credential input cannot choose expiry, role, user or scope");
  }
  const first = await api.issue(manager.id, "Fictional laptop");
  assert.deepEqual(first.keys, ["secret", "token"], "issuance returns metadata and one secret");
  assert.deepEqual(Object.keys(first.meta).sort(), ["createdAt", "expiresAt", "id", "label"]);
  assert.equal(Date.parse(first.meta.expiresAt) - Date.parse(first.meta.createdAt), NINETY_DAYS, "lifetime is exactly 90 days");
  assert.ok(MANAGER_SECRET.test(first.secret), "credential has the recognizable stm_ prefix and length");
  assert.ok(first.secret !== ownerToken && !first.secret.includes(ownerToken.slice(0, 16)), "credential is unrelated to the owner secret");
  const viaCookie = await api.as(ownerCookie, "/api/users/" + manager.id + "/mcp-tokens", { method: "POST", body: { label: "Fictional phone" } });
  check(viaCookie, 201, "owner cookie issuance"); remember(viaCookie.body.secret);
  assert.equal((await api.as(ownerCookie, "/api/users/" + manager.id + "/mcp-tokens", { method: "POST", body: { label: "x" }, headers: { Origin: undefined } })).status, 403, "cookie issuance requires same-origin");
  const listing = await api.tokens(manager.id);
  assert.equal(listing.length, 2);
  for (const token of listing) { assert.deepEqual(Object.keys(token).sort(), TOKEN_KEYS, "credential metadata fields"); assert.equal(token.revokedAt, null); assert.equal(token.lastUsedAt, null); }
  assert.ok(!JSON.stringify(listing).includes(first.secret) && !JSON.stringify(listing).includes(viaCookie.body.secret), "listing never contains secrets");
  const storedRow = runtime.db.prepare("SELECT * FROM mcp_tokens WHERE id=?").get(first.id);
  assert.ok(storedRow.token_hash === sha256(first.secret), "only the SHA-256 digest is stored");
  assert.ok(!databaseText(runtime.db).includes(first.secret) && !databaseText(runtime.db).includes(viaCookie.body.secret), "no table contains a plaintext credential");
  console.log("Credential issuance: owner-only, eligible targets only, fixed 90-day lifetime, strict { label } input, one-time secret and digest-only storage passed.");

  // ---------------------------------------------------------------------------------------------
  // Manager MCP: six tools, all operations, both directions with HTTP.
  const mgr = await mcpSession(runtime.url, first.secret);
  const tools = (await mgr.sdk.listTools()).tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), SIX_TOOLS, "exactly the six content tools, no administrative tools");
  const hints = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
  assert.deepEqual(hints.export_trip, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  assert.deepEqual(hints.import_trip, { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const mcpList = (await mgr.tool("list_trips", {})).data.trips.map((trip) => trip.id);
  for (const id of [alpha.id, beta.id, gamma.id, delta.id]) assert.ok(mcpList.includes(id), "MCP lists every trip");
  assert.equal((await mgr.tool("get_trip", { tripId: alpha.id })).data.trip.version, alpha.version, "MCP reads the HTTP-written version");
  const mcpEdit = await mgr.tool("apply_trip_changes", { tripId: delta.id, requestId: "cm-mcp-edit", expectedVersion: delta.version, changes: [
    { type: "upsert_day", day: { id: "cm-mcp-day", date: "2032-05-06", slots: [{ id: "cm-mcp-plan", name: "Invented museum", time: "14:00" }] } },
    { type: "upsert_day", day: { id: "cm-mcp-day-2", date: "2032-05-07" } }] });
  assert.ok(!mcpEdit.isError, "manager MCP edit"); delta = mcpEdit.data.trip;
  assert.equal((await api.trip(delta.id)).days[0].slots[0].name, "Invented museum", "MCP write visible over owner HTTP");
  assert.equal(check(await api.as(managerCookie, "/api/trips/" + delta.id), 200, "manager cookie read").trip.version, delta.version, "MCP write visible over manager HTTP");
  assert.deepEqual(check(await api.owner("/api/trips"), 200, "list").trips.find((trip) => trip.id === delta.id).dateRange, { start: "2032-05-06", end: "2032-05-07" }, "date range follows days");
  delta = check(await api.as(managerCookie, "/api/trips/" + delta.id + "/changes", { method: "POST", body: { requestId: "cm-web-after-mcp", expectedVersion: delta.version, changes: [{ type: "update_trip", fields: { shortName: "Delta web" } }] } }), 200, "HTTP edit after MCP").trip;
  assert.equal((await mgr.tool("get_trip", { tripId: delta.id })).data.trip.shortName, "Delta web", "HTTP write visible over MCP");
  const mcpCreate = await mgr.tool("create_trip", { requestId: "cm-mcp-create", trip: { title: TITLES[4] } });
  assert.ok(!mcpCreate.isError); let epsilon = mcpCreate.data.trip;
  assert.equal((await api.trip(epsilon.id)).title, TITLES[4]);
  assert.equal((await mgr.tool("create_trip", { requestId: "cm-mcp-create", trip: { title: TITLES[4] } })).data.trip.id, epsilon.id, "durable MCP create retry");
  const mcpExport = await mgr.tool("export_trip", { tripId: alpha.id });
  assert.ok(!mcpExport.isError); assert.equal(mcpExport.data.format, "shared-trip-export");
  const mcpImport = await mgr.tool("import_trip", { requestId: "cm-mcp-import", data: mcpExport.data });
  assert.ok(!mcpImport.isError, "manager MCP import"); assert.notEqual(mcpImport.data.trip.id, alpha.id);
  assert.equal((await mgr.tool("import_trip", { requestId: "cm-mcp-import", data: mcpExport.data })).data.trip.id, mcpImport.data.trip.id, "durable MCP import retry");
  assert.equal((await mgr.tool("import_trip", { requestId: "cm-mcp-import", data: { trip: { title: "Different" } } })).data.error.code, "request_id_conflict");
  assert.equal(check(await api.as(managerCookie, "/api/trips/" + mcpImport.data.trip.id), 200, "imported trip over HTTP").trip.title, alpha.title);
  epsilon = (await mgr.tool("apply_trip_changes", { tripId: epsilon.id, requestId: "cm-mcp-archive", expectedVersion: epsilon.version, changes: [{ type: "archive_trip", archived: true }] })).data.trip;
  assert.equal((await api.trip(epsilon.id)).archived, true, "MCP archive");
  epsilon = (await mgr.tool("apply_trip_changes", { tripId: epsilon.id, requestId: "cm-mcp-unarchive", expectedVersion: epsilon.version, changes: [{ type: "archive_trip", archived: false }] })).data.trip;
  assert.equal((await api.trip(epsilon.id)).archived, false, "MCP unarchive");
  const snapshotForReplace = (await mgr.tool("get_trip", { tripId: delta.id })).data.trip;
  snapshotForReplace.shortName = "Delta replaced";
  const mcpReplace = await mgr.tool("apply_trip_changes", { tripId: delta.id, requestId: "cm-mcp-replace", expectedVersion: snapshotForReplace.version, changes: [{ type: "replace_content", trip: snapshotForReplace }] });
  assert.ok(!mcpReplace.isError, "MCP replace_content"); delta = mcpReplace.data.trip;
  const mcpDelete = await mgr.tool("apply_trip_changes", { tripId: delta.id, requestId: "cm-mcp-delete", expectedVersion: delta.version, changes: [{ type: "delete_day", dayId: "cm-mcp-day-2" }] });
  assert.ok(!mcpDelete.isError, "MCP delete"); delta = mcpDelete.data.trip;
  assert.deepEqual((await api.trip(delta.id)).days.map((day) => day.id), ["cm-mcp-day"]);
  assert.deepEqual((await mgr.tool("apply_trip_changes", { tripId: delta.id, requestId: "cm-mcp-delete", expectedVersion: mcpDelete.data.trip.version - 1, changes: [{ type: "delete_day", dayId: "cm-mcp-day-2" }] })).data, mcpDelete.data, "identical MCP retry replays");
  const mcpStale = await mgr.tool("apply_trip_changes", { tripId: delta.id, requestId: "cm-mcp-stale", expectedVersion: 1, changes: [{ type: "update_trip", fields: { shortName: "Stale" } }] });
  assert.equal(mcpStale.isError, true); assert.equal(mcpStale.data.error.code, "version_conflict");
  const mcpAtomic = await mgr.tool("apply_trip_changes", { tripId: delta.id, requestId: "cm-mcp-atomic", expectedVersion: delta.version, changes: [{ type: "update_trip", fields: { shortName: "Must roll back" } }, { type: "upsert_day", day: { id: "cm-mcp-bad", date: "2032-02-30" } }] });
  assert.equal(mcpAtomic.isError, true);
  const deltaNow = await api.trip(delta.id);
  assert.equal(deltaNow.version, delta.version); assert.equal(deltaNow.shortName, "Delta replaced", "refused MCP batch is atomic");
  await mgr.close();
  assert.ok((await api.tokens(manager.id)).find((token) => token.id === first.id).lastUsedAt !== null, "lastUsedAt is recorded for a used credential");
  console.log("Manager MCP: six tools; list/get/export/create/import/edit/delete/replace/archive/unarchive in both directions with HTTP, conflicts, atomic rollback and durable retries passed.");

  // ---------------------------------------------------------------------------------------------
  // Credential denial matrix.
  const tripsBefore = await api.tripCount();
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + first.secret }), 200, "manager credential is accepted at /mcp");
  assert.equal(await api.mcpStatus(), 401, "anonymous MCP");
  assert.equal(await api.mcpStatus({ Origin: api.base, Cookie: managerCookie }), 401, "manager browser cookie cannot use MCP");
  assert.equal(await api.mcpStatus({ Origin: api.base, Cookie: viewerCookie }), 401, "viewer cookie cannot use MCP");
  assert.equal(await api.mcpStatus({ Origin: api.base, Cookie: ownerCookie }), 401, "owner cookie cannot use MCP");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer stm_" + crypto.randomBytes(32).toString("base64url") }), 401, "unknown credential");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + managerCookie.split("=")[1] }), 401, "session value is not a credential");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + sha256(first.secret) }), 401, "digest is not a credential");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + first.secret, Origin: "https://unrelated.example.org" }), 403, "hostile origin is refused even with a credential");
  for (const [method, route, body] of [["GET", "/api/session"], ["GET", "/api/trips"], ["GET", "/api/trips/" + alpha.id], ["GET", "/api/trips/" + alpha.id + "/export"],
    ["POST", "/api/trips", { requestId: "cm-bearer-create", trip: { title: "Must not exist" } }], ["POST", "/api/import", { requestId: "cm-bearer-import", data: exported }],
    ["POST", "/api/trips/" + alpha.id + "/changes", { requestId: "cm-bearer-edit", expectedVersion: alpha.version, changes: [{ type: "archive_trip", archived: true }] }],
    ["GET", "/photos/" + photoName], ["HEAD", "/photos/" + photoName], ["GET", "/api/users"], ["GET", "/api/users/" + manager.id + "/mcp-tokens"],
    ["POST", "/api/users/" + manager.id + "/mcp-tokens", { label: "Self" }], ["POST", "/api/users/" + manager.id + "/role", { role: "content-manager" }], ["GET", "/api/audit"], ["POST", "/api/logout", {}], ["POST", "/api/invitations", {}]]) {
    const response = await api.bearer(first.secret, route, { method, body });
    assert.equal(response.status, 401, "manager credential refused at " + method + " " + route);
    if (method !== "HEAD") assert.ok(!response.text.includes(TITLES[0]) && !response.text.includes("fictional-manager-media"), "no data leaks on refusal");
  }
  assert.equal((await api.call("/api/trips", { headers: { Authorization: "Bearer " + first.secret, Cookie: managerCookie, Origin: api.base } })).status, 401, "a credential at an HTTP route never falls back to the cookie");
  assert.equal((await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token: first.secret } })).status, 401, "manager credential is not an owner login");
  assert.equal(await api.tripCount(), tripsBefore, "no refused write landed");
  assert.equal((await api.trip(alpha.id)).archived, false);
  console.log("Denial matrix: anonymous, cookies at MCP, unknown/derived bearers, hostile origin, manager credential at every HTTP route and owner login refused without fallback.");

  // ---------------------------------------------------------------------------------------------
  // Owner compatibility over MCP and HTTP.
  const ownerMcp = await mcpSession(runtime.url, ownerToken);
  assert.deepEqual((await ownerMcp.sdk.listTools()).tools.map((tool) => tool.name).sort(), SIX_TOOLS, "owner bearer has the same six tools");
  const ownerCreated = await ownerMcp.tool("create_trip", { requestId: "cm-owner-mcp", trip: { title: "Fictional Owner MCP" } });
  assert.ok(!ownerCreated.isError, "owner MCP create");
  assert.equal((await ownerMcp.tool("export_trip", { tripId: ownerCreated.data.trip.id })).data.trip.id, ownerCreated.data.trip.id);
  await ownerMcp.close();
  TITLES.push("Fictional Owner MCP");
  console.log("Owner bearer MCP and owner sessions are unchanged.");

  // ---------------------------------------------------------------------------------------------
  // Expiry with the injected clock, then explicit renewal.
  const second = await api.issue(manager.id, "Fictional tablet");
  clockOffset = Date.parse(second.meta.expiresAt) - Date.now() - 60_000;
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + second.secret }), 200, "valid shortly before the 90-day expiry");
  clockOffset = Date.parse(second.meta.expiresAt) - Date.now() + 1000;
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + second.secret }), 401, "expired after 90 days");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + first.secret }), 401, "earlier credential also expired");
  clockOffset = 0;
  const renewedOld = check(await api.owner("/api/users/" + manager.id + "/mcp-tokens/" + second.id + "/revoke", { method: "POST" }), 200, "renewal step 1: revoke");
  assert.ok(renewedOld.token.revokedAt !== null);
  const renewed = await api.issue(manager.id, "Fictional tablet renewed");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + renewed.secret }), 200, "renewal step 2: explicit replacement works");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + second.secret }), 401, "the replaced credential stays refused");
  console.log("Expiry: accepted before and refused after exactly 90 days (injected clock); renewal is explicit revoke + issue.");

  // ---------------------------------------------------------------------------------------------
  // Revocation is idempotent and scoped.
  const revokedOnce = check(await api.owner("/api/users/" + manager.id + "/mcp-tokens/" + first.id + "/revoke", { method: "POST" }), 200, "revoke credential");
  assert.deepEqual(Object.keys(revokedOnce).sort(), ["token"]); assert.deepEqual(Object.keys(revokedOnce.token).sort(), TOKEN_KEYS);
  assert.ok(revokedOnce.token.revokedAt !== null);
  const revokedTwice = check(await api.owner("/api/users/" + manager.id + "/mcp-tokens/" + first.id + "/revoke", { method: "POST" }), 200, "repeat revoke");
  assert.equal(revokedTwice.token.revokedAt, revokedOnce.token.revokedAt, "revocation is idempotent");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + first.secret }), 401, "revoked credential refused");
  assert.equal((await api.owner("/api/users/" + manager.id + "/mcp-tokens/mct_AAAAAAAAAAAAAAAA/revoke", { method: "POST" })).status, 404);
  assert.equal((await api.owner("/api/users/" + viewer.id + "/mcp-tokens/" + renewed.id + "/revoke", { method: "POST" })).status, 404, "credential IDs are scoped to their account");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + renewed.secret }), 200, "unrelated credential unaffected");
  console.log("Revocation: idempotent, account-scoped and immediate.");

  // ---------------------------------------------------------------------------------------------
  // Role changes invalidate sessions and credentials; changing back revives nothing.
  check(await api.owner("/api/users/" + manager.id + "/role", { method: "POST", body: { role: "content-manager" } }), 200, "same-role assignment");
  assert.equal((await api.as(managerCookie, "/api/session")).status, 200, "a no-op role assignment changes nothing");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + renewed.secret }), 200);
  const demoted = check(await api.owner("/api/users/" + manager.id + "/role", { method: "POST", body: { role: "viewer" } }), 200, "demote to viewer");
  assert.equal(demoted.account.role, "viewer"); assert.equal(demoted.account.status, "approved");
  assert.equal((await api.as(managerCookie, "/api/session")).status, 401, "role change invalidates browser sessions");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + renewed.secret }), 401, "role change invalidates credentials");
  assert.ok((await api.tokens(manager.id)).every((token) => token.revokedAt !== null), "role change durably revokes every credential");
  const demotedCookie = await api.login(manager, "viewer");
  assert.deepEqual(check(await api.as(demotedCookie, "/api/session"), 200, "demoted session").capabilities, CAPS_VIEWER);
  assert.equal((await api.as(demotedCookie, "/api/trips", { method: "POST", body: { requestId: "cm-demoted", trip: { title: "x" } } })).status, 403, "demoted account cannot write");
  assert.equal((await api.owner("/api/users/" + manager.id + "/mcp-tokens", { method: "POST", body: { label: "Fictional refused" } })).status, 409, "viewers cannot receive credentials");
  check(await api.owner("/api/users/" + manager.id + "/role", { method: "POST", body: { role: "content-manager" } }), 200, "promote again");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + renewed.secret }), 401, "promotion does not revive old credentials");
  assert.equal((await api.as(demotedCookie, "/api/session")).status, 401, "promotion invalidates viewer-era sessions");
  managerCookie = await api.login(manager);
  const afterPromotion = await api.issue(manager.id, "Fictional workstation");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + afterPromotion.secret }), 200, "explicitly re-issued credential works");
  console.log("Role changes invalidate sessions and credentials; reverting the role revives nothing until the owner re-issues.");

  // ---------------------------------------------------------------------------------------------
  // Account revocation and re-approval.
  check(await api.owner("/api/users/" + manager.id + "/revoke", { method: "POST" }), 200, "revoke manager account");
  for (const route of ["/api/session", "/api/trips", "/api/trips/" + alpha.id, "/photos/" + photoName]) assert.equal((await api.as(managerCookie, route)).status, 401, "revoked session refused at " + route);
  assert.equal((await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-revoked-create", trip: { title: "x" } } })).status, 401);
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + afterPromotion.secret }), 401, "revocation invalidates credentials immediately");
  assert.equal((await api.signIn(manager.username, manager.password)).status, 403, "revoked account cannot sign in");
  assert.equal((await api.owner("/api/users/" + manager.id + "/mcp-tokens", { method: "POST", body: { label: "Fictional refused" } })).status, 409, "revoked account cannot receive credentials");
  check(await api.owner("/api/users/" + manager.id + "/approve", { method: "POST" }), 200, "re-approve");
  assert.equal((await api.as(managerCookie, "/api/trips")).status, 401, "re-approval does not revive sessions");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + afterPromotion.secret }), 401, "re-approval does not revive credentials");
  assert.equal((await api.accounts()).find((account) => account.id === manager.id).role, "content-manager", "role survives revocation and re-approval");
  managerCookie = await api.login(manager);
  const durable = await api.issue(manager.id, "Fictional durable");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + durable.secret }), 200, "fresh credential after re-approval");
  console.log("Revocation invalidates sessions and credentials immediately; re-approval revives neither.");

  // ---------------------------------------------------------------------------------------------
  // Audit atomicity: a failing audit write rolls back the content write and reports failure.
  const countBefore = await api.tripCount();
  runtime.db.exec("CREATE TEMP TRIGGER cm_audit_outage BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'fictional audit outage'); END");
  const outage = await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-audit-outage", trip: { title: TITLES[5] } } });
  assert.equal(outage.status, 500, "write is not reported as accepted when its audit entry cannot be stored");
  assert.equal(codeOf(outage), "internal_error"); assert.ok(!outage.text.includes("fictional audit outage") && !outage.text.includes("    at "), "no internal details");
  assert.equal(await api.tripCount(), countBefore, "nothing committed");
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM request_log WHERE request_id='cm-audit-outage'").get().n, 0, "no retry record committed");
  runtime.db.exec("DROP TRIGGER temp.cm_audit_outage");
  const recovered = check(await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-audit-outage", trip: { title: TITLES[5] } } }), 201, "retry after outage");
  assert.equal(await api.tripCount(), countBefore + 1);
  assert.equal(check(await api.as(managerCookie, "/api/trips", { method: "POST", body: { requestId: "cm-audit-outage", trip: { title: TITLES[5] } } }), 201, "replay").trip.id, recovered.trip.id);
  console.log("Audit and content writes commit atomically; an audit failure never yields a falsely accepted write.");

  // ---------------------------------------------------------------------------------------------
  // Audit content: owner-only, payload-free, bounded queries.
  const events = await api.audit();
  for (const event of events) assert.deepEqual(Object.keys(event).sort(), EVENT_KEYS, "audit event fields");
  assert.ok(events.every((event, index) => index === 0 || events[index - 1].id > event.id), "newest first");
  const has = (label, predicate) => assert.ok(events.some(predicate), "audit records " + label);
  has("manager HTTP edit", (e) => e.action === "trip.change" && e.actor === manager.id && e.channel === "http" && e.outcome === "accepted" && e.requestId === "cm-web-edit" && e.tripId === alpha.id && Number.isInteger(e.version));
  has("identical replay", (e) => e.action === "trip.change" && e.requestId === "cm-web-edit" && e.outcome === "replayed");
  has("version conflict refusal", (e) => e.action === "trip.change" && e.requestId === "cm-web-stale" && e.outcome === "refused" && e.reason === "version_conflict");
  has("request id conflict refusal", (e) => e.outcome === "refused" && e.reason === "request_id_conflict");
  has("validation refusal", (e) => e.requestId === "cm-web-atomic" && e.outcome === "refused" && e.reason === "validation_failed");
  has("manager create", (e) => e.action === "trip.create" && e.actor === manager.id && e.tripId === gamma.id && e.version === 1);
  has("manager import", (e) => e.action === "trip.import" && e.actor === manager.id && e.tripId === importedWeb.trip.id);
  has("archive", (e) => e.action === "trip.archive" && e.actor === manager.id && e.tripId === beta.id);
  has("unarchive", (e) => e.action === "trip.unarchive" && e.actor === manager.id && e.tripId === beta.id);
  has("replace content", (e) => e.action === "trip.replace_content" && e.actor === manager.id && e.requestId === "cm-web-replace");
  has("MCP channel", (e) => e.channel === "mcp" && e.actor === manager.id && e.action === "trip.import" && e.requestId === "cm-mcp-import");
  has("owner MCP", (e) => e.channel === "mcp" && e.actor === "owner" && e.requestId === "cm-owner-mcp");
  has("role change", (e) => e.action === "account.role" && e.target === manager.id && e.role === "viewer" && e.outcome === "accepted");
  has("no-op role change", (e) => e.action === "account.role" && e.outcome === "unchanged");
  has("approval", (e) => e.action === "account.approve" && e.target === manager.id && e.outcome === "accepted");
  has("revocation", (e) => e.action === "account.revoke" && e.target === manager.id);
  has("invitation", (e) => e.action === "invitation.create" && typeof e.target === "string" && e.target.startsWith("inv_"));
  has("credential issuance", (e) => e.action === "token.issue" && e.target === first.id && e.actor === "owner");
  has("credential revocation", (e) => e.action === "token.revoke" && e.target === first.id && e.outcome === "accepted");
  has("idempotent revocation", (e) => e.action === "token.revoke" && e.target === first.id && e.outcome === "unchanged");
  has("refused issuance", (e) => e.action === "token.issue" && e.outcome === "refused" && e.reason === "token_not_allowed");
  has("expired credential", (e) => e.action === "auth.refused" && e.actor === manager.id && e.reason === "token_expired");
  has("revoked credential", (e) => e.action === "auth.refused" && e.actor === manager.id && e.reason === "token_revoked");
  has("credential at the wrong route", (e) => e.action === "auth.refused" && e.actor === manager.id && e.reason === "mcp_token_wrong_route");
  has("forbidden administration", (e) => e.action === "access.denied" && e.actor === manager.id && e.reason === "forbidden");
  const outageEvents = events.filter((e) => e.requestId === "cm-audit-outage");
  assert.equal(outageEvents.filter((e) => e.outcome === "accepted").length, 1, "the outage write was audited once, when it committed");
  assert.ok(outageEvents.every((e) => e.outcome !== "accepted" || e.tripId === recovered.trip.id), "the accepted entry names the committed trip");
  const auditText = JSON.stringify(events) + "\n" + JSON.stringify(runtime.db.prepare("SELECT * FROM audit_log").all());
  const digests = secrets.map(sha256);
  const forbiddenInAudit = [["credential, cookie, password or invitation", secrets], ["digest", digests], ["trip title or content", [...TITLES, "Fictional", "Invented", "架空"]],
    ["username", ["fictional.manager", "fictional.reader", "fictional.pending"]], ["raw URL", ["http://", "https://", "/api/", "/mcp"]], ["error stack or message", ["    at ", "Error:", "fictional audit outage", "Unexpected"]], ["password hash", ["scrypt$"]]];
  for (const [kind, values] of forbiddenInAudit) assert.ok(!values.some((value) => auditText.includes(value)), "audit contains no " + kind);
  assert.equal((await api.audit(2)).length, 2, "limit is honoured");
  assert.ok(check(await api.owner("/api/audit"), 200, "default audit page").events.length <= 100, "default page is bounded");
  for (const limit of ["0", "501", "abc", "-1", "2.5", "99999"]) assert.equal((await api.owner("/api/audit?limit=" + limit)).status, 422, "invalid limit");
  assert.equal((await api.as(ownerCookie, "/api/audit?limit=1")).status, 200, "owner cookie may read the audit");
  assert.equal((await api.bearer(durable.secret, "/api/audit")).status, 401, "manager credential cannot read the audit");
  console.log("Audit: owner-only, bounded queries, required lifecycle/content/refusal events and no payloads, titles, URLs, credentials, digests or stacks.");

  // ---------------------------------------------------------------------------------------------
  // Hash-only persistence on disk.
  const mainFile = path.join(temporary, "main", "shared-trip.sqlite");
  const diskFiles = [mainFile, mainFile + "-wal"];
  assert.ok(!fileContainsAny(diskFiles, secrets), "no credential, cookie, password, invitation token or owner secret is written to disk");
  assert.ok(!databaseText(runtime.db).includes(durable.secret), "no plaintext credential in any table");

  // ---------------------------------------------------------------------------------------------
  // Restart persistence.
  const accountsBefore = await api.accounts();
  const tokensBefore = await api.tokens(manager.id);
  const auditBefore = await api.audit();
  await stop(runtime); runtime = await start("main"); api = client(runtime.url);
  assert.deepEqual(await api.accounts(), accountsBefore, "roles and statuses persist");
  assert.deepEqual(await api.tokens(manager.id), tokensBefore, "credential metadata persists");
  assert.deepEqual((await api.audit()).map((e) => e.id), auditBefore.map((e) => e.id), "audit events persist");
  assert.equal((await api.as(managerCookie, "/api/session")).status, 401, "restart invalidates browser sessions");
  assert.equal(await api.mcpStatus({ Authorization: "Bearer " + durable.secret }), 200, "valid credential survives restart");
  for (const old of [first, second, renewed, afterPromotion]) assert.equal(await api.mcpStatus({ Authorization: "Bearer " + old.secret }), 401, "revoked credentials stay revoked after restart");
  const restarted = await mcpSession(runtime.url, durable.secret);
  const restartedEdit = await restarted.tool("apply_trip_changes", { tripId: gamma.id, requestId: "cm-after-restart", expectedVersion: (await api.trip(gamma.id)).version, changes: [{ type: "update_trip", fields: { shortName: "Gamma" } }] });
  assert.ok(!restartedEdit.isError, "manager MCP write after restart");
  await restarted.close();
  console.log("Restart: roles, credential metadata, revocations and audit persist; sessions do not.");

  // ---------------------------------------------------------------------------------------------
  // Snapshot validation and restore.
  const snapshot = path.join(temporary, "cm-backup.sqlite");
  await snapshotDatabase(mainFile, snapshot);
  validateSnapshot(snapshot);
  const restoredDir = path.join(temporary, "cm-restored");
  execFileSync(process.execPath, ["server/cli/restore.mjs", snapshot], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: restoredDir }, stdio: "pipe" });
  const restored = await start("cm-restored");
  const back = client(restored.url);
  assert.deepEqual(await back.accounts(), await api.accounts(), "accounts and roles survive restore");
  assert.deepEqual((await back.tokens(manager.id)).map((t) => [t.id, t.revokedAt]), (await api.tokens(manager.id)).map((t) => [t.id, t.revokedAt]), "credential state survives restore");
  assert.ok((await back.audit()).length > 0, "audit survives restore");
  await stop(restored);
  const tamper = (name, sql) => {
    const file = path.join(temporary, name);
    fs.copyFileSync(snapshot, file);
    const db = new DatabaseSync(file); db.exec(sql); db.close();
    return file;
  };
  assert.throws(() => validateSnapshot(tamper("bad-digest.sqlite", "UPDATE mcp_tokens SET token_hash='plaintext-not-a-digest' WHERE id=(SELECT id FROM mcp_tokens LIMIT 1)")), /Invalid credential/);
  assert.throws(() => validateSnapshot(tamper("orphan-token.sqlite", "PRAGMA foreign_keys=OFF; UPDATE mcp_tokens SET user_id='usr_missing000000' WHERE id=(SELECT id FROM mcp_tokens LIMIT 1)")), /Invalid credential/);
  assert.throws(() => validateSnapshot(tamper("bad-audit.sqlite", "UPDATE audit_log SET action='shell.exec' WHERE seq=(SELECT MAX(seq) FROM audit_log)")), /Invalid audit/);
  assert.throws(() => validateSnapshot(tamper("bad-role.sqlite", "PRAGMA ignore_check_constraints=ON; UPDATE users SET role='owner' WHERE id=(SELECT id FROM users LIMIT 1)")), /Invalid account role/);
  console.log("Snapshots: current-schema (v" + SCHEMA_VERSION + ") validation accepts live backups, restore preserves roles/credentials/audit, and tampered credentials, roles or audit rows are rejected.");

  // ---------------------------------------------------------------------------------------------
  // Fictional schema-v3 -> current schema (SCHEMA_VERSION) upgrade.
  const v3 = await start("schema-v3");
  const old = client(v3.url);
  const legacyTrip = check(await old.owner("/api/trips", { method: "POST", body: { requestId: "v3-create", trip: { title: TITLES[6] } } }), 201, "v3 create").trip;
  const legacyEdit = { requestId: "v3-edit", expectedVersion: 1, changes: [{ type: "upsert_day", day: { id: "v3-day", date: "2031-07-01", slots: [{ id: "v3-plan", name: "Invented quay", time: "10:00" }] } }] };
  const legacyResult = check(await old.owner("/api/trips/" + legacyTrip.id + "/changes", { method: "POST", body: legacyEdit }), 200, "v3 edit");
  const legacyArchived = check(await old.owner("/api/trips", { method: "POST", body: { requestId: "v3-create-b", trip: { title: "Fictional Legacy Ridge" } } }), 201, "v3 create b").trip;
  check(await old.owner("/api/trips/" + legacyArchived.id + "/changes", { method: "POST", body: { requestId: "v3-archive", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] } }), 200, "v3 archive");
  const legacyReader = await old.makeAccount("legacy.reader");
  const legacyPending = await old.makeAccount("legacy.pending", { approve: false });
  const legacyReturning = await old.makeAccount("legacy.returning");
  check(await old.owner("/api/users/" + legacyReturning.id + "/revoke", { method: "POST" }), 200, "v3 revoke");
  check(await old.owner("/api/users/" + legacyReturning.id + "/approve", { method: "POST" }), 200, "v3 re-approve");
  const legacyRevoked = await old.makeAccount("legacy.revoked");
  check(await old.owner("/api/users/" + legacyRevoked.id + "/revoke", { method: "POST" }), 200, "v3 revoke b");
  const spare = await old.invite();
  await stop(v3);
  const v3File = path.join(temporary, "schema-v3", "shared-trip.sqlite");
  const downgrade = new DatabaseSync(v3File);
  dropOAuthTablesForFixture(downgrade);
  downgrade.exec("DROP TABLE mcp_tokens; DROP TABLE audit_log; DELETE FROM sqlite_sequence WHERE name='audit_log'; ALTER TABLE users DROP COLUMN role; PRAGMA user_version=3");
  const v3Rows = (db) => JSON.stringify({
    trips: db.prepare("SELECT id,version,archived,data FROM trips ORDER BY id").all(),
    log: db.prepare("SELECT scope,request_id,fingerprint,result FROM request_log ORDER BY scope,request_id").all(),
    users: db.prepare("SELECT id,username,password_hash,status,session_epoch,invitation_id,created_at,updated_at FROM users ORDER BY id").all(),
    invitations: db.prepare("SELECT id,token_hash,created_at,expires_at,used_at,used_by FROM invitations ORDER BY id").all()
  });
  const priorRows = v3Rows(downgrade);
  assert.equal(downgrade.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name='role'").get().n, 0, "fixture is a genuine v3 users table");
  downgrade.close();
  validateSnapshot(v3File);
  const upgraded = await start("schema-v3");
  const now4 = client(upgraded.url);
  assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.ok(v3Rows(upgraded.db) === priorRows, "trips, versions, archive state, retry log, account IDs/statuses/hashes/epochs and invitations are unchanged");
  assert.ok(upgraded.db.prepare("SELECT role FROM users").all().every((row) => row.role === "viewer"), "migrated accounts default to viewer");
  const preUpgrade = () => fs.readdirSync(path.join(temporary, "schema-v3")).filter((file) => preUpgradeSnapshotPattern.test(file));
  assert.equal(preUpgrade().length, 1, "one pre-upgrade snapshot");
  const retained = new DatabaseSync(path.join(temporary, "schema-v3", preUpgrade()[0]), { readOnly: true });
  assert.equal(retained.prepare("PRAGMA user_version").get().user_version, 3); assert.ok(v3Rows(retained) === priorRows, "pre-upgrade snapshot holds the v3 data"); retained.close();
  validateSnapshot(path.join(temporary, "schema-v3", preUpgrade()[0]));
  assert.deepEqual(check(await now4.owner("/api/trips/" + legacyTrip.id + "/changes", { method: "POST", body: legacyEdit }), 200, "replay after upgrade"), legacyResult, "durable retry replays after upgrade");
  const upgradedAccounts = await now4.accounts();
  for (const account of upgradedAccounts) assert.deepEqual(Object.keys(account).sort(), ACCOUNT_KEYS);
  assert.deepEqual(Object.fromEntries(upgradedAccounts.map((a) => [a.username, a.status + "/" + a.role])),
    { "legacy.reader": "approved/viewer", "legacy.pending": "pending/viewer", "legacy.returning": "approved/viewer", "legacy.revoked": "revoked/viewer" }, "statuses preserved, roles default to viewer");
  await now4.login(legacyReader, "viewer");
  assert.equal((await now4.signIn(legacyPending.username, legacyPending.password)).status, 403, "pending stays pending");
  assert.equal((await now4.signIn(legacyRevoked.username, legacyRevoked.password)).status, 403, "revoked stays revoked");
  check(await now4.owner("/api/users/" + legacyReturning.id + "/role", { method: "POST", body: { role: "content-manager" } }), 200, "promote a migrated account");
  const legacyManagerCookie = await now4.login(legacyReturning);
  const legacyCurrent = await now4.trip(legacyTrip.id);
  check(await now4.as(legacyManagerCookie, "/api/trips/" + legacyTrip.id + "/changes", { method: "POST", body: { requestId: "upgraded-manager-edit", expectedVersion: legacyCurrent.version, changes: [{ type: "update_trip", fields: { shortName: "Legacy" } }] } }), 200, "migrated manager edits a pre-upgrade trip");
  const upgradedToken = await now4.issue(legacyReturning.id, "Fictional upgraded");
  assert.equal(await now4.mcpStatus({ Authorization: "Bearer " + upgradedToken.secret }), 200, "credentials work after upgrade");
  const password = newPassword();
  check(await now4.call("/api/accept-invite", { method: "POST", headers: { Origin: now4.base }, body: { invitation: spare.token, username: "legacy.newcomer", password } }), 201, "unused v3 invitation still redeemable");
  assert.equal((await now4.accounts()).find((a) => a.username === "legacy.newcomer").role, "viewer", "new accounts after upgrade default to viewer");
  await stop(upgraded);
  const again = await start("schema-v3");
  assert.equal(again.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.equal(preUpgrade().length, 1, "migration is idempotent and does not re-snapshot the current schema");
  assert.equal((await client(again.url).accounts()).find((a) => a.id === legacyReturning.id).role, "content-manager", "role persists across restart");
  assert.equal(await client(again.url).mcpStatus({ Authorization: "Bearer " + upgradedToken.secret }), 200, "credential persists across restart");
  const liveCurrent = path.join(temporary, "current-live.sqlite");
  await snapshotDatabase(path.join(temporary, "schema-v3", "shared-trip.sqlite"), liveCurrent);
  validateSnapshot(liveCurrent);
  await stop(again);
  const fromV3 = path.join(temporary, "restored-from-v3");
  execFileSync(process.execPath, ["server/cli/restore.mjs", path.join(temporary, "schema-v3", preUpgrade()[0])], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: fromV3 }, stdio: "pipe" });
  const restoredV3 = await start("restored-from-v3");
  assert.equal(restoredV3.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.ok(restoredV3.db.prepare("SELECT role FROM users").all().every((row) => row.role === "viewer"), "a restored v3 snapshot upgrades with viewer roles");
  assert.equal((await client(restoredV3.url).trip(legacyArchived.id)).archived, true);
  await stop(restoredV3);
  console.log("Fictional schema-v3 database upgrades to the current schema (v" + SCHEMA_VERSION + ") idempotently with a retained snapshot, preserved IDs/state/retry log and viewer defaults; v3 snapshots restore into the current schema.");

  // ---------------------------------------------------------------------------------------------
  // Bounded audit retention and field sanitation (store level).
  const retention = await start("retention");
  retention.audit.record({ actor: "owner", channel: "http", action: "trip.change", outcome: "refused", tripId: "../../outside", requestId: "has spaces and a https://example.invalid/x", reason: "Error: stack trace", target: "stm_notatarget", role: "owner", version: -1 });
  const sanitized = retention.db.prepare("SELECT * FROM audit_log ORDER BY seq DESC LIMIT 1").get();
  for (const column of ["trip_id", "request_id", "reason", "target", "role", "version"]) assert.equal(sanitized[column], null, "unsafe " + column + " is not stored");
  assert.throws(() => retention.audit.record({ actor: "owner", action: "shell.exec", outcome: "accepted" }), /Invalid audit event/);
  retention.db.exec("BEGIN");
  for (let index = 0; index < MAX_AUDIT_EVENTS + 25; index++) retention.audit.record({ actor: "owner", channel: "http", action: "invitation.create", outcome: "accepted" });
  retention.db.exec("COMMIT");
  assert.equal(retention.db.prepare("SELECT COUNT(*) AS n FROM audit_log").get().n, MAX_AUDIT_EVENTS, "audit retention is bounded");
  await stop(retention);
  console.log("Audit retention is bounded and unsafe fields are never stored.");
} finally {
  for (const sdk of sdkClients) await sdk.close().catch(() => {});
  for (const item of running.reverse()) await item.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}
