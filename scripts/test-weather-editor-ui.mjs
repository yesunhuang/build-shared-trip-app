// Weather association UI (jsdom DOM simulation, fictional data):
//   1. The per-day editor module in all four languages: accessible mode choice, current automatic
//      areas, replace/remove, typed coordinates with validation, save/conflict/forbidden/offline,
//      cancel and focus.
//   2. The real trip page (hosted mode) against an in-memory fictional API and an INJECTED fake
//      Open-Meteo: editor vs viewer, auto/off/back-to-auto/manual writes with the exact operations,
//      stale-form conflicts, identical-requestId retry after an uncertain failure, role loss,
//      request counts across renders, polls and language changes, and no stored forecast.
// jsdom has no layout, real keyboard focus traversal or network; input is simulated with DOM
// events. This is UI/contract evidence only, not a real browser or device test.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";
import { WEATHER_EDITOR_LANGUAGES, createDayWeatherEditor, weatherEditorText } from "../assets/app-template/public/weather-editor.js";
import { ui } from "../assets/app-template/public/i18n.js";

const PUBLIC_DIR = fileURLToPath(new URL("../assets/app-template/public/", import.meta.url));
const nativeTimeout = globalThis.setTimeout;
const wait = (ms) => new Promise((resolve) => nativeTimeout(resolve, ms));
async function until(predicate, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await wait(5);
  }
}
const textOf = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------
// 1. Editor module.
{
  const dom = new JSDOM("<!doctype html><html><body><main id=host></main></body></html>", { url: "http://fictional-trips.test/" });
  const { window } = dom;
  const doc = window.document;
  // Four languages: every key translated, no leftover placeholders, distinct from English.
  const keys = ["change", "title", "legend", "modeAuto", "modeManual", "modeOff", "conflict", "forbidden", "offline", "save", "cancel", "areaNear"];
  for (const language of WEATHER_EDITOR_LANGUAGES) {
    for (const key of keys) {
      const value = weatherEditorText(language, key, { place: "Fictional Hotel", count: 2, number: 1 });
      assert.ok(value && !/\{\w+\}/.test(value), `${language}.${key}`);
      if (language !== "en") assert.notEqual(value, weatherEditorText("en", key, { place: "Fictional Hotel", count: 2, number: 1 }), `${language}.${key} is translated`);
    }
    assert.ok(!/city/i.test(weatherEditorText(language, "areaNear", { place: "X" })), "automatic areas are never called a city");
  }

  let counter = 0;
  const saves = [];
  let nextResult = "saved";
  let cancelled = 0;
  const savedPoints = [
    { key: "10.0000,20.0000", lat: 10, lng: 20, label: "Fictional Hotel", name: "Fictional Hotel", i18n: { ja: { name: "架空のホテル" } } },
    { key: "11.0000,20.0000", lat: 11, lng: 20, label: "Fictional Far Stop", name: "Fictional Far Stop" },
    { key: "12.0000,22.0000", lat: 12, lng: 22, label: "Fictional Harbour", locationId: "loc-harbour" }
  ];
  const build = (language) => createDayWeatherEditor(doc, {
    language,
    current: { mode: "auto", entries: [{ id: "area:a" }, { id: "area:b" }] },
    autoAreas: [{ key: "10.0000,20.0000", label: "Area near Fictional Hotel", memberCount: 3 }, { key: "11.0000,20.0000", label: "Area near Fictional Far Stop", memberCount: 1 }],
    savedPoints,
    chosen: [],
    newLocationId: () => `weather-fictional-${++counter}`,
    onCancel: () => { cancelled += 1; },
    onSave: async (choice) => { saves.push(structuredClone(choice)); return nextResult; }
  });

  for (const language of WEATHER_EDITOR_LANGUAGES) {
    const editor = build(language);
    doc.getElementById("host").replaceChildren(editor.element);
    const root = editor.element;
    assert.equal(root.getAttribute("aria-labelledby"), root.querySelector("h3").id, `${language}: labelled section`);
    const legend = root.querySelector("fieldset.weather-editor__modes > legend");
    assert.equal(textOf(legend), weatherEditorText(language, "legend"));
    const radios = [...root.querySelectorAll("input[type=radio]")];
    assert.deepEqual(radios.map((radio) => radio.value), ["auto", "manual", "off"]);
    assert.ok(radios.every((radio) => radio.closest("label") && radio.name === radios[0].name), "native radios with labels in one group (keyboard arrows work natively)");
    assert.equal(radios.find((radio) => radio.checked).value, "auto");
    assert.ok(textOf(root).includes(weatherEditorText(language, "nowAuto", { count: 2 })), `${language}: current state`);
    assert.equal(root.querySelectorAll(".weather-editor__auto li").length, 2, "current automatic groups are listed");
    assert.ok(textOf(root.querySelector(".weather-editor__auto")).includes(weatherEditorText(language, "autoBadge")));
    editor.dispose();
  }

  // Manual: prefilled from the automatic areas, remove, add saved, typed coordinates with errors.
  const editor = build("en");
  doc.getElementById("host").replaceChildren(editor.element);
  const root = () => editor.element;
  const radio = (value) => root().querySelector(`input[type=radio][value=${value}]`);
  radio("manual").checked = true;
  radio("manual").dispatchEvent(new window.Event("change", { bubbles: true }));
  let items = [...root().querySelectorAll(".weather-editor__manual li")];
  assert.deepEqual(items.map((item) => textOf(item.querySelector(".weather-editor__label"))), ["Fictional Hotel", "Fictional Far Stop"], "switching to manual starts from the automatic areas");
  const removeButtons = [...root().querySelectorAll(".weather-editor__remove")];
  assert.equal(removeButtons[1].getAttribute("aria-label"), "Remove Fictional Far Stop");
  removeButtons[1].focus();
  removeButtons[1].click();
  assert.equal(root().querySelectorAll(".weather-editor__manual li").length, 1);
  assert.equal(doc.activeElement?.dataset.focusKey, "remove-0", "focus moves to the remaining Remove button");
  const select = root().querySelector("select");
  assert.deepEqual([...select.options].map((option) => option.textContent), ["Fictional Far Stop", "Fictional Harbour"], "only saved points not yet chosen");
  select.value = "12.0000,22.0000";
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
  root().querySelector("[data-focus-key=add-saved]").click();
  assert.equal(root().querySelectorAll(".weather-editor__manual li").length, 2);
  // Typed coordinates: missing name, bad format, out of range, then valid.
  const typeInto = (key, value) => { const input = root().querySelector(`[data-focus-key=coord-${key}]`); input.value = value; input.dispatchEvent(new window.Event("input", { bubbles: true })); };
  const addCoordinates = () => root().querySelector("[data-focus-key=add-coordinates]").click();
  const inlineError = () => root().querySelector(".weather-editor__error");
  typeInto("lat", "35.5"); typeInto("lng", "139.5"); addCoordinates();
  assert.equal(textOf(inlineError()), weatherEditorText("en", "nameRequired"));
  assert.equal(root().querySelector("[data-focus-key=coord-lat]").getAttribute("aria-invalid"), "true");
  assert.equal(root().querySelector("[data-focus-key=coord-lat]").getAttribute("aria-describedby"), inlineError().id);
  typeInto("name", "Fictional Lookout"); typeInto("lat", "35,5"); addCoordinates();
  assert.equal(textOf(inlineError()), weatherEditorText("en", "coordinateFormat"));
  typeInto("lat", "95"); addCoordinates();
  assert.equal(textOf(inlineError()), weatherEditorText("en", "coordinateRange"));
  typeInto("lat", "35.5"); addCoordinates();
  assert.equal(inlineError().hidden, true);
  assert.equal(root().querySelectorAll(".weather-editor__manual li").length, 3);
  assert.equal(doc.activeElement?.dataset.focusKey, "add-coordinates", "focus stays on the add control");

  // Save: the choice carries saved-point copies, existing location IDs and pre-generated stable IDs.
  let result = await editor.submit();
  assert.equal(result, "saved");
  assert.deepEqual(saves.at(-1), { mode: "manual", picks: [
    { newLocationId: "weather-fictional-1", name: "Fictional Hotel", lat: 10, lng: 20, i18n: { ja: { name: "架空のホテル" } } },
    { locationId: "loc-harbour" },
    { newLocationId: "weather-fictional-3", name: "Fictional Lookout", lat: 35.5, lng: 139.5 }
  ] });
  const firstChoice = saves.at(-1);
  nextResult = "offline";
  result = await editor.submit();
  assert.equal(result, "offline");
  assert.deepEqual(saves.at(-1), firstChoice, "a second press sends an identical choice (same IDs) so the caller can replay the requestId");
  assert.equal(textOf(root().querySelector(".weather-editor__status")), weatherEditorText("en", "offline"));
  assert.equal(root().querySelector(".weather-editor__status").getAttribute("role"), "alert");
  nextResult = "conflict";
  await editor.submit();
  assert.equal(textOf(root().querySelector(".weather-editor__status")), weatherEditorText("en", "conflict"), "real conflict message");
  // Busy state: Save disabled and relabelled while a save is pending.
  let release;
  const slow = createDayWeatherEditor(doc, { language: "ja", current: { mode: "off", entries: [] }, autoAreas: [], savedPoints, chosen: [], newLocationId: () => "x",
    onCancel: () => {}, onSave: () => new Promise((resolve) => { release = resolve; }) });
  doc.getElementById("host").append(slow.element);
  assert.equal(slow.element.querySelector("input[value=off]").checked, true);
  const pending = slow.submit();
  const saveButton = slow.element.querySelector("[data-focus-key=save]");
  assert.equal(saveButton.disabled, true);
  assert.equal(textOf(saveButton), weatherEditorText("ja", "saving"));
  release("forbidden");
  await pending;
  assert.ok([...slow.element.querySelectorAll("input,select,button[data-focus-key=save]")].every((node) => node.disabled), "role loss: controls disabled");
  assert.equal(textOf(slow.element.querySelector(".weather-editor__status")), weatherEditorText("ja", "forbidden"));
  // Empty manual choice is refused locally.
  const empty = createDayWeatherEditor(doc, { language: "zh-Hant", current: { mode: "manual", entries: [] }, autoAreas: [], savedPoints: [], chosen: [], newLocationId: () => "x", onCancel: () => {}, onSave: async () => "saved" });
  assert.equal(empty.element.querySelector("input[value=manual]").checked, true);
  const beforeEmpty = saves.length;
  await empty.submit();
  assert.equal(saves.length, beforeEmpty);
  assert.equal(textOf(empty.element.querySelector(".weather-editor__status")), weatherEditorText("zh-Hant", "emptyManual"));
  // Stale notice and cancel.
  editor.markStale(true);
  assert.equal(textOf(root().querySelector(".weather-editor__notice")), weatherEditorText("en", "staleNotice"));
  root().querySelector("[data-focus-key=cancel]").click();
  assert.equal(cancelled, 1);
  editor.setLanguage("zh-Hans");
  assert.equal(textOf(root().querySelector("h3")), weatherEditorText("zh-Hans", "title"), "language switch relabels in place");
  window.close();
}

// ---------------------------------------------------------------------------------------------
// 2. The real trip page with a fictional API and an injected Open-Meteo.
const ORIGIN = "http://fictional-trips.test";
const TRIP_ID = "fictional-weather";
const isoDay = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const DAY_ONE = isoDay(1);
const DAY_TWO = isoDay(2);
const clone = (value) => structuredClone(value);

function fixtureTrip() {
  return {
    id: TRIP_ID, version: 3, archived: false, title: "Fictional Weather Weekend", timezone: "UTC", country: "Fictionland", route: "Sample Bay",
    updatedAt: "2031-01-03T00:00:00.000Z", createdAt: "2031-01-01T00:00:00.000Z", dateRange: { start: DAY_ONE, end: DAY_TWO },
    reminders: [], participantGroups: [], tips: [], googlePlacePhotosEnabled: false,
    weather: { locations: [{ id: "loc-harbour", name: "Fictional Harbour", lat: 12, lng: 22, i18n: { ja: { name: "架空の港" } } }] },
    days: [
      { id: "day-one", date: DAY_ONE, theme: "Fictional City Day", slots: [
        { id: "plan-hotel", name: "Fictional Hotel", period: "morning", time: "09:00", sortTime: "09:00", planType: "stay", lat: 10, lng: 20 },
        { id: "plan-museum", name: "Fictional Museum", period: "noon", time: "12:00", sortTime: "12:00", planType: "sight", lat: 10.02, lng: 20.01 },
        { id: "plan-cafe", name: "Fictional Cafe", period: "evening", time: "18:00", sortTime: "18:00", planType: "restaurant" }
      ] },
      { id: "day-two", date: DAY_TWO, theme: "Fictional Harbour Day", weatherLocationIds: ["loc-harbour"], slots: [
        { id: "plan-ferry", name: "Fictional Ferry", period: "morning", time: "10:00", planType: "transport", lat: 10, lng: 20 }
      ] }
    ]
  };
}

function createFakeServer(initialTrip, { editable = true } = {}) {
  const server = { trip: clone(initialTrip), editable, log: [], requestIds: new Map(), failNext: null };
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
      if (server.failNext === "network") { server.failNext = null; throw new TypeError("Fictional network failure"); }
      if (server.failNext === "forbidden" || !server.editable) { server.failNext = null; return json(403, { error: { code: "forbidden", message: "Editing access required." } }); }
      if (server.requestIds.has(body.requestId)) return json(200, { trip: clone(server.requestIds.get(body.requestId)) });
      if (body.expectedVersion !== server.trip.version) return json(409, { error: { code: "version_conflict", message: "Version conflict." } });
      let next = clone(server.trip);
      for (const change of body.changes) {
        if (change.type === "replace_content") next = clone(change.trip);
        else if (change.type === "update_trip") Object.assign(next, clone(change.fields));
        else if (change.type === "upsert_day") {
          const day = next.days.find((candidate) => candidate.id === change.day.id);
          for (const [key, value] of Object.entries(change.day)) { if (value === null) delete day[key]; else day[key] = clone(value); }
        } else return json(400, { error: { code: "unsupported", message: "Not part of this simulation." } });
      }
      Object.assign(next, { id: server.trip.id, version: server.trip.version + 1, archived: false, updatedAt: new Date(Date.parse(server.trip.updatedAt) + 60000).toISOString() });
      server.trip = next;
      server.requestIds.set(body.requestId, next);
      return json(200, { trip: clone(next) });
    }
    return json(404, { error: { code: "not_found", message: "Not found." } });
  };
  server.changes = () => server.log.filter((entry) => entry.method === "POST" && entry.path.endsWith("/changes"));
  return server;
}

// Injected Open-Meteo: records every request; replies with deterministic fictional values.
const meteoLog = [];
function meteoResponse(url) {
  const params = url.searchParams;
  const lats = params.get("latitude").split(",").map(Number);
  const dates = [isoDay(0), DAY_ONE, DAY_TWO];
  const one = (lat, index) => ({
    location_id: lats.length > 1 ? index : undefined,
    daily: { time: dates, weather_code: dates.map(() => 2), temperature_2m_max: dates.map(() => Math.round(lat) + 10), temperature_2m_min: dates.map(() => 5),
      apparent_temperature_max: dates.map(() => 20), apparent_temperature_min: dates.map(() => 4), precipitation_probability_max: dates.map(() => 30),
      precipitation_sum: dates.map(() => 0.4), wind_speed_10m_max: dates.map(() => 11), wind_gusts_10m_max: dates.map(() => 20), uv_index_max: dates.map(() => 5),
      sunrise: dates.map((date) => `${date}T05:30`), sunset: dates.map((date) => `${date}T19:30`) },
    hourly: { time: dates.flatMap((date) => ["06", "09", "12", "15", "18", "21"].map((hour) => `${date}T${hour}:00`)),
      temperature_2m: dates.flatMap(() => [8, 12, 16, 17, 14, 10]), precipitation_probability: dates.flatMap(() => [5, 10, 20, 30, 20, 10]), uv_index: dates.flatMap(() => [0, 2, 5, 4, 1, 0]) }
  });
  const body = lats.map(one);
  return lats.length === 1 ? body[0] : body;
}

const nativeClear = globalThis.clearTimeout;
const nativeFetch = globalThis.fetch;
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
let heldWeather = null;
let heldLogout = null;
let weatherFailure = null;
let nullMeasurements = false;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
  const method = options.method || "GET";
  if (url.hostname === "api.open-meteo.com" && url.pathname === "/v1/forecast") {
    meteoLog.push(url);
    if (heldWeather) { const hold = heldWeather; heldWeather = null; await hold; }
    if (weatherFailure) return new Response("{}", { status: weatherFailure, headers: { "Retry-After": "0" } });
    const payload = meteoResponse(url);
    if (nullMeasurements) {
      const first = Array.isArray(payload) ? payload[0] : payload;
      for (const key of Object.keys(first.daily)) if (key !== "time") first.daily[key] = first.daily.time.map(() => null);
      if (nullMeasurements === "aggregate") first.daily.precipitation_sum = first.daily.time.map(() => 1);
      else if (nullMeasurements !== "daily-empty") first.daily.temperature_2m_min = first.daily.time.map(() => 7);
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.pathname === "/api/logout" && heldLogout) {
    const hold = heldLogout; heldLogout = null; await hold;
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (url.origin !== ORIGIN || !url.pathname.startsWith("/api/")) throw new TypeError("External request blocked in DOM simulation");
  const result = await currentServer.handle(method, url, options.body);
  return new Response(JSON.stringify(result.payload), { status: result.status, headers: { "Content-Type": "application/json" } });
};
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
        project([lat, lng]) { return point(lng * 1000, -lat * 1000); }, unproject(projected) { return [-projected.y / 1000, projected.x / 1000]; }, eachLayer() {} };
      return map;
    },
    control: { zoom: () => ({ addTo() { return this; }, getContainer: () => ({ querySelectorAll: () => [doc.createElement("a"), doc.createElement("a")] }) }) },
    tileLayer() { return { addTo() { return this; } }; },
    layerGroup: () => ({ layers: [], addTo() { return this; }, clearLayers() { this.layers = []; } }),
    point, latLngBounds: (points) => points, divIcon: (options) => options,
    marker(coordinates, options) {
      const element = doc.createElement("div");
      return { coordinates, options, element, addTo(group) { group.layers.push(this); return this; }, bindPopup() { return this; }, getPopup() { return null; },
        on() { return this; }, getElement() { return element; }, setZIndexOffset() { return this; } };
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
  meteoLog.length = 0;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-weather-ui-"));
  tempRoots.push(root);
  const publicDir = path.join(root, "public");
  fs.cpSync(PUBLIC_DIR, publicDir, { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module" }));
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8").replace("__TRIP_DATA_JSON__", "{}");
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => { if (!error.message.includes("Not implemented: navigation")) errors.push(error.message); });
  const dom = new JSDOM(html, { url: `${ORIGIN}/trips/${TRIP_ID}?day=${DAY_ONE}`, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole });
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
  window.L = leafletStub(window);
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
    for (const found of script.textContent.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (typeof window[found[1]] === "function") globalThis[found[1]] = window[found[1]];
    }
  }
  await import(`${pathToFileURL(path.join(publicDir, "hosted-bootstrap.js")).href}?v=__CACHE_VERSION__`);
  const doc = window.document;
  await until(() => !doc.querySelector(".hosted-boot") && doc.querySelector(".timeline-item"), "trip page ready");
  await until(() => doc.querySelector(".weather-date-strip"), "weather strip");
  await wait(60);
  const page = { window, doc, errors, server };
  page.dialog = () => doc.getElementById("weather-dialog");
  page.content = () => doc.getElementById("weather-dialog-content");
  page.openDay = async (dayId) => {
    doc.querySelector(`.weather-detail-trigger[data-weather-day-id="${dayId}"]`).click();
    await until(() => page.dialog().open, `weather dialog ${dayId}`);
  };
  page.toggle = () => page.content().querySelector(".weather-editor-toggle");
  page.editor = () => page.content().querySelector(".weather-editor");
  page.choose = (mode) => {
    const radio = page.editor().querySelector(`input[type=radio][value=${mode}]`);
    radio.checked = true;
    radio.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  page.save = async () => {
    const before = server.log.length;
    page.editor().querySelector("[data-focus-key=save]").click();
    await until(() => !page.editor() || !page.editor().querySelector("[data-focus-key=save]").disabled || server.log.length > before, "save settled");
    await wait(40);
  };
  page.retrySync = async () => {
    const buttons = [...doc.querySelectorAll("#hosted-controls button")];
    buttons.at(-2).click();
    await wait(80);
  };
  page.peekText = (dayId) => textOf(doc.querySelector(`.weather-detail-trigger[data-weather-day-id="${dayId}"]`)?.closest(".weather-date-card")?.querySelector(".weather-peeks"));
  return page;
}

try {
  // Editor page.
  const server = createFakeServer(fixtureTrip());
  let page = await loadPage({ server });
  await until(() => meteoLog.length >= 1, "initial forecast");
  await wait(40);
  assert.equal(meteoLog.length, 1, "one batched forecast request on load");
  assert.equal(meteoLog[0].searchParams.get("latitude").split(",").length, 2, "day one's automatic area (one point for hotel and museum) and day two's explicit harbour");
  assert.equal(meteoLog[0].searchParams.get("forecast_days"), "16");
  assert.ok(page.peekText("day-one").includes("Area near Fictional Hotel"), "automatic area identified by its own saved plan, not a city");
  assert.ok(page.peekText("day-two").includes("Fictional Harbour"), "explicit location kept");
  assert.ok(page.doc.querySelector(".footer-credit-link[href='https://open-meteo.com/en/license']"), "Open-Meteo attribution unchanged");

  // Unrelated poll, language change and re-render: no new request.
  server.remote((trip) => { trip.days[0].slots[2].notes = "Fictional unrelated note"; });
  await page.retrySync();
  await until(() => page.doc.body.textContent.includes("Fictional Cafe"), "poll applied");
  const languageSelect = page.doc.getElementById("language-select");
  languageSelect.value = "ja";
  languageSelect.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  await wait(60);
  assert.ok(page.peekText("day-one").includes("Fictional Hotel周辺エリア"), "localized area label");
  assert.ok(page.peekText("day-two").includes("架空の港"), "localized explicit name");
  languageSelect.value = "en";
  languageSelect.dispatchEvent(new page.window.Event("change", { bubbles: true }));
  await wait(60);
  assert.equal(meteoLog.length, 1, "polls, language changes and unrelated edits do not refetch");

  // Off for day one.
  await page.openDay("day-one");
  assert.ok(page.toggle(), "editor control offered to a content manager");
  page.toggle().click();
  await until(() => page.editor(), "editor open");
  assert.equal(page.editor().querySelector("input[type=radio]:checked").value, "auto");
  assert.equal(page.doc.activeElement, page.editor().querySelector("input[type=radio]:checked"), "focus moves into the editor");
  assert.equal(page.editor().querySelectorAll(".weather-editor__auto li").length, 1);
  page.choose("off");
  await page.save();
  let posted = server.changes().at(-1).body;
  assert.equal(posted.expectedVersion, 4);
  assert.deepEqual(posted.changes, [{ type: "upsert_day", day: { id: "day-one", weatherLocationIds: [] } }]);
  assert.deepEqual(server.trip.days[0].weatherLocationIds, []);
  assert.equal(page.editor(), null, "editor closes after saving");
  assert.equal(page.doc.activeElement, page.toggle(), "focus returns to the editor control");
  assert.ok(textOf(page.content()).includes(weatherEditorText("en", "saved")));
  assert.ok(textOf(page.content()).includes(weatherEditorText("en", "offShort")));
  await wait(40);
  assert.equal(meteoLog.length, 1, "turning a day off needs no request (other day keeps its data)");

  // Back to automatic: the day's point is needed again.
  page.toggle().click();
  await until(() => page.editor(), "editor open");
  assert.equal(page.editor().querySelector("input[type=radio]:checked").value, "off");
  page.choose("auto");
  assert.ok(textOf(page.editor()).includes("Area near Fictional Hotel"), "returning from off previews the actual saved-plan area");
  assert.ok(!textOf(page.editor()).includes(weatherEditorText("en", "autoNone")), "a stored off choice must not masquerade as missing coordinates");
  await page.save();
  posted = server.changes().at(-1).body;
  assert.deepEqual(posted.changes, [{ type: "upsert_day", day: { id: "day-one", weatherLocationIds: null } }]);
  assert.equal(Object.hasOwn(server.trip.days[0], "weatherLocationIds"), false);
  await until(() => meteoLog.length === 2, "refetch for the restored automatic area");
  assert.equal(meteoLog[1].searchParams.get("latitude"), "10", "only the newly needed point");

  // Manual with typed coordinates replacing the automatic area.
  page.toggle().click();
  await until(() => page.editor(), "editor open");
  page.choose("manual");
  assert.equal(page.editor().querySelectorAll(".weather-editor__manual li").length, 1, "prefilled from the automatic area");
  page.editor().querySelector(".weather-editor__remove").click();
  const type = (key, value) => { const input = page.editor().querySelector(`[data-focus-key=coord-${key}]`); input.value = value; input.dispatchEvent(new page.window.Event("input", { bubbles: true })); };
  type("name", "Fictional Lookout"); type("lat", "10.5"); type("lng", "20.5");
  page.editor().querySelector("[data-focus-key=add-coordinates]").click();
  await page.save();
  posted = server.changes().at(-1).body;
  assert.equal(posted.changes.length, 2);
  assert.equal(posted.changes[0].type, "update_trip");
  const added = posted.changes[0].fields.weather.locations.at(-1);
  assert.deepEqual({ name: added.name, lat: added.lat, lng: added.lng }, { name: "Fictional Lookout", lat: 10.5, lng: 20.5 });
  assert.ok(/^weather-/.test(added.id));
  assert.deepEqual(posted.changes[0].fields.weather.locations[0], fixtureTrip().weather.locations[0], "existing location unchanged");
  assert.deepEqual(posted.changes[1], { type: "upsert_day", day: { id: "day-one", weatherLocationIds: [added.id] } });
  assert.deepEqual(server.trip.days[1].weatherLocationIds, ["loc-harbour"], "other day untouched");
  await until(() => meteoLog.length === 3, "fetch for the chosen coordinates");
  assert.equal(meteoLog[2].searchParams.get("latitude"), "10.5");

  // Stale open form: another editor changes the trip while this form is open.
  page.toggle().click();
  await until(() => page.editor(), "editor open");
  page.choose("off");
  server.remote((trip) => { trip.days[1].slots[0].notes = "Fictional change elsewhere"; });
  await page.retrySync();
  assert.ok(textOf(page.editor()).includes(weatherEditorText("en", "staleNotice")), "the open form is marked stale");
  const postsBefore = server.changes().length;
  await page.save();
  assert.equal(server.changes().length, postsBefore, "a stale form is never sent");
  assert.ok(textOf(page.editor()).includes(weatherEditorText("en", "conflict")), "conflict state shown");
  assert.equal(page.editor().querySelector("input[type=radio]:checked").value, "manual", "the latest saved choice is shown for review");
  // Uncertain failure: the identical retry reuses the requestId.
  page.choose("off");
  server.failNext = "network";
  await page.save();
  assert.ok(textOf(page.editor()).includes(weatherEditorText("en", "offline")));
  const failedRequestId = server.changes().at(-1).body.requestId;
  await page.save();
  assert.equal(server.changes().at(-1).body.requestId, failedRequestId, "identical retry, same requestId");
  assert.deepEqual(server.trip.days[0].weatherLocationIds, []);

  // Role loss and cancel.
  page.toggle().click();
  await until(() => page.editor(), "editor open");
  page.choose("auto");
  server.failNext = "forbidden";
  await page.save();
  assert.ok(textOf(page.editor()).includes(weatherEditorText("en", "forbidden")));
  assert.ok(page.editor().querySelector("[data-focus-key=save]").disabled);
  page.editor().querySelector("[data-focus-key=cancel]").click();
  await wait(20);
  assert.equal(page.editor(), null);
  assert.equal(page.doc.activeElement, page.toggle(), "cancel returns focus");
  const cancelledPosts = server.changes().length;
  page.toggle().click();
  await until(() => page.editor(), "editor open");
  page.choose("manual");
  page.dialog().close();
  await wait(20);
  assert.equal(server.changes().length, cancelledPosts, "closing discards the unsaved choice");
  assert.deepEqual(server.trip.days[0].weatherLocationIds, []);

  // Coordinate edit elsewhere (poll) recomputes the automatic area; a removed day is dropped.
  server.remote((trip) => { delete trip.days[0].weatherLocationIds; trip.days[0].slots[0].lat = 10.7; trip.days[0].slots[1].lat = 10.71; });
  const beforeMove = meteoLog.length;
  await page.retrySync();
  await until(() => meteoLog.length === beforeMove + 1, "refetch after a coordinate change");
  assert.equal(meteoLog.at(-1).searchParams.get("latitude"), "10.7");
  const storedKeys = [];
  for (let index = 0; index < page.window.localStorage.length; index += 1) storedKeys.push(page.window.localStorage.key(index));
  for (let index = 0; index < page.window.sessionStorage.length; index += 1) storedKeys.push(page.window.sessionStorage.key(index));
  assert.ok(storedKeys.every((key) => !/weather|forecast/i.test(key)), `no stored forecast (${storedKeys.join(", ")})`);
  assert.deepEqual(page.errors, []);

  // Phone width: same control is available.
  page = await loadPage({ server: createFakeServer(fixtureTrip()), phone: true });
  await page.openDay("day-one");
  assert.ok(page.toggle(), "phone width: editor control present");

  // Viewer: read-only, no editor control, forecasts still shown.
  page = await loadPage({ server: createFakeServer(fixtureTrip(), { editable: false }) });
  await until(() => meteoLog.length >= 1, "viewer forecast");
  await page.openDay("day-one");
  assert.equal(page.toggle(), null, "viewers never see the editor");
  assert.equal(page.editor(), null);
  assert.ok(textOf(page.content()).includes("Area near Fictional Hotel"));
  assert.deepEqual(page.errors, []);

  // Outages retain all dates, independent horizon notices and editor controls. Manual retry is
  // bounded, works for viewers too, and never writes a trip. Pointer/layout are emulation only.
  for (const editable of [false, true]) for (const phone of [false, true]) {
    const source = fixtureTrip();
    source.days.push({ id: "beyond", date: isoDay(20), slots: [{ id: "later", name: "Fictional later stop", lat: 15, lng: 25 }] });
    const outageServer = createFakeServer(source, { editable }), before = JSON.stringify(outageServer.trip);
    weatherFailure = 503;
    page = await loadPage({ server: outageServer, phone });
    await until(() => page.doc.querySelector('[data-weather-error="http"]') && meteoLog.length === 3, "bounded outage attempts");
    assert.equal(page.doc.querySelectorAll(".weather-date-card").length, source.days.length, "outage never replaces the whole date strip");
    assert.ok(page.peekText("beyond").includes("16-day"), "out-of-horizon explanation is independent of request failure");
    await page.openDay("day-one");
    assert.equal(Boolean(page.toggle()), editable, "manual weather choices remain reachable according to role");
    if (editable) { page.toggle().click(); await until(() => page.editor(), "editor reachable during outage"); }
    page.dialog().close();
    const originalNow = Date.now;
    try {
      Date.now = () => originalNow() + 6000;
      for (const language of ["zh-Hans", "zh-Hant", "ja", "en"]) {
        const select = page.doc.getElementById("language-select"); select.value = language; select.dispatchEvent(new page.window.Event("change"));
        const message = page.doc.querySelector('[data-weather-error="http"]'); assert.ok(message && message.textContent && !message.textContent.includes("weatherHttpError"));
        const iconButton = page.doc.querySelector(".weather-retry");
        assert.equal(iconButton.tagName, "BUTTON"); assert.equal(iconButton.type, "button");
        assert.equal(iconButton.getAttribute("aria-label"), ui(language, "retryWeather"));
        assert.equal(iconButton.title, ui(language, "retryWeather"));
        assert.equal(iconButton.textContent, "", "refresh is icon-only, with a localized accessible name");
        assert.equal(iconButton.querySelector("svg").getAttribute("aria-hidden"), "true");
        assert.equal(iconButton.querySelector("svg").getAttribute("focusable"), "false");
        assert.equal(iconButton.parentElement.className, "weather-compact__header", "refresh remains beside the header");
      }
      assert.equal(meteoLog.length, 3, "language changes do not retry an outage");
      const retry = page.doc.querySelector(".weather-retry"); assert.equal(retry.disabled, false, "manual retry becomes available after cooldown");
      retry.focus(); assert.equal(page.doc.activeElement, retry, "native button accepts keyboard focus");
      let releaseRefresh; heldWeather = new Promise((resolve) => { releaseRefresh = resolve; });
      weatherFailure = null; retry.click(); retry.click();
      await until(() => page.doc.querySelector('.weather-retry[data-state="loading"]'), "icon shows the in-flight state");
      await until(() => meteoLog.length === 4, "one manual refresh dispatched");
      const loadingRetry = page.doc.querySelector(".weather-retry");
      assert.equal(loadingRetry.disabled, true); assert.equal(loadingRetry.getAttribute("aria-busy"), "true");
      assert.ok(loadingRetry.title.includes(ui("en", "loadingForecastShort")));
      loadingRetry.click(); assert.equal(meteoLog.length, 4, "disabled loading control cannot dispatch another request");
      releaseRefresh();
      await until(() => page.doc.querySelector(".weather-peek__temperature") && !page.doc.querySelector(".weather-request-message"), "manual retry recovers");
      assert.equal(meteoLog.length, 4, "double activation shares one recovery request");
      const cooldownRetry = page.doc.querySelector(".weather-retry");
      assert.equal(cooldownRetry.dataset.state, "cooldown"); assert.equal(cooldownRetry.disabled, true);
      assert.equal(cooldownRetry.getAttribute("aria-busy"), "false");
      assert.ok(cooldownRetry.title.includes(ui("en", "weatherRetryWait")));
      cooldownRetry.click(); assert.equal(meteoLog.length, 4, "cooldown cannot be bypassed by repeated clicks");
      assert.equal(JSON.stringify(outageServer.trip), before, "weather recovery never mutates stored trip choices/content/version");
    } finally { Date.now = originalNow; weatherFailure = null; }
    assert.deepEqual(page.errors, []);
  }
  nullMeasurements = true;
  page = await loadPage({ server: createFakeServer(fixtureTrip()) });
  await until(() => page.peekText("day-one").includes("—°"), "missing daily measurements");
  assert.ok(page.peekText("day-one").includes("7°C"));
  assert.ok(page.peekText("day-one").includes("—%"), "missing rain is not fabricated as zero");
  assert.ok(page.peekText("day-one").includes("Some forecast data"));
  assert.ok(!page.peekText("day-one").includes("☀️"), "missing code is not fabricated as clear weather");
  nullMeasurements = "aggregate";
  const multiArea = fixtureTrip(); multiArea.days[0].slots.push({ id: "far-area", name: "Fictional far area", lat: 11, lng: 21 });
  page = await loadPage({ server: createFakeServer(multiArea) });
  assert.ok(page.peekText("day-one").includes("21° / 5°C"), "aggregation ignores a missing high/low instead of including fabricated zeroes");
  nullMeasurements = "daily-empty";
  page = await loadPage({ server: createFakeServer(fixtureTrip()) });
  await page.openDay("day-one");
  assert.ok(page.content().querySelector(".weather-hours"), "usable hourly data survives missing daily measurements");
  nullMeasurements = false;

  // The Today label follows a remote timezone edit even while the weather dialog stays open.
  const NativeDate = globalThis.Date;
  const nearMidnight = NativeDate.parse(`${isoDay(0)}T23:30:00Z`);
  class LabelDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [nearMidnight])); }
    static now() { return NativeDate.now(); } // Test deadlines and forecast clocks still advance.
  }
  globalThis.Date = LabelDate;
  try {
    const zoneServer = createFakeServer(fixtureTrip());
    page = await loadPage({ server: zoneServer });
    page.window.Date = LabelDate;
    await page.openDay("day-one");
    const dayLabel = () => page.doc.querySelector('[data-weather-day-id="day-one"]').closest(".weather-date-card").querySelector(".weather-date-card__day").textContent;
    assert.ok(!dayLabel().includes("Today"), "the UTC day is still tomorrow near midnight");
    zoneServer.remote((trip) => { trip.timezone = "Pacific/Kiritimati"; });
    await page.retrySync();
    await until(() => dayLabel().includes("Today"), "Today updates to the current trip timezone");
    assert.equal(page.dialog().open, true);
    assert.equal(meteoLog.at(-1).searchParams.get("timezone"), "Pacific/Kiritimati");
  } finally {
    globalThis.Date = NativeDate;
    if (activeWindow) activeWindow.Date = NativeDate;
  }

  // Sign-out starts while batch one and the logout response are both pending. Even a fetch that
  // ignores AbortSignal must not render late data or start batch two after the page is left.
  let releaseWeather, releaseLogout;
  heldWeather = new Promise((resolve) => { releaseWeather = resolve; });
  heldLogout = new Promise((resolve) => { releaseLogout = resolve; });
  const manyPoints = fixtureTrip();
  manyPoints.weather.locations = Array.from({ length: 45 }, (_, index) => ({ id: `fictional-batch-${index}`, name: `Fictional point ${index}`, lat: -45 + index, lng: 20 }));
  manyPoints.days[0].weatherLocationIds = manyPoints.weather.locations.map(({id}) => id);
  manyPoints.days[1].weatherLocationIds = [];
  page = await loadPage({ server: createFakeServer(manyPoints) });
  await until(() => meteoLog.length === 1, "first batched forecast is pending");
  const signOut = [...page.doc.querySelectorAll("button")].find((button) => button.textContent === "Sign out");
  assert.ok(signOut);
  signOut.click();
  assert.equal(page.doc.body.children.length, 0, "sign-out clears the page before its response");
  releaseWeather();
  await wait(50);
  assert.equal(meteoLog.length, 1, "disposed weather never starts the second batch");
  assert.equal(page.doc.body.children.length, 0, "the late response cannot restore protected UI");
  releaseLogout();
  await wait(30);
} finally {
  if (activeWindow) { epoch += 1; activeWindow.close(); }
  timers.forEach(nativeClear); timers.clear();
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
  globalThis.fetch = nativeFetch;
}
console.log("Weather editor UI tests passed (jsdom simulation, fictional API, injected Open-Meteo).");
process.exit(0);
