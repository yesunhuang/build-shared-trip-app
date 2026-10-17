// Trip-page DOM simulation for an approved viewer against the real HTTP service (cookie session,
// no bearer token). jsdom evidence only: not browser layout, gesture, device or installation proof.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { readConfig, startServer } from "../server/app.mjs";
import {grantFixtureMembership} from "./fixtures/membership.mjs";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-accounts-trip-"));
const token = crypto.randomBytes(32).toString("base64url");
const runtime = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: directory, SHARED_TRIP_PORT: "0" }));
const draft = runtime.service.createTrip({ requestId: "trip-ui-create", trip: { title: "Fictional Viewer Coast" } }).trip;
const trip = runtime.service.applyTripChanges({ tripId: draft.id, requestId: "trip-ui-seed", expectedVersion: 1, changes: [
  { type: "upsert_day", day: { id: "view-day", date: "2031-07-03", theme: "Invented shoreline", slots: [{ id: "view-plan", name: "Invented tide pools", time: "10:00", period: "morning" }] } },
  { type: "upsert_reminder", reminder: { id: "view-todo", item: "Invented sunscreen", dueDate: "2031-07-03", done: false } }
] }).trip;

// Viewer onboarding through the real endpoints before the DOM starts.
const owner = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
const json = { "Content-Type": "application/json", Origin: runtime.url };
const invitation = (await (await fetch(runtime.url + "/api/invitations", { method: "POST", headers: owner, body: "{}" })).json()).invitation.token;
const username = "coast.viewer"; const password = "Fictional-" + crypto.randomBytes(9).toString("base64url");
assert.equal((await fetch(runtime.url + "/api/accept-invite", { method: "POST", headers: json, body: JSON.stringify({ invitation, username, password }) })).status, 201);
const accountId = runtime.accounts.listAccounts().accounts[0].id;
assert.equal((await fetch(runtime.url + "/api/users/" + accountId + "/approve", { method: "POST", headers: owner })).status, 200);
grantFixtureMembership(runtime,trip.id,accountId);
const signIn = await fetch(runtime.url + "/api/login", { method: "POST", headers: json, body: JSON.stringify({ username, password }) });
assert.equal(signIn.status, 200);
const cookie = signIn.headers.get("set-cookie").split(";")[0];

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
const html = fs.readFileSync(new URL("../assets/app-template/public/index.html", import.meta.url), "utf8").replace("__TRIP_DATA_JSON__", "{}");
const dom = new JSDOM(html, { url: runtime.url + "/trips/" + trip.id, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
const { window } = dom;
window.SHARED_TRIP_HOSTED = true;
window.matchMedia = (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
window.HTMLElement.prototype.scrollTo = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
window.scrollTo = function () {};
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
const nativeTimeout = globalThis.setTimeout; const nativeClear = globalThis.clearTimeout; const nativeFetch = globalThis.fetch; const timers = new Set();
globalThis.setTimeout = (fn, delay, ...args) => { const timer = nativeTimeout(() => { timers.delete(timer); fn(...args); }, Math.min(delay, 100)); timers.add(timer); timer.unref(); return timer; };
globalThis.clearTimeout = (timer) => { timers.delete(timer); nativeClear(timer); };
for (const key of ["window", "document", "location", "localStorage", "sessionStorage", "FormData", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLDialogElement", "Node", "Element"]) {
  Object.defineProperty(globalThis, key, { value: window[key], writable: true, configurable: true });
}
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.matchMedia = window.matchMedia;
globalThis.requestAnimationFrame = (fn) => globalThis.setTimeout(() => fn(Date.now()), 16);
globalThis.cancelAnimationFrame = globalThis.clearTimeout;
globalThis.confirm = () => true;
for (const script of window.document.querySelectorAll("script:not([src])")) {
  if (script.type === "application/json") continue;
  window.eval(script.textContent);
  for (const match of script.textContent.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (typeof window[match[1]] === "function") globalThis[match[1]] = window[match[1]];
  }
}
const statuses = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, runtime.url);
  if (!url.pathname.startsWith("/api/")) throw new Error("External content unavailable in DOM simulation.");
  const response = await nativeFetch(url, { ...options, headers: { ...options.headers, Cookie: cookie, Origin: runtime.url } });
  statuses.push(options.method || "GET", url.pathname, response.status);
  return response;
};
const current = () => runtime.service.getTrip(trip.id).trip;
const doc = window.document;
const until = async (predicate, label) => { const deadline = Date.now() + 6000; while (!predicate()) { if (Date.now() > deadline) throw new Error("Timed out: " + label); await new Promise((r) => nativeTimeout(r, 10)); } };
try {
  await import("../assets/app-template/public/hosted-bootstrap.js?v=__CACHE_VERSION__");
  await until(() => !doc.querySelector(".hosted-boot") && doc.getElementById("itinerary-days").textContent.includes("Invented tide pools"), "viewer trip page");
  assert.ok(doc.documentElement.classList.contains("hosted-read-only"));
  const controls = doc.getElementById("hosted-controls");
  assert.equal(controls.querySelector(".hosted-read-only-badge").textContent, "Read-only");
  const labels = [...controls.querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(labels.includes("Export") && !labels.includes("Edit trip"), labels.join(","));
  assert.equal(doc.querySelector(".day-link--add"), null, "no add-date control");
  assert.equal(doc.querySelector(".day-heading__actions"), null, "no add-plan or edit-date controls");
  assert.equal(doc.querySelectorAll(".day-heading button").length, 0);
  assert.equal(doc.querySelectorAll("[data-slot-id] .icon-button").length, 0, "no plan edit controls");
  assert.ok(doc.getElementById("add-reminder").hidden && doc.getElementById("add-reminder").disabled, "no add-reminder control");
  assert.equal(doc.querySelectorAll(".todo-edit").length, 0, "no reminder edit controls");
  const checkboxes = [...doc.querySelectorAll("#reminder-list input[type=checkbox], .day-todos input[type=checkbox]")];
  assert.ok(checkboxes.length >= 1 && checkboxes.every((box) => box.disabled), "reminder toggles are disabled");
  checkboxes[0].checked = true; checkboxes[0].dispatchEvent(new window.Event("change"));
  doc.querySelector("#reminder-list li").click();
  await new Promise((r) => nativeTimeout(r, 50));
  assert.equal(current().reminders[0].done, false); assert.equal(current().version, trip.version);
  assert.equal(doc.querySelector("dialog[open]"), null, "no editor dialog opened");

  // The server is authoritative even if a modified client tries to write.
  const client = await import("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__");
  await assert.rejects(client.hostedApi.applyChanges(trip.id, trip.version, [{ type: "update_trip", fields: { title: "Viewer rename" } }]), (error) => error.status === 403);
  await assert.rejects(client.hostedApi.listAccounts(), (error) => error.status === 403);
  assert.equal(current().title, "Fictional Viewer Coast"); assert.equal(runtime.service.listTrips().trips.length, 1);
  assert.equal((await client.hostedApi.exportTrip(trip.id)).trip.id, trip.id, "export remains available");

  const language = doc.getElementById("language-select");
  for (const [code, label] of [["zh-Hans", "只读"], ["zh-Hant", "唯讀"], ["ja", "閲覧のみ"], ["en", "Read-only"]]) {
    language.value = code; language.dispatchEvent(new window.Event("change"));
    assert.equal(doc.getElementById("hosted-controls").querySelector(".hosted-read-only-badge").textContent, label);
    assert.equal(doc.querySelectorAll("[data-slot-id] .icon-button").length, 0);
  }

  // Revocation while the page is open: the next poll clears visible protected content.
  runtime.accounts.revoke(accountId);
  window.dispatchEvent(new window.Event("online"));
  await until(() => !doc.body.textContent.includes("Invented tide pools"), "revoked page cleared");
  assert.ok(statuses.includes(401));
  for (let index = 0; index < window.localStorage.length; index++) assert.ok(!window.localStorage.getItem(window.localStorage.key(index)).includes("Invented"), "no trip content in storage");
  assert.deepEqual(errors, []);
  console.log("Viewer trip-page DOM simulation passed: honest read-only controls in four languages, disabled reminder toggles, server-side 403 for client-forced writes, export available, and revocation clears the open page. No browser layout claim.");
} finally {
  timers.forEach(nativeClear); window.close(); globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClear;
  await runtime.close(); fs.rmSync(directory, { recursive: true, force: true });
}
