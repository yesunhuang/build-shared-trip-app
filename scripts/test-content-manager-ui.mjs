// Home-page DOM simulation of content-manager access and owner-only assistant access tokens,
// against the real server through its public HTTP API with per-"device" cookie jars.
// Accounts are created only through the invitation/role/approve endpoints; no backend internals.
// jsdom evidence only: no browser layout, clipboard, autofill, device or installation claim.
// Assertions never print a secret: they compare with booleans and generic messages.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { readConfig, startServer } from "../server/app.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-content-manager-ui-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
const runtime = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: directory, SHARED_TRIP_PORT: "0" }));
runtime.service.createTrip({ requestId: "cm-ui-a", trip: { title: "Fictional Lantern Market" } });
runtime.service.createTrip({ requestId: "cm-ui-b", trip: { title: "Fictional Ridge Walk" } });
const EDITOR = "sample-editor"; const READER = "sample-reader";
const editorPassword = "Fictional-" + crypto.randomBytes(9).toString("base64url");
const readerPassword = "Fictional-" + crypto.randomBytes(9).toString("base64url");

const errors = []; const consoleBridge = new VirtualConsole();
consoleBridge.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
const dom = new JSDOM(fs.readFileSync(new URL("../assets/selfhosted/index.html", import.meta.url), "utf8"), { url: runtime.url, runScripts: "outside-only", virtualConsole: consoleBridge });
const { window } = dom; window.SHARED_TRIP_HOSTED = true;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
for (const name of ["window", "document", "location", "localStorage", "sessionStorage", "FormData"]) Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
// Clipboard stub records writes so the test can prove nothing is copied without an explicit click.
const clipboardWrites = [];
const nativeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
Object.defineProperty(globalThis, "navigator", { value: { onLine: true, clipboard: { writeText: async (value) => { clipboardWrites.push(value); } } }, configurable: true });
const nativeFetch = globalThis.fetch; const nativeTimeout = globalThis.setTimeout; const timers = new Set();
// The 20-second background poll (and 20-second write timeouts) never fire here; refreshes are
// triggered explicitly with focus events so status assertions are deterministic.
globalThis.setTimeout = (fn, delay, ...args) => { const timer = nativeTimeout(() => { timers.delete(timer); if (!(delay >= 20000)) fn(...args); }, delay); timer.unref(); timers.add(timer); return timer; };

let jar = new Map(); const requested = []; const bodies = []; const counts = { issue: 0, list: 0 }; let inject = null;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input, runtime.url); const method = options.method || "GET";
  requested.push(url.href); bodies.push(String(options.body || ""));
  if (/\/mcp-tokens$/.test(url.pathname)) counts[method === "POST" ? "issue" : "list"] += 1;
  if (inject && inject.method === method && inject.match.test(url.pathname)) {
    const { status } = inject; inject = null;
    return new Response(JSON.stringify({ error: { code: "unavailable", message: "Fictional injected failure." } }), { status, headers: { "Content-Type": "application/json" } });
  }
  const headers = { ...options.headers, Origin: runtime.url };
  if (jar.size) headers.Cookie = [...jar].map(([name, value]) => name + "=" + value).join("; ");
  const response = await nativeFetch(url, { ...options, headers });
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";"); const [name, value] = pair.split("=");
    if (attributes.some((part) => /^\s*max-age=0$/i.test(part))) jar.delete(name); else jar.set(name, value);
  }
  return response;
};

const doc = window.document;
const byId = (id) => doc.getElementById(id);
const sleep = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
const idle = () => ![...doc.querySelectorAll("button")].some((node) => node.disabled);
const until = async (predicate, label) => { const end = Date.now() + 8000; while (!predicate()) { if (Date.now() > end) throw new Error("Timed out: " + label + " / status: " + (byId("status")?.textContent || "")); await sleep(10); } };
const submit = (form) => form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const refresh = () => window.dispatchEvent(new window.Event("focus"));
const clearStatus = () => { byId("status").textContent = ""; byId("status").dataset.error = "false"; };
const bodyText = () => doc.body.textContent;
const dump = (storage) => Array.from({ length: storage.length }, (_, index) => storage.key(index) + "=" + storage.getItem(storage.key(index))).join("\n");
const storageText = () => dump(window.localStorage) + "\n" + dump(window.sessionStorage);
const signedOutView = () => !byId("login").hidden && byId("trips").hidden && byId("accounts").hidden && !byId("list").children.length;
const rowFor = (name) => [...byId("account-list").querySelectorAll(".account-row")].find((row) => row.querySelector("strong")?.textContent === name);
const ownButtons = (row) => [...row.querySelector(":scope > .card-actions").querySelectorAll("button")];
const noticeShown = () => !byId("token-output").hidden && byId("token-secret").textContent.length >= 16;
const noticeCleared = () => byId("token-output").hidden && byId("token-secret").textContent === "";
const secrets = []; let inviteCodes = [];
// Every secret ever displayed: allowed only as the plain text of the one-time box while it is open.
function assertContained(secret, visible) {
  const html = doc.documentElement.outerHTML;
  assert.equal(html.split(secret).length - 1, visible ? 1 : 0, visible ? "secret appears exactly once while displayed" : "secret no longer in the page");
  if (visible) assert.ok(byId("token-secret").textContent === secret && byId("token-secret").children.length === 0, "secret rendered as plain text only");
  for (const node of doc.querySelectorAll("*")) for (const attribute of node.attributes) assert.ok(!attribute.value.includes(secret), "secret is never in an attribute");
  assert.ok(!byId("status").textContent.includes(secret), "secret is never in a status message");
  assert.ok(!storageText().includes(secret), "secret is never in browser storage");
  assert.ok(!window.location.href.includes(secret), "secret is never in the page URL");
  assert.ok(![...jar.values()].some((value) => value.includes(secret)), "secret is never in a cookie");
}
async function chooseAndSaveRole(name, role) {
  await until(() => rowFor(name) && idle(), "row for " + name);
  const select = rowFor(name).querySelector(".role-control select");
  select.value = role; select.dispatchEvent(new window.Event("change", { bubbles: true }));
  await until(() => rowFor(name)?.querySelector(".role-pending button"), "save control appears only after a change");
  clearStatus(); rowFor(name).querySelector(".role-pending button").click();
  await until(() => rowFor(name)?.dataset.role === role && !rowFor(name).querySelector(".role-pending") && idle(), "role saved for " + name);
  assert.equal(byId("status").textContent, "Access level saved.");
  assert.ok(doc.activeElement === rowFor(name).querySelector(".role-control select"), "focus returns to the role control");
}
async function openTokens(name) {
  await until(() => rowFor(name)?.querySelector(".token-toggle") && idle(), "token toggle for " + name);
  const toggle = rowFor(name).querySelector(".token-toggle");
  if (toggle.getAttribute("aria-expanded") !== "true") toggle.click();
  await until(() => rowFor(name)?.querySelector(".token-panel .token-issue-form") && !rowFor(name).querySelector(".token-panel [role=status]") && idle(), "token panel for " + name);
}
function typeLabel(name, label) {
  const input = rowFor(name).querySelector(".token-issue-form").elements.label;
  input.value = label; input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
async function issue(name, label) {
  await openTokens(name); typeLabel(name, label); clearStatus();
  const before = clipboardWrites.length;
  submit(rowFor(name).querySelector(".token-issue-form"));
  await until(() => noticeShown() && idle() && [...rowFor(name).querySelectorAll(".token-row[data-state=active] strong")].some((node) => node.textContent === label), "one-time token shown for " + label);
  const secret = byId("token-secret").textContent; secrets.push(secret);
  assert.equal(clipboardWrites.length, before, "nothing is copied automatically");
  assert.ok(doc.activeElement === byId("token-output"), "focus moves to the one-time token box");
  assertContained(secret, true);
  return secret;
}
async function signIn(username, password) {
  jar = new Map(); refresh(); await until(signedOutView, "signed-out device");
  const form = byId("viewer-login-form"); form.elements.username.value = username; form.elements.password.value = password; submit(form);
  await until(() => !byId("trips").hidden && doc.querySelectorAll(".trip-card").length >= 2 && idle(), "signed in as " + username);
  assert.equal(form.elements.password.value, "", "password field cleared");
}

try {
  const client = new URL("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__", import.meta.url).href;
  const source = fs.readFileSync(new URL("../assets/selfhosted/home.js", import.meta.url), "utf8").replace('"/hosted-client.js?v=__CACHE_VERSION__"', JSON.stringify(client));
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  const api = (await import(client)).hostedApi;
  await until(signedOutView, "signed-out start");
  assert.equal(byId("login").querySelector("h1").textContent, "Sign in", "generic sign-in heading");
  assert.equal(byId("viewer-login-form").querySelector("span").textContent, "Username");

  // A. Owner invites two people; each privately chooses a password on their own device.
  const ownerForm = byId("login-form"); ownerForm.elements.token.value = ownerToken; submit(ownerForm);
  await until(() => !byId("accounts").hidden && doc.querySelectorAll(".trip-card").length === 2 && idle(), "owner home");
  assert.equal(byId("accounts").querySelector("h2").textContent, "Accounts", "generic accounts heading");
  for (let index = 0; index < 2; index += 1) {
    byId("create-invite").click();
    await until(() => byId("invite-output").querySelector("code") && !inviteCodes.includes(byId("invite-output").querySelector("code").textContent) && idle(), "invitation " + index);
    inviteCodes.push(byId("invite-output").querySelector("code").textContent);
  }
  let ownerJar = new Map(jar);
  jar = new Map(); refresh(); await until(signedOutView, "invitee device");
  for (const [code, username, password] of [[inviteCodes[0], EDITOR, editorPassword], [inviteCodes[1], READER, readerPassword]]) {
    byId("invite-panel").open = true; clearStatus();
    const invite = byId("invite-form"); invite.elements.invitation.value = code; invite.elements.username.value = username; invite.elements.password.value = password; submit(invite);
    await until(() => byId("status").textContent.startsWith("Access requested.") && idle(), "pending request for " + username);
  }
  assert.equal(jar.size, 0, "redeeming does not create a session");

  // Owner selects the content-manager level for the pending editor, then approves both.
  jar = new Map(ownerJar); refresh();
  await until(() => rowFor(EDITOR) && rowFor(READER) && idle(), "pending rows");
  for (const name of [EDITOR, READER]) {
    const row = rowFor(name);
    assert.equal(row.dataset.status, "pending"); assert.equal(row.dataset.role, "viewer", "invitations create viewers");
    assert.equal(row.querySelector(".role-control select").getAttribute("aria-label"), "Access level for " + name, "role select has an accessible name");
    assert.deepEqual([...row.querySelectorAll("button")].map((node) => node.textContent), ["Approve", "Revoke"], "no extra buttons on a pending row");
    assert.equal(row.querySelector(".token-toggle"), null, "no token controls before approval");
  }
  const select = rowFor(EDITOR).querySelector(".role-control select");
  select.value = "viewer"; select.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.equal(rowFor(EDITOR).querySelector(".role-pending"), null, "no save control without a change");
  await chooseAndSaveRole(EDITOR, "content-manager");
  for (const name of [EDITOR, READER]) {
    ownButtons(rowFor(name))[0].click();
    await until(() => rowFor(name)?.dataset.status === "approved" && idle(), "approved " + name);
  }
  assert.ok(rowFor(EDITOR).querySelector(".token-toggle"), "approved content manager gets token controls");
  assert.equal(rowFor(READER).querySelector(".token-toggle"), null, "viewer gets no token controls");
  const editorId = rowFor(EDITOR).dataset.accountId; const readerId = rowFor(READER).dataset.accountId;

  // B. Token lifecycle: loading failure and retry, empty state, failed issuance without retry.
  inject = { method: "GET", match: /\/mcp-tokens$/, status: 503 };
  rowFor(EDITOR).querySelector(".token-toggle").click();
  await until(() => rowFor(EDITOR)?.querySelector(".token-error") && idle(), "token list failure state");
  assert.equal(rowFor(EDITOR).querySelector(".token-toggle").getAttribute("aria-expanded"), "true");
  rowFor(EDITOR).querySelector(".token-panel button").click();
  await until(() => !rowFor(EDITOR).querySelector(".token-error") && rowFor(EDITOR).querySelector(".token-list")?.textContent === "No access tokens yet." && idle(), "token empty state");
  assert.ok(rowFor(EDITOR).querySelector(".token-panel").textContent.includes("90 days"), "fixed lifetime explained");
  const label = rowFor(EDITOR).querySelector(".token-issue-form label");
  assert.ok(label.querySelector("input") && label.querySelector("span").textContent === "Token name", "labelled token-name field");

  typeLabel(EDITOR, "sample laptop"); clearStatus();
  const issuedBefore = counts.issue;
  inject = { method: "POST", match: /\/mcp-tokens$/, status: 500 };
  submit(rowFor(EDITOR).querySelector(".token-issue-form"));
  await until(() => byId("status").dataset.error === "true" && byId("status").textContent.includes("not issued") && idle(), "issuance failure reported");
  refresh(); await sleep(300); await until(idle, "refresh after failure");
  assert.equal(counts.issue - issuedBefore, 1, "a failed issuance is never retried automatically");
  assert.ok(noticeCleared(), "no token box after a failed issuance");
  assert.equal(rowFor(EDITOR).querySelectorAll(".token-row").length, 0);
  assert.equal(rowFor(EDITOR).querySelector(".token-issue-form").elements.label.value, "sample laptop", "typed name survives for an explicit retry");

  // Successful explicit issuance, copy only on click, explicit dismiss.
  const first = await issue(EDITOR, "sample laptop");
  assert.ok(byId("token-message").textContent.includes(EDITOR) && byId("token-message").textContent.includes("not be shown again"));
  assert.ok(byId("token-output").getAttribute("aria-labelledby") === "token-output-title" && byId("token-copy-status").getAttribute("role") === "status");
  refresh(); await sleep(100); await until(idle, "background refresh");
  assert.ok(noticeShown(), "a background refresh does not hide the token before the owner stores it");
  byId("token-copy").click();
  await until(() => byId("token-copy-status").textContent.startsWith("Copied"), "explicit copy");
  assert.ok(clipboardWrites.length === 1 && clipboardWrites[0] === first, "copied exactly once, on the explicit click");
  byId("token-dismiss").click();
  assert.ok(noticeCleared(), "dismiss clears the token"); assertContained(first, false);
  assert.ok(doc.activeElement === rowFor(EDITOR).querySelector(".token-toggle"), "focus returns to the account's token control");

  // Refresh clears a displayed token.
  const second = await issue(EDITOR, "sample tablet");
  byId("retry").click();
  await until(() => noticeCleared() && idle(), "refresh clears token"); assertContained(second, false);

  // Revoking the displayed token clears it and marks it revoked.
  const third = await issue(EDITOR, "sample phone");
  const phoneRow = () => [...rowFor(EDITOR).querySelectorAll(".token-row")].find((row) => row.querySelector("strong").textContent === "sample phone");
  const revoke = phoneRow().querySelector("button");
  assert.equal(revoke.getAttribute("aria-label"), "Revoke token sample phone");
  revoke.click();
  await until(() => noticeCleared() && idle() && (!phoneRow() || phoneRow().dataset.state === "revoked"), "token revoked");
  assertContained(third, false);
  assert.equal(byId("status").textContent, "Token revoked.");

  // Four languages for the owner's account and token controls.
  const languages = [["zh-Hans", "隐藏助手访问", "账户"], ["zh-Hant", "隱藏助理存取", "帳戶"], ["ja", "アシスタント用アクセスを隠す", "アカウント"], ["en", "Hide assistant access", "Accounts"]];
  for (const [code, hide, heading] of languages) {
    const picker = byId("language"); picker.value = code; picker.dispatchEvent(new window.Event("change"));
    assert.equal(doc.documentElement.lang, code);
    assert.equal(rowFor(EDITOR).querySelector(".token-toggle").textContent, hide, code + " token toggle");
    assert.equal(byId("accounts").querySelector("h2").textContent, heading, code + " accounts heading");
    for (const option of rowFor(EDITOR).querySelectorAll("option")) assert.ok(!option.textContent.startsWith("role-"), code + " role option");
    for (const node of rowFor(EDITOR).querySelectorAll(".token-state, .token-panel h3, .token-issue-form button")) assert.ok(node.textContent && !/^token-|^issueToken$|^tokens$/.test(node.textContent), code + " token text");
    for (const node of doc.querySelectorAll("[data-text]")) assert.notEqual(node.textContent, node.dataset.text, code + " label " + node.dataset.text);
  }

  // Phone widths: jsdom has no layout, so this is a static check that the phone rules exist.
  const css = fs.readFileSync(new URL("../assets/selfhosted/home.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media(max-width:500px)"));
  for (const selector of [".role-control", ".token-panel", ".token-output .actions button", ".account-row"]) assert.ok(phone.includes(selector), "phone rule for " + selector);
  assert.match(css, /\.token-secret \{[^}]*overflow-wrap:anywhere/, "long tokens wrap on narrow screens");

  // C. Content manager: owner-like trip editing, no account/security controls.
  ownerJar = new Map(jar);
  await signIn(EDITOR, editorPassword);
  const editorJar = new Map(jar);
  for (const secret of secrets) assertContained(secret, false);
  assert.ok(!byId("create").hidden && !byId("import-control").hidden && !byId("import").disabled, "create and import available");
  assert.ok(byId("read-only-note").hidden && !byId("manager-note").hidden, "manager note instead of read-only note");
  assert.ok(byId("accounts").hidden && !byId("account-list").children.length && byId("token-output").hidden, "no account or token administration");
  assert.equal(doc.querySelectorAll(".role-control, .token-toggle, .token-panel").length, 0);
  for (const card of doc.querySelectorAll(".trip-card")) assert.deepEqual([...card.querySelectorAll("button")].map((node) => node.textContent), ["Edit", "Archive", "Export"]);
  byId("create").click();
  const create = doc.querySelector("dialog form"); create.elements.title.value = "Fictional Manager Draft"; submit(create);
  await until(() => runtime.service.listTrips().trips.some((trip) => trip.title === "Fictional Manager Draft") && !doc.querySelector("dialog") && idle(), "manager creates a trip");
  const draftCard = () => [...doc.querySelectorAll(".trip-card")].find((card) => card.querySelector("h2").textContent === "Fictional Manager Draft");
  const draft = runtime.service.listTrips().trips.find((trip) => trip.title === "Fictional Manager Draft");
  draftCard().querySelector("button").click();
  await until(() => doc.querySelector("dialog form"), "manager opens editor");
  const metadata = doc.querySelector("dialog form"); metadata.elements.title.value = "Fictional Manager Renamed"; submit(metadata);
  await until(() => runtime.service.getTrip(draft.id).trip.title === "Fictional Manager Renamed" && !doc.querySelector("dialog") && idle(), "manager edits a trip");
  const renamedCard = () => [...doc.querySelectorAll(".trip-card")].find((card) => card.querySelector("h2").textContent === "Fictional Manager Renamed");
  renamedCard().querySelectorAll("button")[1].click();
  await until(() => runtime.service.getTrip(draft.id).trip.archived && idle(), "manager archives");
  const archived = byId("archived"); archived.checked = true; archived.dispatchEvent(new window.Event("change"));
  renamedCard().querySelectorAll("button")[1].click();
  await until(() => !runtime.service.getTrip(draft.id).trip.archived && idle(), "manager restores");
  const picker = byId("import"); const data = JSON.parse(fs.readFileSync(new URL("../assets/trip.example.json", import.meta.url), "utf8"));
  const tripCount = runtime.service.listTrips().trips.length;
  Object.defineProperty(picker, "files", { value: [{ size: 10000, text: async () => JSON.stringify(data) }], configurable: true });
  picker.dispatchEvent(new window.Event("change"));
  await until(() => runtime.service.listTrips().trips.length === tripCount + 1 && idle(), "manager imports");
  assert.equal((await api.exportTrip(draft.id)).trip.id, draft.id, "manager exports");
  for (const attempt of [() => api.listAccounts(), () => api.createInvitation(), () => api.setAccountRole(readerId, "content-manager"), () => api.approveAccount(readerId), () => api.revokeAccount(readerId), () => api.listMcpTokens(editorId), () => api.issueMcpToken(editorId, "sample self-issue")]) {
    await assert.rejects(attempt(), (error) => error.status === 403, "administration is owner-only");
  }
  for (const [code, phrase] of [["zh-Hans", "内容管理者"], ["zh-Hant", "內容管理者"], ["ja", "コンテンツ管理者"], ["en", "Content manager"]]) {
    const selector = byId("language"); selector.value = code; selector.dispatchEvent(new window.Event("change"));
    assert.ok(byId("manager-note").textContent.startsWith(phrase), code + " manager note");
  }

  // D. Viewer stays read-only.
  await signIn(READER, readerPassword);
  assert.ok(byId("create").hidden && byId("import-control").hidden && byId("import").disabled && !byId("read-only-note").hidden && byId("manager-note").hidden);
  assert.ok(byId("accounts").hidden && !byId("account-list").children.length);
  for (const card of doc.querySelectorAll(".trip-card")) assert.deepEqual([...card.querySelectorAll("button")].map((node) => node.textContent), ["Export"]);
  await assert.rejects(api.createTrip({ title: "Viewer draft" }), (error) => error.status === 403);
  await assert.rejects(api.issueMcpToken(readerId, "sample viewer"), (error) => error.status === 403);

  // E. Role change and account revocation clear a displayed token; role change signs the account out.
  jar = new Map(ownerJar); refresh();
  await until(() => !byId("accounts").hidden && rowFor(EDITOR) && idle(), "owner again");
  const fourth = await issue(EDITOR, "sample desktop");
  await chooseAndSaveRole(EDITOR, "viewer");
  assert.ok(noticeCleared() && !rowFor(EDITOR).querySelector(".token-toggle"), "role change clears the token and its controls");
  assertContained(fourth, false);
  ownerJar = new Map(jar);
  jar = new Map(editorJar); refresh();
  await until(signedOutView, "old manager session ended by the role change");
  jar = new Map(ownerJar); refresh();
  await until(() => !byId("accounts").hidden && rowFor(EDITOR) && idle(), "owner after role change");
  await chooseAndSaveRole(EDITOR, "content-manager");
  const fifth = await issue(EDITOR, "sample spare");
  ownButtons(rowFor(EDITOR)).find((node) => node.textContent === "Revoke").click();
  await until(() => rowFor(EDITOR)?.dataset.status === "revoked" && noticeCleared() && idle(), "account revoke clears token");
  assert.equal(rowFor(EDITOR).querySelector(".token-toggle"), null);
  assertContained(fifth, false);

  // F. Sign-out clears a displayed token.
  await chooseAndSaveRole(READER, "content-manager");
  const sixth = await issue(READER, "sample notebook");
  byId("logout").click();
  await until(() => !bodyText().includes(sixth) && jar.size === 0, "sign-out clears token");
  await sleep(50);

  for (const secret of secrets) {
    assert.ok(!storageText().includes(secret) && !bodyText().includes(secret), "no token in storage or page after sign-out");
    assert.ok(!requested.some((url) => url.includes(secret)), "no token in any request URL");
    assert.ok(!bodies.some((body) => body.includes(secret)), "no token sent anywhere by the page");
  }
  for (const value of [ownerToken, editorPassword, readerPassword, ...inviteCodes]) assert.ok(!requested.some((url) => url.includes(value)) && !storageText().includes(value), "no credential in URLs or storage");
  assert.equal(clipboardWrites.length, 1, "only the one explicit copy reached the clipboard");
  assert.deepEqual(errors, []);
  console.log("Content-manager home DOM simulation passed: owner role selection before approval, owner-only token list/issue/revoke with loading, empty and failure states, single-attempt issuance, one-time plain-text display with explicit copy/dismiss, clearing on refresh, token revoke, role change, account revoke and sign-out, no token in storage/URLs/attributes/requests, content-manager create/edit/archive/restore/import/export without administration (server 403s), read-only viewer, and four languages. Phone layout checked statically only; no browser layout or clipboard claim.");
} finally {
  timers.forEach(clearTimeout); window.close(); globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout;
  if (nativeNavigator) Object.defineProperty(globalThis, "navigator", nativeNavigator);
  await runtime.close(); fs.rmSync(directory, { recursive: true, force: true });
}
