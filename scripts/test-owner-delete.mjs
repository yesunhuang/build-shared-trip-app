// Owner-only permanent trip deletion (schema v6): real HTTP requests against the actual service, the
// official MCP SDK client, the offline host-operator CLI and fictional data only.
//
// Covers: role denial over real HTTP (anonymous, viewer, content manager, pending, revoked, MCP
// credential, OAuth token, wrong bearer, no cookie fallback) and MCP (still exactly six tools, no
// deletion tool or change operation); CSRF/Origin and media-type rules; input validation; owner
// cookie and owner bearer deletion of active and archived trips; stale versions; identical and
// conflicting retries; prior create/import/change replays after deletion (410, nothing recreated);
// redacted retry records with retained fingerprints; tombstone ID collisions on import; unrelated
// trips, accounts, credentials, grants, photos and earlier backups unchanged; atomic rollback when the
// audit write fails; restart persistence; v6 snapshot validation, restore and tamper rejection;
// schema v5 -> v6 migration with a validated pre-migration snapshot and rollback copy; and the
// offline CLI (refuses while the service runs, requires and validates a new backup, deletes through
// the shared gateway on the "operator" audit channel, replays, releases ownership).
//
// Output: generic PASS labels only. Generated secrets, cookies and passwords are never printed.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { SCHEMA_VERSION, snapshotDatabase, validateSnapshot } from "../server/db.mjs";

assert.ok(SCHEMA_VERSION >= 6, "deletion tombstones need schema v6 or later");
const repoRoot = path.resolve(import.meta.dirname, "..");
const cliPath = path.join(repoRoot, "server", "cli", "delete-trip.mjs");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-owner-delete-"));
const backups = path.join(temporary, "private-backups");
const ownerToken = crypto.randomBytes(32).toString("base64url");
// Present in some CLI runs only to prove the CLI neither needs nor prints such a value.
const unusedSentinel = "Fictional-unused-" + crypto.randomBytes(24).toString("base64url");
const strayInCheckout = path.join(repoRoot, "fictional-delete-backup-must-not-exist.sqlite");
const MANAGER_USER = "fictional.planner";
const TEST_CALLBACK = "https://oauth-client.fictional.invalid/callback";
const OAUTH_COOKIE = "shared_trip_oauth";
const ACCESS_FIELD = "access_token";
const SCOPE = "trips:manage";
const SIX_TOOLS = ["apply_trip_changes", "create_trip", "export_trip", "get_trip", "import_trip", "list_trips"];
const FOREIGN_ORIGIN = "https://elsewhere.fictional.invalid";
const TITLES = { alpha: "Fictional Alder Cove", beta: "Fictional Birch Atoll", gamma: "Fictional Cedar Ridge", eps: "Fictional Elm Shoal", zeta: "Fictional Zelkova Bay",
  cli: "Fictional Juniper Strand", cliKeep: "Fictional Larch Harbor", v5a: "Fictional Maple Inlet", v5b: "Fictional Nutmeg Key" };
const PLAN = "Invented lantern pier";
const photoDir = path.join(temporary, "fictional-photos");
fs.mkdirSync(photoDir);
const photoName = "d0d0cafe12345678.webp";
fs.writeFileSync(path.join(photoDir, photoName), Buffer.from("fictional-shared-media-bytes"));
fs.mkdirSync(backups);

const secrets = [ownerToken, unusedSentinel];
const remember = (value) => { if (typeof value === "string" && value) secrets.push(value); return value; };
const newSecret = () => remember("Fictional-" + crypto.randomBytes(12).toString("base64url"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let counter = 0;
const pass = (label) => console.log("PASS " + String(++counter).padStart(2, "0") + " " + label);

const running = [];
const sdkClients = [];
const dataDirOf = (name) => path.join(temporary, name);
const configFor = (name) => ({
  ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: dataDirOf(name), SHARED_TRIP_PORT: "0", SHARED_TRIP_OAUTH_USERNAME: MANAGER_USER }),
  photoDir, oauthRedirectUris: [TEST_CALLBACK]
});
async function start(name) { const runtime = await startServer(configFor(name)); running.push(runtime); return runtime; }
async function stop(runtime) { running.splice(running.indexOf(runtime), 1); await runtime.close(); }

// ------------------------------------------------------------------------------------------------
// HTTP helpers

const errorOf = (response) => (typeof response.data?.error === "string" ? response.data.error : response.data?.error?.code ?? "none");
function expect(response, status, label, code) {
  assert.ok(response.status === status, label + " (expected " + status + ", got " + response.status + ", error " + errorOf(response) + ")");
  if (code) assert.ok(errorOf(response) === code, label + " (expected error " + code + ", got " + errorOf(response) + ")");
  return response;
}
async function call(base, route, { method = "GET", headers = {}, json, form, raw } = {}) {
  const sent = { Connection: "close", ...headers };
  let body;
  if (json !== undefined) { sent["Content-Type"] ??= "application/json"; body = JSON.stringify(json); }
  else if (form !== undefined) { sent["Content-Type"] ??= "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  else if (raw !== undefined) body = raw;
  for (const name of Object.keys(sent)) if (sent[name] === undefined) delete sent[name];
  const response = await fetch(base + route, { method, headers: sent, body, redirect: "manual" });
  const text = method === "HEAD" ? "" : await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* HTML or empty */ }
  if (/^\/(?:api|mcp)(?:\/|$)/.test(new URL(route, base).pathname)) assert.ok(response.headers.get("cache-control") === "no-store", method + " protected response must be no-store");
  return { status: response.status, headers: response.headers, data, text, cookies: response.headers.getSetCookie() };
}
const owner = (base, route, options = {}) => call(base, route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } });
const del = (base, tripId, body, headers = {}) => call(base, "/api/trips/" + encodeURIComponent(tripId), { method: "DELETE", json: body, headers });
const asOwner = (base, tripId, body) => del(base, tripId, body, { Authorization: "Bearer " + ownerToken });

async function makeAccount(base, username, { role, approve = true } = {}) {
  const invite = expect(await owner(base, "/api/invitations", { method: "POST", json: {} }), 201, "owner invitation").data.invitation;
  remember(invite.token);
  const password = newSecret();
  expect(await call(base, "/api/accept-invite", { method: "POST", headers: { Origin: base }, json: { invitation: invite.token, username, password } }), 201, "redeem invitation");
  const id = expect(await owner(base, "/api/users"), 200, "list accounts").data.accounts.find((account) => account.username === username).id;
  if (role) expect(await owner(base, "/api/users/" + id + "/role", { method: "POST", json: { role } }), 200, "assign role");
  if (approve) expect(await owner(base, "/api/users/" + id + "/approve", { method: "POST" }), 200, "approve account");
  return { id, username, password };
}
function siteLogin(base, account) {
  const { username, password } = account;
  return call(base, "/api/login", { method: "POST", headers: { Origin: base }, json: { username, password } });
}
async function siteCookie(base, account) { return remember(expect(await siteLogin(base, account), 200, "site sign-in").cookies[0].split(";")[0]); }
async function ownerCookie(base) {
  return remember(expect(await call(base, "/api/login", { method: "POST", headers: { Origin: base }, json: { token: ownerToken } }), 200, "owner sign-in").cookies[0].split(";")[0]);
}
async function createTrip(base, requestId, title) {
  return expect(await owner(base, "/api/trips", { method: "POST", json: { requestId, trip: { title } } }), 201, "create " + requestId).data.trip;
}
async function change(base, tripId, body, headers) {
  return call(base, "/api/trips/" + tripId + "/changes", { method: "POST", json: body, headers: headers ?? { Authorization: "Bearer " + ownerToken } });
}
async function auditEvents(base) { return expect(await owner(base, "/api/audit?limit=500"), 200, "owner audit").data.events; }
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fictional-probe", version: "1.0.0" } } };
async function mcpStatus(base, bearer) {
  return (await call(base, "/mcp", { method: "POST", json: initialize, headers: { Accept: "application/json, text/event-stream", Authorization: "Bearer " + bearer } })).status;
}
async function mcpSession(base, bearer) {
  const sdk = new Client({ name: "fictional-delete-probe", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + bearer } } }));
  sdkClients.push(sdk);
  return {
    sdk,
    async tool(name, args) {
      const result = await sdk.callTool({ name, arguments: args });
      let data = result.structuredContent ?? null;
      if (!data) { try { data = JSON.parse(result.content?.[0]?.text ?? "null"); } catch { data = null; } }
      return { isError: Boolean(result.isError), data };
    },
    async close() { sdkClients.splice(sdkClients.indexOf(sdk), 1); await sdk.close(); }
  };
}
function databaseText(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => JSON.stringify(db.prepare("SELECT * FROM \"" + name.replaceAll("\"", "\"\"") + "\"").all())).join("\n");
}
const parsed = (text) => { try { return JSON.parse(text); } catch { return null; } };
const ACCOUNT_TABLES = ["users", "invitations", "mcp_tokens", "oauth_clients", "oauth_grants", "oauth_codes", "oauth_tokens"];
/** Rows that a deletion of other trips must leave byte-for-byte unchanged. */
function preserved(db, keepIds) {
  return JSON.stringify({
    trips: db.prepare("SELECT * FROM trips ORDER BY id").all().filter((row) => keepIds.includes(row.id)),
    log: db.prepare("SELECT * FROM request_log ORDER BY scope,request_id").all().filter((row) => keepIds.some((id) => row.scope === "trip:" + id) ||
      (["create", "import"].includes(row.scope) && keepIds.includes(parsed(row.result)?.trip?.id))),
    ...Object.fromEntries(ACCOUNT_TABLES.map((table) => [table, db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()]))
  });
}
const photoState = () => JSON.stringify(fs.readdirSync(photoDir).sort().map((name) => [name, sha256(fs.readFileSync(path.join(photoDir, name)))]));
const fileHash = (file) => sha256(fs.readFileSync(file));
const logRow = (db, scope, requestId) => db.prepare("SELECT fingerprint,result FROM request_log WHERE scope=? AND request_id=?").get(scope, requestId);
const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;

// ------------------------------------------------------------------------------------------------
// OAuth helpers (fictional client, explicit sign-in and consent; redirects are never followed)

function pkce() {
  const verifier = remember(crypto.randomBytes(32).toString("base64url"));
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}
function transactionCookie(response) {
  for (const header of response.cookies) {
    const pair = header.split(";")[0];
    if (pair.startsWith(OAUTH_COOKIE + "=") && pair.length > OAUTH_COOKIE.length + 1) return remember(pair);
  }
  return null;
}
const csrfOf = (html) => remember(/name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(html || "")?.[1]) || null;
async function oauthAccess(base, clientId, account) {
  const keys = pkce();
  const state = "fictional-" + crypto.randomBytes(6).toString("hex");
  const query = new URLSearchParams([["response_type", "code"], ["client_id", clientId], ["redirect_uri", TEST_CALLBACK], ["scope", SCOPE], ["state", state],
    ["code_challenge", keys.challenge], ["code_challenge_method", "S256"], ["resource", base + "/mcp"]]).toString();
  const page = expect(await call(base, "/oauth/authorize?" + query), 200, "authorization page");
  let at = { cookie: transactionCookie(page), csrf: csrfOf(page.text) };
  const { username, password } = account;
  const signed = expect(await call(base, "/oauth/authorize/login", { method: "POST", form: [["csrf", at.csrf], ["username", username], ["password", password]], headers: { Origin: base, Cookie: at.cookie ?? undefined } }), 200, "OAuth sign-in");
  at = { cookie: transactionCookie(signed) ?? at.cookie, csrf: csrfOf(signed.text) ?? at.csrf };
  const decided = expect(await call(base, "/oauth/authorize/decision", { method: "POST", form: [["csrf", at.csrf], ["decision", "allow"]], headers: { Origin: base, Cookie: at.cookie ?? undefined } }), 303, "OAuth consent");
  const code = remember(new URL(decided.headers.get("location")).searchParams.get("code"));
  const issued = expect(await call(base, "/oauth/token", { method: "POST", form: [["grant_type", "authorization_code"], ["code", code], ["redirect_uri", TEST_CALLBACK], ["client_id", clientId],
    ["code_verifier", keys.verifier], ["resource", base + "/mcp"]] }), 200, "OAuth code exchange");
  return remember(issued.data[ACCESS_FIELD]);
}

// ------------------------------------------------------------------------------------------------
// Offline CLI helper

function runCli(dataDir, args, { withSentinel = true } = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^SHARED_TRIP_/i.test(key)) delete env[key];
  if (dataDir !== null) env.SHARED_TRIP_DATA_DIR = dataDir;
  if (withSentinel) env.SHARED_TRIP_ADMIN_TOKEN = unusedSentinel;
  const out = spawnSync(process.execPath, [cliPath, ...args], { cwd: repoRoot, env, encoding: "utf8", timeout: 120_000 });
  const text = (out.stdout || "") + (out.stderr || "");
  assert.ok(!secrets.some((value) => text.includes(value)), "CLI output never contains a credential, cookie or sentinel value");
  assert.ok(!Object.values(TITLES).some((title) => text.includes(title)) && !text.includes(PLAN), "CLI output never contains trip content");
  assert.ok(!text.includes(temporary) && !text.includes(repoRoot), "CLI output never prints filesystem paths");
  // Node's own runtime warnings (for example an experimental-feature notice) are not CLI output.
  const own = text.split(/\r?\n/).filter((line) => line && !/^\(node:\d+\) |^\(Use `node /.test(line));
  assert.ok(own.length <= 2, "CLI output is a short fixed message");
  return { status: out.status, stdout: out.stdout || "", stderr: out.stderr || "", text };
}

let runtime = await start("main");
let base = runtime.url;
const mainFile = path.join(dataDirOf("main"), "shared-trip.sqlite");
try {
  // ---------------------------------------------------------------------------------------------
  // Fictional fixtures.
  let alpha = await createTrip(base, "fx-create-alpha", TITLES.alpha);
  const alphaEdit = { requestId: "fx-edit-alpha", expectedVersion: 1, changes: [{ type: "upsert_day", day: { id: "fx-day-1", date: "2031-05-02", slots: [{ id: "fx-plan-1", name: PLAN, time: "09:30" }] } }] };
  alpha = expect(await change(base, alpha.id, alphaEdit), 200, "alpha edit").data.trip;
  assert.equal(alpha.version, 2);
  let beta = await createTrip(base, "fx-create-beta", TITLES.beta);
  const betaArchive = { requestId: "fx-archive-beta", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] };
  beta = expect(await change(base, beta.id, betaArchive), 200, "beta archive").data.trip;
  assert.ok(beta.archived === true && beta.version === 2, "beta is archived");
  let gamma = await createTrip(base, "fx-create-gamma", TITLES.gamma);
  const manager = await makeAccount(base, MANAGER_USER, { role: "content-manager" });
  const viewer = await makeAccount(base, "fictional.reader");
  const waiting = await makeAccount(base, "fictional.waiting", { approve: false });
  const former = await makeAccount(base, "fictional.former");
  const managerSite = await siteCookie(base, manager);
  const viewerSite = await siteCookie(base, viewer);
  const formerSite = await siteCookie(base, former);
  expect(await owner(base, "/api/users/" + former.id + "/revoke", { method: "POST" }), 200, "revoke former account");
  const ownerSite = await ownerCookie(base);
  const managerToken = remember(expect(await owner(base, "/api/users/" + manager.id + "/mcp-tokens", { method: "POST", json: { label: "Fictional planner" } }), 201, "issue manager MCP token").data.secret);
  const clientId = expect(await call(base, "/oauth/register", { method: "POST", json: { redirect_uris: [TEST_CALLBACK] } }), 201, "register fictional OAuth client").data.client_id;
  const oauthToken = await oauthAccess(base, clientId, manager);
  // Managers keep their existing archive/restore authority (no regression).
  const managerHeaders = { Cookie: managerSite, Origin: base };
  gamma = expect(await change(base, gamma.id, { requestId: "fx-mgr-archive-gamma", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] }, managerHeaders), 200, "manager archives").data.trip;
  gamma = expect(await change(base, gamma.id, { requestId: "fx-mgr-restore-gamma", expectedVersion: 2, changes: [{ type: "archive_trip", archived: false }] }, managerHeaders), 200, "manager restores").data.trip;
  assert.ok(gamma.version === 3 && gamma.archived === false);
  pass("fixtures: active, archived and unrelated fictional trips, viewer/manager/pending/revoked accounts, an MCP token and an OAuth grant; managers still archive and restore");

  // ---------------------------------------------------------------------------------------------
  // 1. Only the owner may delete, over real HTTP.
  const alphaBody = { requestId: "fx-delete-alpha", expectedVersion: 2 };
  expect(await del(base, alpha.id, alphaBody, { Origin: base }), 401, "anonymous", "unauthorized");
  expect(await del(base, alpha.id, alphaBody, { Cookie: viewerSite, Origin: base }), 403, "viewer session", "forbidden");
  expect(await del(base, alpha.id, alphaBody, { Cookie: managerSite, Origin: base }), 403, "content-manager session", "forbidden");
  expect(await siteLogin(base, waiting), 403, "pending account cannot sign in", "access_denied");
  expect(await del(base, alpha.id, alphaBody, { Cookie: formerSite, Origin: base }), 401, "revoked account's earlier session", "unauthorized");
  expect(await del(base, alpha.id, alphaBody, { Authorization: "Bearer " + managerToken }), 401, "content-manager MCP token off /mcp", "unauthorized");
  expect(await del(base, alpha.id, alphaBody, { Authorization: "Bearer " + oauthToken }), 401, "OAuth access token off /mcp", "unauthorized");
  expect(await del(base, alpha.id, alphaBody, { Authorization: "Bearer " + newSecret() + "-wrong" }), 401, "wrong bearer", "unauthorized");
  expect(await del(base, alpha.id, alphaBody, { Authorization: "Bearer " + managerToken, Cookie: ownerSite, Origin: base }), 401, "non-owner bearer never falls back to the owner cookie", "unauthorized");
  expect(await del(base, alpha.id, alphaBody, { Authorization: "Bearer " + newSecret(), Cookie: ownerSite, Origin: base }), 401, "wrong bearer never falls back to the owner cookie", "unauthorized");
  const denied = await auditEvents(base);
  for (const [actor, reason, action] of [[manager.id, "forbidden", "access.denied"], [viewer.id, "forbidden", "access.denied"], [manager.id, "mcp_token_wrong_route", "auth.refused"], [manager.id, "oauth_token_wrong_route", "auth.refused"]]) {
    assert.ok(denied.some((event) => event.actor === actor && event.action === action && event.reason === reason && event.outcome === "refused"), "audited refusal " + action + "/" + reason);
  }
  pass("anonymous 401, viewer/manager sessions 403, pending cannot sign in, revoked session 401, MCP and OAuth credentials keep the 401 wrong-route behavior, no cookie fallback; refusals audited");

  // MCP stays exactly six content tools for every bearer, with no deletion tool or change operation.
  for (const bearer of [ownerToken, managerToken, oauthToken]) {
    const session = await mcpSession(base, bearer);
    assert.deepEqual((await session.sdk.listTools()).tools.map((tool) => tool.name).sort(), SIX_TOOLS, "six MCP tools");
    let refused = false;
    try { refused = Boolean((await session.sdk.callTool({ name: "delete_trip", arguments: { tripId: alpha.id, requestId: "fx-mcp-delete", expectedVersion: 2 } })).isError); }
    catch { refused = true; }
    assert.ok(refused, "an MCP delete_trip call is refused");
    let changeRefused = false;
    try { changeRefused = (await session.tool("apply_trip_changes", { tripId: alpha.id, requestId: "fx-mcp-change-delete", expectedVersion: 2, changes: [{ type: "delete_trip" }] })).isError; }
    catch { changeRefused = true; } // SDK versions report input-validation failures either way
    assert.ok(changeRefused, "no delete_trip change operation");
    await session.close();
  }
  assert.equal(expect(await owner(base, "/api/trips/" + alpha.id), 200, "alpha still readable").data.trip.version, 2);
  assert.equal(count(runtime.db, "SELECT COUNT(*) AS n FROM trip_tombstones"), 0, "no tombstone after refusals");
  assert.equal(count(runtime.db, "SELECT COUNT(*) AS n FROM request_log WHERE scope='delete'"), 0, "no deletion retry record after refusals");
  pass("MCP for owner bearer, manager token and OAuth lists exactly the six tools; delete_trip tool and change operation are refused; nothing was deleted");

  // 2. CSRF / Origin and media type.
  expect(await del(base, alpha.id, alphaBody, { Cookie: ownerSite }), 403, "owner cookie without Origin", "forbidden_origin");
  expect(await del(base, alpha.id, alphaBody, { Cookie: ownerSite, Origin: FOREIGN_ORIGIN }), 403, "owner cookie with a foreign Origin", "forbidden_origin");
  expect(await del(base, alpha.id, alphaBody, { Authorization: "Bearer " + ownerToken, Origin: FOREIGN_ORIGIN }), 403, "owner bearer with a foreign Origin", "forbidden_origin");
  expect(await call(base, "/api/trips/" + alpha.id, { method: "DELETE", raw: JSON.stringify(alphaBody), headers: { Authorization: "Bearer " + ownerToken, "Content-Type": "text/plain" } }), 415, "non-JSON body", "unsupported_media_type");
  expect(await call(base, "/api/trips/" + alpha.id, { method: "DELETE", raw: JSON.stringify(alphaBody), headers: { Cookie: ownerSite, Origin: base, "Content-Type": "text/plain" } }), 415, "non-JSON body from the owner session", "unsupported_media_type");
  pass("owner-cookie deletion requires the same Origin; foreign Origins are refused for every credential; JSON only");

  // 3. Input validation, unknown trips and stale versions.
  for (const [body, label] of [[[], "array body"], ["text", "string body"], [{}, "empty body"], [{ requestId: "fx-bad-1" }, "missing version"],
    [{ requestId: "fx-bad-2", expectedVersion: 0 }, "zero version"], [{ requestId: "fx-bad-3", expectedVersion: "2" }, "string version"], [{ requestId: "fx-bad-4", expectedVersion: 2.5 }, "fractional version"],
    [{ requestId: "fx-bad-5", expectedVersion: 2 ** 53 }, "unsafe version"], [{ expectedVersion: 2 }, "missing requestId"], [{ requestId: "has spaces", expectedVersion: 2 }, "invalid requestId"],
    [{ requestId: "fx-bad-6", expectedVersion: 2, force: true }, "unknown field"], [{ requestId: "fx-bad-7", expectedVersion: 3, tripId: gamma.id }, "tripId in the body"]]) {
    expect(await asOwner(base, alpha.id, body), 422, label, "validation_failed");
  }
  expect(await asOwner(base, "trip-fictional-missing", { requestId: "fx-missing", expectedVersion: 1 }), 404, "unknown trip", "trip_not_found");
  expect(await call(base, "/api/trips/%E0%A4%A", { method: "DELETE", json: { requestId: "fx-escape", expectedVersion: 1 }, headers: { Authorization: "Bearer " + ownerToken } }), 404, "malformed path escape", "trip_not_found");
  expect(await asOwner(base, alpha.id, { requestId: "fx-big", expectedVersion: 2, pad: "x".repeat(9000) }), 413, "oversized body", "payload_too_large");
  const stale = expect(await asOwner(base, alpha.id, { requestId: "fx-stale", expectedVersion: 1 }), 409, "stale expectedVersion", "version_conflict");
  assert.equal(stale.data.error.currentVersion, 2, "conflict reports the current version");
  assert.equal(expect(await owner(base, "/api/trips/" + gamma.id), 200, "gamma intact").data.trip.version, 3);
  assert.ok(count(runtime.db, "SELECT COUNT(*) AS n FROM trip_tombstones") === 0 && count(runtime.db, "SELECT COUNT(*) AS n FROM request_log WHERE scope='delete'") === 0, "rejected input stored nothing");
  pass("invalid bodies, versions, request IDs, extra fields and body tripId are 422; unknown trips 404; oversized 413; stale version 409 with currentVersion; nothing stored");

  // ---------------------------------------------------------------------------------------------
  // Baseline before any deletion: an existing private backup, unrelated rows and the shared photo store.
  const backupBefore = path.join(backups, "before-delete.sqlite");
  await snapshotDatabase(mainFile, backupBefore);
  const backupHash = fileHash(backupBefore);
  const keptBefore = preserved(runtime.db, [gamma.id]);
  const photosBefore = photoState();
  const fingerprints = Object.fromEntries([["create", "fx-create-alpha"], ["trip:" + alpha.id, "fx-edit-alpha"], ["create", "fx-create-beta"], ["trip:" + beta.id, "fx-archive-beta"]]
    .map(([scope, requestId]) => [scope + "|" + requestId, logRow(runtime.db, scope, requestId).fingerprint]));

  // 4. Owner cookie deletes the active trip.
  const deleted = expect(await del(base, alpha.id, alphaBody, { Cookie: ownerSite, Origin: base }), 200, "owner cookie deletes the active trip").data;
  assert.deepEqual(deleted, { deleted: true, tripId: alpha.id, version: 2 }, "minimal success body");
  expect(await owner(base, "/api/trips/" + alpha.id), 410, "deleted trip read", "trip_deleted");
  expect(await owner(base, "/api/trips/" + alpha.id + "/export"), 410, "deleted trip export", "trip_deleted");
  expect(await call(base, "/api/trips/" + alpha.id, { headers: { Cookie: viewerSite } }), 410, "viewer read of the deleted trip", "trip_deleted");
  assert.ok(!expect(await owner(base, "/api/trips"), 200, "list").data.trips.some((trip) => trip.id === alpha.id), "deleted trip is not listed");
  const tombstone = runtime.db.prepare("SELECT * FROM trip_tombstones WHERE id=?").get(alpha.id);
  assert.deepEqual(Object.keys(tombstone).sort(), ["deleted_at", "deleted_version", "id"], "tombstone holds no content columns");
  assert.ok(tombstone.deleted_version === 2 && Number.isFinite(Date.parse(tombstone.deleted_at)), "tombstone records the deleted version and time");
  for (const [scope, requestId] of [["create", "fx-create-alpha"], ["trip:" + alpha.id, "fx-edit-alpha"]]) {
    const row = logRow(runtime.db, scope, requestId);
    assert.equal(row.fingerprint, fingerprints[scope + "|" + requestId], "retry fingerprint retained");
    assert.deepEqual(JSON.parse(row.result), { deletedTrip: { tripId: alpha.id, version: 2 } }, "retry result redacted to deletion metadata");
  }
  assert.deepEqual(JSON.parse(logRow(runtime.db, "delete", "fx-delete-alpha").result), deleted, "deletion retry record is minimal");
  const afterText = databaseText(runtime.db);
  assert.ok(!afterText.includes(TITLES.alpha) && !afterText.includes(PLAN) && !afterText.includes("fx-plan-1"), "no table still holds the deleted trip's content");
  pass("owner cookie deletes an active trip: 200 {deleted, tripId, version}; reads/exports 410; payload-free tombstone; retry results redacted with fingerprints retained");

  // Retries, conflicts and stale replays.
  assert.deepEqual(expect(await asOwner(base, alpha.id, alphaBody), 200, "identical replay via the owner bearer").data, deleted, "replay returns the original minimal success");
  assert.deepEqual(expect(await del(base, alpha.id, alphaBody, { Cookie: ownerSite, Origin: base }), 200, "identical replay via the owner session").data, deleted);
  expect(await asOwner(base, alpha.id, { requestId: "fx-delete-alpha", expectedVersion: 1 }), 409, "reused request ID, different version", "request_id_conflict");
  expect(await asOwner(base, gamma.id, { requestId: "fx-delete-alpha", expectedVersion: 3 }), 409, "reused request ID, different trip", "request_id_conflict");
  assert.equal(expect(await owner(base, "/api/trips/" + gamma.id), 200, "gamma untouched by the conflicting reuse").data.trip.version, 3);
  expect(await asOwner(base, alpha.id, { requestId: "fx-delete-alpha-again", expectedVersion: 2 }), 410, "new deletion of a deleted trip", "trip_deleted");
  expect(await change(base, alpha.id, { requestId: "fx-late-edit", expectedVersion: 2, changes: [{ type: "update_trip", fields: { shortName: "Late" } }] }), 410, "stale edit after deletion", "trip_deleted");
  expect(await change(base, alpha.id, { requestId: "fx-late-edit-mgr", expectedVersion: 2, changes: [{ type: "update_trip", fields: { shortName: "Late" } }] }, managerHeaders), 410, "manager edit after deletion", "trip_deleted");
  const tripCount = expect(await owner(base, "/api/trips"), 200, "list").data.trips.length;
  expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "fx-create-alpha", trip: { title: TITLES.alpha } } }), 410, "prior create replay", "trip_deleted");
  expect(await call(base, "/api/trips", { method: "POST", json: { requestId: "fx-create-alpha", trip: { title: TITLES.alpha } }, headers: managerHeaders }), 410, "prior create replay by a manager", "trip_deleted");
  expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "fx-create-alpha", trip: { title: "Fictional Different" } } }), 409, "prior create ID with a different payload", "request_id_conflict");
  expect(await change(base, alpha.id, alphaEdit), 410, "prior change replay", "trip_deleted");
  expect(await change(base, alpha.id, { ...alphaEdit, expectedVersion: 5 }), 409, "prior change ID with a different payload", "request_id_conflict");
  assert.equal(expect(await owner(base, "/api/trips"), 200, "list").data.trips.length, tripCount, "no replay recreated a trip");
  const events = await auditEvents(base);
  const has = (label, test) => assert.ok(events.some(test), "audit: " + label);
  has("accepted deletion", (e) => e.action === "trip.delete" && e.outcome === "accepted" && e.actor === "owner" && e.channel === "http" && e.tripId === alpha.id && e.version === 2 && e.requestId === "fx-delete-alpha");
  has("replayed deletion", (e) => e.action === "trip.delete" && e.outcome === "replayed" && e.tripId === alpha.id && e.requestId === "fx-delete-alpha");
  has("conflicting reuse", (e) => e.action === "trip.delete" && e.outcome === "refused" && e.reason === "request_id_conflict");
  has("deleted target", (e) => e.action === "trip.delete" && e.outcome === "refused" && e.reason === "trip_deleted");
  has("stale create replay", (e) => e.action === "trip.create" && e.outcome === "refused" && e.reason === "trip_deleted" && e.requestId === "fx-create-alpha");
  has("stale validation", (e) => e.action === "trip.delete" && e.outcome === "refused" && e.reason === "version_conflict" && e.requestId === "fx-stale");
  const auditText = JSON.stringify(events) + JSON.stringify(runtime.db.prepare("SELECT * FROM audit_log").all());
  assert.ok(!Object.values(TITLES).some((title) => auditText.includes(title)) && !auditText.includes(PLAN) && !secrets.some((value) => auditText.includes(value)), "audit is payload- and secret-free");
  pass("identical retries replay 200; reused IDs with other payloads 409; deleted targets, stale edits and prior create/change replays 410 without recreating; audit is payload-free");

  // 5. Owner bearer deletes an archived trip.
  assert.deepEqual(expect(await asOwner(base, beta.id, { requestId: "fx-delete-beta", expectedVersion: 2 }), 200, "owner bearer deletes the archived trip").data, { deleted: true, tripId: beta.id, version: 2 });
  expect(await owner(base, "/api/trips/" + beta.id), 410, "archived trip gone", "trip_deleted");
  expect(await change(base, beta.id, betaArchive), 410, "prior archive replay", "trip_deleted");
  expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "fx-create-beta", trip: { title: TITLES.beta } } }), 410, "prior create replay", "trip_deleted");
  assert.equal(logRow(runtime.db, "trip:" + beta.id, "fx-archive-beta").fingerprint, fingerprints["trip:" + beta.id + "|fx-archive-beta"]);
  pass("owner bearer deletes an archived trip; its archive and create replays return 410");

  // 6. Imports never reuse a deleted (tombstoned) stable ID.
  const epsData = { trip: { id: "fictional-elm-shoal", title: TITLES.eps } };
  const eps = expect(await owner(base, "/api/import", { method: "POST", json: { requestId: "fx-import-eps", data: epsData } }), 201, "import with an available preferred ID").data.trip;
  assert.equal(eps.id, "fictional-elm-shoal", "available preferred ID kept");
  const epsExport = expect(await owner(base, "/api/trips/" + eps.id + "/export"), 200, "export before deletion").data;
  expect(await asOwner(base, eps.id, { requestId: "fx-delete-eps", expectedVersion: eps.version }), 200, "delete imported trip");
  expect(await owner(base, "/api/import", { method: "POST", json: { requestId: "fx-import-eps", data: epsData } }), 410, "prior import replay", "trip_deleted");
  const again = expect(await owner(base, "/api/import", { method: "POST", json: { requestId: "fx-import-eps-2", data: epsData } }), 201, "new import of the same data").data;
  assert.ok(again.trip.id !== eps.id && again.warnings.some((warning) => /unavailable/.test(warning)), "tombstoned preferred ID gets a fresh ID with the collision warning");
  const fromExport = expect(await owner(base, "/api/import", { method: "POST", json: { requestId: "fx-import-eps-3", data: epsExport } }), 201, "re-import of the old export").data;
  assert.ok(fromExport.trip.id !== eps.id, "export re-import does not resurrect the deleted ID");
  expect(await owner(base, "/api/trips/" + eps.id), 410, "deleted ID stays deleted", "trip_deleted");
  assert.equal(count(runtime.db, "SELECT COUNT(*) AS n FROM trips WHERE id=?", eps.id), 0);
  pass("tombstoned IDs block reuse: prior import replay 410, new imports and export re-imports get fresh IDs with a warning");

  // 7. Unrelated data, shared photos and earlier backups are unchanged.
  assert.ok(preserved(runtime.db, [gamma.id]) === keptBefore, "unrelated trip, its retry records, accounts, MCP tokens and OAuth rows unchanged");
  assert.ok(photoState() === photosBefore, "shared photo store untouched");
  expect(await call(base, "/photos/" + photoName, { headers: { Cookie: viewerSite } }), 200, "shared photo still served");
  assert.ok(fileHash(backupBefore) === backupHash, "existing private backup untouched");
  validateSnapshot(backupBefore);
  const retainedBackup = new DatabaseSync(backupBefore, { readOnly: true });
  assert.equal(count(retainedBackup, "SELECT COUNT(*) AS n FROM trips WHERE id=?", alpha.id), 1, "offline backups still contain the deleted trip (documented)");
  retainedBackup.close();
  pass("unrelated trips, retry records, accounts, credentials, grants, shared photos and earlier backups unchanged; older backups still hold deleted content");

  // 8. Audit failure rolls the whole deletion back.
  const zeta = await createTrip(base, "fx-create-zeta", TITLES.zeta);
  const zetaRow = () => JSON.stringify(runtime.db.prepare("SELECT * FROM trips WHERE id=?").get(zeta.id));
  const allLog = () => JSON.stringify(runtime.db.prepare("SELECT * FROM request_log ORDER BY scope,request_id").all());
  const zetaBefore = zetaRow(); const logBefore = allLog();
  runtime.db.exec("CREATE TRIGGER fx_fail_delete_audit BEFORE INSERT ON audit_log WHEN NEW.action='trip.delete' AND NEW.outcome='accepted' BEGIN SELECT RAISE(ABORT,'fictional audit failure'); END");
  const failed = expect(await asOwner(base, zeta.id, { requestId: "fx-delete-zeta", expectedVersion: 1 }), 500, "audit failure", "internal_error");
  assert.ok(!failed.text.includes("fictional audit failure"), "no internal detail leaks");
  assert.ok(zetaRow() === zetaBefore && allLog() === logBefore, "trip row and every retry record rolled back");
  assert.equal(count(runtime.db, "SELECT COUNT(*) AS n FROM trip_tombstones WHERE id=?", zeta.id), 0, "no tombstone after rollback");
  runtime.db.exec("DROP TRIGGER fx_fail_delete_audit");
  assert.ok((await auditEvents(base)).some((e) => e.action === "trip.delete" && e.outcome === "refused" && e.reason === "internal_error" && e.requestId === "fx-delete-zeta"), "failed attempt audited as refused");
  expect(await owner(base, "/api/trips/" + zeta.id), 200, "trip still readable after rollback");
  assert.deepEqual(expect(await asOwner(base, zeta.id, { requestId: "fx-delete-zeta", expectedVersion: 1 }), 200, "same request succeeds after the fault").data, { deleted: true, tripId: zeta.id, version: 1 });
  pass("an audit write failure rolls back the deletion, tombstone and redaction atomically; the identical request later succeeds");

  // 9. Restart persistence.
  await stop(runtime);
  runtime = await start("main");
  base = runtime.url;
  for (const id of [alpha.id, beta.id, eps.id, zeta.id]) expect(await owner(base, "/api/trips/" + id), 410, "deleted after restart", "trip_deleted");
  assert.deepEqual(expect(await asOwner(base, alpha.id, alphaBody), 200, "replay after restart").data, deleted);
  expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "fx-create-alpha", trip: { title: TITLES.alpha } } }), 410, "stale create replay after restart", "trip_deleted");
  assert.equal(expect(await owner(base, "/api/trips/" + gamma.id), 200, "unrelated trip after restart").data.trip.title, TITLES.gamma);
  assert.equal(count(runtime.db, "SELECT COUNT(*) AS n FROM trip_tombstones"), 4);
  assert.equal(await mcpStatus(base, managerToken), 200, "manager MCP token still works");
  expect(await siteLogin(base, manager), 200, "manager still signs in");
  assert.ok((await auditEvents(base)).some((e) => e.action === "trip.delete" && e.outcome === "accepted" && e.tripId === alpha.id), "audit persisted");
  pass("tombstones, redacted retries, replays, unrelated data, credentials and audit persist across restart");

  // 10. v6 snapshots validate, restore and reject tampering.
  const v6Snapshot = path.join(backups, "after-delete.sqlite");
  await snapshotDatabase(mainFile, v6Snapshot);
  validateSnapshot(v6Snapshot);
  execFileSync(process.execPath, ["server/cli/restore.mjs", v6Snapshot], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: dataDirOf("restored") }, stdio: "pipe" });
  const restored = await start("restored");
  expect(await owner(restored.url, "/api/trips/" + alpha.id), 410, "restored tombstone", "trip_deleted");
  const reimport = expect(await owner(restored.url, "/api/import", { method: "POST", json: { requestId: "fx-restored-import", data: { trip: { id: alpha.id, title: "Fictional Restored Probe" } } } }), 201, "import after restore").data;
  assert.notEqual(reimport.trip.id, alpha.id, "restored tombstone still blocks the ID");
  await stop(restored);
  const tamper = (name, sql, ...args) => { const file = path.join(temporary, name); fs.copyFileSync(v6Snapshot, file); const db = new DatabaseSync(file); if (args.length) db.prepare(sql).run(...args); else db.exec(sql); db.close(); return file; };
  assert.throws(() => validateSnapshot(tamper("t-live.sqlite", "INSERT INTO trips SELECT ?, version, archived, json_set(data,'$.id',?) FROM trips WHERE id=?", alpha.id, alpha.id, gamma.id)), /Invalid trip tombstone/);
  assert.throws(() => validateSnapshot(tamper("t-version.sqlite", "PRAGMA ignore_check_constraints=ON; UPDATE trip_tombstones SET deleted_version=0")), /Invalid trip tombstone/);
  assert.throws(() => validateSnapshot(tamper("t-time.sqlite", "UPDATE trip_tombstones SET deleted_at='not a time'")), /Invalid trip tombstone/);
  assert.throws(() => validateSnapshot(tamper("t-id.sqlite", "UPDATE trip_tombstones SET id='../bad id' WHERE id=?", zeta.id)), /Invalid trip tombstone/);
  assert.throws(() => validateSnapshot(tamper("t-unredacted.sqlite", "UPDATE request_log SET result=? WHERE scope='create' AND request_id='fx-create-alpha'", JSON.stringify({ trip: { id: alpha.id, title: "Fictional Leak" } }))), /Unredacted retry record/);
  assert.throws(() => validateSnapshot(tamper("t-change.sqlite", "UPDATE request_log SET result='{\"trip\":{}}' WHERE scope=?", "trip:" + alpha.id)), /Unredacted retry record/);
  assert.throws(() => validateSnapshot(tamper("t-channel.sqlite", "UPDATE audit_log SET channel='carrier' WHERE seq=(SELECT MAX(seq) FROM audit_log)")), /Invalid audit event/);
  pass("v6 snapshots validate and restore with tombstones; live/invalid tombstones, unredacted retry records and unknown audit channels are rejected");

  // ---------------------------------------------------------------------------------------------
  // 11. Fictional schema-v5 database -> v6.
  const v5 = await start("schema-v5");
  const v5a = await createTrip(v5.url, "v5-create-a", TITLES.v5a);
  const v5Edit = { requestId: "v5-edit-a", expectedVersion: 1, changes: [{ type: "upsert_day", day: { id: "v5-day", date: "2031-09-01", slots: [{ id: "v5-plan", name: "Invented tide gauge", time: "08:00" }] } }] };
  const v5EditResult = expect(await change(v5.url, v5a.id, v5Edit), 200, "v5 edit").data;
  const v5b = await createTrip(v5.url, "v5-create-b", TITLES.v5b);
  expect(await change(v5.url, v5b.id, { requestId: "v5-archive-b", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] }), 200, "v5 archive");
  const v5Manager = await makeAccount(v5.url, "fictional.v5.editor", { role: "content-manager" });
  await makeAccount(v5.url, "fictional.v5.waiting", { approve: false });
  const v5Token = remember(expect(await owner(v5.url, "/api/users/" + v5Manager.id + "/mcp-tokens", { method: "POST", json: { label: "Fictional v5" } }), 201, "v5 MCP token").data.secret);
  expect(await owner(v5.url, "/api/invitations", { method: "POST", json: {} }), 201, "v5 spare invitation");
  await stop(v5);
  const v5Dir = dataDirOf("schema-v5");
  const v5File = path.join(v5Dir, "shared-trip.sqlite");
  const downgrade = new DatabaseSync(v5File);
  downgrade.exec("DROP TABLE trip_tombstones; PRAGMA user_version=5");
  const V5_TABLES = ["trips", "request_log", "users", "invitations", "mcp_tokens", "audit_log", ...ACCOUNT_TABLES.filter((table) => table.startsWith("oauth_"))];
  const v5Rows = (db) => JSON.stringify(V5_TABLES.map((table) => db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()));
  const hasTombstoneTable = (db) => count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='trip_tombstones'") === 1;
  const priorRows = v5Rows(downgrade);
  assert.ok(!hasTombstoneTable(downgrade), "fixture is a genuine v5 schema");
  downgrade.close();
  validateSnapshot(v5File);
  const upgraded = await start("schema-v5");
  assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION);
  assert.ok(v5Rows(upgraded.db) === priorRows, "every v5 row (trips, retry log, accounts, invitations, MCP tokens, audit, OAuth) is unchanged");
  assert.ok(hasTombstoneTable(upgraded.db) && count(upgraded.db, "SELECT COUNT(*) AS n FROM trip_tombstones") === 0, "tombstone table starts empty");
  const preV6 = () => fs.readdirSync(v5Dir).filter((file) => new RegExp("^shared-trip\\.sqlite\\.before-v" + SCHEMA_VERSION + "-\\d+$").test(file));
  assert.equal(preV6().length, 1, "one pre-migration snapshot");
  const retainedV5 = path.join(v5Dir, preV6()[0]);
  const retained = new DatabaseSync(retainedV5, { readOnly: true });
  assert.ok(retained.prepare("PRAGMA user_version").get().user_version === 5 && v5Rows(retained) === priorRows && !hasTombstoneTable(retained), "pre-migration snapshot holds the exact v5 data");
  retained.close();
  validateSnapshot(retainedV5);
  assert.deepEqual(expect(await change(upgraded.url, v5a.id, v5Edit), 200, "v5 retry after upgrade").data, v5EditResult, "durable retry replays after upgrade");
  assert.equal(await mcpStatus(upgraded.url, v5Token), 200, "v5 MCP token still works");
  expect(await asOwner(upgraded.url, v5a.id, { requestId: "v5-delete-a", expectedVersion: 2 }), 200, "delete a migrated trip");
  expect(await change(upgraded.url, v5a.id, v5Edit), 410, "migrated retry record redacted", "trip_deleted");
  await stop(upgraded);
  const v5Again = await start("schema-v5");
  assert.ok(v5Again.db.prepare("PRAGMA user_version").get().user_version === SCHEMA_VERSION && preV6().length === 1, "migration is idempotent and does not re-snapshot");
  expect(await owner(v5Again.url, "/api/trips/" + v5a.id), 410, "deletion persists after the upgraded restart", "trip_deleted");
  await stop(v5Again);
  // Rollback: the retained v5 copy is complete and untouched, including the trip deleted after the upgrade.
  const rollbackDir = path.join(temporary, "rollback-v5"); fs.mkdirSync(rollbackDir);
  fs.copyFileSync(retainedV5, path.join(rollbackDir, "shared-trip.sqlite"));
  const rolledBack = new DatabaseSync(path.join(rollbackDir, "shared-trip.sqlite"), { readOnly: true });
  assert.ok(rolledBack.prepare("PRAGMA user_version").get().user_version === 5 && v5Rows(rolledBack) === priorRows && !hasTombstoneTable(rolledBack), "rollback copy is the untouched v5 database");
  rolledBack.close();
  validateSnapshot(path.join(rollbackDir, "shared-trip.sqlite"));
  execFileSync(process.execPath, ["server/cli/restore.mjs", retainedV5], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: dataDirOf("restored-from-v5") }, stdio: "pipe" });
  const restoredV5 = await start("restored-from-v5");
  assert.ok(restoredV5.db.prepare("PRAGMA user_version").get().user_version === SCHEMA_VERSION && v5Rows(restoredV5.db) === priorRows, "a restored v5 snapshot upgrades with every row preserved");
  expect(await owner(restoredV5.url, "/api/trips/" + v5a.id), 200, "the pre-upgrade snapshot predates the deletion");
  await stop(restoredV5);
  const brokenDir = path.join(temporary, "broken-v5"); fs.mkdirSync(brokenDir);
  fs.copyFileSync(retainedV5, path.join(brokenDir, "shared-trip.sqlite"));
  const broken = new DatabaseSync(path.join(brokenDir, "shared-trip.sqlite"));
  broken.exec("UPDATE mcp_tokens SET token_hash='not-a-digest'"); broken.close();
  await assert.rejects(start("broken-v5"), /Pre-migration snapshot failed validation/);
  const untouched = new DatabaseSync(path.join(brokenDir, "shared-trip.sqlite"), { readOnly: true });
  assert.ok(untouched.prepare("PRAGMA user_version").get().user_version === 5 && !hasTombstoneTable(untouched), "a failed snapshot validation leaves the database at v5");
  untouched.close();
  pass("schema v5 -> v6: additive and idempotent, rows unchanged, validated pre-migration snapshot, untouched rollback copy, restorable, invalid snapshot blocks the upgrade");

  // ---------------------------------------------------------------------------------------------
  // 12. Offline host-operator CLI.
  const cliDir = dataDirOf("cli-data");
  const service = await start("cli-data");
  let cliTrip = await createTrip(service.url, "cli-create", TITLES.cli);
  cliTrip = expect(await change(service.url, cliTrip.id, { requestId: "cli-edit", expectedVersion: 1, changes: [{ type: "update_trip", fields: { shortName: "Juniper" } }] }), 200, "cli fixture edit").data.trip;
  const cliKeep = await createTrip(service.url, "cli-create-keep", TITLES.cliKeep);
  const backupA = path.join(backups, "cli-a.sqlite");
  const busy = runCli(cliDir, [cliTrip.id, "2", "fx-cli-delete", backupA]);
  assert.ok(busy.status === 1 && /in use/.test(busy.stderr), "refuses while the service owns the data directory");
  assert.ok(!fs.existsSync(backupA), "no backup written while refused");
  assert.equal(expect(await owner(service.url, "/api/trips/" + cliTrip.id), 200, "trip intact while refused").data.trip.version, 2);
  await stop(service);
  pass("CLI refuses while the service runs (data-directory lock) and writes nothing");

  assert.equal(runCli(cliDir, [cliTrip.id, "2", "fx-cli-delete"]).status, 2, "usage: too few arguments");
  assert.equal(runCli(cliDir, [cliTrip.id, "02", "fx-cli-delete", backupA]).status, 2, "usage: non-canonical version");
  assert.equal(runCli(cliDir, [cliTrip.id, "two", "fx-cli-delete", backupA]).status, 2, "usage: non-numeric version");
  assert.equal(runCli(cliDir, [cliTrip.id, "2", "bad id", backupA]).status, 2, "usage: invalid request ID");
  assert.equal(runCli(null, [cliTrip.id, "2", "fx-cli-delete", backupA]).status, 2, "usage: no data directory");
  const missingDir = path.join(temporary, "no-such-data");
  assert.ok(runCli(missingDir, [cliTrip.id, "2", "fx-cli-delete", backupA]).status === 1 && !fs.existsSync(missingDir), "a missing data directory is refused, not created");
  const occupied = path.join(backups, "occupied.sqlite"); fs.writeFileSync(occupied, "fictional existing file");
  assert.ok(runCli(cliDir, [cliTrip.id, "2", "fx-cli-delete", occupied]).status === 1 && fs.readFileSync(occupied, "utf8") === "fictional existing file", "an existing backup file is never overwritten");
  assert.ok(runCli(cliDir, [cliTrip.id, "2", "fx-cli-delete", strayInCheckout]).status === 1 && !fs.existsSync(strayInCheckout), "a backup inside the checkout is refused");
  assert.ok(!fs.existsSync(backupA), "no refused run wrote a backup");
  const backupStale = path.join(backups, "cli-stale.sqlite");
  const staleRun = runCli(cliDir, [cliTrip.id, "1", "fx-cli-stale", backupStale]);
  assert.ok(staleRun.status === 1 && /expected version does not match/.test(staleRun.stderr) && /current version 2/.test(staleRun.stderr), "exact version check");
  validateSnapshot(backupStale);
  const peek = (file, sql, ...args) => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare(sql).get(...args); } finally { db.close(); } };
  const cliFile = path.join(cliDir, "shared-trip.sqlite");
  assert.equal(peek(cliFile, "SELECT version FROM trips WHERE id=?", cliTrip.id).version, 2, "stale run deleted nothing");
  pass("CLI validates arguments, data directory and new-backup path before any change; a stale version writes a validated backup and deletes nothing");

  const done = runCli(cliDir, [cliTrip.id, "2", "fx-cli-delete", backupA], { withSentinel: false });
  assert.ok(done.status === 0 && /^Trip deleted permanently \(deleted version 2\)/.test(done.stdout), "CLI deletes without any owner credential in its environment");
  validateSnapshot(backupA);
  assert.equal(peek(backupA, "SELECT COUNT(*) AS n FROM trips WHERE id=?", cliTrip.id).n, 1, "the pre-deletion backup contains the trip");
  assert.equal(peek(cliFile, "SELECT COUNT(*) AS n FROM trips WHERE id=?", cliTrip.id).n, 0, "trip removed");
  assert.equal(peek(cliFile, "SELECT deleted_version FROM trip_tombstones WHERE id=?", cliTrip.id).deleted_version, 2, "tombstone written");
  assert.deepEqual(JSON.parse(peek(cliFile, "SELECT result FROM request_log WHERE scope='create' AND request_id='cli-create'").result), { deletedTrip: { tripId: cliTrip.id, version: 2 } }, "create retry redacted");
  const operatorEvent = peek(cliFile, "SELECT actor,channel,action,outcome,trip_id,request_id,version FROM audit_log WHERE action='trip.delete' ORDER BY seq DESC LIMIT 1");
  assert.deepEqual({ ...operatorEvent }, { actor: "operator", channel: "operator", action: "trip.delete", outcome: "accepted", trip_id: cliTrip.id, request_id: "fx-cli-delete", version: 2 }, "audited as a host-operator action");
  assert.ok(!fs.existsSync(path.join(cliDir, "server.lock")), "ownership marker removed on exit");
  const replayRun = runCli(cliDir, [cliTrip.id, "2", "fx-cli-delete", path.join(backups, "cli-b.sqlite")]);
  assert.ok(replayRun.status === 0 && /^Already deleted by this request ID/.test(replayRun.stdout), "identical rerun replays");
  assert.equal(peek(cliFile, "SELECT outcome FROM audit_log WHERE action='trip.delete' ORDER BY seq DESC LIMIT 1").outcome, "replayed");
  const reuse = runCli(cliDir, [cliTrip.id, "3", "fx-cli-delete", path.join(backups, "cli-c.sqlite")]);
  assert.ok(reuse.status === 1 && /already used/.test(reuse.stderr), "reused request ID with a different version is refused");
  const other = runCli(cliDir, [cliTrip.id, "2", "fx-cli-other", path.join(backups, "cli-d.sqlite")]);
  assert.ok(other.status === 1 && /already deleted/.test(other.stderr), "a new request for a deleted trip is refused");
  const unknown = runCli(cliDir, ["trip-fictional-none", "1", "fx-cli-unknown", path.join(backups, "cli-e.sqlite")]);
  assert.ok(unknown.status === 1 && /no trip has that ID/.test(unknown.stderr), "unknown trip refused");
  pass("CLI writes and validates a new backup, deletes through the shared gateway as actor/channel operator, replays identical reruns, refuses conflicts; fixed safe output");

  const after = await start("cli-data");
  expect(await owner(after.url, "/api/trips/" + cliTrip.id), 410, "service sees the offline deletion", "trip_deleted");
  assert.deepEqual(expect(await asOwner(after.url, cliTrip.id, { requestId: "fx-cli-delete", expectedVersion: 2 }), 200, "HTTP replay of the CLI request").data, { deleted: true, tripId: cliTrip.id, version: 2 }, "web and CLI share one retry record");
  assert.equal(expect(await owner(after.url, "/api/trips/" + cliKeep.id), 200, "unrelated trip after the CLI").data.trip.title, TITLES.cliKeep);
  await stop(after);
  pass("the service starts after the CLI (ownership released), sees the deletion, and replays the same request over HTTP");

  // The CLI applies a pending v5 -> v6 migration (with its own validated snapshot) after its explicit backup.
  const cliV5 = dataDirOf("cli-v5"); fs.mkdirSync(cliV5);
  fs.copyFileSync(retainedV5, path.join(cliV5, "shared-trip.sqlite"));
  const v5Backup = path.join(backups, "cli-v5.sqlite");
  const migrated = runCli(cliV5, [v5b.id, "2", "fx-cli-v5", v5Backup]);
  assert.ok(migrated.status === 0 && /^Trip deleted permanently/.test(migrated.stdout), "CLI deletes an archived trip in a v5 database");
  assert.equal(peek(v5Backup, "PRAGMA user_version").user_version, 5, "explicit backup taken before the migration");
  assert.equal(peek(path.join(cliV5, "shared-trip.sqlite"), "PRAGMA user_version").user_version, SCHEMA_VERSION);
  assert.ok(fs.readdirSync(cliV5).some((file) => /^shared-trip\.sqlite\.before-v\d+-\d+$/.test(file)), "automatic pre-migration snapshot retained");
  assert.equal(peek(path.join(cliV5, "shared-trip.sqlite"), "SELECT COUNT(*) AS n FROM trip_tombstones WHERE id=?", v5b.id).n, 1);
  pass("CLI on a v5 database: explicit v5 backup, automatic validated migration snapshot, then the archived trip is deleted");
} finally {
  for (const sdk of sdkClients) await sdk.close().catch(() => {});
  for (const item of running.reverse()) await item.close().catch(() => {});
  fs.rmSync(strayInCheckout, { force: true });
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log("Owner deletion checks passed.");
