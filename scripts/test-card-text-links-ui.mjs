#!/usr/bin/env node
// Trip page DOM simulation (jsdom) for card text links and plan location links. Everything is
// simulated and fictional:
//   - The trip API is an in-memory fictional server (viewer session, Google feature absent).
//   - Pointer, touch, mouse and keyboard input are SIMULATED synthetic DOM events. jsdom has no
//     layout, real touch, browser shortcuts or navigation: a window-level recorder notes each
//     activation and then cancels jsdom's unimplemented navigation.
//   - Desktop (1280 px, fine pointer) and phone (390 px, coarse pointer) are matchMedia emulation.
// This is UI/contract evidence only; it says nothing about a real browser, device or provider.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { MAPS_JS_URL } from "../assets/app-template/public/google-places-ui-kit.js";

const PUBLIC_DIR = fileURLToPath(new URL("../assets/app-template/public/", import.meta.url));
const ORIGIN = "http://fictional-trips.test";
const TRIP_ID = "fictional-harbour";
const DAY_ONE = "2031-06-10";
const clone = (value) => structuredClone(value);
const textOf = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

const GOOGLE_URL = "https://www.google.com/maps/place/Invented+Harbour+Museum,+1+Sample+Quay/data=!4m6!3m5!1s0x0:0x1!8m2!3d41.1!4d11.2!16s%2Fg%2Fsample";
const OSM_PLACE = {
  provider: "openstreetmap", id: "way/4004", name: "Invented Dune Park", address: "7 Sample Dunes, Fictional Bay", lat: 41.2, lng: 11.3,
  sourceUrl: "https://www.openstreetmap.org/way/4004", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", selectedAt: "2031-01-02T03:04:05.000Z"
};
const OSM_COORDINATE_URL = "https://www.google.com/maps/search/?api=1&query=41.2%2C11.3";

function fixtureTrip() {
  return {
    id: TRIP_ID, version: 1, archived: false, title: "Fictional Harbour Weekend", timezone: "UTC", country: "Fictionland", route: "Sample Bay",
    updatedAt: "2031-01-03T00:00:00.000Z", createdAt: "2031-01-01T00:00:00.000Z", dateRange: { start: DAY_ONE, end: "2031-06-11" },
    reminders: [], participantGroups: [], tips: [],
    hotelAreas: [{ area: "Fictional Harbour", reason: "Near the quay", options: [
      { name: "Invented Harbour Inn", tier: "planned", note: "Rooms: [Fictional rooms](https://example.org/rooms) (no booking)." }
    ] }],
    days: [
      { id: "day-one", date: DAY_ONE, theme: "Invented harbour day", slots: [
        { id: "plan-museum", name: "Invented Harbour Museum", period: "morning", time: "09:00", sortTime: "09:00", planType: "sight",
          googleMapsUrl: GOOGLE_URL, googleMapsPlaceName: "Invented Harbour Museum", address: "1 Sample Quay", lat: 41.1, lng: 11.2,
          review: "Tickets at https://tickets.example.org/museum?day=1&lang=en, or see [the fictional guide](https://example.org/guide_(museum)).",
          description: "Description: [Accessible entrance](https://example.org/entrance). Literal <img src=x onerror=alert(1)>.",
          notes: "Bring <b>cash</b> <script>alert(1)</script> javascript:alert(1) [x](javascript:alert(2)) ![photo](https://img.example.org/p.png)",
          i18n: { ja: { review: "チケットはhttps://tickets.example.org/ja。[架空ガイド](https://example.org/ja/guide)をご覧ください。", description: "説明：[入口](https://example.org/温泉)をご覧ください。", address: "サンプル埠頭1" } } },
        { id: "plan-park", name: "Invented Dune Park", period: "afternoon", time: "13:00", sortTime: "13:00", planType: "sight",
          place: clone(OSM_PLACE), lat: OSM_PLACE.lat, lng: OSM_PLACE.lng, address: OSM_PLACE.address,
          description: "Description-only https://example.org/park-info",
          notes: "Trail map: [Fictional trail](https://example.org/trail#start)." },
        { id: "plan-cafe", name: "Invented Corner Cafe", period: "evening", time: "18:00", sortTime: "18:00", planType: "restaurant",
          address: "3 Sample Lane", review: "Timeline-only placeholder", description: "Timeline-only placeholder" },
        { id: "plan-unsafe", name: "Invented Unsafe Pier", period: "evening", time: "20:00", sortTime: "20:00", planType: "sight",
          address: "9 Sample Pier", mapsUrl: "javascript:alert(1)", review: "https://user:pw@evil.example/ and //evil.example/x" },
        { id: "plan-lookalike", name: "Invented Lookalike Pier", period: "evening", time: "21:00", sortTime: "21:00", planType: "sight",
          address: "10 Sample Pier", googleMapsUrl: "https://evil.example/maps/place/Invented+Pier" }
      ], recommendations: {
        restaurants: [{ name: "Invented Noodle Bar", description: "Menu: https://example.org/noodles. Try the fictional broth." }]
      } },
      { id: "day-two", date: "2031-06-11", theme: "Invented ferry day", slots: [{ id: "plan-ferry", name: "Invented Ferry Ride", period: "morning", time: "10:00", planType: "transport" }] }
    ]
  };
}

function createFakeServer(initialTrip) {
  const server = { trip: clone(initialTrip), log: [], deny: 0 };
  const json = (status, payload) => ({ status, payload });
  server.remote = (mutate) => {
    const next = clone(server.trip);
    mutate(next);
    next.version += 1;
    next.updatedAt = new Date(Date.parse(server.trip.updatedAt) + 60000).toISOString();
    server.trip = next;
  };
  server.handle = async (method, url) => {
    server.log.push({ method, path: url.pathname });
    if (method === "GET" && url.pathname === "/api/session") {
      if (server.deny === 401) return json(401, { error: { code: "unauthorized", message: "Sign in required." } });
      return json(200, { authenticated: true, role: "viewer", capabilities: { editTrips: false } });
    }
    const match = /^\/api\/trips\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match || decodeURIComponent(match[1]) !== server.trip.id) return json(404, { error: { code: "not_found", message: "Not found." } });
    if (server.deny === 401) return json(401, { error: { code: "unauthorized", message: "Sign in required." } });
    if (server.deny === 403) return json(403, { error: { code: "forbidden", message: "Access revoked." } });
    if (method === "GET" && !match[2]) return json(200, { trip: clone(server.trip) });
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  return server;
}

// ---------------------------------------------------------------------------------------------
// Harness (same approach as test-trip-google-setting-and-links-ui.mjs).
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
  allFetches.push({ method, href: url.href });
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
function leafletStub(window) {
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
      const marker = {
        coordinates, options, element, handlers: {},
        addTo(group) { group.layers.push(this); doc.getElementById("map").append(element); return this; },
        bindPopup() { return this; }, getPopup() { return null; },
        on(name, handler) { this.handlers[name] = handler; return this; },
        getElement() { return element; }, setZIndexOffset() { return this; }
      };
      return marker;
    },
    polyline: () => ({ addTo(group) { group.layers.push(this); return this; } })
  };
}

const tempRoots = [];
let activeWindow = null;
async function loadPage({ server, phone = false }) {
  if (activeWindow) { epoch += 1; activeWindow.close(); }
  timers.forEach(nativeClear); timers.clear();
  currentServer = server;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-text-links-ui-"));
  tempRoots.push(root);
  const publicDir = path.join(root, "public");
  fs.cpSync(PUBLIC_DIR, publicDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8").replace("__TRIP_DATA_JSON__", "{}");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
  const dom = new JSDOM(html, { url: `${ORIGIN}/trips/${TRIP_ID}?day=${DAY_ONE}${phone ? "&view=plan" : ""}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
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
  const opened = [];
  window.open = (...args) => { opened.push(args); return null; };
  window.L = leafletStub(window);
  const mapElement = window.document.getElementById("map");
  Object.defineProperty(mapElement, "clientWidth", { configurable: true, get: () => (phone ? 390 : 760) });
  Object.defineProperty(mapElement, "clientHeight", { configurable: true, get: () => (phone ? 760 : 640) });
  // Google activity counters: any Maps script, any gmp-* element.
  const google = { scripts: [], created: [] };
  const originalCreate = window.document.createElement.bind(window.document);
  window.document.createElement = (tag, ...rest) => { const name = String(tag).toLowerCase(); if (name.startsWith("gmp-")) google.created.push(name); return originalCreate(tag, ...rest); };
  new window.MutationObserver((mutations) => {
    for (const mutation of mutations) for (const node of mutation.addedNodes) {
      if (node.localName === "script" && String(node.src).startsWith(MAPS_JS_URL)) google.scripts.push(node.src);
    }
  }).observe(window.document.documentElement, { childList: true, subtree: true });
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
  const activations = [];
  for (const type of ["click", "auxclick", "keydown"]) {
    window.addEventListener(type, (event) => {
      const anchor = event.composedPath().find((node) => node?.localName === "a" && node.hasAttribute?.("href")) || null;
      activations.push({ type, anchor, prevented: event.defaultPrevented, connected: Boolean(anchor?.isConnected), button: event.button });
      if (anchor && type !== "keydown") event.preventDefault();
    });
  }
  await import(`${pathToFileURL(path.join(publicDir, "hosted-bootstrap.js")).href}?v=__CACHE_VERSION__`);
  const doc = window.document;
  await until(() => !doc.querySelector(".hosted-boot") && doc.querySelector(".timeline-item"), "trip page ready");
  await wait(60);
  const page = { window, doc, errors, google, activations, opened };
  page.item = (id) => doc.querySelector(`.timeline-item[data-slot-id="${id}"]`);
  page.card = (id) => page.item(id)?.querySelector(".timeline-card");
  page.location = (id) => page.item(id)?.querySelector(".timeline-card__body .meta-list li:first-child");
  page.locationLink = (id) => page.location(id)?.querySelector("a.location-link") || null;
  page.mapAction = (id) => page.item(id)?.querySelector(".timeline-card__actions a.google-maps-link") || null;
  page.textLinks = (id, selector) => [...(page.item(id)?.querySelectorAll(`${selector} a.text-link`) || [])];
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
async function poll(page) {
  const before = currentServer.log.length;
  page.window.dispatchEvent(new page.window.Event("online"));
  await until(() => currentServer.log.slice(before).some((entry) => entry.method === "GET" && entry.path === `/api/trips/${TRIP_ID}`), "poll request");
  await wait(40);
}
function pointer(page, target, type, { button = 0, pointerType = "mouse", ...modifiers } = {}) {
  const Pointer = page.window.PointerEvent || page.window.MouseEvent;
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
  let event;
  try { event = new (page.window.TouchEvent || page.window.Event)(type, { bubbles: true, cancelable: true, composed: true }); }
  catch { event = new page.window.Event(type, { bubbles: true, cancelable: true, composed: true }); }
  target.dispatchEvent(event);
  return event;
}
const lastActivation = (page, type) => page.activations.filter((entry) => entry.type === type).at(-1);
const slotOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
const remoteNote = (server, note) => server.remote((trip) => { slotOf(trip, "plan-cafe").review = note; });
const lookupCalls = () => allFetches.filter(({ href }) => /\/google-places\/|\/places\/search|\/photos\/search/.test(new URL(href).pathname)
  || (!href.startsWith(`${ORIGIN}/api/`) && !href.startsWith("https://api.open-meteo.com/")));
const zeroGoogle = (page) => page.google.scripts.length === 0 && page.google.created.length === 0 && lookupCalls().length === 0;

function assertSafeAnchors(doc, label) {
  for (const anchor of doc.querySelectorAll(".timeline-card__body a, .recommendation-card a, .compact-card a")) {
    const href = anchor.getAttribute("href");
    assert.ok(/^https?:\/\//.test(href), `${label}: http(s) href only (${href})`);
    assert.ok(!/evil\.example|javascript:|data:|vbscript:/i.test(href), `${label}: no hostile href (${href})`);
    assert.deepEqual([anchor.target, anchor.rel], ["_blank", "noopener noreferrer"], `${label}: new tab, noopener noreferrer`);
  }
  assert.equal(doc.querySelectorAll(".timeline-card__body script, .timeline-card__body b, .timeline-card__body iframe").length, 0, `${label}: no element from text`);
  assert.equal(doc.querySelectorAll(".timeline-card__body img[src*='img.example.org']").length, 0, `${label}: image Markdown never becomes an image`);
}

// Press-and-hold on a link while a background refresh arrives; then complete the activation.
async function heldActivation(page, server, find, label, { modifiers = {}, button = 0, pointerType = "mouse", phone = false } = {}) {
  const anchor = find();
  assert.ok(anchor, `${label}: link exists`);
  const item = anchor.closest(".timeline-item");
  const card = item?.querySelector(".timeline-card");
  const wasOpen = card?.open;
  const wasSelected = item?.classList.contains("is-map-selected");
  let reachedItem = 0;
  item?.addEventListener("click", () => { reachedItem += 1; });
  item?.addEventListener("auxclick", () => { reachedItem += 1; });
  pointer(page, anchor, "pointerdown", { button, pointerType, ...modifiers });
  if (pointerType === "touch") touch(page, anchor, "touchstart"); else mouse(page, anchor, "mousedown", { button, ...modifiers });
  if (phone) {
    pointer(page, page.window, "pointermove", { pointerType, clientY: 260 });
    assert.equal(page.doc.documentElement.classList.contains("is-sheet-dragging"), false, `${label}: a press on a link never starts the sheet drag`);
  }
  const note = `Remote note during ${label}`;
  remoteNote(server, note);
  await poll(page);
  assert.equal(anchor.isConnected, true, `${label}: the held anchor survives the refresh`);
  assert.ok(!textOf(page.item("plan-cafe")).includes(note), `${label}: the rebuild waits for the activation`);
  pointer(page, anchor, "pointerup", { button, pointerType, ...modifiers });
  if (pointerType === "touch") touch(page, anchor, "touchend"); else mouse(page, anchor, "mouseup", { button, ...modifiers });
  const type = button === 1 ? "auxclick" : "click";
  const event = mouse(page, anchor, type, { button, ...modifiers });
  const activation = lastActivation(page, type);
  assert.ok(activation.anchor === anchor && activation.connected, `${label}: the ${type} reaches the original connected anchor`);
  assert.equal(activation.prevented, false, `${label}: the app never cancels the activation`);
  assert.equal(reachedItem, 1, `${label}: the event propagates natively through the card (not stopped)`);
  assert.ok(event.defaultPrevented, "fixture: the recorder cancelled jsdom navigation last");
  if (card) assert.equal(card.open, wasOpen, `${label}: activating a link does not toggle the card`);
  if (item) assert.equal(item.classList.contains("is-map-selected"), wasSelected, `${label}: activating a link does not change card/map selection`);
  await until(() => textOf(page.item("plan-cafe")).includes(note), `${label}: deferred rebuild afterwards`);
}

try {
  // -------------------------------------------------------------------------------------------
  // A. Desktop (emulated): rendering, location targets, localization, activation through refresh.
  {
    const server = createFakeServer(fixtureTrip());
    const page = await loadPage({ server });
    const { doc, window } = page;
    for (const id of ["plan-museum", "plan-park", "plan-cafe", "plan-unsafe", "plan-lookalike"]) await setCardOpen(page, id, true);

    // A1. Location line: same href as the validated map action, or plain text.
    for (const [id, expected] of [["plan-museum", new URL(GOOGLE_URL).href], ["plan-park", OSM_COORDINATE_URL]]) {
      const link = page.locationLink(id);
      const action = page.mapAction(id);
      assert.ok(link && action, `${id}: location link and map action exist`);
      assert.equal(link.href, action.href, `${id}: location href equals the existing map action href`);
      assert.equal(link.href, expected, `${id}: the validated destination`);
      assert.deepEqual([link.target, link.rel], ["_blank", "noopener noreferrer"]);
      const prefix = action.getAttribute("aria-label").split(": ")[0];
      assert.equal(link.getAttribute("aria-label"), `${prefix}: ${link.textContent}`, `${id}: localized accessible name`);
    }
    assert.equal(page.locationLink("plan-museum").textContent, "1 Sample Quay");
    assert.equal(page.mapAction("plan-museum").textContent.length > 0, true, "the map button is unchanged and still present");
    for (const id of ["plan-cafe", "plan-unsafe", "plan-lookalike"]) {
      assert.equal(page.locationLink(id), null, `${id}: no location link without a valid target`);
      assert.equal(page.mapAction(id), null, `${id}: and no map action either`);
      assert.equal(page.location(id).querySelector("a"), null, `${id}: plain location text`);
      assert.ok(page.location(id).textContent.includes(slotOf(fixtureTrip(), id).address), `${id}: address still shown`);
    }

    // A2. Text links in review, notes, recommendation description and hotel note.
    const reviewLinks = page.textLinks("plan-museum", ".timeline-card__review");
    assert.deepEqual(reviewLinks.map((link) => [link.textContent, link.href]), [
      ["https://tickets.example.org/museum?day=1&lang=en", "https://tickets.example.org/museum?day=1&lang=en"],
      ["the fictional guide", "https://example.org/guide_(museum)"]
    ], "raw URL (trailing comma excluded) and Markdown link with balanced parentheses");
    assert.ok(textOf(page.item("plan-museum").querySelector(".timeline-card__review")).endsWith(", or see the fictional guide."), "punctuation preserved as text; Markdown syntax replaced by its label");
    assert.ok(page.item("plan-museum").querySelector(".timeline-card__review").classList.contains("timeline-card__review"), "class retained");
    const description = page.item("plan-museum").querySelector(".timeline-card__description");
    assert.equal(description.querySelector("a").href, "https://example.org/entrance", "a distinct description renders a native link beside the review");
    assert.ok(description.textContent.includes("<img src=x onerror=alert(1)>"));
    assert.equal(description.querySelectorAll("img,script").length, 0, "hostile description stays text");
    assert.equal(page.textLinks("plan-park", ".timeline-card__description")[0].href, "https://example.org/park-info", "description-only plan renders its URL");
    assert.equal(page.item("plan-cafe").querySelectorAll(".timeline-card__description").length, 0, "identical review and description are not duplicated");
    const notes = page.item("plan-museum").querySelector(".note-line");
    assert.equal(notes.querySelectorAll("a").length, 0, "hostile notes produce no link");
    assert.equal(notes.children.length, 0, "and no element at all");
    assert.ok(notes.textContent.includes("<b>cash</b> <script>alert(1)</script>"), "HTML/script-looking notes are literal text");
    assert.ok(notes.textContent.includes("![photo](https://img.example.org/p.png)"), "image Markdown is literal text");
    assert.deepEqual(page.textLinks("plan-park", ".note-line").map((link) => [link.textContent, link.href]), [["Fictional trail", "https://example.org/trail#start"]]);
    assert.equal(page.textLinks("plan-unsafe", ".timeline-card__review").length, 0, "userinfo and protocol-relative text stays plain");
    const guide = doc.querySelector(".day-guide");
    guide.open = true;
    if (!guide.querySelector(".day-guide__body")) guide.dispatchEvent(new window.Event("toggle"));
    await until(() => doc.querySelector(".day-guide .day-guide__body"), "guide body");
    const recommendationLink = doc.querySelector(".recommendation-card__description a.text-link");
    assert.equal(recommendationLink?.href, "https://example.org/noodles", "recommendation description link (trailing period excluded)");
    const hotelLink = doc.querySelector(".compact-card--hotel a.text-link");
    assert.equal(hotelLink?.href, "https://example.org/rooms", "hotel note Markdown link");
    assert.equal(hotelLink.textContent, "Fictional rooms");
    assertSafeAnchors(doc, "desktop en");
    assert.ok(zeroGoogle(page), "desktop: zero Google scripts/components and zero place/photo lookups");

    // A3. Native activation through a background refresh: location, raw and Markdown text links.
    await heldActivation(page, server, () => page.locationLink("plan-museum"), "location link");
    await heldActivation(page, server, () => page.textLinks("plan-museum", ".timeline-card__review")[0], "raw review link");
    await heldActivation(page, server, () => page.textLinks("plan-park", ".note-line")[0], "Markdown notes link");
    for (const modifier of ["ctrlKey", "metaKey", "shiftKey"]) {
      await heldActivation(page, server, () => page.textLinks("plan-museum", ".timeline-card__review")[1], `${modifier} text link`, { modifiers: { [modifier]: true } });
    }
    await heldActivation(page, server, () => page.locationLink("plan-park"), "middle-click location link", { button: 1 });
    // Keyboard: Enter on a focused text link is not cancelled; the browser's synthesized click reaches it.
    const keyLink = page.textLinks("plan-museum", ".timeline-card__review")[0];
    keyLink.focus();
    assert.equal(doc.activeElement, keyLink);
    const enter = new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    keyLink.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, false, "Enter on a text link is not cancelled");
    mouse(page, keyLink, "click");
    assert.ok(lastActivation(page, "click").anchor === keyLink && !lastActivation(page, "click").prevented, "keyboard activation reaches the anchor");

    // The summary still toggles its own card.
    const summary = page.card("plan-cafe").querySelector("summary");
    const before = page.card("plan-cafe").open;
    summary.click();
    await until(() => page.card("plan-cafe").open !== before, "summary toggles the card");

    // A4. Localized text (ja): links inside Japanese text; location still matches the map action.
    const language = doc.getElementById("language-select");
    language.value = "ja"; language.dispatchEvent(new window.Event("change"));
    await until(() => textOf(page.item("plan-museum")?.querySelector(".timeline-card__review")).startsWith("チケットは"), "Japanese review");
    const jaLinks = page.textLinks("plan-museum", ".timeline-card__review");
    assert.deepEqual(jaLinks.map((link) => [link.textContent, link.href]), [
      ["https://tickets.example.org/ja", "https://tickets.example.org/ja"], ["架空ガイド", "https://example.org/ja/guide"]
    ], "links inside Japanese text; full-width punctuation stays text");
    assert.ok(textOf(page.item("plan-museum").querySelector(".timeline-card__review")).includes("。"), "Japanese punctuation preserved");
    assert.ok(textOf(page.item("plan-museum").querySelector(".timeline-card__description")).startsWith("説明："));
    assert.equal(page.textLinks("plan-museum", ".timeline-card__description")[0].href, new URL("https://example.org/温泉").href, "localized description preserves the complete Unicode destination");
    assert.equal(page.locationLink("plan-museum").textContent, "サンプル埠頭1", "localized address");
    assert.equal(page.locationLink("plan-museum").href, page.mapAction("plan-museum").href, "ja: location href still equals the map action");
    const jaPrefix = page.mapAction("plan-museum").getAttribute("aria-label").split(": ")[0];
    assert.equal(page.locationLink("plan-museum").getAttribute("aria-label"), `${jaPrefix}: サンプル埠頭1`, "ja: localized accessible name");
    assertSafeAnchors(doc, "desktop ja");
    assert.ok(zeroGoogle(page), "after language change: still zero Google/place/photo activity");
    assert.equal(page.opened.length, 0, "links are never emulated with window.open");
    assert.deepEqual(page.errors, []);
  }

  // -------------------------------------------------------------------------------------------
  // B. Phone (emulated): touch on text and location links never starts the sheet drag, survives a
  //    refresh, and the sheet handle still works.
  {
    const server = createFakeServer(fixtureTrip());
    const page = await loadPage({ server, phone: true });
    const { doc } = page;
    assert.ok(doc.documentElement.classList.contains("is-itinerary-view"), "phone sheet view");
    for (const id of ["plan-museum", "plan-park"]) await setCardOpen(page, id, true);
    assert.equal(page.locationLink("plan-park").href, page.mapAction("plan-park").href, "phone: OSM location link equals the map action");
    await heldActivation(page, server, () => page.textLinks("plan-museum", ".timeline-card__review")[1], "phone touch Markdown link", { pointerType: "touch", phone: true });
    await heldActivation(page, server, () => page.locationLink("plan-museum"), "phone touch location link", { pointerType: "touch", phone: true });
    const handle = doc.getElementById("itinerary-sheet-handle");
    pointer(page, handle, "pointerdown", { pointerType: "touch" });
    assert.equal(doc.documentElement.classList.contains("is-sheet-dragging"), true, "the sheet handle still starts its own gesture");
    pointer(page, page.window, "pointerup", { pointerType: "touch" });
    assertSafeAnchors(doc, "phone");
    assert.ok(zeroGoogle(page), "phone: zero Google/place/photo activity");
    assert.equal(page.opened.length, 0);
    assert.deepEqual(page.errors, []);
  }

  // -------------------------------------------------------------------------------------------
  // C. Permission loss while a text link is held. A refresh deferred by the press must never
  //    revive the page: a 401 clears the visible page at once; a 403 replaces the trip at once.
  {
    const server = createFakeServer(fixtureTrip());
    const page = await loadPage({ server });
    const { doc } = page;
    await setCardOpen(page, "plan-museum", true);
    const anchor = page.textLinks("plan-museum", ".timeline-card__review")[0];
    pointer(page, anchor, "pointerdown"); mouse(page, anchor, "mousedown");
    remoteNote(server, "Remote note that must never render");
    await poll(page);
    assert.equal(anchor.isConnected, true, "401 case: the first refresh is deferred by the held link");
    server.deny = 401;
    await poll(page);
    await until(() => !doc.querySelector(".timeline-item"), "401 clears protected UI immediately");
    assert.equal(anchor.isConnected, false, "401: the held link is removed with the protected page, without waiting for release");
    pointer(page, anchor, "pointerup"); mouse(page, anchor, "mouseup");
    await wait(600);
    assert.equal(doc.querySelector(".timeline-item"), null, "401: the deferred refresh never re-renders the trip");
    assert.ok(!textOf(doc.body).includes("Remote note that must never render"), "401: no protected text reappears");
  }
  {
    const server = createFakeServer(fixtureTrip());
    const page = await loadPage({ server });
    const { doc } = page;
    await setCardOpen(page, "plan-park", true);
    const anchor = page.locationLink("plan-park");
    pointer(page, anchor, "pointerdown"); mouse(page, anchor, "mousedown");
    server.deny = 403;
    await poll(page);
    await until(() => !doc.querySelector(".timeline-item"), "403 replaces the trip immediately");
    assert.ok(doc.querySelector("main .empty-state"), "403: the unavailable state is shown");
    assert.equal(anchor.isConnected, false, "403: the held location link is removed at once");
    pointer(page, anchor, "pointerup"); mouse(page, anchor, "mouseup");
    await wait(600);
    assert.equal(doc.querySelectorAll("main .timeline-item, main a.text-link, main a.location-link").length, 0, "403: nothing protected comes back after release");
    assert.ok(zeroGoogle(page), "permission loss: zero Google/place/photo activity");
  }

  assert.equal(lookupCalls().length, 0, "zero Google/place/photo lookup requests in the whole run");
  console.log("Card text link DOM simulation passed (jsdom, emulated desktop 1280 px and phone 390 px, simulated input, fictional data): location lines link to exactly the existing validated map-action URL (full Maps URL, OSM saved coordinates) and stay plain without a valid target; reviews, notes, recommendation descriptions and hotel notes render raw and Markdown links as native new-tab noopener anchors, with hostile/HTML/image text literal; Japanese text keeps links and localized names; mouse, Ctrl/Meta/Shift, middle-click, keyboard and touch activations reach the original anchor through a background refresh, propagate natively and do not toggle or select cards; the phone sheet handle still works; 401/403 during a held link clear protected UI at once; zero Google/place/photo lookups. No browser, device or provider claim.");
} finally {
  epoch += 1;
  timers.forEach(nativeClear);
  activeWindow?.close();
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClear;
  if (nativeNavigator) Object.defineProperty(globalThis, "navigator", nativeNavigator);
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
}
