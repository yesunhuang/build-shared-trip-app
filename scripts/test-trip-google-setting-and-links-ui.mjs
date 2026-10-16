// Trip page DOM simulation (jsdom) for the per-trip Google place details choice and for directly
// usable plan/card links. Everything is simulated and fictional:
//   - The trip API is an in-memory fictional server following the documented contract.
//   - Google is MOCKED: the standard gmp-* tags are fake custom elements that only count
//     constructions, connections/re-connections, place-request assignments and text queries; the
//     Maps script is never fetched (a MutationObserver sees the <script> element, records it and
//     installs a fake importLibrary). Element.moveBefore is a native-equivalent mock (an element
//     without connectedMoveCallback is disconnected and re-connected) whose calls are counted; the
//     app must never call it. Allowance reservations are granted by the fictional server with the
//     provider month of the page's own wall clock (denials are covered in
//     test-google-places-ui-kit.mjs and test-google-places-allowance-ui.mjs).
//   - Pointer, touch, mouse and keyboard input are SIMULATED by dispatching synthetic DOM events.
//     jsdom has no layout, no real touch, no browser shortcuts and no real navigation: a window-level
//     listener records each activation event and then cancels jsdom's (unimplemented) navigation.
// This is UI/contract evidence only; it says nothing about a real browser, device, the real SDK,
// provider behaviour or billing.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { associationForPlan } from "../assets/app-template/public/google-place-association.js";
import { MAPS_JS_URL, READY_CALLBACK, STANDARD_TAGS, googleText, providerMonth } from "../assets/app-template/public/google-places-ui-kit.js";
import { GOOGLE_PLACE_PHOTOS_LANGUAGES, googlePlacePhotosText } from "../assets/app-template/public/hosted-client.js";
import {
  createLinkActivationGuard, interactiveTargetOf, isPlainPrimaryActivation, linkFromEvent, safeLinkUrl
} from "../assets/app-template/public/link-activation.js";

const PUBLIC_DIR = fileURLToPath(new URL("../assets/app-template/public/", import.meta.url));
const ORIGIN = "http://fictional-trips.test";
const TRIP_ID = "fictional-lanterns";
const DAY_ONE = "2031-05-04";
const FIELD = "googlePlacePhotosEnabled";
const FAKE_KEY = "FAKE-browser-key-for-tests-only-000000000";
const PLACE = Object.freeze({ garden: "FAKE_place_garden_0101", museum: "FAKE_place_museum_0101", late: "FAKE_place_late_0101" });
const DETAILS = "gmp-place-details-compact";
const SEARCH = "gmp-place-search";
const clone = (value) => structuredClone(value);
const textOf = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------
// 1. Unit checks of the shared link module (jsdom document, simulated events).
{
  const dom = new JSDOM("<!doctype html><html><body><div id=card><a id=link href='https://example.org/fictional'><span id=child>Fictional</span></a><button id=plain>Plain</button></div></body></html>", { url: ORIGIN });
  const { window } = dom;
  const doc = window.document;
  const shadowReads = { count: 0 };
  for (const [tag, mode] of [["gmp-place-details-compact", "closed"], ["gmp-place-search", "open"]]) {
    window.customElements.define(tag, class extends window.HTMLElement {
      constructor() {
        super();
        const root = this.attachShadow({ mode });
        root.innerHTML = "<a class=inner href='https://example.org/fictional-inner'>Inner</a>";
        this._inner = root.querySelector("a");
      }
      get shadowRoot() { shadowReads.count += 1; return null; }
    });
  }
  const closedHost = doc.createElement("gmp-place-details-compact");
  const openHost = doc.createElement("gmp-place-search");
  doc.getElementById("card").append(closedHost, openHost);
  const seen = [];
  doc.addEventListener("pointerdown", (event) => seen.push(interactiveTargetOf(event, doc.getElementById("card"))));
  const fire = (target) => target.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, composed: true }));
  fire(doc.getElementById("child"));
  fire(doc.getElementById("plain"));
  fire(closedHost._inner);
  fire(openHost._inner);
  assert.equal(seen[0]?.kind, "link", "a press on a link's descendant belongs to the link");
  assert.equal(seen[0].element.id, "link");
  assert.equal(seen[1], null, "a plain button is not a link");
  assert.deepEqual([seen[2]?.kind, seen[2]?.element], ["component", closedHost], "closed shadow DOM: the official component host, never its content");
  assert.deepEqual([seen[3]?.kind, seen[3]?.element], ["component", openHost], "open shadow DOM: still the host; the inner link is never treated as ours");
  assert.equal(shadowReads.count, 0, "shadowRoot is never read");
  const click = new window.MouseEvent("click", { bubbles: true });
  doc.getElementById("child").dispatchEvent(click);
  assert.equal(linkFromEvent(click)?.id, "link", "linkFromEvent finds the anchor from the event path");
  assert.equal(isPlainPrimaryActivation({ button: 0 }), true);
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) assert.equal(isPlainPrimaryActivation({ button: 0, [modifier]: true }), false, modifier);
  assert.equal(isPlainPrimaryActivation({ button: 1 }), false, "middle button");

  // Guard: defers work only while a link press is in progress; never cancels or stops events.
  const timers = [];
  const guard = createLinkActivationGuard({ root: doc, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  const ran = [];
  assert.equal(guard.whenIdle("a", () => ran.push("now")), true, "idle: runs at once");
  const down = new window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, composed: true });
  doc.getElementById("child").dispatchEvent(down);
  assert.equal(guard.active, true, "a press on a link's descendant starts a guarded interaction");
  assert.equal(down.defaultPrevented, false, "the guard never cancels the press");
  assert.equal(guard.whenIdle("render", () => ran.push("first")), false);
  guard.whenIdle("render", () => ran.push("latest"));
  const activation = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  let reachedWindow = false;
  window.addEventListener("click", () => { reachedWindow = true; }, { once: true });
  doc.getElementById("link").dispatchEvent(activation);
  assert.ok(reachedWindow && !activation.defaultPrevented, "the click propagates normally and is not cancelled");
  assert.deepEqual(ran, ["now"], "deferred work waits for the activation to settle");
  timers.at(-1).fn();
  assert.deepEqual(ran, ["now", "latest"], "then runs once, latest data wins");
  assert.equal(guard.active, false);
  doc.getElementById("plain").dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true }));
  assert.equal(guard.active, false, "a press on an ordinary control is not guarded");
  // cancel(key): drops deferred work without running it (used for sign-out / authority changes);
  // the press itself stays guarded and other keys are untouched.
  doc.getElementById("child").dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, composed: true }));
  assert.equal(guard.active, true);
  guard.whenIdle("render", () => ran.push("cancelled"));
  guard.whenIdle("other", () => ran.push("other"));
  assert.equal(guard.cancel("render"), true, "cancel reports dropped work");
  assert.equal(guard.cancel("render"), false, "nothing left to cancel");
  assert.equal(guard.active, true, "cancelling does not end the press");
  assert.equal(guard.pendingCount, 1);
  timers.at(-1).fn();
  assert.deepEqual(ran, ["now", "latest", "other"], "cancelled work never runs, even after the press settles");
  guard.dispose();

  for (const [value, expected] of [
    ["https://example.org/a b", ""], ["https://example.org/fictional?x=1#y", "https://example.org/fictional?x=1#y"], ["http://example.org/", "http://example.org/"],
    ["/attachments/fictional.pdf", "/attachments/fictional.pdf"], ["//evil.example/x", ""], ["javascript:alert(1)", ""], ["JavaScript:alert(1)", ""],
    ["data:text/html,hi", ""], ["vbscript:x", ""], ["https://user:pw@example.org/", ""], ["", ""], [null, ""], ["mailto:someone@example.org", ""]
  ]) assert.equal(safeLinkUrl(value), expected, `safeLinkUrl(${JSON.stringify(value)})`);
  window.close();
}

// ---------------------------------------------------------------------------------------------
// 2. Fixtures and fictional API.

const GOOGLE_URL = "https://www.google.com/maps/place/Invented+Lantern+Museum,+1+Sample+Quay/data=!4m6!3m5!1s0x0:0x1!8m2!3d40.1!4d10.2!16s%2Fg%2Fsample";
const NOODLE_MAPS_URL = "https://www.google.com/maps/search/?api=1&query=Invented%20Noodle%20Bar";
const osmPlace = (id, name, lat, lng, address) => ({
  provider: "openstreetmap", id, name, address, lat, lng, sourceUrl: `https://www.openstreetmap.org/${id}`,
  attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", selectedAt: "2031-01-02T03:04:05.000Z"
});
const GARDEN_PLACE = osmPlace("way/3002", "Invented Tide Garden", 40.2, 10.3, "5 Sample Promenade, Fictional Bay");
const GARDEN_PHOTO = {
  provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_garden.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_garden.jpg", credit: "Sample Photographer · CC BY-SA 4.0",
  author: "Sample Photographer", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", selectedAt: "2031-01-02T03:04:06.000Z"
};
const linked = (plan, placeId) => ({ ...plan, googlePlaceAssociation: associationForPlan(plan, placeId) });

function fixtureTrip(extra = {}) {
  const garden = { id: "plan-garden", name: "Invented Tide Garden", period: "morning", time: "09:00", sortTime: "09:00", planType: "sight", review: "Fictional rock pools",
    place: clone(GARDEN_PLACE), lat: GARDEN_PLACE.lat, lng: GARDEN_PLACE.lng, address: GARDEN_PLACE.address, photo: clone(GARDEN_PHOTO) };
  const museum = { id: "plan-museum", name: "Invented Lantern Museum", period: "morning", time: "10:00", sortTime: "10:00", planType: "sight", review: "Fictional lanterns",
    googleMapsUrl: GOOGLE_URL, googleMapsPlaceName: "Invented Lantern Museum", googleMapsPlaceLabel: "Invented Lantern Museum, 1 Sample Quay", address: "1 Sample Quay", lat: 40.1, lng: 10.2 };
  return {
    id: TRIP_ID, version: 3, archived: false, title: "Fictional Lantern Weekend", timezone: "UTC", country: "Fictionland", route: "Sample Bay",
    updatedAt: "2031-01-03T00:00:00.000Z", createdAt: "2031-01-01T00:00:00.000Z", dateRange: { start: DAY_ONE, end: "2031-05-05" },
    reminders: [], participantGroups: [], tips: [],
    days: [
      { id: "day-one", date: DAY_ONE, theme: "Invented lantern day", slots: [
        linked(garden, PLACE.garden), linked(museum, PLACE.museum),
        { id: "plan-cafe", name: "Invented Corner Cafe", period: "evening", time: "18:00", sortTime: "18:00", planType: "restaurant", review: "Timeline-only placeholder" }
      ], recommendations: {
        restaurants: [{ name: "Invented Noodle Bar", description: "Fictional noodles", mapsUrl: NOODLE_MAPS_URL, sourceUrl: "https://example.org/fictional-noodles" }],
        seeGo: [
          { name: "Invented Unsafe Link", description: "Must never become a script link", sourceUrl: "javascript:alert(1)" },
          { name: "Invented Data Link", description: "Must never become a data link", sourceUrl: "data:text/html,fictional" }
        ]
      } },
      { id: "day-two", date: "2031-05-05", theme: "Invented ferry day", slots: [{ id: "plan-ferry", name: "Invented Ferry Ride", period: "morning", time: "10:00", planType: "transport" }] }
    ],
    ...extra
  };
}

function createFakeServer(initialTrip, { google = true, editable = true } = {}) {
  const server = { trip: clone(initialTrip), google, editable, log: [], requestIds: new Map(), reservationGate: null, permits: new Map() };
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
    if (method === "POST" && rest === "/google-places/reservations") {
      // Same contract as the real route: the trip's own opt-in is checked when the request is
      // decided; server.reservationGate then holds the decided answer in transit.
      const decided = !server.google ? json(503, { error: { code: "google_places_disabled", message: "Off." } })
        : server.trip[FIELD] !== true ? json(409, { error: { code: "google_trip_not_enabled", message: "Off for this trip." } })
          : (() => {
            const prior = server.permits.get(body.requestId);
            if (prior) return json(200, { ...prior, replayed: true });
            const permit = { granted: true, replayed: false, apiKey: FAKE_KEY, libraries: ["places"],
              // The page uses the real clocks, so the permit carries the provider month of that wall clock.
              permit: { id: "gpr_" + String(server.permits.size + 1).padStart(24, "0"), kind: body.kind, tripId: server.trip.id, placeId: body.placeId ?? null, month: providerMonth(Date.now()), validForMs: 45000 } };
            server.permits.set(body.requestId, permit);
            return json(200, permit);
          })();
      if (server.reservationGate) await server.reservationGate.promise;
      return decided;
    }
    if (method === "POST" && rest === "/changes") {
      if (!server.editable) return json(403, { error: { code: "forbidden", message: "Editing access required." } });
      if (server.requestIds.has(body.requestId)) return json(200, { trip: clone(server.requestIds.get(body.requestId)) });
      if (body.expectedVersion !== server.trip.version) return json(409, { error: { code: "version_conflict", message: "Version conflict." } });
      let next = clone(server.trip);
      for (const change of body.changes) {
        if (change.type === "replace_content") next = clone(change.trip);
        else if (change.type === "update_trip") {
          for (const [key, value] of Object.entries(change.fields)) {
            // Same rule as the real server: a strict boolean.
            if (key === FIELD && typeof value !== "boolean") return json(422, { error: { code: "validation_failed", message: "must be true or false" } });
            next[key] = value;
          }
        } else return json(400, { error: { code: "unsupported", message: "Not part of this simulation." } });
      }
      Object.assign(next, { id: server.trip.id, version: server.trip.version + 1, archived: false, updatedAt: new Date(Date.parse(server.trip.updatedAt) + 60000).toISOString() });
      server.trip = next;
      server.requestIds.set(body.requestId, next);
      return json(200, { trip: clone(next) });
    }
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  return server;
}

// ---------------------------------------------------------------------------------------------
// 3. Page harness (same approach as test-google-places-ui-kit.mjs): long timers held, fetch
//    limited to the fictional API, Leaflet stub, fresh module graph per page load.

function newGoogleRecord() { return { constructed: {}, connections: 0, reconnects: [], moveCalls: 0, placeAssignments: [], textQueries: [], shadowReads: 0, created: [], scripts: [], imports: [] }; }
function defineStandardElements(window, record) {
  for (const tag of STANDARD_TAGS) {
    if (window.customElements.get(tag)) continue;
    window.customElements.define(tag, class extends window.HTMLElement {
      static get observedAttributes() { return ["place", "text-query"]; }
      constructor() { super(); record.constructed[tag] = (record.constructed[tag] || 0) + 1; }
      // Every connection counts (component and nested children); a second one is a re-connection.
      connectedCallback() {
        record.connections += 1;
        this.fictionalConnections = (this.fictionalConnections || 0) + 1;
        if (this.fictionalConnections > 1) record.reconnects.push(tag);
      }
      attributeChangedCallback(name, _old, value) {
        if (name === "place") record.placeAssignments.push(value);
        if (name === "text-query") record.textQueries.push(value);
      }
      get shadowRoot() { record.shadowReads += 1; return null; }
    });
  }
  const original = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...rest) => { record.created.push(String(tag).toLowerCase()); return original(tag, ...rest); };
}
const fakeLibrary = (record) => ({ maps: { importLibrary: async (name) => { record.imports.push(name); return { fictionalPlacesLibrary: true }; } } });
// Native-equivalent Element.moveBefore for elements without connectedMoveCallback: like Chrome and
// the HTML standard, it still disconnects and re-connects (an ordinary insert in jsdom). Counted.
function installNativeMove(window, record) {
  Object.defineProperty(window.Element.prototype, "moveBefore", {
    configurable: true, writable: true,
    value(node, child) {
      record.moveCalls += 1;
      if (!this.isConnected || !node.isConnected) throw new window.DOMException("Both nodes must be connected.", "HierarchyRequestError");
      this.insertBefore(node, child);
    }
  });
}
const googleActivity = (page) => JSON.stringify([page.configRequests(), page.reservations(), page.google.scripts.length, page.google.imports.length, page.google.constructed, page.google.textQueries.length, page.google.placeAssignments.length]);
const zeroGoogle = (page) => page.configRequests() === 0 && page.reservations() === 0 && page.google.scripts.length === 0 && page.google.imports.length === 0
  && Object.keys(page.google.constructed).length === 0 && page.google.textQueries.length === 0 && !page.google.created.some((tag) => tag.startsWith("gmp-"));

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
function leafletStub(window, markers) {
  const doc = window.document;
  const point = (x, y) => ({ x, y, add(other) { return point(x + other.x, y + other.y); } });
  return {
    map() {
      const map = { attributionControl: { setPrefix() {} }, invalidateSize() {}, stop() {}, setView() { return map; }, fitBounds() { return map; },
        project([lat, lng]) { return point(lng * 1000, -lat * 1000); }, unproject(projected) { return [-projected.y / 1000, projected.x / 1000]; },
        eachLayer(fn) { (map.tripLayers?.layers || []).forEach(fn); } };
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
      const marker = {
        coordinates, options, element, handlers: {},
        addTo(group) { group.layers.push(this); doc.getElementById("map").append(element); return this; },
        bindPopup() { return this; }, getPopup() { return null; },
        on(name, handler) { this.handlers[name] = handler; return this; },
        getElement() { return element; }, setZIndexOffset() { return this; }
      };
      markers.push(marker);
      return marker;
    },
    polyline: () => ({ addTo(group) { group.layers.push(this); return this; } })
  };
}

const tempRoots = [];
let activeWindow = null;
async function loadPage({ server, phone = false, planView = phone }) {
  if (activeWindow) { epoch += 1; activeWindow.close(); }
  timers.forEach(nativeClear); timers.clear();
  currentServer = server;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-links-ui-"));
  tempRoots.push(root);
  const publicDir = path.join(root, "public");
  fs.cpSync(PUBLIC_DIR, publicDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8").replace("__TRIP_DATA_JSON__", "{}");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
  const dom = new JSDOM(html, { url: `${ORIGIN}/trips/${TRIP_ID}?day=${DAY_ONE}${planView ? "&view=plan" : ""}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  activeWindow = window;
  window.SHARED_TRIP_HOSTED = true;
  const viewport = phone ? { width: 390, height: 760, pointer: "coarse" } : { width: 1280, height: 820, pointer: "fine" };
  window.matchMedia = (media) => ({ matches: mediaMatches(media, viewport), media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.HTMLElement.prototype.scrollTo = function () {};
  window.scrollTo = () => {}; window.scrollBy = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new window.Event("close")); };
  // Links must never be emulated with window.open.
  const opened = [];
  window.open = (...args) => { opened.push(args); return null; };
  const markers = [];
  window.L = leafletStub(window, markers);
  const mapElement = window.document.getElementById("map");
  Object.defineProperty(mapElement, "clientWidth", { configurable: true, get: () => (phone ? 390 : 760) });
  Object.defineProperty(mapElement, "clientHeight", { configurable: true, get: () => (phone ? 760 : 640) });
  const google = newGoogleRecord();
  defineStandardElements(window, google);
  installNativeMove(window, google);
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (node.localName !== "script" || !String(node.src).startsWith(MAPS_JS_URL)) continue;
      google.scripts.push(node.src);
      window.google = fakeLibrary(google);
      window[READY_CALLBACK]?.();
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
  // Activation recorder: runs last (window, bubble phase), records whether the app cancelled the
  // event and whether the original anchor was still in the document, then cancels jsdom's
  // unimplemented navigation. It is test plumbing, not app behaviour.
  const activations = [];
  for (const type of ["click", "auxclick", "keydown"]) {
    window.addEventListener(type, (event) => {
      const anchor = event.composedPath().find((node) => node?.localName === "a" && node.hasAttribute?.("href")) || null;
      activations.push({ type, anchor, prevented: event.defaultPrevented, connected: Boolean(anchor?.isConnected), button: event.button, key: event.key });
      if (anchor && type !== "keydown") event.preventDefault();
    });
  }
  await import(`${pathToFileURL(path.join(publicDir, "hosted-bootstrap.js")).href}?v=__CACHE_VERSION__`);
  const doc = window.document;
  await until(() => !doc.querySelector(".hosted-boot") && doc.querySelector(".timeline-item"), "trip page ready");
  await wait(60);
  const page = { window, doc, errors, google, activations, opened, markers };
  page.item = (id) => doc.querySelector(`.timeline-item[data-slot-id="${id}"]`);
  page.card = (id) => page.item(id)?.querySelector(".timeline-card");
  page.host = (id) => page.item(id)?.querySelector(".timeline-card__body .google-place");
  page.details = (id) => page.host(id)?.querySelector(DETAILS) || null;
  page.panel = () => doc.getElementById("google-match");
  page.action = (name) => page.panel().querySelector(`[data-google-action="${name}"]`);
  page.dialog = () => doc.getElementById("item-dialog");
  page.form = () => doc.getElementById("item-form");
  page.configRequests = () => (currentServer?.log || []).filter((entry) => entry.path === "/api/google-places/config").length;
  page.reservations = () => (currentServer?.log || []).filter((entry) => entry.path.endsWith("/google-places/reservations")).length;
  page.changes =() => (currentServer?.log || []).filter((entry) => entry.method === "POST" && entry.path.endsWith("/changes"));
  return page;
}

async function setCardOpen(page, slotId, open) {
  const card = page.card(slotId);
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
const slotOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
const sentPlan = (id) => slotOf(currentServer.log.filter((entry) => entry.method === "POST" && entry.path.endsWith("/changes")).at(-1).body.changes[0].trip, id);
async function poll(page) {
  const before = currentServer.log.length;
  page.window.dispatchEvent(new page.window.Event("online"));
  await until(() => currentServer.log.slice(before).some((entry) => entry.method === "GET" && entry.path === `/api/trips/${TRIP_ID}`), "poll request");
  await wait(40);
}

// Simulated input. Pointer events use PointerEvent when jsdom provides it, else a MouseEvent with
// the same type; touch uses TouchEvent when available, else a plain Event of that type.
function pointer(page, target, type, { button = 0, pointerType = "mouse", ...modifiers } = {}) {
  const { window } = page;
  const Pointer = window.PointerEvent || window.MouseEvent;
  const event = new Pointer(type, { bubbles: true, cancelable: true, composed: true, button, buttons: type === "pointerup" ? 0 : 1 << button, pointerType, isPrimary: true, pointerId: 1, clientY: 100, ...modifiers });
  target.dispatchEvent(event);
  return event;
}
function mouse(page, target, type, { button = 0, ...modifiers } = {}) {
  const event = new page.window.MouseEvent(type, { bubbles: true, cancelable: true, composed: true, button, ...modifiers });
  target.dispatchEvent(event);
  return event;
}
function touch(page, target, type) {
  const { window } = page;
  let event;
  try { event = new (window.TouchEvent || window.Event)(type, { bubbles: true, cancelable: true, composed: true }); }
  catch { event = new window.Event(type, { bubbles: true, cancelable: true, composed: true }); }
  target.dispatchEvent(event);
  return event;
}
const lastActivation = (page, type) => page.activations.filter((entry) => entry.type === type).at(-1);
const remoteNote = (server, note) => server.remote((trip) => { slotOf(trip, "plan-cafe").review = note; });

try {
  // -------------------------------------------------------------------------------------------
  // A. Site on, trip NOT opted in (old data without the field, then explicit false): zero Google
  //    work, no Google controls; OSM/Commons intact; unrelated edits keep associations.
  for (const [label, trip] of [["old data (field absent)", fixtureTrip()], ["explicit false", fixtureTrip({ [FIELD]: false })]]) {
    if (label.startsWith("old")) assert.equal(Object.hasOwn(trip, FIELD), false, "fixture: an old trip has no field");
    const server = createFakeServer(trip);
    const page = await loadPage({ server });
    for (const id of ["plan-garden", "plan-museum", "plan-cafe"]) await setCardOpen(page, id, true);
    assert.equal(page.doc.querySelector(".google-place"), null, `${label}: no Google host`);
    assert.ok(zeroGoogle(page), `${label}: zero config/script/library/component/query activity`);
    assert.ok(page.item("plan-garden").querySelector(".location-photo img").src.includes("Fictional_garden.jpg"), `${label}: Commons photo shown`);
    assert.ok(page.item("plan-garden").querySelector(".place-source a").href.includes("openstreetmap.org/way/3002"), `${label}: OSM source shown`);
    await openEditor(page, "plan-garden");
    assert.equal(page.panel(), null, `${label}: no Google matching controls in the editor`);
    typeInto(page.window, page.form().elements.name, "Invented Tide Garden Renamed");
    await saveEditor(page);
    assert.deepEqual(sentPlan("plan-garden").googlePlaceAssociation, slotOf(fixtureTrip(), "plan-garden").googlePlaceAssociation, `${label}: an unrelated edit keeps the saved association`);
    assert.deepEqual(sentPlan("plan-garden").place, GARDEN_PLACE, `${label}: OSM place unchanged`);
    assert.deepEqual(sentPlan("plan-garden").photo, GARDEN_PHOTO, `${label}: Commons photo unchanged`);
    assert.ok(zeroGoogle(page), `${label}: still zero Google activity after editing`);
    assert.ok(allFetches.every((href) => href.startsWith(`GET ${ORIGIN}/api/`) || href.startsWith(`POST ${ORIGIN}/api/`) || href.includes("open-meteo")), `${label}: only the fictional API (weather requests are blocked by the harness)`);
    assert.deepEqual(page.errors, []);
  }

  // B. Site OFF, trip opted in: the trip choice cannot bypass the global gate.
  {
    const server = createFakeServer(fixtureTrip({ [FIELD]: true }), { google: false });
    const page = await loadPage({ server });
    for (const id of ["plan-garden", "plan-museum"]) await setCardOpen(page, id, true);
    await openEditor(page, "plan-museum");
    assert.equal(page.panel(), null, "site off: no Google controls even for an opted-in trip");
    await cancelEditor(page);
    assert.ok(zeroGoogle(page) && page.doc.querySelector(".google-place") === null, "site off: zero Google activity for an opted-in trip");
  }

  // C. Site on, trip on: lazy single load; repeated expansion, re-renders and unrelated remote
  //    edits build nothing new. Then a poll opts the trip OUT while a component is shown and a
  //    Google search is open in the editor: everything is cleared, late results are ignored, no new
  //    Google work happens, associations stay. Opting in again reuses the page-session loader.
  {
    const server = createFakeServer(fixtureTrip({ [FIELD]: true }));
    const page = await loadPage({ server });
    const { window, google } = page;
    assert.equal(page.doc.querySelectorAll(".google-place").length, 2, "two plans with a current association get a host");
    assert.ok(zeroGoogle(page), "opening the trip loads nothing");
    await setCardOpen(page, "plan-garden", true);
    await until(() => page.details("plan-garden"), "garden component");
    let gardenElement = page.details("plan-garden");
    gardenElement.dispatchEvent(new window.Event("gmp-load"));
    assert.deepEqual([page.configRequests(), page.reservations(), google.scripts.length, google.imports, google.constructed[DETAILS]], [0, 1, 1, ["places"], 1], "one reservation, then one script, one library and one component");
    for (let round = 0; round < 3; round += 1) { await setCardOpen(page, "plan-garden", false); await setCardOpen(page, "plan-garden", true); }
    assert.equal(page.details("plan-garden"), gardenElement, "re-expansion unhides the same component in its own host");
    assert.deepEqual([page.reservations(), google.constructed[DETAILS], google.reconnects], [1, 1, []], "repeated expansion reserves, builds and re-connects nothing");
    remoteNote(server, "Remote fictional note one");
    await poll(page);
    await until(() => textOf(page.item("plan-cafe")).includes("Remote fictional note one"), "unrelated remote edit rendered");
    await wait(20);
    // The rebuild never moves a component into the new card: it is released, and the restored card
    // offers an explicit control without reserving or building anything.
    assert.equal(gardenElement.isConnected, false, "the unrelated re-render released the component");
    assert.equal(page.details("plan-garden"), null, "it was not moved into the rebuilt card");
    assert.equal(textOf(page.host("plan-garden").querySelector(".google-place__action")), googleText("en", "showDetails"), "the restored card offers an explicit control");
    assert.deepEqual([google.constructed[DETAILS], google.placeAssignments, page.reservations()], [1, [PLACE.garden], 1], "the unrelated re-render reserves, builds and assigns nothing");
    // Explicit Show: one fresh reservation for one fresh component; the page-session loader is reused.
    page.host("plan-garden").querySelector(".google-place__action").click();
    await until(() => page.details("plan-garden"), "garden after an explicit show");
    assert.notEqual(page.details("plan-garden"), gardenElement);
    gardenElement = page.details("plan-garden");
    gardenElement.dispatchEvent(new window.Event("gmp-load"));
    const settled = googleActivity(page);
    assert.deepEqual([page.reservations(), google.constructed[DETAILS], google.placeAssignments, google.scripts.length, google.imports.length], [2, 2, [PLACE.garden, PLACE.garden], 1, 1],
      "the explicit Show reserved once and built once; no new script or library");

    await openEditor(page, "plan-museum");
    assert.equal(page.panel().hidden, false, "opted in: the editor offers Google matching");
    page.action("open").click();
    page.panel().querySelector("#google-match-public").click();
    typeInto(window, page.panel().querySelector("#google-match-query"), "Invented Lantern Museum");
    page.action("search").click();
    await until(() => page.panel().querySelector(SEARCH)?.querySelector("gmp-place-text-search-request")?.getAttribute("text-query") === "Invented Lantern Museum", "Google search");
    const searchElement = page.panel().querySelector(SEARCH);
    const activityBeforeOptOut = googleActivity(page);
    const changesBeforeOptOut = page.changes().length;
    assert.notEqual(activityBeforeOptOut, settled, "the explicit search was the only new Google work");

    const snapshotBeforeOptOut = clone(server.trip);
    // Another editor turns the choice off; this page sees it on a poll (the dialog stays open).
    server.remote((trip) => { trip[FIELD] = false; });
    await poll(page);
    await until(() => !page.host("plan-garden"), "hosts removed after opt-out");
    assert.equal(gardenElement.isConnected, false, "the shown component is discarded");
    assert.equal(searchElement.isConnected, false, "the open Google search is removed");
    assert.equal(page.panel().hidden, true, "the editor's Google controls are hidden");
    assert.equal(page.doc.querySelectorAll(`${DETAILS}, ${SEARCH}`).length, 0, "no Google component remains in the page");
    // Remote fake edits (server.remote) are not logged as local writes, so these counts are local
    // POST /changes only. The opt-out poll itself writes nothing, and neither do late events.
    assert.equal(page.changes().length, changesBeforeOptOut, "the opt-out poll saves nothing");
    const changesBeforeLateEvents = page.changes().length;
    const lateSelect = new window.Event("gmp-select");
    lateSelect.place = { id: PLACE.late };
    searchElement.dispatchEvent(lateSelect);
    gardenElement.dispatchEvent(new window.Event("gmp-load"));
    gardenElement.dispatchEvent(new window.Event("gmp-error"));
    await wait(20);
    assert.equal(page.changes().length, changesBeforeLateEvents, "late Google events save nothing");
    // A response captured before that opt-out may arrive late. It must not revive the older
    // preference, controls or components. This swaps only the mocked GET response, then restores it.
    const currentOffSnapshot = clone(server.trip);
    server.trip = snapshotBeforeOptOut;
    await poll(page);
    server.trip = currentOffSnapshot;
    assert.equal(page.host("plan-garden"), null, "an older response cannot revive Google hosts after opt-out");
    assert.equal(page.panel().hidden, true, "an older response cannot re-enable Google matching");
    assert.equal(googleActivity(page), activityBeforeOptOut, "an older response starts no Google work");
    await cancelEditor(page);
    for (const id of ["plan-garden", "plan-museum"]) { await setCardOpen(page, id, false); await setCardOpen(page, id, true); }
    await openEditor(page, "plan-museum");
    assert.equal(page.panel().hidden, true, "a reopened editor shows no Google controls");
    typeInto(window, page.form().elements.name, "Invented Lantern Museum (late)");
    await saveEditor(page);
    assert.equal(sentPlan("plan-museum").googlePlaceAssociation.placeId, PLACE.museum, "opting out keeps the saved association (no late choice attached)");
    assert.equal(slotOf(server.trip, "plan-garden").googlePlaceAssociation.placeId, PLACE.garden, "other associations stay too");
    assert.equal(googleActivity(page), activityBeforeOptOut, "no new config/script/library/component/query after the opt-out");

    // Opt in again (remote): hosts return, nothing loads until a plan is expanded, then the
    // page-session loader is reused (no second script), but the new component needs a new
    // reservation.
    server.remote((trip) => { trip[FIELD] = true; });
    await poll(page);
    await until(() => page.host("plan-garden"), "hosts back after opting in again");
    assert.equal(googleActivity(page), activityBeforeOptOut, "re-enabling builds and loads nothing by itself");
    await setCardOpen(page, "plan-garden", false);
    await setCardOpen(page, "plan-garden", true);
    await until(() => page.details("plan-garden"), "component after re-enabling");
    assert.deepEqual([page.reservations(), google.scripts.length, google.imports.length], [4, 1, 1], "the loader is reused for the rest of the page session; each component (garden, garden after the explicit Show, search, garden again) had its own reservation");
    assert.equal(google.shadowReads, 0, "no shadow DOM read");
    assert.deepEqual([google.reconnects, google.moveCalls], [[], 0], "no component or nested child was ever re-connected; moveBefore never called");
    assert.deepEqual(page.errors, []);
  }

  // D. Opt-out while the very first reservation (already granted by the server) is still in
  //    transit: the late grant is ignored before any script or library work.
  {
    const server = createFakeServer(fixtureTrip({ [FIELD]: true }));
    let releaseReservation;
    server.reservationGate = { promise: new Promise((resolve) => { releaseReservation = resolve; }) };
    const page = await loadPage({ server });
    await setCardOpen(page, "plan-garden", true);
    await until(() => page.reservations() === 1, "reservation requested");
    assert.equal(textOf(page.host("plan-garden").querySelector(".google-place__status")), googleText("en", "detailsLoading"));
    server.remote((trip) => { trip[FIELD] = false; });
    await poll(page);
    await until(() => !page.host("plan-garden"), "host removed while reserving");
    releaseReservation();
    await wait(60);
    assert.equal(server.permits.size, 1, "fixture: the server granted before the opt-out");
    assert.deepEqual([page.google.scripts.length, page.google.imports.length, Object.keys(page.google.constructed).length], [0, 0, 0], "no script, library or component after a cancelled reservation");
    assert.deepEqual(page.errors, []);
  }

  // E. Edit trip: an accessible four-language checkbox for editors; saved only when changed;
  //    viewers get no control.
  {
    const server = createFakeServer(fixtureTrip());
    let page = await loadPage({ server });
    const editTrip = () => [...page.doc.querySelectorAll("#hosted-controls button")].find((button) => textOf(button) === "Edit trip");
    const language = () => page.doc.getElementById("language-select");
    assert.deepEqual([...GOOGLE_PLACE_PHOTOS_LANGUAGES].sort(), ["en", "ja", "zh-Hans", "zh-Hant"]);
    for (const code of ["zh-Hans", "zh-Hant", "ja", "en"]) {
      language().value = code; language().dispatchEvent(new page.window.Event("change"));
      await wait(30);
      const button = [...page.doc.querySelectorAll("#hosted-controls button")][0];
      button.click();
      const dialog = await (async () => { await until(() => page.doc.querySelector("dialog.hosted-editor"), "edit trip dialog"); return page.doc.querySelector("dialog.hosted-editor"); })();
      const box = dialog.querySelector(`input[type="checkbox"][name="${FIELD}"]`);
      assert.ok(box, `${code}: the checkbox exists`);
      assert.equal(box.checked, false, `${code}: off by default for a trip without the field`);
      assert.equal(box.closest("label").querySelector(".field-checkbox__label").textContent, googlePlacePhotosText(code, "label"), `${code}: label`);
      const hint = page.doc.getElementById(box.getAttribute("aria-describedby"));
      assert.equal(hint?.textContent, googlePlacePhotosText(code, "hint"), `${code}: hint linked by aria-describedby`);
      assert.ok(!/\b(?:SKU|API|billing|quota|browser key|SDK)\b/i.test(googlePlacePhotosText(code, "hint")), `${code}: no configuration jargon`);
      dialog.querySelector(".hosted-form-actions button[type=button]").click(); // Cancel
      await until(() => !page.doc.querySelector("dialog.hosted-editor"), "dialog closed");
    }
    for (const code of ["zh-Hans", "zh-Hant", "ja"]) assert.notEqual(googlePlacePhotosText(code, "label"), googlePlacePhotosText("en", "label"), `${code} is translated`);
    assert.ok(editTrip(), "editors get Edit trip");
    editTrip().click();
    await until(() => page.doc.querySelector("dialog.hosted-editor"), "edit trip dialog");
    let form = page.doc.querySelector("dialog.hosted-editor form");
    form.querySelector(`input[name="${FIELD}"]`).click();
    form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await until(() => server.trip[FIELD] === true, "opted in through Edit trip");
    const optIn = page.changes().at(-1).body;
    assert.deepEqual(optIn.changes.map((change) => change.type), ["update_trip"], "one validated update_trip");
    assert.equal(optIn.changes[0].fields[FIELD], true, "a real boolean is sent");
    assert.equal(optIn.expectedVersion, 3, "with the opened version");
    assert.ok(zeroGoogle(page), "saving the choice itself contacts nothing");
    // A fresh page (the app reloads after a metadata save): the box reflects the trip; a title-only
    // edit does not send the Google field.
    page = await loadPage({ server });
    editTrip().click();
    await until(() => page.doc.querySelector("dialog.hosted-editor"), "edit trip dialog again");
    form = page.doc.querySelector("dialog.hosted-editor form");
    assert.equal(form.querySelector(`input[name="${FIELD}"]`).checked, true, "the saved choice is shown");
    form.elements.title.value = "Fictional Lantern Weekend (renamed)";
    form.dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
    await until(() => server.trip.title === "Fictional Lantern Weekend (renamed)", "title saved");
    assert.equal(Object.hasOwn(page.changes().at(-1).body.changes[0].fields, FIELD), false, "an unchanged choice is not resent");
    assert.equal(server.trip[FIELD], true);
    assert.deepEqual(page.errors, []);

    const viewer = createFakeServer(fixtureTrip({ [FIELD]: true }), { editable: false });
    page = await loadPage({ server: viewer });
    assert.equal(page.doc.querySelector(`input[name="${FIELD}"]`), null, "viewers get no Google choice control");
    assert.ok(![...page.doc.querySelectorAll("#hosted-controls button")].some((button) => textOf(button) === "Edit trip"), "viewers get no Edit trip");
    assert.equal(page.doc.querySelectorAll(".timeline-item .icon-button").length, 0, "viewers get no plan editor");
  }

  // -------------------------------------------------------------------------------------------
  // F. Links in plan cards. Regression for the reported failure: a background refresh (here a poll
  //    with an unrelated remote edit) that arrives while a press on a card link is in progress used
  //    to rebuild the itinerary and detach the pressed anchor before its click; on the original code
  //    the isConnected assertions below fail. Now the rebuild waits until the activation is over.
  {
    const server = createFakeServer(fixtureTrip({ [FIELD]: true }));
    const page = await loadPage({ server });
    const { window, doc } = page;
    await setCardOpen(page, "plan-museum", true);
    const mapsLink = () => page.item("plan-museum").querySelector(".plan-location a.location-link, .timeline-card__actions a.google-maps-link");
    let anchor = mapsLink();
    assert.ok(anchor, "the plan has a Google Maps link");
    assert.equal(anchor.href, new URL(GOOGLE_URL).href, "the validated Maps URL is used unchanged");
    assert.deepEqual([anchor.target, anchor.rel], ["_blank", "noopener noreferrer"], "new tab, noopener noreferrer");

    // F1. Mouse (simulated): press, refresh arrives, release, click.
    pointer(page, anchor, "pointerdown"); mouse(page, anchor, "mousedown");
    remoteNote(server, "Remote note during mouse press");
    await poll(page);
    assert.equal(anchor.isConnected, true, "mouse: the pressed anchor is still in the document when the refresh arrives");
    assert.ok(!textOf(page.item("plan-cafe")).includes("Remote note during mouse press"), "the rebuild is deferred during the press");
    pointer(page, anchor, "pointerup"); mouse(page, anchor, "mouseup");
    mouse(page, anchor, "click");
    let activation = lastActivation(page, "click");
    assert.ok(activation.anchor === anchor && activation.connected && !activation.prevented, "mouse: the click reaches the original anchor and is not cancelled by the app");
    assert.equal(page.card("plan-museum").open, true, "clicking a link inside the card does not collapse it");
    await until(() => textOf(page.item("plan-cafe")).includes("Remote note during mouse press"), "deferred rebuild runs after the click");
    assert.equal(page.card("plan-museum").open, true, "the rebuild keeps the card open");

    // F2. Modified clicks (Ctrl, Meta, Shift): untouched by the app, never window.open.
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
      anchor = mapsLink();
      pointer(page, anchor, "pointerdown", { [modifier]: true }); mouse(page, anchor, "mousedown", { [modifier]: true });
      remoteNote(server, `Remote note during ${modifier}`);
      await poll(page);
      assert.equal(anchor.isConnected, true, `${modifier}: anchor kept during the press`);
      pointer(page, anchor, "pointerup", { [modifier]: true }); mouse(page, anchor, "mouseup", { [modifier]: true });
      mouse(page, anchor, "click", { [modifier]: true });
      activation = lastActivation(page, "click");
      assert.ok(activation.anchor === anchor && activation.connected && !activation.prevented, `${modifier}-click is left to the browser`);
      await until(() => textOf(page.item("plan-cafe")).includes(`Remote note during ${modifier}`), `${modifier}: deferred rebuild`);
    }

    // F3. Middle click / new tab (button 1, auxclick).
    anchor = mapsLink();
    pointer(page, anchor, "pointerdown", { button: 1 }); mouse(page, anchor, "mousedown", { button: 1 });
    remoteNote(server, "Remote note during middle click");
    await poll(page);
    assert.equal(anchor.isConnected, true, "middle button: anchor kept during the press");
    pointer(page, anchor, "pointerup", { button: 1 }); mouse(page, anchor, "mouseup", { button: 1 });
    mouse(page, anchor, "auxclick", { button: 1 });
    activation = lastActivation(page, "auxclick");
    assert.ok(activation.anchor === anchor && activation.connected && !activation.prevented && activation.button === 1, "auxclick reaches the original anchor, not cancelled");
    await until(() => textOf(page.item("plan-cafe")).includes("Remote note during middle click"), "middle: deferred rebuild");

    // F4. Keyboard: Enter on a focused link is the browser's activation; the app does not cancel it.
    anchor = mapsLink();
    anchor.focus();
    assert.equal(doc.activeElement, anchor);
    const enter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    anchor.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false, "Enter on a link is not cancelled");
    mouse(page, anchor, "click"); // the click a browser synthesizes for Enter (simulated)
    activation = lastActivation(page, "click");
    assert.ok(activation.anchor === anchor && !activation.prevented, "keyboard activation reaches the anchor");
    assert.equal(page.card("plan-museum").open, true);

    // F5. Other anchors in cards: OSM source, Commons licence/source credit, recommendation links.
    await setCardOpen(page, "plan-garden", true);
    // The day guide builds its body when opened; every rebuild recreates it, so links are looked up
    // fresh for each check (a link captured before a rebuild is no longer the one on screen).
    const ensureGuide = async () => {
      const current = doc.querySelector(".day-guide");
      if (!current.open) current.open = true;
      if (!current.querySelector(".day-guide__body")) current.dispatchEvent(new window.Event("toggle"));
      await until(() => doc.querySelector(".day-guide .day-guide__body"), "guide body");
    };
    await ensureGuide();
    const recommendationLink = (prefix) => [...doc.querySelectorAll(".recommendation-card a")].find((link) => link.href.startsWith(prefix));
    const others = [
      ["OSM source", () => page.item("plan-garden").querySelector(".place-source a"), "https://www.openstreetmap.org/way/3002"],
      ["photo licence", () => page.item("plan-garden").querySelector("a.photo-credit__license"), GARDEN_PHOTO.licenseUrl],
      ["photo source", () => page.item("plan-garden").querySelector("a.photo-credit__source"), GARDEN_PHOTO.sourceUrl],
      ["recommendation Maps", () => recommendationLink("https://www.google.com/maps/"), NOODLE_MAPS_URL],
      ["recommendation source", () => recommendationLink("https://example.org/"), "https://example.org/fictional-noodles"]
    ];
    for (const [label, find, href] of others) {
      await ensureGuide();
      const link = find();
      assert.ok(link, `${label}: link exists`);
      assert.equal(link.href, new URL(href).href, `${label}: href`);
      assert.deepEqual([link.target, link.rel], ["_blank", "noopener noreferrer"], `${label}: new tab, noopener noreferrer`);
      pointer(page, link, "pointerdown"); mouse(page, link, "mousedown");
      remoteNote(server, `Remote note during ${label}`);
      await poll(page);
      assert.equal(link.isConnected, true, `${label}: kept during the press`);
      pointer(page, link, "pointerup"); mouse(page, link, "mouseup"); mouse(page, link, "click");
      activation = lastActivation(page, "click");
      assert.ok(activation.anchor === link && activation.connected && !activation.prevented, `${label}: click reaches the original anchor`);
      await until(() => textOf(page.item("plan-cafe")).includes(`Remote note during ${label}`), `${label}: deferred rebuild`);
    }
    await ensureGuide();
    // Many deferred rebuilds ran during link presses: the museum and garden components were
    // released by them (never moved or re-connected) and nothing was reserved again by itself.
    assert.equal(page.reservations(), 2, "only the two explicit expansions (museum, garden) reserved");
    assert.deepEqual([page.google.constructed[DETAILS], page.google.reconnects, page.google.moveCalls], [2, [], 0], "re-renders during link presses build, re-connect and move nothing");
    // Unsafe URLs never become links.
    const allHrefs = [...doc.querySelectorAll("a[href]")].map((link) => link.getAttribute("href"));
    assert.ok(!allHrefs.some((href) => /^\s*(?:javascript|data|vbscript):/i.test(href)), "no javascript:, data: or vbscript: link anywhere");
    assert.ok(textOf(doc.querySelector(".day-guide__body")).includes("Invented Unsafe Link"), "the unsafe item is still listed as text");

    // F6. Ordinary card handling stays: the summary toggles the card; a map marker opens and
    //     selects its card. (Simulated clicks; jsdom implements <summary> activation.)
    const summary = page.card("plan-cafe").querySelector("summary");
    const before = page.card("plan-cafe").open;
    summary.click();
    await until(() => page.card("plan-cafe").open !== before, "summary toggles the card");
    summary.click();
    await until(() => page.card("plan-cafe").open === before, "and back");
    const marker = page.markers.filter((candidate) => candidate.options.title.includes("Invented Tide Garden")).at(-1);
    await setCardOpen(page, "plan-garden", false);
    marker.handlers.click();
    await until(() => page.card("plan-garden").open && page.item("plan-garden").classList.contains("is-map-selected"), "marker opens and selects its card");
    assert.equal(page.opened.length, 0, "links are never emulated with window.open");
    assert.deepEqual(page.errors, []);
  }

  // G. Phone sheet (simulated touch/pointer): a touch on a card link never starts the sheet drag
  //    and a refresh waits for the tap; the handle's own drag gesture still works.
  {
    const server = createFakeServer(fixtureTrip({ [FIELD]: true }));
    const page = await loadPage({ server, phone: true });
    const { doc } = page;
    assert.ok(doc.documentElement.classList.contains("is-itinerary-view"), "phone sheet view");
    await setCardOpen(page, "plan-museum", true);
    const anchor = page.item("plan-museum").querySelector(".plan-location a.location-link, .timeline-card__actions a.google-maps-link");
    pointer(page, anchor, "pointerdown", { pointerType: "touch" }); touch(page, anchor, "touchstart");
    pointer(page, page.window, "pointermove", { pointerType: "touch", clientY: 260 });
    assert.equal(doc.documentElement.classList.contains("is-sheet-dragging"), false, "a touch on a link never starts the sheet drag");
    remoteNote(server, "Remote note during touch");
    await poll(page);
    assert.equal(anchor.isConnected, true, "touch: the tapped anchor survives the refresh");
    pointer(page, anchor, "pointerup", { pointerType: "touch" }); touch(page, anchor, "touchend");
    mouse(page, anchor, "click");
    const activation = lastActivation(page, "click");
    assert.ok(activation.anchor === anchor && activation.connected && !activation.prevented, "touch: the click reaches the original anchor");
    await until(() => textOf(page.item("plan-cafe")).includes("Remote note during touch"), "touch: deferred rebuild");
    const handle = doc.getElementById("itinerary-sheet-handle");
    pointer(page, handle, "pointerdown", { pointerType: "touch" });
    assert.equal(doc.documentElement.classList.contains("is-sheet-dragging"), true, "the sheet handle still starts its own gesture");
    pointer(page, page.window, "pointerup", { pointerType: "touch" });
    assert.equal(doc.documentElement.classList.contains("is-sheet-dragging"), false, "and ends it");
    assert.equal(page.opened.length, 0);
    assert.deepEqual(page.errors, []);
  }

  // H. Phone width, outside the planner: the "Open interactive plan" anchor. Regression for a real
  //    browser report where Ctrl-click switched the CURRENT page to ?view=plan and opened no tab,
  //    because the click handler always called preventDefault(). Simulated clicks only: jsdom opens
  //    no tabs, so "left to the browser" is shown by the app not cancelling the event and not
  //    changing this page; the activation recorder then cancels jsdom's navigation.
  {
    const server = createFakeServer(fixtureTrip({ [FIELD]: true }));
    let page = await loadPage({ server, phone: true, planView: false });
    const planLink = () => page.doc.getElementById("open-plan-view");
    const inPlanner = () => page.doc.documentElement.classList.contains("is-itinerary-view");
    const viewParam = () => new URL(page.window.location.href).searchParams.get("view");
    const startHref = page.window.location.href;
    assert.equal(page.window.matchMedia("(max-width: 679px)").matches, true, "phone width");
    assert.ok(planLink(), "the plan launcher exists");
    assert.equal(viewParam(), null, "starts outside the planner");
    assert.equal(inPlanner(), false);
    const launcherHref = new URL(planLink().getAttribute("href"), page.window.location.href);
    assert.equal(launcherHref.searchParams.get("view"), "plan", "the launcher's href is the planner URL a new tab would open");
    assert.equal(launcherHref.searchParams.get("day"), DAY_ONE, "for the active day");

    const browserOwned = [
      ["Ctrl-click", "click", { ctrlKey: true }], ["Meta-click", "click", { metaKey: true }],
      ["Shift-click", "click", { shiftKey: true }], ["Alt-click", "click", { altKey: true }],
      ["middle-button click", "click", { button: 1 }], ["secondary-button click", "click", { button: 2 }],
      ["middle-button auxclick", "auxclick", { button: 1 }]
    ];
    for (const [label, type, options] of browserOwned) {
      const anchor = planLink();
      const count = page.activations.length;
      mouse(page, anchor, type, options);
      const activation = lastActivation(page, type);
      assert.ok(page.activations.length > count && activation.anchor === anchor && activation.connected, `${label}: the activation reaches the launcher anchor`);
      assert.equal(activation.prevented, false, `${label}: the app does not cancel it (the browser's own new tab/window/menu)`);
      await wait(30);
      assert.equal(page.window.location.href, startHref, `${label}: the current page does not change to ?view=plan`);
      assert.equal(inPlanner(), false, `${label}: the current page does not enter the planner`);
      assert.notEqual(page.window.history.state?.itineraryView, true, `${label}: no planner history entry`);
    }

    // Already cancelled by someone else: the app does not act on it either.
    {
      const anchor = planLink();
      const cancel = (event) => event.preventDefault();
      anchor.addEventListener("click", cancel, { capture: true, once: true });
      mouse(page, anchor, "click");
      await wait(30);
      assert.equal(viewParam(), null, "an already-cancelled click does not enter the planner");
      assert.equal(inPlanner(), false);
    }

    // Ordinary mouse/tap activation still enters the planner in place (same page, history entry).
    {
      const anchor = planLink();
      mouse(page, anchor, "click");
      const activation = lastActivation(page, "click");
      assert.ok(activation.anchor === anchor && activation.prevented, "plain click: the app handles it in place");
      await wait(30);
      assert.equal(viewParam(), "plan", "plain click: the planner URL");
      assert.equal(new URL(page.window.location.href).searchParams.get("day"), DAY_ONE);
      assert.equal(inPlanner(), true, "plain click: the planner is shown");
      assert.equal(page.window.history.state?.itineraryView, true, "plain click: a planner history entry");
    }

    // Keyboard: Enter on the focused launcher (the browser synthesizes a plain click; simulated).
    page = await loadPage({ server, phone: true, planView: false });
    {
      const anchor = planLink();
      anchor.focus();
      assert.equal(page.doc.activeElement, anchor);
      const enter = new page.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      anchor.dispatchEvent(enter);
      assert.equal(enter.defaultPrevented, false, "Enter is not cancelled");
      mouse(page, anchor, "click");
      await wait(30);
      assert.equal(viewParam(), "plan", "keyboard: the planner URL");
      assert.equal(inPlanner(), true, "keyboard: the planner is shown");
    }
    assert.equal(page.opened.length, 0, "the launcher is never emulated with window.open");
    assert.deepEqual(page.errors, []);
  }

  console.log("Trip page per-trip Google choice and link DOM simulation passed (mocked Google, simulated input): old-data/false/site-off trips make zero Google requests and show no Google controls; opted-in trips load lazily once without duplicates; a poll opt-out clears shown/pending components and searches, ignores late events, keeps associations and adds no Google work; re-enabling reuses the loader; a cancelled first load injects no script; accessible four-language Edit trip checkbox (sent only when changed, absent for viewers); card links (Maps, OSM, Commons credit, recommendations) keep their anchor through a refresh for mouse, Ctrl/Meta/Shift, middle-click, keyboard and touch, are never cancelled or window.open-ed; unsafe URLs stay text; summary toggling, marker selection and the sheet handle gesture still work; at phone width the Open interactive plan launcher leaves Ctrl/Meta/Shift/Alt/non-primary/already-cancelled clicks to the browser without changing the page, while plain click and Enter still enter the planner. No browser, device, SDK or billing claim.");
} finally {
  epoch += 1;
  timers.forEach(nativeClear);
  activeWindow?.close();
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClear;
  if (nativeNavigator) Object.defineProperty(globalThis, "navigator", nativeNavigator);
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
}
