// Home-page DOM regression for the owner-only "Delete trip" action on active and archived trip cards.
// Uses a fully stubbed same-origin API (no server, no network) and generated fictional trips only.
// The stub follows the agreed interface: DELETE /api/trips/:id with {requestId, expectedVersion},
// 200 {deleted:true, tripId, version}, owner only, 409 on a stale version, identical retries replayed.
// Covers owner-only visibility, absence for content managers (including archived trips), viewers and
// signed-out pages, Cancel/Escape without any request, focus handling, the version shown on the card,
// a stable request id, no double submit, unknown outcomes with explicit Check status / Try again and no
// automatic retry, stale-version conflicts, the owner re-check at submission, clearing on role demotion
// and sign-out (including a late answer), four languages and static phone-layout rules.
// jsdom evidence only: no browser layout, focus-trap or device claim.
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";

const ORIGIN = "https://trips.fictional.test/";
const HARBOR = "Fictional Harbor Weekend"; const ORCHARD = "Fictional Orchard Archive"; const FERRY = "Fictional Night Ferry";
const PIER = "Fictional Lantern Pier"; const CEDAR = "Fictional Cedar Lookout"; const SALT = "Fictional Salt Flats";
let trips = [
  { id: "fictional-harbor", title: HARBOR, version: 3, archived: false },
  { id: "fictional-orchard", title: ORCHARD, version: 5, archived: true },
  { id: "fictional-ferry", title: FERRY, version: 2, archived: false },
  { id: "fictional-pier", title: PIER, version: 1, archived: false },
  { id: "fictional-cedar", title: CEDAR, version: 7, archived: false },
  { id: "fictional-salt", title: SALT, version: 2, archived: true }
];
const ALL_TITLES = trips.map((trip) => trip.title);
let role = "owner";
const replays = new Map();

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const refuse = (status) => reply(status, { error: { code: status === 401 ? "unauthorized" : status === 403 ? "forbidden" : "not_found", message: "Fictional refusal." } });
const clone = (value) => JSON.parse(JSON.stringify(value));
function route(method, pathname, body) {
  if (pathname === "/api/session" && method === "GET") {
    if (!role) return refuse(401);
    const editor = role === "owner" || role === "content-manager";
    return reply(200, { authenticated: true, role, ...(role === "owner" ? {} : { username: "sample-" + role }), capabilities: { readTrips: true, exportTrips: true, editTrips: editor, importTrips: editor, manageAccounts: role === "owner" } });
  }
  if (pathname === "/api/logout" && method === "POST") { role = null; return reply(200, { authenticated: false }); }
  if (!role) return refuse(401);
  if (pathname === "/api/trips" && method === "GET") return reply(200, { trips: clone(trips) });
  if (pathname === "/api/users" && method === "GET") return role === "owner" ? reply(200, { accounts: [], invitations: [] }) : refuse(403);
  const match = /^\/api\/trips\/([^/]+)$/.exec(pathname);
  if (match && method === "DELETE") {
    if (role !== "owner") return refuse(403);
    const { requestId, expectedVersion } = JSON.parse(body);
    const prior = replays.get(requestId);
    if (prior) return prior.body === body ? reply(200, prior.payload) : reply(409, { error: { code: "request_id_conflict", message: "Fictional reuse." } });
    const id = decodeURIComponent(match[1]); const trip = trips.find((item) => item.id === id);
    if (!trip) return refuse(404);
    if (trip.version !== expectedVersion) return reply(409, { error: { code: "version_conflict", message: "Fictional conflict." } });
    trips = trips.filter((item) => item.id !== id);
    const payload = { deleted: true, tripId: id, version: trip.version };
    replays.set(requestId, { body, payload });
    return reply(200, payload);
  }
  return refuse(404);
}

const calls = []; let failNext = null; let holdNext = null;
const nativeFetch = globalThis.fetch; const nativeTimeout = globalThis.setTimeout; const timers = new Set();
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input, ORIGIN); const method = options.method || "GET"; const body = String(options.body ?? "");
  calls.push({ method, path: url.pathname, body });
  if (failNext && failNext.method === method && failNext.match.test(url.pathname)) {
    const { mode, status } = failNext; failNext = null;
    // "drop": never reached the server. "lost": applied by the server, answer lost on the way back.
    if (mode === "drop") throw new TypeError("Fictional network drop.");
    if (mode === "lost") { route(method, url.pathname, body); throw new TypeError("Fictional lost answer."); }
    return reply(status, { error: { code: "unavailable", message: "Fictional injected failure." } });
  }
  // Computed at request time, so a held reply carries the result of that moment.
  const response = route(method, url.pathname, body);
  if (holdNext && holdNext.method === method && holdNext.match.test(url.pathname)) { const held = holdNext; holdNext = null; held.started = true; await held.gate; }
  return response;
};
function hold(method, match) { let open; const gate = new Promise((resolve) => { open = resolve; }); holdNext = { method, match, gate, open, started: false }; return holdNext; }
// The 20-second poll and write timeouts never fire; refreshes are triggered explicitly.
globalThis.setTimeout = (fn, delay, ...args) => { const timer = nativeTimeout(() => { timers.delete(timer); if (!(delay >= 20000)) fn(...args); }, delay); timer.unref(); timers.add(timer); return timer; };

const errors = [];
const consoleBridge = new VirtualConsole();
consoleBridge.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
const dom = new JSDOM(fs.readFileSync(new URL("../assets/selfhosted/index.html", import.meta.url), "utf8"), { url: ORIGIN, runScripts: "outside-only", virtualConsole: consoleBridge });
const { window } = dom; const doc = window.document; window.SHARED_TRIP_HOSTED = true;
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event("close")); };
for (const name of ["window", "document", "location", "localStorage", "sessionStorage", "FormData"]) Object.defineProperty(globalThis, name, { value: window[name], configurable: true });

const byId = (id) => doc.getElementById(id);
const sleep = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
const idle = () => ![...doc.querySelectorAll("button")].some((node) => node.disabled);
const until = async (predicate, label) => { const end = Date.now() + 8000; while (!predicate()) { if (Date.now() > end) throw new Error("Timed out: " + label + " / status: " + (byId("status")?.textContent || "")); await sleep(10); } };
const refresh = () => window.dispatchEvent(new window.Event("focus"));
const clearStatus = () => { byId("status").textContent = ""; byId("status").dataset.error = "false"; };
const dump = (storage) => Array.from({ length: storage.length }, (_, index) => storage.key(index) + "=" + storage.getItem(storage.key(index))).join("\n");
const storageText = () => dump(window.localStorage) + "\n" + dump(window.sessionStorage);
const cards = () => [...doc.querySelectorAll(".trip-card")];
const cardFor = (title) => cards().find((card) => card.querySelector("h2").textContent === title);
const labels = (card) => [...card.querySelectorAll("button")].map((node) => node.textContent);
const deleteControl = (title) => cardFor(title)?.querySelector("[data-delete-trip]");
const dialog = () => doc.querySelector("dialog.delete-dialog");
const cancelButton = () => dialog()?.querySelector(".delete-cancel");
const checkButton = () => dialog()?.querySelector(".delete-check");
const confirmButton = () => dialog()?.querySelector(".delete-confirm");
const feedback = () => { const node = dialog()?.querySelector(".delete-feedback"); return node && !node.hidden ? node.textContent : ""; };
const dialogButtons = () => [...(dialog()?.querySelectorAll("button") || [])].filter((node) => !node.hidden).map((node) => node.textContent);
const settled = () => idle() && dialog()?.getAttribute("aria-busy") !== "true";
const deletes = () => calls.filter((call) => call.method === "DELETE");
const deletesFor = (id) => deletes().filter((call) => call.path === "/api/trips/" + id);
const showArchived = (on) => { const box = byId("archived"); box.checked = on; box.dispatchEvent(new window.Event("change")); };
const ownerHome = () => !byId("trips").hidden && !byId("accounts").hidden && idle();
const signedOutView = () => !byId("login").hidden && byId("trips").hidden && !cards().length;
const TECHNICAL = /request ?id|requestId|expectedVersion|\b40\d\b|\b50\d\b|HTTP|\bAPI\b|endpoint|idempot|status code|JSON/i;
function assertPlainCopy(label) {
  const box = dialog(); if (!box) return;
  for (const node of box.querySelectorAll("h2, p, button")) {
    if (node.hidden) continue;
    assert.ok(node.textContent.trim(), label + ": no empty text");
    assert.ok(!TECHNICAL.test(node.textContent), label + ": no technical detail in user-facing copy");
    assert.ok(!/^(delete|deleting|checking|close|cancel)[A-Za-z]*$/.test(node.textContent), label + ": no raw translation keys");
  }
}
function assertSessionCheckedBefore(call) {
  const index = calls.indexOf(call);
  assert.ok(index > 0 && calls[index - 1].method === "GET" && calls[index - 1].path === "/api/session", "owner role re-read right before the deletion is sent");
}

const client = new URL("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__", import.meta.url).href;
try {
  const source = fs.readFileSync(new URL("../assets/selfhosted/home.js", import.meta.url), "utf8").replace('"/hosted-client.js?v=__CACHE_VERSION__"', JSON.stringify(client));
  await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

  // A. Owner: a Delete control on every card, active and archived; nothing opens or is sent by itself.
  await until(() => ownerHome() && cards().length === 4, "owner home");
  for (const title of [HARBOR, FERRY, PIER, CEDAR]) {
    assert.deepEqual(labels(cardFor(title)), ["Edit", "Archive", "Export", "Participants", "Delete"], "owner card actions for " + title);
    const control = deleteControl(title);
    assert.equal(control.type, "button");
    assert.equal(control.getAttribute("aria-label"), "Delete trip " + title, "accessible name names the trip");
    assert.equal(control.getAttribute("aria-haspopup"), "dialog");
  }
  assert.equal(cardFor(ORCHARD), undefined, "archived trips hidden until shown");
  showArchived(true);
  for (const title of [ORCHARD, SALT]) assert.deepEqual(labels(cardFor(title)), ["Edit", "Restore", "Export", "Participants", "Delete"], "owner archived card actions for " + title);
  assert.equal(doc.querySelectorAll("dialog").length, 0, "no confirmation until asked");
  await sleep(30);
  assert.equal(deletes().length, 0, "nothing is deleted without a confirmation");

  // B. Confirmation content and focus; Cancel, Escape (cancel event) and Escape key send nothing.
  deleteControl(HARBOR).click();
  await until(() => dialog()?.open, "confirmation open");
  const box = dialog();
  assert.equal(box.getAttribute("role"), "alertdialog");
  assert.equal(doc.getElementById(box.getAttribute("aria-labelledby")).textContent, "Delete “" + HARBOR + "”?", "title names the selected trip");
  const warning = doc.getElementById(box.getAttribute("aria-describedby")).textContent;
  assert.ok(warning.includes("permanently") && warning.includes("whole trip") && warning.includes("everyone") && warning.includes("cannot be undone"), "whole-trip, permanent, no in-app undo explained");
  assert.deepEqual(dialogButtons(), ["Cancel", "Delete trip"], "explicit Cancel and Delete actions");
  assert.ok(confirmButton().className.includes("danger"), "destructive action styled as such");
  assert.equal(doc.activeElement, cancelButton(), "focus starts on Cancel");
  assert.equal(feedback(), "");
  assertPlainCopy("confirmation");
  cancelButton().click();
  assert.equal(dialog(), null, "Cancel closes the confirmation");
  assert.equal(doc.activeElement, deleteControl(HARBOR), "focus returns to the card's Delete control");

  deleteControl(HARBOR).click();
  const escapeEvent = new window.Event("cancel", { cancelable: true });
  dialog().dispatchEvent(escapeEvent);
  assert.ok(escapeEvent.defaultPrevented && dialog() === null, "Escape cancels");
  assert.equal(doc.activeElement, deleteControl(HARBOR));
  deleteControl(HARBOR).click();
  dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(dialog(), null, "Escape key cancels");
  await sleep(40);
  assert.equal(deletes().length, 0, "cancelling never sends a request");

  // C. Stale version: someone edits the trip after the card was shown. Nothing is deleted, the list is
  // refreshed, and the newer version is never sent automatically.
  deleteControl(HARBOR).click();
  trips.find((trip) => trip.id === "fictional-harbor").version = 4;
  clearStatus(); const callsBeforeConflict = calls.length;
  confirmButton().click();
  await until(() => feedback() && settled() && calls.slice(callsBeforeConflict).some((call) => call.method === "GET" && call.path === "/api/trips"), "conflict shown and list refreshed");
  const conflictCall = deletesFor("fictional-harbor").at(-1);
  const conflictBody = JSON.parse(conflictCall.body);
  assert.deepEqual(Object.keys(conflictBody).sort(), ["expectedVersion", "requestId"], "only the agreed fields are sent");
  assert.equal(conflictBody.expectedVersion, 3, "the version shown on the card is sent");
  assert.match(conflictBody.requestId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
  assertSessionCheckedBefore(conflictCall);
  assert.ok(feedback().includes("changed") && feedback().includes("nothing was deleted"), "conflict explained");
  assert.deepEqual(dialogButtons(), ["Close"], "no delete control after a conflict");
  assert.equal(doc.activeElement, cancelButton(), "focus moves to Close");
  assertPlainCopy("conflict");
  // Owner refresh ends with the account list; the cards are re-rendered right after it.
  await until(() => calls.slice(callsBeforeConflict).some((call) => call.method === "GET" && call.path === "/api/users"), "refresh finished");
  await sleep(40);
  assert.equal(deletesFor("fictional-harbor").length, 1, "a conflict is never retried with the newer version");
  assert.ok(trips.some((trip) => trip.id === "fictional-harbor"), "the newer edits are kept");
  cancelButton().click();
  assert.equal(dialog(), null);
  // Deliberately confirming again uses the refreshed version and a new request id.
  deleteControl(HARBOR).click(); clearStatus();
  confirmButton().click();
  await until(() => !dialog() && !cardFor(HARBOR) && byId("status").textContent === "“" + HARBOR + "” was deleted." && idle(), "active trip deleted");
  const harborBody = JSON.parse(deletesFor("fictional-harbor").at(-1).body);
  assert.equal(harborBody.expectedVersion, 4); assert.notEqual(harborBody.requestId, conflictBody.requestId, "a new confirmation gets a new request id");
  assert.equal(byId("status").dataset.error, "false");
  assert.equal(doc.activeElement, byId("trips").querySelector("h1"), "focus moves to the trip list heading");

  // D. Archived trip, double submit: repeated clicks, Escape and refreshes during the request send exactly one.
  const orchardHold = hold("DELETE", /\/fictional-orchard$/);
  deleteControl(ORCHARD).click(); clearStatus();
  confirmButton().click();
  await until(() => orchardHold.started, "archived deletion in flight");
  assert.ok(confirmButton().disabled && cancelButton().disabled, "actions disabled while in flight");
  assert.equal(confirmButton().textContent, "Deleting…"); assert.equal(dialog().getAttribute("aria-busy"), "true");
  confirmButton().click(); confirmButton().click();
  confirmButton().dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  dialog().dispatchEvent(new window.Event("cancel", { cancelable: true }));
  dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  refresh(); byId("retry").click();
  await sleep(60);
  assert.ok(dialog()?.open, "the confirmation stays open while the request is in flight");
  assert.equal(deletesFor("fictional-orchard").length, 1, "exactly one request despite repeated attempts");
  orchardHold.open();
  await until(() => !dialog() && !cardFor(ORCHARD) && byId("status").textContent === "“" + ORCHARD + "” was deleted." && idle(), "archived trip deleted");
  const orchardCall = deletesFor("fictional-orchard")[0];
  assert.equal(orchardCall.path, "/api/trips/fictional-orchard", "the selected trip is targeted");
  assert.equal(JSON.parse(orchardCall.body).expectedVersion, 5);
  assertSessionCheckedBefore(orchardCall);
  assert.ok(!trips.some((trip) => trip.id === "fictional-orchard"));

  // E. Unknown outcome (never reached the server): no automatic retry; closing and reopening the same
  // trip repeats the identical request; a lost answer is resolved by an explicit, read-only Check status.
  failNext = { method: "DELETE", match: /\/fictional-ferry$/, mode: "drop" };
  deleteControl(FERRY).click(); clearStatus();
  confirmButton().click();
  await until(() => feedback() && settled(), "unknown outcome shown");
  const ferryFirst = deletesFor("fictional-ferry")[0].body;
  assert.ok(feedback().includes("not known") && feedback().includes("Nothing was retried automatically"), "uncertain status explained");
  assert.deepEqual(dialogButtons(), ["Close", "Check status", "Try again"]);
  assert.equal(doc.activeElement, checkButton(), "focus moves to Check status");
  assertPlainCopy("uncertain");
  refresh(); await sleep(60); await until(idle, "refresh after unknown outcome");
  byId("retry").click(); await sleep(60); await until(idle, "explicit refresh after unknown outcome");
  assert.equal(deletesFor("fictional-ferry").length, 1, "an unknown outcome is never retried automatically");
  assert.ok(dialog()?.open && feedback().includes("not known"), "the unknown state survives refreshes");
  cancelButton().click();
  assert.equal(dialog(), null); assert.equal(doc.activeElement, deleteControl(FERRY));
  deleteControl(FERRY).click();
  assert.deepEqual(dialogButtons(), ["Cancel", "Delete trip"], "a reopened confirmation asks again");
  failNext = { method: "DELETE", match: /\/fictional-ferry$/, mode: "lost" };
  confirmButton().click();
  await until(() => feedback().includes("not known") && settled(), "second unknown outcome");
  assert.equal(deletesFor("fictional-ferry").length, 2);
  assert.equal(deletesFor("fictional-ferry")[1].body, ferryFirst, "the same trip, version and request id are repeated exactly");
  assert.ok(!trips.some((trip) => trip.id === "fictional-ferry"), "fixture: the server applied it but the answer was lost");
  clearStatus(); checkButton().click();
  await until(() => !dialog() && !cardFor(FERRY) && byId("status").textContent === "“" + FERRY + "” was deleted." && idle(), "Check status confirms the deletion");
  assert.equal(deletesFor("fictional-ferry").length, 2, "Check status sends no deletion");

  // F. Owner check cannot complete: nothing is sent. Then a server error, Check status (still there)
  // and an explicit Try again that repeats the identical request.
  failNext = { method: "GET", match: /^\/api\/session$/, mode: "drop" };
  deleteControl(PIER).click(); clearStatus();
  confirmButton().click();
  await until(() => feedback() && settled(), "not sent");
  assert.equal(deletesFor("fictional-pier").length, 0, "no deletion without a completed owner check");
  assert.ok(feedback().startsWith("Nothing was deleted"), "explains that nothing was deleted");
  assert.deepEqual(dialogButtons(), ["Cancel", "Delete trip"]);
  failNext = { method: "DELETE", match: /\/fictional-pier$/, status: 503 };
  confirmButton().click();
  await until(() => feedback().includes("not known") && settled(), "server error is treated as unknown");
  const pierFirst = deletesFor("fictional-pier")[0].body;
  checkButton().click();
  await until(() => feedback() === "“" + PIER + "” is still in your trips, so it has not been deleted. You can try again or close this." && settled(), "still there");
  assert.equal(doc.activeElement, confirmButton(), "focus moves to Try again");
  assert.equal(confirmButton().textContent, "Try again");
  assert.equal(deletesFor("fictional-pier").length, 1, "checking sends nothing");
  clearStatus(); confirmButton().click();
  await until(() => !dialog() && !cardFor(PIER) && byId("status").textContent === "“" + PIER + "” was deleted." && idle(), "explicit retry deletes");
  assert.equal(deletesFor("fictional-pier").length, 2);
  assert.equal(deletesFor("fictional-pier")[1].body, pierFirst, "explicit retry repeats the identical request");
  assertSessionCheckedBefore(deletesFor("fictional-pier")[1]);

  // G. Four languages: the open confirmation follows the language picker.
  deleteControl(CEDAR).click();
  for (const [code, control, cancel, confirm, phrase] of [["zh-Hans", "删除", "取消", "删除旅行", "永久"], ["zh-Hant", "刪除", "取消", "刪除旅行", "永久"], ["ja", "削除", "キャンセル", "旅行を削除", "完全に"], ["en", "Delete", "Cancel", "Delete trip", "permanently"]]) {
    const picker = byId("language"); picker.value = code; picker.dispatchEvent(new window.Event("change"));
    assert.equal(doc.documentElement.lang, code);
    assert.equal(deleteControl(CEDAR).textContent, control, code + " card control");
    assert.ok(deleteControl(CEDAR).getAttribute("aria-label").includes(CEDAR), code + " card control names the trip");
    assert.ok(dialog()?.open, code + " confirmation stays open");
    assert.ok(dialog().querySelector("h2").textContent.includes(CEDAR), code + " title names the trip");
    assert.ok(dialog().querySelector(".delete-warning").textContent.includes(phrase), code + " permanent removal explained");
    assert.deepEqual(dialogButtons(), [cancel, confirm], code + " actions");
    assertPlainCopy(code);
  }
  cancelButton().click();
  const homeSource = fs.readFileSync(new URL("../assets/selfhosted/home.js", import.meta.url), "utf8");
  for (const key of ["deleteTrip", "deleteTripFor", "deleteTitle", "deleteWarning", "deleteTip", "deleteConfirm", "deleting", "deleteRetry", "deleteCheck", "checking", "close", "deleted", "deleteConflict", "deleteUncertain", "deleteStillThere", "deleteCheckFailed", "deleteNotSent", "deleteFailed", "deleteGone", "deleteOwnerOnly"]) {
    assert.equal(homeSource.split(new RegExp("[\\s{,]" + key + ": \"")).length - 1, 4, "message " + key + " exists in all four languages");
  }

  // A concurrent deletion can return the backend's durable 410 tombstone response.
  const goneTitle = "Fictional Dune Draft"; ALL_TITLES.push(goneTitle);
  trips.push({ id: "fictional-dune", title: goneTitle, version: 1, archived: false });
  refresh(); await until(() => ownerHome() && deleteControl(goneTitle), "concurrent-deletion fixture");
  deleteControl(goneTitle).click();
  trips = trips.filter((trip) => trip.id !== "fictional-dune");
  failNext = { method: "DELETE", match: /\/fictional-dune$/, status: 410 };
  confirmButton().click();
  await until(() => !dialog() && !cardFor(goneTitle) && byId("status").textContent.includes("no longer") && idle(), "already-deleted tombstone outcome");
  assert.equal(deletesFor("fictional-dune").length, 1, "a tombstone response is not retried");

  // H. Owner check at submission: the session changed to a content manager in another tab.
  deleteControl(CEDAR).click(); role = "content-manager"; clearStatus();
  const beforeDemotion = deletes().length;
  confirmButton().click();
  await until(() => !dialog() && byId("status").textContent === "Only the owner can delete trips." && idle() && !byId("manager-note").hidden, "submission refused for a non-owner");
  assert.equal(deletes().length, beforeDemotion, "nothing sent once the account is no longer the owner");
  assert.equal(byId("status").dataset.error, "true");
  // Content managers edit, archive and restore returned member trips, but never see a whole-trip delete, archived included.
  assert.ok(cardFor(CEDAR) && cardFor(SALT), "manager sees active and archived trips");
  for (const card of cards()) assert.deepEqual(labels(card), ["Edit", card === cardFor(SALT) ? "Restore" : "Archive", "Export", "Participants"], "no delete control for a content manager");
  assert.equal(doc.querySelectorAll("[data-delete-trip], dialog").length, 0);

  // I. Role demotion while the confirmation is open clears it.
  role = "owner"; refresh();
  await until(() => ownerHome() && deleteControl(CEDAR), "owner again");
  deleteControl(CEDAR).click(); assert.ok(dialog()?.open);
  role = "content-manager"; refresh();
  await until(() => !dialog() && !doc.querySelector("[data-delete-trip]") && !byId("manager-note").hidden && idle(), "demotion clears the confirmation");
  assert.equal(deletes().length, beforeDemotion);

  // J. Viewer: export only, active and archived.
  role = "viewer"; refresh();
  await until(() => !byId("read-only-note").hidden && byId("create").hidden && idle(), "viewer view");
  for (const card of cards()) assert.deepEqual(labels(card), ["Export","Participants"], "member card actions");
  assert.equal(doc.querySelectorAll("[data-delete-trip], dialog").length, 0);

  // K. Session ends while the confirmation is open.
  role = "owner"; refresh();
  await until(() => ownerHome() && deleteControl(CEDAR), "owner before session end");
  deleteControl(CEDAR).click(); assert.ok(dialog()?.open);
  role = null; refresh();
  await until(() => signedOutView() && !dialog(), "expired session clears the confirmation");
  assert.equal(doc.querySelectorAll("[data-delete-trip], dialog").length, 0, "no delete control when signed out");

  // L. Session ends while a deletion is in flight: the late answer is discarded.
  role = "owner"; refresh();
  await until(() => ownerHome() && deleteControl(CEDAR), "owner before in-flight sign-out");
  const cedarHold = hold("DELETE", /\/fictional-cedar$/);
  deleteControl(CEDAR).click(); clearStatus();
  confirmButton().click();
  await until(() => cedarHold.started, "deletion in flight before sign-out");
  role = null; byId("retry").click();
  await until(() => signedOutView() && !dialog(), "signed out during the request");
  cedarHold.open(); await sleep(80);
  assert.ok(signedOutView() && !dialog(), "nothing reappears after the late answer");
  assert.ok(!byId("status").textContent.includes(CEDAR) && !doc.body.textContent.includes(CEDAR), "late answer not shown");

  // M. Storage and requests: no trip content or deletion state is kept in browser storage.
  for (const title of ALL_TITLES) assert.ok(!storageText().includes(title), "no trip title in browser storage");
  assert.ok(!/delete-|fictional-/.test(storageText()), "no request id or trip id in browser storage");
  assert.ok(deletes().every((call) => /^\/api\/trips\/fictional-[a-z]+$/.test(call.path)), "deletion only through the agreed path");

  // N. Narrow screens: jsdom has no layout, so the phone rules and dialog sizing are checked statically.
  const css = fs.readFileSync(new URL("../assets/selfhosted/home.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media(max-width:500px)"));
  assert.ok(phone.includes(".delete-dialog .actions {flex-direction:column"), "phone: stacked dialog actions");
  assert.ok(phone.includes(".delete-dialog .actions button {width:100%;}"), "phone: full-width dialog actions");
  assert.match(css, /dialog \{[^}]*width:min\(460px,calc\(100vw - 28px\)\)[^}]*max-height:calc\(100dvh - 48px\);overflow:auto/, "dialog fits and scrolls on small screens");
  for (const width of [375, 390]) assert.ok(Math.min(460, width - 28) <= width - 28 && Math.min(460, width - 28) >= 340, width + "px: dialog keeps 14px side margins");
  assert.match(css, /\.delete-dialog h2 \{[^}]*overflow-wrap:anywhere/, "long trip titles wrap");
  assert.match(css, /\.delete-dialog \.actions button \{min-height:44px/, "touch-sized dialog actions");
  assert.match(css, /\.delete-dialog button:focus-visible/, "visible keyboard focus in the dialog");

  // O. Sign-out button with an open confirmation (last: the page leaves afterwards).
  role = "owner"; refresh();
  await until(() => ownerHome() && deleteControl(SALT), "owner before sign-out");
  deleteControl(SALT).click(); assert.ok(dialog()?.open);
  const beforeLogout = deletes().length;
  byId("logout").click();
  assert.equal(doc.querySelector("dialog"), null, "sign-out removes the confirmation immediately");
  await until(() => role === null, "sign-out request");
  await sleep(40);
  assert.equal(deletes().length, beforeLogout, "sign-out sends no deletion");
  assert.ok(trips.some((trip) => trip.id === "fictional-salt"));

  assert.deepEqual(errors, []);
  console.log("Owner delete-trip home DOM regression passed: owner-only Delete on active and archived cards, accessible confirmation naming the trip with permanent whole-trip removal and no in-app undo, Cancel/Escape send nothing with focus returned, displayed version and agreed body sent after a fresh owner check, single request despite repeated clicks, conflicts refreshed without resending, unknown outcomes with no automatic retry and identical explicit retries, read-only Check status, refusal after an owner-to-manager change, no control for content managers (archived included), viewers or signed-out pages, clearing on demotion, session end and sign-out with late answers discarded, nothing in browser storage, four languages. Phone layout checked statically only; no browser layout claim.");
} finally {
  timers.forEach(clearTimeout); try { window.close(); } catch {}
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout;
}
