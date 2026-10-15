// Local OAuth fixture for manual browser checks (desktop and phone-sized viewports) of the sign-in and
// consent pages with fictional data only. Nothing here is a deployment.
//
//   node scripts/oauth-fixture-server.mjs [--port 4180] [--callback-port 4181] [--credentials-out <file outside the checkout>]
//
// It starts, on 127.0.0.1 only:
//   - the real Shared Trips service with a disposable data directory, two fictional trips, one
//     approved content-manager account configured as the OAuth account and one viewer account;
//   - a tiny fictional "connector" on the callback port that registers itself (RFC 7591), sends the
//     browser to /oauth/authorize with PKCE S256, state and resource, checks iss and state on return,
//     exchanges the code and lists trips through the official MCP SDK (read-only). After the callback
//     it answers 303 to a clean /result page, so no code or state stays in the visible URL; results
//     are kept in memory and show only outcomes and error codes, never tokens, codes or state.
// The generated fictional passwords and the disposable fixture owner secret (for local owner-grant UI
// checks against this fixture only; it is never a live owner credential) are written to a 0600 JSON
// file outside the checkout (default: inside the disposable directory) and are never printed.
// Stop with Ctrl+C; the disposable directory is then removed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) => { const index = args.indexOf(name); return index >= 0 && args[index + 1] ? args[index + 1] : fallback; };
const port = Number(option("--port", "4180"));
const callbackPort = Number(option("--callback-port", String(port + 1)));
if (![port, callbackPort].every((value) => Number.isInteger(value) && value > 0 && value < 65536) || port === callbackPort) throw new Error("Use two different valid ports.");

const repoRoot = fs.realpathSync(path.resolve(import.meta.dirname, ".."));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-oauth-fixture-"));
const credentialsFile = path.resolve(option("--credentials-out", path.join(temporary, "fictional-credentials.json")));
if (credentialsFile === repoRoot || credentialsFile.startsWith(repoRoot + path.sep)) throw new Error("Write fixture credentials outside the checkout.");

const ACCESS_FIELD = "access_token";
const OAUTH_USER = "fictional.oauth";
const callbackUrl = "http://127.0.0.1:" + callbackPort + "/callback";
const ownerSecret = crypto.randomBytes(32).toString("base64url");
const runtime = await startServer({
  ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerSecret, SHARED_TRIP_DATA_DIR: path.join(temporary, "data"), SHARED_TRIP_PORT: String(port), SHARED_TRIP_OAUTH_USERNAME: OAUTH_USER }),
  oauthRedirectUris: [callbackUrl]
});
const base = runtime.url;

async function api(route, { method = "GET", json, headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { ...(json ? { "Content-Type": "application/json" } : {}), ...headers }, body: json ? JSON.stringify(json) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error("Fixture setup failed at " + method + " " + route.replace(/usr_[^/]+/, ":id") + " (" + response.status + ")");
  return data;
}
const asOwner = (route, options = {}) => api(route, { ...options, headers: { Authorization: "Bearer " + ownerSecret } });
async function account(username, role) {
  const invitation = (await asOwner("/api/invitations", { method: "POST", json: {} })).invitation.token;
  const password = "Fictional-" + crypto.randomBytes(12).toString("base64url");
  await api("/api/accept-invite", { method: "POST", json: { invitation, username, password }, headers: { Origin: base } });
  const id = (await asOwner("/api/users")).accounts.find((entry) => entry.username === username).id;
  if (role) await asOwner("/api/users/" + id + "/role", { method: "POST", json: { role } });
  await asOwner("/api/users/" + id + "/approve", { method: "POST" });
  return { username, password, role: role || "viewer" };
}
for (const title of ["Fictional Harbor Weekend", "Fictional Mountain Loop"]) await asOwner("/api/trips", { method: "POST", json: { requestId: "fixture-" + title.length + "-" + title.slice(10, 14), trip: { title } } });
const accounts = [await account(OAUTH_USER, "content-manager"), await account("fictional.viewer")];
fs.mkdirSync(path.dirname(credentialsFile), { recursive: true });
const note = "Fictional local fixture only. ownerSecret is the disposable owner secret of this fixture run (local owner-grant UI checks); it is not a live owner credential. Only the content-manager account is configured for OAuth.";
fs.writeFileSync(credentialsFile, JSON.stringify({ note, ownerSecret, accounts }, null, 2) + "\n", { mode: 0o600 });
try { fs.chmodSync(credentialsFile, 0o600); } catch { /* best effort where the platform ignores modes */ }

// ------------------------------------------------------------------------------------------------
// Fictional connector

const pending = new Map(); // state -> verifier
let clientId = null;
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => "&#" + char.charCodeAt(0) + ";");
const view = (title, body) => "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>" + esc(title) +
  "</title></head><body style=\"font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;line-height:1.5\"><h1 style=\"font-size:1.3rem\">" + esc(title) + "</h1>" + body + "</body></html>";
const reply = (res, status, html, extra = {}) => { res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", ...extra }); res.end(html); };

async function registerClient() {
  if (clientId) return clientId;
  const response = await fetch(base + "/oauth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: "Fictional Fixture Connector", redirect_uris: [callbackUrl], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }) });
  if (response.status !== 201) throw new Error("registration_failed");
  clientId = (await response.json()).client_id;
  return clientId;
}

const results = new Map(); // opaque result id -> { status, title, body } (outcomes only, in memory)
const again = "<p><a href=\"/\">Start again</a></p>";

/** Verifies state and iss, exchanges the code and runs the read-only MCP check. Returns display data only. */
async function completeCallback(params) {
  try {
    const state = params.get("state");
    const verifier = pending.get(state);
    pending.delete(state);
    const issuerOk = params.get("iss") === base;
    if (!verifier || !issuerOk) return { status: 400, title: "Connection rejected", body: "<p>The response had an unknown state or an unexpected issuer (iss " + (issuerOk ? "matched" : "did not match") + ").</p>" + again };
    const error = params.get("error");
    if (error) return { status: 200, title: "Connection not approved", body: "<p>Result: <strong>" + esc(error) + "</strong> (iss and state verified).</p>" + again };
    const form = new URLSearchParams([["grant_type", "authorization_code"], ["code", params.get("code") || ""], ["redirect_uri", callbackUrl], ["client_id", clientId], ["code_verifier", verifier], ["resource", base + "/mcp"]]);
    const exchanged = await fetch(base + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    const tokens = await exchanged.json().catch(() => ({}));
    if (exchanged.status !== 200) return { status: 200, title: "Token exchange refused", body: "<p>Error: <strong>" + esc(tokens.error || exchanged.status) + "</strong></p>" + again };
    const sdk = new Client({ name: "fictional-fixture-connector", version: "1.0.0" });
    try {
      await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + tokens[ACCESS_FIELD] } } }));
      const tools = (await sdk.listTools()).tools.length;
      const listed = await sdk.callTool({ name: "list_trips", arguments: {} });
      const count = listed.structuredContent?.trips?.length ?? 0;
      return { status: 200, title: "Connected", body: "<p>Authorization completed (iss and state verified, PKCE S256). Through MCP the connector sees <strong>" + tools + "</strong> tools and <strong>" + count + "</strong> fictional trips.</p><p><a href=\"/\">Start another connection</a></p>" };
    } finally { await sdk.close().catch(() => {}); }
  } catch {
    return { status: 500, title: "Fixture error", body: "<p>The fixture could not complete this step.</p>" + again };
  }
}

const connector = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1:" + callbackPort);
    if (url.pathname === "/" && req.method === "GET") {
      reply(res, 200, view("Fictional connector", "<p>This page plays the role of an application that wants to connect to the local Shared Trips fixture.</p><p><a href=\"/start\" style=\"display:inline-block;padding:.7rem 1.1rem;border:2px solid #17362f;border-radius:10px\">Start connection</a></p>"));
      return;
    }
    if (url.pathname === "/start" && req.method === "GET") {
      const id = await registerClient();
      const verifier = crypto.randomBytes(32).toString("base64url");
      const state = crypto.randomBytes(16).toString("base64url");
      pending.set(state, verifier);
      if (pending.size > 50) pending.delete(pending.keys().next().value);
      const target = new URL(base + "/oauth/authorize");
      for (const [name, value] of [["response_type", "code"], ["client_id", id], ["redirect_uri", callbackUrl], ["scope", "trips:manage"], ["state", state],
        ["code_challenge", crypto.createHash("sha256").update(verifier).digest("base64url")], ["code_challenge_method", "S256"], ["resource", base + "/mcp"]]) target.searchParams.set(name, value);
      res.writeHead(302, { Location: target.href, "Cache-Control": "no-store" }); res.end();
      return;
    }
    if (url.pathname === "/callback" && req.method === "GET") {
      // Process once, keep only the rendered outcome in memory, and leave the callback URL (code, state, iss) behind.
      const outcome = await completeCallback(url.searchParams);
      const id = crypto.randomBytes(12).toString("base64url");
      results.set(id, outcome);
      if (results.size > 50) results.delete(results.keys().next().value);
      res.writeHead(303, { Location: "/result?id=" + id, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }); res.end();
      return;
    }
    if (url.pathname === "/result" && req.method === "GET") {
      const outcome = results.get(url.searchParams.get("id") || "");
      if (!outcome) { reply(res, 404, view("Result not found", "<p>This result is no longer available.</p><p><a href=\"/\">Start again</a></p>")); return; }
      reply(res, outcome.status, view(outcome.title, outcome.body));
      return;
    }
    reply(res, 404, view("Not found", "<p><a href=\"/\">Start</a></p>"));
  } catch {
    reply(res, 500, view("Fixture error", "<p>The fixture could not complete this step.</p><p><a href=\"/\">Start again</a></p>"));
  }
});
await new Promise((resolve, reject) => { connector.once("error", reject); connector.listen(callbackPort, "127.0.0.1", resolve); });

console.log("OAuth fixture ready (fictional data, loopback only).");
console.log("Open http://127.0.0.1:" + callbackPort + "/ and choose Start connection.");
console.log("Fictional account credentials file: " + credentialsFile);
console.log("Use Chrome device emulation for phone-sized checks. Press Ctrl+C to stop and remove the disposable data.");

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  await new Promise((resolve) => connector.close(() => resolve()));
  await runtime.close();
  fs.rmSync(temporary, { recursive: true, force: true });
  process.exit(0);
});
