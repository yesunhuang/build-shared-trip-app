// Recipient (anonymous read-only) itinerary page: jsdom DOM simulation against an in-memory fake of
// the fixed guest contract (GET /guest/trips/<id>, GET /guest/trips/<id>/media/<key>, header
// X-Trip-Share, generic 404 on any denial). Fictional fixtures only. This is jsdom evidence: it does
// not prove browser layout, physical-device, WeChat/in-app-browser or real network behaviour.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import {
  startGuestPage, chooseInitialDay, todayInZone, orderSlots, mapLinks, localized, parseShareLocation,
  pickLocale, resolveTheme, TRANSLATIONS, GUEST_LOCALES, DEFAULT_CONFIG
} from "../assets/selfhosted/guest.js";

const HTML = fs.readFileSync(new URL("../assets/selfhosted/guest.html", import.meta.url), "utf8");
const CSS = fs.readFileSync(new URL("../assets/selfhosted/guest.css", import.meta.url), "utf8");
const JS = fs.readFileSync(new URL("../assets/selfhosted/guest.js", import.meta.url), "utf8");
const ORIGIN = "https://trips.example.test";
const TRIP_ID = "fictional-lantern-weekend";
const MEDIA = `/guest/trips/${TRIP_ID}/media/`;
const PRETRIP = "2030-03-01T00:00:00Z";
const DURING_AUCKLAND = "2030-03-14T12:30:00Z"; // UTC date 03-14, Pacific/Auckland date 03-15
const POSTTRIP = "2030-05-01T00:00:00Z";
const FAST = { requestTimeoutMs: 300, mediaTimeoutMs: 300, retryDelaysMs: [20, 40, 60], pollMs: 600000, lifecycleGapMs: 0, maxRetryAfterMs: 50 };
const LEAK_MARKERS = ["FICTIONAL-EXCLUDED-BOOKING", "FICTIONAL-GROUP-SECRET", "FICTIONAL-COMPAT-SECRET", "SHOULD-NOT-RENDER", "FICTIONAL-I18N-BOOKING"];
const PNG = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
// Server-shaped guest media URLs, exactly as server/trip-sharing.mjs buildGuestProjection emits them:
// "/guest/trips/<id>/media/<cover|logo|plan-<slotId>>?h=" + sha256(embedded data | local pathname).hex[0..16].
const fingerprint = (source) => crypto.createHash("sha256").update(source).digest("hex").slice(0, 16);
const mediaUrl = (key, source) => MEDIA + key + "?h=" + fingerprint(source);
const COVER_V7 = mediaUrl("cover", "FICTIONAL-EMBEDDED-COVER-V7");
const COVER_V8 = mediaUrl("cover", "FICTIONAL-EMBEDDED-COVER-V8");
const LOGO_V7 = mediaUrl("logo", "FICTIONAL-EMBEDDED-LOGO-V7");
const FERRY_UPLOAD = mediaUrl("plan-s-ferry", "FICTIONAL-EMBEDDED-FERRY-UPLOAD");
const LUNCH_LOCAL = mediaUrl("plan-e-b", "/photos/fictional-lunch.webp"); // bound local photo
const SERVER_MEDIA_URL = /^\/guest\/trips\/fictional-lantern-weekend\/media\/(cover|logo|plan-[A-Za-z0-9][A-Za-z0-9._-]{0,99})\?h=[0-9a-f]{16}$/;

function fixtureTrip() {
  return {
    id: TRIP_ID, version: 7, title: "Fictional Lantern Harbor Weekend", timezone: "Pacific/Auckland", updatedAt: "2030-02-20T09:00:00.000Z",
    i18n: { "zh-Hans": { title: "虚构灯笼港周末" }, "zh-Hant": { title: "虛構燈籠港週末" }, ja: { title: "架空のランタン港週末" } },
    cover: { url: COVER_V7, alt: "Fictional harbor illustration", focusX: 30, focusY: 70 },
    branding: { theme: { preset: "ocean" }, logo: { url: LOGO_V7, alt: "Fictional lantern logo" } },
    days: [
      {
        id: "day-arrive", date: "2030-03-14", label: "Arrival", area: "Fictional Old Quay", summary: "Settle in and walk to dinner.",
        notes: "Meet at the blue lantern gate at 17:45.",
        i18n: { "zh-Hans": { label: "抵达", notes: "17:45在蓝色灯笼门集合。", secret: "SHOULD-NOT-RENDER" }, "zh-Hant": { label: "抵達" }, ja: { label: "到着" } },
        slots: [
          { id: "s-hotel", name: "Fictional Harbor Inn check-in", period: "noon", time: "From 15:00", sortTime: "15:00", planType: "stay", cardCategory: "hotel",
            address: "22 Fictional Lantern Lane", googleMapsUrl: "https://www.google.com/maps/search/?api=1&query=Fictional+Harbor+Inn",
            photo: { url: "https://images.example.org/fictional/inn.jpg", alt: "Fictional inn", credit: "Example Archive" } },
          { id: "s-ferry", name: "Fictional ferry to Old Quay", period: "noon", time: "14:10", sortTime: "14:10", planType: "transport", cardCategory: "ticketed-transport",
            address: "1 Fictional Pier Road", lat: -36.8, lng: 174.7, notes: "Platform 3. Show the e-ticket.",
            photo: { url: FERRY_UPLOAD, alt: "Fictional ferry", credit: "Fictional Photo Club", license: "CC BY 4.0",
              licenseUrl: "https://creativecommons.org/licenses/by/4.0/", sourceUrl: "https://commons.example.org/fictional-ferry" },
            i18n: { "zh-Hans": { name: "虚构渡轮前往老码头", booking: { code: "FICTIONAL-I18N-BOOKING" } }, "zh-Hant": { name: "虛構渡輪前往老碼頭" }, ja: { name: "架空のフェリーで旧埠頭へ" } } },
          { id: "s-dinner", name: "Dinner at Fictional Noodle House", period: "evening", time: "19:00", sortTime: "19:00", planType: "restaurant",
            address: "5 Fictional Market St", mapsUrl: "javascript:alert(1)", photo: { url: "/photos/private-unbound.jpg", alt: "unbound" } },
          { id: "s-walk", name: "Evening lantern walk", period: "evening", time: "20:30", sortTime: "20:30", planType: "sight",
            photo: { url: "/guest/trips/other-trip/media/cover?h=" + fingerprint("other"), alt: "cross trip" } }
        ]
      },
      {
        id: "day-explore", date: "2030-03-15", label: "Explore",
        slots: [
          { id: "e-c", name: "Fictional night market", period: "evening", time: "19:00", sortTime: "19:00", photo: { url: ORIGIN + "/photos/same-origin.jpg" } },
          { id: "e-a", name: "Fictional museum opening", period: "morning", time: "08:30", sortTime: "08:30", photo: { url: MEDIA + "../../../api/trips?h=" + fingerprint("traversal") } },
          { id: "e-b", name: "Fictional lunch", period: "noon", time: "From 13:00", sortTime: "13:00", photo: { url: LUNCH_LOCAL, alt: "Fictional lunch plate" } },
          { id: "e-d", name: "Fictional sunrise viewpoint", period: "morning", time: "07:15" },
          { id: "e-x", name: "Fictional flexible stroll" }
        ]
      },
      {
        id: "day-depart", date: "2030-03-16", label: "Departure",
        slots: [
          { id: "d-2", name: "Fictional airport train", sortOrder: 20, period: "morning", time: "10:00" },
          { id: "d-1", name: "Fictional checkout", sortOrder: 10, period: "morning", time: "11:00" }
        ]
      }
    ],
    reminders: [
      { id: "r2", item: "Bring a light jacket", dueDate: "2030-03-13" },
      { id: "r1", item: "Charge the fictional transit card", dueDate: "2030-03-10", notes: "Top-up kiosk near exit B.", i18n: { "zh-Hans": { item: "给虚构交通卡充值" } } }
    ],
    // Fields a faulty server might leak. The page renders by allowlist and must never show them.
    booking: { provider: "FICTIONAL-EXCLUDED-BOOKING" }, participantGroups: [{ name: "FICTIONAL-GROUP-SECRET" }], compat: { unmapped: "FICTIONAL-COMPAT-SECRET" }
  };
}

// In-memory fake of the guest endpoints, mirroring the fixed contract (generic 404 for every denial).
function createFakeServer(trip = fixtureTrip()) {
  const state = {
    token: crypto.randomBytes(32).toString("base64url"), enabled: true, expired: false, trip, mode: "online", mediaDelayMs: 0,
    // Keyed like the real media route (cover | logo | plan-<slotId>); the ?h= fingerprint only busts caches.
    media: new Map([["cover", PNG], ["logo", PNG], ["plan-s-ferry", PNG], ["plan-e-b", PNG]]),
    requests: [], late: []
  };
  const generic404 = () => new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  state.fetch = async (input, init = {}) => {
    const url = String(input);
    state.requests.push({ url, init: { ...init, headers: { ...init.headers } } });
    if (state.mode === "offline") throw new TypeError("Failed to fetch");
    if (state.mode === "hang") return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    if (state.mode === "late") return new Promise((resolve) => state.late.push(() => resolve(new Response(JSON.stringify({ trip: structuredClone(state.trip) }), { status: 200, headers: { "content-type": "application/json" } }))));
    if (state.mode === "unavailable") return new Response("", { status: 503, headers: { "retry-after": "1" } });
    if (!url.startsWith("/guest/trips/") || !["GET", "HEAD"].includes(init.method || "GET")) return generic404();
    if (init.credentials !== "omit") return generic404();
    if (!state.enabled || state.expired || init.headers?.["X-Trip-Share"] !== state.token) return generic404();
    // Mirrors the real routing: the route is matched on the pathname (GUEST_TRIP_ROUTE / GUEST_MEDIA_ROUTE);
    // a media URL may carry only the projection's ?h=<16 hex> fingerprint, the trip URL no query at all.
    const parsed = new URL(url, ORIGIN);
    if (parsed.origin !== ORIGIN || parsed.hash || url.includes("#")) return generic404();
    const match = parsed.pathname.match(/^\/guest\/trips\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})(?:\/media\/(cover|logo|plan-[A-Za-z0-9][A-Za-z0-9._-]{0,99}))?$/);
    if (!match || match[1] !== state.trip.id) return generic404();
    if (parsed.search && (match[2] === undefined || !/^\?h=[0-9a-f]{16}$/.test(parsed.search))) return generic404();
    if (match[2] !== undefined) {
      const bytes = state.media.get(match[2]);
      if (!bytes) return generic404();
      if (state.mediaDelayMs) await new Promise((resolve) => setTimeout(resolve, state.mediaDelayMs));
      const headers = { "content-type": "image/png", "cache-control": "no-store" };
      if (!state.omitMediaLength) headers["content-length"] = String(bytes.length);
      return new Response(bytes, { status: 200, headers });
    }
    return new Response(JSON.stringify({ trip: structuredClone(state.trip) }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  };
  state.tripRequests = () => state.requests.filter((request) => !request.url.includes("/media/")).length;
  state.mediaRequests = () => state.requests.filter((request) => request.url.includes("/media/"));
  return state;
}

const errors = [];
const pages = [];
let blobSeq = 0;
async function until(predicate, label, ms = 4000) {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error("Timed out: " + label); await new Promise((resolve) => setTimeout(resolve, 5)); }
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function openPage(server, { hash, now = PRETRIP, locale, languages, config = {}, navigator = {} } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => { if (!String(error.message).includes("Not implemented: navigation")) errors.push(error.message); });
  const dom = new JSDOM(HTML, { url: `${ORIGIN}/s/${TRIP_ID}${hash ?? "#" + server.token}`, pretendToBeVisual: true, virtualConsole });
  const { window } = dom;
  const blobs = { created: [], live: new Set(), revoked: [] };
  window.URL.createObjectURL = () => { const url = `blob:${ORIGIN}/fake-${++blobSeq}`; blobs.created.push(url); blobs.live.add(url); return url; };
  window.URL.revokeObjectURL = (url) => { blobs.live.delete(url); blobs.revoked.push(url); };
  if (languages) Object.defineProperty(window.navigator, "languages", { value: languages, configurable: true });
  for (const [name, value] of Object.entries(navigator)) Object.defineProperty(window.navigator, name, { value, configurable: true });
  const reloads = { count: 0 };
  const controller = startGuestPage({ window, fetch: server.fetch, now: () => new Date(now), locale, config: { ...FAST, ...config }, setTimeout, clearTimeout, reload: () => { reloads.count += 1; } });
  const page = { window, document: window.document, controller, blobs, reloads, byId: (id) => window.document.getElementById(id) };
  page.fire = (node, type, Ctor = window.Event, init = {}) => node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, ...init }));
  page.text = () => window.document.body.textContent;
  page.pressed = () => [...window.document.querySelectorAll("#day-list button")].findIndex((button) => button.getAttribute("aria-pressed") === "true");
  page.slotIds = () => [...window.document.querySelectorAll("#slots > li")].map((li) => li.dataset.slotId);
  page.click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  page.focusWindow = () => window.dispatchEvent(new window.Event("focus"));
  page.ready = () => until(() => !page.byId("trip").hidden && page.byId("trip-title").textContent, "trip rendered");
  page.close = () => { controller.close(); window.close(); };
  pages.push(page);
  return page;
}

function assertGuestRequests(server) {
  for (const { url, init } of server.requests) {
    assert.ok(url.startsWith(`/guest/trips/${TRIP_ID}`), "only same-origin guest endpoints are requested: " + url);
    assert.ok(!url.includes(server.token), "the token never appears in a URL");
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit"); assert.equal(init.referrerPolicy, "no-referrer"); assert.equal(init.cache, "no-store");
    assert.equal(init.headers["X-Trip-Share"], server.token, "the capability travels only in the header");
    assert.ok(!/\/(api|mcp|photos)\//.test(url) && !url.includes("other-trip") && !url.includes(".."), "no protected, cross-trip or traversal request: " + url);
    assert.ok(!url.includes("#"), "no fragment is ever requested: " + url);
    if (url.includes("/media/")) assert.match(url, SERVER_MEDIA_URL, "media is requested only at the exact server-shaped fingerprinted URL");
    else assert.equal(url, `/guest/trips/${TRIP_ID}`, "the trip read carries no query");
  }
}

function assertNoPersistence(page, token) {
  assert.equal(page.window.localStorage.length, 0, "no localStorage"); assert.equal(page.window.sessionStorage.length, 0, "no sessionStorage");
  assert.equal(page.document.cookie, "", "no cookies or derived guest session");
  if (token) assert.ok(!page.document.documentElement.outerHTML.includes(token), "the token is not written into the DOM");
}

try {
  // ------------------------------------------------------------ static contract checks
  assert.match(HTML, /<meta name="referrer" content="no-referrer">/);
  assert.match(HTML, /<meta name="robots" content="noindex/);
  assert.ok(!/rel="manifest"|serviceWorker|apple-mobile-web-app-capable/.test(HTML), "no install prompt / manifest / service worker");
  assert.ok(!/href="#/.test(HTML), "no in-page hash links that would replace the token fragment");
  assert.ok(!/<a [^>]*href="\/(login|api|trips)|sign ?in|log ?in/i.test(HTML), "no login/account/admin links");
  assert.ok(!HTML.includes("Fictional"), "unfurl shell is generic");
  assert.ok(!/\blocalStorage\b|\bsessionStorage\b|indexedDB|document\.cookie|serviceWorker|sendBeacon|innerHTML|insertAdjacentHTML|eval\(/.test(JS), "no storage, cookies, beacons or HTML injection in guest.js");
  assert.ok(!/^\s*import\s/m.test(JS), "guest.js is standalone (no imports)");
  assert.match(CSS, /\.g-button \{[^}]*min-height: 48px/); assert.match(CSS, /\.g-day-button \{[^}]*min-height: 56px/);
  assert.match(CSS, /\.g-lang select \{[^}]*min-height: 44px/);
  for (const [, value] of CSS.matchAll(/(?<!max-)width:\s*(\d+)px/g)) assert.ok(Number(value) <= 48, "no fixed widths that break 320px: " + value);
  assert.match(CSS, /@media \(max-width: 380px\)/);
  assert.match(CSS, /body \{ font-size: 1\.125rem/, "rem-based base text scales with 200% text settings");

  // ------------------------------------------------------------ pure helpers
  assert.equal(todayInZone("Pacific/Auckland", new Date(DURING_AUCKLAND)), "2030-03-15");
  assert.equal(todayInZone("UTC", new Date(DURING_AUCKLAND)), "2030-03-14");
  assert.equal(todayInZone("America/Los_Angeles", new Date("2030-03-15T05:00:00Z")), "2030-03-14");
  assert.match(todayInZone("Not/AZone", new Date(DURING_AUCKLAND)), /^\d{4}-\d{2}-\d{2}$/, "invalid zone falls back to the device zone");
  const sampleDays = fixtureTrip().days;
  assert.deepEqual(chooseInitialDay(sampleDays, "2030-03-01"), { index: 0, phase: "before" });
  assert.deepEqual(chooseInitialDay(sampleDays, "2030-03-15"), { index: 1, phase: "during" });
  assert.deepEqual(chooseInitialDay(sampleDays, "2030-04-01"), { index: 2, phase: "after" });
  assert.deepEqual(chooseInitialDay([{ id: "a", date: "2030-03-14" }, { id: "b", date: "2030-03-17" }], "2030-03-15"), { index: 0, phase: "during" }, "gap shows latest past day");
  assert.deepEqual(chooseInitialDay([{ id: "a" }, { id: "b", date: "" }], "2030-03-15"), { index: 0, phase: "undated" });
  assert.deepEqual(chooseInitialDay([], "2030-03-15"), { index: -1, phase: "empty" });
  assert.deepEqual(orderSlots(sampleDays[1].slots).map((slot) => slot.id), ["e-d", "e-a", "e-b", "e-c", "e-x"]);
  assert.deepEqual(orderSlots(sampleDays[2].slots).map((slot) => slot.id), ["d-1", "d-2"], "explicit sortOrder wins");
  assert.deepEqual(orderSlots(sampleDays[0].slots).map((slot) => slot.id), ["s-ferry", "s-hotel", "s-dinner", "s-walk"]);
  assert.equal(localized(sampleDays[0], "secret", "zh-Hans", "day"), "", "non-allowlisted i18n field is ignored");
  assert.equal(localized(sampleDays[0].slots[1], "booking", "zh-Hans", "slot"), "");
  assert.equal(localized({ title: "Base", i18n: { ja: { title: { nested: "x" } } } }, "title", "ja", "trip"), "Base", "nested i18n objects are ignored");
  assert.deepEqual(parseShareLocation({ pathname: "/s/" + TRIP_ID, hash: "#short" }), { tripId: TRIP_ID, token: "" });
  assert.deepEqual(parseShareLocation({ pathname: "/s/../api", hash: "" }).tripId, "");
  assert.equal(pickLocale(["zh-TW"]), "zh-Hant"); assert.equal(pickLocale(["zh-Hant-HK"]), "zh-Hant"); assert.equal(pickLocale(["zh-CN"]), "zh-Hans");
  assert.equal(pickLocale(["ja-JP"]), "ja"); assert.equal(pickLocale(["fr-FR"]), "en");
  assert.deepEqual(mapLinks({ name: "X", lat: 0, lng: 0 }), { google: "", osm: "" }, "null island is not a location");
  assert.equal(mapLinks({ name: "X", address: "Y", mapsUrl: "https://evil.example/maps" }).google, "https://www.google.com/maps/search/?api=1&query=X%2C%20Y", "non-Google stored URL is ignored");
  assert.equal(resolveTheme({ preset: "custom", ink: "#aaaaaa", accent: "#000000", background: "#ffffff" }).ink, "#17362f", "low-contrast custom theme falls back");
  assert.equal(resolveTheme({ preset: "ocean" }).ink, "#173b50");
  for (const locale of GUEST_LOCALES) assert.deepEqual(Object.keys(TRANSLATIONS[locale]).sort(), Object.keys(TRANSLATIONS.en).sort(), locale + " has every string");
  assert.match(HTML, /<button id="check-updates" type="button" class="g-button[^"]*"[^>]*data-text="checkUpdates">Check for updates<\/button>/, "native, labelled manual update button");
  assert.deepEqual(GUEST_LOCALES.map((locale) => TRANSLATIONS[locale].checkUpdates), ["Check for updates", "检查更新", "檢查更新", "更新を確認"]);
  assert.ok(!/window\.open|preventDefault|stopPropagation/.test(JS), "the link guard never emulates or blocks native link activation");
  assert.ok(!/href="#/.test(HTML), "still no in-page hash links");

  // ------------------------------------------------------------ valid anonymous read, media, redaction, pre-trip
  {
    const server = createFakeServer();
    const page = openPage(server, { now: PRETRIP, locale: "en" });
    await page.ready();
    assert.equal(page.byId("trip-title").textContent, "Fictional Lantern Harbor Weekend");
    assert.equal(page.document.title, "Fictional Lantern Harbor Weekend");
    assert.equal(page.pressed(), 0, "pre-departure shows the first day");
    assert.equal(page.byId("trip-phase").dataset.phase, "before");
    assert.equal(page.byId("day-heading").textContent, "Arrival");
    assert.equal(page.byId("day-date").textContent, new Intl.DateTimeFormat("en", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2030, 2, 14))));
    assert.ok(page.byId("day-date").textContent.includes("Thursday"), "selected weekday is shown");
    const buttons = [...page.document.querySelectorAll("#day-list button")];
    assert.equal(buttons.length, 3);
    assert.ok(buttons[0].textContent.includes("Arrival") && buttons[0].textContent.includes("Thu"), "day control shows label and weekday/date");
    assert.deepEqual(page.slotIds(), ["s-ferry", "s-hotel", "s-dinner", "s-walk"], "chronological slots");
    const ferry = page.document.querySelector('[data-slot-id="s-ferry"]');
    assert.equal(ferry.querySelector(".g-slot-time").textContent, "14:10");
    assert.ok(ferry.querySelector(".g-slot-type").textContent.includes("Transport") && ferry.querySelector(".g-slot-type").textContent.includes("Ticketed transport"));
    assert.ok(ferry.querySelector(".g-important").textContent.includes("Platform 3. Show the e-ticket."), "plan notes are emphasised");
    assert.ok(page.byId("day-info").querySelector(".g-important").textContent.includes("blue lantern gate"), "day meeting note is emphasised");
    assert.ok(ferry.querySelector("figcaption").textContent.includes("Photo: Fictional Photo Club") && ferry.querySelector("figcaption").textContent.includes("CC BY 4.0"), "photo credit and license shown");
    for (const a of ferry.querySelectorAll("figcaption a")) { assert.equal(a.target, "_blank"); assert.match(a.rel, /noopener/); assert.match(a.rel, /noreferrer/); }

    // Header-authenticated media → memory blob URLs; cover, logo and uploaded plan photo.
    await until(() => page.byId("cover-img").src.startsWith("blob:") && page.byId("logo").src.startsWith("blob:") && ferry.querySelector("img").src.startsWith("blob:"), "media blobs");
    assert.equal(page.byId("cover").hidden, false); assert.equal(page.byId("logo").hidden, false);
    assert.equal(page.byId("logo").alt, "Fictional lantern logo"); assert.equal(page.byId("cover-img").alt, "Fictional harbor illustration");
    const mediaUrls = server.mediaRequests().map((request) => request.url).sort();
    assert.deepEqual(mediaUrls, [COVER_V7, LOGO_V7, FERRY_UPLOAD].sort(), "only bound media of this trip is requested, at its exact fingerprinted URL");
    for (const url of mediaUrls) assert.match(url, /\?h=[0-9a-f]{16}$/, "server-shaped ?h= fingerprint is kept, nothing appended");
    for (const request of server.mediaRequests()) {
      assert.deepEqual(request.init.headers, { "X-Trip-Share": server.token, Accept: "image/*" }, "media uses only the share header");
      assert.equal(request.init.credentials, "omit"); assert.equal(request.init.referrerPolicy, "no-referrer");
    }
    for (const img of [page.byId("cover-img"), page.byId("logo"), ferry.querySelector("img")]) {
      assert.ok(!img.src.includes(server.token) && !img.dataset.mediaUrl.includes(server.token), "the token is never put in an image URL");
    }
    // Remote HTTP(S) photo loads directly, without token or referrer; unbound/same-origin/cross-trip URLs are dropped.
    const inn = page.document.querySelector('[data-slot-id="s-hotel"] img');
    assert.equal(inn.getAttribute("src"), "https://images.example.org/fictional/inn.jpg");
    assert.equal(inn.getAttribute("referrerpolicy"), "no-referrer");
    assert.ok(!inn.src.includes(server.token));
    assert.equal(page.document.querySelector('[data-slot-id="s-dinner"] img'), null, "/photos URL is never rendered");
    assert.equal(page.document.querySelector('[data-slot-id="s-walk"] img'), null, "cross-trip media URL is never rendered");
    assert.ok(!page.document.querySelector('[data-slot-id="s-walk"] .g-place'), "no invented place for a plan without address or coordinates");

    // Reminders sorted by due date.
    assert.deepEqual([...page.document.querySelectorAll("#reminder-list .g-reminder-item")].map((n) => n.textContent), ["Charge the fictional transit card", "Bring a light jacket"]);
    assert.ok(page.byId("reminder-list").textContent.includes("Top-up kiosk near exit B."));

    // Visit every day: allowlist rendering never leaks excluded or non-allowlisted fields.
    for (const button of page.document.querySelectorAll("#day-list button")) {
      page.click(button);
      for (const marker of LEAK_MARKERS) assert.ok(!page.text().includes(marker), "never rendered: " + marker);
    }
    page.click(page.document.querySelectorAll("#day-list button")[1]);
    assert.deepEqual(page.slotIds(), ["e-d", "e-a", "e-b", "e-c", "e-x"]);
    assert.equal(page.document.activeElement, page.byId("day-heading"), "choosing a day moves focus to its heading");
    // Bound local photo, served through the fingerprinted guest media route.
    await until(() => page.document.querySelector('[data-slot-id="e-b"] img')?.src.startsWith("blob:"), "local photo blob");
    assert.equal(page.document.querySelector('[data-slot-id="e-b"] img').dataset.mediaUrl, LUNCH_LOCAL);
    assert.ok(server.mediaRequests().some((request) => request.url === LUNCH_LOCAL), "local photo fetched at its exact fingerprinted URL");
    assert.equal(page.document.querySelector('[data-slot-id="e-a"] img'), null, "path traversal media URL is never rendered");
    assert.equal(page.document.querySelector('[data-slot-id="e-c"] img'), null, "same-origin absolute URL is never rendered");
    assert.ok(page.document.querySelector('[data-slot-id="e-x"] .g-slot-time') === null, "no invented time");
    page.click(page.document.querySelectorAll("#day-list button")[2]);
    assert.deepEqual(page.slotIds(), ["d-1", "d-2"]);
    assert.equal(page.byId("next-day").disabled, true); assert.equal(page.byId("prev-day").disabled, false);
    page.click(page.byId("prev-day")); assert.equal(page.pressed(), 1);

    assert.ok(!page.text().match(/sign in|log in|install|edit|members|admin/i), "no login/install/edit/account/admin controls");
    assert.equal(page.document.querySelectorAll("input:not([readonly]), textarea, form").length, 0, "no editing inputs");
    assertGuestRequests(server); assertNoPersistence(page, server.token);
    page.close();
  }

  // ------------------------------------------------------------ today in the trip timezone, post-trip, undated
  {
    const server = createFakeServer();
    const during = openPage(server, { now: DURING_AUCKLAND, locale: "en" });
    await during.ready();
    assert.equal(during.pressed(), 1, "UTC is still 03-14 but Auckland is 03-15: today's day is selected");
    const todayButton = during.document.querySelectorAll("#day-list button")[1];
    assert.equal(todayButton.getAttribute("aria-current"), "date"); assert.ok(todayButton.textContent.includes("Today"));
    assert.ok(during.byId("day-date").textContent.endsWith("· Today"));
    assert.equal(during.byId("trip-phase").dataset.phase, "during");
    during.close();

    const after = openPage(server, { now: POSTTRIP, locale: "en" });
    await after.ready();
    assert.equal(after.pressed(), 2, "after the trip the last day is shown");
    assert.equal(after.byId("trip-phase").dataset.phase, "after");
    after.click(after.byId("prev-day")); after.click(after.byId("prev-day"));
    assert.equal(after.pressed(), 0, "all previous days stay accessible");
    assert.equal(after.byId("prev-day").disabled, true);
    after.close();

    const undatedTrip = fixtureTrip(); for (const day of undatedTrip.days) delete day.date;
    const undatedServer = createFakeServer(undatedTrip);
    const undated = openPage(undatedServer, { now: DURING_AUCKLAND, locale: "en" });
    await undated.ready();
    assert.equal(undated.pressed(), 0); assert.equal(undated.byId("trip-phase").dataset.phase, "undated");
    assert.equal(undated.byId("day-date").textContent, "Date not set");
    assert.ok(undated.document.querySelector("#day-list button").textContent.includes("Date not set"));
    undated.close();
  }

  // ------------------------------------------------------------ latest content, preserved day, unchanged reading not rebuilt
  {
    const server = createFakeServer();
    const page = openPage(server, { now: DURING_AUCKLAND, locale: "en" });
    await page.ready();
    page.click(page.document.querySelectorAll("#day-list button")[2]);
    assert.equal(page.pressed(), 2);
    const before = page.document.querySelector("#slots > li");
    const tripCalls = server.tripRequests();
    page.focusWindow();
    await until(() => server.tripRequests() === tripCalls + 1 && page.byId("refresh-status").textContent.startsWith("Up to date"), "unchanged refresh");
    assert.equal(page.document.querySelector("#slots > li"), before, "unchanged content is not rebuilt");
    assert.equal(page.pressed(), 2);

    await until(() => page.byId("cover-img").src.startsWith("blob:"), "initial cover blob");
    await until(() => page.byId("logo").src.startsWith("blob:"), "initial logo blob");
    const oldCover = page.byId("cover-img").src;
    const oldLogo = page.byId("logo").src;
    const logoFetches = () => server.mediaRequests().filter((request) => request.url === LOGO_V7).length;
    assert.equal(logoFetches(), 1);
    server.trip.version = 8; server.trip.days[2].slots[1].name = "Fictional checkout (moved to lobby)";
    server.trip.cover = { url: COVER_V8, alt: "Fictional harbor illustration v8" }; // new bytes -> new fingerprint
    page.document.dispatchEvent(new page.window.Event("visibilitychange"));
    await until(() => page.text().includes("Fictional checkout (moved to lobby)"), "latest content");
    assert.equal(page.pressed(), 2, "chosen day is preserved across a content update");
    assert.equal(page.byId("refresh-status").dataset.state, "ok");
    await until(() => page.byId("cover-img").src.startsWith("blob:") && page.byId("cover-img").src !== oldCover, "replacement cover blob");
    assert.equal(page.byId("cover-img").dataset.mediaUrl, COVER_V8);
    assert.equal(server.mediaRequests().filter((request) => request.url === COVER_V8).length, 1, "new fingerprint is fetched once");
    assert.ok(page.blobs.revoked.includes(oldCover), "replaced blob URL is revoked");
    assert.ok(!page.blobs.live.has(oldCover));
    await pause(40);
    await until(() => page.byId("logo").src !== oldLogo, "image revalidated after changed content");
    assert.equal(logoFetches(), 2, "saved content refresh rechecks current authorized image bytes");
    assert.ok(page.blobs.revoked.includes(oldLogo));
    assert.ok(page.blobs.live.has(page.byId("logo").src));

    // Selected day removed by the organizer: stay near the same position instead of jumping to today.
    server.trip.version = 9; server.trip.days.splice(2, 1);
    page.focusWindow();
    await until(() => page.document.querySelectorAll("#day-list button").length === 2, "day removed");
    assert.equal(page.pressed(), 1);

    // Language switch re-renders from memory without refetch and keeps the chosen day.
    page.click(page.document.querySelectorAll("#day-list button")[0]); // first view of day 0 fetches its photo once
    await until(() => page.document.querySelector('[data-slot-id="s-ferry"] img').src.startsWith("blob:"), "day 0 photo blob");
    const callsBeforeSwitch = server.requests.length;
    const select = page.byId("language"); select.value = "ja"; select.dispatchEvent(new page.window.Event("change"));
    assert.equal(page.pressed(), 0); assert.equal(page.byId("day-heading").textContent, "到着");
    assert.equal(server.requests.length, callsBeforeSwitch, "no network request for a language switch");
    assertGuestRequests(server); assertNoPersistence(page, server.token);
    page.close();
  }

  // ------------------------------------------------------------ bounded polling, hidden pages do not poll
  {
    const server = createFakeServer();
    const page = openPage(server, { config: { pollMs: 25, maxPolls: 3 } });
    await page.ready();
    await until(() => server.tripRequests() === 4, "three bounded polls");
    await pause(120);
    assert.equal(server.tripRequests(), 4, "polling stops at the bound");
    page.close();

    const hiddenServer = createFakeServer();
    const hidden = openPage(hiddenServer, { config: { pollMs: 25, maxPolls: 50 } });
    await hidden.ready();
    Object.defineProperty(hidden.document, "visibilityState", { value: "hidden", configurable: true });
    const calls = hiddenServer.tripRequests();
    await pause(120);
    assert.ok(hiddenServer.tripRequests() <= calls + 1, "no polling requests while the page is hidden");
    hidden.close();
  }

  // ------------------------------------------------------------ revocation / rotation / expiry: immediate hide, no automatic re-polling
  {
    const server = createFakeServer();
    const page = openPage(server, { locale: "en" });
    await page.ready();
    await until(() => page.blobs.live.size === 3, "three media blobs");
    server.token = crypto.randomBytes(32).toString("base64url"); // explicit rotation
    page.focusWindow();
    await until(() => !page.byId("denied").hidden, "denied after rotation");
    assert.equal(page.byId("trip").hidden, true);
    assert.equal(page.byId("denied-title").textContent, "This link is not available");
    assert.ok(!page.text().includes("Fictional"), "old content removed from the DOM immediately");
    assert.equal(page.blobs.live.size, 0, "every blob URL is revoked on denial");
    for (const img of page.document.querySelectorAll("img")) assert.ok(!img.getAttribute("src"), "no image source survives denial");
    assert.equal(page.document.title, "Shared itinerary");
    assert.ok(!/404|403|401|410/.test(page.text()), "no raw HTTP codes");
    const calls = server.requests.length;
    page.focusWindow(); page.window.dispatchEvent(new page.window.Event("online"));
    await pause(60);
    assert.equal(server.requests.length, calls, "no automatic requests after a definitive denial");
    page.click(page.byId("denied-retry"));
    await until(() => server.requests.length === calls + 1 && !page.byId("denied").hidden && !page.controller.state.inFlight, "manual check stays denied");
    page.close();

    // Revocation while a slow media response is still in flight: the late image is discarded.
    const slow = createFakeServer(); slow.mediaDelayMs = 80;
    const late = openPage(slow, { locale: "en" });
    await late.ready();
    slow.enabled = false; // revoked
    late.focusWindow();
    await until(() => !late.byId("denied").hidden, "denied before media arrived");
    await pause(200);
    assert.equal(late.blobs.created.length, 0, "late media after denial never becomes a blob URL");
    late.close();

    // Expiry behaves identically (generic 404).
    const expiring = createFakeServer();
    const expPage = openPage(expiring, { locale: "zh-Hans" });
    await expPage.ready();
    expiring.expired = true; expPage.focusWindow();
    await until(() => !expPage.byId("denied").hidden, "denied after expiry");
    assert.equal(expPage.document.querySelector("#denied [data-text=deniedBody]").textContent, "这个分享链接已关闭，请联系发给你的人获取新链接。");
    expPage.close();
  }

  // ------------------------------------------------------------ invalid or missing tokens: no request at all / generic 404
  {
    const server = createFakeServer();
    for (const hash of ["", "#", "#short-token", "#" + "a".repeat(44), "#" + server.token.slice(0, 42) + "!"]) {
      const page = openPage(server, { hash, locale: "en" });
      await pause(5);
      assert.equal(page.byId("denied").hidden, false, "malformed token shows the friendly message: " + JSON.stringify(hash));
      assert.equal(page.byId("trip").hidden, true);
      page.close();
    }
    assert.equal(server.requests.length, 0, "malformed or missing tokens never reach the server");
    const wrong = openPage(server, { hash: "#" + crypto.randomBytes(32).toString("base64url"), locale: "en" });
    await until(() => !wrong.byId("denied").hidden, "wrong token denied");
    assert.equal(server.requests.length, 1); assert.equal(wrong.controller.state.hasTrip, false);
    wrong.close();
  }

  // ------------------------------------------------------------ poor network: error, bounded retries, retry button, stale warning, recovery
  {
    const server = createFakeServer(); server.mode = "offline";
    const page = openPage(server, { locale: "en" });
    await until(() => server.tripRequests() === 4 && page.byId("refresh-status").textContent.startsWith("Could not refresh at") && !page.controller.state.inFlight, "bounded automatic retries");
    await pause(150);
    assert.equal(server.tripRequests(), 4, "1 attempt + 3 bounded retries, then stop");
    assert.equal(page.byId("error").hidden, false); assert.equal(page.byId("denied").hidden, true, "network failure is not a denial");
    assert.equal(page.byId("refresh-status").dataset.state, "error");
    server.mode = "online";
    page.click(page.byId("retry"));
    await page.ready();
    assert.equal(page.byId("error").hidden, true);

    server.mode = "offline"; page.focusWindow();
    await until(() => !page.byId("stale").hidden, "stale warning");
    assert.equal(page.byId("trip").hidden, false, "content stays readable while stale");
    assert.ok(page.text().includes("Fictional Lantern Harbor Weekend"));
    server.mode = "online"; page.window.dispatchEvent(new page.window.Event("online"));
    await until(() => page.byId("stale").hidden && page.byId("refresh-status").dataset.state === "ok", "recovered");

    server.mode = "unavailable"; page.focusWindow();
    await until(() => !page.byId("stale").hidden, "503 is transient");
    assert.equal(page.byId("denied").hidden, true);
    server.mode = "online"; page.click(page.byId("stale-retry"));
    await until(() => page.byId("stale").hidden, "manual stale retry");
    page.close();

    // Timeout: a hanging request is aborted and reported as a retryable error.
    const hanging = createFakeServer(); hanging.mode = "hang";
    const hangPage = openPage(hanging, { locale: "en", config: { requestTimeoutMs: 40, retryDelaysMs: [] } });
    await until(() => !hangPage.byId("error").hidden, "timeout error");
    assert.equal(hanging.requests[0].init.signal.aborted, true, "request aborted by timeout");
    hangPage.close();

    // Late response after close is ignored.
    const lateServer = createFakeServer(); lateServer.mode = "late";
    const latePage = openPage(lateServer, { locale: "en" });
    await until(() => lateServer.late.length === 1, "late request pending");
    latePage.controller.close();
    lateServer.late[0]();
    await pause(40);
    assert.equal(latePage.byId("trip").hidden, true); assert.equal(latePage.byId("trip-title").textContent, "");
    assert.equal(latePage.blobs.created.length, 0); assert.equal(lateServer.requests.length, 1);
    assert.equal(latePage.controller.state.timerCount, 0, "no timers remain after close");
    latePage.window.close();
  }

  // ------------------------------------------------------------ maps and address copy fallback
  {
    const server = createFakeServer();
    const page = openPage(server, { locale: "en" });
    await page.ready();
    const links = (id) => [...page.document.querySelectorAll(`[data-slot-id="${id}"] .g-place-actions a`)];
    const [ferryGoogle, ferryOsm] = links("s-ferry");
    assert.equal(ferryGoogle.href, "https://www.google.com/maps/search/?api=1&query=-36.8%2C174.7", "coordinates first");
    assert.equal(ferryOsm.href, "https://www.openstreetmap.org/?mlat=-36.8&mlon=174.7#map=17/-36.8/174.7", "web fallback via coordinates");
    assert.equal(ferryGoogle.textContent, "Google Maps");
    assert.equal(ferryGoogle.getAttribute("aria-label"), "Open Fictional ferry to Old Quay in Google Maps (opens in a new tab)");
    const [innGoogle, innOsm] = links("s-hotel");
    assert.equal(innGoogle.href, "https://www.google.com/maps/search/?api=1&query=Fictional+Harbor+Inn", "stored Google Maps URL");
    assert.equal(innOsm.href, "https://www.openstreetmap.org/search?query=" + encodeURIComponent("Fictional Harbor Inn check-in, 22 Fictional Lantern Lane"), "web fallback by name/address");
    const [dinnerGoogle] = links("s-dinner");
    assert.ok(dinnerGoogle.href.startsWith("https://www.google.com/maps/search/?api=1&query=Dinner"), "javascript: mapsUrl ignored");
    for (const a of page.document.querySelectorAll("a")) {
      assert.equal(a.target, "_blank"); assert.match(a.rel, /noopener/); assert.match(a.rel, /noreferrer/);
      assert.equal(a.getAttribute("referrerpolicy"), "no-referrer"); assert.ok(!a.href.includes(server.token), "external links never carry the token");
      assert.match(a.href, /^https:\/\//);
    }
    // No Clipboard API (common in in-app browsers): the address is selected for native copy.
    const ferry = page.document.querySelector('[data-slot-id="s-ferry"]');
    assert.equal(ferry.querySelector(".g-address-text").textContent, "1 Fictional Pier Road");
    page.click(ferry.querySelector(".g-place-actions button"));
    await until(() => ferry.querySelector(".g-place .g-note").textContent !== "", "copy fallback");
    assert.equal(ferry.querySelector(".g-place .g-note").textContent, "The address is selected. Press and hold it to copy.");
    assert.equal(page.window.getSelection().getRangeAt(0).toString(), "1 Fictional Pier Road");
    page.close();

    const written = [];
    const clip = openPage(server, { locale: "en", navigator: { clipboard: { writeText: async (value) => { written.push(value); } } } });
    await clip.ready();
    const hotel = clip.document.querySelector('[data-slot-id="s-hotel"]');
    clip.click(hotel.querySelector(".g-place-actions button"));
    await until(() => hotel.querySelector(".g-place .g-note").textContent === "Address copied.", "clipboard copy");
    assert.deepEqual(written, ["22 Fictional Lantern Lane"]);
    clip.close();

    const rejecting = openPage(server, { locale: "zh-Hant", navigator: { clipboard: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } } } });
    await rejecting.ready();
    const ferry2 = rejecting.document.querySelector('[data-slot-id="s-ferry"]');
    rejecting.click(ferry2.querySelector(".g-place-actions button"));
    await until(() => ferry2.querySelector(".g-place .g-note").textContent === TRANSLATIONS["zh-Hant"].copyManual, "rejected clipboard falls back");
    rejecting.close();
  }

  // ------------------------------------------------------------ share: navigator.share only on click; selectable fallback
  {
    const server = createFakeServer();
    const plain = openPage(server, { locale: "en" });
    await plain.ready();
    assert.equal(plain.byId("share-fallback").hidden, true);
    plain.click(plain.byId("share-button"));
    await until(() => !plain.byId("share-fallback").hidden, "share fallback");
    assert.equal(plain.byId("share-url").value, plain.window.location.href);
    assert.ok(plain.byId("share-url").value.endsWith("#" + server.token), "copied link keeps the fragment so the recipient link works");
    assert.ok(plain.byId("share-url").readOnly);
    assert.equal(plain.byId("share-status").textContent, "Copy the link below.");
    assertNoPersistence(plain);
    plain.close();

    const shared = [];
    const native = openPage(server, { locale: "en", navigator: { share: async (data) => { shared.push(data); } } });
    await native.ready(); await pause(20);
    assert.equal(shared.length, 0, "navigator.share is never called without a click");
    native.click(native.byId("share-button"));
    await until(() => native.byId("share-status").textContent === "Link shared.", "native share");
    assert.equal(shared.length, 1); assert.equal(shared[0].url, native.window.location.href);
    assert.equal(shared[0].title, "Shared itinerary", "generic share title");
    native.close();

    const cancelled = openPage(server, { locale: "en", navigator: { share: async () => { throw new DOMException("cancel", "AbortError"); } } });
    await cancelled.ready();
    cancelled.click(cancelled.byId("share-button")); await pause(20);
    assert.equal(cancelled.byId("share-fallback").hidden, true, "cancelling the share sheet does not show a fallback");
    cancelled.close();
  }

  // ------------------------------------------------------------ all four locales (detected from navigator.languages)
  {
    const server = createFakeServer();
    const cases = [
      ["en", ["en-GB"], "Fictional Lantern Harbor Weekend", "Arrival", "Fictional ferry to Old Quay", "Meet at the blue lantern gate at 17:45."],
      ["zh-Hans", ["zh-CN"], "虚构灯笼港周末", "抵达", "虚构渡轮前往老码头", "17:45在蓝色灯笼门集合。"],
      ["zh-Hant", ["zh-TW"], "虛構燈籠港週末", "抵達", "虛構渡輪前往老碼頭", "Meet at the blue lantern gate at 17:45."],
      ["ja", ["ja-JP"], "架空のランタン港週末", "到着", "架空のフェリーで旧埠頭へ", "Meet at the blue lantern gate at 17:45."]
    ];
    for (const [locale, languages, title, dayLabel, slotName, dayNote] of cases) {
      const page = openPage(server, { languages, now: PRETRIP });
      await page.ready();
      assert.equal(page.document.documentElement.lang, locale);
      assert.equal(page.byId("language").value, locale);
      for (const node of page.document.querySelectorAll("[data-text]")) assert.equal(node.textContent, TRANSLATIONS[locale][node.dataset.text], locale + " " + node.dataset.text);
      assert.equal(page.byId("trip-title").textContent, title);
      assert.equal(page.byId("day-heading").textContent, dayLabel);
      assert.ok(page.document.querySelector("#day-list button").textContent.includes(dayLabel));
      assert.ok(page.document.querySelectorAll("#day-list button")[1].textContent.includes("Explore"), "untranslated fields fall back to source text");
      assert.equal(page.document.querySelector('[data-slot-id="s-ferry"] .g-slot-name').textContent, slotName);
      assert.ok(page.byId("day-info").textContent.includes(dayNote));
      assert.equal(page.byId("day-date").textContent, new Intl.DateTimeFormat(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(2030, 2, 14))));
      assert.ok(page.byId("refresh-status").textContent.length > 0);
      for (const marker of LEAK_MARKERS) assert.ok(!page.text().includes(marker));
      page.close();

      const bad = openPage(server, { languages, hash: "#bad" });
      await pause(5);
      assert.equal(bad.byId("denied").querySelector("[data-text=deniedBody]").textContent, TRANSLATIONS[locale].deniedBody);
      assert.equal(bad.document.title, TRANSLATIONS[locale].sharedItinerary);
      bad.close();
    }
  }

  // ------------------------------------------------------------ native link activation: changed refreshes wait for the press to end
  {
    const server = createFakeServer();
    const page = openPage(server, { locale: "en", config: { linkSettleMs: 20, linkReleaseMs: 80, linkMaxHoldMs: 5000 } });
    await page.ready();
    const { window, document } = page;
    const ferryLink = () => document.querySelector('[data-slot-id="s-ferry"] .g-place-actions a');
    const ferryName = () => document.querySelector('[data-slot-id="s-ferry"] .g-slot-name').textContent;
    const refreshNow = async (label) => {
      const calls = server.tripRequests();
      page.focusWindow();
      await until(() => server.tripRequests() === calls + 1 && !page.controller.state.inFlight, label);
    };
    const activations = [];
    document.addEventListener("click", (event) => {
      const a = event.target.closest?.("a[href]");
      if (a) activations.push({ link: a, connected: a.isConnected, prevented: event.defaultPrevented });
    });

    // Pointer: pointerdown -> changed response (held) -> newer changed response (latest wins) -> native click -> deferred update.
    const link = ferryLink();
    const href = link.href;
    page.fire(link, "pointerdown"); page.fire(link, "mousedown", window.MouseEvent); link.focus();
    assert.equal(page.controller.state.pressActive, true, "press on a link is noticed");
    server.trip.version = 8; server.trip.days[0].slots[1].name = "Fictional ferry (pier 4)";
    server.trip.days.unshift({ id: "day-pre", date: "2030-03-13", label: "Fictional prelude", slots: [] });
    await refreshNow("changed response during press");
    assert.equal(page.controller.state.pendingUpdate, true, "changed payload is held during the press");
    assert.equal(link.isConnected, true, "the pressed anchor is not replaced");
    assert.equal(ferryName(), "Fictional ferry to Old Quay");
    server.trip.version = 9; server.trip.days[1].slots[1].name = "Fictional ferry (pier 5)";
    await refreshNow("newer changed response during press");
    await pause(60);
    assert.equal(link.isConnected, true, "still held while the pointer is down");
    page.fire(link, "pointerup"); page.fire(link, "mouseup", window.MouseEvent);
    page.click(link);
    assert.equal(activations.length, 1);
    assert.equal(activations[0].link, link, "native activation reaches the original anchor");
    assert.equal(activations[0].connected, true); assert.equal(activations[0].prevented, false, "the guard never cancels the default action");
    assert.equal(link.href, href, "href is never rewritten");
    await until(() => ferryName() === "Fictional ferry (pier 5)", "deferred latest update applied after activation");
    assert.equal(page.controller.state.pendingUpdate, false); assert.equal(page.controller.state.pressActive, false);
    assert.equal(link.isConnected, false, "anchors are rebuilt only after the activation");
    assert.equal(page.byId("day-heading").textContent, "Arrival", "the reader's day is preserved although its index moved");
    assert.equal(page.pressed(), 1);
    assert.equal(document.activeElement?.dataset.focusKey, "gmap:s-ferry", "focus returns to the equivalent new link");
    assert.ok(page.byId("refresh-status").textContent.startsWith("Updated at"));
    assert.ok(!document.querySelector('[data-slot-id="s-ferry"] .g-place-actions a').href.includes(server.token));

    // Keyboard: Enter on a focused link -> changed response -> click (the browser's Enter activation) -> update.
    const keyLink = ferryLink(); keyLink.focus();
    page.fire(keyLink, "keydown", window.KeyboardEvent, { key: "Enter" });
    server.trip.version = 10; server.trip.days[1].slots[1].name = "Fictional ferry (pier 6)";
    await refreshNow("changed response during Enter");
    assert.equal(page.controller.state.pendingUpdate, true); assert.equal(keyLink.isConnected, true);
    page.click(keyLink); page.fire(keyLink, "keyup", window.KeyboardEvent, { key: "Enter" });
    assert.equal(activations.at(-1).link, keyLink); assert.equal(activations.at(-1).connected, true);
    await until(() => ferryName() === "Fictional ferry (pier 6)", "update after Enter activation");
    assert.equal(document.activeElement?.dataset.focusKey, "gmap:s-ferry");

    // Cancellation: pointercancel (scroll/drag gesture) ends the press without any click.
    const clicksBefore = activations.length;
    const cancelLink = ferryLink();
    page.fire(cancelLink, "pointerdown");
    server.trip.version = 11; server.trip.days[1].slots[1].name = "Fictional ferry (pier 7)";
    await refreshNow("changed response before cancel");
    assert.equal(page.controller.state.pendingUpdate, true);
    page.fire(cancelLink, "pointercancel");
    await until(() => ferryName() === "Fictional ferry (pier 7)", "update after cancelled press");
    assert.equal(activations.length, clicksBefore, "no click was synthesised");

    // Lost focus: Enter pressed but focus moves away before any activation.
    const focusLink = ferryLink(); focusLink.focus();
    page.fire(focusLink, "keydown", window.KeyboardEvent, { key: "Enter" });
    server.trip.version = 12; server.trip.days[1].slots[1].name = "Fictional ferry (pier 8)";
    await refreshNow("changed response before focus loss");
    assert.equal(page.controller.state.pendingUpdate, true);
    page.byId("check-updates").focus();
    page.fire(focusLink, "focusout", window.FocusEvent);
    await until(() => ferryName() === "Fictional ferry (pier 8)", "update after lost focus");
    assert.equal(activations.length, clicksBefore);

    // Presses on non-link controls never defer content updates.
    page.fire(page.byId("check-updates"), "pointerdown");
    assert.equal(page.controller.state.pressActive, false);
    server.trip.version = 13; server.trip.days[1].slots[1].name = "Fictional ferry (pier 9)";
    await refreshNow("changed response, no link press");
    assert.equal(ferryName(), "Fictional ferry (pier 9)", "applied at once");
    page.fire(page.byId("check-updates"), "pointerup");

    // An unchanged response during a press drops any held payload instead of rebuilding.
    const sameLink = ferryLink();
    page.fire(sameLink, "pointerdown");
    await refreshNow("unchanged response during press");
    assert.equal(page.controller.state.pendingUpdate, false); assert.equal(sameLink.isConnected, true);
    page.fire(sameLink, "pointerup"); page.click(sameLink);
    await pause(120);
    assert.equal(sameLink.isConnected, true, "unchanged content is never rebuilt");

    // Definitive denial clears immediately even mid-press; the held payload can never revive content.
    await until(() => page.blobs.live.size > 0, "media blobs before denial");
    const deniedLink = ferryLink();
    page.fire(deniedLink, "pointerdown"); page.fire(deniedLink, "mousedown", window.MouseEvent);
    server.trip.version = 14; server.trip.days[1].slots[1].name = "Fictional ferry (pier 10)";
    await refreshNow("changed response before denial");
    assert.equal(page.controller.state.pendingUpdate, true);
    server.token = crypto.randomBytes(32).toString("base64url"); // rotation
    await refreshNow("denial during press");
    assert.equal(page.byId("denied").hidden, false, "denied immediately, regardless of the gesture");
    assert.equal(page.byId("trip").hidden, true); assert.ok(!page.text().includes("Fictional"));
    assert.equal(deniedLink.isConnected, false); assert.equal(page.blobs.live.size, 0);
    assert.equal(page.controller.state.pendingUpdate, false);
    page.fire(document.body, "pointerup"); page.fire(document.body, "click", window.MouseEvent);
    await pause(150);
    assert.equal(page.byId("denied").hidden, false); assert.equal(page.byId("trip").hidden, true);
    assert.ok(!page.text().includes("pier 10") && !page.text().includes("Fictional"), "stale held payload never revives denied data");
    assert.equal(page.controller.state.hasTrip, false);
    assertNoPersistence(page, server.token);
    page.close();

    // Safety valve: a press that never ends releases the held update after linkMaxHoldMs.
    const holdServer = createFakeServer();
    const hold = openPage(holdServer, { locale: "en", config: { linkSettleMs: 20, linkReleaseMs: 80, linkMaxHoldMs: 150 } });
    await hold.ready();
    hold.fire(hold.document.querySelector('[data-slot-id="s-ferry"] .g-place-actions a'), "pointerdown");
    holdServer.trip.version = 8; holdServer.trip.days[0].slots[1].name = "Fictional ferry (held)";
    hold.focusWindow();
    await until(() => hold.controller.state.pendingUpdate, "held");
    await until(() => hold.text().includes("Fictional ferry (held)"), "released by the safety valve", 2000);
    hold.close();
  }

  // ------------------------------------------------------------ new fragment on the same /s/<id>: clear and reload, never continue
  {
    const server = createFakeServer();
    const page = openPage(server, { locale: "en" });
    await page.ready();
    await until(() => page.blobs.live.size === 3, "media blobs before link change");
    const calls = server.requests.length;
    const fresh = crypto.randomBytes(32).toString("base64url");
    page.window.location.hash = "#" + fresh;
    await until(() => page.reloads.count === 1, "reload on hashchange");
    assert.equal(page.controller.state.closed, true); assert.equal(page.controller.state.hasTrip, false);
    assert.equal(page.byId("trip").hidden, true); assert.ok(!page.text().includes("Fictional"), "old content removed");
    assert.equal(page.blobs.live.size, 0, "old media revoked");
    for (const img of page.document.querySelectorAll("img")) assert.ok(!img.getAttribute("src"));
    assert.equal(page.document.title, "Shared itinerary");
    page.focusWindow(); page.window.dispatchEvent(new page.window.Event("online"));
    await pause(40);
    assert.equal(server.requests.length, calls, "no request (old or new capability) from the old page state");
    assert.equal(page.controller.state.timerCount, 0);
    page.close();

    // Fragment replaced without a hashchange event (some in-app browsers): the next check notices and reloads.
    const quiet = openPage(server, { locale: "en" });
    await quiet.ready();
    const quietCalls = server.requests.length;
    quiet.window.history.replaceState(null, "", "#" + fresh);
    quiet.focusWindow();
    await until(() => quiet.reloads.count === 1, "reload detected before the next request");
    assert.equal(server.requests.length, quietCalls, "the old capability is not sent under the new link");
    assert.ok(!quiet.text().includes("Fictional"));
    quiet.close();

    // Link change while a refresh is in flight: the late result of the old link is discarded.
    const lateServer = createFakeServer();
    const latePage = openPage(lateServer, { locale: "en" });
    await latePage.ready();
    lateServer.mode = "late"; lateServer.trip.title = "Fictional late title";
    latePage.focusWindow();
    await until(() => lateServer.late.length === 1, "refresh in flight");
    latePage.window.location.hash = "#" + fresh;
    await until(() => latePage.reloads.count === 1, "reload during in-flight refresh");
    lateServer.late[0]();
    await pause(40);
    assert.equal(latePage.byId("trip").hidden, true); assert.ok(!latePage.text().includes("Fictional"));
    latePage.close();

    // A denied page (malformed link) reloads when a corrected link is pasted.
    const bad = openPage(server, { locale: "en", hash: "#bad" });
    await pause(5);
    bad.window.location.hash = "#" + server.token;
    await until(() => bad.reloads.count === 1, "reload for corrected link");
    bad.close();
  }

  // ------------------------------------------------------------ "Check for updates": always available, bounded, deduplicated, keeps reading
  {
    const server = createFakeServer();
    const page = openPage(server, { locale: "en", config: { pollMs: 20, maxPolls: 1 } });
    await page.ready();
    await until(() => server.tripRequests() === 2, "the single bounded poll");
    await pause(80);
    assert.equal(server.tripRequests(), 2, "background refresh has ended");
    const button = page.byId("check-updates");
    assert.equal(button.tagName, "BUTTON"); assert.equal(button.type, "button"); assert.equal(button.textContent, "Check for updates");
    assert.equal(button.closest("[hidden]"), null, "visible in the healthy state"); assert.equal(button.disabled, false);
    assert.ok(button.classList.contains("g-button"), "48px target class");
    page.click(page.document.querySelectorAll("#day-list button")[2]);
    server.trip.version = 8; server.trip.days[2].slots[0].name = "Fictional airport train (earlier)";
    page.click(button);
    await until(() => page.text().includes("Fictional airport train (earlier)"), "manual update");
    assert.equal(server.tripRequests(), 3); assert.equal(page.pressed(), 2, "chosen day kept");
    assert.ok(page.byId("refresh-status").textContent.startsWith("Updated at"));

    page.click(button);
    await until(() => server.tripRequests() === 4 && page.byId("refresh-status").textContent.startsWith("Up to date"), "unchanged manual check");

    // Deduplicated: repeated presses while one request is in flight send nothing more.
    server.mode = "late";
    page.click(button); page.click(button); page.click(button);
    await until(() => server.late.length === 1, "one manual request");
    await pause(30);
    assert.equal(server.late.length, 1); assert.equal(server.tripRequests(), 5);
    assert.equal(button.getAttribute("aria-busy"), "true"); assert.equal(button.disabled, false, "focus is never lost to disabling");
    server.mode = "online"; server.late[0]();
    await until(() => !page.controller.state.inFlight && button.getAttribute("aria-busy") === "false", "in-flight finished");

    // Bounded retries: 1 attempt + retryDelaysMs.length retries, then stop; content stays readable.
    server.mode = "offline";
    const before = server.tripRequests();
    page.click(button);
    await until(() => server.tripRequests() === before + 4 && page.byId("refresh-status").textContent.startsWith("Could not refresh at") && !page.controller.state.inFlight, "bounded manual retries");
    await pause(150);
    assert.equal(server.tripRequests(), before + 4, "retries stop at the bound");
    assert.equal(page.byId("stale").hidden, false); assert.equal(page.byId("trip").hidden, false); assert.equal(page.pressed(), 2);
    assert.equal(button.closest("[hidden]"), null, "still available after failures");
    server.mode = "online";
    page.click(button);
    await until(() => page.byId("stale").hidden && page.byId("refresh-status").dataset.state === "ok", "manual recovery");
    assert.equal(page.pressed(), 2);
    for (const locale of GUEST_LOCALES) {
      const select = page.byId("language"); select.value = locale; select.dispatchEvent(new page.window.Event("change"));
      assert.equal(button.textContent, TRANSLATIONS[locale].checkUpdates, locale + " label");
    }
    assertGuestRequests(server); assertNoPersistence(page, server.token);
    page.close();
  }

  // ------------------------------------------------------------ media URL shape: only the server's exact optional ?h=<16 hex>
  {
    const server = createFakeServer({ id: TRIP_ID, version: 1, title: "Fictional media URL shapes", timezone: "UTC", days: [], reminders: [] });
    server.media.set("plan-ok", PNG);
    const H = fingerprint("FICTIONAL-EMBEDDED-OK");
    const VALID = mediaUrl("plan-ok", "FICTIONAL-EMBEDDED-OK");
    const CROSS_ORIGIN = "https://elsewhere.example.test" + MEDIA + "plan-ok?h=" + H;
    const bad = [
      MEDIA + "plan-ok?h=" + H.slice(0, 15), MEDIA + "plan-ok?h=" + H + "0", MEDIA + "plan-ok?h=ABCDEF0123456789",
      MEDIA + "plan-ok?h=" + H + "&h=" + H, MEDIA + "plan-ok?h=" + H + "&x=1", MEDIA + "plan-ok?x=1&h=" + H,
      MEDIA + "plan-ok?token=" + server.token, MEDIA + "plan-ok?h=" + H + "&token=" + server.token,
      MEDIA + "plan-ok?", MEDIA + "plan-ok?h=", MEDIA + "plan-ok?H=" + H, MEDIA + "plan-ok??h=" + H, MEDIA + "plan-ok?h%3D" + H,
      MEDIA + "plan-ok?h=" + H + "#frag", MEDIA + "plan-ok#h=" + H, MEDIA + "plan-ok?h=" + H + "#",
      MEDIA + "plan-ok/?h=" + H, MEDIA + "plan-ok/../cover?h=" + H, MEDIA + "%2e%2e/%2e%2e/api/trips?h=" + H, MEDIA + "..%2fcover?h=" + H,
      MEDIA + "plan-ok\\..?h=" + H, MEDIA + "plan-ok ?h=" + H, MEDIA + "secret?h=" + H, MEDIA + "?h=" + H,
      "/guest/trips/other-trip/media/plan-ok?h=" + H, `/guest/trips/${TRIP_ID}x/media/plan-ok?h=` + H,
      ORIGIN + MEDIA + "plan-ok?h=" + H, "//elsewhere.example.test" + MEDIA + "plan-ok?h=" + H
    ];
    server.trip.days = [{ id: "shapes", label: "Shapes", slots: [
      { id: "ok", name: "Valid fingerprinted media", photo: { url: VALID, alt: "valid" } },
      { id: "remote", name: "Cross-origin lookalike", photo: { url: CROSS_ORIGIN, alt: "remote" } },
      ...bad.map((url, index) => ({ id: "bad-" + index, name: "Rejected media " + index, photo: { url, alt: "rejected" } }))
    ] }];
    const page = openPage(server, { locale: "en" });
    await page.ready();
    const okImg = page.document.querySelector('[data-slot-id="ok"] img');
    await until(() => okImg.src.startsWith("blob:"), "valid fingerprinted media blob");
    await pause(40);
    bad.forEach((url, index) => assert.equal(page.document.querySelector(`[data-slot-id="bad-${index}"] img`), null, "rejected media URL is never rendered: " + url));
    assert.deepEqual(server.mediaRequests().map((request) => request.url), [VALID], "only the exact server-shaped URL is fetched with the header");
    const remote = page.document.querySelector('[data-slot-id="remote"] img');
    assert.equal(remote.getAttribute("src"), CROSS_ORIGIN, "a cross-origin lookalike is only a direct remote image");
    assert.equal(remote.dataset.mediaUrl, undefined, "cross-origin URLs never receive the share header");
    assertGuestRequests(server); assertNoPersistence(page, server.token);
    page.close();
  }

  // ------------------------------------------------------------ trip read cap: multilingual canonical-size trips fit the default
  {
    assert.equal(DEFAULT_CONFIG.maxTripBytes, 8 * 1024 * 1024, "8 MiB default trip read cap");
    assert.equal(DEFAULT_CONFIG.maxBlobBytes, 48 * 1024 * 1024, "48 MiB total in-memory image budget is unchanged");
    const wide = "旅".repeat(4000); // a 4000-character description, 3 UTF-8 bytes per character
    const capTrip = { id: TRIP_ID, version: 1, title: "Fictional multilingual capacity check", timezone: "UTC", reminders: [],
      days: Array.from({ length: 5 }, (_, d) => ({ id: "cap-" + d, label: "Capacity " + d, slots: Array.from({ length: 72 }, (_, s) => ({ id: `cap-${d}-${s}`, name: "Fictional stop", description: wide })) })) };
    const body = JSON.stringify({ trip: capTrip });
    assert.ok(JSON.stringify(capTrip).length <= 1_500_000, "within the server's canonical JSON character limit");
    assert.ok(Buffer.byteLength(body) > 4 * 1024 * 1024, "but larger than 4 MiB in UTF-8");
    const capServer = createFakeServer(capTrip);
    assert.ok(!Object.hasOwn(FAST, "maxTripBytes"), "the default cap is what is exercised here");
    const capPage = openPage(capServer, { locale: "en" });
    await capPage.ready();
    assert.equal(capPage.byId("trip-title").textContent, "Fictional multilingual capacity check", "a >4 MiB multilingual trip loads under the default cap");
    assert.equal(capPage.document.querySelectorAll("#slots > li").length, 72);
    capPage.close();
  }

  // ------------------------------------------------------------ memory budget: capped reads and total blob bytes
  {
    // Media without content-length cannot bypass the per-image cap.
    const noLength = createFakeServer(); noLength.omitMediaLength = true;
    const capped = openPage(noLength, { locale: "en", config: { maxMediaBytes: 8 } });
    await capped.ready();
    await until(() => noLength.mediaRequests().length === 3, "oversized media attempted");
    await pause(80);
    assert.equal(capped.blobs.created.length, 0, "oversized media never becomes a blob");
    capped.close();

    // Oversized trip JSON is a transient failure, never a denial.
    const big = createFakeServer();
    const bigPage = openPage(big, { locale: "en", config: { maxTripBytes: 100, retryDelaysMs: [] } });
    await until(() => !bigPage.byId("error").hidden, "oversized trip body rejected");
    assert.equal(bigPage.byId("denied").hidden, true);
    bigPage.close();

    // Total-bytes budget: non-visible blobs are evicted (LRU) and re-fetched when shown again.
    const server = createFakeServer();
    const page = openPage(server, { locale: "en", config: { maxBlobBytes: 24 } });
    await page.ready();
    const ferryImg = () => page.document.querySelector('[data-slot-id="s-ferry"] img');
    await until(() => page.blobs.live.size === 3 && ferryImg().src.startsWith("blob:"), "three visible blobs");
    assert.equal(page.controller.state.blobBytes, 36, "visible media is never evicted");
    const ferryBlob = ferryImg().src;
    page.click(page.document.querySelectorAll("#day-list button")[2]); // ferry photo no longer shown
    server.trip.version = 8; server.trip.cover = { url: COVER_V8, alt: "Fictional harbor v8" };
    page.focusWindow();
    await until(() => page.byId("cover-img").src.startsWith("blob:") && page.blobs.revoked.includes(ferryBlob), "hidden blob evicted");
    assert.ok(page.controller.state.blobBytes <= 24, "within the byte budget");
    page.click(page.document.querySelectorAll("#day-list button")[0]);
    await until(() => ferryImg().src.startsWith("blob:") && ferryImg().src !== ferryBlob, "evicted photo re-fetched when shown");
    page.close();
  }

  assert.deepEqual(errors, [], "no jsdom errors");
  console.log("Guest itinerary DOM simulation passed: header-only anonymous reads with credentials omitted; header-fetched cover/logo/upload/local media at the server-shaped ?h=<16 hex> fingerprinted URLs as revocable blob URLs (images revalidated after changed content, new fingerprint fetched; any other query, duplicate parameter, fragment, encoding, cross-trip or cross-origin lookalike rejected); 8 MiB default trip read cap fits a >4 MiB multilingual canonical-size trip; remote photos without token/referrer; unbound, same-origin, cross-trip and traversal media dropped; allowlisted rendering without booking/group/compat/non-allowlisted i18n leaks; pre-trip, trip-timezone today (UTC/Auckland boundary), post-trip, gap and undated day selection; chronological ordering incl. sortOrder; latest content without day jump or rebuild of unchanged reading; blob revocation on replacement and denial; rotation/revocation/expiry hide content immediately with localized message and no automatic re-polling; malformed tokens send no request; bounded retries, timeout, stale warning, 503, online recovery and retry buttons; late responses after close/denial ignored; bounded polling, none while hidden; labelled map links with coordinate/name web fallback; clipboard and selection copy fallback; click-only navigator.share and selectable link fallback; no storage or cookies; four locales; changed refreshes held (latest only) during pointer/Enter link activation and applied after click, cancel, lost focus or the hold limit, with denial clearing at once and never revived; hashchange/silent fragment change clears content/media and reloads without sending the old capability; always-available Check for updates button (deduplicated, bounded retries, day kept); capped media/trip reads and a total blob byte budget. jsdom only (synthetic events, not real browser activation): no layout, 320px/200% text, physical device or WeChat claim.");
} finally {
  for (const page of pages) { try { page.controller.close(); page.window.close(); } catch { /* already closed */ } }
}
