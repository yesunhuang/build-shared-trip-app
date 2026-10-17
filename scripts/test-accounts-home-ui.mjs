// Home-page DOM simulation of the account flow against the real server, using a cookie jar instead
// of the admin bearer token. jsdom evidence only: no browser layout, autofill or device claim.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { readConfig, startServer } from "../server/app.mjs";
import {grantFixtureMembership} from "./fixtures/membership.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-accounts-home-"));
const token = crypto.randomBytes(32).toString("base64url");
const runtime = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: directory, SHARED_TRIP_PORT: "0" }));
runtime.service.createTrip({ requestId: "home-acct-a", trip: { title: "Fictional Orchard Visit" } });
runtime.service.createTrip({ requestId: "home-acct-b", trip: { title: "Fictional River Day" } });
const titles = ["Fictional Orchard Visit", "Fictional River Day"];
const errors = []; const consoleBridge = new VirtualConsole();
consoleBridge.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
const dom = new JSDOM(fs.readFileSync(new URL("../assets/selfhosted/index.html", import.meta.url), "utf8"), { url: runtime.url, runScripts: "outside-only", virtualConsole: consoleBridge });
const { window } = dom; window.SHARED_TRIP_HOSTED = true;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
for (const name of ["window", "document", "location", "localStorage", "sessionStorage", "FormData"]) Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
const nativeFetch = globalThis.fetch; const nativeTimeout = globalThis.setTimeout; const timers = new Set();
globalThis.setTimeout = (fn, delay, ...args) => { const timer = nativeTimeout(() => { timers.delete(timer); fn(...args); }, delay); timer.unref(); timers.add(timer); return timer; };
// A per-"device" cookie jar: the page never sees or stores the HttpOnly session value itself.
let jar = new Map(); const requested = [];
globalThis.fetch = async (input, options = {}) => {
  const headers = { ...options.headers, Origin: runtime.url };
  if (jar.size) headers.Cookie = [...jar].map(([name, value]) => name + "=" + value).join("; ");
  const url = new URL(input, runtime.url); requested.push(url.href);
  const response = await nativeFetch(url, { ...options, headers });
  for (const line of response.headers.getSetCookie()) {
    const [pair, ...attributes] = line.split(";"); const [name, value] = pair.split("=");
    if (attributes.some((part) => /^\s*max-age=0$/i.test(part))) jar.delete(name); else jar.set(name, value);
  }
  return response;
};
const byId = (id) => window.document.getElementById(id);
const until = async (predicate, label) => { const end = Date.now() + 6000; while (!predicate()) { if (Date.now() > end) throw new Error("Timed out: " + label + " / status: " + byId("status").textContent); await new Promise((r) => nativeTimeout(r, 10)); } };
const submit = (form) => form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const refresh = () => window.dispatchEvent(new window.Event("focus"));
const bodyText = () => window.document.body.textContent;
const dump = (storage) => Array.from({ length: storage.length }, (_, index) => storage.key(index) + "=" + storage.getItem(storage.key(index))).join("\n");
const storageText = () => dump(window.localStorage) + "\n" + dump(window.sessionStorage);
const signedOutView = () => !byId("login").hidden && byId("trips").hidden && byId("accounts").hidden && !byId("list").children.length;
try {
  const client = new URL("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__", import.meta.url).href;
  const source = fs.readFileSync(new URL("../assets/selfhosted/home.js", import.meta.url), "utf8").replace('"/hosted-client.js?v=__CACHE_VERSION__"', JSON.stringify(client));
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  await until(signedOutView, "signed-out start");

  // Owner: separate token sign-in, then account management.
  const ownerForm = byId("login-form"); ownerForm.elements.token.value = token; submit(ownerForm);
  await until(() => !byId("accounts").hidden && window.document.querySelectorAll(".trip-card").length === 2, "owner home with account management");
  assert.equal(ownerForm.elements.token.value, "", "token field is cleared");
  assert.ok(!byId("create").hidden && !byId("import-control").hidden && byId("read-only-note").hidden);
  byId("create-invite").click();
  await until(() => !byId("invite-output").hidden && byId("invite-output").querySelector("code"), "invitation shown once");
  const code = byId("invite-output").querySelector("code").textContent;
  assert.match(code, /^[A-Za-z0-9_-]{43}$/); assert.notEqual(code, token);
  assert.ok(byId("invite-count").textContent.includes("1"));
  const ownerJar = new Map(jar);

  // Another device without a session: the owner's invitation code and trips disappear from view.
  jar = new Map(); refresh();
  await until(signedOutView, "signed out on a fresh device");
  for (const value of [code, ...titles]) assert.ok(!bodyText().includes(value), "no protected content after sign-out");
  byId("invite-panel").open = true;
  const invite = byId("invite-form");
  const viewerSecret = "Fictional-" + crypto.randomBytes(9).toString("base64url");
  invite.elements.invitation.value = code; invite.elements.username.value = "orchard.viewer"; invite.elements.password.value = viewerSecret; submit(invite);
  await until(() => byId("status").textContent.startsWith("Access requested."), "pending request");
  assert.equal(invite.elements.invitation.value, ""); assert.equal(invite.elements.password.value, "");
  assert.equal(jar.size, 0, "redeeming an invitation does not create a session");
  assert.ok(signedOutView(), "pending accounts see no trips");

  // Pending sign-in gets a generic error and no session.
  const viewerForm = byId("viewer-login-form");
  viewerForm.elements.username.value = "orchard.viewer"; viewerForm.elements.password.value = viewerSecret; submit(viewerForm);
  await until(() => byId("status").dataset.error === "true" && byId("status").textContent.includes("not available"), "pending refused");
  assert.equal(viewerForm.elements.password.value, ""); assert.ok(signedOutView()); assert.equal(jar.size, 0);

  // Owner approves the visible pending request.
  jar = new Map(ownerJar); refresh();
  await until(() => byId("account-list").querySelector('[data-status="pending"] button'), "pending approval visible");
  const row = byId("account-list").querySelector('[data-status="pending"]');
  assert.equal(row.querySelector("strong").textContent, "orchard.viewer");
  assert.deepEqual([...row.querySelectorAll("button")].map((b) => b.textContent), ["Approve", "Revoke"]);
  row.querySelector("button").click();
  await until(() => runtime.accounts.listAccounts().accounts[0].status === "approved" && byId("account-list").querySelector('[data-status="approved"]'), "approved");
  for(const trip of runtime.service.listTrips().trips)grantFixtureMembership(runtime,trip.id,runtime.accounts.listAccounts().accounts[0].id);
  assert.ok(!bodyText().includes(code), "the one-time invitation code is not redisplayed after leaving that session");

  // Approved viewer: read/export only.
  jar = new Map(); refresh(); await until(signedOutView, "viewer device");
  viewerForm.elements.username.value = "orchard.viewer"; viewerForm.elements.password.value = viewerSecret; submit(viewerForm);
  await until(() => window.document.querySelectorAll(".trip-card").length === 2, "viewer trip list");
  assert.equal(viewerForm.elements.password.value, "");
  assert.ok(!byId("create").hidden && byId("import-control").hidden && byId("import").disabled, "ordinary accounts may create their own trips; import remains privileged");
  assert.ok(!byId("read-only-note").hidden && byId("read-only-note").textContent.includes("Read-only"));
  assert.ok(byId("accounts").hidden && !byId("account-list").children.length, "no account management");
  for (const card of window.document.querySelectorAll(".trip-card")) assert.deepEqual([...card.querySelectorAll("button")].map((b) => b.textContent), ["Export","Participants"]);
  for (const value of [viewerSecret, code, token]) assert.ok(!storageText().includes(value) && !bodyText().includes(value), "no credential in page or storage");

  // Revocation: the next refresh clears protected content.
  runtime.accounts.revoke(runtime.accounts.listAccounts().accounts[0].id);
  refresh(); await until(signedOutView, "revoked viewer signed out");
  for (const value of titles) assert.ok(!bodyText().includes(value));

  for (const [language, summary, readOnly] of [["en", "Have an invitation?", "Read-only"], ["zh-Hans", "有邀请码？", "只读"], ["zh-Hant", "有邀請碼？", "唯讀"], ["ja", "招待コードをお持ちですか？", "閲覧のみ"]]) {
    const selector = byId("language"); selector.value = language; selector.dispatchEvent(new window.Event("change"));
    assert.equal(window.document.documentElement.lang, language);
    assert.equal(byId("invite-panel").querySelector("summary").textContent, summary);
    assert.ok(byId("read-only-note").textContent.includes(readOnly));
    for (const node of window.document.querySelectorAll("[data-text]")) assert.notEqual(node.textContent, node.dataset.text, language + " label " + node.dataset.text);
  }
  for (const url of requested) for (const value of [token, code, viewerSecret]) assert.ok(!url.includes(value), "credentials never appear in request URLs");
  assert.deepEqual(errors, []);
  console.log("Account home DOM simulation passed: owner token sign-in, one-time invitation display, form-based redemption into a pending account, generic pending refusal, owner approval, assigned-member list/export and own-trip creation, without editing joined trips or import/account controls, revocation clearing, four languages, and no credentials in URLs or storage. No browser layout claim.");
} finally {
  timers.forEach(clearTimeout); window.close(); globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; await runtime.close(); fs.rmSync(directory, { recursive: true, force: true });
}
