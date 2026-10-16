// Trip-page DOM simulation of explicit place/photo matching in the self-hosted plan editor,
// plus map/itinerary selection linkage, using the real app modules, a Leaflet stub and an
// in-memory fictional trip API that follows the documented contract:
//   POST /api/trips/:id/places/search  and  /photos/search  body {query, refresh?}
//   -> {results: [], cached: boolean}; owner/content manager only.
// It does not start the real server (the search routes and plan.place validation are
// implemented separately), so it is UI evidence only: not backend, browser layout, gesture,
// device, provider or tile-availability evidence. All data is fictional.
// Each page load runs from a fresh temporary copy of the public assets so module state never
// leaks between the editor, reload, viewer, phone and static-generator scenarios.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  PICKER_KEYS,
  PICKER_LANGUAGES,
  createLookupController,
  lookupErrorKey,
  normalizePhotoCandidate,
  normalizePlaceCandidate,
  photoForSaving,
  pickerText,
  placeForSaving
} from "../assets/app-template/public/place-picker.js";

const PUBLIC_DIR = fileURLToPath(new URL("../assets/app-template/public/", import.meta.url));
const ORIGIN = "http://fictional-trips.test";
const TRIP_ID = "fictional-harbor";
const DAY_ONE = "2031-05-04";
const LANGUAGES = ["en", "zh-Hans", "zh-Hant", "ja"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// 1. Pure module checks: translations, sanitising, explicit/stale-safe controller.

assert.deepEqual([...PICKER_LANGUAGES].sort(), [...LANGUAGES].sort(), "picker text exists for the four app languages");
for (const language of LANGUAGES) {
  for (const key of PICKER_KEYS) {
    const value = pickerText(language, key, { count: 2, author: "A", license: "L" });
    assert.ok(value && value !== key && !/[{}]/.test(value), `${language}.${key} is translated`);
  }
}
for (const language of ["zh-Hans", "zh-Hant", "ja"]) {
  const translated = PICKER_KEYS.filter((key) => pickerText(language, key) !== pickerText("en", key));
  assert.ok(translated.length >= PICKER_KEYS.length - 2, `${language} is actually translated, not English copies`);
}
assert.ok(/OpenStreetMap/.test(pickerText("en", "placePrivacyNote")) && /booking/.test(pickerText("en", "placePrivacyNote")), "place search explains the outside service and what not to type");
assert.ok(/Wikimedia Commons/.test(pickerText("en", "photoPrivacyNote")));
assert.equal(lookupErrorKey({ status: 503, code: "lookup_disabled" }), "lookupDisabled");
assert.equal(lookupErrorKey({ status: 503, code: "lookup_busy" }), "lookupBusy");
assert.equal(lookupErrorKey({ status: 503, code: "lookup_unavailable" }), "lookupNetwork");
assert.equal(lookupErrorKey({ status: 504, code: "lookup_timeout" }), "lookupNetwork");
assert.equal(lookupErrorKey({ status: 502, code: "lookup_malformed" }), "lookupFailed");

assert.equal(normalizePlaceCandidate({ provider: "openstreetmap", id: "bogus/1", name: "X", lat: 1, lng: 1 }), null, "unknown OSM object types are rejected");
assert.equal(normalizePlaceCandidate({ provider: "openstreetmap", id: "node/1", name: "X", lat: "", lng: 1 }), null, "blank coordinates are rejected");
assert.equal(normalizePlaceCandidate({ provider: "google", id: "node/1", name: "X", lat: 1, lng: 1 }), null, "only OpenStreetMap places");
assert.equal(normalizePlaceCandidate({ provider: "openstreetmap", id: "relation/9", name: "X", lat: 1, lng: 1, sourceUrl: "javascript:alert(1)" }).sourceUrl,
  "https://www.openstreetmap.org/relation/9", "unsafe source links are replaced by the object's OpenStreetMap page");
assert.equal(normalizePhotoCandidate({ provider: "wikimedia-commons", url: "https://images.example.test/a.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:a.jpg", license: "CC0" }), null, "photos only from Wikimedia hosts");
assert.equal(normalizePhotoCandidate({ provider: "wikimedia-commons", url: "https://upload.wikimedia.org/a.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:a.jpg" }), null, "a licence is required");
const fixedNow = new Date("2031-01-01T00:00:00.000Z");
const fullCredit = {
  provider: "wikimedia-commons", url: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Fictional.jpg/640px-Fictional.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional.jpg", author: "A".repeat(300), credit: "C".repeat(500),
  license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/"
};
assert.equal(photoForSaving(fullCredit, fixedNow).author, fullCredit.author, "preserve the full allowed creator attribution");
assert.equal(photoForSaving(fullCredit, fixedNow).credit, fullCredit.credit, "preserve the full allowed credit");
assert.deepEqual(Object.keys(placeForSaving({ provider: "openstreetmap", id: "way/5", name: "Fictional Hall", address: "", lat: 1, lng: 2, extra: "x" }, fixedNow)).sort(),
  ["address", "attribution", "id", "lat", "license", "lng", "name", "provider", "selectedAt", "sourceUrl"]);
assert.deepEqual(Object.keys(photoForSaving({ provider: "wikimedia-commons", url: "https://upload.wikimedia.org/a.jpg", thumbnailUrl: "https://upload.wikimedia.org/t.jpg", title: "T", sourceUrl: "https://commons.wikimedia.org/wiki/File:a.jpg", author: "Sample", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }, fixedNow)).sort(),
  ["author", "credit", "license", "licenseUrl", "provider", "selectedAt", "sourceUrl", "url"], "preview-only fields are not saved");
{
  let calls = 0; let changes = 0; let release;
  const controller = createLookupController({
    request: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); },
    normalize: normalizePlaceCandidate,
    onChange: () => { changes += 1; }
  });
  assert.equal(calls, 0, "creating a lookup sends nothing");
  const pending = controller.search("Fictional Hall");
  assert.equal(calls, 1);
  assert.equal(await controller.search("Second query while busy"), false, "no overlapping request while busy");
  assert.equal(calls, 1);
  const changesBefore = changes;
  controller.dispose();
  release({ results: [{ provider: "openstreetmap", id: "node/1", name: "Late", lat: 1, lng: 1 }], cached: false });
  assert.equal(await pending, false, "a response after dispose is ignored");
  assert.equal(controller.state.results.length, 0);
  assert.equal(changes, changesBefore, "no re-render after dispose");
}

// ---------------------------------------------------------------------------
// 2. Fictional data and an in-memory API following the documented contract.

const clone = (value) => structuredClone(value);
const GOOGLE_URL = "https://www.google.com/maps/place/Invented+Lantern+Museum,+1+Sample+Quay/data=!4m6!3m5!1s0x0:0x1!8m2!3d40.1!4d10.2!16s%2Fg%2Fsample";
const PASTED_URL = "https://www.google.com/maps/place/Invented+Tide+Garden+Gate,+2+Sample+Lane/data=!4m6!3m5!1s0x0:0x2!8m2!3d40.3!4d10.4!16s%2Fg%2Fsample2";
const GARDEN_PLACE = {
  provider: "openstreetmap", id: "way/2002", name: "Invented Tide Garden", address: "5 Sample Promenade, Fictional Bay",
  lat: 40.2, lng: 10.3, sourceUrl: "https://www.openstreetmap.org/way/2002", attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0", selectedAt: "2031-01-02T03:04:05.000Z"
};
const GARDEN_PHOTO = {
  provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_garden.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_garden.jpg", credit: "Sample Photographer · CC BY-SA 4.0",
  author: "Sample Photographer", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  selectedAt: "2031-01-02T03:04:06.000Z"
};
const PIER_PHOTO = {
  url: "https://upload.wikimedia.org/wikipedia/commons/c/cd/Fictional_pier.jpg",
  credit: "Sample Archive, CC BY 4.0", sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_pier.jpg"
};
const MUSEUM_RESULT = {
  provider: "openstreetmap", id: "node/3001", name: "Invented Lantern Museum", address: "1 Sample Quay, Fictional Bay",
  lat: 40.11, lng: 10.21, sourceUrl: "https://www.openstreetmap.org/node/3001", attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0", providerRank: 0.7
};
const ANNEX_RESULT = {
  provider: "openstreetmap", id: "way/3002", name: "Invented Lantern Museum Annex <b>bold</b>", address: "3 Sample Quay, Fictional Bay",
  lat: 40.12, lng: 10.22, sourceUrl: "https://www.openstreetmap.org/way/3002", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0"
};
const PIER_RESULT = {
  provider: "openstreetmap", id: "relation/4004", name: "Invented Old Pier", address: "Old Pier Road, Fictional Bay",
  lat: 40.06, lng: 10.16, sourceUrl: "https://www.openstreetmap.org/relation/4004", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0"
};
const PHOTO_ONE = {
  provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/e/ef/Fictional_cafe.jpg",
  thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ef/Fictional_cafe.jpg/320px-Fictional_cafe.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_cafe.jpg", title: "Fictional cafe interior",
  author: "Sample Author <img src=x onerror=alert(1)>", license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/", credit: "Sample Author, CC BY 4.0"
};
const PHOTO_TWO = {
  provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/1/12/Fictional_counter.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_counter.jpg", author: "Sample Studio", license: "CC0"
};
const PHOTO_BAD_HOST = {
  provider: "wikimedia-commons", url: "https://images.example.test/x.jpg", sourceUrl: "https://commons.wikimedia.org/wiki/File:x.jpg", license: "CC0"
};

function fixtureTrip() {
  return {
    id: TRIP_ID, version: 7, archived: false, title: "Fictional Harbor Weekend", timezone: "UTC", country: "Fictionland",
    route: "Sample Bay", updatedAt: "2031-01-03T00:00:00.000Z", createdAt: "2031-01-01T00:00:00.000Z",
    dateRange: { start: DAY_ONE, end: "2031-05-05" }, reminders: [], participantGroups: [], tips: [],
    days: [
      { id: "day-one", date: DAY_ONE, theme: "Invented harbor day", slots: [
        {
          id: "plan-museum", name: "Invented Lantern Museum", period: "morning", time: "09:00", sortTime: "09:00", planType: "sight",
          review: "Fictional lantern exhibits", googleMapsUrl: GOOGLE_URL, googleMapsPlaceName: "Invented Lantern Museum",
          googleMapsPlaceLabel: "Invented Lantern Museum, 1 Sample Quay", googleMapsFeatureId: "0x0:0x1", address: "1 Sample Quay",
          lat: 40.1, lng: 10.2, approximateLocation: false, i18n: { ja: { name: "架空のランタン博物館", address: "架空の住所" } }
        },
        {
          id: "plan-garden", name: "Invented Tide Garden", period: "morning", time: "11:00", sortTime: "11:00", planType: "sight",
          review: "Fictional rock pools", place: clone(GARDEN_PLACE), address: GARDEN_PLACE.address, lat: GARDEN_PLACE.lat,
          lng: GARDEN_PLACE.lng, approximateLocation: false, photo: clone(GARDEN_PHOTO)
        },
        {
          id: "plan-pier", name: "Invented Old Pier", period: "noon", time: "13:00", sortTime: "13:00", planType: "sight",
          review: "Legacy coordinates only", address: "Old pier road", lat: 40.05, lng: 10.15, photo: clone(PIER_PHOTO)
        },
        {
          id: "plan-cafe", name: "Invented Corner Cafe", period: "evening", time: "18:00", sortTime: "18:00", planType: "restaurant",
          review: "Timeline-only placeholder", photoSourceId: "plan-pier"
        }
      ] },
      { id: "day-two", date: "2031-05-05", theme: "Invented ferry day", slots: [
        { id: "plan-ferry", name: "Invented Ferry Ride", period: "morning", time: "10:00", planType: "transport" }
      ] }
    ]
  };
}

function createFakeServer(initialTrip) {
  const server = { trip: clone(initialTrip), editable: true, log: [], respond: { place: null, photo: null }, failNextChange: false, requestIds: new Map() };
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
      return json(200, { authenticated: true, role: server.editable ? "content-manager" : "viewer", capabilities: { editTrips: server.editable } });
    }
    const match = /^\/api\/trips\/([^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match || decodeURIComponent(match[1]) !== server.trip.id) return json(404, { error: { code: "not_found", message: "Not found." } });
    const rest = match[2] || "";
    if (method === "GET" && !rest) return json(200, { trip: clone(server.trip) });
    if (method === "POST" && rest === "/changes") {
      if (!server.editable) return json(403, { error: { code: "forbidden", message: "Editing access required." } });
      if (server.failNextChange) { server.failNextChange = false; throw new TypeError("Simulated network failure"); }
      if (server.requestIds.has(body.requestId)) return json(200, { trip: clone(server.requestIds.get(body.requestId)) });
      if (body.expectedVersion !== server.trip.version) return json(409, { error: { code: "version_conflict", message: "Version conflict." } });
      assert.equal(body.changes.length, 1); assert.equal(body.changes[0].type, "replace_content");
      const next = { ...clone(body.changes[0].trip), id: server.trip.id, version: server.trip.version + 1, archived: false,
        updatedAt: new Date(Date.parse(server.trip.updatedAt) + 60000).toISOString() };
      server.trip = next; server.requestIds.set(body.requestId, next);
      return json(200, { trip: clone(next) });
    }
    if (method === "POST" && (rest === "/places/search" || rest === "/photos/search")) {
      if (!server.editable) return json(403, { error: { code: "forbidden", message: "Editing access required." } });
      const responder = server.respond[rest.startsWith("/places") ? "place" : "photo"];
      if (!responder) return json(503, { error: { code: "lookup_disabled", message: "Lookup is not configured." } });
      return responder(body);
    }
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  return server;
}

// ---------------------------------------------------------------------------
// 3. Page harness: timers, fetch, media queries, Leaflet stub, fresh module graph per load.

const nativeTimeout = globalThis.setTimeout;
const nativeClear = globalThis.clearTimeout;
const nativeFetch = globalThis.fetch;
const nativeNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const timers = new Set();
let epoch = 0;
// Request timeouts and the 20-second background poll never fire; polls are triggered
// explicitly with the online event so request counts stay deterministic.
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

const sleep = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
async function until(predicate, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await sleep(5);
  }
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const ok = (payload) => ({ status: 200, payload });

function mediaMatches(query, viewport) {
  return String(query).split(",").some((part) => part.split(/\band\b/).every((condition) => {
    const match = /\(\s*([a-z-]+)\s*:\s*([^)]+?)\s*\)/.exec(condition);
    if (!match) return false;
    const [, feature, raw] = match; const value = parseFloat(raw);
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

function leafletStub(window, record) {
  const doc = window.document;
  const point = (x, y) => ({ x, y, add(other) { return point(x + other.x, y + other.y); } });
  return {
    map() {
      record.maps += 1;
      const map = {
        attributionControl: { setPrefix() {} },
        invalidateSize() {}, stop() {},
        setView(center, zoom) { record.views.push({ center, zoom }); return map; },
        fitBounds(bounds) { record.fits.push(bounds); return map; },
        project([lat, lng]) { return point(lng * 1000, -lat * 1000); },
        unproject(projected) { return [-projected.y / 1000, projected.x / 1000]; },
        eachLayer(fn) { (map.tripLayers?.layers || []).forEach(fn); }
      };
      return map;
    },
    control: { zoom: () => ({ addTo() { return this; }, getContainer: () => ({ querySelectorAll: () => [doc.createElement("a"), doc.createElement("a")] }) }) },
    tileLayer(url, options) { record.tiles.push({ url, attribution: options?.attribution || "" }); return { addTo() { return this; } }; },
    layerGroup: () => ({ layers: [], addTo() { return this; }, clearLayers() { this.layers.forEach((layer) => layer.element?.remove()); this.layers = []; } }),
    point,
    latLngBounds: (points) => points,
    divIcon: (options) => options,
    marker(coordinates, options) {
      const element = doc.createElement("div");
      element.className = options.icon.className;
      element.innerHTML = options.icon.html;
      element.title = options.title || "";
      return {
        kind: "marker", coordinates, options, element, handlers: {}, zIndex: 0, popup: "",
        addTo(group) { group.layers.push(this); doc.getElementById("map").append(element); return this; },
        bindPopup(content) { this.popup = content; return this; },
        getPopup() { return null; },
        on(name, handler) { this.handlers[name] = handler; return this; },
        getElement() { return element; },
        setZIndexOffset(value) { this.zIndex = value; return this; }
      };
    },
    polyline: () => ({ kind: "polyline", addTo(group) { group.layers.push(this); return this; } })
  };
}

const tempRoots = [];
let activeWindow = null;
async function loadPage({ server, query = `?day=${DAY_ONE}`, phone = false, hosted = true, seed = null }) {
  if (activeWindow) { epoch += 1; activeWindow.close(); }
  timers.forEach(nativeClear); timers.clear();
  currentServer = server;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-place-picker-"));
  tempRoots.push(root);
  const publicDir = path.join(root, "public");
  fs.cpSync(PUBLIC_DIR, publicDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  if (!hosted) {
    const configFile = path.join(publicDir, "firebase-config.js");
    fs.writeFileSync(configFile, fs.readFileSync(configFile, "utf8")
      .replace("__FIREBASE_CONFIG_JSON__", "{}").replace("__FIRESTORE_DOCUMENT_PATH_JSON__", JSON.stringify("trips/unused")));
  }
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8")
    .replace("__TRIP_DATA_JSON__", hosted ? "{}" : JSON.stringify(seed).replace(/</g, "\\u003c"));
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
  const pathname = hosted ? `/trips/${TRIP_ID}` : "/";
  const dom = new JSDOM(html, { url: `${ORIGIN}${pathname}${query}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  activeWindow = window;
  if (hosted) window.SHARED_TRIP_HOSTED = true;
  const viewport = phone ? { width: 390, height: 760, pointer: "coarse" } : { width: 1280, height: 820, pointer: "fine" };
  const record = { maps: 0, tiles: [], views: [], fits: [], scrolledIntoView: [], scrolledPanels: [] };
  window.matchMedia = (media) => ({ matches: mediaMatches(media, viewport), media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  window.HTMLElement.prototype.scrollIntoView = function () { record.scrolledIntoView.push(this.dataset?.slotId || this.id || ""); };
  window.HTMLElement.prototype.scrollTo = function () { record.scrolledPanels.push(this.id || ""); };
  window.scrollTo = () => {}; window.scrollBy = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { if (!this.open) return; this.open = false; this.dispatchEvent(new window.Event("close")); };
  window.L = leafletStub(window, record);
  const mapElement = window.document.getElementById("map");
  Object.defineProperty(mapElement, "clientWidth", { configurable: true, get: () => (phone ? 390 : 760) });
  Object.defineProperty(mapElement, "clientHeight", { configurable: true, get: () => (phone ? 760 : 640) });
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
  const entry = `${pathToFileURL(path.join(publicDir, hosted ? "hosted-bootstrap.js" : "app.js")).href}?v=__CACHE_VERSION__`;
  await import(entry);
  const doc = window.document;
  await until(() => !doc.querySelector(".hosted-boot") && doc.querySelector(".timeline-item"), "trip page ready");
  await sleep(60);
  const page = { window, doc, record, errors };
  page.item = (id) => doc.querySelector(`.timeline-item[data-slot-id="${id}"]`);
  page.markers = () => [...doc.querySelectorAll("#map .route-pin")];
  page.panel = (kind) => doc.getElementById(`${kind}-lookup`);
  page.input = (kind) => page.panel(kind).querySelector(".lookup-search__input");
  page.button = (kind, action) => page.panel(kind).querySelector(`[data-lookup-action="${action}"]`);
  page.status = (kind) => page.panel(kind).querySelector(".lookup-status");
  page.results = (kind) => [...page.panel(kind).querySelectorAll(".lookup-result")];
  page.current = (kind) => page.panel(kind).querySelector(".lookup-current");
  page.dialog = () => doc.getElementById("item-dialog");
  page.form = () => doc.getElementById("item-form");
  return page;
}

// Marker DOM node for a plan, matched by the marker title ("<number>. <plan name>").
function markerFor(page, slotId) {
  const title = page.item(slotId)?.querySelector(".timeline-card__title")?.textContent;
  return [...page.doc.querySelectorAll("#map .route-pin")].find((node) => node.title.endsWith(`. ${title}`)) || null;
}

const searchLog = () => currentServer.log.filter((entry) => /\/(?:places|photos)\/search$/.test(entry.path));
const slotOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
const textOf = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

function typeInto(window, input, text) {
  input.value = "";
  for (const character of text) {
    input.value += character;
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: character, bubbles: true }));
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keyup", { key: character, bubbles: true }));
  }
  input.dispatchEvent(new window.Event("change", { bubbles: true }));
}

async function setCardOpen(page, slotId, open) {
  const card = page.item(slotId).querySelector(".timeline-card");
  if (card.open === open) return;
  let fired = false;
  card.addEventListener("toggle", () => { fired = true; }, { once: true });
  card.open = open;
  try { await until(() => fired, "details toggle", 400); } catch { card.dispatchEvent(new page.window.Event("toggle")); }
  await sleep(10);
}

async function openEditor(page, slotId) {
  const edit = page.item(slotId)?.querySelector(".icon-button");
  assert.ok(edit, `edit control for ${slotId}`);
  edit.click();
  await until(() => page.dialog().open, `editor for ${slotId}`);
}

async function cancelEditor(page) {
  page.form().querySelector(".dialog-actions [data-close-dialog]").click();
  await until(() => !page.dialog().open, "editor closed");
}

async function saveEditor(page, { expectSaved = true } = {}) {
  const version = currentServer.trip.version;
  page.form().dispatchEvent(new page.window.Event("submit", { bubbles: true, cancelable: true }));
  if (expectSaved) {
    await until(() => currentServer.trip.version === version + 1 && !page.dialog().open, "plan saved");
    await sleep(40);
  } else {
    await sleep(80);
  }
}

async function clickSearch(page, kind, query) {
  if (query !== undefined) typeInto(page.window, page.input(kind), query);
  page.button(kind, "search").click();
}

function popupHref(marker) {
  return /href="([^"]+)"/.exec(marker.popup)?.[1]?.replace(/&amp;/g, "&") || "";
}

// ---------------------------------------------------------------------------
// 4. Scenarios.

const server = createFakeServer(fixtureTrip());
let expectedSearches = 0;
try {
  // A. Desktop editor (content manager) in English.
  let page = await loadPage({ server });
  let { doc, window, record } = page;

  // A0. Normal view: no lookup, saved place/photo credits, map attribution and coordinates.
  assert.equal(searchLog().length, 0, "opening the trip sends no lookup");
  assert.ok(server.log.every((entry) => entry.method === "GET"), "the normal view only reads the trip and session");
  assert.ok(allFetches.every((href) => href.includes(`${ORIGIN}/api/`)), "no outside request from rendering");
  assert.equal(doc.querySelector(".lookup-panel"), null, "no lookup controls before an editor opens");
  const gardenSource = page.item("plan-garden").querySelector(".place-source");
  assert.ok(gardenSource, "saved place shows its source");
  assert.equal(gardenSource.querySelector("a").href, GARDEN_PLACE.sourceUrl);
  assert.ok(textOf(gardenSource).includes("© OpenStreetMap contributors · ODbL-1.0"));
  const gardenCredit = page.item("plan-garden").querySelector(".photo-credit--licensed");
  assert.ok(gardenCredit && textOf(gardenCredit).includes("Photo: Sample Photographer"), "licensed photo credit is visible");
  assert.equal(gardenCredit.querySelector(".photo-credit__license").href, GARDEN_PHOTO.licenseUrl);
  assert.equal(gardenCredit.querySelector(".photo-credit__source").href, GARDEN_PHOTO.sourceUrl);
  const gardenImage = page.item("plan-garden").querySelector(".location-photo img");
  assert.ok(gardenImage.src.includes("/thumb/") && gardenImage.src.includes("500px-Fictional_garden.jpg") && gardenImage.loading === "lazy", "bounded lazy thumbnail");
  assert.ok(page.item("plan-pier").querySelector(".location-photo img").src.includes("500px-Fictional_pier.jpg"), "existing photo records still render");
  assert.equal(page.item("plan-pier").querySelector(".photo-credit--licensed"), null);
  assert.ok(page.item("plan-cafe").querySelector(".location-photo img"), "linked legacy photo still renders before any change");
  const credits = [...doc.querySelectorAll("#credits-list a")].map((link) => [link.textContent, link.href]);
  assert.ok(credits.some(([label, href]) => label === "Place data © OpenStreetMap contributors (ODbL)" && href === "https://www.openstreetmap.org/copyright"));
  assert.ok(credits.some(([label]) => label === "Invented Old Pier — Sample Archive, CC BY 4.0"));
  assert.equal(record.maps, 1);
  assert.ok(record.tiles[0].attribution.includes("openstreetmap.org/copyright"), "OSM map attribution stays");
  assert.equal(page.markers().length, 3, "museum, garden and pier are mapped; the timeline-only cafe is not");
  assert.ok(markerFor(page, "plan-garden") && !markerFor(page, "plan-cafe"), "markers follow saved coordinates");

  // A1. Map and card selection in both directions (desktop). The stub records each marker's
  // click handler and popup; markers are captured on the next re-render (a language round trip).
  const markerByNode = new Map();
  const originalMarker = window.L.marker;
  window.L.marker = (coordinates, options) => {
    const marker = originalMarker(coordinates, options);
    markerByNode.set(marker.element, marker);
    return marker;
  };
  const language = doc.getElementById("language-select");
  language.value = "ja"; language.dispatchEvent(new window.Event("change"));
  language.value = "en"; language.dispatchEvent(new window.Event("change"));
  await sleep(40);
  assert.equal(record.maps, 1, "language changes reuse the map instance");
  const stubMarker = (slotId) => markerByNode.get(markerFor(page, slotId));
  assert.ok(stubMarker("plan-garden") && stubMarker("plan-museum"), "markers captured");
  assert.match(popupHref(stubMarker("plan-garden")), /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=40\.2%2C10\.3$/, "coordinate navigation for a chosen place");
  assert.ok(!/!1s|place_id/.test(popupHref(stubMarker("plan-garden"))), "no invented Google place identifier");
  assert.equal(popupHref(stubMarker("plan-museum")), GOOGLE_URL, "stored full Google link is kept");
  assert.equal(page.item("plan-garden").querySelector(".plan-location .location-link").href, "https://www.google.com/maps/search/?api=1&query=40.2%2C10.3");

  stubMarker("plan-garden").handlers.click();
  await until(() => page.item("plan-garden").classList.contains("is-map-selected"), "marker selects its card");
  assert.ok(page.item("plan-garden").querySelector(".timeline-card").open, "marker opens the matching card");
  assert.equal(page.item("plan-garden").getAttribute("aria-current"), "true");
  assert.ok(markerFor(page, "plan-garden").classList.contains("is-selected"), "selected marker styling");
  assert.ok(record.scrolledIntoView.includes("plan-garden"), "desktop scrolls the card into view");
  assert.equal(stubMarker("plan-garden").zIndex, 1000);
  const viewsBefore = record.views.length;
  await setCardOpen(page, "plan-museum", true);
  await until(() => page.item("plan-museum").classList.contains("is-map-selected"), "opening a card selects it");
  assert.ok(markerFor(page, "plan-museum").classList.contains("is-selected"), "opening a card highlights its marker");
  assert.ok(!markerFor(page, "plan-garden").classList.contains("is-selected") && !page.item("plan-garden").classList.contains("is-map-selected"), "one selection at a time");
  assert.ok(record.views.length > viewsBefore, "opening a card focuses the map on it");
  await setCardOpen(page, "plan-museum", false);
  await until(() => !doc.querySelector(".timeline-item.is-map-selected") && !doc.querySelector("#map .route-pin.is-selected"), "closing the card clears the selection");
  await setCardOpen(page, "plan-garden", false);

  // A2. Opening an editor, typing and cancelling sends nothing and changes nothing.
  const versionAtStart = server.trip.version;
  await openEditor(page, "plan-garden");
  assert.ok(page.panel("place") && page.panel("photo"), "lookup controls exist for editors");
  assert.ok(textOf(page.current("place")).includes("Saved place") && textOf(page.current("place")).includes("Invented Tide Garden"), "saved place shown without searching");
  assert.ok(textOf(page.current("place")).includes("5 Sample Promenade, Fictional Bay") && textOf(page.current("place")).includes("Coordinates: 40.2, 10.3"));
  assert.equal(page.current("place").querySelector("a").href, GARDEN_PLACE.sourceUrl);
  assert.ok(textOf(page.current("photo")).includes("Current photo") && textOf(page.current("photo")).includes("License: CC BY-SA 4.0"));
  assert.ok(textOf(page.panel("place")).includes(pickerText("en", "placePrivacyNote")), "privacy explanation beside the search");
  assert.equal(page.input("place").value, "", "the search box is never prefilled from trip content");
  assert.equal(page.input("place").getAttribute("aria-describedby"), "place-lookup-privacy");
  assert.equal(page.status("place").getAttribute("role"), "status");
  typeInto(window, page.input("place"), "Invented Tide Garden");
  typeInto(window, page.input("photo"), "rock pools");
  typeInto(window, page.form().elements.name, "Invented Tide Garden Renamed");
  page.form().elements.time.value = "12:00"; page.form().elements.time.dispatchEvent(new window.Event("change", { bubbles: true }));
  await sleep(60);
  assert.equal(searchLog().length, 0, "typing never searches");
  await cancelEditor(page);
  assert.equal(server.trip.version, versionAtStart, "cancel leaves the trip unchanged");
  assert.ok(server.log.every((entry) => entry.method === "GET"), "no write or lookup after cancel");

  // A3. Explicit place search with busy state, explicit choice, refresh, network retry and save.
  await openEditor(page, "plan-museum");
  assert.ok(textOf(page.current("place")).includes(pickerText("en", "usingGoogleLink")), "existing Google link remains the location");
  assert.ok(page.current("place").querySelector(".lookup-current__clear"), "clear location is available");
  const firstResponse = deferred();
  server.respond.place = () => firstResponse.promise;
  await clickSearch(page, "place", "Invented Lantern Museum");
  expectedSearches += 1;
  assert.equal(page.button("place", "search").disabled, true, "search button is disabled while busy");
  assert.equal(page.panel("place").getAttribute("aria-busy"), "true");
  assert.equal(page.status("place").textContent, "Searching…");
  page.button("place", "search").click();
  page.input("place").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await until(() => searchLog().length === 1, "one place search request");
  await sleep(30);
  assert.equal(searchLog().length, expectedSearches, "a busy search cannot be repeated");
  assert.equal(searchLog()[0].path, `/api/trips/${TRIP_ID}/places/search`);
  assert.deepEqual(searchLog()[0].body, { query: "Invented Lantern Museum" }, "only the typed public name is sent");
  firstResponse.resolve(ok({ cached: false, results: [MUSEUM_RESULT, ANNEX_RESULT,
    { provider: "openstreetmap", id: "bogus/1", name: "Broken", lat: 1, lng: 1 },
    { provider: "elsewhere", id: "node/9", name: "Other provider", lat: 1, lng: 1 }] }));
  await until(() => page.results("place").length === 2, "place results");
  assert.equal(page.status("place").textContent, "Places found: 2. Choose the right one.");
  assert.equal(page.button("place", "search").disabled, false);
  assert.equal(page.panel("place").getAttribute("aria-busy"), null);
  const [museumRow, annexRow] = page.results("place");
  assert.ok(textOf(museumRow).includes("Invented Lantern Museum") && textOf(museumRow).includes("1 Sample Quay, Fictional Bay") && textOf(museumRow).includes("Coordinates: 40.11, 10.21"));
  assert.equal(museumRow.querySelector("a").href, MUSEUM_RESULT.sourceUrl);
  assert.ok(textOf(museumRow).includes("© OpenStreetMap contributors · ODbL-1.0"), "OSM attribution beside each candidate");
  assert.ok(textOf(annexRow).includes("Annex <b>bold</b>") && !annexRow.querySelector("b"), "provider text is plain text");
  assert.ok(page.results("place").every((row) => row.querySelector("button").getAttribute("aria-pressed") === "false"), "nothing is chosen automatically");
  assert.equal(page.form().elements.googleMapsUrl.value, GOOGLE_URL, "results alone do not replace the location");
  assert.equal(server.trip.version, versionAtStart);
  annexRow.querySelector("button").click();
  assert.equal(annexRow.querySelector("button").getAttribute("aria-pressed"), "true");
  assert.equal(page.form().elements.googleMapsUrl.value, "", "choosing a place replaces the Google link in the form");
  museumRow.querySelector("button").click();
  assert.equal(museumRow.querySelector("button").getAttribute("aria-pressed"), "true");
  assert.equal(annexRow.querySelector("button").getAttribute("aria-pressed"), "false");
  assert.ok(textOf(page.current("place")).includes("Chosen place") && textOf(page.current("place")).includes("Invented Lantern Museum"));
  assert.equal(page.status("place").textContent, "Place chosen. Save the plan to keep it.");
  assert.equal(server.trip.version, versionAtStart, "choosing alone does not save");
  server.respond.place = () => ok({ cached: false, results: [MUSEUM_RESULT, ANNEX_RESULT] });
  assert.equal(page.button("place", "refresh").hidden, false);
  page.button("place", "refresh").click();
  expectedSearches += 1;
  await until(() => searchLog().length === expectedSearches && !page.panel("place").hasAttribute("aria-busy"), "refresh results");
  assert.deepEqual(searchLog().at(-1).body, { query: "Invented Lantern Museum", refresh: true }, "refresh asks for fresh results explicitly");
  assert.equal(page.results("place")[0].querySelector("button").getAttribute("aria-pressed"), "true", "the choice survives a refresh");
  server.failNextChange = true;
  await saveEditor(page, { expectSaved: false });
  assert.ok(page.dialog().open, "a failed save keeps the editor open");
  assert.ok(textOf(page.current("place")).includes("Chosen place"), "the choice survives a network failure");
  assert.equal(server.trip.version, versionAtStart);
  const beforeSave = clone(server.trip);
  await saveEditor(page);
  const museum = slotOf(server.trip, "plan-museum");
  const { selectedAt, ...savedPlace } = museum.place;
  assert.deepEqual(savedPlace, {
    provider: "openstreetmap", id: "node/3001", name: "Invented Lantern Museum", address: "1 Sample Quay, Fictional Bay",
    lat: 40.11, lng: 10.21, sourceUrl: "https://www.openstreetmap.org/node/3001", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0"
  }, "saved place uses the documented fields only");
  assert.match(selectedAt, ISO);
  assert.equal(museum.lat, 40.11); assert.equal(museum.lng, 10.21); assert.equal(museum.address, "1 Sample Quay, Fictional Bay");
  for (const key of ["googleMapsUrl", "mapsUrl", "googleMapsPlaceName", "googleMapsPlaceLabel", "googleMapsFeatureId"]) assert.equal(museum[key], undefined, `${key} cleared`);
  assert.equal(museum.approximateLocation, false);
  assert.equal(museum.review, "Fictional lantern exhibits"); assert.equal(museum.time, "09:00"); assert.equal(museum.photo, undefined);
  assert.deepEqual(museum.i18n, { ja: { name: "架空のランタン博物館" } }, "the stale translated address is dropped; other translations stay");
  for (const id of ["plan-garden", "plan-pier", "plan-cafe", "plan-ferry"]) assert.deepEqual(slotOf(server.trip, id), slotOf(beforeSave, id), `${id} unchanged`);
  await until(() => page.item("plan-museum")?.querySelector(".place-source a")?.href === MUSEUM_RESULT.sourceUrl, "timeline shows the new place source");
  assert.equal(stubMarker("plan-museum")?.coordinates?.join(","), "40.11,10.21", "marker uses the saved coordinates");
  assert.equal(searchLog().length, expectedSearches);

  // A4. Reopen shows the saved place without searching; clear+cancel keeps it; clear+save removes it.
  await openEditor(page, "plan-museum");
  assert.ok(textOf(page.current("place")).includes("Saved place") && textOf(page.current("place")).includes("Invented Lantern Museum"));
  assert.equal(page.results("place").length, 0, "no stale results from an earlier editor");
  assert.equal(page.input("place").value, "");
  page.current("place").querySelector(".lookup-current__clear").click();
  assert.ok(textOf(page.current("place")).includes("The location will be removed when you save."));
  await cancelEditor(page);
  assert.ok(slotOf(server.trip, "plan-museum").place, "cancelled clear changes nothing");
  await openEditor(page, "plan-museum");
  assert.ok(textOf(page.current("place")).includes("Saved place"));
  page.current("place").querySelector(".lookup-current__clear").click();
  await saveEditor(page);
  const clearedMuseum = slotOf(server.trip, "plan-museum");
  for (const key of ["place", "lat", "lng", "address", "approximateLocation", "googleMapsUrl"]) assert.equal(clearedMuseum[key], undefined, `clear removes ${key}`);
  assert.equal(clearedMuseum.review, "Fictional lantern exhibits");
  await until(() => !markerFor(page, "plan-museum") && !page.item("plan-museum").querySelector(".place-source"), "cleared plan is timeline-only");
  assert.equal(searchLog().length, expectedSearches);

  // A5. Explicit photo search: cached notice, safe text, bounded previews, failure fallback, save.
  await openEditor(page, "plan-cafe");
  assert.ok(textOf(page.current("place")).includes("No location yet."));
  assert.ok(textOf(page.current("photo")).includes("Current photo") && textOf(page.current("photo")).includes("Sample Archive, CC BY 4.0"));
  server.respond.photo = () => ok({ cached: true, results: [PHOTO_ONE, PHOTO_TWO, PHOTO_BAD_HOST] });
  await clickSearch(page, "photo", "fictional cafe interior");
  expectedSearches += 1;
  await until(() => page.results("photo").length === 2, "photo results");
  assert.deepEqual(searchLog().at(-1), { method: "POST", path: `/api/trips/${TRIP_ID}/photos/search`, body: { query: "fictional cafe interior" } });
  assert.ok(page.status("photo").textContent.startsWith("Photos found: 2.") && page.status("photo").textContent.includes(pickerText("en", "cachedResults")));
  const [photoRowOne, photoRowTwo] = page.results("photo");
  const thumbOne = photoRowOne.querySelector("img");
  assert.equal(thumbOne.getAttribute("src"), PHOTO_ONE.thumbnailUrl);
  assert.equal(thumbOne.getAttribute("loading"), "lazy"); assert.equal(thumbOne.getAttribute("referrerpolicy"), "no-referrer");
  assert.equal(thumbOne.width, 160); assert.equal(thumbOne.height, 120);
  assert.ok(photoRowTwo.querySelector("img").getAttribute("src").includes("/thumb/1/12/Fictional_counter.jpg/500px-"), "bounded thumbnail when no preview is supplied");
  assert.equal(doc.querySelector('img[src="x"]'), null, "author markup is not interpreted");
  assert.ok(textOf(photoRowOne).includes("Photo: Sample Author <img src=x onerror=alert(1)>"));
  assert.equal(photoRowOne.querySelector(".photo-credit__license").href, PHOTO_ONE.licenseUrl);
  assert.equal(photoRowOne.querySelector(".photo-credit__source").href, PHOTO_ONE.sourceUrl);
  assert.equal(photoRowTwo.querySelector("a.photo-credit__license"), null, "a licence without a link is plain text");
  thumbOne.dispatchEvent(new window.Event("error"));
  await sleep(40);
  assert.equal(photoRowOne.querySelector("img"), null);
  assert.equal(photoRowOne.querySelector(".lookup-thumb__fallback").hidden, false, "failed preview falls back to text");
  assert.equal(searchLog().length, expectedSearches, "an image failure never searches again");
  photoRowOne.querySelector(".lookup-result__choose").click();
  assert.ok(textOf(page.current("photo")).includes("Chosen photo"));
  await saveEditor(page);
  const cafe = slotOf(server.trip, "plan-cafe");
  const { selectedAt: photoSelectedAt, ...savedPhoto } = cafe.photo;
  assert.deepEqual(savedPhoto, {
    provider: "wikimedia-commons", url: PHOTO_ONE.url, sourceUrl: PHOTO_ONE.sourceUrl, credit: "Sample Author, CC BY 4.0",
    author: "Sample Author <img src=x onerror=alert(1)>", license: "CC BY 4.0", licenseUrl: PHOTO_ONE.licenseUrl
  }, "saved photo uses the documented fields only");
  assert.match(photoSelectedAt, ISO);
  assert.equal(cafe.photoSourceId, undefined, "the chosen photo replaces the linked legacy photo");
  assert.equal(cafe.lat, undefined, "choosing a photo never adds a location");
  await until(() => page.item("plan-cafe").querySelector(".photo-credit--licensed"), "timeline photo credit");
  const cafeCredit = page.item("plan-cafe").querySelector(".photo-credit--licensed");
  assert.equal(cafeCredit.querySelector(".photo-credit__license").href, PHOTO_ONE.licenseUrl);
  assert.equal(cafeCredit.querySelector(".photo-credit__source").href, PHOTO_ONE.sourceUrl);
  assert.ok(page.item("plan-cafe").querySelector(".location-photo img").src.includes("500px-Fictional_cafe.jpg"));
  assert.equal(doc.querySelector('img[src="x"]'), null);
  assert.ok(!markerFor(page, "plan-cafe"), "the cafe stays timeline-only");

  // A6. Removing the photo is explicit and does not revive the old linked photo.
  await openEditor(page, "plan-cafe");
  assert.ok(textOf(page.current("photo")).includes("Current photo") && textOf(page.current("photo")).includes("License: CC BY 4.0"));
  [...page.current("photo").querySelectorAll("button")].find((button) => button.textContent === "Remove photo").click();
  assert.ok(textOf(page.current("photo")).includes("The photo will be removed when you save."));
  await saveEditor(page);
  assert.equal(slotOf(server.trip, "plan-cafe").photo, undefined);
  assert.equal(slotOf(server.trip, "plan-cafe").photoSourceId, undefined);
  await until(() => !page.item("plan-cafe").querySelector(".location-photo img") && !page.item("plan-cafe").querySelector(".photo-credit--licensed"), "no fallback photo after removal");
  assert.deepEqual(slotOf(server.trip, "plan-pier").photo, PIER_PHOTO, "other plans keep their photos");

  // A7. Service off, network failure, preserved results and role loss.
  await openEditor(page, "plan-pier");
  server.respond.place = null;
  await clickSearch(page, "place", "Invented Old Pier");
  expectedSearches += 1;
  await until(() => page.status("place").dataset.error === "true", "service-off message");
  assert.ok(page.status("place").textContent.startsWith(pickerText("en", "lookupDisabled")) && page.status("place").textContent.includes("Lookup is not configured."));
  assert.equal(page.button("place", "search").disabled, false, "search can be retried");
  server.respond.place = () => { throw new TypeError("Simulated network failure"); };
  page.button("place", "search").click();
  expectedSearches += 1;
  await until(() => page.status("place").textContent === pickerText("en", "lookupNetwork"), "network message");
  server.respond.place = () => ok({ cached: false, results: [PIER_RESULT] });
  page.button("place", "search").click();
  expectedSearches += 1;
  await until(() => page.results("place").length === 1, "results after retry");
  server.respond.place = () => { throw new TypeError("Simulated network failure"); };
  page.button("place", "refresh").click();
  expectedSearches += 1;
  await until(() => page.status("place").textContent === pickerText("en", "lookupNetwork"), "refresh network failure");
  assert.equal(page.results("place").length, 1, "earlier results stay after a failed refresh");
  server.respond.place = () => ({ status: 403, payload: { error: { code: "forbidden", message: "Editing access required." } } });
  page.button("place", "refresh").click();
  expectedSearches += 1;
  await until(() => page.status("place").textContent === pickerText("en", "lookupForbidden"), "role loss message");
  assert.ok(page.button("place", "search").disabled && page.input("place").disabled && page.button("place", "refresh").disabled, "search is disabled after losing edit access");
  page.input("place").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await sleep(30);
  assert.equal(searchLog().length, expectedSearches, "no further lookups after role loss");
  await cancelEditor(page);

  // A8. A late response after the editor closed cannot touch another plan; unrelated saves keep place/photo.
  const late = deferred();
  server.respond.place = () => late.promise;
  await openEditor(page, "plan-pier");
  await clickSearch(page, "place", "Invented Old Pier");
  expectedSearches += 1;
  await until(() => searchLog().length === expectedSearches, "pending pier search");
  await cancelEditor(page);
  await openEditor(page, "plan-garden");
  late.resolve(ok({ cached: false, results: [PIER_RESULT] }));
  await sleep(60);
  assert.equal(page.results("place").length, 0, "late results are discarded");
  assert.equal(page.status("place").textContent, "");
  assert.ok(textOf(page.current("place")).includes("Invented Tide Garden"));
  typeInto(window, page.form().elements.review, "Updated fictional rock pool notes");
  await saveEditor(page);
  const garden = slotOf(server.trip, "plan-garden");
  assert.deepEqual(garden.place, GARDEN_PLACE, "an unrelated edit keeps the saved place");
  assert.deepEqual(garden.photo, GARDEN_PHOTO, "an unrelated edit keeps the saved photo");
  assert.equal(garden.review, "Updated fictional rock pool notes");
  assert.equal(searchLog().length, expectedSearches, "saving never searches");

  // A9. A pasted Google link replaces a chosen or saved place; the photo stays.
  await openEditor(page, "plan-garden");
  server.respond.place = () => ok({ cached: false, results: [PIER_RESULT] });
  await clickSearch(page, "place", "Invented Tide Garden Gate");
  expectedSearches += 1;
  await until(() => page.results("place").length === 1, "garden candidate");
  page.results("place")[0].querySelector("button").click();
  assert.equal(page.results("place")[0].querySelector("button").getAttribute("aria-pressed"), "true");
  page.form().elements.googleMapsUrl.value = PASTED_URL;
  page.form().elements.googleMapsUrl.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.equal(page.results("place")[0].querySelector("button").getAttribute("aria-pressed"), "false", "pasting a link un-chooses the place");
  assert.ok(textOf(page.current("place")).includes(pickerText("en", "usingGoogleLink")));
  assert.equal(doc.getElementById("google-maps-link-preview").hidden, false, "existing link preview still works");
  await saveEditor(page);
  const linkedGarden = slotOf(server.trip, "plan-garden");
  assert.equal(linkedGarden.place, undefined, "a new Google link clears the saved place");
  assert.equal(linkedGarden.googleMapsUrl, PASTED_URL);
  assert.equal(linkedGarden.lat, 40.3); assert.equal(linkedGarden.lng, 10.4); assert.equal(linkedGarden.address, "2 Sample Lane");
  assert.deepEqual(linkedGarden.photo, GARDEN_PHOTO, "changing the location keeps the photo");

  // A10. Unrelated edit on a legacy-coordinate plan keeps its coordinates and adds no place.
  await openEditor(page, "plan-pier");
  assert.ok(textOf(page.current("place")).includes("Current location") && textOf(page.current("place")).includes("Old pier road"));
  typeInto(window, page.form().elements.name, "Invented Old Pier Walk");
  await saveEditor(page);
  const pier = slotOf(server.trip, "plan-pier");
  assert.equal(pier.name, "Invented Old Pier Walk"); assert.equal(pier.lat, 40.05); assert.equal(pier.lng, 10.15); assert.equal(pier.address, "Old pier road");
  assert.equal(pier.place, undefined); assert.deepEqual(pier.photo, PIER_PHOTO);
  assert.equal(searchLog().length, expectedSearches);

  // A11. Background polling and remote changes never search.
  server.remote((trip) => { slotOf(trip, "plan-cafe").review = "Remote fictional note"; });
  window.dispatchEvent(new window.Event("online"));
  await until(() => doc.getElementById("itinerary-days").textContent.includes("Remote fictional note"), "poll applies a remote change");
  assert.equal(searchLog().length, expectedSearches, "polling never searches");

  // A12. A version conflict keeps the editor and the unsaved choice.
  await openEditor(page, "plan-pier");
  server.respond.place = () => ok({ cached: false, results: [PIER_RESULT] });
  await clickSearch(page, "place", "Invented Old Pier");
  expectedSearches += 1;
  await until(() => page.results("place").length === 1, "pier candidate");
  page.results("place")[0].querySelector("button").click();
  const tripReads = () => currentServer.log.filter((entry) => entry.method === "GET" && entry.path === `/api/trips/${TRIP_ID}`).length;
  const readsBeforePoll = tripReads();
  server.remote((trip) => { slotOf(trip, "plan-ferry").review = "Remote ferry note"; });
  window.dispatchEvent(new window.Event("online"));
  await until(() => tripReads() > readsBeforePoll, "poll during edit");
  await sleep(60);
  const conflictVersion = server.trip.version;
  await saveEditor(page, { expectSaved: false });
  assert.equal(server.trip.version, conflictVersion, "stale editor does not overwrite newer work");
  assert.ok(page.dialog().open && textOf(page.current("place")).includes("Chosen place"), "the choice stays visible after a conflict");
  assert.equal(slotOf(server.trip, "plan-pier").place, undefined);
  await cancelEditor(page);

  // A13. Four languages with the editor and results open, then save a chosen place for the pier.
  await openEditor(page, "plan-pier");
  await clickSearch(page, "place", "Invented Old Pier");
  expectedSearches += 1;
  await until(() => page.results("place").length === 1, "pier candidate for languages");
  for (const code of ["zh-Hans", "zh-Hant", "ja", "en"]) {
    language.value = code; language.dispatchEvent(new window.Event("change"));
    await sleep(30);
    assert.equal(doc.documentElement.lang, code);
    assert.equal(doc.getElementById("place-lookup-title").textContent, pickerText(code, "placeSectionTitle"), `${code} place title`);
    assert.equal(doc.getElementById("photo-lookup-title").textContent, pickerText(code, "photoSectionTitle"), `${code} photo title`);
    assert.equal(page.button("place", "search").textContent, pickerText(code, "search"));
    assert.equal(page.input("place").getAttribute("placeholder"), pickerText(code, "placeSearchPlaceholder"));
    assert.equal(page.results("place")[0].querySelector("button").textContent, pickerText(code, "useThisPlace"), `${code} choose button`);
    assert.equal(page.status("place").textContent, pickerText(code, "placeResultsCount", { count: 1 }), `${code} result count`);
    assert.ok(textOf(page.panel("place")).includes(pickerText(code, "placePrivacyNote")), `${code} privacy note`);
    assert.ok(textOf(page.current("place")).includes(pickerText(code, "currentLocation")), `${code} current location`);
    for (const node of page.dialog().querySelectorAll(".lookup-panel *")) {
      if (node.children.length === 0) assert.ok(!PICKER_KEYS.includes(node.textContent), `${code} shows no raw text keys`);
    }
  }
  assert.equal(searchLog().length, expectedSearches, "changing language never searches");
  page.results("place")[0].querySelector("button").click();
  await saveEditor(page);
  const pinnedPier = slotOf(server.trip, "plan-pier");
  assert.equal(pinnedPier.place.id, "relation/4004"); assert.equal(pinnedPier.lat, 40.06); assert.equal(pinnedPier.address, "Old Pier Road, Fictional Bay");
  assert.deepEqual(pinnedPier.photo, PIER_PHOTO, "choosing a place keeps the plan's photo");
  assert.equal(searchLog().length, expectedSearches, "every lookup came from an explicit Search or Refresh");
  assert.deepEqual(page.errors, []);
  assert.ok(searchLog().every((entry) => entry.path.startsWith(`/api/trips/${TRIP_ID}/`)), "lookups are scoped to this trip");

  // B. Reload: saved choices display without any lookup.
  const searchesBeforeReload = searchLog().length;
  page = await loadPage({ server });
  ({ doc, window, record } = page);
  assert.ok(page.item("plan-pier").querySelector(".place-source a").href === PIER_RESULT.sourceUrl, "saved place visible after reload");
  await openEditor(page, "plan-pier");
  assert.ok(textOf(page.current("place")).includes("Saved place") && textOf(page.current("place")).includes("Invented Old Pier"));
  await cancelEditor(page);
  const reloadLanguage = doc.getElementById("language-select");
  for (const code of LANGUAGES) {
    reloadLanguage.value = code; reloadLanguage.dispatchEvent(new window.Event("change"));
    await sleep(20);
    assert.ok(textOf(page.item("plan-pier").querySelector(".place-source")).startsWith(`${pickerText(code, "locationSourceLabel")}:`), `${code} timeline place source`);
    assert.ok([...doc.querySelectorAll("#credits-list a")].some((link) => link.textContent === pickerText(code, "placeDataCredit")), `${code} footer place credit`);
    await openEditor(page, "plan-pier");
    for (const kind of ["place", "photo"]) {
      assert.equal(page.panel(kind).querySelector("h3").textContent, pickerText(code, `${kind}SectionTitle`), `${code} reopened ${kind} title`);
      assert.equal(page.button(kind, "search").textContent, pickerText(code, "search"), `${code} search label`);
      assert.equal(page.panel(kind).querySelector("input").placeholder, pickerText(code, `${kind}SearchPlaceholder`), `${code} search placeholder`);
    }
    await cancelEditor(page);
  }
  reloadLanguage.value = "en"; reloadLanguage.dispatchEvent(new window.Event("change"));
  assert.equal(searchLog().length, searchesBeforeReload, "reloading and reopening never search");
  assert.deepEqual(page.errors, []);

  // C. Approved viewer: read-only display, no lookup controls, map linkage still works.
  server.editable = false;
  page = await loadPage({ server });
  ({ doc, window, record } = page);
  assert.ok(doc.documentElement.classList.contains("hosted-read-only"));
  assert.equal(doc.querySelectorAll(".timeline-item .icon-button").length, 0, "viewers get no plan editor");
  assert.equal(doc.querySelector(".lookup-panel"), null, "viewers never see lookup controls");
  assert.ok(page.item("plan-pier").querySelector(".place-source"), "viewers still see the saved place source");
  assert.ok(page.item("plan-garden").querySelector(".photo-credit--licensed"), "viewers still see photo credits");
  const viewerMarkers = new Map();
  const viewerOriginal = window.L.marker;
  window.L.marker = (coordinates, options) => { const marker = viewerOriginal(coordinates, options); viewerMarkers.set(marker.element, marker); return marker; };
  const viewerLanguage = doc.getElementById("language-select");
  viewerLanguage.value = "ja"; viewerLanguage.dispatchEvent(new window.Event("change"));
  viewerLanguage.value = "en"; viewerLanguage.dispatchEvent(new window.Event("change"));
  await sleep(30);
  viewerMarkers.get(markerFor(page, "plan-pier")).handlers.click();
  await until(() => page.item("plan-pier").classList.contains("is-map-selected") && markerFor(page, "plan-pier").classList.contains("is-selected"), "viewer marker selection");
  assert.equal(searchLog().length, searchesBeforeReload, "viewer pages never search");
  assert.deepEqual(page.errors, []);
  server.editable = true;

  // D. Phone planner (swipe sheet view): linkage scrolls the sheet; explicit search still works.
  page = await loadPage({ server, query: `?view=plan&day=${DAY_ONE}`, phone: true });
  ({ doc, window, record } = page);
  assert.ok(doc.documentElement.classList.contains("is-itinerary-view"), "phone sheet view is active");
  assert.equal(doc.getElementById("itinerary-sheet-handle").getAttribute("role"), "separator", "sheet handle keeps its semantics");
  const phoneMarkers = new Map();
  const phoneOriginal = window.L.marker;
  window.L.marker = (coordinates, options) => { const marker = phoneOriginal(coordinates, options); phoneMarkers.set(marker.element, marker); return marker; };
  const phoneLanguage = doc.getElementById("plan-language-select");
  phoneLanguage.value = "ja"; phoneLanguage.dispatchEvent(new window.Event("change"));
  phoneLanguage.value = "en"; phoneLanguage.dispatchEvent(new window.Event("change"));
  await sleep(40);
  assert.equal(record.maps, 1, "phone view reuses one map");
  record.scrolledPanels.length = 0; record.scrolledIntoView.length = 0;
  phoneMarkers.get(markerFor(page, "plan-pier")).handlers.click();
  await until(() => page.item("plan-pier").classList.contains("is-map-selected"), "phone marker selection");
  assert.ok(page.item("plan-pier").querySelector(".timeline-card").open);
  assert.ok(record.scrolledPanels.includes("itinerary-days") && !record.scrolledIntoView.includes("plan-pier"), "phone scrolls the itinerary sheet, not the page");
  await openEditor(page, "plan-pier");
  assert.ok(page.panel("place") && page.panel("photo"), "phone editors get the same controls");
  server.respond.photo = () => ok({ cached: false, results: [] });
  await clickSearch(page, "photo", "fictional pier");
  expectedSearches = searchesBeforeReload + 1;
  await until(() => page.status("photo").textContent === pickerText("en", "photoNoResults"), "phone no-results message");
  assert.equal(searchLog().length, expectedSearches);
  await cancelEditor(page);
  assert.equal(slotOf(server.trip, "plan-pier").place.id, "relation/4004");
  const css = fs.readFileSync(path.join(PUBLIC_DIR, "styles.css"), "utf8");
  const narrow = css.slice(css.lastIndexOf("@media (max-width: 479px)"));
  for (const selector of [".lookup-search__row", ".lookup-result", ".lookup-results"]) assert.ok(narrow.includes(selector), `narrow-screen rule for ${selector} (static check only)`);
  assert.deepEqual(page.errors, []);

  // E. Static generator page: saved places render, no lookup controls, no network use at all.
  const fetchesBefore = allFetches.length;
  const staticSeed = {
    title: "Fictional Static Harbor", slug: "fictional-static-harbor", buildId: "place-test", timezone: "UTC", startDate: DAY_ONE,
    reminders: [], tips: [], participantGroups: [], days: [{ id: "static-day", date: DAY_ONE, theme: "Invented static day", slots: [
      { id: "static-garden", name: "Invented Static Garden", period: "morning", time: "10:00", planType: "sight", place: clone(GARDEN_PLACE),
        lat: GARDEN_PLACE.lat, lng: GARDEN_PLACE.lng, address: GARDEN_PLACE.address, photo: clone(GARDEN_PHOTO) }
    ] }]
  };
  page = await loadPage({ server: null, hosted: false, seed: staticSeed });
  ({ doc, window, record } = page);
  assert.ok(page.item("static-garden").querySelector(".place-source a").href === GARDEN_PLACE.sourceUrl, "static page shows the saved place source");
  assert.ok(page.item("static-garden").querySelector(".photo-credit--licensed"));
  await openEditor(page, "static-garden");
  assert.equal(doc.querySelector(".lookup-panel"), null, "static pages have no lookup controls");
  typeInto(window, page.form().elements.name, "Invented Static Garden Walk");
  page.form().dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => !page.dialog().open, "static save");
  const stored = JSON.parse(window.localStorage.getItem("fictional-static-harbor-place-test"));
  assert.deepEqual(stored.days[0].slots[0].place, GARDEN_PLACE, "static editing keeps the saved place");
  assert.equal(stored.days[0].slots[0].name, "Invented Static Garden Walk");
  assert.equal(allFetches.length, fetchesBefore, "the static page made no network request");
  assert.deepEqual(page.errors, []);

  console.log("Place/photo picker DOM simulation passed: no lookup on view, reload, editor open, typing, language change, polling, unrelated saves or image failures; explicit Search/Refresh only with busy, cached, empty, service-off, network, retry and role-loss states; explicit choice with save/cancel/clear, Google-link replacement, coherent location fields and translation invalidation, photo choice/removal without legacy revival, licence/source credits as plain text, stale responses discarded after the editor closed, conflict and network failure keep the choice, read-only viewers, phone sheet and desktop map/card selection both ways with the map stub, four languages, and a static page without lookup controls. jsdom and stubbed API/Leaflet only: no backend, provider, browser layout, gesture or device claim.");
} finally {
  epoch += 1;
  timers.forEach(nativeClear);
  activeWindow?.close();
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeTimeout; globalThis.clearTimeout = nativeClear;
  if (nativeNavigator) Object.defineProperty(globalThis, "navigator", nativeNavigator);
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
}
