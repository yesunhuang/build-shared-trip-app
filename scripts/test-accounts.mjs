// Owner-managed viewer accounts: real HTTP requests against the actual service with fictional data.
// Covers unauthenticated, pending, approved read-only, revoked-active-session and owner paths, MCP
// refusal, invitations (single use, expiry), logout, protected media and cache headers, rate
// limits, the default <dataDir>/photos media store, the referrer policy, schema v2 -> v4 upgrade and
// backup/restore preservation of account state.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { snapshotDatabase, validateSnapshot } from "../server/db.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-accounts-"));
const token = crypto.randomBytes(32).toString("base64url");
const photoDir = path.join(temporary, "fictional-photos");
fs.mkdirSync(photoDir);
const photoBytes = Buffer.from("fictional-image-bytes-for-access-tests");
fs.writeFileSync(path.join(photoDir, "a1b2c3d4e5f60718.webp"), photoBytes);
const configFor = (name) => ({ ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: path.join(temporary, name), SHARED_TRIP_PORT: "0" }), photoDir });
const running = [];
async function start(name) { const runtime = await startServer(configFor(name)); running.push(runtime); return runtime; }
async function stop(runtime) { running.splice(running.indexOf(runtime), 1); await runtime.close(); }
const newSecret = () => "Fictional-" + crypto.randomBytes(12).toString("base64url");
const PROTECTED = /^\/(?:api|mcp|photos|attachments)(?:\/|$)/i;

function client(base) {
  async function call(route, { method = "GET", body, headers = {} } = {}) {
    const sent = Object.fromEntries(Object.entries({ ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }).filter(([, value]) => value !== undefined));
    const response = await fetch(base + route, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = method === "HEAD" ? "" : await response.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON static body */ }
    const pathname = new URL(route, base).pathname;
    if (PROTECTED.test(pathname) && pathname !== "/photos/manifest.js") assert.equal(response.headers.get("cache-control"), "no-store", method + " " + route + " must be no-store (status " + response.status + ")");
    return { status: response.status, headers: response.headers, body: json, text };
  }
  const origin = { Origin: base };
  return {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + token, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
    signIn: (username, password, headers = origin) => call("/api/login", { method: "POST", headers, body: { username, password } }),
    accept: (invitation, username, password, headers = origin) => call("/api/accept-invite", { method: "POST", headers, body: { invitation, username, password } }),
    invite: async (hours) => {
      const response = await call("/api/invitations", { method: "POST", headers: { Authorization: "Bearer " + token }, body: hours === undefined ? {} : { expiresInHours: hours } });
      assert.equal(response.status, 201, JSON.stringify(response.body)); return response.body.invitation;
    },
    raw: (route, { method = "GET", headers = {} } = {}) => new Promise((resolve, reject) => {
      const target = new URL(base);
      const request = http.request({ host: target.hostname, port: target.port, method, path: route, headers }, (response) => {
        const chunks = []; response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString("utf8") }));
      });
      request.on("error", reject); request.end();
    })
  };
}
const cookieOf = (response) => (response.headers.get("set-cookie") || "").split(";")[0];
function expect(response, status, label) { assert.equal(response.status, status, label + ": " + response.text.slice(0, 300)); return response.body; }
function expectCookie(response, status, label) { expect(response, status, label); return cookieOf(response); }

let runtime = await start("main");
let api = client(runtime.url);
try {
  // Fictional content: one active trip with a day, plan and reminder, and one archived trip.
  let harbor = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "acct-harbor", trip: { title: "Fictional Harbor Loop" } } }), 201, "create").trip;
  harbor = expect(await api.owner("/api/trips/" + harbor.id + "/changes", { method: "POST", body: { requestId: "acct-harbor-day", expectedVersion: 1, changes: [
    { type: "upsert_day", day: { id: "acct-day", date: "2031-04-02", slots: [{ id: "acct-plan", name: "Invented lighthouse walk", time: "10:00" }] } },
    { type: "upsert_reminder", reminder: { id: "acct-todo", item: "Invented ferry pass", done: false } }] } }), 200, "seed").trip;
  let meadow = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "acct-meadow", trip: { title: "Fictional Meadow Rest" } } }), 201, "create b").trip;
  meadow = expect(await api.owner("/api/trips/" + meadow.id + "/changes", { method: "POST", body: { requestId: "acct-meadow-archive", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] } }), 200, "archive").trip;

  // --- Unauthenticated access ---
  for (const [method, route] of [["GET", "/api/trips"], ["GET", "/api/trips/" + harbor.id], ["GET", "/api/trips/" + harbor.id + "/export"], ["GET", "/api/users"], ["GET", "/api/session"],
    ["POST", "/api/invitations"], ["POST", "/api/import"], ["GET", "/photos/a1b2c3d4e5f60718.webp"], ["HEAD", "/photos/a1b2c3d4e5f60718.webp"], ["GET", "/attachments/fictional.pdf"], ["POST", "/mcp"]]) {
    const response = await api.call(route, { method, headers: { Origin: api.base }, body: method === "POST" ? {} : undefined });
    assert.equal(response.status, 401, method + " " + route + " requires authentication");
    if (method !== "HEAD") assert.ok(!response.text.includes(harbor.title) && !response.text.includes("fictional-image-bytes"));
  }
  for (const route of ["/PHOTOS/a1b2c3d4e5f60718.webp", "/%70hotos/a1b2c3d4e5f60718.webp", "/photos/a1b2c3d4e5f60718.webp.", "/Attachments/x", "/photos/..%2F..%2Fpackage.json"]) {
    const response = await api.raw(route);
    assert.equal(response.status, 401, route + " variant must not bypass media protection");
    assert.equal(response.headers["cache-control"], "no-store");
  }
  assert.equal((await api.call("/photos/manifest.js")).status, 200, "generic photo manifest code stays public");
  assert.equal((await api.call("/icons/icon-192.png")).status, 200, "generic icons stay public");
  console.log("Unauthenticated API, MCP and protected media requests (including path variants) are refused with no-store responses; generic icons and code remain public.");

  // --- Invitations ---
  const ownerLogin = await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token } });
  expect(ownerLogin, 200, "owner token login"); const ownerCookie = cookieOf(ownerLogin);
  assert.equal(ownerLogin.body.role, "owner");
  const ownerSession = expect(await api.as(ownerCookie, "/api/session"), 200, "owner session");
  assert.deepEqual(ownerSession.capabilities, { readTrips: true, exportTrips: true, editTrips: true, importTrips: true, manageAccounts: true, mcp: false });
  assert.equal((await api.as(ownerCookie, "/api/invitations", { method: "POST", body: {}, headers: { Origin: undefined } })).status, 403, "cookie writes require same-origin");
  const cookieInvite = expect(await api.as(ownerCookie, "/api/invitations", { method: "POST", body: { expiresInHours: 2 } }), 201, "owner cookie invitation").invitation;
  for (const hours of [0, 1000, "2", 1.5]) assert.equal((await api.owner("/api/invitations", { method: "POST", body: { expiresInHours: hours } })).status, 422, "invalid expiry " + hours);
  const first = await api.invite();
  assert.match(first.token, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(first.token, token); assert.ok(!first.token.includes(token.slice(0, 16)));
  assert.ok(Math.abs(Date.parse(first.expiresAt) - Date.now() - 72 * 3_600_000) < 60_000, "default expiry is 72 hours");
  const listing = expect(await api.owner("/api/users"), 200, "list");
  assert.ok(listing.invitations.some((item) => item.id === first.id) && listing.invitations.some((item) => item.id === cookieInvite.id));
  assert.ok(!JSON.stringify(listing).includes(first.token) && !JSON.stringify(listing).includes(cookieInvite.token), "invitation tokens are never listed");
  for (const item of listing.invitations) assert.deepEqual(Object.keys(item).sort(), ["createdAt", "expiresAt", "id"], "no token or digest fields");
  const stored = runtime.db.prepare("SELECT token_hash FROM invitations WHERE id=?").get(first.id).token_hash;
  assert.equal(stored, crypto.createHash("sha256").update(first.token).digest("hex"), "only a digest is stored");

  const viewerSecret = newSecret();
  assert.equal((await api.accept(first.token, "fictional.viewer", viewerSecret, {})).status, 403, "accept-invite requires an Origin");
  assert.equal((await api.accept(first.token, "fictional.viewer", viewerSecret, { Origin: "https://unrelated.example.org" })).status, 403, "hostile origin");
  const wrong = await api.accept(crypto.randomBytes(32).toString("base64url"), "fictional.viewer", viewerSecret);
  assert.equal(wrong.status, 403); assert.equal(wrong.body.error.code, "invitation_invalid");
  assert.equal((await api.accept(first.token, "No Spaces!", viewerSecret)).status, 422, "bounded username");
  assert.equal((await api.accept(first.token, "fictional.viewer", "short")).status, 422, "minimum password length");
  assert.equal((await api.accept(first.token, "fictional.viewer", "x".repeat(129))).status, 422, "maximum password length");
  const accepted = expect(await api.accept(first.token, "Fictional.Viewer", viewerSecret), 201, "redeem");
  assert.deepEqual(accepted, { account: { username: "fictional.viewer", status: "pending" } });
  assert.ok(!JSON.stringify(accepted).includes(viewerSecret));
  const reused = await api.accept(first.token, "another.viewer", newSecret());
  assert.equal(reused.status, 403, "invitations are single use"); assert.ok(!reused.text.includes(first.token));
  const expiring = await api.invite(1);
  runtime.db.prepare("UPDATE invitations SET expires_at=? WHERE id=?").run(Date.now() - 1000, expiring.id);
  assert.equal((await api.accept(expiring.token, "late.viewer", newSecret())).status, 403, "expired invitations are refused");
  const second = await api.invite();
  assert.equal((await api.accept(second.token, "fictional.viewer", newSecret())).status, 409, "duplicate username");
  expect(await api.accept(second.token, "second.viewer", viewerSecret), 201, "a failed duplicate does not consume the invitation");
  const third = await api.invite();
  const thirdSecret = newSecret();
  expect(await api.accept(third.token, "third.viewer", thirdSecret), 201, "third account");
  const hashes = runtime.db.prepare("SELECT username,password_hash FROM users ORDER BY username").all();
  for (const row of hashes) { assert.match(row.password_hash, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{86}$/); assert.ok(!row.password_hash.includes(viewerSecret)); }
  assert.notEqual(hashes.find((r) => r.username === "fictional.viewer").password_hash, hashes.find((r) => r.username === "second.viewer").password_hash, "random salts");
  console.log("Invitations: owner-only creation, token returned once and stored as a digest, same-origin redemption, bounded inputs, single use, expiry, duplicate-name handling and salted scrypt hashes passed.");

  // --- Pending accounts get generic access errors and no session ---
  const list = async () => expect(await api.owner("/api/users"), 200, "list").accounts;
  const idOf = async (username) => (await list()).find((account) => account.username === username).id;
  for (const account of await list()) assert.deepEqual(Object.keys(account).sort(), ["createdAt", "id", "role", "status", "updatedAt", "username"]);
  const pending = await api.signIn("fictional.viewer", viewerSecret);
  assert.equal(pending.status, 403); assert.equal(pending.body.error.code, "access_denied"); assert.equal(pending.headers.get("set-cookie"), null);
  const badSecret = await api.signIn("fictional.viewer", viewerSecret + "x");
  const unknown = await api.signIn("nobody.here", viewerSecret);
  assert.equal(badSecret.status, 401); assert.equal(unknown.status, 401); assert.deepEqual(badSecret.body, unknown.body, "unknown and wrong-password failures are identical");
  assert.ok(!badSecret.text.includes(viewerSecret));
  assert.equal((await api.signIn("fictional.viewer", viewerSecret, {})).status, 403, "viewer login requires same-origin");
  assert.equal((await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token, username: "fictional.viewer" } })).status, 401, "mixed login forms are refused");
  console.log("Pending accounts: generic 403 without a session; wrong and unknown sign-ins are indistinguishable.");

  // --- Approval and approved read-only viewer ---
  const viewerId = await idOf("fictional.viewer");
  assert.equal((await api.owner("/api/users/usr_doesnotexist0/approve", { method: "POST" })).status, 404);
  assert.equal((await api.owner("/api/users/" + encodeURIComponent("../x") + "/approve", { method: "POST" })).status, 404);
  assert.equal(expect(await api.owner("/api/users/" + viewerId + "/approve", { method: "POST" }), 200, "approve").account.status, "approved");
  const viewerLogin = await api.signIn("FICTIONAL.viewer", viewerSecret);
  expect(viewerLogin, 200, "approved login"); assert.equal(viewerLogin.body.role, "viewer");
  assert.match(viewerLogin.headers.get("set-cookie"), /^shared_trip_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  const viewer = cookieOf(viewerLogin);
  const session = expect(await api.as(viewer, "/api/session"), 200, "viewer session");
  assert.deepEqual(session, { authenticated: true, role: "viewer", username: "fictional.viewer", capabilities: { readTrips: true, exportTrips: true, editTrips: false, importTrips: false, manageAccounts: false, mcp: false } });
  assert.deepEqual(expect(await api.as(viewer, "/api/trips"), 200, "viewer list").trips.map((t) => t.id).sort(), [harbor.id, meadow.id].sort(), "viewers read all trips, including archived");
  assert.deepEqual(expect(await api.as(viewer, "/api/trips/" + harbor.id), 200, "viewer read").trip, expect(await api.owner("/api/trips/" + harbor.id), 200, "owner read").trip);
  const exported = expect(await api.as(viewer, "/api/trips/" + meadow.id + "/export"), 200, "viewer export");
  assert.equal(exported.format, "shared-trip-export"); assert.equal(exported.trip.archived, true);
  const media = await api.as(viewer, "/photos/a1b2c3d4e5f60718.webp");
  assert.equal(media.status, 200); assert.equal(media.headers.get("content-type"), "image/webp"); assert.equal(media.text, photoBytes.toString());
  assert.equal((await api.as(viewer, "/photos/a1b2c3d4e5f60718.webp", { method: "HEAD" })).status, 200);
  for (const route of ["/photos/missing0000000000.webp", "/attachments/fictional.pdf", "/photos/manifest.webp", "/photos/a1b2c3d4e5f60718.WEBP"]) assert.equal((await api.as(viewer, route)).status, 404, route);
  for (const route of ["/PHOTOS/a1b2c3d4e5f60718.webp", "/photos/a1b2c3d4e5f60718.webp.", "/photos/..%2Fshared-trip.sqlite", "/photos/%2e%2e/%2e%2e/server/app.mjs", "/attachments/../server/app.mjs"]) {
    const response = await api.raw(route, { headers: { Cookie: viewer } });
    assert.ok([403, 404].includes(response.status), route + " -> " + response.status); assert.ok(!response.text.includes("startServer"));
  }

  const before = expect(await api.owner("/api/trips/" + harbor.id), 200, "owner read").trip.version;
  const refusals = [
    ["POST", "/api/trips", { requestId: "viewer-create", trip: { title: "Must not exist" } }],
    ["POST", "/api/import", { requestId: "viewer-import", data: { trip: { title: "Must not exist" } } }],
    ["POST", "/api/trips/" + harbor.id + "/changes", { requestId: "viewer-edit", expectedVersion: before, changes: [{ type: "update_trip", fields: { title: "Viewer edit" } }] }],
    ["POST", "/api/trips/" + harbor.id + "/changes", { requestId: "viewer-archive", expectedVersion: before, changes: [{ type: "archive_trip", archived: true }] }],
    ["POST", "/api/invitations", {}], ["GET", "/api/users"], ["GET", "/api/users/"], ["POST", "/api/users/" + viewerId + "/approve", {}], ["POST", "/api/users/" + viewerId + "/revoke", {}],
    ["PUT", "/api/trips/" + harbor.id, {}], ["DELETE", "/api/trips/" + harbor.id], ["PATCH", "/api/trips/" + harbor.id, {}], ["HEAD", "/api/trips"], ["GET", "/api/trips/" + harbor.id + "/changes"],
    ["GET", "/api/trips/"], ["GET", "/api/trips/" + harbor.id + "/export/"], ["POST", "/api/trips/" + harbor.id + "/export", {}], ["POST", "/photos/a1b2c3d4e5f60718.webp", {}], ["DELETE", "/attachments/fictional.pdf"]
  ];
  for (const [method, route, body] of refusals) {
    const response = await api.as(viewer, route, { method, body });
    assert.equal(response.status, 403, "viewer " + method + " " + route);
    if (method !== "HEAD") assert.equal(response.body.error.code, "forbidden");
  }
  assert.equal((await api.as(viewer, "/api/trips", { method: "POST", body: { requestId: "viewer-no-origin", trip: { title: "x" } }, headers: { Origin: undefined } })).status, 403);
  const dotted = await api.raw("/api/./users", { headers: { Cookie: viewer } });
  assert.equal(dotted.status, 403, "normalized dot segments still hit the owner-only route");
  const upper = await api.raw("/API/users", { headers: { Cookie: viewer } });
  assert.equal(upper.status, 404); assert.ok(!upper.text.includes("second.viewer"));
  assert.equal(expect(await api.owner("/api/trips/" + harbor.id), 200, "owner read").trip.version, before, "no viewer write landed");
  assert.equal(expect(await api.owner("/api/trips"), 200, "owner list").trips.length, 2, "no viewer create or import landed");
  assert.equal((await list()).find((a) => a.username === "second.viewer").status, "pending", "viewer cannot approve accounts");
  console.log("Approved viewers read, export and fetch protected media, but every mutation, import, account action and method/path variant is refused at the server.");

  // --- MCP and bearer misuse ---
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fictional", version: "1.0.0" } } };
  const mcpHeaders = { Accept: "application/json, text/event-stream" };
  assert.equal((await api.as(viewer, "/mcp", { method: "POST", body: initialize, headers: mcpHeaders })).status, 401, "viewer cookie cannot use MCP");
  assert.equal((await api.as(viewer, "/mcp")).status, 401);
  assert.equal((await api.call("/mcp", { method: "POST", body: initialize, headers: { ...mcpHeaders, Authorization: "Bearer " + viewer.split("=")[1] } })).status, 401, "session value is not a bearer token");
  assert.equal((await api.as(viewer, "/mcp", { method: "POST", body: initialize, headers: { ...mcpHeaders, Authorization: "Bearer " + "f".repeat(43) } })).status, 401);
  assert.equal((await api.as(ownerCookie, "/mcp", { method: "POST", body: initialize, headers: mcpHeaders })).status, 401, "MCP still requires the admin bearer token");
  assert.equal((await api.as(viewer, "/api/trips", { headers: { Authorization: "Bearer wrong-token" } })).status, 401, "a wrong bearer token never falls back to the cookie");
  assert.equal((await api.as(viewer, "/api/trips", { headers: { Authorization: "Basic ZmljdGlvbmFsOnByb3h5" } })).status, 200, "non-bearer proxy authorization headers are ignored");
  const sdk = new Client({ name: "fictional-accounts", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(runtime.url + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + token } } }));
  assert.equal((await sdk.listTools()).tools.length, 6, "owner bearer MCP remains available");
  await sdk.close();
  console.log("MCP refuses viewer cookies, owner cookies and session-as-bearer misuse; the admin bearer token still works.");

  // --- Revocation of active sessions, independent of in-memory cleanup ---
  const secondViewerSession = expectCookie(await api.signIn("fictional.viewer", viewerSecret), 200, "second session");
  expect(await api.as(secondViewerSession, "/api/trips"), 200, "second session works");
  assert.equal(expect(await api.as(ownerCookie, "/api/users/" + viewerId + "/revoke", { method: "POST", body: {} }), 200, "revoke").account.status, "revoked");
  for (const cookie of [viewer, secondViewerSession]) for (const route of ["/api/session", "/api/trips", "/api/trips/" + harbor.id, "/api/trips/" + harbor.id + "/export", "/photos/a1b2c3d4e5f60718.webp"]) {
    const response = await api.as(cookie, route);
    assert.equal(response.status, 401, "revoked session " + route); assert.ok(!response.text.includes(harbor.title));
  }
  assert.equal((await api.signIn("fictional.viewer", viewerSecret)).status, 403, "revoked accounts cannot sign in");
  expect(await api.owner("/api/users/" + viewerId + "/approve", { method: "POST" }), 200, "re-approve");
  assert.equal((await api.as(viewer, "/api/trips")).status, 401, "re-approval does not revive sessions issued before revocation");
  const fresh = expectCookie(await api.signIn("fictional.viewer", viewerSecret), 200, "fresh login");
  const untouched = expectCookie(await api.signIn("fictional.viewer", viewerSecret), 200, "parallel login");
  expect(await api.as(fresh, "/api/trips"), 200, "fresh session");
  expect(await api.as(untouched, "/api/trips"), 200, "parallel session");
  runtime.accounts.revoke(viewerId); // Store-level revocation without the HTTP handler's in-memory session cleanup.
  assert.equal((await api.as(fresh, "/api/trips")).status, 401, "account status is checked on every request, not only via session cleanup");
  runtime.accounts.approve(viewerId); // Approve before `untouched` is used again: only the revocation epoch can reject it now.
  assert.equal((await api.as(untouched, "/api/trips")).status, 401, "the revocation epoch invalidates sessions issued before revocation");
  console.log("Revocation invalidates already-issued sessions immediately on every protected route, and re-approval requires a new sign-in.");

  // --- Logout ---
  const leaving = expectCookie(await api.signIn("fictional.viewer", viewerSecret), 200, "login before logout");
  assert.equal((await api.as(leaving, "/api/logout", { method: "POST", body: {}, headers: { Origin: undefined } })).status, 403, "logout is a same-origin write");
  const logout = expect(await api.as(leaving, "/api/logout", { method: "POST", body: {} }), 200, "logout");
  assert.deepEqual(logout, { authenticated: false });
  assert.equal((await api.as(leaving, "/api/trips")).status, 401, "logged-out session is invalid");
  console.log("Viewer logout invalidates the session.");

  // --- Static shells never embed protected data or credentials ---
  for (const route of ["/", "/login", "/home.js", "/hosted-client.js", "/hosted-bootstrap.js", "/app.js", "/trips/" + harbor.id, "/resources.html?tripId=" + harbor.id, "/service-worker.js"]) {
    const response = await api.as(viewer, route);
    assert.equal(response.status, 200, route);
    for (const secret of [token, first.token, viewerSecret, harbor.title, "fictional.viewer", "acct-plan", viewer.split("=")[1]]) assert.ok(!response.text.includes(secret), route + " must not embed protected data");
  }
  console.log("Generic shells and code contain no trip, account or credential data.");

  // --- Account state survives backup and restore; sessions do not ---
  const spare = await api.invite();
  const snapshot = path.join(temporary, "accounts-backup.sqlite");
  await snapshotDatabase(path.join(temporary, "main", "shared-trip.sqlite"), snapshot);
  validateSnapshot(snapshot);
  const restoredDir = path.join(temporary, "restored");
  execFileSync(process.execPath, ["server/cli/restore.mjs", snapshot], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: restoredDir }, stdio: "pipe" });
  const restored = await start("restored");
  const back = client(restored.url);
  const beforeAccounts = await list();
  assert.deepEqual(expect(await back.owner("/api/users"), 200, "restored list").accounts, beforeAccounts, "account IDs and statuses survive restore");
  assert.equal((await back.as(fresh, "/api/trips")).status, 401, "sessions are not part of a backup");
  expect(await back.signIn("fictional.viewer", viewerSecret), 200, "approved viewer after restore");
  assert.equal((await back.signIn("second.viewer", viewerSecret)).status, 403, "pending stays pending after restore");
  assert.equal((await back.accept(first.token, "reused.viewer", newSecret())).status, 403, "used invitation stays used after restore");
  expect(await back.accept(spare.token, "spare.viewer", newSecret()), 201, "unused invitation survives restore");
  await stop(restored);
  console.log("Backup/restore preserves accounts, statuses, hashes and invitation state; restored services require new sign-ins.");

  // --- Restart invalidates sessions; rate limits on login and invitation attempts ---
  await stop(runtime); runtime = await start("main"); api = client(runtime.url);
  assert.equal((await api.as(ownerCookie, "/api/session")).status, 401, "restart invalidates owner sessions");
  assert.equal((await api.as(fresh, "/api/session")).status, 401, "restart invalidates viewer sessions");
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await api.signIn("fictional.viewer", "Wrong-" + attempt + "-fictional")).status, 401);
  const limited = await api.signIn("fictional.viewer", viewerSecret);
  assert.equal(limited.status, 429, "login attempts are rate limited"); assert.equal(limited.headers.get("set-cookie"), null);
  assert.equal((await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token } })).status, 429, "the limit also covers owner token sign-in");
  const pendingInvite = await api.invite();
  for (let attempt = 0; attempt < 10; attempt++) assert.equal((await api.accept(crypto.randomBytes(32).toString("base64url"), "guess.viewer", newSecret())).status, 403);
  assert.equal((await api.accept(pendingInvite.token, "guess.viewer", newSecret())).status, 429, "invitation attempts are rate limited");
  expect(await api.owner("/api/trips"), 200, "bearer API access is unaffected by browser sign-in limits");
  console.log("Restart invalidates sessions; failed sign-in and invitation attempts are rate limited.");

  // --- Default private photo store <dataDir>/photos (no code-only photoDir override) ---
  const defaultConfig = readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: path.join(temporary, "default-photos"), SHARED_TRIP_PORT: "0" });
  assert.equal(defaultConfig.photoDir, undefined, "this check uses the default photo store");
  const defaultStore = path.join(defaultConfig.dataDir, "photos");
  assert.ok(!defaultStore.startsWith(fs.realpathSync(repoRoot) + path.sep), "default photo store is outside the checkout");
  const publicPhotos = path.join(repoRoot, "assets", "app-template", "public", "photos");
  assert.deepEqual(fs.readdirSync(publicPhotos).filter((file) => /\.(?:webp|png|jpe?g)$/i.test(file)), [], "no photo files in the checkout's public photo directory");
  fs.mkdirSync(defaultStore);
  const privateName = "f0e1d2c3b4a59687.webp";
  const privateBytes = Buffer.from("fictional-private-photo-in-data-dir");
  fs.writeFileSync(path.join(defaultStore, privateName), privateBytes);
  const defaults = await startServer(defaultConfig); running.push(defaults);
  const store = client(defaults.url);
  const photoRoute = "/photos/" + privateName;
  for (const method of ["GET", "HEAD"]) {
    const response = await store.call(photoRoute, { method, headers: { Origin: store.base } });
    assert.equal(response.status, 401, "unauthenticated " + method + " of a default-store photo");
    assert.ok(!response.text.includes(privateBytes.toString()));
  }
  const ownerPhoto = await store.owner(photoRoute);
  assert.equal(ownerPhoto.status, 200); assert.equal(ownerPhoto.text, privateBytes.toString(), "owner reads from <dataDir>/photos");
  const mediaInvite = await store.invite();
  const mediaSecret = newSecret();
  expect(await store.accept(mediaInvite.token, "media.viewer", mediaSecret), 201, "media viewer account");
  const mediaPending = await store.signIn("media.viewer", mediaSecret);
  assert.equal(mediaPending.status, 403, "pending account gets no session"); assert.equal(mediaPending.headers.get("set-cookie"), null);
  const mediaId = expect(await store.owner("/api/users"), 200, "media list").accounts.find((account) => account.username === "media.viewer").id;
  expect(await store.owner("/api/users/" + mediaId + "/approve", { method: "POST" }), 200, "approve media viewer");
  const mediaCookie = expectCookie(await store.signIn("media.viewer", mediaSecret), 200, "approved media viewer login");
  const viewerPhoto = await store.as(mediaCookie, photoRoute);
  assert.equal(viewerPhoto.status, 200); assert.equal(viewerPhoto.headers.get("content-type"), "image/webp"); assert.equal(viewerPhoto.text, privateBytes.toString());
  assert.equal((await store.as(mediaCookie, photoRoute, { method: "HEAD" })).status, 200);
  const manifest = await store.call("/photos/manifest.js");
  assert.equal(manifest.status, 200); assert.ok(!manifest.text.includes(privateName) && !manifest.text.includes(privateName.slice(0, 8)), "the public manifest does not list private photos");
  expect(await store.owner("/api/users/" + mediaId + "/revoke", { method: "POST" }), 200, "revoke media viewer");
  const revokedPhoto = await store.as(mediaCookie, photoRoute);
  assert.equal(revokedPhoto.status, 401, "revoked session cannot read default-store photos"); assert.ok(!revokedPhoto.text.includes(privateBytes.toString()));

  // Referrer policy: cross-origin requests (map tiles) get only the origin, never private paths.
  for (const route of ["/", "/trips/fictional-trip", "/api/session", photoRoute, "/health"]) {
    assert.equal((await store.call(route)).headers.get("referrer-policy"), "strict-origin-when-cross-origin", route + " referrer policy");
  }
  const tripShell = (await store.call("/trips/fictional-trip")).text;
  assert.ok(tripShell.includes("'https://tile.openstreetmap.org/{z}/{x}/{y}.png'"), "canonical OpenStreetMap tile URL");
  assert.ok(!/\{s\}\.tile\.openstreetmap|[abc]\.tile\.openstreetmap/.test(tripShell), "no alternate tile subdomains");
  await stop(defaults);
  console.log("Default photo store lives in <dataDir>/photos outside the checkout: unauthenticated, pending and revoked access is refused, approved viewers and the owner read it, the public manifest stays generic, and the referrer policy sends only the origin cross-origin.");

  // --- Fictional schema v2 -> v4 upgrade ---
  const v2 = await start("schema-v2");
  const old = client(v2.url);
  const v2Trip = expect(await old.owner("/api/trips", { method: "POST", body: { requestId: "v2-create", trip: { title: "Fictional Prior Coast" } } }), 201, "v2 create").trip;
  const edit = { requestId: "v2-edit", expectedVersion: 1, changes: [{ type: "upsert_day", day: { id: "v2-day", date: "2031-05-01", slots: [{ id: "v2-plan", name: "Invented pier", time: "09:30" }] } }] };
  const original = expect(await old.owner("/api/trips/" + v2Trip.id + "/changes", { method: "POST", body: edit }), 200, "v2 edit");
  const v2Archived = expect(await old.owner("/api/trips", { method: "POST", body: { requestId: "v2-create-b", trip: { title: "Fictional Prior Hills" } } }), 201, "v2 create b").trip;
  expect(await old.owner("/api/trips/" + v2Archived.id + "/changes", { method: "POST", body: { requestId: "v2-archive", expectedVersion: 1, changes: [{ type: "archive_trip", archived: true }] } }), 200, "v2 archive");
  await stop(v2);
  const v2File = path.join(temporary, "schema-v2", "shared-trip.sqlite");
  const downgrade = new DatabaseSync(v2File);
  downgrade.exec("DROP TABLE users; DROP TABLE invitations; PRAGMA user_version=2");
  const rows = (db) => JSON.stringify({ trips: db.prepare("SELECT id,version,archived,data FROM trips ORDER BY id").all(), log: db.prepare("SELECT scope,request_id,fingerprint,result FROM request_log ORDER BY scope,request_id").all() });
  const priorRows = rows(downgrade); downgrade.close();
  const upgraded = await start("schema-v2");
  const now3 = client(upgraded.url);
  assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(rows(upgraded.db), priorRows, "trip rows, IDs, versions, archive state and retry records are unchanged");
  const snapshots = () => fs.readdirSync(path.join(temporary, "schema-v2")).filter((file) => /^shared-trip\.sqlite\.before-v4-\d+$/.test(file));
  assert.equal(snapshots().length, 1);
  const preUpgrade = new DatabaseSync(path.join(temporary, "schema-v2", snapshots()[0]), { readOnly: true });
  assert.equal(preUpgrade.prepare("PRAGMA user_version").get().user_version, 2); assert.equal(rows(preUpgrade), priorRows); preUpgrade.close();
  assert.deepEqual(expect(await now3.owner("/api/trips/" + v2Trip.id + "/changes", { method: "POST", body: edit }), 200, "replay"), original, "durable retry replays after upgrade");
  assert.deepEqual(expect(await now3.owner("/api/users"), 200, "upgraded list"), { accounts: [], invitations: [] });
  const upgradeInvite = await now3.invite();
  expect(await now3.accept(upgradeInvite.token, "upgrade.viewer", viewerSecret), 201, "accounts work after upgrade");
  await stop(upgraded);
  const again = await start("schema-v2");
  assert.equal(again.db.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(snapshots().length, 1, "the migration is idempotent and does not re-snapshot a v4 database");
  assert.equal(expect(await client(again.url).owner("/api/users"), 200, "after restart").accounts[0].username, "upgrade.viewer");
  await stop(again);
  const fromOld = path.join(temporary, "restored-from-v2");
  execFileSync(process.execPath, ["server/cli/restore.mjs", path.join(temporary, "schema-v2", snapshots()[0])], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: fromOld }, stdio: "pipe" });
  const restoredOld = await start("restored-from-v2");
  assert.equal(restoredOld.db.prepare("PRAGMA user_version").get().user_version, 4);
  assert.equal(expect(await client(restoredOld.url).owner("/api/trips/" + v2Archived.id), 200, "restored v2").trip.archived, true);
  await stop(restoredOld);
  console.log("Fictional schema-v2 database upgrades to v4 idempotently with a retained pre-upgrade snapshot; a v2 snapshot restores into v4.");
} finally {
  for (const item of running.reverse()) await item.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}
