// Home-page DOM simulation (jsdom) against the actual local server with fictional trips:
//   - the per-trip Google place details checkbox in Create trip / Edit trip (four languages, off by
//     default, saved through update_trip/create only when it changed);
//   - regression for trip-card links: the list is rebuilt on every poll and on window focus; a
//     focus that arrives during a press on a trip link (the press that focuses an unfocused window)
//     used to rebuild the list and detach the link before its click. On the original code the
//     isConnected assertion below fails.
//   - auth boundary for that render guard: while a trip link is held, a 401, an owner demotion
//     (fictional /api/session answer with a lower role) and an explicit sign-out clear protected DOM
//     and owner controls at once, and no deferred work restores them after the press ends.
// Input events are SIMULATED (synthetic DOM events); jsdom has no layout or real navigation, so a
// window-level listener records the click and cancels jsdom's unimplemented navigation.
// No browser, device or provider claim.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { readConfig, startServer } from "../server/app.mjs";
import { googlePlacePhotosText } from "../assets/app-template/public/hosted-client.js";

const FIELD = "googlePlacePhotosEnabled";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-home-setting-"));
const token = crypto.randomBytes(32).toString("base64url");
const runtime = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: directory, SHARED_TRIP_PORT: "0" }));
const first = runtime.service.createTrip({ requestId: "home-setting-a", trip: { title: "Fictional home coast" } }).trip;
runtime.service.createTrip({ requestId: "home-setting-b", trip: { title: "Fictional home hills" } });
const errors = [];
const consoleBridge = new VirtualConsole();
consoleBridge.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
const dom = new JSDOM(fs.readFileSync(new URL("../assets/selfhosted/index.html", import.meta.url), "utf8"), { url: runtime.url, runScripts: "outside-only", virtualConsole: consoleBridge });
const { window } = dom;
window.SHARED_TRIP_HOSTED = true;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
const opened = [];
window.open = (...args) => { opened.push(args); return null; };
for (const name of ["window", "document", "location", "localStorage", "sessionStorage", "FormData"]) Object.defineProperty(globalThis, name, { value: window[name], configurable: true });
const nativeFetch = globalThis.fetch;
const nativeTimeout = globalThis.setTimeout;
const timers = new Set();
globalThis.setTimeout = (fn, delay, ...args) => { const timer = nativeTimeout(() => { timers.delete(timer); fn(...args); }, delay); timer.unref(); timers.add(timer); return timer; };
const sent = [];
// Section 5 only: a fictional /api/session answer (401, or a LOWER role) replaces the real one, to
// simulate a revoked session or an owner demoted elsewhere. Every other request still goes to the
// real local server, which keeps enforcing its own permissions; no access is ever added.
let forgeSession = null;
const forged = (status, payload) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (input, options = {}) => {
  const url = new URL(input, runtime.url);
  sent.push({ method: options.method || "GET", path: url.pathname, body: options.body ? JSON.parse(options.body) : undefined });
  if (forgeSession && url.pathname === "/api/session") return Promise.resolve(forgeSession());
  return nativeFetch(url, { ...options, headers: { ...options.headers, Authorization: "Bearer " + token, Origin: runtime.url } });
};
// Deferred work that throws is reported by the link guard through console.error; collect it.
const deferredFailures = [];
const nativeConsoleError = console.error;
console.error = (...args) => { if (args[0] === "Deferred update failed") deferredFailures.push(args); else nativeConsoleError(...args); };
const doc = window.document;
const wait = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
const until = async (predicate, label) => { const end = Date.now() + 4000; while (!predicate()) { if (Date.now() > end) throw new Error("Timed out: " + label + " " + doc.getElementById("status").textContent); await wait(10); } };
const submit = (form) => form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));
const cards = () => [...doc.querySelectorAll(".trip-card")];
const cardFor = (title) => cards().find((card) => card.querySelector("h2").textContent === title);
const activations = [];
window.addEventListener("click", (event) => {
  const anchor = event.composedPath().find((node) => node?.localName === "a" && node.hasAttribute?.("href")) || null;
  activations.push({ anchor, prevented: event.defaultPrevented, connected: Boolean(anchor?.isConnected) });
  if (anchor) event.preventDefault();
});
const Pointer = window.PointerEvent || window.MouseEvent;
const fire = (target, Type, type, init = {}) => target.dispatchEvent(new Type(type, { bubbles: true, cancelable: true, composed: true, button: 0, ...init }));

try {
  const client = new URL("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__", import.meta.url).href;
  const source = fs.readFileSync(new URL("../assets/selfhosted/home.js", import.meta.url), "utf8").replace('"/hosted-client.js?v=__CACHE_VERSION__"', JSON.stringify(client));
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
  await until(() => cards().length === 2, "list two trips");

  // 1. Trip link regression: a focus-triggered reload during the press waits for the click.
  const link = cardFor("Fictional home coast").querySelector("h2 a");
  assert.equal(link.getAttribute("href"), "/trips/" + first.id);
  runtime.service.createTrip({ requestId: "home-setting-c", trip: { title: "Fictional home lakes" } });
  fire(link, Pointer, "pointerdown", { pointerType: "mouse" });
  fire(link, window.MouseEvent, "mousedown");
  const listsBefore = sent.filter((entry) => entry.method === "GET" && entry.path === "/api/trips").length;
  window.dispatchEvent(new window.Event("focus"));
  await until(() => sent.filter((entry) => entry.method === "GET" && entry.path === "/api/trips").length > listsBefore, "focus reload request");
  await wait(120);
  assert.equal(link.isConnected, true, "the pressed trip link is still in the document after the focus reload");
  assert.equal(cards().length, 2, "the list rebuild waits for the press");
  fire(link, Pointer, "pointerup", { pointerType: "mouse" });
  fire(link, window.MouseEvent, "mouseup");
  fire(link, window.MouseEvent, "click");
  const activation = activations.at(-1);
  assert.ok(activation.anchor === link && activation.connected && !activation.prevented, "the click reaches the original link and is not cancelled");
  await until(() => cards().length === 3, "the deferred rebuild shows the new trip");
  // Modified and middle clicks are left to the browser as well.
  const fresh = cardFor("Fictional home coast").querySelector("h2 a");
  fire(fresh, window.MouseEvent, "click", { ctrlKey: true });
  assert.ok(activations.at(-1).anchor === fresh && !activations.at(-1).prevented, "Ctrl-click not cancelled");
  const aux = new window.MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 });
  fresh.dispatchEvent(aux);
  assert.equal(aux.defaultPrevented, false, "middle click not cancelled");
  assert.equal(opened.length, 0, "never window.open");

  // 2. Create trip: the checkbox is off by default and an explicit false is created.
  doc.getElementById("create").click();
  let form = doc.querySelector("dialog form");
  let box = form.querySelector(`input[type="checkbox"][name="${FIELD}"]`);
  assert.ok(box && box.checked === false, "create: off by default");
  assert.equal(box.closest("label").querySelector(".field-checkbox__label").textContent, googlePlacePhotosText("en", "label"));
  assert.equal(doc.getElementById(box.getAttribute("aria-describedby"))?.textContent, googlePlacePhotosText("en", "hint"), "hint linked by aria-describedby");
  form.elements.title.value = "Fictional created trip";
  submit(form);
  await until(() => cardFor("Fictional created trip") && !doc.querySelector("dialog"), "created");
  const createBody = sent.filter((entry) => entry.method === "POST" && entry.path === "/api/trips").at(-1).body;
  assert.equal(createBody.trip[FIELD], false, "create sends an explicit false");
  const created = runtime.service.listTrips().trips.find((trip) => trip.title === "Fictional created trip");
  assert.equal(runtime.service.getTrip(created.id).trip[FIELD], false);

  // 3. Edit trip: opt in; then a title-only edit does not resend the field.
  const editButton = () => cardFor("Fictional created trip").querySelector(".card-actions button");
  editButton().click();
  await until(() => doc.querySelector("dialog form"), "edit dialog");
  form = doc.querySelector("dialog form");
  box = form.querySelector(`input[name="${FIELD}"]`);
  assert.equal(box.checked, false);
  box.click();
  submit(form);
  await until(() => runtime.service.getTrip(created.id).trip[FIELD] === true && !doc.querySelector("dialog"), "opted in");
  let changeBody = sent.filter((entry) => entry.method === "POST" && entry.path.endsWith("/changes")).at(-1).body;
  assert.deepEqual(changeBody.changes.map((change) => change.type), ["update_trip"]);
  assert.equal(changeBody.changes[0].fields[FIELD], true, "a real boolean");
  editButton().click();
  await until(() => doc.querySelector("dialog form"), "edit dialog again");
  form = doc.querySelector("dialog form");
  assert.equal(form.querySelector(`input[name="${FIELD}"]`).checked, true, "the saved choice is shown");
  form.elements.title.value = "Fictional created trip";
  form.elements.country.value = "Fictionland";
  submit(form);
  await until(() => runtime.service.getTrip(created.id).trip.country === "Fictionland" && !doc.querySelector("dialog"), "country saved");
  changeBody = sent.filter((entry) => entry.method === "POST" && entry.path.endsWith("/changes")).at(-1).body;
  assert.equal(Object.hasOwn(changeBody.changes[0].fields, FIELD), false, "an unchanged choice is not resent");
  assert.equal(runtime.service.getTrip(created.id).trip[FIELD], true);
  assert.equal(runtime.service.getTrip(first.id).trip[FIELD], false, "other trips are unaffected");

  // 4. Four languages.
  for (const language of ["zh-Hans", "zh-Hant", "ja", "en"]) {
    const selector = doc.getElementById("language");
    selector.value = language; selector.dispatchEvent(new window.Event("change"));
    doc.getElementById("create").click();
    const label = doc.querySelector("dialog form .field-checkbox__label");
    assert.equal(label.textContent, googlePlacePhotosText(language, "label"), `${language}: checkbox label`);
    doc.querySelector("dialog form .actions button[type=button]").click();
    await until(() => !doc.querySelector("dialog"), `${language}: dialog closed`);
  }

  // 5. Auth boundary while a trip link is held (simulated press, no pointerup yet). The render guard
  //    defers ordinary same-authority refreshes, but a 401, an owner demotion and an explicit
  //    sign-out must clear protected DOM and owner controls at once, and no deferred work may bring
  //    them back after the press ends. Release waits longer than the guard's release delay (400 ms).
  const SETTLE_MS = 700;
  const byId = (id) => doc.getElementById(id);
  const count = (method, pathname) => sent.filter((entry) => entry.method === method && entry.path === pathname).length;
  const inviteCode = () => byId("invite-output")?.querySelector("code")?.textContent || "";
  const ownerVisible = () => byId("accounts")?.hidden === false && Boolean(doc.querySelector("[data-delete-trip]"));
  let titles = 0;
  const focusReload = async (label) => {
    const before = count("GET", "/api/session");
    window.dispatchEvent(new window.Event("focus"));
    await until(() => count("GET", "/api/session") > before, label);
    await wait(150);
  };
  async function ownerReady() {
    forgeSession = null;
    await focusReload("owner reload");
    await until(ownerVisible, "owner controls shown");
    byId("create-invite").click();
    await until(() => inviteCode() && !byId("invite-output").hidden, "owner invitation code shown");
    doc.querySelector("[data-delete-trip]").click();
    await until(() => doc.querySelector("dialog.delete-dialog"), "owner delete confirmation open");
  }
  // Holds a press on a trip link, then lets a same-authority refresh arrive: it must still wait.
  async function holdWithDeferredRefresh(label) {
    const held = cardFor("Fictional home coast").querySelector("h2 a");
    fire(held, Pointer, "pointerdown", { pointerType: "mouse" });
    fire(held, window.MouseEvent, "mousedown");
    const cardsBefore = cards().length;
    titles += 1;
    runtime.service.createTrip({ requestId: `home-auth-${titles}`, trip: { title: `Fictional held refresh ${titles}` } });
    await focusReload(`${label}: same-authority refresh`);
    assert.equal(held.isConnected, true, `${label}: a same-authority refresh still waits for the held link`);
    assert.equal(cards().length, cardsBefore, `${label}: the list rebuild is deferred`);
    assert.ok(ownerVisible() && inviteCode() && doc.querySelector("dialog.delete-dialog"), `${label}: owner page unchanged so far`);
    return held;
  }
  async function releaseAndSettle(held) {
    // The pointer is released over whatever is under it now (the held link may be gone).
    const target = held.isConnected ? held : doc.body;
    fire(target, Pointer, "pointerup", { pointerType: "mouse" });
    fire(target, window.MouseEvent, "mouseup");
    await wait(SETTLE_MS);
  }
  const assertSignedOutPage = (label) => {
    assert.equal(cards().length, 0, `${label}: no trip cards`);
    assert.equal(byId("trips").hidden, true, `${label}: trips section hidden`);
    assert.equal(byId("login").hidden, false, `${label}: sign-in shown`);
    assert.equal(byId("logout").hidden, true, `${label}: no sign-out control`);
    assert.equal(byId("accounts").hidden, true, `${label}: accounts hidden`);
    assert.equal(inviteCode(), "", `${label}: invitation code cleared`);
    assert.equal(byId("account-list").children.length, 0, `${label}: account list cleared`);
    assert.equal(doc.querySelector("[data-delete-trip]"), null, `${label}: no delete control`);
    assert.equal(doc.querySelector("dialog.delete-dialog"), null, `${label}: delete confirmation closed`);
    assert.equal(byId("create").hidden, true, `${label}: no create control`);
  };

  // 5a. 401 (session revoked elsewhere) while held.
  await ownerReady();
  {
    const held = await holdWithDeferredRefresh("401");
    forgeSession = () => forged(401, { error: { code: "unauthorized", message: "Sign in required." } });
    await focusReload("401 reload");
    assertSignedOutPage("401 before pointerup");
    await releaseAndSettle(held);
    assertSignedOutPage("401 after deferred work settled");
  }

  // 5b/5c. Owner demoted to content manager / viewer elsewhere, while held.
  const demotions = [
    ["content manager", { authenticated: true, role: "content-manager", username: "fictional-manager", capabilities: { readTrips: true, exportTrips: true, editTrips: true, importTrips: true, manageAccounts: false, mcp: false } }],
    ["viewer", { authenticated: true, role: "viewer", username: "fictional-viewer", capabilities: { readTrips: true, exportTrips: true, editTrips: false, importTrips: false, manageAccounts: false, mcp: false } }]
  ];
  for (const [label, demoted] of demotions) {
    await ownerReady();
    const held = await holdWithDeferredRefresh(label);
    const accountRequests = sent.filter((entry) => entry.path.startsWith("/api/accounts")).length;
    forgeSession = () => forged(200, demoted);
    await focusReload(`${label} reload`);
    const assertDemoted = (when) => {
      assert.equal(byId("accounts").hidden, true, `${label} ${when}: accounts hidden`);
      assert.equal(inviteCode(), "", `${label} ${when}: invitation code cleared`);
      assert.equal(byId("invite-output").hidden, true, `${label} ${when}: invitation output hidden`);
      assert.equal(byId("account-list").children.length, 0, `${label} ${when}: account list cleared`);
      assert.equal(doc.querySelector("[data-delete-trip]"), null, `${label} ${when}: no delete control`);
      assert.equal(doc.querySelector("dialog.delete-dialog"), null, `${label} ${when}: delete confirmation closed`);
      assert.equal(byId("trips").hidden, false, `${label} ${when}: trips stay readable`);
      assert.ok(cards().length > 0, `${label} ${when}: trip cards shown`);
      assert.equal(byId("create").hidden, demoted.capabilities.editTrips !== true, `${label} ${when}: create follows the edit capability`);
      assert.equal(byId("read-only-note").hidden, demoted.capabilities.editTrips === true, `${label} ${when}: read-only note follows the role`);
    };
    assertDemoted("before pointerup");
    assert.equal(sent.filter((entry) => entry.path.startsWith("/api/accounts")).length, accountRequests, `${label}: no owner-only request after the demotion`);
    await releaseAndSettle(held);
    assertDemoted("after deferred work settled");
    assert.ok(cardFor(`Fictional held refresh ${titles}`), `${label}: the deferred same-authority refresh then shows the latest list`);
  }

  // 5d. Explicit sign-out while held (Sign out activated by keyboard/second pointer; simulated).
  await ownerReady();
  {
    const held = await holdWithDeferredRefresh("sign-out");
    const sessionsBefore = count("GET", "/api/session"); const listsBefore = count("GET", "/api/trips");
    byId("logout").click();
    assert.equal(cards().length, 0, "sign-out: no trip cards at once");
    assert.equal(doc.querySelector("[data-delete-trip], dialog.delete-dialog, #accounts:not([hidden]), #invite-output code"), null, "sign-out: no owner control or secret at once");
    assert.equal(held.isConnected, false, "sign-out: the held link is gone at once");
    await releaseAndSettle(held);
    window.dispatchEvent(new window.Event("focus"));
    await wait(200);
    assert.equal(cards().length, 0, "sign-out: nothing restored after deferred work settled");
    assert.equal(doc.querySelector("[data-delete-trip], dialog.delete-dialog, #invite-output code, .trip-card"), null, "sign-out: no protected DOM afterwards");
    assert.equal(count("GET", "/api/session"), sessionsBefore, "sign-out: no later session reload");
    assert.equal(count("GET", "/api/trips"), listsBefore, "sign-out: no later trip list reload");
  }
  assert.deepEqual(deferredFailures, [], "no deferred work ran against a cleared page");
  assert.equal(opened.length, 0, "never window.open");
  assert.deepEqual(errors, []);
  console.log("Home DOM simulation passed: trip links survive a focus/poll reload during the press (simulated mouse; Ctrl/middle clicks not cancelled; no window.open), and the four-language Google place details checkbox is off for new trips and sent only when changed; while a trip link is held, same-authority refreshes still wait, but a 401, an owner demotion (to content manager or viewer, simulated session answer) and an explicit sign-out clear protected DOM and owner controls before pointerup and nothing is restored after deferred work settles. No browser layout or device claim.");
} finally {
  console.error = nativeConsoleError;
  timers.forEach(clearTimeout); window.close(); globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; await runtime.close(); fs.rmSync(directory, { recursive: true, force: true });
}
