// Home-page DOM regression for the owner-only "Browser connections (OAuth)" section inside the
// per-account assistant-access panel. Uses a fully stubbed same-origin API (no server, no network)
// and generated fictional data only: no real client, credential, token or redirect address.
// Covers owner load/empty/failure with manual Try again, active/expired/revoked states, plain-text
// client names, explicit single-attempt revoke, stale responses after Refresh, an account role
// change, a session change and sign-out, absence for non-owners, four languages, and a client
// module without the new methods. jsdom evidence only: no browser layout or device claim.
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const ORIGIN = "https://trips.fictional.test/";
const DAY = 86_400_000; const now = Date.now(); const iso = (offset) => new Date(now + offset).toISOString();
const EDITOR = "sample-editor"; const CURATOR = "sample-curator"; const VIEWER = "sample-viewer";
const EDITOR_ID = "acct-fictional-editor"; const CURATOR_ID = "acct-fictional-curator"; const VIEWER_ID = "acct-fictional-viewer";
// Generated placeholders that the page must never display, store or send.
const HIDDEN = ["fictional-client-alpha-0001", "fictional-client-beta-0002", "https://fictional-redirect.test/callback", "fictional-digest-0000aaaa", "fictional-bearer-value-0000bbbb"];
// Markup, a NUL, a zero-width space, a line separator and a right-to-left override (written as code points).
const INVISIBLE = [0x00, 0x200b, 0x2028, 0x202e];
const HOSTILE = '<img src=x onerror="window.__fictionalInjected=1">Fictional' + String.fromCodePoint(0x00) + " Helper" + String.fromCodePoint(0x200b, 0x2028, 0x202e) + "x".repeat(200);
const grant = (id, clientName, fields = {}) => ({
  id, clientId: HIDDEN[0], clientName, scope: "trips:manage", createdAt: iso(-10 * DAY), expiresAt: iso(30 * DAY), revokedAt: null, revokedReason: null,
  lastUsedAt: iso(-DAY), active: true, redirectUri: HIDDEN[2], tokenDigest: HIDDEN[3], ["accessToken"]: HIDDEN[4], ...fields
});

let role = "owner";
const accounts = [
  { id: EDITOR_ID, username: EDITOR, status: "approved", role: "content-manager" },
  { id: CURATOR_ID, username: CURATOR, status: "approved", role: "content-manager" },
  { id: VIEWER_ID, username: VIEWER, status: "approved", role: "viewer" }
];
const grants = new Map([
  [EDITOR_ID, [
    grant("grant-fictional-active", "Fictional Planner"),
    grant("grant-fictional-hostile", HOSTILE, { clientId: HIDDEN[1] }),
    grant("grant-fictional-expired", "Fictional Archive Bot", { expiresAt: iso(-2 * DAY), active: false, lastUsedAt: null }),
    grant("grant-fictional-revoked", "", { revokedAt: iso(-3 * DAY), revokedReason: "owner", active: false })
  ]],
  [CURATOR_ID, []]
]);

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refuse = (status) => reply(status, { error: { code: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "not_found", message: "Fictional refusal." } });
const clone = (value) => JSON.parse(JSON.stringify(value));
function route(method, pathname, body) {
  if (pathname === "/api/session" && method === "GET") {
    if (!role) return refuse(401);
    return reply(200, { authenticated: true, role, ...(role === "owner" ? {} : { username: EDITOR }), capabilities: { editTrips: true, importTrips: true, manageAccounts: role === "owner" } });
  }
  if (pathname === "/api/logout" && method === "POST") { role = null; return reply(200, { authenticated: false }); }
  if (!role) return refuse(401);
  if (pathname === "/api/trips" && method === "GET") return reply(200, { trips: [{ id: "fictional-trip-1", title: "Fictional Meadow Loop", version: 1, archived: false }] });
  const owner = role === "owner"; let match;
  if (pathname === "/api/users" && method === "GET") return owner ? reply(200, { accounts: clone(accounts), invitations: [] }) : refuse(403);
  if ((match = /^\/api\/users\/([^/]+)\/role$/.exec(pathname)) && method === "POST") {
    if (!owner) return refuse(403);
    const account = accounts.find((item) => item.id === decodeURIComponent(match[1])); if (!account) return refuse(404);
    account.role = JSON.parse(body).role; return reply(200, { account: clone(account) });
  }
  if (/^\/api\/users\/[^/]+\/mcp-tokens$/.test(pathname) && method === "GET") return owner ? reply(200, { tokens: [] }) : refuse(403);
  if ((match = /^\/api\/users\/([^/]+)\/oauth-grants$/.exec(pathname)) && method === "GET") {
    if (!owner) return refuse(403);
    const list = grants.get(decodeURIComponent(match[1])); return list ? reply(200, { grants: clone(list) }) : refuse(404);
  }
  if ((match = /^\/api\/users\/([^/]+)\/oauth-grants\/([^/]+)\/revoke$/.exec(pathname)) && method === "POST") {
    if (!owner) return refuse(403);
    const item = (grants.get(decodeURIComponent(match[1])) || []).find((entry) => entry.id === decodeURIComponent(match[2]));
    if (!item) return refuse(404);
    if (!item.revokedAt) Object.assign(item, { revokedAt: new Date().toISOString(), revokedReason: "owner", active: false });
    return reply(200, { grant: clone(item) });
  }
  return refuse(404);
}
const calls = []; let failNext = null; let holdNext = null;
const nativeFetch = globalThis.fetch; const nativeTimeout = globalThis.setTimeout; const timers = new Set();
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input, ORIGIN); const method = options.method || "GET"; const body = String(options.body || "");
  calls.push({ method, path: url.pathname, href: url.href, body });
  if (failNext && failNext.method === method && failNext.match.test(url.pathname)) {
    const { status } = failNext; failNext = null;
    return reply(status, { error: { code: "unavailable", message: "Fictional injected failure." } });
  }
  // Computed at request time, so a held reply carries the data of that moment (a stale response).
  const response = route(method, url.pathname, body);
  if (holdNext && holdNext.method === method && holdNext.match.test(url.pathname)) { const held = holdNext; holdNext = null; held.started = true; await held.gate; }
  return response;
};
function hold(method, match) { let open; const gate = new Promise((resolve) => { open = resolve; }); holdNext = { method, match, gate, open, started: false }; return holdNext; }
// The 20-second poll and write timeouts never fire; refreshes are triggered explicitly.
globalThis.setTimeout = (fn, delay, ...args) => { const timer = nativeTimeout(() => { timers.delete(timer); if (!(delay >= 20000)) fn(...args); }, delay); timer.unref(); timers.add(timer); return timer; };

const errors = []; let dom; let window; let doc;
async function boot(clientSpecifier) {
  const consoleBridge = new VirtualConsole();
  consoleBridge.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
  dom = new JSDOM(fs.readFileSync(new URL("../assets/selfhosted/index.html", import.meta.url), "utf8"), { url: ORIGIN, runScripts: "outside-only", virtualConsole: consoleBridge });
  window = dom.window; doc = window.document; window.SHARED_TRIP_HOSTED = true;
  for (const name of ["window", "document", "location", "localStorage", "sessionStorage", "FormData"]) Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
  const source = fs.readFileSync(new URL("../assets/selfhosted/home.js", import.meta.url), "utf8").replace('"/hosted-client.js?v=__CACHE_VERSION__"', JSON.stringify(clientSpecifier));
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
}
const byId = (id) => doc.getElementById(id);
const sleep = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
const idle = () => ![...doc.querySelectorAll("button")].some((node) => node.disabled);
const until = async (predicate, label) => { const end = Date.now() + 8000; while (!predicate()) { if (Date.now() > end) throw new Error("Timed out: " + label + " / status: " + (byId("status")?.textContent || "")); await sleep(10); } };
const refresh = () => window.dispatchEvent(new window.Event("focus"));
const clearStatus = () => { byId("status").textContent = ""; byId("status").dataset.error = "false"; };
const dump = (storage) => Array.from({ length: storage.length }, (_, index) => storage.key(index) + "=" + storage.getItem(storage.key(index))).join("\n");
const storageText = () => dump(window.localStorage) + "\n" + dump(window.sessionStorage);
const rowFor = (name) => [...(byId("account-list")?.querySelectorAll(".account-row") || [])].find((row) => row.querySelector("strong")?.textContent === name);
const section = (name) => rowFor(name)?.querySelector(".grant-section");
const grantRow = (id) => section(EDITOR)?.querySelector('.grant-row[data-grant-id="' + id + '"]');
const names = (name = EDITOR) => [...(section(name)?.querySelectorAll(".grant-name") || [])].map((node) => node.textContent);
const grantGets = () => calls.filter((call) => call.method === "GET" && /\/oauth-grants$/.test(call.path)).length;
const grantRevokes = () => calls.filter((call) => call.method === "POST" && /\/oauth-grants\/[^/]+\/revoke$/.test(call.path));
function assertNothingHidden() {
  const html = doc.documentElement.outerHTML;
  for (const value of HIDDEN) {
    assert.ok(!html.includes(value), "no client id, redirect address, digest or token value in the page");
    assert.ok(!storageText().includes(value), "nothing from a grant record in browser storage");
  }
  assert.equal(doc.querySelectorAll("[onerror], .grant-section img, .grant-section script, .grant-section a, .grant-section iframe").length, 0, "client names never become markup");
  assert.equal(window.__fictionalInjected, undefined, "no injected script ran");
}
async function openPanel(name) {
  await until(() => rowFor(name)?.querySelector(".token-toggle") && idle(), "token toggle for " + name);
  const toggle = rowFor(name).querySelector(".token-toggle");
  if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
}
async function chooseRole(name, value) {
  await until(() => rowFor(name) && idle(), "row for " + name);
  const select = rowFor(name).querySelector(".role-control select");
  select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await until(() => rowFor(name)?.querySelector(".role-pending button"), "save control for " + name);
  clearStatus(); rowFor(name).querySelector(".role-pending button").click();
  await until(() => rowFor(name)?.dataset.role === value && !rowFor(name).querySelector(".role-pending") && idle(), "role saved for " + name);
  assert.equal(byId("status").textContent, "Access level saved.");
}

const realClient = new URL("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__", import.meta.url).href;
try {
  await boot(realClient);
  const api = (await import(realClient)).hostedApi;

  // 0. Client methods: owner API paths with encoded segments; revoke is one POST with an empty body.
  assert.equal(typeof api.listOAuthGrants, "function"); assert.equal(typeof api.revokeOAuthGrant, "function");
  for (const name of ["listMcpTokens", "issueMcpToken", "revokeMcpToken"]) assert.equal(typeof api[name], "function", "token methods unchanged");
  await assert.rejects(api.listOAuthGrants("fictional/odd id"), (error) => error.status === 404);
  assert.ok(calls.some((call) => call.method === "GET" && call.path === "/api/users/fictional%2Fodd%20id/oauth-grants"), "list path encodes the account id");
  await assert.rejects(api.revokeOAuthGrant("fictional/odd id", "grant/odd"), (error) => error.status === 404);
  const oddRevoke = grantRevokes().at(-1);
  assert.ok(oddRevoke.path === "/api/users/fictional%2Fodd%20id/oauth-grants/grant%2Fodd/revoke" && oddRevoke.body === "{}", "revoke path encodes both ids and sends no data");
  const revokeBase = grantRevokes().length;

  // A. Owner home: nothing is loaded or revoked until the owner opens a panel.
  await until(() => rowFor(EDITOR) && rowFor(VIEWER) && idle(), "owner home");
  const getsBase = grantGets();
  await sleep(50);
  assert.equal(grantGets(), getsBase, "no connection list is requested before the panel opens");
  assert.equal(doc.querySelectorAll(".grant-section").length, 0);
  assert.equal(rowFor(VIEWER).querySelector(".token-toggle, .grant-section"), null, "no assistant access controls for a viewer");

  // B. Load failure with a manual Try again; the token controls are unaffected.
  failNext = { method: "GET", match: /\/oauth-grants$/, status: 503 };
  await openPanel(EDITOR);
  await until(() => section(EDITOR)?.querySelector(".grant-error") && rowFor(EDITOR).querySelector(".token-list") && idle(), "connection list failure");
  assert.equal(rowFor(EDITOR).querySelector(".token-list").textContent, "No access tokens yet.", "token list still works");
  assert.equal(rowFor(EDITOR).querySelector(".token-error"), null, "token section shows no error");
  assert.ok(rowFor(EDITOR).querySelector(".token-issue-form"), "token issue form still present");
  const failure = section(EDITOR).querySelector(".grant-error");
  assert.equal(failure.getAttribute("role"), "alert"); assert.equal(failure.textContent, "Browser connections could not be loaded.");
  const retry = section(EDITOR).querySelector(".grant-retry");
  assert.equal(retry.textContent, "Try again"); assert.equal(retry.getAttribute("aria-label"), "Try loading browser connections again");
  const afterFailure = grantGets();
  refresh(); await sleep(100); await until(idle, "background refresh");
  assert.equal(grantGets(), afterFailure, "a failed list is not re-requested automatically");
  retry.click();
  await until(() => section(EDITOR)?.querySelectorAll(".grant-row").length === 4 && !section(EDITOR).querySelector(".grant-error") && idle(), "manual Try again loads the list");
  assert.equal(grantGets(), afterFailure + 1, "Try again makes exactly one request");

  // C. Section text, states, safe names and dates; no secret entry and nothing hidden is shown.
  const box = section(EDITOR);
  assert.equal(box.getAttribute("aria-label"), "Browser connections for " + EDITOR);
  assert.equal(box.querySelector("h4").textContent, "Browser connections (OAuth)");
  const note = box.querySelector(".note").textContent;
  assert.ok(note.includes("signs in") && note.includes("consent") && note.includes("no secret is copied") && note.includes("at most 90 days") && note.includes("ends it immediately"), "browser sign-in, consent, 90-day limit and revoke explained");
  assert.equal(box.querySelectorAll("input, textarea, select, form").length, 0, "no secret entry or configuration");
  const rows = [...box.querySelectorAll(".grant-row")];
  assert.deepEqual(rows.map((row) => row.dataset.state), ["active", "active", "expired", "revoked"]);
  assert.deepEqual(rows.map((row) => row.querySelector(".grant-state").textContent), ["Active", "Active", "Expired", "Revoked"]);
  assert.equal(rows[0].querySelector(".grant-name").textContent, "Fictional Planner");
  assert.equal(rows[3].querySelector(".grant-name").textContent, "Unnamed assistant app");
  const hostile = rows[1].querySelector(".grant-name");
  assert.equal(hostile.children.length, 0, "client name is a single text node");
  assert.ok(hostile.textContent.startsWith("<img src=x") && hostile.textContent.includes("Fictional Helper"), "markup is shown literally as text");
  assert.ok(!Array.from(hostile.textContent).some((char) => INVISIBLE.includes(char.codePointAt(0)) || char.codePointAt(0) < 0x20), "control, zero-width and direction-override characters removed");
  assert.ok(Array.from(hostile.textContent).length <= 80 && hostile.textContent.endsWith("…"), "long names are bounded");
  assert.ok(rows[0].querySelector(".grant-dates").textContent.includes("Connected ") && rows[0].querySelector(".grant-dates").textContent.includes("Ends ") && rows[0].querySelector(".grant-dates").textContent.includes("Last used "));
  assert.ok(rows[2].querySelector(".grant-dates").textContent.includes("Ended ") && rows[2].querySelector(".grant-dates").textContent.includes("Not used yet"));
  assert.ok(rows[3].querySelector(".grant-dates").textContent.includes("Revoked "));
  assert.deepEqual(rows.map((row) => row.querySelectorAll("button").length), [1, 1, 0, 0], "revoke only for active connections");
  assert.equal(rows[0].querySelector("button").getAttribute("aria-label"), "Revoke browser connection Fictional Planner");
  assert.equal(rows[0].querySelector("button").textContent, "Revoke");
  assertNothingHidden();
  assert.equal(grantRevokes().length, revokeBase, "nothing is revoked without a click");

  // D. Empty state for another content manager.
  await openPanel(CURATOR);
  await until(() => section(CURATOR)?.querySelector(".grant-list")?.textContent === "No browser connections yet." && idle(), "empty connection list");

  // E. A failed revoke is reported once and never retried; the list is only re-read.
  failNext = { method: "POST", match: /\/oauth-grants\/[^/]+\/revoke$/, status: 500 };
  clearStatus(); const getsBeforeRevoke = grantGets();
  grantRow("grant-fictional-active").querySelector("button").click();
  await until(() => byId("status").dataset.error === "true" && byId("status").textContent.includes("not revoked") && idle(), "revoke failure reported");
  refresh(); await sleep(100); await until(idle, "refresh after revoke failure");
  assert.equal(grantRevokes().length - revokeBase, 1, "a failed revoke is not retried automatically");
  assert.ok(grantGets() > getsBeforeRevoke, "the list is re-read after a failed revoke");
  assert.equal(grantRow("grant-fictional-active").dataset.state, "active");

  // F. Explicit revoke succeeds and focus moves to the section heading.
  clearStatus();
  grantRow("grant-fictional-active").querySelector("button").click();
  await until(() => grantRow("grant-fictional-active")?.dataset.state === "revoked" && byId("status").textContent.startsWith("Browser connection revoked.") && idle(), "explicit revoke");
  await sleep(50);
  const done = grantRevokes();
  assert.equal(done.length - revokeBase, 2, "exactly one more request for the explicit click");
  assert.ok(done.at(-1).path === "/api/users/" + EDITOR_ID + "/oauth-grants/grant-fictional-active/revoke" && done.at(-1).body === "{}");
  assert.equal(byId("status").dataset.error, "false");
  assert.equal(grantRow("grant-fictional-active").querySelector("button"), null, "no revoke control once revoked");
  assert.ok(doc.activeElement === section(EDITOR).querySelector("h4"), "focus moves to the connections heading");
  assertNothingHidden();

  // G. Refresh: an older reload that answers after a newer one is discarded.
  grants.get(EDITOR_ID).push(grant("grant-fictional-stale", "Fictional Stale Device"));
  const refreshHold = hold("GET", new RegExp("/" + EDITOR_ID + "/oauth-grants$"));
  refresh(); await until(() => refreshHold.started && idle(), "older reload in flight");
  grants.get(EDITOR_ID).pop(); grants.get(EDITOR_ID).push(grant("grant-fictional-fresh", "Fictional Fresh Device"));
  byId("retry").click();
  await until(() => names().includes("Fictional Fresh Device") && idle(), "newer reload shown");
  refreshHold.open(); await sleep(60);
  assert.ok(names().includes("Fictional Fresh Device") && !doc.body.textContent.includes("Fictional Stale Device"), "stale reload ignored");

  // H. Account role change while a reload is in flight: the late answer is discarded.
  grants.get(EDITOR_ID).push(grant("grant-fictional-role", "Fictional Role Device"));
  const roleHold = hold("GET", new RegExp("/" + EDITOR_ID + "/oauth-grants$"));
  refresh(); await until(() => roleHold.started && idle(), "reload in flight before role change");
  await chooseRole(EDITOR, "viewer");
  assert.equal(rowFor(EDITOR).querySelector(".token-toggle, .grant-section"), null, "role change removes the panel");
  roleHold.open(); await sleep(60);
  assert.equal(section(EDITOR), null); assert.ok(!doc.body.textContent.includes("Fictional Role Device"), "late answer after role change ignored");
  assert.ok(section(CURATOR), "other account's panel unaffected");
  grants.get(EDITOR_ID).pop();
  await chooseRole(EDITOR, "content-manager");
  await openPanel(EDITOR);
  await until(() => section(EDITOR)?.querySelectorAll(".grant-row").length === 5 && idle(), "panel reopened after role restore");

  // I. Four languages.
  for (const [code, heading, unnamed, active] of [["zh-Hans", "浏览器连接（OAuth）", "未命名的助手应用", "有效"], ["zh-Hant", "瀏覽器連線（OAuth）", "未命名的助理應用程式", "有效"], ["ja", "ブラウザー接続（OAuth）", "名前のないアシスタントアプリ", "有効"], ["en", "Browser connections (OAuth)", "Unnamed assistant app", "Active"]]) {
    const picker = byId("language"); picker.value = code; picker.dispatchEvent(new window.Event("change"));
    assert.equal(doc.documentElement.lang, code);
    assert.equal(section(EDITOR).querySelector("h4").textContent, heading, code + " heading");
    assert.ok(section(EDITOR).querySelector(".note").textContent.includes("90"), code + " 90-day note");
    assert.equal(grantRow("grant-fictional-revoked").querySelector(".grant-name").textContent, unnamed, code + " unnamed client");
    assert.equal(grantRow("grant-fictional-hostile").querySelector(".grant-state").textContent, active, code + " state");
    const label = grantRow("grant-fictional-hostile").querySelector("button").getAttribute("aria-label");
    assert.ok(label.includes("Fictional Helper") && !label.startsWith("revokeGrant"), code + " revoke label");
    for (const node of section(EDITOR).querySelectorAll("h4, .note, .grant-state, .grant-dates, button")) assert.ok(node.textContent && !/^(grant|grants|revoke|noGrants|unnamedClient)[A-Za-z-]*$/.test(node.textContent), code + " no raw keys");
  }

  // J. Narrow screens: jsdom has no layout, so the phone rules are checked statically.
  const css = fs.readFileSync(new URL("../assets/selfhosted/home.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media(max-width:500px)"));
  for (const selector of [".grant-row", ".grant-retry"]) assert.ok(phone.includes(selector), "phone rule for " + selector);
  assert.match(css, /\.grant-name \{[^}]*overflow-wrap:anywhere/, "long client names wrap");
  assert.match(css, /\.grant-dates \{[^}]*overflow-wrap:anywhere/, "dates wrap");

  // K. Session change to a content manager while a reload is in flight; non-owners get no section.
  const sessionHold = hold("GET", new RegExp("/" + EDITOR_ID + "/oauth-grants$"));
  refresh(); await until(() => sessionHold.started && idle(), "reload in flight before session change");
  role = "content-manager"; const getsAtSwitch = grantGets();
  byId("retry").click();
  await until(() => byId("accounts").hidden && !byId("trips").hidden && idle(), "content-manager view");
  sessionHold.open(); await sleep(60);
  assert.equal(doc.querySelectorAll(".grant-section, .grant-row, .token-toggle, .token-panel").length, 0, "no connection controls for a non-owner");
  assert.ok(!doc.body.textContent.includes("Fictional Planner") && !doc.body.textContent.includes("Fictional Fresh Device"), "late owner data not shown to a content manager");
  refresh(); await sleep(80); await until(idle, "manager refresh");
  assert.equal(grantGets(), getsAtSwitch, "a non-owner page never requests connections");

  // L. Sign-out while a list is loading: the late answer is discarded.
  role = "owner"; refresh();
  await until(() => !byId("accounts").hidden && rowFor(EDITOR) && idle(), "owner again");
  const logoutHold = hold("GET", new RegExp("/" + EDITOR_ID + "/oauth-grants$"));
  await openPanel(EDITOR);
  await until(() => logoutHold.started && rowFor(EDITOR).querySelector(".token-list") && idle(), "list loading before sign-out");
  byId("logout").click();
  await until(() => role === null, "sign-out request");
  await sleep(30); logoutHold.open(); await sleep(60);
  assert.equal(doc.querySelectorAll(".grant-section").length, 0);
  assert.ok(!doc.body.textContent.includes("Fictional"), "nothing from the late answer after sign-out");

  for (const call of calls) for (const value of HIDDEN) assert.ok(!call.href.includes(value) && !call.body.includes(value), "the page never sends grant metadata back");
  assert.ok(!calls.some((call) => call.method === "POST" && /\/oauth-grants$/.test(call.path)), "the page never creates a grant");
  assert.deepEqual(errors, []);
  window.close();

  // M. Older client module without the new methods: isolated failure, tokens keep working.
  const legacyClient = "data:text/javascript;base64," + Buffer.from(
    "import { hostedApi as real } from " + JSON.stringify(realClient) + ";\nexport * from " + JSON.stringify(realClient) + ";\n" +
    "const { listOAuthGrants, revokeOAuthGrant, ...rest } = real;\nexport const hostedApi = Object.freeze(rest);\n"
  ).toString("base64");
  role = "owner"; const legacyGets = grantGets();
  await boot(legacyClient);
  await openPanel(EDITOR);
  await until(() => section(EDITOR)?.querySelector(".grant-error") && rowFor(EDITOR).querySelector(".token-list")?.textContent === "No access tokens yet." && idle(), "legacy client isolated failure");
  section(EDITOR).querySelector(".grant-retry").click();
  await sleep(50); await until(() => section(EDITOR)?.querySelector(".grant-error") && idle(), "legacy retry stays isolated");
  assert.ok(rowFor(EDITOR).querySelector(".token-issue-form"), "token controls intact");
  assert.equal(grantGets(), legacyGets, "no connection request without client support");
  assert.deepEqual(errors, []);

  console.log("OAuth owner UI DOM regression passed: owner-only browser-connection list inside the assistant-access panel with loading, empty and failure states and manual Try again, active/expired/revoked states, plain-text bounded client names, no client id/redirect/digest/token in the page, storage or requests, explicit single-attempt revoke with no automatic retry, stale responses discarded after Refresh, role change, session change and sign-out, no controls or requests for a content manager, four languages, and isolated failure with an older client module. Phone layout checked statically only; no browser layout claim.");
} finally {
  timers.forEach(clearTimeout); try { window?.close(); } catch {}
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout;
}
