// Optional Google Places UI Kit: browser-side DOM simulation with a MOCKED Google library.
//
// Nothing here contacts Google. The standard gmp-* tags are fake custom elements defined in jsdom
// that only count constructions, EVERY connection and disconnection (of the component and of its
// nested custom children), re-connections, place-request assignments and text queries, and record
// any attempt to read shadow DOM. Element.moveBefore is, by default, a native-equivalent mock: like
// Chrome for an element without connectedMoveCallback it disconnects and re-connects (an ordinary
// insert), and every call is counted; scenario G6 also runs with it absent and throwing. The app must
// never call it: a component is connected once into its own host and never reparented, so any
// re-render releases it and offers an explicit control. The Maps script is never fetched: a
// MutationObserver sees the injected <script> element, records its URL, installs a fake
// google.maps.importLibrary and calls the page's callback. The trip API is an in-memory fictional
// server following the documented contract, including allowance reservations whose provider month is
// computed (America/Los_Angeles) from the same wall clock the page uses; unit gates get explicitly
// injected clocks. The browser key and Place IDs are obviously fake placeholders.
//
// This is UI/contract evidence only. It does not show how the real SDK renders, bills, caches,
// re-requests on reconnection, or behaves on any device, and it is no browser-layout check.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  GOOGLE_PLACE_ASSOCIATION_KEYS, associationForPlan, associationMatchesPlan, locationBindingForPlan
} from "../assets/app-template/public/google-place-association.js";
import {
  GOOGLE_TEXT_KEYS, GOOGLE_TEXT_LANGUAGES, MAPS_JS_URL, READY_CALLBACK, SEARCH_RESULT_LIMIT, STANDARD_TAGS,
  checkVenueQuery, createGoogleAllowanceGate, createGooglePlaceHost, createGooglePlacesLoader, createPlaceDetailsManager, createPlacePreviewSession,
  createPlaceSearchSession, googleText, mapsScriptUrl, providerMonth, selectedPlaceId
} from "../assets/app-template/public/google-places-ui-kit.js";

const PUBLIC_DIR = fileURLToPath(new URL("../assets/app-template/public/", import.meta.url));
const ORIGIN = "http://fictional-trips.test";
const TRIP_ID = "fictional-lanterns";
const DAY_ONE = "2031-05-04";
const LANGUAGES = ["en", "zh-Hans", "zh-Hant", "ja"];
const FAKE_KEY = "FAKE-browser-key-for-tests-only-000000000";
const PLACE = Object.freeze({
  garden: "FAKE_place_garden_0001", museum: "FAKE_place_museum_0001", pier: "FAKE_place_pier_0001",
  stale: "FAKE_place_stale_0001", chosen: "FAKE_place_chosen_0001", pasted: "FAKE_place_pasted_0001",
  relinked: "FAKE_place_garden_0002", created: "FAKE_place_created_0001", other: "FAKE_place_other_0001",
  alias: "FAKE_place_alias_0001", mismatch: "FAKE_place_mismatch_0001"
});
const extraPlace = (n) => `FAKE_place_extra_000${n}`;
const DETAILS = "gmp-place-details-compact";
const SEARCH = "gmp-place-search";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (value) => structuredClone(value);
const textOf = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------
// Fake standard components (shared by the unit window and every page window).

function newGoogleRecord() {
  return { constructed: {}, connects: {}, disconnects: {}, reconnects: [], moveCalls: 0, placeAssignments: [], textQueries: [], shadowReads: 0, placeReads: 0, instances: [], created: [], scripts: [], imports: [] };
}

// Element.moveBefore as the page may find it. "native": native-equivalent for an element without
// connectedMoveCallback (HTML standard / Chrome): disconnectedCallback and connectedCallback still
// run, exactly as an ordinary insert does in jsdom. "throws" and "absent" as in older browsers.
// Every call is counted; the app must never make one.
function installMoveBefore(window, record, mode = "native") {
  const modes = {
    native(node, child) {
      record.moveCalls += 1;
      if (!this.isConnected || !node.isConnected) throw new window.DOMException("Both nodes must be connected.", "HierarchyRequestError");
      this.insertBefore(node, child);
    },
    throws() { record.moveCalls += 1; throw new window.DOMException("Simulated unsupported move.", "HierarchyRequestError"); },
    absent: undefined
  };
  Object.defineProperty(window.Element.prototype, "moveBefore", { configurable: true, writable: true, value: modes[mode] });
}

function defineStandardElements(window, record) {
  for (const tag of STANDARD_TAGS) {
    if (window.customElements.get(tag)) continue;
    window.customElements.define(tag, class extends window.HTMLElement {
      static get observedAttributes() { return ["place", "text-query"]; }
      constructor() {
        super();
        record.constructed[tag] = (record.constructed[tag] || 0) + 1;
        record.instances.push(this);
      }
      connectedCallback() {
        record.connects[tag] = (record.connects[tag] || 0) + 1;
        // Any second connection of the same element (by an ordinary insert or a moveBefore without
        // connectedMoveCallback) is a re-connection the SDK might bill.
        this.fictionalConnections = (this.fictionalConnections || 0) + 1;
        if (this.fictionalConnections > 1) record.reconnects.push(tag);
      }
      disconnectedCallback() { record.disconnects[tag] = (record.disconnects[tag] || 0) + 1; }
      attributeChangedCallback(name, _old, value) {
        if (name === "place") record.placeAssignments.push(value);
        if (name === "text-query") record.textQueries.push(value);
      }
      // The app must never open a component's shadow DOM or read component place data.
      get shadowRoot() { record.shadowReads += 1; return null; }
      get place() { record.placeReads += 1; return undefined; }
    });
  }
  const original = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...rest) => { record.created.push(String(tag).toLowerCase()); return original(tag, ...rest); };
}

const fakeLibrary = (record) => ({
  maps: { importLibrary: async (name) => { record.imports.push(name); return { fictionalPlacesLibrary: true }; } }
});

function assertOnlyStandard(record, label) {
  for (const tag of record.created.filter((name) => name.startsWith("gmp-"))) {
    assert.ok(STANDARD_TAGS.has(tag), `${label}: only standard components (${tag})`);
    assert.ok(!/advanced|map(?:-|$)/.test(tag), `${label}: no Advanced component and no Google map (${tag})`);
  }
  assert.equal(record.shadowReads, 0, `${label}: shadow DOM never read`);
  assert.equal(record.placeReads, 0, `${label}: component place data never read`);
  assert.deepEqual(record.reconnects, [], `${label}: no component or nested child was ever re-connected`);
  assert.equal(record.moveCalls, 0, `${label}: Element.moveBefore was never called`);
}

// Explicitly injected clocks for unit gates: 2031-05-15 12:00 PDT, inside provider month 2031-05.
const UNIT_WALL = Date.UTC(2031, 4, 15, 19, 0, 0);
const UNIT_MONTH = "2031-05";
const unitClocks = () => ({ now: () => 1000, wallNow: () => UNIT_WALL, watchVisibility: () => () => {} });

// A real allowance gate whose fictional server always grants, counting reservation requests.
function grantingGate(tripId = "trip-a") {
  const requests = [];
  let next = 0;
  const gate = createGoogleAllowanceGate({
    tripId,
    ...unitClocks(),
    reserve: async (body) => {
      requests.push(body);
      next += 1;
      return { granted: true, replayed: false, apiKey: FAKE_KEY, libraries: ["places"],
        permit: { id: "gpr_" + String(next).padStart(24, "0"), kind: body.kind, tripId, placeId: body.placeId ?? null, month: UNIT_MONTH, validForMs: 45000 } };
    }
  });
  gate.requests = requests;
  return gate;
}

// Records every property read; only "id" is allowed.
function placeProxy(id, accessed) {
  return new Proxy({ id, displayName: "Fictional Google Name", formattedAddress: "Fictional Google Address", location: { lat: 1, lng: 2 }, photos: [{}] }, {
    get(target, property) {
      accessed.push(String(property));
      if (property === "id") return target.id;
      throw new Error(`Only place.id may be read (tried ${String(property)})`);
    }
  });
}

function manualTimers() {
  const pending = new Map();
  let next = 1;
  return {
    set: (fn, ms) => { const id = next++; pending.set(id, { fn, ms }); return id; },
    clear: (id) => { pending.delete(id); },
    fireAll() { for (const [id, timer] of [...pending]) { pending.delete(id); timer.fn(); } },
    get size() { return pending.size; }
  };
}

function controllableLoader() {
  const ensure = () => {
    if (!loader.promise) {
      loader.state = "loading";
      loader.promise = new Promise((resolve, reject) => { loader.settle = { resolve, reject }; });
      loader.promise.catch(() => {});
    }
    return loader.promise;
  };
  const loader = {
    calls: 0, resets: 0, keys: [], state: "idle", promise: null, settle: null,
    load(key) {
      loader.calls += 1;
      loader.keys.push(key);
      return ensure();
    },
    // May settle before load() is called (the reservation is still in flight); load() then
    // returns the already-settled promise.
    resolve() { ensure(); loader.state = "ready"; loader.settle.resolve({ fictional: true }); },
    reject(code) { ensure(); loader.state = "failed"; loader.settle.reject(Object.assign(new Error(code), { code })); },
    reset() { if (loader.state !== "failed") return false; loader.resets += 1; loader.promise = null; loader.state = "idle"; return true; },
    onFailure() { return () => {}; }
  };
  return loader;
}

// ---------------------------------------------------------------------------------------------
// 1. Pure module checks: copy, query guard, script URL, selection reads only the ID.

assert.deepEqual([...GOOGLE_TEXT_LANGUAGES].sort(), [...LANGUAGES].sort(), "Google copy exists for the four app languages");
for (const language of LANGUAGES) {
  for (const key of GOOGLE_TEXT_KEYS) {
    const value = googleText(language, key);
    assert.ok(value && value !== key && !/[{}]/.test(value), `${language}.${key} is written`);
    // Traveler-facing copy: no billing, SKU, key or SDK jargon (the example link placeholder is a URL).
    if (key !== "placeIdPlaceholder") {
      assert.ok(!/\b(?:SKU|API|UI Kit|billing|Essentials|quota|Places API|browser key|SDK)\b/i.test(value), `${language}.${key} avoids configuration jargon`);
    }
  }
}
for (const language of ["zh-Hans", "zh-Hant", "ja"]) {
  const translated = GOOGLE_TEXT_KEYS.filter((key) => googleText(language, key) !== googleText("en", key));
  assert.ok(translated.length >= GOOGLE_TEXT_KEYS.length - 1, `${language} is translated (only the example link is shared)`);
}
assert.ok(/sent to Google/.test(googleText("en", "privacyNote")) && /booking/.test(googleText("en", "privacyNote")), "the privacy note says what is sent and what not to type");
assert.ok(/public business or landmark/.test(googleText("en", "publicVenueLabel")));
assert.ok(/Nothing is linked until you pick one/.test(googleText("en", "chooseResult")), "the user is told nothing is picked automatically");

assert.deepEqual(checkVenueQuery("  Invented   Lantern Museum "), { ok: true, query: "Invented Lantern Museum" });
assert.equal(checkVenueQuery("a").errorKey, "queryTooShort");
assert.equal(checkVenueQuery("x".repeat(121)).errorKey, "queryTooLong");
assert.equal(checkVenueQuery("traveler@example.org").errorKey, "queryPrivate", "email addresses are refused before anything is sent");
assert.equal(checkVenueQuery("Booking 1234 5678 90").errorKey, "queryPrivate", "long digit runs are refused");

{
  const url = new URL(mapsScriptUrl(FAKE_KEY, "zh-Hant"));
  assert.equal(`${url.origin}${url.pathname}`, MAPS_JS_URL);
  assert.deepEqual([...url.searchParams.keys()].sort(), ["callback", "key", "language", "libraries", "loading", "v"]);
  assert.equal(url.searchParams.get("libraries"), "places", "only the places library");
  assert.equal(url.searchParams.get("language"), "zh-TW");
  assert.equal(url.searchParams.get("callback"), READY_CALLBACK);
  assert.equal(url.searchParams.get("loading"), "async");
}
{
  const accessed = [];
  const event = { place: placeProxy(PLACE.chosen, accessed) };
  assert.equal(selectedPlaceId(event), PLACE.chosen);
  assert.deepEqual(accessed, ["id"], "a selection event exposes only the Place ID to this app");
  assert.equal(selectedPlaceId({ place: { id: "not valid!" } }), "");
  assert.equal(selectedPlaceId({ place: null }), "");
  assert.equal(selectedPlaceId({}), "");
}

// ---------------------------------------------------------------------------------------------
// 2. Unit tests with injected timers: loader, details manager, search and preview sessions.

{
  const unit = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: `${ORIGIN}/trips/unit` });
  const uwin = unit.window;
  const udoc = uwin.document;
  const record = newGoogleRecord();
  defineStandardElements(uwin, record);
  installMoveBefore(uwin, record, "native");
  {
    // Fixture self-check (separate window): the native-equivalent move really re-connects.
    const probeWindow = new JSDOM("<!doctype html><html><body></body></html>", { url: `${ORIGIN}/trips/probe` }).window;
    const probeRecord = newGoogleRecord();
    defineStandardElements(probeWindow, probeRecord);
    installMoveBefore(probeWindow, probeRecord, "native");
    const probe = probeWindow.document.createElement("gmp-place-media");
    const from = probeWindow.document.body.appendChild(probeWindow.document.createElement("div"));
    const to = probeWindow.document.body.appendChild(probeWindow.document.createElement("div"));
    from.append(probe);
    to.moveBefore(probe, null);
    assert.deepEqual([probeRecord.reconnects, probeRecord.moveCalls, probeRecord.disconnects["gmp-place-media"]], [["gmp-place-media"], 1, 1], "fixture: moveBefore without connectedMoveCallback disconnects and re-connects");
    probeWindow.close();
  }
  const containers = udoc.body.appendChild(udoc.createElement("div"));
  const makeHost = () => containers.appendChild(createGooglePlaceHost(udoc, "en"));
  const BINDING = "v1:" + "a".repeat(64);
  const desc = (planId, placeId, extra = {}) => ({ tripId: "trip-a", planId, placeId, binding: BINDING, ...extra });
  const detailsCount = () => record.constructed[DETAILS] || 0;

  // 2a. Loader: nothing until load(key); one script and one importLibrary; never without a key.
  {
    const timers = manualTimers();
    const win = {};
    const injected = [];
    const imports = [];
    const loader = createGooglePlacesLoader({
      win, language: "ja", setTimer: timers.set, clearTimer: timers.clear,
      injectScript: async (src) => { injected.push(src); win.google = { maps: { importLibrary: async (name) => { imports.push(name); return { fake: true }; } } }; }
    });
    assert.equal(injected.length + imports.length, 0, "creating a loader contacts nothing");
    assert.equal(loader.state, "idle");
    for (const missing of [undefined, "", "short", "has spaces in the key value 0000000000"]) {
      await assert.rejects(loader.load(missing), (error) => error.code === "unavailable", "no key from a granted reservation: nothing is loaded");
    }
    assert.deepEqual([injected.length, imports.length, loader.state], [0, 0, "idle"], "a load without a granted key injects no script");
    const [first, second] = await Promise.all([loader.load(FAKE_KEY), loader.load(FAKE_KEY)]);
    assert.equal(first, second, "one shared library promise");
    await loader.load(FAKE_KEY);
    assert.deepEqual([injected.length, imports], [1, ["places"]], "one script, one importLibrary('places')");
    assert.equal(new URL(injected[0]).searchParams.get("key"), FAKE_KEY);
    assert.equal(new URL(injected[0]).searchParams.get("language"), "ja");
    assert.equal(loader.reset(), false, "a loaded library is never reloaded");
    assert.deepEqual(loader.stats, { scriptLoads: 1, libraryImports: 1, cancelled: 0 });
    assert.equal(loader.cancel(), false, "a finished load is never cancelled");
    assert.equal(loader.state, "ready");
  }
  {
    // cancel(): a load abandoned while its script is outstanding imports no library and its late
    // answer is ignored; a later load starts cleanly.
    const win = {};
    const injected = [];
    let release = null;
    const loader = createGooglePlacesLoader({
      win,
      injectScript: (src) => { injected.push(src); return new Promise((resolve) => { release = () => { win.google = fakeLibrary(newGoogleRecord()); resolve(); }; }); }
    });
    const abandoned = loader.load(FAKE_KEY);
    await sleep(1);
    assert.equal(loader.cancel(), true);
    assert.equal(loader.state, "idle");
    release();
    await assert.rejects(abandoned, (error) => error.code === "cancelled", "the late answer is ignored");
    assert.deepEqual([loader.stats.libraryImports, loader.state], [0, "idle"], "no library import after a cancel, and the state is not overwritten");
    await loader.load(FAKE_KEY);
    assert.deepEqual([injected.length, loader.state, loader.stats.cancelled, loader.stats.libraryImports], [1, "ready", 1, 1], "the already-present library is reused, not injected again");
  }
  {
    let attempts = 0;
    const win = {};
    const loader = createGooglePlacesLoader({
      win,
      injectScript: async () => { attempts += 1; if (attempts === 1) throw Object.assign(new Error("Simulated offline"), { code: "unavailable" }); win.google = fakeLibrary(newGoogleRecord()); }
    });
    await assert.rejects(loader.load(FAKE_KEY), (error) => error.code === "unavailable");
    await assert.rejects(loader.load(FAKE_KEY), (error) => error.code === "unavailable");
    assert.equal(attempts, 1, "a failure is remembered: no automatic retry");
    assert.equal(loader.reset(), true, "explicit retry");
    await loader.load(FAKE_KEY);
    assert.equal(attempts, 2);
  }
  {
    // The default injector: a single async script with the callback, no referrer override.
    const timers = manualTimers();
    const loader = createGooglePlacesLoader({ win: uwin, setTimer: timers.set, clearTimer: timers.clear });
    const pending = loader.load(FAKE_KEY);
    await sleep(5);
    const scripts = [...udoc.head.querySelectorAll("script")];
    assert.equal(scripts.length, 1);
    assert.ok(scripts[0].src.startsWith(MAPS_JS_URL) && scripts[0].async, "async Maps script");
    assert.equal(scripts[0].getAttribute("referrerpolicy"), null, "the page referrer policy applies, so origin key restrictions can work");
    assert.equal(typeof uwin[READY_CALLBACK], "function");
    uwin.google = fakeLibrary(record);
    uwin[READY_CALLBACK]();
    await pending;
    assert.equal(uwin[READY_CALLBACK], undefined, "the callback is removed after use");
    assert.equal(timers.size, 0, "the load timer is cleared");
    const other = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: `${ORIGIN}/trips/other` }).window;
    const slowTimers = manualTimers();
    const slow = createGooglePlacesLoader({ win: other, setTimer: slowTimers.set, clearTimer: slowTimers.clear });
    const slowLoad = slow.load(FAKE_KEY);
    await sleep(5);
    slowTimers.fireAll();
    await assert.rejects(slowLoad, (error) => error.code === "timeout", "a script that never answers times out");
    assert.equal(slow.state, "failed");
    other.close();
  }

  // 2b. Details manager: lazy, one active, deduplicated, retained, bounded, scoped, cancellable.
  {
    const timers = manualTimers();
    const loader = controllableLoader();
    const gate = grantingGate();
    const manager = createPlaceDetailsManager({ doc: udoc, loader, gate, language: () => "en", setTimer: timers.set, clearTimer: timers.clear, maxRetained: 3 });
    assert.equal(detailsCount() + loader.calls + gate.requests.length, 0, "creating the manager reserves, builds and loads nothing");
    const dA = desc("plan-a", PLACE.garden);
    const dB = desc("plan-b", PLACE.museum);
    const h1 = makeHost();
    const cancelled = manager.show(h1, dA);
    assert.equal(textOf(h1.querySelector(".google-place__status")), googleText("en", "detailsLoading"));
    manager.deactivate(dA);
    loader.resolve();
    assert.equal(await cancelled, false);
    assert.equal(detailsCount(), 0, "collapsing before the reservation and library are ready builds nothing");
    assert.equal(gate.requests.length, 1, "the expansion reserved once");

    assert.equal(await manager.show(h1, dA), true);
    assert.equal(gate.requests.length, 1, "re-expanding reuses the still-valid unused permit instead of reserving again");
    assert.deepEqual(gate.requests[0], { requestId: gate.requests[0].requestId, kind: "details", planId: "plan-a", placeId: PLACE.garden }, "the reservation names only the kind, plan and Place ID");
    assert.equal(detailsCount(), 1);
    assert.deepEqual(record.placeAssignments, [PLACE.garden], "one place-request assignment");
    assert.equal(loader.keys.at(-1), FAKE_KEY, "the library is loaded with the key from the granted reservation");
    const elementA = h1.querySelector(DETAILS);
    assert.ok(elementA, "component mounted in the host");
    assert.equal(elementA.getAttribute("orientation"), "vertical");
    assert.deepEqual([...elementA.children].map((child) => child.localName), ["gmp-place-details-place-request", "gmp-place-content-config"]);
    assert.deepEqual([...elementA.children[1].children].map((child) => child.localName), ["gmp-place-media", "gmp-place-address", "gmp-place-attribution"]);
    assert.equal(h1.getAttribute("aria-label"), googleText("en", "detailsRegion"));
    elementA.dispatchEvent(new uwin.Event("gmp-load"));
    assert.equal(textOf(h1.querySelector(".google-place__status")), "", "loaded: no status text");
    await manager.show(h1, dA);
    assert.equal(detailsCount(), 1, "repeated expansion reuses the component");

    // Collapse and re-expand: hidden and unhidden in the same host, never moved.
    manager.deactivate(dA);
    assert.ok(elementA.isConnected && h1.contains(elementA) && h1.querySelector(".google-place__mount").hidden, "collapsed: still connected, hidden in its own host");
    await manager.show(h1, dA);
    assert.ok(h1.querySelector(DETAILS) === elementA && !h1.querySelector(".google-place__mount").hidden, "re-expanded: unhidden in place");
    assert.deepEqual([detailsCount(), gate.requests.length, record.connects[DETAILS]], [1, 1, 1], "no reservation, construction or connection");

    // Re-render: the host is replaced. The component is released before (never parked or moved);
    // the new host offers an explicit control and the restore reserves and builds nothing.
    manager.releaseWithin(h1);
    h1.remove();
    assert.equal(elementA.isConnected, false, "released before the rebuild");
    assert.equal(udoc.querySelector(".google-place-parking"), null, "there is no parking area");
    const h1b = makeHost();
    assert.equal(await manager.restore(h1b, dA), false);
    assert.equal(h1b.querySelector(DETAILS), null, "the released element is never re-attached");
    assert.equal(h1b.dataset.googlePlaceState, "inactive");
    assert.equal(h1b.querySelector(".google-place__action").textContent, googleText("en", "showDetails"));
    assert.deepEqual([detailsCount(), record.placeAssignments.length, gate.requests.length], [1, 1, 1], "a re-render reserves, builds and assigns nothing");
    h1b.querySelector(".google-place__action").click();
    await sleep(5);
    const elementA2 = h1b.querySelector(DETAILS);
    assert.ok(elementA2 && elementA2 !== elementA, "the explicit Show builds a fresh component in the new host");
    assert.deepEqual([detailsCount(), gate.requests.length], [2, 2], "with its own fresh reservation");
    elementA2.dispatchEvent(new uwin.Event("gmp-load"));

    // Another plan becomes active: the first stays connected, hidden in its own host, and its
    // explicit control unhides it in place.
    const h2 = makeHost();
    await manager.show(h2, dB);
    assert.equal(detailsCount(), 3);
    assert.ok(elementA2.isConnected && h1b.contains(elementA2) && h1b.querySelector(".google-place__mount").hidden, "the inactive component is hidden in its own host");
    const showAgain = h1b.querySelector(".google-place__action");
    assert.equal(showAgain.hidden, false);
    assert.equal(showAgain.textContent, googleText("en", "showDetails"));
    showAgain.click();
    await sleep(5);
    assert.equal(h1b.querySelector(DETAILS), elementA2, "explicit re-show reuses the retained component in place");
    assert.equal(h1b.querySelector(".google-place__mount").hidden, false);
    assert.equal(h2.querySelector(".google-place__mount").hidden, true, "and hides the other one in its own host");
    assert.deepEqual([detailsCount(), gate.requests.length], [3, 3], "switching back reserves nothing");
    assert.ok(manager.isActive(dA) && !manager.isActive(dB));

    // Scope: another trip or a changed binding never reuses a component.
    await manager.show(makeHost(), { ...dA, tripId: "trip-b" });
    assert.equal(detailsCount(), 4, "another trip gets its own component");
    await manager.show(makeHost(), { ...dA, binding: "v1:" + "b".repeat(64) });
    assert.equal(detailsCount(), 5, "a changed location binding gets its own component");
    assert.ok(manager.retainedCount <= 3, "memory is bounded");
    assert.ok(udoc.querySelectorAll(DETAILS).length <= 3, "evicted components are removed from the document");

    // retain(): associations that are no longer current are dropped.
    const current = { ...dA, binding: "v1:" + "b".repeat(64) };
    manager.retain(new Set([manager.keyOf(current)]));
    assert.equal(manager.retainedCount, 1);
    assert.equal(elementA2.isConnected, false, "a stale association's component is discarded");

    // Failure: error state, no automatic retry, explicit Try again.
    const hE = makeHost();
    const dE = desc("plan-e", PLACE.pier);
    await manager.show(hE, dE);
    const elementE = hE.querySelector(DETAILS);
    elementE.dispatchEvent(new uwin.Event("gmp-error"));
    assert.equal(textOf(hE.querySelector(".google-place__status")), googleText("en", "detailsUnavailable"));
    assert.equal(elementE.isConnected, false, "a failed component is removed");
    const constructedAfterError = detailsCount();
    manager.deactivate(dE);
    await manager.show(hE, dE);
    assert.equal(detailsCount(), constructedAfterError, "re-expanding a failed place does not retry by itself");
    const tryAgain = hE.querySelector(".google-place__action");
    assert.equal(tryAgain.textContent, googleText("en", "tryAgain"));
    const reservationsBeforeRetry = gate.requests.length;
    tryAgain.click();
    await sleep(5);
    assert.equal(detailsCount(), constructedAfterError + 1, "Try again builds one new component");
    assert.equal(gate.requests.length, reservationsBeforeRetry + 1, "an explicit retry needs its own reservation");
    // Timeout counts as a failure.
    const hT = makeHost();
    await manager.show(hT, desc("plan-t", PLACE.stale));
    timers.fireAll();
    assert.equal(textOf(hT.querySelector(".google-place__status")), googleText("en", "detailsUnavailable"), "no answer within the timeout");
    assert.equal(gate.stats.dispatched, detailsCount(), "exactly one consumed permit per constructed component");
    manager.dispose();
    assert.equal(udoc.querySelectorAll(DETAILS).length, 0);
  }
  {
    // Library failure and a server-side "disabled" denial on the manager.
    const failing = controllableLoader();
    const manager = createPlaceDetailsManager({ doc: udoc, loader: failing, gate: grantingGate(), setTimer: () => 0, clearTimer: () => {} });
    const host = makeHost();
    const shown = manager.show(host, desc("plan-f", PLACE.garden));
    failing.reject("unavailable");
    await shown;
    assert.equal(textOf(host.querySelector(".google-place__status")), googleText("en", "detailsUnavailable"));
    assert.equal(failing.calls, 1);
    host.querySelector(".google-place__action").click();
    await sleep(5);
    assert.equal(failing.resets, 1, "only an explicit Try again resets the loader");
    const off = controllableLoader();
    const offGate = createGoogleAllowanceGate({ tripId: "trip-a", ...unitClocks(), reserve: async () => { throw Object.assign(new Error("off"), { status: 503, code: "google_places_disabled" }); } });
    const offManager = createPlaceDetailsManager({ doc: udoc, loader: off, gate: offGate, setTimer: () => 0, clearTimer: () => {} });
    const offHost = makeHost();
    const before = detailsCount();
    await offManager.show(offHost, desc("plan-g", PLACE.garden));
    assert.equal(offHost.hidden, true, "disabled: the host disappears and the plan shows its usual content");
    assert.deepEqual([off.calls, detailsCount() - before], [0, 0], "disabled: no library load and no component");
    manager.dispose(); offManager.dispose();
  }

  // 2c. Search session: explicit only, deduplicated query, user selection reads only the ID.
  {
    const timers = manualTimers();
    const loader = controllableLoader();
    loader.load(); loader.resolve();
    const mount = containers.appendChild(udoc.createElement("div"));
    const statuses = [];
    const selected = [];
    const gate = grantingGate();
    const session = createPlaceSearchSession({ doc: udoc, loader, gate, mount, onStatus: (key) => statuses.push(key), onSelect: (id) => selected.push(id), setTimer: timers.set, clearTimer: timers.clear });
    assert.equal(mount.querySelector(SEARCH), null, "nothing is built before an explicit search");
    assert.equal(gate.requests.length, 0, "nothing is reserved before an explicit search");
    const queriesBefore = record.textQueries.length;
    await session.search("Invented Old Pier");
    const element = mount.querySelector(SEARCH);
    assert.ok(element && element.hasAttribute("selectable"), "official selectable search element");
    const request = element.querySelector("gmp-place-text-search-request");
    assert.equal(request.getAttribute("text-query"), "Invented Old Pier", "only the typed public venue query");
    assert.equal(request.getAttribute("max-result-count"), String(SEARCH_RESULT_LIMIT));
    assert.deepEqual([...element.querySelector("gmp-place-content-config").children].map((child) => child.localName), ["gmp-place-address", "gmp-place-attribution"]);
    assert.deepEqual(record.textQueries.slice(queriesBefore), ["Invented Old Pier"]);
    assert.deepEqual(statuses, ["searching"]);
    element.dispatchEvent(new uwin.Event("gmp-load"));
    assert.equal(statuses.at(-1), "chooseResult");
    assert.deepEqual(selected, [], "results never select anything by themselves");
    assert.equal(gate.requests.length, 1, "one reservation for the first query");
    assert.deepEqual(Object.keys(gate.requests[0]).sort(), ["kind", "requestId"], "the search text is never sent to this server");
    await session.search("Invented Old Pier");
    assert.equal(record.textQueries.length - queriesBefore, 1, "the same query is not sent again");
    assert.equal(gate.requests.length, 1, "and reserves nothing");
    await session.search("Invented Pier Gate");
    assert.equal(record.textQueries.length - queriesBefore, 2);
    assert.equal(gate.requests.length, 2, "every new query has its own reservation");
    assert.equal(mount.querySelectorAll(SEARCH).length, 1, "one search element per editor session");
    const accessed = [];
    const choose = new uwin.Event("gmp-select");
    choose.place = placeProxy(PLACE.chosen, accessed);
    element.dispatchEvent(choose);
    assert.deepEqual(selected, [PLACE.chosen]);
    assert.deepEqual(accessed, ["id"], "only place.id is read from the selection");
    const invalid = new uwin.Event("gmp-select");
    invalid.place = { id: "not a place id!" };
    element.dispatchEvent(invalid);
    assert.deepEqual(selected, [PLACE.chosen], "an invalid ID is ignored");
    timers.fireAll();
    assert.equal(statuses.at(-1), "searchFailed", "a search with no answer reports failure");
    session.dispose();
    assert.equal(element.isConnected, false, "cancel removes the search element");
    const late = new uwin.Event("gmp-select");
    late.place = { id: PLACE.other };
    element.dispatchEvent(late);
    assert.deepEqual(selected, [PLACE.chosen], "a late selection after cancel is ignored");
  }

  // 2d. Place ID preview: one component, explicit confirmation afterwards.
  {
    const timers = manualTimers();
    const loader = controllableLoader();
    loader.load(); loader.resolve();
    const mount = containers.appendChild(udoc.createElement("div"));
    const statuses = [];
    const gate = grantingGate();
    const preview = createPlacePreviewSession({ doc: udoc, loader, gate, mount, onStatus: (key) => statuses.push(key), setTimer: timers.set, clearTimer: timers.clear });
    const before = detailsCount();
    await preview.preview(PLACE.pasted);
    assert.equal(detailsCount(), before + 1);
    assert.deepEqual([gate.requests.length, gate.requests[0].kind, gate.requests[0].placeId], [1, "preview", PLACE.pasted], "one preview reservation for that Place ID");
    assert.equal(mount.querySelector("gmp-place-details-place-request").getAttribute("place"), PLACE.pasted);
    assert.equal(preview.readyPlaceId, "", "not usable before it loads");
    mount.querySelector(DETAILS).dispatchEvent(new uwin.Event("gmp-load"));
    assert.equal(preview.readyPlaceId, PLACE.pasted);
    assert.equal(statuses.at(-1), "previewReady");
    await preview.preview(PLACE.pasted);
    assert.equal(detailsCount(), before + 1, "the same ID is not requested again");
    assert.equal(gate.requests.length, 1, "and reserves nothing");
    await preview.preview(PLACE.other);
    assert.equal(gate.requests.length, 2, "another Place ID has its own reservation");
    mount.querySelector(DETAILS).dispatchEvent(new uwin.Event("gmp-error"));
    assert.equal(preview.readyPlaceId, "");
    assert.equal(statuses.at(-1), "detailsUnavailable");
    assert.equal(mount.querySelector(DETAILS), null);
    preview.dispose();
  }
  assertOnlyStandard(record, "unit");
  unit.window.close();
}

// ---------------------------------------------------------------------------------------------
// 3. Trip-page simulation with the real app modules.

const GOOGLE_URL = "https://www.google.com/maps/place/Invented+Lantern+Museum,+1+Sample+Quay/data=!4m6!3m5!1s0x0:0x1!8m2!3d40.1!4d10.2!16s%2Fg%2Fsample";
const osmPlace = (id, name, lat, lng, address) => ({
  provider: "openstreetmap", id, name, address, lat, lng, sourceUrl: `https://www.openstreetmap.org/${id}`,
  attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", selectedAt: "2031-01-02T03:04:05.000Z"
});
const GARDEN_PLACE = osmPlace("way/2002", "Invented Tide Garden", 40.2, 10.3, "5 Sample Promenade, Fictional Bay");
const STALE_PLACE = osmPlace("node/2010", "Invented Moved Kiosk", 40.21, 10.31, "9 Sample Promenade, Fictional Bay");
const NEW_GARDEN_RESULT = { provider: "openstreetmap", id: "node/2099", name: "Invented Tide Garden Gate", address: "7 Sample Promenade, Fictional Bay", lat: 40.25, lng: 10.35,
  sourceUrl: "https://www.openstreetmap.org/node/2099", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0" };
const CREATED_RESULT = { provider: "openstreetmap", id: "node/2200", name: "Invented Night Market", address: "1 Lantern Lane, Fictional Bay", lat: 40.3, lng: 10.4,
  sourceUrl: "https://www.openstreetmap.org/node/2200", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0" };
const GARDEN_PHOTO = {
  provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_garden.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_garden.jpg", credit: "Sample Photographer · CC BY-SA 4.0",
  author: "Sample Photographer", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", selectedAt: "2031-01-02T03:04:06.000Z"
};
const linked = (plan, placeId) => ({ ...plan, googlePlaceAssociation: associationForPlan(plan, placeId) });
// Legacy plans carrying the user-authored link in the mapsUrl alias (fictional links).
const ALIAS_URL = "https://www.google.com/maps/place/Invented+Paper+Lantern+Shop,+3+Sample+Quay/data=!4m6!3m5!1s0x0:0x2!8m2!3d40.11!4d10.21!16s%2Fg%2Fsample2";
const KIOSK_PLACE = osmPlace("node/2300", "Invented Harbor Kiosk", 40.12, 10.22, "8 Sample Quay, Fictional Bay");
const KIOSK_ALIAS_URL = "https://www.google.com/maps/place/Invented+Harbor+Kiosk,+8+Sample+Quay/data=!4m6!3m5!1s0x0:0x3!8m2!3d40.12!4d10.22!16s%2Fg%2Fsample3";
// The editor's notice when a pending Google choice cannot match the saved location (app.js).
const RELINK_NOTICE = {
  en: "Your changes were saved, but the Google place you chose did not match this plan's saved location, so the Google link was cleared. Open the plan and choose the Google place again.",
  "zh-Hans": "更改已保存，但所选的 Google 地点与此行程保存的位置不一致，因此已清除 Google 链接。请打开此行程，重新选择 Google 地点。",
  "zh-Hant": "變更已儲存，但所選的 Google 地點與此行程儲存的位置不一致，因此已清除 Google 連結。請開啟此行程，重新選擇 Google 地點。",
  ja: "変更は保存されましたが、選んだ Google の場所がこの予定の保存済みの場所と一致しないため、Google のリンクは解除されました。予定を開いて、Google の場所をもう一度選んでください。"
};

function fixtureTrip() {
  const garden = { id: "plan-garden", name: "Invented Tide Garden", period: "morning", time: "09:00", sortTime: "09:00", planType: "sight", review: "Fictional rock pools",
    place: clone(GARDEN_PLACE), lat: GARDEN_PLACE.lat, lng: GARDEN_PLACE.lng, address: GARDEN_PLACE.address, photo: clone(GARDEN_PHOTO) };
  const museum = { id: "plan-museum", name: "Invented Lantern Museum", period: "morning", time: "10:00", sortTime: "10:00", planType: "sight", review: "Fictional lanterns",
    googleMapsUrl: GOOGLE_URL, googleMapsPlaceName: "Invented Lantern Museum", googleMapsPlaceLabel: "Invented Lantern Museum, 1 Sample Quay", address: "1 Sample Quay", lat: 40.1, lng: 10.2 };
  const pier = { id: "plan-pier", name: "Invented Old Pier", period: "noon", time: "12:00", sortTime: "12:00", planType: "sight", review: "Legacy coordinates", address: "Old pier road", lat: 40.05, lng: 10.15 };
  const stale = { id: "plan-stale", name: "Invented Moved Kiosk", period: "noon", time: "13:00", sortTime: "13:00", planType: "shopping", review: "Moved kiosk",
    place: clone(STALE_PLACE), lat: STALE_PLACE.lat, lng: STALE_PLACE.lng, address: STALE_PLACE.address,
    // Bound to a different (earlier) location: never displayed.
    googlePlaceAssociation: associationForPlan({ place: GARDEN_PLACE }, PLACE.stale) };
  const extras = [1, 2, 3, 4, 5].map((n) => {
    const place = osmPlace(`way/500${n}`, `Invented Lantern Stall ${n}`, 40.3 + n / 100, 10.4 + n / 100, `${n} Lantern Row, Fictional Bay`);
    return linked({ id: `plan-extra-${n}`, name: place.name, period: "evening", time: `1${n}:30`, sortTime: `1${n}:30`, planType: "shopping", place, lat: place.lat, lng: place.lng, address: place.address }, extraPlace(n));
  });
  return {
    // This suite exercises active Google behaviour, so its trip is opted in. Section A keeps the
    // trip opted in but turns the site-wide feature off; the per-trip off/old-data/dynamic cases
    // are in test-google-place-photos-trip-ui.mjs.
    googlePlacePhotosEnabled: true,
    id: TRIP_ID, version: 3, archived: false, title: "Fictional Lantern Weekend", timezone: "UTC", country: "Fictionland", route: "Sample Bay",
    updatedAt: "2031-01-03T00:00:00.000Z", createdAt: "2031-01-01T00:00:00.000Z", dateRange: { start: DAY_ONE, end: "2031-05-05" },
    reminders: [], participantGroups: [], tips: [],
    days: [
      { id: "day-one", date: DAY_ONE, theme: "Invented lantern day", slots: [
        linked(garden, PLACE.garden), linked(museum, PLACE.museum), linked(pier, PLACE.pier), stale,
        { id: "plan-cafe", name: "Invented Corner Cafe", period: "evening", time: "18:00", sortTime: "18:00", planType: "restaurant", review: "Timeline-only placeholder" },
        ...extras
      ] },
      { id: "day-two", date: "2031-05-05", theme: "Invented ferry day", slots: [{ id: "plan-ferry", name: "Invented Ferry Ride", period: "morning", time: "10:00", planType: "transport" }] }
    ]
  };
}

// Same contract as POST /api/trips/<id>/google-places/reservations (server/google-allowance.mjs):
// trip opt-in and, for details, a current saved association are re-checked; one permit per new
// idempotency key and the same permit for a repeated key; denials are error codes. server.deny
// simulates an allowance denial; server.reservationGate delays the (already decided) response in
// transit; server.forcePermitId makes the server answer with an earlier permit ID (a replayed
// response) to show that the page never dispatches twice on one permit.
function decideReservation(server, body, json) {
  if (!server.google) return json(503, { error: { code: "google_places_disabled", message: "Google place features are not enabled on this server." } });
  if (server.deny) return json(server.deny.status, { error: { code: server.deny.code, message: "Fictional allowance denial." } });
  if (server.trip.googlePlacePhotosEnabled !== true) return json(409, { error: { code: "google_trip_not_enabled", message: "Off for this trip." } });
  if (body.kind !== "details" && !server.editable) return json(403, { error: { code: "forbidden", message: "Editing access required." } });
  if (body.kind === "details") {
    const plan = server.trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === body.planId);
    if (!plan || !associationMatchesPlan(plan) || plan.googlePlaceAssociation.placeId !== body.placeId) return json(409, { error: { code: "google_place_not_linked", message: "Not linked." } });
  }
  const prior = server.permits.get(body.requestId);
  if (prior) return json(200, { ...prior, replayed: true });
  const id = server.forcePermitId || "gpr_" + String(server.permits.size + 1).padStart(24, "0");
  // The page uses the real clocks (performance.now and Date.now), so the fictional server issues the
  // provider month of that same wall clock, as the real server would.
  const permit = { granted: true, replayed: false, apiKey: FAKE_KEY, libraries: ["places"],
    permit: { id, kind: body.kind, tripId: server.trip.id, placeId: body.placeId ?? null, month: providerMonth(Date.now()), validForMs: 45000 } };
  server.permits.set(body.requestId, permit);
  return json(200, permit);
}
async function reserve(server, body, json) {
  const decided = decideReservation(server, body, json);
  if (server.reservationGate) await server.reservationGate.promise;
  return decided;
}

function createFakeServer(initialTrip, { google = true, editable = true } = {}) {
  const server = { trip: clone(initialTrip), google, editable, log: [], respond: { place: null, photo: null }, requestIds: new Map(), rejected: [], permits: new Map(), deny: null };
  const json = (status, payload) => ({ status, payload });
  server.remote = (mutate) => {
    const next = clone(server.trip);
    mutate(next);
    next.version += 1;
    next.updatedAt = new Date(Date.parse(server.trip.updatedAt) + 60000).toISOString();
    server.trip = next;
  };
  server.handle = async (method, url, bodyText) => {
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    server.log.push({ method, path: url.pathname, body });
    if (method === "GET" && url.pathname === "/api/session") {
      return json(200, { authenticated: true, role: server.editable ? "content-manager" : "viewer", capabilities: { editTrips: server.editable },
        ...(server.google ? { features: { googlePlacesUiKit: true } } : {}) });
    }
    if (method === "GET" && url.pathname === "/api/google-places/config") {
      return json(200, server.google ? { enabled: true, libraries: ["places"], keyDelivery: "reservation" } : { enabled: false });
    }
    const match = /^\/api\/trips\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match || decodeURIComponent(match[1]) !== server.trip.id) return json(404, { error: { code: "not_found", message: "Not found." } });
    const rest = match[2] || "";
    if (method === "GET" && !rest) return json(200, { trip: clone(server.trip) });
    if (method === "POST" && rest === "/google-places/reservations") return reserve(server, body, json);
    if (method === "POST" && rest === "/changes") {
      if (!server.editable) return json(403, { error: { code: "forbidden", message: "Editing access required." } });
      if (server.requestIds.has(body.requestId)) return json(200, { trip: clone(server.requestIds.get(body.requestId)) });
      if (body.expectedVersion !== server.trip.version) return json(409, { error: { code: "version_conflict", message: "Version conflict." } });
      assert.equal(body.changes[0].type, "replace_content");
      const next = { ...clone(body.changes[0].trip), id: server.trip.id, version: server.trip.version + 1, archived: false,
        updatedAt: new Date(Date.parse(server.trip.updatedAt) + 60000).toISOString() };
      // Same rule as the real server: exactly three keys, bound to the plan's own location.
      for (const plan of next.days.flatMap((day) => day.slots || [])) {
        if (!plan.googlePlaceAssociation) continue;
        const keys = Object.keys(plan.googlePlaceAssociation).sort();
        const before = server.trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === plan.id);
        const carried = JSON.stringify(before?.googlePlaceAssociation) === JSON.stringify(plan.googlePlaceAssociation);
        if (JSON.stringify(keys) !== JSON.stringify([...GOOGLE_PLACE_ASSOCIATION_KEYS].sort()) || (!associationMatchesPlan(plan) && !carried)) {
          server.rejected.push(plan.id);
          return json(422, { error: { code: "validation_failed", message: "Invalid Google place link." } });
        }
        if (!associationMatchesPlan(plan)) delete plan.googlePlaceAssociation;
      }
      server.trip = next; server.requestIds.set(body.requestId, next);
      return json(200, { trip: clone(next) });
    }
    if (method === "POST" && (rest === "/places/search" || rest === "/photos/search")) {
      const responder = server.respond[rest.startsWith("/places") ? "place" : "photo"];
      if (!responder) return json(503, { error: { code: "lookup_disabled", message: "Lookup is not configured." } });
      return responder(body);
    }
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  return server;
}

// Page harness (adapted from test-place-picker-ui.mjs): long timers held, fetch limited to the
// fictional API, Leaflet stub, fresh module graph per page load.
const nativeTimeout = globalThis.setTimeout;
const nativeClear = globalThis.clearTimeout;
const nativeFetch = globalThis.fetch;
const nativeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const timers = new Set();
let epoch = 0;
globalThis.setTimeout = (fn, delay = 0, ...args) => {
  if (Number(delay) >= 8000) return { held: true };
  const owner = epoch;
  const timer = nativeTimeout(() => { timers.delete(timer); if (owner === epoch) fn(...args); }, Math.min(Number(delay) || 0, 25));
  timer.unref?.(); timers.add(timer);
  return timer;
};
globalThis.clearTimeout = (timer) => { if (!timer || timer.held) return; timers.delete(timer); nativeClear(timer); };

let currentServer = null;
const allFetches = [];
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
  const method = options.method || "GET";
  allFetches.push(`${method} ${url.href}`);
  if (url.origin !== ORIGIN || !url.pathname.startsWith("/api/")) throw new TypeError("External request blocked in DOM simulation");
  if (!currentServer) throw new TypeError("No fictional API for this page");
  const result = await currentServer.handle(method, url, options.body);
  // Response loss after the server has decided (and, for a reservation, counted) the request.
  if (currentServer.dropReservationResponses > 0 && url.pathname.endsWith("/google-places/reservations")) {
    currentServer.dropReservationResponses -= 1;
    throw new TypeError("Simulated lost response");
  }
  return new Response(JSON.stringify(result.payload), { status: result.status, headers: { "Content-Type": "application/json" } });
};
const wait = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
async function until(predicate, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await wait(5);
  }
}
const ok = (payload) => ({ status: 200, payload });

function mediaMatches(query, viewport) {
  return String(query).split(",").some((part) => part.split(/\band\b/).every((condition) => {
    const found = /\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)/.exec(condition);
    if (!found) return false;
    const [, feature, raw] = found; const value = parseFloat(raw);
    switch (feature) {
      case "max-width": return viewport.width <= value;
      case "min-width": return viewport.width >= value;
      case "max-height": return viewport.height <= value;
      case "min-height": return viewport.height >= value;
      case "pointer": return raw === viewport.pointer;
      case "orientation": return raw === (viewport.height >= viewport.width ? "portrait" : "landscape");
      default: return false;
    }
  }));
}

function leafletStub(window) {
  const doc = window.document;
  const point = (x, y) => ({ x, y, add(other) { return point(x + other.x, y + other.y); } });
  return {
    map() {
      const map = {
        attributionControl: { setPrefix() {} }, invalidateSize() {}, stop() {},
        setView() { return map; }, fitBounds() { return map; },
        project([lat, lng]) { return point(lng * 1000, -lat * 1000); },
        unproject(projected) { return [-projected.y / 1000, projected.x / 1000]; },
        eachLayer(fn) { (map.tripLayers?.layers || []).forEach(fn); }
      };
      return map;
    },
    control: { zoom: () => ({ addTo() { return this; }, getContainer: () => ({ querySelectorAll: () => [doc.createElement("a"), doc.createElement("a")] }) }) },
    tileLayer() { return { addTo() { return this; } }; },
    layerGroup: () => ({ layers: [], addTo() { return this; }, clearLayers() { this.layers.forEach((layer) => layer.element?.remove()); this.layers = []; } }),
    point, latLngBounds: (points) => points, divIcon: (options) => options,
    marker(coordinates, options) {
      const element = doc.createElement("div");
      element.className = options.icon.className;
      element.innerHTML = options.icon.html;
      element.title = options.title || "";
      return {
        coordinates, options, element, handlers: {},
        addTo(group) { group.layers.push(this); doc.getElementById("map").append(element); return this; },
        bindPopup() { return this; }, getPopup() { return null; },
        on(name, handler) { this.handlers[name] = handler; return this; },
        getElement() { return element; }, setZIndexOffset() { return this; }
      };
    },
    polyline: () => ({ addTo(group) { group.layers.push(this); return this; } })
  };
}

const tempRoots = [];
let activeWindow = null;
async function loadPage({ server, phone = false, hosted = true, seed = null, moveMode = "native" }) {
  if (activeWindow) { epoch += 1; activeWindow.close(); }
  timers.forEach(nativeClear); timers.clear();
  currentServer = server;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-google-ui-"));
  tempRoots.push(root);
  const publicDir = path.join(root, "public");
  fs.cpSync(PUBLIC_DIR, publicDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  if (!hosted) {
    const configFile = path.join(publicDir, "firebase-config.js");
    fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8").replace("__FIREBASE_CONFIG_JSON__", "{}").replace("__FIRESTORE_DOCUMENT_PATH_JSON__", JSON.stringify("trips/unused")));
  }
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8").replace("__TRIP_DATA_JSON__", hosted ? "{}" : JSON.stringify(seed).replace(/</g, "\\u003c"));
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
  const pathname = hosted ? `/trips/${TRIP_ID}` : "/";
  const dom = new JSDOM(html, { url: `${ORIGIN}${pathname}?day=${DAY_ONE}${phone ? "&view=plan" : ""}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  activeWindow = window;
  if (hosted) window.SHARED_TRIP_HOSTED = true;
  const viewport = phone ? { width: 390, height: 760, pointer: "coarse" } : { width: 1280, height: 820, pointer: "fine" };
  window.matchMedia = (media) => ({ matches: mediaMatches(media, viewport), media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.scrollTo = function () {};
  window.scrollTo = () => {}; window.scrollBy = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.L = leafletStub(window);
  const mapElement = window.document.getElementById("map");
  Object.defineProperty(mapElement, "clientWidth", { configurable: true, get: () => (phone ? 390 : 760) });
  Object.defineProperty(mapElement, "clientHeight", { configurable: true, get: () => (phone ? 760 : 640) });
  // Mocked Google: fake standard elements, and a script observer instead of any network request.
  const google = newGoogleRecord();
  defineStandardElements(window, google);
  // A browser with native-equivalent Element.moveBefore unless the scenario asks otherwise.
  installMoveBefore(window, google, moveMode);
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.localName !== "script" || !String(node.src).startsWith(MAPS_JS_URL)) continue;
        google.scripts.push(node.src);
        window.google = fakeLibrary(google);
        window[READY_CALLBACK]?.();
      }
    }
  }).observe(window.document.head, { childList: true });
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
    for (const found of script.textContent.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (typeof window[found[1]] === "function") globalThis[found[1]] = window[found[1]];
    }
  }
  await import(`${pathToFileURL(path.join(publicDir, hosted ? "hosted-bootstrap.js" : "app.js")).href}?v=__CACHE_VERSION__`);
  const doc = window.document;
  await until(() => !doc.querySelector(".hosted-boot") && doc.querySelector(".timeline-item"), "trip page ready");
  await wait(60);
  const page = { window, doc, errors, google };
  page.item = (id) => doc.querySelector(`.timeline-item[data-slot-id="${id}"]`);
  page.host = (id) => page.item(id)?.querySelector(".timeline-card__body .google-place");
  page.details = (id) => page.host(id)?.querySelector(DETAILS) || null;
  page.panel = () => doc.getElementById("google-match");
  page.action = (name) => page.panel().querySelector(`[data-google-action="${name}"]`);
  page.lookup = (kind) => doc.getElementById(`${kind}-lookup`);
  page.dialog = () => doc.getElementById("item-dialog");
  page.form = () => doc.getElementById("item-form");
  page.configRequests = () => (currentServer?.log || []).filter((entry) => entry.path === "/api/google-places/config").length;
  page.reservations = () => (currentServer?.log || []).filter((entry) => entry.path.endsWith("/google-places/reservations"));
  // Content writes only (reservations are not trip writes and never change a version).
  page.writes = () => (currentServer?.log || []).filter((entry) => entry.method !== "GET" && !entry.path.endsWith("/google-places/reservations"));
  return page;
}

async function setCardOpen(page, slotId, open) {
  const card = page.item(slotId).querySelector(".timeline-card");
  if (card.open === open) return;
  let fired = false;
  card.addEventListener("toggle", () => { fired = true; }, { once: true });
  card.open = open;
  try { await until(() => fired, "details toggle", 400); } catch { card.dispatchEvent(new page.window.Event("toggle")); }
  await wait(15);
}
async function openEditor(page, slotId) {
  page.item(slotId).querySelector(".icon-button").click();
  await until(() => page.dialog().open, `editor for ${slotId}`);
}
async function cancelEditor(page) {
  page.form().querySelector(".dialog-actions [data-close-dialog]").click();
  await until(() => !page.dialog().open, "editor closed");
}
async function saveEditor(page) {
  const version = currentServer.trip.version;
  page.form().dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => currentServer.trip.version === version + 1 && !page.dialog().open, "plan saved");
  await wait(40);
}
function typeInto(window, input, text) {
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
function selectGooglePlace(page, placeId, accessed = []) {
  const event = new page.window.Event("gmp-select");
  event.place = placeProxy(placeId, accessed);
  page.panel().querySelector(SEARCH).dispatchEvent(event);
  return accessed;
}
async function googleSearch(page, query) {
  typeInto(page.window, page.panel().querySelector("#google-match-query"), query);
  page.action("search").click();
  await until(() => page.panel().querySelector(SEARCH)?.querySelector("gmp-place-text-search-request")?.getAttribute("text-query") === query, `Google search for ${query}`);
}
const slotOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
const lastChange = () => currentServer.log.filter((entry) => entry.method === "POST" && entry.path.endsWith("/changes")).at(-1);
const sentPlan = (id) => slotOf(lastChange().body.changes[0].trip, id);
function assertNoPersistedGoogleContent(page, label) {
  const storage = [page.window.localStorage, page.window.sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key)}`)).join("\n");
  assert.ok(!storage.includes(FAKE_KEY) && !Object.values(PLACE).some((id) => storage.includes(id)), `${label}: no key or Place ID in browser storage`);
  for (const entry of page.writes()) {
    const text = JSON.stringify(entry.body);
    for (const forbidden of ["Fictional Google Name", "Fictional Google Address", FAKE_KEY, "displayName", "formattedAddress", "googleMapsURI"]) {
      assert.ok(!text.includes(forbidden), `${label}: a write never carries ${forbidden}`);
    }
  }
}

try {
  // A. Disabled site-wide (session without the feature, as with the flag off or no key) while the
  //    trip itself is opted in: the trip choice cannot bypass the global gate. Zero Google activity;
  //    OSM and Commons unchanged.
  {
    const server = createFakeServer(fixtureTrip(), { google: false });
    assert.equal(server.trip.googlePlacePhotosEnabled, true, "fixture: the trip is opted in");
    const page = await loadPage({ server });
    for (const id of ["plan-garden", "plan-museum", "plan-pier", "plan-extra-1"]) await setCardOpen(page, id, true);
    assert.equal(page.configRequests() + page.reservations().length, 0, "disabled: no configuration or reservation request");
    assert.deepEqual([page.google.scripts.length, page.google.imports.length], [0, 0], "disabled: no Google script or library");
    assert.equal(Object.keys(page.google.constructed).length, 0, "disabled: no component constructed");
    assert.equal(page.doc.querySelector(".google-place"), null, "disabled: no Google host");
    assert.ok(page.item("plan-garden").querySelector(".location-photo img").src.includes("Fictional_garden.jpg"), "Commons photo still shown");
    assert.ok(page.item("plan-garden").querySelector(".place-source a").href.includes("openstreetmap.org/way/2002"), "OSM place source still shown");
    await openEditor(page, "plan-garden");
    assert.equal(page.panel(), null, "disabled: no Google controls in the editor");
    assert.ok(page.lookup("place"), "OSM lookup panel unchanged");
    typeInto(page.window, page.form().elements.name, "Invented Tide Garden Renamed");
    await saveEditor(page);
    assert.deepEqual(slotOf(server.trip, "plan-garden").googlePlaceAssociation, slotOf(fixtureTrip(), "plan-garden").googlePlaceAssociation, "an unrelated edit keeps a saved association even while the feature is off");
    assert.equal(page.configRequests() + page.reservations().length + page.google.scripts.length, 0);
    assert.ok(allFetches.every((href) => href.includes(`${ORIGIN}/api/`)), "no outside request");
    assert.deepEqual(page.errors, []);
  }

  // B. Enabled, approved viewer: lazy, one active plan, deduplicated across expansion, polls,
  //    re-renders and unrelated remote edits; stale associations never shown; no writes.
  {
    const server = createFakeServer(fixtureTrip(), { editable: false });
    const page = await loadPage({ server });
    const { doc, window, google } = page;
    const detailsBuilt = () => google.constructed[DETAILS] || 0;
    assert.equal(doc.querySelectorAll(".google-place").length, 8, "eight plans have a current association (the stale one has none)");
    assert.equal(page.configRequests() + page.reservations().length + google.scripts.length + detailsBuilt(), 0, "opening the trip reserves, builds and loads nothing (no flood)");
    assert.equal(page.item("plan-stale").querySelector(".google-place"), null, "an association bound to another location is never shown");
    assert.equal(doc.querySelectorAll(".timeline-item .icon-button").length, 0, "viewers get no editor");

    await setCardOpen(page, "plan-garden", true);
    await until(() => page.details("plan-garden"), "garden component");
    assert.deepEqual([page.configRequests(), page.reservations().length, google.scripts.length, google.imports], [0, 1, 1, ["places"]], "first expansion: one reservation (no separate config request), one script, one library import");
    assert.deepEqual(page.reservations()[0].body, { requestId: page.reservations()[0].body.requestId, kind: "details", planId: "plan-garden", placeId: PLACE.garden }, "a viewer reserves saved details only");
    const script = new URL(google.scripts[0]);
    assert.equal(script.searchParams.get("key"), FAKE_KEY);
    assert.equal(script.searchParams.get("libraries"), "places");
    assert.equal(detailsBuilt(), 1, "only the expanded plan");
    assert.deepEqual(google.placeAssignments, [PLACE.garden]);
    const gardenHost = page.host("plan-garden");
    assert.equal(gardenHost.getAttribute("aria-label"), googleText("en", "detailsRegion"));
    assert.equal(gardenHost.querySelector(".google-place__status").getAttribute("role"), "status");
    assert.equal(textOf(gardenHost.querySelector(".google-place__status")), googleText("en", "detailsLoading"));
    let gardenElement = page.details("plan-garden");
    gardenElement.dispatchEvent(new window.Event("gmp-load"));
    assert.equal(textOf(gardenHost.querySelector(".google-place__status")), "");
    assert.ok(page.item("plan-garden").querySelector(".location-photo img"), "the Commons photo stays as the card photo");

    const gardenMount = () => page.host("plan-garden").querySelector(".google-place__mount");
    await setCardOpen(page, "plan-museum", true);
    await until(() => page.details("plan-museum"), "museum component");
    assert.equal(detailsBuilt(), 2);
    assert.ok(gardenElement.isConnected && page.host("plan-garden").contains(gardenElement), "the garden component stays connected in its own host, never moved or rebuilt");
    assert.equal(gardenMount().hidden, true, "and is hidden there");
    assert.equal(doc.querySelector(".google-place-parking"), null, "nothing is parked elsewhere");
    assert.equal(page.host("plan-garden").querySelector(".google-place__action").textContent, googleText("en", "showDetails"));
    await setCardOpen(page, "plan-museum", false);
    await setCardOpen(page, "plan-garden", false);
    await setCardOpen(page, "plan-garden", true);
    await until(() => page.details("plan-garden") === gardenElement && !gardenMount().hidden, "garden component unhidden in its own host");
    for (let round = 0; round < 3; round += 1) {
      await setCardOpen(page, "plan-garden", false);
      await setCardOpen(page, "plan-garden", true);
    }
    assert.equal(page.details("plan-garden"), gardenElement);
    assert.equal(detailsBuilt(), 2, "repeated expansion never builds again");
    assert.equal(google.placeAssignments.length, 2, "and never re-assigns the place request");
    assert.equal(page.reservations().length, 2, "and never reserves again");
    assert.deepEqual([google.connects[DETAILS], google.reconnects], [2, []], "each component connected once; collapse and re-expansion run no connection callback");

    // A poll without changes renders nothing: the shown component stays where it is.
    window.dispatchEvent(new window.Event("online"));
    await wait(60);
    assert.equal(page.details("plan-garden"), gardenElement, "a poll without changes keeps the component");
    // A language change rebuilds the itinerary. The component is released, never moved into the new
    // card; the restored card offers an explicit control and nothing is reserved or built.
    const language = doc.getElementById("language-select");
    language.value = "ja"; language.dispatchEvent(new window.Event("change"));
    await wait(30);
    assert.equal(page.host("plan-garden").getAttribute("aria-label"), googleText("ja", "detailsRegion"), "host label follows the language");
    assert.equal(gardenElement.isConnected, false, "the rebuild released the component");
    assert.equal(page.details("plan-garden"), null, "it was not moved into the rebuilt card");
    assert.equal(page.host("plan-garden").querySelector(".google-place__action").textContent, googleText("ja", "showDetails"), "the restored card offers an explicit control");
    language.value = "en"; language.dispatchEvent(new window.Event("change"));
    await wait(30);
    server.remote((trip) => { slotOf(trip, "plan-garden").review = "Remote fictional note"; });
    window.dispatchEvent(new window.Event("online"));
    await until(() => textOf(page.item("plan-garden")).includes("Remote fictional note"), "poll applies an unrelated edit");
    await wait(30);
    assert.deepEqual([detailsBuilt(), google.placeAssignments.length, page.reservations().length, google.scripts.length, google.imports.length], [2, 2, 2, 1, 1],
      "polls, language changes and unrelated edits reserve, build, assign and load nothing");
    assert.equal(page.details("plan-garden"), null, "and never revive a released component");
    assert.deepEqual([google.reconnects, google.moveCalls], [[], 0], "re-renders never re-connect or move a component");
    // Explicit Show after the rebuild: one fresh reservation for one fresh component in the new card.
    page.host("plan-garden").querySelector(".google-place__action").click();
    await until(() => page.details("plan-garden"), "garden after an explicit show");
    assert.notEqual(page.details("plan-garden"), gardenElement);
    gardenElement = page.details("plan-garden");
    gardenElement.dispatchEvent(new window.Event("gmp-load"));
    assert.deepEqual([page.reservations().length, detailsBuilt(), google.scripts.length, google.imports.length], [3, 3, 1, 1], "the page-session loader is reused; the new component had its own reservation");

    // A failure shows the unavailable state; re-expansion does not retry; Try again does.
    await setCardOpen(page, "plan-pier", true);
    await until(() => page.details("plan-pier"), "pier component");
    page.details("plan-pier").dispatchEvent(new window.Event("gmp-error"));
    await until(() => textOf(page.host("plan-pier")).includes(googleText("en", "detailsUnavailable")), "unavailable message");
    const afterError = detailsBuilt();
    await setCardOpen(page, "plan-pier", false);
    await setCardOpen(page, "plan-pier", true);
    await wait(30);
    assert.equal(detailsBuilt(), afterError, "no automatic retry");
    page.host("plan-pier").querySelector(".google-place__action").click();
    await until(() => detailsBuilt() === afterError + 1, "explicit Try again");
    await setCardOpen(page, "plan-pier", false);

    // Remote location change (stale association) removes the component; a remote re-link waits for the user.
    await setCardOpen(page, "plan-garden", false);
    await setCardOpen(page, "plan-garden", true);
    await until(() => page.details("plan-garden") === gardenElement, "garden active again (reused)");
    assert.equal(detailsBuilt(), afterError + 1, "re-activating a retained plan builds nothing");
    server.remote((trip) => {
      Object.assign(slotOf(trip, "plan-garden"), { place: clone(STALE_PLACE), lat: STALE_PLACE.lat, lng: STALE_PLACE.lng, address: STALE_PLACE.address });
    });
    window.dispatchEvent(new window.Event("online"));
    await until(() => !page.host("plan-garden"), "stale association hidden after a remote location change");
    assert.equal(gardenElement.isConnected, false, "the old component is discarded, never reused for the new location");
    const beforeRelink = detailsBuilt();
    server.remote((trip) => { const plan = slotOf(trip, "plan-garden"); plan.googlePlaceAssociation = associationForPlan(plan, PLACE.relinked); });
    window.dispatchEvent(new window.Event("online"));
    await until(() => page.host("plan-garden"), "re-linked host");
    await wait(30);
    assert.equal(detailsBuilt(), beforeRelink, "a poll never starts a new Google request by itself");
    page.host("plan-garden").querySelector(".google-place__action").click();
    await until(() => page.details("plan-garden"), "explicit show after a remote re-link");
    assert.equal(google.placeAssignments.at(-1), PLACE.relinked);

    // Memory stays bounded while browsing many plans.
    for (const n of [1, 2, 3, 4, 5]) await setCardOpen(page, `plan-extra-${n}`, true);
    await wait(30);
    assert.ok(doc.querySelectorAll(DETAILS).length <= 3, "at most three retained components");
    await setCardOpen(page, "plan-stale", true);
    assert.equal(page.item("plan-stale").querySelector(DETAILS), null, "a stale association never loads");
    assert.equal(page.writes().length, 0, "viewing never saves anything");
    assertNoPersistedGoogleContent(page, "viewer");
    assertOnlyStandard(google, "viewer page");
    assert.deepEqual(page.errors, []);
  }

  // C. Enabled, content manager: explicit, guarded, user-selected linking with save/cancel/change.
  {
    const server = createFakeServer(fixtureTrip());
    let page = await loadPage({ server });
    const { doc, window } = page;
    let google = page.google;
    const searchesBuilt = () => google.constructed[SEARCH] || 0;

    // C1. Opening editors sends nothing.
    await openEditor(page, "plan-cafe");
    assert.ok(page.panel(), "editors get the Google section");
    assert.equal(page.panel().getAttribute("aria-labelledby"), "google-match-title");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "needsLocation"), "no location: nothing to link");
    assert.equal(page.action("open").hidden, true);
    await cancelEditor(page);
    await openEditor(page, "plan-pier");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "linked"));
    assert.equal(page.action("open").textContent, googleText("en", "chooseDifferent"));
    assert.equal(page.action("remove").hidden, false);
    assert.equal(page.panel().querySelector(".google-match__form").hidden, true, "the search form stays closed until asked for");
    assert.equal(page.configRequests() + page.reservations().length + google.scripts.length + searchesBuilt(), 0, "opening the editor contacts nothing");

    // C2. Explicit correction: guard, private-text check, explicit search, no automatic pick.
    page.action("open").click();
    const query = page.panel().querySelector("#google-match-query");
    assert.equal(query.value, "", "never prefilled from the plan name, notes or address");
    assert.equal(doc.querySelector('label[for="google-match-query"]').textContent, googleText("en", "queryLabel"));
    assert.equal(query.getAttribute("aria-describedby"), "google-match-privacy");
    assert.equal(page.panel().querySelector(".google-match__status").getAttribute("aria-live"), "polite");
    typeInto(window, query, "Invented Old Pier");
    page.action("search").click();
    await wait(20);
    assert.equal(textOf(page.panel().querySelector(".google-match__status")), googleText("en", "needPublicVenue"), "the public-venue box must be ticked");
    assert.equal(page.panel().querySelector(".google-match__status").dataset.error, "true");
    assert.equal(page.reservations().length + searchesBuilt(), 0, "nothing reserved or sent without the public-venue answer");
    page.panel().querySelector("#google-match-public").click();
    typeInto(window, query, "Pier near traveler@example.org");
    page.action("search").click();
    await wait(20);
    assert.equal(textOf(page.panel().querySelector(".google-match__status")), googleText("en", "queryPrivate"));
    assert.equal(searchesBuilt(), 0, "private-looking text is never sent");
    await googleSearch(page, "Invented Old Pier");
    assert.equal(searchesBuilt(), 1);
    assert.deepEqual(google.textQueries, ["Invented Old Pier"], "only the dedicated query is sent");
    assert.deepEqual(page.reservations().map((entry) => entry.body.kind), ["search"], "one editor search reservation before the query");
    assert.ok(!JSON.stringify(page.reservations()).includes("Invented Old Pier"), "the search text never goes to this server");
    assert.equal(page.panel().querySelector(SEARCH).querySelector("gmp-place-text-search-request").getAttribute("max-result-count"), "5");
    page.panel().querySelector(SEARCH).dispatchEvent(new window.Event("gmp-load"));
    await wait(10);
    assert.equal(textOf(page.panel().querySelector(".google-match__status")), googleText("en", "chooseResult"));
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "linked"), "results alone never change the link");
    query.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await wait(20);
    assert.ok(page.dialog().open && page.writes().length === 0, "Enter searches; it never submits the plan");
    assert.deepEqual(google.textQueries, ["Invented Old Pier"], "repeating the same query sends nothing new");
    const accessed = selectGooglePlace(page, PLACE.chosen);
    await wait(10);
    assert.deepEqual(accessed, ["id"], "the selection is read for its ID only");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "chosenPending"));
    await saveEditor(page);
    const pierBinding = locationBindingForPlan(slotOf(fixtureTrip(), "plan-pier"));
    assert.deepEqual(sentPlan("plan-pier").googlePlaceAssociation, { placeId: PLACE.chosen, locationBinding: pierBinding, publicVenueConfirmed: true }, "exactly the Place ID, binding and public-venue flag");
    assert.equal(server.rejected.length, 0);
    assert.equal(page.panel().querySelector(SEARCH), null, "the search element is removed after saving");

    // C3. Cancel discards a pending choice; late events are ignored.
    await openEditor(page, "plan-museum");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "linked"), "a full Google Maps link is a valid location binding");
    page.action("open").click();
    page.panel().querySelector("#google-match-public").click();
    await googleSearch(page, "Invented Lantern Museum");
    const museumSearch = page.panel().querySelector(SEARCH);
    selectGooglePlace(page, PLACE.other);
    await wait(10);
    page.panel().querySelector("#google-match-public").click();
    await wait(10);
    assert.equal(textOf(page.panel().querySelector(".google-match__status")), googleText("en", "needPublicVenue"), "withdrawing the public-venue answer withdraws the choice");
    const writesBefore = page.writes().length;
    await cancelEditor(page);
    assert.equal(museumSearch.isConnected, false, "cancel removes the search element");
    const late = new window.Event("gmp-select");
    late.place = { id: PLACE.other };
    museumSearch.dispatchEvent(late);
    await wait(20);
    assert.equal(page.writes().length, writesBefore, "cancel saves nothing");
    assert.equal(slotOf(server.trip, "plan-museum").googlePlaceAssociation.placeId, PLACE.museum);
    await openEditor(page, "plan-museum");
    assert.equal(page.panel().querySelector(".google-match__form").hidden, true, "a reopened editor starts clean");
    assert.equal(page.panel().querySelector("#google-match-public").checked, false);
    await cancelEditor(page);

    // C4. Changing the location invalidates a pending Google choice and the saved link.
    await openEditor(page, "plan-garden");
    page.action("open").click();
    page.panel().querySelector("#google-match-public").click();
    await googleSearch(page, "Invented Tide Garden");
    selectGooglePlace(page, PLACE.other);
    await wait(10);
    server.respond.place = () => ok({ cached: false, results: [NEW_GARDEN_RESULT] });
    typeInto(window, page.lookup("place").querySelector(".lookup-search__input"), "Invented Tide Garden Gate");
    page.lookup("place").querySelector('[data-lookup-action="search"]').click();
    await until(() => page.lookup("place").querySelectorAll(".lookup-result").length === 1, "OSM candidate");
    page.lookup("place").querySelector(".lookup-result__choose").click();
    await wait(10);
    assert.equal(page.panel().querySelector(SEARCH), null, "a new location cancels the pending Google search");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "staleLink"));
    assert.equal(page.panel().querySelector(".google-match__form").hidden, false, "a new location offers the form, without sending anything");
    await saveEditor(page);
    assert.equal(sentPlan("plan-garden").googlePlaceAssociation, undefined, "the stale link is not sent");
    assert.equal(sentPlan("plan-garden").place.id, NEW_GARDEN_RESULT.id);
    assert.equal(slotOf(server.trip, "plan-garden").googlePlaceAssociation, undefined);

    // C5. A pasted Place ID link: preview, explicit use, save.
    await openEditor(page, "plan-garden");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "notLinked"));
    page.action("open").click();
    page.panel().querySelector("#google-match-public").click();
    const placeIdInput = page.panel().querySelector("#google-match-place-id");
    typeInto(window, placeIdInput, "https://www.google.com/maps/place/Invented/data=!1s0x0:0x1!3d1!4d2");
    page.action("preview").click();
    await wait(20);
    assert.equal(textOf(page.panel().querySelector(".google-match__status")), googleText("en", "placeIdInvalid"), "a feature-ID link is not a Place ID");
    typeInto(window, placeIdInput, `https://www.google.com/maps/search/?api=1&query=Invented&query_place_id=${PLACE.pasted}`);
    page.action("preview").click();
    await until(() => page.panel().querySelector(".google-match__preview " + DETAILS), "preview component");
    assert.equal(page.action("use").hidden, true, "not usable before it loads");
    page.panel().querySelector(".google-match__preview " + DETAILS).dispatchEvent(new window.Event("gmp-load"));
    await wait(10);
    assert.equal(page.action("use").hidden, false);
    page.action("use").click();
    await wait(10);
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "chosenPending"));
    await saveEditor(page);
    const newGardenBinding = locationBindingForPlan(slotOf(server.trip, "plan-garden"));
    assert.deepEqual(slotOf(server.trip, "plan-garden").googlePlaceAssociation, { placeId: PLACE.pasted, locationBinding: newGardenBinding, publicVenueConfirmed: true });

    // C6. Unrelated edits keep the link; Remove link drops it.
    await openEditor(page, "plan-garden");
    typeInto(window, page.form().elements.name, "Invented Tide Garden Gate Walk");
    await saveEditor(page);
    assert.equal(sentPlan("plan-garden").googlePlaceAssociation.placeId, PLACE.pasted, "a name change keeps the association");
    await openEditor(page, "plan-garden");
    page.action("remove").click();
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "removedPending"));
    await saveEditor(page);
    assert.equal(sentPlan("plan-garden").googlePlaceAssociation, undefined);

    // C7. Creating a plan with a new location and a user-selected Google place in one save.
    page.doc.querySelector(".day-heading__actions .button").click();
    await until(() => page.dialog().open, "add plan");
    typeInto(window, page.form().elements.name, "Invented Night Market");
    assert.equal(textOf(page.panel().querySelector(".google-match__current")), googleText("en", "needsLocation"));
    server.respond.place = () => ok({ cached: false, results: [CREATED_RESULT] });
    typeInto(window, page.lookup("place").querySelector(".lookup-search__input"), "Invented Night Market");
    page.lookup("place").querySelector('[data-lookup-action="search"]').click();
    await until(() => page.lookup("place").querySelectorAll(".lookup-result").length === 1, "OSM candidate for the new plan");
    page.lookup("place").querySelector(".lookup-result__choose").click();
    await wait(10);
    assert.equal(page.panel().querySelector(".google-match__form").hidden, false, "a new location offers the Google form");
    page.panel().querySelector("#google-match-public").click();
    await googleSearch(page, "Invented Night Market");
    selectGooglePlace(page, PLACE.created);
    await wait(10);
    await saveEditor(page);
    const created = server.trip.days[0].slots.find((slot) => slot.name === "Invented Night Market");
    assert.ok(created && created.place.id === CREATED_RESULT.id);
    assert.deepEqual(created.googlePlaceAssociation, { placeId: PLACE.created, locationBinding: locationBindingForPlan(created), publicVenueConfirmed: true });

    // C8. Four languages in the editor.
    await openEditor(page, "plan-pier");
    page.action("open").click();
    const language = doc.getElementById("language-select");
    for (const code of ["zh-Hans", "zh-Hant", "ja", "en"]) {
      language.value = code; language.dispatchEvent(new window.Event("change"));
      await wait(30);
      assert.equal(doc.getElementById("google-match-title").textContent, googleText(code, "sectionTitle"), `${code} title`);
      assert.equal(page.action("search").textContent, googleText(code, "searchGoogle"), `${code} search button`);
      assert.equal(page.panel().querySelector("#google-match-query").getAttribute("placeholder"), googleText(code, "queryPlaceholder"));
      assert.ok(textOf(page.panel()).includes(googleText(code, "privacyNote")), `${code} privacy note`);
    }
    await cancelEditor(page);
    assert.equal(server.rejected.length, 0, "every saved association matched its plan's location");
    assertNoPersistedGoogleContent(page, "editor");
    assertOnlyStandard(google, "editor page");
    assert.deepEqual(page.errors, []);

    // D. Phone layout: same lazy component inside the swipe-sheet card body.
    page = await loadPage({ server, phone: true });
    google = page.google;
    assert.ok(page.doc.documentElement.classList.contains("is-itinerary-view"), "phone sheet view");
    assert.equal(Object.keys(google.constructed).length, 0, "phone: nothing built on load");
    await setCardOpen(page, "plan-pier", true);
    await until(() => page.details("plan-pier"), "phone pier component");
    assert.ok(page.host("plan-pier").closest(".timeline-card__body"), "the host sits in the expanded card body");
    assert.equal(google.constructed[DETAILS], 1);
    const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
    const block = (selector) => { const start = css.indexOf(`${selector} {`); return start < 0 ? "" : css.slice(start, css.indexOf("}", start)); };
    assert.match(block(".google-place"), /max-width: 300px/, "vertical compact width stays within the recommended 300 px (static check)");
    assert.match(block(".google-place__details"), /min-width: 160px/, "never below the 160 px minimum (static check)");
    for (const selector of [".google-place", ".google-place__details"]) assert.ok(!/(?:^|[\s;{])height:/.test(block(selector)), `${selector} has no fixed height`);
    assert.deepEqual(page.errors, []);
  }

  // F. Real editor path on legacy plans. F1: the mapsUrl alias is the location binding, so Save's
  //    normalization into googleMapsUrl plus a title edit keeps the link. F2: a pending Google choice
  //    that cannot match the location actually saved is never attached; the other edits are saved
  //    and a localized notice says to choose again, with no additional lookup or request.
  {
    const trip = fixtureTrip();
    trip.days[0].slots.push(
      linked({ id: "plan-alias", name: "Invented Paper Lantern Shop", period: "evening", time: "17:00", sortTime: "17:00", planType: "shopping",
        mapsUrl: ALIAS_URL, address: "3 Sample Quay", lat: 40.11, lng: 10.21 }, PLACE.alias),
      // Selected OSM place (which wins the binding) plus a legacy alias: the editor prefills the alias
      // link, so a Google choice made there is for the link, not for the location that is saved.
      { id: "plan-osm-alias", name: "Invented Harbor Kiosk", period: "evening", time: "17:30", sortTime: "17:30", planType: "shopping",
        place: clone(KIOSK_PLACE), lat: KIOSK_PLACE.lat, lng: KIOSK_PLACE.lng, address: KIOSK_PLACE.address, mapsUrl: KIOSK_ALIAS_URL }
    );
    const aliasAssociation = clone(slotOf(trip, "plan-alias").googlePlaceAssociation);
    assert.equal(aliasAssociation.locationBinding, locationBindingForPlan({ googleMapsUrl: ALIAS_URL }), "fixture: bound to the alias link");
    const server = createFakeServer(trip);
    const page = await loadPage({ server });
    const { window, doc, google } = page;
    const toast = doc.getElementById("toast");
    const current = () => textOf(page.panel().querySelector(".google-match__current"));
    assert.ok(page.host("plan-alias"), "an alias-bound association is current");
    assert.equal(page.host("plan-osm-alias"), null);

    // F1.
    await openEditor(page, "plan-alias");
    assert.equal(page.form().elements.googleMapsUrl.value, ALIAS_URL, "the editor reads the alias link");
    assert.equal(current(), googleText("en", "linked"), "the alias is not shown as a changed location");
    typeInto(window, page.form().elements.name, "Invented Paper Lantern Shop (late)");
    await saveEditor(page);
    assert.equal(sentPlan("plan-alias").googleMapsUrl, ALIAS_URL, "Save normalized the alias into googleMapsUrl");
    assert.deepEqual(sentPlan("plan-alias").googlePlaceAssociation, aliasAssociation, "a title edit keeps the association");
    assert.deepEqual(slotOf(server.trip, "plan-alias").googlePlaceAssociation, aliasAssociation);
    assert.equal(slotOf(server.trip, "plan-alias").name, "Invented Paper Lantern Shop (late)");
    assert.notEqual(toast.dataset.notice, "google-relink", "no relink notice for an ordinary save");
    assert.ok(page.host("plan-alias"), "still shown after the save");

    // F2.
    await openEditor(page, "plan-osm-alias");
    assert.equal(page.form().elements.googleMapsUrl.value, KIOSK_ALIAS_URL);
    if (page.panel().querySelector(".google-match__form").hidden) page.action("open").click();
    page.panel().querySelector("#google-match-public").click();
    await googleSearch(page, "Invented Harbor Kiosk");
    page.panel().querySelector(SEARCH).dispatchEvent(new window.Event("gmp-load"));
    selectGooglePlace(page, PLACE.mismatch);
    await wait(10);
    assert.equal(current(), googleText("en", "chosenPending"));
    typeInto(window, page.form().elements.name, "Invented Harbor Kiosk (evening)");
    const googleActivity = () => JSON.stringify([google.constructed, google.textQueries.length, google.placeAssignments.length, google.scripts.length, google.imports.length]);
    const activityBefore = googleActivity();
    const logBefore = server.log.length;
    const fetchesBefore = allFetches.length;
    await saveEditor(page);
    const tripRead = `/api/trips/${TRIP_ID}`;
    assert.deepEqual(server.log.slice(logBefore).filter((entry) => !(entry.method === "GET" && entry.path === tripRead)).map((entry) => `${entry.method} ${entry.path}`),
      [`POST ${tripRead}/changes`], "the save is the only request: no lookup, search, photo or configuration request");
    assert.ok(allFetches.slice(fetchesBefore).every((entry) => entry === `POST ${ORIGIN}${tripRead}/changes` || entry === `GET ${ORIGIN}${tripRead}`), "only the trip save and its read-back may be requested");
    assert.equal(googleActivity(), activityBefore, "no additional Google component, query, place request, script or library load");
    assert.equal(sentPlan("plan-osm-alias").googlePlaceAssociation, undefined, "the unmatched choice is never sent");
    const saved = slotOf(server.trip, "plan-osm-alias");
    assert.equal(saved.googlePlaceAssociation, undefined, "and never attached");
    assert.equal(saved.name, "Invented Harbor Kiosk (evening)", "the actual edits are saved");
    assert.equal(saved.place.id, KIOSK_PLACE.id, "the saved location is the selected OSM place");
    assert.deepEqual(server.rejected, [], "the client never sent a mismatched link");
    assert.equal(page.host("plan-osm-alias"), null, "nothing is shown for the plan");
    assert.equal(toast.hidden, false, "the user is told");
    assert.equal(toast.dataset.notice, "google-relink");
    assert.equal(toast.dataset.error, "true");
    assert.equal(toast.getAttribute("role"), "status");
    assert.equal(textOf(toast), RELINK_NOTICE.en);
    const language = doc.getElementById("language-select");
    for (const code of ["zh-Hans", "zh-Hant", "ja", "en"]) {
      language.value = code; language.dispatchEvent(new window.Event("change"));
      await wait(30);
      assert.equal(textOf(toast), RELINK_NOTICE[code], `${code} relink notice`);
    }
    assert.equal(new Set(Object.values(RELINK_NOTICE)).size, 4, "four distinct translations");
    // Choosing again starts clean: nothing pending, nothing sent by opening the editor.
    await openEditor(page, "plan-osm-alias");
    assert.equal(page.panel().querySelector("#google-match-public").checked, false);
    assert.equal(page.panel().querySelector(SEARCH), null);
    assert.equal(googleActivity(), activityBefore, "reopening the editor sends nothing");
    await cancelEditor(page);
    assertNoPersistedGoogleContent(page, "legacy alias");
    assertOnlyStandard(google, "legacy alias page");
    assert.deepEqual(page.errors, []);
  }

  // G. Allowance gate on the real trip page: denials, original-image fallback, late responses,
  //    hidden tabs, browsers without atomic moves, lost responses and replayed permits.
  {
    const MANUAL_PHOTO = "https://images.example.org/fictional-manual-pier-photo.jpg";
    const gateTrip = () => {
      const trip = fixtureTrip();
      const manual = { id: "plan-manual", name: "Invented Manual Photo Pier", period: "noon", time: "12:30", sortTime: "12:30", planType: "sight",
        review: "Manually chosen photo", address: "2 Old pier road", lat: 40.06, lng: 10.16, photo: MANUAL_PHOTO };
      trip.days[0].slots.splice(3, 0, linked(manual, PLACE.other));
      return trip;
    };
    const FALLBACK_IDS = ["plan-garden", "plan-manual", "plan-pier"];
    // The card summary (with its photo or no-photo fallback) and the card body without the
    // Google host: what a plan shows on its own.
    const ownMarkup = (page) => Object.fromEntries(FALLBACK_IDS.map((id) => {
      const item = page.item(id);
      const body = item.querySelector(".timeline-card__body").cloneNode(true);
      body.querySelectorAll(".google-place").forEach((node) => node.remove());
      return [id, { summary: item.querySelector(".timeline-card__summary").outerHTML, body: body.outerHTML }];
    }));
    const noGoogleWork = (page) => page.google.scripts.length === 0 && page.google.imports.length === 0 &&
      Object.keys(page.google.constructed).length === 0 && !page.google.created.some((tag) => tag.startsWith("gmp-"));
    const poll = async (page, server, note) => {
      server.remote((trip) => { slotOf(trip, "plan-cafe").review = note; });
      page.window.dispatchEvent(new page.window.Event("online"));
      await until(() => textOf(page.item("plan-cafe")).includes(note), `poll applies ${note}`);
      await wait(20);
    };

    // Baseline: the same cards with the site feature off.
    let page = await loadPage({ server: createFakeServer(gateTrip(), { google: false, editable: false }) });
    for (const id of FALLBACK_IDS) await setCardOpen(page, id, true);
    const baseline = ownMarkup(page);
    assert.ok(baseline["plan-garden"].summary.includes("Fictional_garden.jpg"), "fixture: Commons photo");
    assert.ok(baseline["plan-manual"].summary.includes("fictional-manual-pier-photo.jpg"), "fixture: manually chosen photo");
    assert.ok(!baseline["plan-pier"].summary.includes("<img") && baseline["plan-pier"].summary.includes("location-photo__fallback"), "fixture: no-photo plan keeps its original fallback");

    // G1. Monthly limit reached (viewer): one reservation request for the whole page, a translated
    //     status, zero Google activity, and every plan's own content byte-for-byte unchanged.
    {
      const server = createFakeServer(gateTrip(), { editable: false });
      server.deny = { status: 429, code: "google_allowance_exhausted" };
      page = await loadPage({ server });
      await setCardOpen(page, "plan-garden", true);
      await until(() => textOf(page.host("plan-garden")).includes(googleText("en", "limitReached")), "limit status");
      const host = page.host("plan-garden");
      assert.equal(host.querySelector(".google-place__status").getAttribute("role"), "status");
      assert.equal(host.querySelector(".google-place__status").getAttribute("aria-live"), "polite");
      assert.equal(host.querySelector(".google-place__action").hidden, true, "no retry button for a monthly limit");
      assert.equal(host.querySelector(".google-place__mount").hidden, true);
      for (const id of ["plan-manual", "plan-pier"]) await setCardOpen(page, id, true);
      await wait(30);
      for (const id of FALLBACK_IDS) assert.ok(textOf(page.host(id)).includes(googleText("en", "limitReached")), `${id}: translated limit status`);
      for (let round = 0; round < 2; round += 1) { await setCardOpen(page, "plan-garden", false); await setCardOpen(page, "plan-garden", true); }
      await poll(page, server, "Remote fictional note while limited");
      assert.equal(page.reservations().length, 1, "after one denial the page asks nothing more: not per card, expansion or re-render");
      assert.ok(noGoogleWork(page), "denied: no script, library, component or query");
      assert.deepEqual(ownMarkup(page), baseline, "Commons, manual and no-photo cards are byte-for-byte unchanged");
      const language = page.doc.getElementById("language-select");
      language.value = "ja"; language.dispatchEvent(new page.window.Event("change"));
      await until(() => textOf(page.host("plan-garden")).includes(googleText("ja", "limitReached")), "Japanese limit status");
      language.value = "en"; language.dispatchEvent(new page.window.Event("change"));
      await wait(20);
      assert.equal(page.reservations().length, 1);
      assert.ok(allFetches.every((href) => href.startsWith(`GET ${ORIGIN}/`) || href.startsWith(`POST ${ORIGIN}/`)), "no outside request");
      assert.deepEqual(page.errors, []);
    }

    // G2. Ledger unavailable (editor): "paused" with Try again; an editor search while blocked
    //     reserves nothing; an explicit retry asks exactly once; after recovery Google is additive.
    {
      const server = createFakeServer(gateTrip());
      server.deny = { status: 503, code: "google_allowance_unavailable" };
      page = await loadPage({ server });
      await setCardOpen(page, "plan-garden", true);
      await until(() => textOf(page.host("plan-garden")).includes(googleText("en", "paused")), "paused status");
      assert.equal(page.host("plan-garden").querySelector(".google-place__action").textContent, googleText("en", "tryAgain"));
      await openEditor(page, "plan-pier");
      page.action("open").click();
      page.panel().querySelector("#google-match-public").click();
      typeInto(page.window, page.panel().querySelector("#google-match-query"), "Invented Old Pier");
      page.action("search").click();
      await until(() => textOf(page.panel().querySelector(".google-match__status")) === googleText("en", "paused"), "editor paused status");
      assert.equal(page.panel().querySelector(".google-match__status").dataset.error, "true");
      assert.equal(page.reservations().length, 1, "a blocked page reserves nothing for an editor search");
      assert.equal(page.panel().querySelector(SEARCH), null, "and builds no search element");
      await cancelEditor(page);
      page.host("plan-garden").querySelector(".google-place__action").click();
      await until(() => page.reservations().length === 2, "explicit retry reserves once");
      await wait(30);
      assert.equal(page.reservations().length, 2);
      assert.ok(noGoogleWork(page), "still denied: zero Google activity");
      server.deny = null;
      page.host("plan-garden").querySelector(".google-place__action").click();
      await until(() => page.details("plan-garden"), "component after the owner fixed the allowance");
      assert.deepEqual([page.reservations().length, page.google.scripts.length, page.google.constructed[DETAILS]], [3, 1, 1]);
      assert.equal(ownMarkup(page)["plan-garden"].summary, baseline["plan-garden"].summary, "Google is additive: the Commons photo stays");
      assert.deepEqual(page.errors, []);
    }

    // G3. A grant that arrives after the trip was opted out starts nothing.
    {
      const server = createFakeServer(gateTrip(), { editable: false });
      let release;
      server.reservationGate = { promise: new Promise((resolve) => { release = resolve; }) };
      page = await loadPage({ server });
      await setCardOpen(page, "plan-garden", true);
      await until(() => page.reservations().length === 1, "reservation sent");
      server.remote((trip) => { trip.googlePlacePhotosEnabled = false; });
      page.window.dispatchEvent(new page.window.Event("online"));
      await until(() => !page.host("plan-garden"), "opt-out applied while the reservation is in transit");
      release();
      await wait(80);
      assert.equal(server.permits.size, 1, "fixture: the server had granted before the opt-out");
      assert.ok(noGoogleWork(page), "a late grant after opt-out loads no script and builds nothing");
      assert.equal(ownMarkup(page)["plan-garden"].summary, baseline["plan-garden"].summary);
      assert.deepEqual(page.errors, []);
    }

    // G4. A grant that arrives after the card was collapsed builds nothing; re-expanding while the
    //     permit is still valid uses it instead of reserving twice.
    {
      const server = createFakeServer(gateTrip(), { editable: false });
      let release;
      server.reservationGate = { promise: new Promise((resolve) => { release = resolve; }) };
      page = await loadPage({ server });
      await setCardOpen(page, "plan-garden", true);
      await until(() => page.reservations().length === 1, "reservation sent");
      await setCardOpen(page, "plan-garden", false);
      release();
      await wait(60);
      assert.ok(noGoogleWork(page), "collapsed before the grant arrived: nothing loaded or built");
      await setCardOpen(page, "plan-garden", true);
      await until(() => page.details("plan-garden"), "built on re-expansion");
      assert.deepEqual([page.reservations().length, page.google.constructed[DETAILS], page.google.scripts.length], [1, 1, 1], "one reservation, one component, one script");
      assert.deepEqual(page.errors, []);
    }

    // G5. A background tab reserves and dispatches nothing; the plan offers an explicit control.
    {
      const server = createFakeServer(gateTrip(), { editable: false });
      page = await loadPage({ server });
      Object.defineProperty(page.doc, "visibilityState", { configurable: true, get: () => "hidden" });
      await setCardOpen(page, "plan-garden", true);
      await wait(40);
      assert.equal(page.reservations().length, 0, "hidden: no reservation");
      assert.ok(noGoogleWork(page), "hidden: no Google work");
      assert.equal(page.host("plan-garden").querySelector(".google-place__action").textContent, googleText("en", "showDetails"));
      Object.defineProperty(page.doc, "visibilityState", { configurable: true, get: () => "visible" });
      page.host("plan-garden").querySelector(".google-place__action").click();
      await until(() => page.details("plan-garden"), "built after an explicit show in a visible tab");
      assert.equal(page.reservations().length, 1);
      assert.deepEqual(page.errors, []);
    }

    // G6. Whatever Element.moveBefore does (native-equivalent re-connection, absent, throwing), a
    //     component is never moved: two open cards switch by hiding/unhiding in their own hosts, an
    //     unrelated re-render releases components and reserves/dispatches nothing, and only an
    //     explicit Show reserves again (once).
    for (const moveMode of ["native", "absent", "throws"]) {
      const server = createFakeServer(gateTrip(), { editable: false });
      page = await loadPage({ server, moveMode });
      assert.equal(typeof page.doc.createElement("div").moveBefore, moveMode === "absent" ? "undefined" : "function", `fixture: moveBefore ${moveMode}`);
      const mount = (id) => page.host(id).querySelector(".google-place__mount");
      const action = (id) => page.host(id).querySelector(".google-place__action");
      await setCardOpen(page, "plan-garden", true);
      await until(() => page.details("plan-garden"), "garden component");
      const gardenElement = page.details("plan-garden");
      const gardenFamily = [gardenElement, ...gardenElement.querySelectorAll("*")];
      await setCardOpen(page, "plan-museum", true);
      await until(() => page.details("plan-museum"), "museum component");
      const museumElement = page.details("plan-museum");
      assert.ok(gardenElement.isConnected && page.host("plan-garden").contains(gardenElement) && mount("plan-garden").hidden, `${moveMode}: the inactive component stays hidden in its own host`);
      assert.equal(action("plan-garden").textContent, googleText("en", "showDetails"));
      action("plan-garden").click();
      await until(() => !mount("plan-garden").hidden && mount("plan-museum").hidden, `${moveMode}: switched back in place`);
      assert.equal(page.details("plan-garden"), gardenElement);
      assert.deepEqual([page.reservations().length, page.google.constructed[DETAILS]], [2, 2], `${moveMode}: switching between two open cards reserves nothing`);
      await poll(page, server, `Remote fictional note (${moveMode})`);
      assert.deepEqual([gardenElement.isConnected, museumElement.isConnected], [false, false], `${moveMode}: the re-render released both components`);
      assert.deepEqual([page.details("plan-garden"), page.details("plan-museum")], [null, null], `${moveMode}: neither was moved into a rebuilt card`);
      assert.equal(action("plan-garden").textContent, googleText("en", "showDetails"), `${moveMode}: the restored cards offer an explicit control`);
      assert.equal(action("plan-museum").textContent, googleText("en", "showDetails"));
      await poll(page, server, `Second remote note (${moveMode})`);
      assert.deepEqual([page.reservations().length, page.google.constructed[DETAILS]], [2, 2], `${moveMode}: unrelated re-renders reserve and dispatch nothing`);
      action("plan-garden").click();
      await until(() => page.details("plan-garden"), `${moveMode}: garden after an explicit show`);
      await wait(20);
      assert.deepEqual([page.reservations().length, page.google.constructed[DETAILS]], [3, 3], `${moveMode}: only the explicit Show reserved, once`);
      assert.ok(gardenFamily.every((node) => node.fictionalConnections === 1), `${moveMode}: the released component and its children were connected once`);
      assert.deepEqual([page.google.reconnects, page.google.moveCalls], [[], 0], `${moveMode}: no component was ever re-connected; moveBefore never called`);
      assert.deepEqual(page.errors, []);
    }

    // G7 and G8. A lost reservation response is retried with the same idempotency key and yields one
    //     permit; a replayed permit ID never authorizes a second component.
    {
      const server = createFakeServer(gateTrip(), { editable: false });
      server.dropReservationResponses = 1;
      page = await loadPage({ server });
      await setCardOpen(page, "plan-garden", true);
      await until(() => page.details("plan-garden"), "component after a retried transport");
      const sent = page.reservations();
      assert.equal(sent.length, 2, "one transport retry");
      assert.equal(sent[0].body.requestId, sent[1].body.requestId, "the retry reuses the durable idempotency key");
      assert.equal(server.permits.size, 1, "the server issued one permit");
      assert.equal(page.google.constructed[DETAILS], 1, "and the page built one component");
      server.forcePermitId = [...server.permits.values()][0].permit.id;
      await setCardOpen(page, "plan-museum", true);
      await until(() => textOf(page.host("plan-museum")).includes(googleText("en", "detailsUnavailable")), "replayed permit refused");
      assert.equal(page.google.constructed[DETAILS], 1, "a replayed permit never becomes a second component");
      assert.deepEqual(page.errors, []);
    }
  }

  // E. Static generator page: an association in the seed is inert; no request at all.
  {
    const fetchesBefore = allFetches.length;
    const seed = {
      title: "Fictional Static Lanterns", slug: "fictional-static-lanterns", buildId: "google-test", timezone: "UTC", startDate: DAY_ONE,
      reminders: [], tips: [], participantGroups: [], days: [{ id: "static-day", date: DAY_ONE, theme: "Invented static day", slots: [
        linked({ id: "static-garden", name: "Invented Static Garden", period: "morning", time: "10:00", planType: "sight", place: clone(GARDEN_PLACE),
          lat: GARDEN_PLACE.lat, lng: GARDEN_PLACE.lng, address: GARDEN_PLACE.address, photo: clone(GARDEN_PHOTO) }, PLACE.garden)
      ] }]
    };
    const page = await loadPage({ server: null, hosted: false, seed });
    await setCardOpen(page, "static-garden", true);
    await openEditor(page, "static-garden");
    assert.equal(page.panel(), null, "static pages have no Google controls");
    await cancelEditor(page);
    assert.equal(page.doc.querySelector(".google-place"), null);
    assert.equal(Object.keys(page.google.constructed).length + page.google.scripts.length, 0, "static generator stays no-Google");
    assert.equal(allFetches.length, fetchesBefore, "the static page made no network request");
    assert.deepEqual(page.errors, []);
  }

  console.log("Google Places UI Kit DOM simulation passed (mocked Google library only): allowance reservation before every details/search/preview dispatch, the key only from a granted reservation, limit/paused denials with zero Google activity and byte-for-byte Commons/manual/no-photo cards, late grants after opt-out or collapse, hidden tabs, components never moved or re-connected whether moveBefore is native-equivalent, absent or throwing (re-renders release them and offer an explicit Show that reserves once), lost-response retry with one permit, replayed permit refused; disabled/no-key zero activity with OSM/Commons intact; lazy single-plan loading with one script/library load; construction, place-assignment, reservation and query counts across expansion, re-render, polls, language changes and unrelated edits; hidden reuse in the same host and bounded memory; stale and cross-trip associations never reused; failure/timeout without automatic retry; explicit public-venue guard, private-text refusal and user-only selection (ID read only); cancel and location-change invalidation; Place ID preview; save/remove/create; four languages; phone sheet host; legacy mapsUrl alias kept through Save normalization; an unmatched pending choice never attached, edits saved, four-language relink notice, no extra request; static generator inert. No real SDK, provider, billing, browser layout or device claim.");
} finally {
  epoch += 1;
  timers.forEach(nativeClear);
  activeWindow?.close();
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClear;
  if (nativeNavigator) Object.defineProperty(globalThis, "navigator", nativeNavigator);
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
}
