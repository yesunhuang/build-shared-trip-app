import {grantFixtureMembership} from "./fixtures/membership.mjs";
// OAuth 2.1 for the self-hosted MCP resource: real HTTP requests against the actual service, the
// official MCP SDK client (header transport and its OAuth provider flow), fictional data only.
//
// Covers: configuration; RFC 9728/8414 metadata and the /mcp challenge; RFC 7591 registration with
// exact redirect allowlisting, strict metadata, rate limiting and bounded capacity; authorization
// request validation (no redirect for unknown client/redirect, iss on every redirect); dedicated
// sign-in, CSRF, same-origin and cookie binding, explicit consent and deny; PKCE S256 only; code
// binding, one-time use, replay and expiry; access-token audience, expiry and /mcp-only use; refresh
// rotation, reuse detection and the absolute 90-day grant; replay detection that survives storage
// cleanup and restart for the grant's whole lifetime; RFC 7009 revocation; owner grant API;
// account revocation and role changes; restart persistence; digest-only storage; payload-free audit;
// schema v4 -> v5 migration, pre-migration snapshot, rollback copy, restore and tamper rejection.
//
// Output: generic PASS labels only. Generated secrets, codes, verifiers, cookies, usernames and
// URLs are never printed; assertions use booleans, statuses and OAuth/application error codes.
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
import { SCHEMA_VERSION, snapshotDatabase, validateSnapshot } from "../server/db.mjs";
import { ACCESS_TTL_MS, CODE_TTL_MS, GRANT_LIFETIME_MS, MAX_OAUTH_CLIENTS } from "../server/auth/oauth.mjs";
import { OAUTH_TRANSACTION_TTL_MS, PRODUCTION_REDIRECT_URIS } from "../server/oauth-http.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-oauth-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
const ACCESS_FIELD = "access_token";
const REFRESH_FIELD = "refresh_token";
const SCOPE = "trips:manage";
const OAUTH_COOKIE = "shared_trip_oauth";
const PRODUCTION_CALLBACK = PRODUCTION_REDIRECT_URIS[0];
const TEST_CALLBACK = "https://oauth-client.fictional.invalid/callback";
const LOOPBACK_CALLBACK = "http://127.0.0.1:9/fictional-callback"; // never contacted: redirects are not followed
const OAUTH_USER = "fictional.oauth";
const SIX_TOOLS = ["apply_trip_changes", "create_trip", "export_trip", "get_trip", "import_trip", "list_trips"];
const GRANT_KEYS = ["active", "clientId", "clientName", "createdAt", "expiresAt", "id", "lastUsedAt", "redirectUri", "resource", "revokedAt", "revokedReason", "scope"];
const PATTERNS = { access: /^sta_[A-Za-z0-9_-]{43}$/, refresh: /^str_[A-Za-z0-9_-]{43}$/, code: /^stc_[A-Za-z0-9_-]{43}$/, client: /^ocl_[A-Za-z0-9_-]{22}$/ };
const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fictional-probe", version: "1.0.0" } } };
const mcpAccept = { Accept: "application/json, text/event-stream" };

let clockOffset = 0;
const clock = () => Date.now() + clockOffset;
const advance = (ms) => { clockOffset += ms; };

// Every generated secret-like value, for leak scans. Never printed.
const secrets = [ownerToken];
const remember = (value) => { if (typeof value === "string" && value) secrets.push(value); return value; };
const newSecret = () => remember("Fictional-" + crypto.randomBytes(12).toString("base64url"));
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
let counter = 0;
const pass = (label) => console.log("PASS " + String(++counter).padStart(2, "0") + " " + label);

const running = [];
const sdkClients = [];
const configFor = (name, { oauthUser = OAUTH_USER, redirectUris = [TEST_CALLBACK, LOOPBACK_CALLBACK] } = {}) => ({
  ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, name), SHARED_TRIP_PORT: "0", ...(oauthUser ? { SHARED_TRIP_OAUTH_USERNAME: oauthUser } : {}) }),
  clock, oauthRedirectUris: redirectUris
});
async function start(name, options) { const runtime = await startServer(configFor(name, options)); running.push(runtime); return runtime; }
async function stop(runtime) { running.splice(running.indexOf(runtime), 1); await runtime.close(); }

// ------------------------------------------------------------------------------------------------
// HTTP helpers

const errorOf = (response) => (typeof response.data?.error === "string" ? response.data.error : response.data?.error?.code ?? "none");
function expect(response, status, label) {
  assert.ok(response.status === status, label + " (expected " + status + ", got " + response.status + ", error " + errorOf(response) + ")");
  return response;
}
function expectOAuthError(response, status, error, label) {
  expect(response, status, label);
  assert.ok(errorOf(response) === error, label + " (expected error " + error + ", got " + errorOf(response) + ")");
  assert.ok(!PATTERNS.access.test(String(response.data?.[ACCESS_FIELD])), label + " issues no token");
}

async function call(base, route, { method = "GET", headers = {}, json, form, raw } = {}) {
  // This harness restarts servers on the same port; do not reuse a socket from the prior process.
  const sent = { Connection: "close", ...headers };
  let body;
  if (json !== undefined) { sent["Content-Type"] ??= "application/json"; body = JSON.stringify(json); }
  else if (form !== undefined) { sent["Content-Type"] ??= "application/x-www-form-urlencoded"; body = new URLSearchParams(form).toString(); }
  else if (raw !== undefined) body = raw;
  for (const name of Object.keys(sent)) if (sent[name] === undefined) delete sent[name];
  const response = await fetch(base + route, { method, headers: sent, body, redirect: "manual" });
  const text = method === "HEAD" ? "" : await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* HTML or empty */ }
  const pathname = new URL(route, base).pathname;
  if (/^\/(?:api|mcp|oauth|\.well-known)(?:\/|$)/.test(pathname)) assert.ok(response.headers.get("cache-control") === "no-store", method + " response on a protected or OAuth path must be no-store");
  return { status: response.status, headers: response.headers, data, text, cookies: response.headers.getSetCookie() };
}
const owner = (base, route, options = {}) => call(base, route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } });

/** Raw request with an explicit Host header (fetch cannot override Host). Returns the status only. */
function rawStatus(base, route, hostHeader) {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request({ host: target.hostname, port: target.port, path: route, method: "GET", headers: { Host: hostHeader } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on("error", reject); request.end();
  });
}

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
async function siteCookie(base, account) {
  const response = expect(await siteLogin(base, account), 200, "site sign-in");
  return remember(response.cookies[0].split(";")[0]);
}
async function ownerCookie(base) {
  const response = expect(await call(base, "/api/login", { method: "POST", headers: { Origin: base }, json: { token: ownerToken } }), 200, "owner sign-in");
  return remember(response.cookies[0].split(";")[0]);
}

// ------------------------------------------------------------------------------------------------
// OAuth helpers

function pkce() {
  // The challenge is public (it travels in the authorization URL and is stored); the verifier is secret.
  const verifier = remember(crypto.randomBytes(32).toString("base64url"));
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}
function shape(pairs, { set = {}, omit = [], add = [] } = {}) {
  return pairs.filter(([name]) => !omit.includes(name)).map(([name, value]) => [name, Object.hasOwn(set, name) ? set[name] : value]).concat(add);
}
function authorizePath(base, clientId, { challenge, redirectUri = TEST_CALLBACK, state = "fictional-state", ...changes } = {}) {
  const pairs = [["response_type", "code"], ["client_id", clientId], ["redirect_uri", redirectUri], ["scope", SCOPE], ["state", state], ["code_challenge", challenge], ["code_challenge_method", "S256"], ["resource", base + "/mcp"]];
  return "/oauth/authorize?" + new URLSearchParams(shape(pairs, changes)).toString();
}
function transactionCookie(response) {
  for (const header of response.cookies) {
    const pair = header.split(";")[0];
    if (pair.startsWith(OAUTH_COOKIE + "=") && pair.length > OAUTH_COOKIE.length + 1) return remember(pair);
  }
  return null;
}
const csrfOf = (html) => remember(/name="csrf" value="([A-Za-z0-9_-]{43})"/.exec(html || "")?.[1]) || null;
const noticeOf = (html) => /<p class="notice"[^>]*>([^<]*)<\/p>/.exec(html || "")?.[1] ?? "";
async function begin(base, clientId, options = {}, headers = {}) {
  const response = await call(base, authorizePath(base, clientId, options), { headers });
  return { response, cookie: transactionCookie(response), csrf: csrfOf(response.text) };
}
function postForm(base, route, at, pairs, headers = {}) {
  return call(base, route, { method: "POST", form: pairs, headers: { Origin: base, Cookie: at.cookie ?? undefined, ...headers } });
}
async function signIn(base, at, username, secret, headers = {}) {
  const response = await postForm(base, "/oauth/authorize/login", at, [["csrf", at.csrf], ["username", username], ["password", secret]], headers);
  return { response, cookie: transactionCookie(response) ?? at.cookie, csrf: csrfOf(response.text) ?? at.csrf };
}
const decide = (base, at, decision, headers = {}) => postForm(base, "/oauth/authorize/decision", at, [["csrf", at.csrf], ["decision", decision]], headers);
function callbackOf(response) {
  const value = response.headers.get("location");
  if (!value) return null;
  const url = new URL(value);
  return { target: url.origin + url.pathname, raw: value, params: url.searchParams, keys: [...url.searchParams.keys()] };
}
async function obtainCode(base, clientId, account, { redirectUri = TEST_CALLBACK } = {}) {
  const keys = pkce();
  const state = "fictional-" + crypto.randomBytes(6).toString("hex");
  const started = await begin(base, clientId, { challenge: keys.challenge, redirectUri, state });
  expect(started.response, 200, "authorization page");
  const signed = await signIn(base, started, account.username, account.password);
  expect(signed.response, 200, "dedicated sign-in");
  const decided = expect(await decide(base, signed, "allow"), 303, "explicit allow");
  const back = callbackOf(decided);
  assert.ok(back.target === redirectUri && back.params.get("state") === state && back.params.get("iss") === base, "code redirect returns state and exact iss to the registered callback");
  assert.deepEqual(back.keys, ["code", "state", "iss"], "success redirect parameters");
  const code = remember(back.params.get("code"));
  assert.ok(PATTERNS.code.test(code), "code format");
  return { code, ...keys, redirectUri, clientId };
}
function exchange(base, flow, changes = {}, headers = {}) {
  const pairs = [["grant_type", "authorization_code"], ["code", flow.code], ["redirect_uri", flow.redirectUri], ["client_id", flow.clientId], ["code_verifier", flow.verifier], ["resource", base + "/mcp"]];
  return call(base, "/oauth/token", { method: "POST", form: shape(pairs, changes), headers });
}
function tokensOf(response) {
  return { access: remember(response.data?.[ACCESS_FIELD]), refresh: remember(response.data?.[REFRESH_FIELD]), expiresIn: response.data?.expires_in, scope: response.data?.scope };
}
async function grantFor(base, clientId, account, options) {
  const flow = await obtainCode(base, clientId, account, options);
  const issued = tokensOf(expect(await exchange(base, flow), 200, "code exchange"));
  assert.ok(PATTERNS.access.test(issued.access) && PATTERNS.refresh.test(issued.refresh), "token formats");
  return { ...issued, clientId };
}
function refresh(base, clientId, value, changes = {}, headers = {}) {
  return call(base, "/oauth/token", { method: "POST", form: shape([["grant_type", "refresh_token"], [REFRESH_FIELD, value], ["client_id", clientId], ["resource", base + "/mcp"]], changes), headers });
}
function revoke(base, clientId, value, changes = {}, headers = {}) {
  return call(base, "/oauth/revoke", { method: "POST", form: shape([["token", value], ["client_id", clientId]], changes), headers });
}
async function mcpStatus(base, bearer, headers = {}) {
  return (await call(base, "/mcp", { method: "POST", json: initialize, headers: { ...mcpAccept, Authorization: bearer ? "Bearer " + bearer : undefined, ...headers } })).status;
}
async function mcpSession(base, bearer) {
  const sdk = new Client({ name: "fictional-oauth-connector", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + bearer } } }));
  sdkClients.push(sdk);
  return {
    sdk,
    async tool(name, args) { const result = await sdk.callTool({ name, arguments: args }); return { isError: Boolean(result.isError), data: result.structuredContent || JSON.parse(result.content[0].text) }; },
    async close() { sdkClients.splice(sdkClients.indexOf(sdk), 1); await sdk.close(); }
  };
}
async function register(base, metadata, headers = {}) { return call(base, "/oauth/register", { method: "POST", json: metadata, headers }); }
const grantIdOf = (runtime, access) => runtime.db.prepare("SELECT grant_id FROM oauth_tokens WHERE token_hash=?").get(sha256(access))?.grant_id;
async function grants(base, userId) { return expect(await owner(base, "/api/users/" + userId + "/oauth-grants"), 200, "owner grant listing").data.grants; }
function databaseText(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(({ name }) => JSON.stringify(db.prepare("SELECT * FROM \"" + name.replaceAll("\"", "\"\"") + "\"").all())).join("\n");
}
function filesContainAny(files, values) {
  return files.some((file) => fs.existsSync(file) && values.some((value) => fs.readFileSync(file).includes(Buffer.from(value))));
}

// ------------------------------------------------------------------------------------------------

let runtime = await start("main");
let base = runtime.url;
/** Restarts the main server on the same port (same origin => same issuer and resource). */
async function restartOnSamePort(current, name, options) {
  const port = Number(new URL(current.url).port);
  await stop(current);
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const next = await startServer({ ...configFor(name, options), port }); running.push(next); return next; }
    catch (error) { if (error?.code !== "EADDRINUSE") throw error; await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error("The test port could not be reused.");
}
async function restartMain(options) { runtime = await restartOnSamePort(runtime, "main", options); base = runtime.url; }
try {
  // 1. Configuration.
  const envBase = { SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, "config-probe"), SHARED_TRIP_PORT: "0" };
  assert.equal(readConfig(envBase).oauthUsername, "", "omitted OAuth username means no eligible account");
  assert.equal(readConfig({ ...envBase, SHARED_TRIP_OAUTH_USERNAME: " Fictional.OAuth " }).oauthUsername, OAUTH_USER, "configured username is normalized");
  assert.throws(() => readConfig({ ...envBase, SHARED_TRIP_OAUTH_USERNAME: "not a valid name!" }), /SHARED_TRIP_OAUTH_USERNAME/);
  for (const bad of [["https://x.fictional.invalid/cb?x=1"], ["https://x.fictional.invalid/cb#f"], ["http://x.fictional.invalid/cb"], ["https://user@x.fictional.invalid/cb"], ["not a url"], "https://x.fictional.invalid/cb"]) {
    await assert.rejects(startServer({ ...configFor("bad-callback"), oauthRedirectUris: bad }), /redirect/i, "invalid test callback configuration is refused");
  }
  pass("configuration: explicit normalized OAuth username, none when omitted, strict code-only test callbacks");

  // 2. Fictional data and accounts.
  const manager = await makeAccount(base, OAUTH_USER, { role: "content-manager" });
  const otherManager = await makeAccount(base, "fictional.other", { role: "content-manager" });
  const viewer = await makeAccount(base, "fictional.viewer");
  const TITLES = ["Fictional OAuth Alpha", "Fictional OAuth Beta", "Fictional OAuth Created"];
  let alpha = expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "oa-alpha", trip: { title: TITLES[0] } } }), 201, "owner trip").data.trip;
  const beta = expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "oa-beta", trip: { title: TITLES[1] } } }), 201, "owner trip").data.trip;
  for(const trip of [alpha,beta])grantFixtureMembership(runtime,trip.id,manager.id);
  pass("fictional owner trips and content-manager/viewer accounts prepared");

  // 3. Metadata, CORS and Host guard.
  const expectedResource = { resource: base + "/mcp", authorization_servers: [base], scopes_supported: ["trips:read", SCOPE], bearer_methods_supported: ["header"], resource_name: "Shared Trips" };
  for (const route of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
    const response = expect(await call(base, route), 200, "protected resource metadata");
    assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
    assert.deepEqual(response.data, expectedResource, "resource is exactly origin + /mcp, issuer is the origin");
  }
  const asResponse = expect(await call(base, "/.well-known/oauth-authorization-server"), 200, "authorization server metadata");
  assert.equal(asResponse.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(asResponse.data, {
    issuer: base, authorization_endpoint: base + "/oauth/authorize", token_endpoint: base + "/oauth/token", registration_endpoint: base + "/oauth/register", revocation_endpoint: base + "/oauth/revoke",
    scopes_supported: ["trips:read", SCOPE], response_types_supported: ["code"], response_modes_supported: ["query"], grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], authorization_response_iss_parameter_supported: true
  }, "metadata: S256 only, public clients only, iss parameter supported, no client ID metadata documents");
  const foreign = "https://browser-client.fictional.invalid";
  const corsMeta = expect(await call(base, "/.well-known/oauth-authorization-server", { headers: { Origin: foreign } }), 200, "cross-origin metadata");
  assert.equal(corsMeta.headers.get("access-control-allow-origin"), "*"); assert.equal(corsMeta.headers.get("access-control-allow-credentials"), null);
  assert.equal((await call(base, "/.well-known/openid-configuration")).status, 404, "no OpenID configuration is advertised");
  assert.equal(await rawStatus(base, "/.well-known/oauth-authorization-server", "attacker.fictional.invalid"), 403, "Host guard still applies to OAuth routes");
  assert.equal(await rawStatus(base, "/oauth/authorize", "attacker.fictional.invalid"), 403);
  pass("metadata: exact resource/issuer, UTF-8 JSON, no-store, credential-free CORS, Host guard preserved");

  // 4. /mcp challenge.
  const challenge = await call(base, "/mcp", { method: "POST", json: initialize, headers: mcpAccept });
  expect(challenge, 401, "anonymous MCP");
  assert.equal(challenge.headers.get("www-authenticate"), "Bearer resource_metadata=\"" + base + "/.well-known/oauth-protected-resource/mcp\", scope=\"" + "trips:read " + SCOPE + "\"");
  const badBearer = await call(base, "/mcp", { method: "POST", json: initialize, headers: { ...mcpAccept, Authorization: "Bearer sta_" + crypto.randomBytes(32).toString("base64url") } });
  expect(badBearer, 401, "unknown access token");
  assert.ok(badBearer.headers.get("www-authenticate").startsWith("Bearer error=\"invalid_token\", resource_metadata="), "invalid token challenge");
  assert.equal((await call(base, "/api/trips")).headers.get("www-authenticate"), null, "the web API does not advertise OAuth");
  pass("/mcp 401 advertises resource_metadata and scope; invalid tokens get error=invalid_token");

  // 5. Registration (main server).
  const regA = expect(await register(base, { client_name: "Fictional Connector", redirect_uris: [TEST_CALLBACK, LOOPBACK_CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: SCOPE }), 201, "register client A").data;
  assert.deepEqual(Object.keys(regA).sort(), ["client_id", "client_id_issued_at", "client_name", "grant_types", "redirect_uris", "response_types", "scope", "token_endpoint_auth_method"]);
  assert.ok(PATTERNS.client.test(regA.client_id) && regA.token_endpoint_auth_method === "none" && !("client_secret" in regA), "public client without a secret");
  assert.deepEqual(regA.grant_types, ["authorization_code", "refresh_token"]);
  const preflight = await call(base, "/oauth/register", { method: "OPTIONS", headers: { Origin: foreign, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" } });
  expect(preflight, 204, "registration preflight");
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*"); assert.equal(preflight.headers.get("access-control-allow-credentials"), null);
  const regBResponse = expect(await register(base, { client_name: "Fictional Second Client", redirect_uris: [TEST_CALLBACK] }, { Origin: foreign }), 201, "cross-origin public registration");
  assert.equal(regBResponse.headers.get("access-control-allow-origin"), "*");
  const regB = regBResponse.data;
  const regP = expect(await register(base, { client_name: "Fictional Production Callback", redirect_uris: [PRODUCTION_CALLBACK] }), 201, "production callback registration").data;
  const hostileName = "<script>alert(\"fictional\")</script><img src=x onerror=alert(1)> Fictional";
  const regX = expect(await register(base, { client_name: hostileName, redirect_uris: [TEST_CALLBACK] }), 201, "client with markup in its name").data;
  pass("registration: public clients, exact allowed callbacks, no secrets, credential-free CORS");

  // 6. Authorization requests that must never redirect.
  const probe = pkce();
  const noRedirect = [
    ["unknown client", "ocl_" + "A".repeat(22), {}], ["malformed client", "not-a-client", {}], ["missing client", regA.client_id, { omit: ["client_id"] }],
    ["duplicate client", regA.client_id, { add: [["client_id", regB.client_id]] }], ["unregistered redirect", regA.client_id, { redirectUri: "https://attacker.fictional.invalid/callback" }],
    ["production callback not registered for this client", regA.client_id, { redirectUri: PRODUCTION_CALLBACK }], ["path suffix", regA.client_id, { redirectUri: TEST_CALLBACK + "/x" }],
    ["query", regA.client_id, { redirectUri: TEST_CALLBACK + "?x=1" }], ["fragment", regA.client_id, { redirectUri: TEST_CALLBACK + "#x" }], ["trailing slash", regA.client_id, { redirectUri: TEST_CALLBACK + "/" }],
    ["host case variant", regA.client_id, { redirectUri: TEST_CALLBACK.replace("oauth-client", "OAUTH-CLIENT") }], ["missing redirect", regA.client_id, { omit: ["redirect_uri"] }],
    ["duplicate redirect", regA.client_id, { add: [["redirect_uri", TEST_CALLBACK]] }], ["other client's redirect", regP.client_id, { redirectUri: TEST_CALLBACK }]
  ];
  for (const [label, clientId, options] of noRedirect) {
    const response = await call(base, authorizePath(base, clientId, { challenge: probe.challenge, ...options }));
    expect(response, 400, label);
    assert.equal(response.headers.get("location"), null, label + ": never redirects");
    assert.ok(response.headers.get("content-type").startsWith("text/html") && response.headers.get("content-security-policy").includes("frame-ancestors 'none'"), label + ": safe error page");
    assert.equal(transactionCookie(response), null, label + ": no transaction");
    assert.ok(!response.text.includes("attacker") && !response.text.includes("<script"), label + ": nothing echoed");
  }
  pass("unknown/malformed/duplicate client and every unregistered or altered redirect URI get a page, never a redirect");

  // 7. Authorization errors redirected with state and exact iss.
  async function redirectedError(label, clientId, options, error, { stateEchoed = true, callback = TEST_CALLBACK } = {}) {
    const state = "fictional-error-state";
    const response = await call(base, authorizePath(base, clientId, { challenge: probe.challenge, state, redirectUri: callback, ...options }));
    expect(response, 302, label);
    const back = callbackOf(response);
    assert.ok(back.target === callback, label + ": registered callback only");
    assert.ok(back.params.get("error") === error, label + " (expected " + error + ", got " + back.params.get("error") + ")");
    assert.ok(back.params.get("iss") === base, label + ": exact iss");
    assert.equal(back.params.get("code"), null);
    assert.equal(back.params.get("state"), stateEchoed ? state : null, label + ": state handling");
    assert.equal(transactionCookie(response), null, label + ": no transaction");
    return back;
  }
  const A = regA.client_id;
  await redirectedError("response_type token", A, { set: { response_type: "token" } }, "unsupported_response_type");
  await redirectedError("missing response_type", A, { omit: ["response_type"] }, "invalid_request");
  await redirectedError("duplicate response_type", A, { add: [["response_type", "code"]] }, "invalid_request");
  await redirectedError("PKCE absent", A, { omit: ["code_challenge", "code_challenge_method"] }, "invalid_request");
  await redirectedError("challenge without method", A, { omit: ["code_challenge_method"] }, "invalid_request");
  await redirectedError("method without challenge", A, { omit: ["code_challenge"] }, "invalid_request");
  await redirectedError("PKCE plain", A, { set: { code_challenge_method: "plain" } }, "invalid_request");
  await redirectedError("malformed challenge", A, { set: { code_challenge: "too-short" } }, "invalid_request");
  await redirectedError("duplicate challenge", A, { add: [["code_challenge", probe.challenge]] }, "invalid_request");
  await redirectedError("wrong resource path", A, { set: { resource: base + "/api" } }, "invalid_target");
  await redirectedError("foreign resource", A, { set: { resource: "https://other.fictional.invalid/mcp" } }, "invalid_target");
  await redirectedError("resource trailing slash", A, { set: { resource: base + "/mcp/" } }, "invalid_target");
  await redirectedError("missing resource", A, { omit: ["resource"] }, "invalid_target");
  await redirectedError("duplicate resource", A, { add: [["resource", base + "/mcp"]] }, "invalid_request");
  await redirectedError("missing scope", A, { omit: ["scope"] }, "invalid_scope");
  await redirectedError("extra scope", A, { set: { scope: SCOPE + " admin" } }, "invalid_scope");
  await redirectedError("other scope", A, { set: { scope: "admin" } }, "invalid_scope");
  await redirectedError("duplicate scope", A, { add: [["scope", SCOPE]] }, "invalid_request");
  await redirectedError("duplicate state", A, { add: [["state", "second"]] }, "invalid_request", { stateEchoed: false });
  await redirectedError("control character in state", A, { set: { state: "bad\nstate" } }, "invalid_request", { stateEchoed: false });
  await redirectedError("request object", A, { add: [["request", "eyJhbGciOiJub25lIn0.e30."]] }, "invalid_request");
  await redirectedError("fragment response mode", A, { add: [["response_mode", "fragment"]] }, "invalid_request");
  const production = await redirectedError("production callback error", regP.client_id, { set: { scope: "admin" } }, "invalid_scope", { callback: PRODUCTION_CALLBACK });
  assert.ok(production.raw.startsWith(PRODUCTION_CALLBACK + "?"), "production callback is used exactly");
  pass("response_type, PKCE (absent/plain/malformed), resource, scope, state and duplicate-parameter errors redirect with exact iss");

  // 8. Sign-in page: headers, escaping, no owner bypass.
  const page = await begin(base, A, { challenge: probe.challenge });
  expect(page.response, 200, "sign-in page");
  const headers = page.response.headers;
  assert.equal(headers.get("content-type"), "text/html; charset=utf-8");
  const csp = headers.get("content-security-policy");
  for (const part of ["default-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self' https://oauth-client.fictional.invalid"]) assert.ok(csp.includes(part), "CSP contains " + part.split(" ")[0]);
  assert.ok(!csp.includes("unsafe-inline") && !csp.includes("script-src"), "no script is allowed");
  assert.equal(headers.get("x-frame-options"), "DENY"); assert.equal(headers.get("referrer-policy"), "no-referrer"); assert.equal(headers.get("pragma"), "no-cache");
  assert.ok(/^shared_trip_oauth=[A-Za-z0-9_-]{43}; Path=\/oauth\/authorize; HttpOnly; SameSite=Strict; Max-Age=600$/.test(page.response.cookies.find((c) => c.startsWith(OAUTH_COOKIE)) || ""), "transaction cookie attributes");
  const html = page.response.text;
  assert.ok(!/<script/i.test(html), "no script elements");
  assert.ok(html.includes("name=\"viewport\"") && html.includes("Fictional Connector") && html.includes(A) && html.includes(TEST_CALLBACK), "client identity and exact callback shown");
  const secretInput = /<input[^>]*type="password"[^>]*>/.exec(html)?.[0] ?? "";
  assert.ok(secretInput.includes("name=\"password\"") && !secretInput.includes("value="), "password input never carries a value");
  assert.ok(!html.includes(probe.challenge) && !html.includes("Allow this application"), "no consent on GET");
  const hostile = await begin(base, regX.client_id, { challenge: probe.challenge });
  assert.ok(hostile.response.status === 200 && !/<script|<img/i.test(hostile.response.text) && hostile.response.text.includes("&lt;script&gt;"), "client-supplied name is escaped");
  const ownerSession = await ownerCookie(base);
  const ownerTry = await call(base, authorizePath(base, A, { challenge: probe.challenge }), { headers: { Authorization: "Bearer " + ownerToken, Cookie: ownerSession } });
  assert.ok(ownerTry.status === 200 && ownerTry.text.includes("type=\"password\"") && !ownerTry.text.includes("Allow this application"), "owner bearer/cookie do not skip sign-in");
  const ownerTryState = { cookie: transactionCookie(ownerTry), csrf: csrfOf(ownerTry.text) };
  const ownerAllow = await decide(base, ownerTryState, "allow", { Authorization: "Bearer " + ownerToken });
  assert.ok(ownerAllow.status === 403 && ownerAllow.headers.get("location") === null, "allow before sign-in is refused even with the owner bearer");
  const cookieOnly = await call(base, "/oauth/authorize/decision", { method: "POST", form: [["decision", "allow"]], headers: { Origin: base, Cookie: ownerSession } });
  assert.ok(cookieOnly.status === 400 && cookieOnly.headers.get("location") === null, "owner session cookie is not a transaction");
  pass("sign-in page: CSP/no script/no framing/no-referrer/no-store, HttpOnly SameSite cookie, escaped client data, owner credentials never bypass sign-in");

  // 9. Browser POST guards (none of these reach the password check).
  let flowState = await begin(base, A, { challenge: probe.challenge, state: "fictional-main" });
  const guarded = [
    ["foreign origin", flowState, { Origin: "https://attacker.fictional.invalid" }, 403],
    ["missing origin", flowState, { Origin: undefined }, 403],
    ["opaque origin without fetch metadata", flowState, { Origin: "null" }, 403],
    ["opaque origin from another site", flowState, { Origin: "null", "Sec-Fetch-Site": "cross-site" }, 403],
    ["missing transaction cookie", { ...flowState, cookie: null }, {}, 400],
    ["unknown transaction cookie", { ...flowState, cookie: OAUTH_COOKIE + "=" + crypto.randomBytes(32).toString("base64url") }, {}, 400],
    ["wrong CSRF value", { ...flowState, csrf: crypto.randomBytes(32).toString("base64url") }, {}, 403],
    ["missing CSRF value", { ...flowState, csrf: "" }, {}, 403]
  ];
  for (const [label, at, extra, status] of guarded) {
    const response = (await signIn(base, at, manager.username, manager.password, extra)).response;
    assert.ok(response.status === status && !response.text.includes("Allow this application") && !response.text.includes(manager.password), label + " is refused");
  }
  const duplicateCsrf = await postForm(base, "/oauth/authorize/login", flowState, [["csrf", flowState.csrf], ["csrf", flowState.csrf], ["username", manager.username], ["password", manager.password]]);
  assert.equal(duplicateCsrf.status, 403, "repeated CSRF parameter is refused");
  const jsonLogin = await call(base, "/oauth/authorize/login", { method: "POST", json: { csrf: flowState.csrf }, headers: { Origin: base, Cookie: flowState.cookie } });
  assert.equal(jsonLogin.status, 400, "only form posts are accepted");
  assert.equal((await call(base, "/oauth/authorize/login", { headers: { Cookie: flowState.cookie } })).status, 405, "sign-in is POST only");
  pass("browser forms require same-origin (or browser-attested same-origin), the transaction cookie and the matching CSRF value");

  // 10. Sign-in refusals: no enumeration, no password echo, only the configured account.
  const wrong = newSecret();
  const failed = await signIn(base, flowState, manager.username, wrong);
  expect(failed.response, 401, "wrong password");
  assert.ok(!failed.response.text.includes(wrong), "failed sign-in never echoes the password");
  const genericNotice = noticeOf(failed.response.text);
  assert.ok(genericNotice.length > 0 && failed.cookie !== flowState.cookie, "generic notice and rotated transaction");
  assert.equal((await signIn(base, flowState, manager.username, manager.password)).response.status, 400, "the pre-failure transaction cookie is no longer valid");
  flowState = failed;
  for (const [label, username, secret] of [["unknown account", "fictional.nobody", newSecret()], ["unconfigured content manager", otherManager.username, otherManager.password], ["viewer", viewer.username, viewer.password], ["owner token as password", manager.username, ownerToken]]) {
    const attempt = await signIn(base, flowState, username, secret);
    assert.ok(attempt.response.status === 401 && noticeOf(attempt.response.text) === genericNotice && !attempt.response.text.includes(secret), label + " gets the same generic refusal");
    flowState = attempt;
  }
  pass("sign-in refusals: identical generic result for wrong password, unknown, unconfigured and viewer accounts and the owner token; nothing echoed");

  // 11. Successful dedicated sign-in (as a browser sends it under no-referrer), consent page, no consent on GET.
  const consent = await signIn(base, flowState, manager.username, manager.password, { Origin: "null", "Sec-Fetch-Site": "same-origin" });
  expect(consent.response, 200, "consent page");
  const consentHtml = consent.response.text;
  for (const text of ["Allow this application to manage trips?", "It will be able to", "It will not be able to", "90 days", SCOPE, "Manage accounts", "owner", "Deny", "Allow", A, TEST_CALLBACK, manager.username]) assert.ok(consentHtml.includes(text), "consent page states its terms");
  assert.ok(!/<script/i.test(consentHtml) && consent.cookie !== flowState.cookie && consent.response.cookies.length === 1, "consent page rotates the transaction and sets no site session");
  assert.ok(!consent.response.cookies[0].startsWith("shared_trip_session"), "no website session is created");
  assert.equal((await decide(base, flowState, "allow")).status, 400, "pre-sign-in transaction cookie cannot approve");
  const regetGet = await call(base, authorizePath(base, A, { challenge: probe.challenge }), { headers: { Cookie: consent.cookie } });
  assert.ok(regetGet.status === 200 && regetGet.text.includes("type=\"password\"") && !regetGet.text.includes("Allow this application"), "a new GET always starts with sign-in");
  const decisionGet = await call(base, "/oauth/authorize/decision", { headers: { Cookie: consent.cookie } });
  assert.ok(decisionGet.status === 405 && decisionGet.headers.get("location") === null, "decision is POST only");
  pass("dedicated sign-in shows explicit consent (client, callback, permissions, exclusions, 90 days) without a site session; GET never consents");

  // 12. Explicit deny / allow.
  const denied = expect(await decide(base, consent, "deny"), 303, "deny");
  const deniedBack = callbackOf(denied);
  assert.ok(deniedBack.target === TEST_CALLBACK && deniedBack.params.get("error") === "access_denied" && deniedBack.params.get("state") === "fictional-main" && deniedBack.params.get("iss") === base, "deny redirects with state and iss");
  assert.deepEqual(deniedBack.keys, ["error", "error_description", "state", "iss"]);
  assert.ok(denied.cookies.some((c) => c.startsWith(OAUTH_COOKIE + "=;") && c.includes("Max-Age=0")), "transaction cookie cleared");
  assert.equal((await decide(base, consent, "allow")).status, 400, "a decided transaction cannot be reused");
  const cancelled = await begin(base, A, { challenge: probe.challenge, state: "fictional-cancel" });
  const cancelBack = callbackOf(expect(await decide(base, cancelled, "deny"), 303, "cancel before sign-in"));
  assert.ok(cancelBack.params.get("error") === "access_denied" && cancelBack.params.get("iss") === base && cancelBack.params.get("code") === null, "cancel redirects with access_denied and iss");
  const undecided = await signIn(base, await begin(base, A, { challenge: probe.challenge }), manager.username, manager.password);
  const odd = await decide(base, undecided, "maybe");
  assert.ok(odd.status === 400 && odd.headers.get("location") === null, "unknown decision is refused without redirect");
  const firstFlow = await obtainCode(base, A, manager);
  pass("explicit deny and cancel return access_denied with state and iss; allow returns exactly code, state and iss");

  // 13. Token endpoint request validation.
  const bogus = { code: "stc_" + crypto.randomBytes(32).toString("base64url"), verifier: probe.verifier, redirectUri: TEST_CALLBACK, clientId: A };
  expectOAuthError(await exchange(base, bogus, { set: { client_id: "ocl_" + "B".repeat(22) } }), 401, "invalid_client", "unknown client");
  expectOAuthError(await exchange(base, bogus, { omit: ["client_id"] }), 401, "invalid_client", "missing client");
  expectOAuthError(await exchange(base, bogus, {}, { Authorization: "Basic " + Buffer.from(A + ":x").toString("base64") }), 401, "invalid_client", "client authentication header");
  expectOAuthError(await exchange(base, bogus, { add: [["client_secret", "fictional"]] }), 401, "invalid_client", "client secret parameter");
  expectOAuthError(await exchange(base, bogus, { add: [["code", bogus.code]] }), 400, "invalid_request", "repeated parameter");
  expectOAuthError(await exchange(base, bogus, { omit: ["resource"] }), 400, "invalid_request", "missing resource");
  expectOAuthError(await exchange(base, bogus, { omit: ["code_verifier"] }), 400, "invalid_request", "missing verifier");
  expectOAuthError(await exchange(base, bogus, { omit: ["redirect_uri"] }), 400, "invalid_request", "missing redirect");
  expectOAuthError(await exchange(base, bogus, { add: [["scope", SCOPE], ["scope", SCOPE]] }), 400, "invalid_request", "repeated scope");
  expectOAuthError(await exchange(base, bogus, { add: [["scope", "admin"]] }), 400, "invalid_scope", "other scope");
  expectOAuthError(await exchange(base, bogus, { set: { grant_type: "client_credentials" } }), 400, "unsupported_grant_type", "client credentials");
  expectOAuthError(await exchange(base, bogus, { set: { grant_type: "password" } }), 400, "unsupported_grant_type", "resource owner password grant");
  expectOAuthError(await exchange(base, bogus, { omit: ["grant_type"] }), 400, "invalid_request", "missing grant type");
  expectOAuthError(await exchange(base, bogus), 400, "invalid_grant", "unknown code");
  expectOAuthError(await call(base, "/oauth/token", { method: "POST", json: { grant_type: "authorization_code" } }), 400, "invalid_request", "JSON body");
  assert.equal((await call(base, "/oauth/token")).status, 405, "token endpoint is POST only");
  pass("token endpoint: public-client authentication only, no repeated parameters, required resource/verifier/redirect, supported grants only");

  // 14. Code bindings and PKCE.
  async function burnedAfter(label, changes, error) {
    const flow = await obtainCode(base, A, manager);
    expectOAuthError(await exchange(base, flow, changes), 400, error, label);
    expectOAuthError(await exchange(base, flow), 400, "invalid_grant", label + ": the code is burned");
  }
  await burnedAfter("wrong PKCE verifier", { set: { code_verifier: pkce().verifier } }, "invalid_grant");
  {
    const flow = await obtainCode(base, A, manager);
    expectOAuthError(await exchange(base, flow, { set: { code_verifier: flow.challenge } }), 400, "invalid_grant", "plain PKCE (challenge as verifier)");
  }
  await burnedAfter("malformed verifier", { set: { code_verifier: "short" } }, "invalid_grant");
  await burnedAfter("other client", { set: { client_id: regB.client_id } }, "invalid_grant");
  await burnedAfter("other registered redirect", { set: { redirect_uri: LOOPBACK_CALLBACK } }, "invalid_grant");
  await burnedAfter("wrong resource", { set: { resource: base + "/api" } }, "invalid_target");
  pass("wrong/plain/malformed verifier, other client, other redirect and wrong resource obtain nothing and burn the code");

  // 15. Successful exchange, then replay ends the grant.
  const firstResponse = expect(await exchange(base, firstFlow), 200, "code exchange");
  assert.deepEqual(Object.keys(firstResponse.data).sort(), [ACCESS_FIELD, "expires_in", REFRESH_FIELD, "scope", "token_type"].sort());
  assert.ok(firstResponse.headers.get("content-type") === "application/json; charset=utf-8" && firstResponse.headers.get("pragma") === "no-cache", "token response headers");
  const first = tokensOf(firstResponse);
  assert.ok(PATTERNS.access.test(first.access) && PATTERNS.refresh.test(first.refresh) && first.access !== first.refresh, "opaque 256-bit tokens");
  assert.ok(firstResponse.data.token_type === "Bearer" && first.scope === SCOPE && first.expiresIn <= ACCESS_TTL_MS / 1000 && first.expiresIn > ACCESS_TTL_MS / 1000 - 30, "Bearer, trips:manage, at most 15 minutes");
  assert.equal(await mcpStatus(base, first.access), 200, "access token works at /mcp");
  expectOAuthError(await exchange(base, firstFlow), 400, "invalid_grant", "code replay");
  assert.equal(await mcpStatus(base, first.access), 401, "code replay revokes the issued access token");
  expectOAuthError(await refresh(base, A, first.refresh), 400, "invalid_grant", "code replay revokes the refresh token");
  pass("code exchange issues Bearer access (<=15 min) + refresh; code replay is refused and ends everything issued from it");

  // 16. Code expiry.
  const lateFlow = await obtainCode(base, A, manager);
  advance(CODE_TTL_MS + 1000);
  expectOAuthError(await exchange(base, lateFlow), 400, "invalid_grant", "expired code");
  pass("authorization codes expire after " + CODE_TTL_MS / 60_000 + " minutes (injected clock)");

  // 17. Real SDK MCP with an OAuth access token: six tools, reads and writes visible over HTTP.
  const g1 = await grantFor(base, A, manager);
  const session = await mcpSession(base, g1.access);
  assert.deepEqual((await session.sdk.listTools()).tools.map((tool) => tool.name).sort(), SIX_TOOLS, "exactly the six content tools");
  const listed = (await session.tool("list_trips", {})).data.trips.map((trip) => trip.id);
  assert.ok(listed.includes(alpha.id) && listed.includes(beta.id), "explicit member trips");
  assert.equal((await session.tool("get_trip", { tripId: alpha.id })).data.trip.title, TITLES[0]);
  const created = await session.tool("create_trip", { requestId: "oa-mcp-create", trip: { title: TITLES[2] } });
  assert.ok(!created.isError, "OAuth MCP create");
  assert.equal(expect(await owner(base, "/api/trips/" + created.data.trip.id), 200, "owner reads OAuth-created trip").data.trip.title, TITLES[2]);
  const edit = await session.tool("apply_trip_changes", { tripId: alpha.id, requestId: "oa-mcp-edit", expectedVersion: alpha.version, changes: [{ type: "upsert_day", day: { id: "oa-day", date: "2033-04-05", slots: [{ id: "oa-plan", name: "Invented pier walk", time: "10:00" }] } }] });
  assert.ok(!edit.isError, "OAuth MCP edit"); alpha = edit.data.trip;
  assert.equal(expect(await owner(base, "/api/trips/" + alpha.id), 200, "owner read").data.trip.days[0].slots[0].name, "Invented pier walk", "MCP write visible over HTTP");
  const exported = await session.tool("export_trip", { tripId: alpha.id });
  const imported = await session.tool("import_trip", { requestId: "oa-mcp-import", data: exported.data });
  assert.ok(!exported.isError && !imported.isError && imported.data.trip.id !== alpha.id, "export/import");
  const later = expect(await owner(base, "/api/trips", { method: "POST", json: { requestId: "oa-later", trip: { title: "Fictional OAuth Later" } } }), 201, "later owner trip").data.trip;
  assert.equal((await session.tool("get_trip",{tripId:later.id})).isError,true,"later trips are not automatically granted");
  grantFixtureMembership(runtime,later.id,manager.id);
  assert.ok(!(await session.tool("apply_trip_changes", { tripId: later.id, requestId: "oa-mcp-future", expectedVersion: 1, changes: [{ type: "update_trip", fields: { shortName: "Later" } }] })).isError, "an explicitly assigned future trip is editable");
  await session.close();
  pass("official MCP SDK with an OAuth token: six tools, list/get/create/edit/export/import on assigned current and future trips, visible over HTTP");

  // 18. OAuth tokens are never web, admin or media credentials; cookies never authorize MCP.
  const managerSite = await siteCookie(base, manager);
  for (const [method, route, json] of [["GET", "/api/session"], ["GET", "/api/trips"], ["GET", "/api/trips/" + alpha.id], ["GET", "/api/trips/" + alpha.id + "/export"],
    ["POST", "/api/trips", { requestId: "oa-http", trip: { title: "Must not exist" } }], ["POST", "/api/trips/" + alpha.id + "/changes", { requestId: "oa-http-edit", expectedVersion: alpha.version, changes: [{ type: "archive_trip", archived: true }] }],
    ["GET", "/api/users"], ["GET", "/api/users/" + manager.id + "/oauth-grants"], ["POST", "/api/users/" + manager.id + "/oauth-grants/oag_AAAAAAAAAAAAAAAA/revoke", {}], ["GET", "/api/users/" + manager.id + "/mcp-tokens"],
    ["POST", "/api/users/" + manager.id + "/role", { role: "content-manager" }], ["POST", "/api/invitations", {}], ["GET", "/api/audit"], ["GET", "/photos/fictional.webp"], ["POST", "/api/logout", {}]]) {
    const response = await call(base, route, { method, json, headers: { Authorization: "Bearer " + g1.access } });
    assert.ok(response.status === 401 && !response.text.includes(TITLES[0]), "OAuth token refused at " + method + " " + route.replace(/usr_[^/]+/, ":id"));
  }
  assert.equal((await call(base, "/api/trips", { headers: { Authorization: "Bearer " + g1.access, Cookie: managerSite } })).status, 401, "no fallback to a cookie");
  assert.equal((await call(base, "/api/login", { method: "POST", headers: { Origin: base }, json: { token: g1.access } })).status, 401, "not an owner login");
  assert.equal(await mcpStatus(base, g1.refresh), 401, "refresh token is not a bearer credential");
  assert.equal(await mcpStatus(base, sha256(g1.access)), 401, "digest is not a bearer credential");
  assert.equal(await mcpStatus(base, null, { Cookie: managerSite, Origin: base }), 401, "manager cookie never authorizes MCP");
  assert.equal(await mcpStatus(base, g1.access, { Origin: "https://attacker.fictional.invalid" }), 403, "global Origin guard still protects /mcp");
  assert.equal((await call(base, "/api/login", { method: "POST", headers: { Origin: "https://attacker.fictional.invalid" }, json: { token: ownerToken } })).status, 403, "global Origin guard still protects the web API");
  assert.equal(await mcpStatus(base, ownerToken), 200, "owner bearer MCP unchanged");
  assert.equal(await mcpStatus(base, g1.access), 200, "the OAuth token itself is still valid");
  pass("OAuth access tokens are refused at every web/admin/media route and owner login; refresh tokens, digests and cookies never authorize MCP");

  // 19. Access-token expiry.
  advance(ACCESS_TTL_MS + 1000);
  const expired = await call(base, "/mcp", { method: "POST", json: initialize, headers: { ...mcpAccept, Authorization: "Bearer " + g1.access } });
  assert.ok(expired.status === 401 && expired.headers.get("www-authenticate").includes("error=\"invalid_token\""), "expired access token");
  pass("access tokens expire after 15 minutes (injected clock)");

  // 20. Refresh rotation, binding and reuse detection.
  const r1 = tokensOf(expect(await refresh(base, A, g1.refresh), 200, "refresh"));
  assert.ok(r1.access !== g1.access && r1.refresh !== g1.refresh && PATTERNS.refresh.test(r1.refresh), "both tokens rotate");
  assert.equal(await mcpStatus(base, r1.access), 200, "rotated access token works");
  expectOAuthError(await refresh(base, regB.client_id, r1.refresh), 400, "invalid_grant", "refresh by another client");
  expectOAuthError(await refresh(base, A, r1.refresh, { set: { resource: base + "/api" } }), 400, "invalid_target", "refresh for another resource");
  expectOAuthError(await refresh(base, A, r1.refresh, { add: [["scope", "admin"]] }), 400, "invalid_scope", "refresh with another scope");
  const r2 = tokensOf(expect(await refresh(base, A, r1.refresh, { omit: ["resource"], add: [["scope", SCOPE]] }), 200, "refresh after refused attempts"));
  const g1Id = grantIdOf(runtime, r2.access);
  expectOAuthError(await refresh(base, A, r1.refresh), 400, "invalid_grant", "refresh token reuse");
  assert.equal(await mcpStatus(base, r2.access), 401, "reuse revokes the newest access token");
  expectOAuthError(await refresh(base, A, r2.refresh), 400, "invalid_grant", "reuse revokes the newest refresh token");
  const reused = (await grants(base, manager.id)).find((grant) => grant.id === g1Id);
  assert.ok(reused && reused.active === false && reused.revokedReason === "refresh_reuse", "grant ended by refresh reuse");
  pass("refresh rotates both tokens atomically, stays bound to client/resource/scope, and reuse revokes the whole family");

  // 21. RFC 7009 revocation.
  const g3 = await grantFor(base, A, manager);
  expect(await revoke(base, regB.client_id, g3.refresh), 200, "foreign client revocation is a silent no-op");
  assert.equal(await mcpStatus(base, g3.access), 200, "foreign client cannot revoke");
  for (const value of ["str_" + crypto.randomBytes(32).toString("base64url"), "garbage", g3.refresh.slice(0, -1)]) {
    const response = expect(await revoke(base, A, value), 200, "unknown token revocation");
    assert.equal(response.text, "", "nothing revealed");
  }
  expectOAuthError(await revoke(base, A, g3.refresh, { omit: ["client_id"] }), 401, "invalid_client", "revocation without client");
  expectOAuthError(await revoke(base, "ocl_" + "C".repeat(22), g3.refresh), 401, "invalid_client", "revocation by unknown client");
  expectOAuthError(await revoke(base, A, g3.refresh, { omit: ["token"] }), 400, "invalid_request", "revocation without token");
  const corsRevoke = expect(await revoke(base, A, g3.access, { add: [["token_type_hint", "access_token"]] }, { Origin: foreign }), 200, "access-token revocation (cross-origin public client)");
  assert.equal(corsRevoke.headers.get("access-control-allow-origin"), "*");
  assert.equal(await mcpStatus(base, g3.access), 401, "revoked access token");
  const g3b = tokensOf(expect(await refresh(base, A, g3.refresh), 200, "refresh survives access-token revocation"));
  expect(await revoke(base, A, g3b.refresh), 200, "refresh-token revocation");
  assert.equal(await mcpStatus(base, g3b.access), 401, "refresh revocation ends the grant's access tokens");
  expectOAuthError(await refresh(base, A, g3b.refresh), 400, "invalid_grant", "revoked refresh token");
  pass("revocation is client-bound, silent for unknown/foreign tokens, ends one access token or the whole grant");

  // 22. Owner grant API (metadata only).
  const g4 = await grantFor(base, A, manager);
  const g4Id = grantIdOf(runtime, g4.access);
  const listing = await grants(base, manager.id);
  for (const grant of listing) assert.deepEqual(Object.keys(grant).sort(), GRANT_KEYS, "grant metadata fields");
  const g4Meta = listing.find((grant) => grant.id === g4Id);
  assert.ok(g4Meta.active && g4Meta.clientId === A && g4Meta.clientName === "Fictional Connector" && g4Meta.scope === SCOPE && g4Meta.resource === base + "/mcp" && g4Meta.redirectUri === TEST_CALLBACK, "grant metadata");
  assert.ok(Math.abs(Date.parse(g4Meta.expiresAt) - Date.parse(g4Meta.createdAt) - GRANT_LIFETIME_MS) < 5000, "grant lifetime is 90 days");
  const listingText = JSON.stringify(listing);
  assert.ok(!secrets.some((value) => listingText.includes(value)) && !secrets.some((value) => listingText.includes(sha256(value))), "listing contains no secrets or digests");
  const viewerSite = await siteCookie(base, viewer);
  for (const [label, response, status] of [
    ["manager cookie", await call(base, "/api/users/" + manager.id + "/oauth-grants", { headers: { Cookie: managerSite } }), 403],
    ["viewer cookie", await call(base, "/api/users/" + manager.id + "/oauth-grants", { headers: { Cookie: viewerSite } }), 403],
    ["anonymous", await call(base, "/api/users/" + manager.id + "/oauth-grants"), 401],
    ["OAuth bearer", await call(base, "/api/users/" + manager.id + "/oauth-grants", { headers: { Authorization: "Bearer " + g4.access } }), 401],
    ["manager cookie revoke", await call(base, "/api/users/" + manager.id + "/oauth-grants/" + g4Id + "/revoke", { method: "POST", headers: { Cookie: managerSite, Origin: base } }), 403],
    ["owner cookie without origin", await call(base, "/api/users/" + manager.id + "/oauth-grants/" + g4Id + "/revoke", { method: "POST", headers: { Cookie: ownerSession } }), 403]
  ]) assert.equal(response.status, status, label + " cannot use the owner grant API");
  expect(await call(base, "/api/users/" + manager.id + "/oauth-grants", { headers: { Cookie: ownerSession } }), 200, "owner cookie may list grants");
  assert.equal(await mcpStatus(base, g4.access), 200, "refused administration changed nothing");
  const revokedGrant = expect(await owner(base, "/api/users/" + manager.id + "/oauth-grants/" + g4Id + "/revoke", { method: "POST" }), 200, "owner revokes grant").data.grant;
  assert.ok(revokedGrant.revokedAt && revokedGrant.revokedReason === "owner" && !revokedGrant.active, "revoked metadata");
  assert.equal(await mcpStatus(base, g4.access), 401, "owner revocation ends access");
  expectOAuthError(await refresh(base, A, g4.refresh), 400, "invalid_grant", "owner revocation ends refresh");
  assert.equal(expect(await owner(base, "/api/users/" + manager.id + "/oauth-grants/" + g4Id + "/revoke", { method: "POST" }), 200, "repeat").data.grant.revokedAt, revokedGrant.revokedAt, "idempotent");
  assert.equal((await owner(base, "/api/users/" + manager.id + "/oauth-grants/oag_AAAAAAAAAAAAAAAA/revoke", { method: "POST" })).status, 404);
  assert.equal((await owner(base, "/api/users/" + viewer.id + "/oauth-grants/" + g4Id + "/revoke", { method: "POST" })).status, 404, "grant IDs are scoped to their account");
  assert.equal((await owner(base, "/api/users/usr_doesnotexist0/oauth-grants")).status, 404);
  pass("owner-only grant listing/revocation: metadata only, idempotent, account-scoped; managers, viewers and OAuth tokens refused");

  // 23. Account role changes and revocation end grants; re-approval revives nothing.
  const g5 = await grantFor(base, A, manager);
  const g5Id = grantIdOf(runtime, g5.access);
  expect(await owner(base, "/api/users/" + manager.id + "/role", { method: "POST", json: { role: "viewer" } }), 200, "demote");
  assert.equal(await mcpStatus(base, g5.access), 401, "role change ends access");
  expectOAuthError(await refresh(base, A, g5.refresh), 400, "invalid_grant", "role change ends refresh");
  assert.equal((await grants(base, manager.id)).find((grant) => grant.id === g5Id).revokedReason, "account_changed");
  const demotedTry = await signIn(base, await begin(base, A, { challenge: probe.challenge }), manager.username, manager.password);
  assert.ok(demotedTry.response.status === 403 && !demotedTry.response.text.includes("Allow this application"), "a viewer cannot approve");
  expect(await owner(base, "/api/users/" + manager.id + "/role", { method: "POST", json: { role: "content-manager" } }), 200, "promote again");
  assert.equal(await mcpStatus(base, g5.access), 401, "promotion revives nothing");
  const g6 = await grantFor(base, A, manager);
  expect(await owner(base, "/api/users/" + manager.id + "/revoke", { method: "POST" }), 200, "revoke account");
  assert.equal(await mcpStatus(base, g6.access), 401, "account revocation ends access");
  const revokedTry = await signIn(base, await begin(base, A, { challenge: probe.challenge }), manager.username, manager.password);
  assert.equal(revokedTry.response.status, 403, "a revoked account cannot approve");
  expect(await owner(base, "/api/users/" + manager.id + "/approve", { method: "POST" }), 200, "re-approve");
  assert.equal(await mcpStatus(base, g6.access), 401, "re-approval revives nothing");
  expectOAuthError(await refresh(base, A, g6.refresh), 400, "invalid_grant", "re-approval revives no refresh token");
  let g7 = await grantFor(base, A, manager);
  assert.equal(await mcpStatus(base, g7.access), 200, "explicit new consent works");
  pass("role change and account revocation end grants immediately and durably; re-approval or promotion revives nothing");

  // 24. Transaction expiry.
  const stale = await begin(base, A, { challenge: probe.challenge });
  advance(OAUTH_TRANSACTION_TTL_MS + 1000);
  assert.equal((await signIn(base, stale, manager.username, manager.password)).response.status, 400, "expired transaction");
  pass("authorization transactions expire after " + OAUTH_TRANSACTION_TTL_MS / 60_000 + " minutes");

  // 25. Restart: clients, grants and tokens persist; in-memory transactions do not.
  const inflight = await signIn(base, await begin(base, A, { challenge: probe.challenge }), manager.username, manager.password);
  expect(inflight.response, 200, "consent before restart");
  const grantsBefore = await grants(base, manager.id);
  const originBefore = base;
  await restartMain();
  assert.equal(base, originBefore, "same origin, therefore the same issuer and resource");
  assert.equal((await decide(base, inflight, "allow")).status, 400, "transactions end with the process");
  assert.deepEqual((await grants(base, manager.id)).map((grant) => [grant.id, grant.revokedAt, grant.expiresAt]), grantsBefore.map((grant) => [grant.id, grant.revokedAt, grant.expiresAt]), "grant state persists");
  assert.equal(await mcpStatus(base, g7.access), 200, "access token survives restart");
  g7 = { ...tokensOf(expect(await refresh(base, A, g7.refresh), 200, "refresh after restart")), clientId: A };
  assert.equal(await mcpStatus(base, g7.access), 200, "rotated token after restart");
  expect(await begin(base, A, { challenge: probe.challenge }).then((value) => value.response), 200, "registered client persists");
  pass("restart: registered clients, grants, access and refresh tokens persist; in-flight browser transactions end");

  // 26. Configured username: changing or removing it refuses existing grants without deleting them.
  await restartMain({ oauthUser: otherManager.username });
  assert.equal(await mcpStatus(base, g7.access), 401, "grant of an account that is no longer configured is refused");
  expectOAuthError(await refresh(base, A, g7.refresh), 400, "invalid_grant", "refresh refused while not configured");
  assert.equal((await signIn(base, await begin(base, A, { challenge: probe.challenge }), manager.username, manager.password)).response.status, 401, "unconfigured account cannot sign in");
  expect((await signIn(base, await begin(base, A, { challenge: probe.challenge }), otherManager.username, otherManager.password)).response, 200, "the configured account can");
  await restartMain({ oauthUser: null });
  assert.equal(await mcpStatus(base, g7.access), 401, "no configured account: no OAuth access");
  assert.equal((await signIn(base, await begin(base, A, { challenge: probe.challenge }), manager.username, manager.password)).response.status, 401, "no configured account: nobody can sign in");
  await restartMain();
  assert.equal(await mcpStatus(base, g7.access), 200, "restoring the same configuration restores the unrevoked grant (no durable change was made)");
  pass("only the configured account's grants work; an omitted or changed username refuses OAuth sign-in and existing grants");

  // 27. Absolute 90-day grant lifetime.
  const g8 = await grantFor(base, A, manager);
  const g8Id = grantIdOf(runtime, g8.access);
  const g8Meta = (await grants(base, manager.id)).find((grant) => grant.id === g8Id);
  const end = Date.parse(g8Meta.expiresAt);
  clockOffset = end - Date.now() - 5 * 60_000;
  const nearEnd = tokensOf(expect(await refresh(base, A, g8.refresh), 200, "refresh shortly before the grant ends"));
  assert.ok(nearEnd.expiresIn <= 300 && nearEnd.expiresIn >= 1, "access token never outlives the grant");
  assert.equal((await grants(base, manager.id)).find((grant) => grant.id === g8Id).expiresAt, g8Meta.expiresAt, "rotation does not extend the grant");
  assert.equal(await mcpStatus(base, nearEnd.access), 200);
  clockOffset = end - Date.now() + 1000;
  expectOAuthError(await refresh(base, A, nearEnd.refresh), 400, "invalid_grant", "grant ended after 90 days");
  assert.equal(await mcpStatus(base, nearEnd.access), 401, "no access after 90 days");
  const renewed = await grantFor(base, A, manager);
  assert.equal(await mcpStatus(base, renewed.access), 200, "a new explicit sign-in and consent starts a new grant");
  pass("grants end exactly 90 days after consent; rotation cannot extend them; renewal requires new sign-in and consent");

  // 28. Official SDK OAuth provider flow: discovery, registration, PKCE, code exchange, MCP and automatic refresh.
  const sdkAuth = await import("@modelcontextprotocol/sdk/client/auth.js");
  const memory = { client: undefined, tokens: undefined, verifier: undefined, authorizationUrl: undefined };
  const sdkState = "fictional-sdk-" + crypto.randomBytes(6).toString("hex");
  const provider = {
    get redirectUrl() { return TEST_CALLBACK; },
    get clientMetadata() { return { client_name: "Fictional SDK Connector", redirect_uris: [TEST_CALLBACK], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }; },
    state() { return sdkState; },
    clientInformation() { return memory.client; },
    saveClientInformation(information) { memory.client = information; },
    tokens() { return memory.tokens; },
    saveTokens(value) { memory.tokens = value; remember(value?.[ACCESS_FIELD]); remember(value?.[REFRESH_FIELD]); },
    redirectToAuthorization(url) { memory.authorizationUrl = url; },
    saveCodeVerifier(value) { memory.verifier = remember(value); },
    codeVerifier() { return memory.verifier; }
  };
  const mcpUrl = new URL(base + "/mcp");
  const firstTransport = new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider });
  const unauthenticated = new Client({ name: "fictional-sdk-oauth", version: "1.0.0" });
  let redirected = false;
  try { await unauthenticated.connect(firstTransport); }
  catch (error) { redirected = error instanceof sdkAuth.UnauthorizedError || /unauthori/i.test(String(error?.message)); }
  await unauthenticated.close().catch(() => {});
  assert.ok(redirected && memory.authorizationUrl, "SDK starts authorization after the /mcp challenge");
  assert.ok(PATTERNS.client.test(memory.client?.client_id ?? ""), "SDK registered a public client");
  const sdkUrl = new URL(memory.authorizationUrl);
  assert.ok(sdkUrl.origin + sdkUrl.pathname === base + "/oauth/authorize" && sdkUrl.searchParams.get("code_challenge_method") === "S256" && sdkUrl.searchParams.get("resource") === base + "/mcp" &&
    sdkUrl.searchParams.get("scope") === "trips:read " + SCOPE && sdkUrl.searchParams.get("state") === sdkState, "SDK authorization request uses S256, resource and the advertised scope");
  const sdkStart = await call(base, sdkUrl.pathname + sdkUrl.search);
  expect(sdkStart, 200, "SDK authorization page");
  const sdkSigned = await signIn(base, { cookie: transactionCookie(sdkStart), csrf: csrfOf(sdkStart.text) }, manager.username, manager.password);
  const sdkBack = callbackOf(expect(await decide(base, expect(sdkSigned.response, 200, "SDK consent") && sdkSigned, "allow"), 303, "SDK allow"));
  assert.ok(sdkBack.params.get("iss") === base && sdkBack.params.get("state") === sdkState, "SDK callback carries iss and state");
  await firstTransport.finishAuth(remember(sdkBack.params.get("code")));
  assert.ok(PATTERNS.access.test(memory.tokens?.[ACCESS_FIELD] ?? "") && PATTERNS.refresh.test(memory.tokens?.[REFRESH_FIELD] ?? ""), "SDK exchanged the code");
  const sdkClient = new Client({ name: "fictional-sdk-oauth", version: "1.0.0" });
  await sdkClient.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider })); sdkClients.push(sdkClient);
  assert.deepEqual((await sdkClient.listTools()).tools.map((tool) => tool.name).sort(), SIX_TOOLS, "SDK OAuth session tools");
  assert.ok(!(await sdkClient.callTool({ name: "list_trips", arguments: {} })).isError, "SDK OAuth read");
  await sdkClient.close(); sdkClients.splice(sdkClients.indexOf(sdkClient), 1);
  const refreshBefore = memory.tokens[REFRESH_FIELD];
  advance(ACCESS_TTL_MS + 1000);
  const refreshedClient = new Client({ name: "fictional-sdk-oauth", version: "1.0.0" });
  await refreshedClient.connect(new StreamableHTTPClientTransport(mcpUrl, { authProvider: provider })); sdkClients.push(refreshedClient);
  assert.ok(!(await refreshedClient.callTool({ name: "list_trips", arguments: {} })).isError, "SDK read after automatic refresh");
  assert.ok(memory.tokens[REFRESH_FIELD] !== refreshBefore, "SDK received a rotated refresh token");
  await refreshedClient.close(); sdkClients.splice(sdkClients.indexOf(refreshedClient), 1);
  pass("official SDK OAuth provider: discovery from the 401 challenge, registration, S256 + resource, code exchange, MCP use and automatic rotation");

  // 29. Digest-only storage and payload-free audit.
  const live = await grantFor(base, A, manager);
  const liveRow = runtime.db.prepare("SELECT token_hash,kind FROM oauth_tokens WHERE token_hash=?").get(sha256(live.access));
  assert.ok(liveRow && liveRow.kind === "access", "access token stored by SHA-256 digest");
  const text = databaseText(runtime.db);
  assert.ok(!secrets.some((value) => text.includes(value)), "no table contains a plaintext token, code, verifier, cookie, password or owner secret");
  const mainFile = path.join(temporary, "main", "shared-trip.sqlite");
  assert.ok(!filesContainAny([mainFile, mainFile + "-wal"], secrets), "nothing secret on disk");
  const events = expect(await owner(base, "/api/audit?limit=500"), 200, "audit").data.events;
  const has = (label, predicate) => assert.ok(events.some(predicate), "audit records " + label);
  has("registration", (e) => e.action === "oauth.register" && e.outcome === "accepted" && e.target === A);
  has("refused registration or authorization", (e) => e.action === "oauth.consent" && e.outcome === "refused" && e.reason === "invalid_redirect_uri");
  has("sign-in refusal", (e) => e.action === "oauth.login" && e.outcome === "refused" && e.reason === "sign_in_failed");
  has("sign-in", (e) => e.action === "oauth.login" && e.outcome === "accepted" && e.actor === manager.id);
  has("consent", (e) => e.action === "oauth.consent" && e.outcome === "accepted" && e.actor === manager.id && e.target === A);
  has("deny", (e) => e.action === "oauth.consent" && e.outcome === "refused" && e.reason === "access_denied");
  has("token issue", (e) => e.action === "oauth.token" && e.outcome === "accepted" && e.actor === manager.id && /^oag_/.test(e.target));
  has("PKCE refusal", (e) => e.action === "oauth.token" && e.outcome === "refused" && e.reason === "pkce_failed");
  has("code replay", (e) => e.action === "oauth.grant.revoke" && e.reason === "code_replay");
  has("rotation", (e) => e.action === "oauth.refresh" && e.outcome === "accepted");
  has("reuse", (e) => e.action === "oauth.refresh" && e.outcome === "refused" && e.reason === "refresh_reuse");
  has("family revocation", (e) => e.action === "oauth.grant.revoke" && e.reason === "refresh_reuse" && e.target === g1Id);
  has("owner revocation", (e) => e.action === "oauth.grant.revoke" && e.actor === "owner" && e.target === g4Id && e.outcome === "accepted");
  has("client revocation", (e) => e.action === "oauth.revoke" && e.outcome === "accepted");
  has("wrong route", (e) => e.action === "auth.refused" && e.actor === manager.id && e.reason === "oauth_token_wrong_route");
  has("expired token", (e) => e.action === "auth.refused" && e.actor === manager.id && e.reason === "oauth_token_expired");
  has("MCP write via OAuth", (e) => e.action === "trip.create" && e.channel === "mcp" && e.actor === manager.id && e.requestId === "oa-mcp-create");
  const auditText = JSON.stringify(events) + JSON.stringify(runtime.db.prepare("SELECT * FROM audit_log").all());
  for (const [kind, values] of [["secret", secrets], ["digest", secrets.map(sha256)], ["username", [OAUTH_USER, "fictional.other", "fictional.viewer"]], ["URL", ["http://", "https://", "chatgpt", "fictional.invalid"]],
    ["state", ["fictional-main", "fictional-error-state", sdkState]], ["title", TITLES], ["client name", ["Fictional Connector", "<script"]]]) assert.ok(!values.some((value) => auditText.includes(value)), "audit contains no " + kind);
  pass("digest-only persistence on disk; OAuth lifecycle, refusals, rotation and revocation audited without payloads, names, URLs or secrets");

  // 30. Shared sign-in limiter (separate server).
  const limits = await start("limits");
  const limitsManager = await makeAccount(limits.url, OAUTH_USER, { role: "content-manager" });
  const limitsClient = expect(await register(limits.url, { redirect_uris: [TEST_CALLBACK] }), 201, "register").data.client_id;
  let attempt = await begin(limits.url, limitsClient, { challenge: probe.challenge });
  for (let index = 0; index < 10; index++) { attempt = await signIn(limits.url, attempt, limitsManager.username, newSecret()); assert.equal(attempt.response.status, 401); }
  const limited = await signIn(limits.url, attempt, limitsManager.username, limitsManager.password);
  assert.ok(limited.response.status === 429 && !limited.response.text.includes("Allow this application"), "limiter blocks even the correct password");
  assert.equal((await siteLogin(limits.url, limitsManager)).status, 429, "the limiter is the existing site sign-in limiter");
  await stop(limits);
  pass("OAuth sign-in uses the existing password verification and its shared attempt limiter");

  // 31. Registration strictness, rate limit and bounded capacity (separate servers).
  const regTricks = await start("registration-a");
  for (const uri of [PRODUCTION_CALLBACK + "/", PRODUCTION_CALLBACK + "?x=1", PRODUCTION_CALLBACK + "#f", "https://chatgpt.com.attacker.fictional.invalid/connector_platform_oauth_redirect",
    "https://sub.chatgpt.com/connector_platform_oauth_redirect", "http://chatgpt.com/connector_platform_oauth_redirect", "https://CHATGPT.COM/connector_platform_oauth_redirect",
    "https://chatgpt.com:443/connector_platform_oauth_redirect", "https://user@chatgpt.com/connector_platform_oauth_redirect", "https://chatgpt.com/connector_platform_oauth_redirect%2F",
    "https://chatgpt.com/*", "https://chatgpt.com/x/../connector_platform_oauth_redirect", " " + PRODUCTION_CALLBACK]) {
    expectOAuthError(await register(regTricks.url, { redirect_uris: [uri] }), 400, "invalid_redirect_uri", "redirect variant refused");
  }
  expect(await register(regTricks.url, { redirect_uris: [PRODUCTION_CALLBACK], logo_uri: "https://logo.fictional.invalid/x.png", x_fictional_note: "ignored" }), 201, "informational fields are ignored");
  expectOAuthError(await register(regTricks.url, { redirect_uris: [PRODUCTION_CALLBACK], ["id_" + "token_signed_response_alg"]: "none" }), 400, "invalid_client_metadata", "unknown security field");
  await stop(regTricks);
  const regStrict = await start("registration-b");
  const strictCases = [
    [{ redirect_uris: [] }, "invalid_redirect_uri"], [{}, "invalid_redirect_uri"], [{ redirect_uris: Array(6).fill(TEST_CALLBACK) }, "invalid_redirect_uri"], [{ redirect_uris: [TEST_CALLBACK, TEST_CALLBACK] }, "invalid_redirect_uri"],
    [{ redirect_uris: [5] }, "invalid_redirect_uri"], [{ redirect_uris: [TEST_CALLBACK], token_endpoint_auth_method: "client_secret_basic" }, "invalid_client_metadata"],
    [{ redirect_uris: [TEST_CALLBACK], grant_types: ["client_credentials"] }, "invalid_client_metadata"], [{ redirect_uris: [TEST_CALLBACK], grant_types: ["implicit", "authorization_code"] }, "invalid_client_metadata"],
    [{ redirect_uris: [TEST_CALLBACK], grant_types: ["refresh_token"] }, "invalid_client_metadata"], [{ redirect_uris: [TEST_CALLBACK], response_types: ["token"] }, "invalid_client_metadata"],
    [{ redirect_uris: [TEST_CALLBACK], scope: "admin" }, "invalid_client_metadata"], [{ redirect_uris: [TEST_CALLBACK], jwks: { keys: [] } }, "invalid_client_metadata"],
    [{ redirect_uris: [TEST_CALLBACK], ["client_" + "secret"]: "fictional" }, "invalid_client_metadata"], [{ redirect_uris: [TEST_CALLBACK], software_statement: "x.y.z" }, "invalid_client_metadata"],
    [{ redirect_uris: [TEST_CALLBACK], client_name: "   " }, "invalid_client_metadata"], [{ redirect_uris: [TEST_CALLBACK], client_name: "x".repeat(101) }, "invalid_client_metadata"],
    [{ redirect_uris: [TEST_CALLBACK], client_name: "Fictional‮evil" }, "invalid_client_metadata"], [[TEST_CALLBACK], "invalid_client_metadata"]
  ];
  let attempts = 0;
  for (const [body, error] of strictCases) { attempts++; expectOAuthError(await register(regStrict.url, body), 400, error, "strict registration metadata"); }
  attempts++; expectOAuthError(await call(regStrict.url, "/oauth/register", { method: "POST", raw: "{\"redirect_uris\":", headers: { "Content-Type": "application/json" } }), 400, "invalid_client_metadata", "malformed JSON");
  attempts++; expectOAuthError(await call(regStrict.url, "/oauth/register", { method: "POST", form: [["redirect_uris", TEST_CALLBACK]] }), 400, "invalid_client_metadata", "form body");
  attempts++; expectOAuthError(await register(regStrict.url, { redirect_uris: [TEST_CALLBACK], client_uri: "x".repeat(9000) }), 400, "invalid_client_metadata", "oversized body");
  while (attempts < 30) { attempts++; expect(await register(regStrict.url, { redirect_uris: [TEST_CALLBACK] }), 201, "registration within the limit"); }
  expectOAuthError(await register(regStrict.url, { redirect_uris: [TEST_CALLBACK] }), 429, "temporarily_unavailable", "registration rate limit");
  // Capacity (store level): only never-authorized registrations older than a day are evictable.
  const store = regStrict.oauth;
  const used = store.getClient(regStrict.db.prepare("SELECT id FROM oauth_clients ORDER BY created_at LIMIT 1").get().id);
  regStrict.db.prepare("UPDATE oauth_clients SET authorized_at=?, created_at=? WHERE id=?").run(new Date(clock()).toISOString(), "2000-01-01T00:00:00.000Z", used.id);
  regStrict.db.exec("BEGIN");
  const insert = regStrict.db.prepare("INSERT INTO oauth_clients (id,client_name,redirect_uris,created_at,authorized_at) VALUES (?,?,?,?,NULL)");
  for (let index = regStrict.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get().n; index < MAX_OAUTH_CLIENTS; index++) insert.run("ocl_" + crypto.randomBytes(16).toString("base64url"), "Fictional bulk", JSON.stringify([TEST_CALLBACK]), new Date(clock()).toISOString());
  regStrict.db.exec("COMMIT");
  assert.equal(store.registerClient({ clientName: "Fictional full", redirectUris: [TEST_CALLBACK] }, clock()), null, "capacity is bounded");
  const evictable = regStrict.db.prepare("SELECT id FROM oauth_clients WHERE authorized_at IS NULL LIMIT 1").get().id;
  regStrict.db.prepare("UPDATE oauth_clients SET created_at=? WHERE id=?").run("2000-01-01T00:00:00.000Z", evictable);
  assert.ok(store.registerClient({ clientName: "Fictional replacement", redirectUris: [TEST_CALLBACK] }, clock()), "an old never-used registration is evicted at capacity");
  assert.ok(store.getClient(used.id) && !store.getClient(evictable), "used registrations persist; only the stale unused one was removed");
  await stop(regStrict);
  pass("registration: exact production callback only (no suffix/subdomain/scheme/port/userinfo/encoding/query/fragment tricks), strict metadata, rate limit and capacity that never evicts used clients");

  // 32. No eligible account when the username is omitted (fresh server).
  const none = await start("no-oauth-user", { oauthUser: null });
  const noneManager = await makeAccount(none.url, OAUTH_USER, { role: "content-manager" });
  const noneClient = expect(await register(none.url, { redirect_uris: [TEST_CALLBACK] }), 201, "register").data.client_id;
  const noneTry = await signIn(none.url, await begin(none.url, noneClient, { challenge: probe.challenge }), noneManager.username, noneManager.password);
  assert.ok(noneTry.response.status === 401 && !noneTry.response.text.includes("Allow this application"), "no account can approve without configuration");
  assert.equal(none.db.prepare("SELECT COUNT(*) AS n FROM oauth_codes").get().n, 0, "no code was issued");
  await stop(none);
  pass("without SHARED_TRIP_OAUTH_USERNAME no account can sign in or approve");

  // 33. Cleanup never outruns replay detection (separate server, injected clock, sweep and restart).
  const DAY_MS = 24 * 60 * 60_000;
  let retention = await start("retention");
  const retentionManager = await makeAccount(retention.url, OAUTH_USER, { role: "content-manager" });
  const retentionClient = expect(await register(retention.url, { client_name: "Fictional Retention Connector", redirect_uris: [TEST_CALLBACK] }), 201, "register").data.client_id;
  const tokenRow = (rt, value) => rt.db.prepare("SELECT kind,used_at FROM oauth_tokens WHERE token_hash=?").get(sha256(value));
  const codeRow = (rt, value) => rt.db.prepare("SELECT grant_id FROM oauth_codes WHERE code_hash=?").get(sha256(value));
  const rowCount = (rt, table) => rt.db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
  const consentedAt = clock();
  const flowRotated = await obtainCode(retention.url, retentionClient, retentionManager);
  const flowCode = await obtainCode(retention.url, retentionClient, retentionManager);
  const flowQuiet = await obtainCode(retention.url, retentionClient, retentionManager);
  const rotated0 = tokensOf(expect(await exchange(retention.url, flowRotated), 200, "exchange (refresh-replay family)"));
  const code0 = tokensOf(expect(await exchange(retention.url, flowCode), 200, "exchange (code-replay family)"));
  const quiet0 = tokensOf(expect(await exchange(retention.url, flowQuiet), 200, "exchange (untouched family)"));
  const rotated1 = tokensOf(expect(await refresh(retention.url, retentionClient, rotated0.refresh), 200, "first rotation (refresh-replay family)"));
  const quiet1 = tokensOf(expect(await refresh(retention.url, retentionClient, quiet0.refresh), 200, "first rotation (untouched family)"));
  const rotatedGrant = grantIdOf(retention, rotated1.access);
  const codeGrant = grantIdOf(retention, code0.access);
  const quietGrant = grantIdOf(retention, quiet1.access);
  advance(15 * DAY_MS); // past the former 14-day tombstone window, well inside the fixed 90-day grant
  retention.oauth.sweep(clock());
  assert.ok(Number.isInteger(tokenRow(retention, rotated0.refresh)?.used_at) && Number.isInteger(tokenRow(retention, quiet0.refresh)?.used_at), "rotated refresh digests survive cleanup while their grant is live");
  assert.ok(Boolean(codeGrant) && codeRow(retention, flowCode.code)?.grant_id === codeGrant, "a used code keeps its grant link while that grant is live");
  assert.equal(retention.db.prepare("SELECT COUNT(*) AS n FROM oauth_tokens WHERE kind='access'").get().n, 0, "expired access tokens are removed by cleanup");
  retention = await restartOnSamePort(retention, "retention");
  retention.oauth.sweep(clock());
  // Refresh-token replay after cleanup and restart ends the whole family, including fresh tokens.
  const rotated2 = tokensOf(expect(await refresh(retention.url, retentionClient, rotated1.refresh), 200, "rotation after cleanup and restart"));
  assert.equal(await mcpStatus(retention.url, rotated2.access), 200, "fresh access token works after cleanup and restart");
  expectOAuthError(await refresh(retention.url, retentionClient, rotated0.refresh), 400, "invalid_grant", "replay of a refresh token rotated more than 14 days ago");
  assert.equal(await mcpStatus(retention.url, rotated2.access), 401, "refresh replay revokes the fresh access token");
  expectOAuthError(await refresh(retention.url, retentionClient, rotated2.refresh), 400, "invalid_grant", "refresh replay revokes the latest refresh token");
  expectOAuthError(await refresh(retention.url, retentionClient, rotated1.refresh), 400, "invalid_grant", "earlier refresh tokens stay refused");
  // Code replay after cleanup and restart ends the grant the code produced.
  const code1 = tokensOf(expect(await refresh(retention.url, retentionClient, code0.refresh), 200, "code family still usable after cleanup and restart"));
  assert.equal(await mcpStatus(retention.url, code1.access), 200, "fresh access token of the code family works");
  expectOAuthError(await exchange(retention.url, flowCode), 400, "invalid_grant", "code replay more than a day after use");
  assert.equal(await mcpStatus(retention.url, code1.access), 401, "code replay revokes the fresh access token");
  expectOAuthError(await refresh(retention.url, retentionClient, code1.refresh), 400, "invalid_grant", "code replay revokes the latest refresh token");
  const retentionGrants = await grants(retention.url, retentionManager.id);
  const reasonOf = (id) => retentionGrants.find((grant) => grant.id === id)?.revokedReason ?? "none";
  assert.ok(reasonOf(rotatedGrant) === "refresh_reuse" && reasonOf(codeGrant) === "code_replay", "each family ended for its replay reason");
  assert.ok(retentionGrants.find((grant) => grant.id === quietGrant)?.active === true, "an unrelated family is untouched");
  const quiet2 = tokensOf(expect(await refresh(retention.url, retentionClient, quiet1.refresh), 200, "unrelated family still rotates"));
  // Bounded cleanup: past the fixed horizon nothing is kept; ended grants go after their retention.
  clockOffset = consentedAt + GRANT_LIFETIME_MS + DAY_MS - Date.now();
  retention.oauth.sweep(clock());
  assert.ok(rowCount(retention, "oauth_tokens") === 0 && rowCount(retention, "oauth_codes") === 0, "after the 90-day horizon no token or code digest remains");
  assert.ok(rowCount(retention, "oauth_grants") === 1 && !retention.db.prepare("SELECT id FROM oauth_grants WHERE revoked_at IS NOT NULL").get(), "revoked grants are removed after their retention; the just-expired grant remains as metadata");
  expectOAuthError(await refresh(retention.url, retentionClient, quiet2.refresh), 400, "invalid_grant", "nothing outlives the fixed 90-day horizon");
  await stop(retention);
  pass("cleanup keeps rotated refresh and used code digests while their grant is live: replay after 14+ days, sweep and restart still ends the whole family; storage is still bounded by the 90-day horizon");

  // 34. Snapshots of a live v5 database: validation, restore and tamper rejection.
  const v5Snapshot = path.join(temporary, "oauth-v5.sqlite");
  await snapshotDatabase(mainFile, v5Snapshot);
  validateSnapshot(v5Snapshot);
  const restoredDir = path.join(temporary, "oauth-restored");
  execFileSync(process.execPath, ["server/cli/restore.mjs", v5Snapshot], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: restoredDir }, stdio: "pipe" });
  const restored = await start("oauth-restored");
  assert.deepEqual((await grants(restored.url, manager.id)).map((grant) => [grant.id, grant.revokedAt]), (await grants(base, manager.id)).map((grant) => [grant.id, grant.revokedAt]), "grant state survives restore");
  assert.ok(restored.oauth.getClient(A), "registered clients survive restore");
  await stop(restored);
  const tamper = (name, sql) => { const file = path.join(temporary, name); fs.copyFileSync(v5Snapshot, file); const db = new DatabaseSync(file); db.exec(sql); db.close(); return file; };
  assert.throws(() => validateSnapshot(tamper("t-token.sqlite", "UPDATE oauth_tokens SET token_hash='plaintext' WHERE rowid=(SELECT MIN(rowid) FROM oauth_tokens)")), /Invalid OAuth token/);
  assert.throws(() => validateSnapshot(tamper("t-kind.sqlite", "PRAGMA ignore_check_constraints=ON; UPDATE oauth_tokens SET kind='owner' WHERE rowid=(SELECT MIN(rowid) FROM oauth_tokens)")), /Invalid OAuth token/);
  assert.throws(() => validateSnapshot(tamper("t-scope.sqlite", "UPDATE oauth_grants SET scope='admin' WHERE rowid=(SELECT MIN(rowid) FROM oauth_grants)")), /Invalid OAuth grant/);
  assert.throws(() => validateSnapshot(tamper("t-orphan.sqlite", "PRAGMA foreign_keys=OFF; UPDATE oauth_grants SET user_id='usr_missing000000' WHERE rowid=(SELECT MIN(rowid) FROM oauth_grants)")), /Invalid OAuth grant/);
  assert.throws(() => validateSnapshot(tamper("t-reason.sqlite", "UPDATE oauth_grants SET revoked_at='2030-01-01T00:00:00.000Z', revoked_reason='because' WHERE rowid=(SELECT MIN(rowid) FROM oauth_grants)")), /Invalid OAuth grant/);
  assert.throws(() => validateSnapshot(tamper("t-client.sqlite", "UPDATE oauth_clients SET redirect_uris='not json' WHERE rowid=(SELECT MIN(rowid) FROM oauth_clients)")), /Invalid OAuth client/);
  assert.throws(() => validateSnapshot(tamper("t-code.sqlite", "UPDATE oauth_codes SET code_challenge='plain' WHERE rowid=(SELECT MIN(rowid) FROM oauth_codes)")), /Invalid OAuth code/);
  pass("v5 snapshots validate and restore with grants/clients; tampered digests, kinds, scopes, references, reasons, clients and codes are rejected");

  // 35. Fictional schema-v4 database -> v5: additive, idempotent, validated pre-migration snapshot, rollback copy.
  const v4 = await start("schema-v4");
  const v4Trip = expect(await owner(v4.url, "/api/trips", { method: "POST", json: { requestId: "v4-create", trip: { title: "Fictional V4 Coast" } } }), 201, "v4 trip").data.trip;
  const v4Edit = { requestId: "v4-edit", expectedVersion: 1, changes: [{ type: "upsert_day", day: { id: "v4-day", date: "2031-08-01", slots: [{ id: "v4-plan", name: "Invented quay", time: "09:00" }] } }] };
  const v4Result = expect(await owner(v4.url, "/api/trips/" + v4Trip.id + "/changes", { method: "POST", json: v4Edit }), 200, "v4 edit").data;
  const v4Manager = await makeAccount(v4.url, OAUTH_USER, { role: "content-manager" });
  await makeAccount(v4.url, "fictional.pending", { approve: false });
  const v4Credential = expect(await owner(v4.url, "/api/users/" + v4Manager.id + "/mcp-tokens", { method: "POST", json: { label: "Fictional v4" } }), 201, "v4 MCP credential").data;
  remember(v4Credential.secret);
  await stop(v4);
  const v4File = path.join(temporary, "schema-v4", "shared-trip.sqlite");
  const downgrade = new DatabaseSync(v4File);
  // Schema maintenance: later releases add tables (v6 trip_tombstones); drop them too for a genuine v4 fixture.
  downgrade.exec("DROP TABLE IF EXISTS trip_tombstones; DROP TABLE oauth_tokens; DROP TABLE oauth_codes; DROP TABLE oauth_grants; DROP TABLE oauth_clients; PRAGMA user_version=4");
  const v4Rows = (db) => JSON.stringify(["trips", "request_log", "users", "invitations", "mcp_tokens", "audit_log"].map((table) => db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()));
  const priorRows = v4Rows(downgrade);
  assert.equal(downgrade.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'oauth_%'").get().n, 0, "fixture is a genuine v4 schema");
  downgrade.close();
  validateSnapshot(v4File);
  const upgraded = await start("schema-v4");
  assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION); assert.ok(SCHEMA_VERSION >= 5, "current schema includes the v5 OAuth tables");
  assert.ok(v4Rows(upgraded.db) === priorRows, "every v4 row (trips, retry log, accounts, invitations, MCP credentials, audit) is preserved");
  assert.equal(upgraded.db.prepare("SELECT COUNT(*) AS n FROM oauth_clients").get().n, 0, "OAuth tables start empty");
  const preV5 = () => fs.readdirSync(path.join(temporary, "schema-v4")).filter((file) => new RegExp("^shared-trip\\.sqlite\\.before-v" + SCHEMA_VERSION + "-\\d+$").test(file));
  assert.equal(preV5().length, 1, "one pre-migration snapshot");
  const retainedFile = path.join(temporary, "schema-v4", preV5()[0]);
  const retained = new DatabaseSync(retainedFile, { readOnly: true });
  assert.ok(retained.prepare("PRAGMA user_version").get().user_version === 4 && v4Rows(retained) === priorRows, "pre-migration snapshot holds the exact v4 data");
  retained.close();
  validateSnapshot(retainedFile);
  assert.deepEqual(expect(await owner(upgraded.url, "/api/trips/" + v4Trip.id + "/changes", { method: "POST", json: v4Edit }), 200, "replay after upgrade").data, v4Result, "durable retry replays after upgrade");
  assert.equal(await mcpStatus(upgraded.url, v4Credential.secret), 200, "v4 MCP credential still works");
  const v4Client = expect(await register(upgraded.url, { redirect_uris: [TEST_CALLBACK] }), 201, "register on upgraded").data.client_id;
  const v4Grant = await grantFor(upgraded.url, v4Client, v4Manager);
  const v4Session = await mcpSession(upgraded.url, v4Grant.access);
  assert.equal((await v4Session.tool("get_trip",{tripId:v4Trip.id})).isError,true,"migration never grants managers legacy membership");
  grantFixtureMembership(upgraded,v4Trip.id,v4Manager.id);
  assert.equal((await v4Session.tool("get_trip", { tripId: v4Trip.id })).data.trip.days[0].slots[0].name, "Invented quay", "migrated account reads migrated trip through OAuth");
  await v4Session.close();
  await stop(upgraded);
  const again = await start("schema-v4");
  assert.ok(again.db.prepare("PRAGMA user_version").get().user_version === SCHEMA_VERSION && preV5().length === 1, "migration is idempotent and does not re-snapshot");
  await stop(again);
  // Rollback: the retained copy is a complete v4 database that can replace the upgraded file.
  const rollbackDir = path.join(temporary, "rollback"); fs.mkdirSync(rollbackDir);
  fs.copyFileSync(retainedFile, path.join(rollbackDir, "shared-trip.sqlite"));
  const rolledBack = new DatabaseSync(path.join(rollbackDir, "shared-trip.sqlite"), { readOnly: true });
  assert.ok(rolledBack.prepare("PRAGMA user_version").get().user_version === 4 && v4Rows(rolledBack) === priorRows && rolledBack.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'oauth_%'").get().n === 0, "rollback copy is the untouched v4 database");
  rolledBack.close();
  validateSnapshot(path.join(rollbackDir, "shared-trip.sqlite"));
  const fromV4 = path.join(temporary, "restored-from-v4");
  execFileSync(process.execPath, ["server/cli/restore.mjs", retainedFile], { cwd: repoRoot, env: { ...process.env, SHARED_TRIP_DATA_DIR: fromV4 }, stdio: "pipe" });
  const restoredV4 = await start("restored-from-v4");
  assert.ok(restoredV4.db.prepare("PRAGMA user_version").get().user_version === SCHEMA_VERSION && v4Rows(restoredV4.db) === priorRows, "a restored v4 snapshot upgrades with every row preserved");
  await stop(restoredV4);
  // A pre-migration snapshot that fails validation stops the upgrade and changes nothing.
  const brokenDir = path.join(temporary, "broken-v4"); fs.mkdirSync(brokenDir);
  fs.copyFileSync(retainedFile, path.join(brokenDir, "shared-trip.sqlite"));
  const broken = new DatabaseSync(path.join(brokenDir, "shared-trip.sqlite"));
  broken.exec("UPDATE mcp_tokens SET token_hash='not-a-digest'"); broken.close();
  await assert.rejects(start("broken-v4"), /Pre-migration snapshot failed validation/);
  const untouched = new DatabaseSync(path.join(brokenDir, "shared-trip.sqlite"), { readOnly: true });
  assert.ok(untouched.prepare("PRAGMA user_version").get().user_version === 4 && untouched.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'oauth_%'").get().n === 0, "a failed snapshot validation leaves the database at v4");
  untouched.close();
  pass("schema v4 -> v5: additive and idempotent, validated pre-migration snapshot, untouched rollback copy, restorable, and an invalid snapshot blocks the upgrade");
} finally {
  for (const sdk of sdkClients) await sdk.close().catch(() => {});
  for (const item of running.reverse()) await item.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log("OAuth checks passed.");
