// Read-only MCP protocol check using the official MCP SDK (pinned in package.json).
// It is NOT a verification of any named external AI application.
//
// Owner-run inputs (nothing is passed on the command line):
//   SHARED_TRIP_MCP_URL         exact https://<host>[:port]/mcp endpoint (loopback http only for disposable tests)
//   SHARED_TRIP_MCP_TOKEN_FILE  absolute path, outside this checkout, to an owner-provisioned private file
//                               holding one dedicated content-manager credential (stm_ + 43 base64url chars)
//
// The check initializes a stateless Streamable HTTP session, lists tools, and calls list_trips only.
// It never calls create_trip, apply_trip_changes, import_trip or any other mutating tool; a request
// guard additionally refuses every outgoing JSON-RPC message other than the read-only allowlist.
// Output is one bounded JSON line: check label, status, public tool names and a safe failure code.
// It never prints the endpoint, file path, credential, user label, role claims, error text or trip data.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const TIMEOUT_MS = 15_000;
const TOKEN_SHAPE = /^stm_[A-Za-z0-9_-]{43}$/;
const MAX_TOKEN_FILE_BYTES = 256;
const EXPECTED_TOOLS = ["list_trips", "get_trip", "create_trip", "apply_trip_changes", "import_trip", "export_trip"];
const FORBIDDEN_TOOL = /account|credential|security|token|secret|password|passkey|session|invit|user|admin|role|permission|auth|key/i;
const MAX_TOOL_PAGES = 5;

class CheckFailure extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new CheckFailure(code); };

const report = {
  check: "official-mcp-sdk-read-only-protocol-check",
  scope: "Official MCP SDK client protocol check only. Not a verification of any named external AI application.",
  readOnly: true,
  status: "failed",
  steps: { initialize: "not_run", listTools: "not_run", listTrips: "not_run" },
  tools: [],
  missingTools: [],
  code: "unknown_failure"
};

let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  if (code) { report.status = "failed"; report.code = code; }
  else { report.status = "passed"; report.code = "ok"; }
  process.stdout.write(JSON.stringify(report) + "\n");
  process.exitCode = code ? 1 : 0;
  // Do not let a stuck handle keep the process alive after the result is printed.
  setTimeout(() => process.exit(process.exitCode), 2_000).unref();
}
// Never surface original exception text or stacks.
process.on("uncaughtException", () => finish("unexpected_error"));
process.on("unhandledRejection", () => finish("unexpected_error"));

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

function readEndpoint() {
  const raw = process.env.SHARED_TRIP_MCP_URL;
  if (typeof raw !== "string" || raw === "" || raw.length > 2048 || /\s/.test(raw)) fail("endpoint_missing_or_invalid");
  if (raw.includes("?") || raw.includes("#")) fail("endpoint_query_or_fragment_refused");
  let url;
  try { url = new URL(raw); } catch { fail("endpoint_missing_or_invalid"); }
  if (url.username || url.password) fail("endpoint_credentials_refused");
  if (url.search || url.hash) fail("endpoint_query_or_fragment_refused");
  if (url.protocol === "http:") { if (!isLoopbackHost(url.hostname)) fail("endpoint_https_required"); }
  else if (url.protocol !== "https:") fail("endpoint_https_required");
  if (url.pathname !== "/mcp") fail("endpoint_path_must_be_mcp");
  return url;
}

function refuseTlsBypass() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") fail("tls_bypass_refused");
  const flags = [...process.execArgv, ...(process.env.NODE_OPTIONS || "").split(/\s+/)];
  if (flags.some((flag) => flag === "--insecure-http-parser")) fail("tls_bypass_refused");
}

function isInside(root, candidate) {
  const norm = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = path.relative(norm(root), norm(candidate));
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
}

async function readToken() {
  const raw = process.env.SHARED_TRIP_MCP_TOKEN_FILE;
  if (typeof raw !== "string" || raw === "" || !path.isAbsolute(raw)) fail("token_file_missing_or_not_absolute");
  let real, checkout, cwd;
  try {
    real = await fs.realpath(raw);
    checkout = await fs.realpath(fileURLToPath(new URL("..", import.meta.url)));
    cwd = await fs.realpath(process.cwd());
  } catch { fail("token_file_unreadable"); }
  if (isInside(checkout, real) || isInside(cwd, real)) fail("token_file_inside_checkout_refused");
  let text;
  let handle;
  try {
    handle = await fs.open(real, "r"); // read-only; this script never creates, writes or chmods credential files
    const info = await handle.stat();
    if (!info.isFile()) fail("token_file_not_regular");
    if (info.size > MAX_TOKEN_FILE_BYTES) fail("token_shape_refused");
    text = await handle.readFile({ encoding: "utf8" });
  } catch (error) {
    if (error instanceof CheckFailure) throw error;
    fail("token_file_unreadable");
  } finally {
    await handle?.close().catch(() => {});
  }
  const token = text.replace(/\r?\n$/, "");
  if (!TOKEN_SHAPE.test(token)) fail("token_shape_refused");
  // The shape check already refuses typical owner secrets; also refuse an exact match with the
  // owner token if it happens to be present in this environment.
  const owner = typeof process.env.SHARED_TRIP_ADMIN_TOKEN === "string" ? Buffer.from(process.env.SHARED_TRIP_ADMIN_TOKEN) : null;
  const mine = Buffer.from(token);
  if (owner && owner.length === mine.length && crypto.timingSafeEqual(owner, mine)) fail("owner_token_refused");
  return token;
}

// Defense in depth: only the read-only JSON-RPC traffic this check needs may leave the process.
function allowedMessage(message) {
  if (!message || typeof message !== "object" || typeof message.method !== "string") return false;
  switch (message.method) {
    case "initialize":
    case "notifications/initialized":
    case "notifications/cancelled":
    case "tools/list":
      return true;
    case "tools/call": {
      const params = message.params || {};
      const args = params.arguments;
      return params.name === "list_trips" && (args === undefined ||
        (args && typeof args === "object" && !Array.isArray(args) && Object.keys(args).length === 0));
    }
    default:
      return false;
  }
}

function guardedFetch(endpoint, signal, state) {
  const inner = guardedFetchInner(endpoint, signal, state);
  return async (input, init) => {
    try { return await inner(input, init); }
    catch (error) {
      // Record the safe code so it survives any SDK error wrapping.
      if (error instanceof CheckFailure && !state.guardCode) state.guardCode = error.code;
      throw error;
    }
  };
}

function guardedFetchInner(endpoint, signal, state) {
  return async (input, init = {}) => {
    let target;
    try { target = new URL(input instanceof Request ? input.url : String(input)); } catch { fail("blocked_request"); }
    if (target.href !== endpoint.href) fail("blocked_request");
    const method = String(init.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method === "POST") {
      let parsed;
      try { parsed = JSON.parse(typeof init.body === "string" ? init.body : ""); } catch { fail("blocked_request"); }
      const messages = Array.isArray(parsed) ? parsed : [parsed];
      if (messages.length === 0 || !messages.every(allowedMessage)) fail("blocked_request");
    } else if (method !== "GET") {
      fail("blocked_request"); // GET is the optional read-only SSE listener; DELETE/PUT/etc. are refused
    }
    const signals = [signal, init.signal].filter(Boolean);
    let response;
    try {
      response = await fetch(target, { ...init, redirect: "error", signal: AbortSignal.any(signals) });
    } catch {
      if (method === "POST") state.networkError = true; // optional GET listener failures are not fatal
      fail(signal.aborted ? "timeout" : "network_error");
    }
    if (method === "POST" && !response.ok) state.httpStatus = response.status;
    return response;
  };
}

function classify(error, state, signal, stage) {
  if (error instanceof CheckFailure) return error.code;
  if (signal.aborted) return "timeout";
  if (state.guardCode === "blocked_request") return "blocked_request";
  if (state.httpStatus === 401 || state.httpStatus === 403) return "auth_rejected";
  if (state.httpStatus) return "http_error";
  if (state.networkError) return "network_error";
  return stage + "_failed";
}

async function listAllTools(client, options) {
  const tools = [];
  let cursor;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const result = await client.listTools(cursor ? { cursor } : {}, options);
    if (!result || !Array.isArray(result.tools)) fail("tool_list_invalid");
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) return tools;
  }
  fail("tool_list_too_long");
}

function checkInventory(tools) {
  const names = tools.map((tool) => tool?.name);
  if (!names.every((name) => typeof name === "string" && name.length > 0 && name.length <= 128)) fail("tool_list_invalid");
  report.tools = EXPECTED_TOOLS.filter((name) => names.includes(name));
  report.missingTools = EXPECTED_TOOLS.filter((name) => !names.includes(name));
  if (names.some((name) => FORBIDDEN_TOOL.test(name))) fail("forbidden_tools_exposed");
  if (new Set(names).size !== names.length) fail("duplicate_tools");
  if (names.some((name) => !EXPECTED_TOOLS.includes(name))) fail("unexpected_tools");
  if (report.missingTools.length) fail("required_tools_missing");
  const listTrips = tools.find((tool) => tool.name === "list_trips");
  if (listTrips?.annotations?.readOnlyHint !== true) fail("list_trips_not_read_only");
}

function checkListTrips(result) {
  if (!result || result.isError) fail("list_trips_tool_error");
  let payload = result.structuredContent;
  if (payload === undefined) {
    const first = Array.isArray(result.content) ? result.content[0] : undefined;
    try { payload = first?.type === "text" ? JSON.parse(first.text) : undefined; } catch { payload = undefined; }
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.trips)) fail("list_trips_shape_invalid");
  // Intentionally nothing about the trips (count, titles, IDs) is recorded or printed.
}

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const state = {};
  let stage = "config";
  let client;
  let timeoutReject;
  const hardTimeout = new Promise((_, reject) => { timeoutReject = reject; });
  controller.signal.addEventListener("abort", () => timeoutReject(new CheckFailure("timeout")), { once: true });
  try {
    await Promise.race([hardTimeout, (async () => {
      refuseTlsBypass();
      const endpoint = readEndpoint();
      const token = await readToken();
      const options = { signal: controller.signal, timeout: TIMEOUT_MS };

      client = new Client({ name: "shared-trip-read-only-check", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(endpoint, {
        requestInit: { headers: { Authorization: "Bearer " + token }, redirect: "error" },
        fetch: guardedFetch(endpoint, controller.signal, state)
      });

      stage = "initialize";
      await client.connect(transport, options);
      report.steps.initialize = "passed";

      stage = "list_tools";
      const tools = await listAllTools(client, options);
      report.steps.listTools = "fetched";
      checkInventory(tools);
      report.steps.listTools = "passed";

      stage = "list_trips";
      checkListTrips(await client.callTool({ name: "list_trips", arguments: {} }, undefined, options));
      report.steps.listTrips = "passed";
    })()]);
    finish(null);
  } catch (error) {
    const key = { initialize: "initialize", list_tools: "listTools", list_trips: "listTrips" }[stage];
    if (key && report.steps[key] !== "passed") report.steps[key] = "failed";
    finish(classify(error, state, controller.signal, stage));
  } finally {
    clearTimeout(timer);
    try { await client?.close(); } catch { /* close errors are never printed */ }
  }
}

await main();
