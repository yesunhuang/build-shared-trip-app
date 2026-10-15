// Public place/photo lookups and saved plan.place / Commons plan.photo contracts: real HTTP (and the
// official MCP SDK client) against the actual service, fictional fixtures only.
//
// No provider is ever contacted: every lookup uses the code-only injected lookupFetch, and the
// global fetch is wrapped so that any non-loopback request fails the test. A code-only fake clock and
// sleep keep the 1100 ms start interval and per-account window fast without changing production
// defaults; the abort timeout is shortened through the code-only lookupTimeoutMs hook.
//
// Covers: opt-in configuration validation; disabled-by-default (no provider call even with an
// injected fetch); zero provider calls on reads, lists, exports, saves, imports, MCP and restarts;
// authorization (anonymous, viewer, same-origin cookie checks, MCP credential outside /mcp, missing,
// deleted and archived trips); strict request bodies; Nominatim and Commons request shapes and result
// filtering (licenses, authors, markup, hosts, MIME); cache hits (normalized query, across trips, after
// restart), explicit refresh, failures that keep the cache; global single-flight + start interval,
// bounded queue and queue wait; per-account cap; redirects, bad status/type/JSON/UTF-8, maxlag, size
// limits (declared and streamed), network errors and timeouts; saving places/photos with canonical
// mirroring, conflict rejection, Google-URL precedence, independence of place and photo, durable
// retries, version conflicts, schema rejection, MCP writes, export/import, and legacy content upgrade;
// legacy provider-labelled photo objects (managed Commons snapshot only with selectedAt) through edits,
// replace_content, export/import and snapshot/restore; removal of a place dropping carried-over
// mirrored fields; and the cache file UTF-8 byte cap enforced on write with reload hits.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { SCHEMA_VERSION, snapshotDatabase } from "../server/db.mjs";
import {
  ACCOUNT_LOOKUP_LIMIT, ACCOUNT_LOOKUP_WINDOW_MS, COMMONS_API_URL, DEFAULT_NOMINATIM_URL, LOOKUP_CACHE_FILE, LookupService,
  MAX_CACHE_ENTRIES, MAX_CACHE_FILE_BYTES, MAX_LOOKUP_RESULTS, MAX_QUEUE_WAIT_MS, MIN_START_INTERVAL_MS, htmlToText,
  parseCommonsResults, parseNominatimResults, readLookupConfig
} from "../server/lookups.mjs";
import { COMMONS_LICENSES, COMMONS_PHOTO_KEYS, Issues, PLACE_KEYS, isManagedCommonsPhoto, normalizeCommonsPhoto } from "../server/domain/validate.mjs";

// ---------------------------------------------------------------------------------------------
// Network guard: only loopback traffic (the local test server) may leave this process.
const realFetch = globalThis.fetch;
let externalAttempts = 0;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    externalAttempts += 1;
    return Promise.reject(new Error("External network access is not allowed in this test."));
  }
  return realFetch(input, init);
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-lookups-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
const USER_AGENT = "shared-trip-app-test/0.0 (+https://contact.fictional.invalid/trips)";
const ENABLED = { SHARED_TRIP_LOOKUPS_ENABLED: "1", SHARED_TRIP_LOOKUP_USER_AGENT: USER_AGENT };
const GOOGLE_URL = "https://www.google.com/maps/place/Fictional+Harbor+Cafe,+1+Invented+Quay,+Exampleton/@35.1,139.1,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d35.1234!4d139.5678!16s";
const OTHER_GOOGLE_URL = GOOGLE_URL.replace("!3d35.1234!4d139.5678", "!3d35.2222!4d139.3333");
const LEGACY_PHOTO = { url: "https://images.fictional.invalid/cafe.jpg", sourceUrl: "https://images.fictional.invalid/cafe", credit: "Fictional Photographer · CC BY 4.0" };
// Pre-picker photo records that carry a provider label but no selectedAt: legacy free objects that
// must be accepted and stored exactly as given (no invented timestamp, no rewritten credit/source).
const LEGACY_MANUAL_PHOTO = { provider: "manual", url: "https://example.org/fictional.jpg", credit: "Fictional author" };
const LEGACY_COMMONS_PHOTO = { provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_old_pier.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_old_pier.jpg", credit: "Fictional Old Photographer / CC BY-SA 3.0 (older credit format)" };

// ---------------------------------------------------------------------------------------------
// Code-only fake clock/sleep and injected provider.
let fakeNow = Date.parse("2032-01-01T00:00:00.000Z");
const lookupClock = () => fakeNow;
const sleeps = [];
const lookupSleep = async (ms) => { sleeps.push(ms); fakeNow += ms; };

const JSON_TYPE = { "Content-Type": "application/json; charset=utf-8" };
const json = (body, status = 200, headers = JSON_TYPE) => new Response(JSON.stringify(body), { status, headers });
const fakeResponse = ({ status = 200, headers = JSON_TYPE, body = null } = {}) => ({ status, redirected: false, type: "basic", headers: new Headers(headers), body });

const PLACE_FIXTURE = [
  { place_id: 9001, licence: "Data © OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright", osm_type: "node", osm_id: 4100000001, lat: "35.6001234", lon: "139.7005678",
    category: "man_made", type: "lighthouse", name: "Fictional Harbor Lighthouse", display_name: "Fictional Harbor Lighthouse, 1 Invented Quay, Exampleton, Fictionland",
    address: { road: "Invented Quay", city: "Exampleton", country: "Fictionland" } },
  { place_id: 9002, osm_type: "way", osm_id: 4100000002, lat: "35.6011", lon: "139.7011", name: "", display_name: "Invented Market Hall, Exampleton, Fictionland" },
  { place_id: 9003, osm_type: "relation", osm_id: "4100000003", lat: "35.62", lon: "139.72", name: "Fictional Old Town", display_name: "Fictional Old Town, Exampleton, Fictionland" },
  { place_id: 9004, osm_type: "node", osm_id: 4100000001, lat: "35.6001234", lon: "139.7005678", name: "Duplicate", display_name: "Duplicate, Exampleton" },
  { place_id: 9005, osm_type: "area", osm_id: 5, lat: "35.6", lon: "139.7", name: "Unknown type", display_name: "Unknown type, Exampleton" },
  { place_id: 9006, osm_type: "node", osm_id: 4100000004, lat: "", lon: "139.7", name: "No latitude", display_name: "No latitude, Exampleton" },
  { place_id: 9007, osm_type: "node", osm_id: 4100000005, lat: "35.6", lon: "139.7", name: "<b>Injected</b>", display_name: "<b>Injected</b>, Exampleton" },
  { place_id: 9008, osm_type: "node", osm_id: 4100000006, lat: "95.0", lon: "139.7", name: "Out of range", display_name: "Out of range, Exampleton" },
  { place_id: 9009, osm_type: "node", osm_id: 4100000007, lat: "35.63", lon: "139.73", name: "Fictional Ferry Pier", display_name: "Fictional Ferry Pier, Exampleton, Fictionland" }
];
const EXPECTED_PLACE_IDS = ["node/4100000001", "way/4100000002", "relation/4100000003", "node/4100000007"];

const FICTIONAL_ARTIST = "<a href=\"//commons.wikimedia.org/wiki/User:Fictional_Photographer\" title=\"User:Fictional Photographer\">Fictional Photographer</a>";
function commonsPage(index, file, { mime = "image/jpeg", artist = FICTIONAL_ARTIST, license = "CC BY-SA 4.0", licenseUrl = "https://creativecommons.org/licenses/by-sa/4.0", thumb, ns = 6 } = {}) {
  return {
    pageid: 7000 + index, ns, title: "File:" + file, index,
    imageinfo: [{
      thumburl: thumb ?? `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/640px-${file}`, thumbwidth: 640, thumbheight: 480,
      url: `https://upload.wikimedia.org/wikipedia/commons/a/ab/${file}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${file}`, mime,
      extmetadata: {
        ...(artist === null ? {} : { Artist: { value: artist, source: "commons-desc-page" } }),
        ...(license === null ? {} : { LicenseShortName: { value: license } }),
        ...(licenseUrl === null ? {} : { LicenseUrl: { value: licenseUrl } }),
        UsageTerms: { value: "Fictional usage terms" }
      }
    }]
  };
}
const COMMONS_FIXTURE = { batchcomplete: true, query: { pages: [
  commonsPage(2, "Fictional_harbor_lighthouse.jpg"),
  commonsPage(1, "Fictional_quay_at_dusk.png", { mime: "image/png", artist: "Invented Artist &amp; Friend", license: "CC0", licenseUrl: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" }),
  commonsPage(3, "Fictional_noncommercial.jpg", { license: "CC BY-NC-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc-sa/4.0/" }),
  commonsPage(4, "Fictional_no_author.jpg", { artist: null }),
  commonsPage(5, "Fictional_map.svg", { mime: "image/svg+xml", thumb: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Fictional_map.svg/640px-Fictional_map.svg.png" }),
  commonsPage(6, "Fictional_elsewhere.jpg", { thumb: "https://images.fictional.invalid/640px-Fictional_elsewhere.jpg" }),
  commonsPage(7, "Fictional_escaped_markup.jpg", { artist: "&lt;script&gt;alert(1)&lt;/script&gt;" }),
  commonsPage(8, "Fictional_ported.jpg", { license: "CC BY-SA 3.0 de", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/de/deed.en" }),
  commonsPage(9, "Fictional_mismatch.jpg", { license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/" }),
  commonsPage(10, "Fictional_article.jpg", { ns: 0 }),
  commonsPage(11, "Fictional_walker.jpg", { artist: "Fictional Walker", license: "CC BY 2.0", licenseUrl: "https://creativecommons.org/licenses/by/2.0/legalcode" }),
  commonsPage(12, "Fictional_tagged_author.jpg", { artist: "<script>alert(1)</script><span>Real Name</span>" })
] } };
const EXPECTED_PHOTO_FILES = ["Fictional_quay_at_dusk.png", "Fictional_harbor_lighthouse.jpg", "Fictional_walker.jpg", "Fictional_tagged_author.jpg"];
const CURRENT_CDN_PAGE = commonsPage(1, "Fictional_garden.jpg", {
  thumb: "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Fictional%20garden.jpg/640px-Fictional%20garden.jpg?utm_source=fictional&utm_campaign=fixture&utm_content=test"
});
CURRENT_CDN_PAGE.imageinfo[0].descriptionurl += "?utm_source=fictional";
const CURRENT_CDN_FIXTURE = { query: { pages: [CURRENT_CDN_PAGE] } };

function defaultHandler(call) {
  if (call.url.hostname === "commons.wikimedia.org") return call.url.searchParams.get("gsrsearch").includes("nomatch") ? json({ batchcomplete: true }) : json(COMMONS_FIXTURE);
  return call.url.searchParams.get("q").includes("nowhere") ? json([]) : json(PLACE_FIXTURE);
}
const provider = { calls: [], active: 0, maxActive: 0, handler: null };
const lookupFetch = async (url, init) => {
  const call = { url: new URL(url), init, at: fakeNow };
  provider.calls.push(call);
  provider.active += 1;
  provider.maxActive = Math.max(provider.maxActive, provider.active);
  let active = true;
  const finish = () => { if (active) { active = false; provider.active -= 1; } };
  init.signal.addEventListener("abort", finish, { once: true });
  try { return await (provider.handler || defaultHandler)(call); }
  finally { finish(); init.signal.removeEventListener("abort", finish); }
};
const callCount = () => provider.calls.length;

// ---------------------------------------------------------------------------------------------
// Server and HTTP helpers.
const running = [];
const sdkClients = [];
const dataDirOf = (name) => path.join(temporary, name);
async function start(name, env = {}, hooks = {}) {
  const runtime = await startServer({
    ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: dataDirOf(name), SHARED_TRIP_PORT: "0", ...env }),
    lookupFetch, lookupClock, lookupSleep, lookupTimeoutMs: 250, ...hooks
  });
  running.push(runtime);
  return runtime;
}
async function stop(runtime) { running.splice(running.indexOf(runtime), 1); await runtime.close(); }

function expect(response, status, label, code) {
  assert.ok(response.status === status, `${label} (expected ${status}, got ${response.status}, code ${response.body?.error?.code ?? "none"})`);
  if (code) assert.equal(response.body?.error?.code, code, label + ": error code");
  return response.body;
}

function client(base) {
  async function call(route, { method = "GET", body, raw, headers = {} } = {}) {
    const sent = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
    for (const key of Object.keys(sent)) if (sent[key] === undefined) delete sent[key];
    const response = await fetch(base + route, { method, headers: sent, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = method === "HEAD" ? "" : await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (route.startsWith("/api/")) assert.equal(response.headers.get("cache-control"), "no-store", method + " " + route.split("?")[0] + " must be no-store");
    return { status: response.status, body: parsed, text, headers: response.headers };
  }
  const api = {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } }),
    bearer: (secret, route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + secret, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
    async trip(id) { return expect(await api.owner("/api/trips/" + id), 200, "owner read trip").trip; },
    async makeAccount(username, role) {
      const invitation = expect(await api.owner("/api/invitations", { method: "POST", body: {} }), 201, "invitation").invitation;
      const password = "Fictional-" + crypto.randomBytes(12).toString("base64url");
      expect(await call("/api/accept-invite", { method: "POST", headers: { Origin: base }, body: { invitation: invitation.token, username, password } }), 201, "redeem " + username);
      const id = expect(await api.owner("/api/users"), 200, "accounts").accounts.find((account) => account.username === username).id;
      if (role) expect(await api.owner(`/api/users/${id}/role`, { method: "POST", body: { role } }), 200, "role " + username);
      expect(await api.owner(`/api/users/${id}/approve`, { method: "POST" }), 200, "approve " + username);
      const login = await call("/api/login", { method: "POST", headers: { Origin: base }, body: { username, password } });
      expect(login, 200, "sign in " + username);
      return { id, cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
    }
  };
  return api;
}

const searchRoute = (tripId, kind) => `/api/trips/${tripId}/${kind === "photo" ? "photos" : "places"}/search`;
// The owner (cookie or bearer) is one lookup account; keep it inside its per-window cap by moving
// the fake clock to a fresh window before the cap would be reached.
let ownerSpent = 0;
function freshWindow() { fakeNow += ACCOUNT_LOOKUP_WINDOW_MS + 1; ownerSpent = 0; }
function spend() { if (ownerSpent >= ACCOUNT_LOOKUP_LIMIT - 2) freshWindow(); ownerSpent += 1; }
function ownerSearch(api, tripId, kind, query, extra = {}) {
  spend();
  return api.owner(searchRoute(tripId, kind), { method: "POST", body: { query, ...extra } });
}
const withoutTime = (results) => results.map(({ selectedAt, ...rest }) => rest);
const omit = (object, key) => { const copy = { ...object }; delete copy[key]; return copy; };
const slotOf = (trip, id) => trip.days.flatMap((day) => day.slots).find((slot) => slot.id === id);
const change = (api, trip, requestId, changes) => api.owner(`/api/trips/${trip.id}/changes`, { method: "POST", body: { requestId, expectedVersion: trip.version, changes } });
async function waitFor(predicate, label, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > until) assert.fail("timed out waiting for " + label);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function mcpSession(base) {
  const sdk = new Client({ name: "fictional-lookup-probe", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + ownerToken } } }));
  sdkClients.push(sdk);
  return {
    sdk,
    async tool(name, args) {
      const result = await sdk.callTool({ name, arguments: args });
      return { isError: Boolean(result.isError), data: result.structuredContent || JSON.parse(result.content[0].text) };
    },
    async close() { sdkClients.splice(sdkClients.indexOf(sdk), 1); await sdk.close(); }
  };
}

try {
  // -------------------------------------------------------------------------------------------
  // Pure provider adapters.
  assert.deepEqual(parseNominatimResults(PLACE_FIXTURE).map((place) => place.id), EXPECTED_PLACE_IDS, "Nominatim results are filtered, deduplicated and ordered");
  assert.deepEqual(parseNominatimResults([]), [], "no Nominatim match is an empty result");
  assert.throws(() => parseNominatimResults({ error: "Fictional" }), (error) => error.code === "lookup_malformed");
  assert.deepEqual(parseCommonsResults(COMMONS_FIXTURE).map((photo) => photo.sourceUrl.split("File:")[1]), EXPECTED_PHOTO_FILES, "Commons results are filtered and ordered by search rank");
  assert.deepEqual(parseCommonsResults({ batchcomplete: true }), [], "no Commons match is an empty result");
  const currentCdn = parseCommonsResults(CURRENT_CDN_FIXTURE);
  assert.equal(currentCdn.length, 1, "current official thumbnail host is supported");
  assert.equal(new URL(currentCdn[0].url).hostname, "thumb.wikimedia.org");
  assert.equal(new URL(currentCdn[0].url).search, "", "only API tracking fields are stripped");
  assert.equal(new URL(currentCdn[0].sourceUrl).search, "");
  assert.ok(currentCdn[0].url.includes("Fictional%20garden.jpg"), "encoded filenames are preserved");
  for (const url of [
    currentCdn[0].url.replace("thumb.wikimedia.org", "other.wikimedia.org"),
    "https://thumb.wikimedia.org/wikipedia/commons/a/ab/Fictional.jpg",
    currentCdn[0].url + "?arbitrary=value",
    currentCdn[0].url.replace("https://", "https://fictional@"),
    currentCdn[0].url + "#fragment"
  ]) {
    const issues = new Issues();
    normalizeCommonsPhoto({ ...currentCdn[0], selectedAt: "2032-01-01T00:00:00.000Z", url }, "photo", issues);
    assert.ok(!issues.ok, "unsupported host, path, query, credentials or fragment is rejected");
  }
  const queried = structuredClone(CURRENT_CDN_FIXTURE);
  queried.query.pages[0].imageinfo[0].thumburl += "&arbitrary=value";
  assert.deepEqual(parseCommonsResults(queried), [], "nontracking query fields remain forbidden");
  assert.throws(() => parseCommonsResults({ error: { code: "maxlag", info: "Fictional lag" } }), (error) => error.code === "lookup_unavailable");
  assert.throws(() => parseCommonsResults({ query: "bad" }), (error) => error.code === "lookup_malformed");
  assert.equal(htmlToText("<span class=\"fn\">Fictional &amp; Co</span>", 300), "Fictional & Co");
  assert.equal(htmlToText("&lt;b&gt;Fictional", 300), "", "decoded markup is refused, never returned");
  assert.equal(htmlToText("<script>alert(1)</script>", 300), "", "script-only text is empty");
  assert.equal(htmlToText("x".repeat(301), 300), "", "over-long text is refused");
  console.log("Adapters: Nominatim/Commons filtering, ordering, empty matches, provider errors and HTML-to-text passed.");

  // -------------------------------------------------------------------------------------------
  // Opt-in configuration.
  const base = { SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: dataDirOf("config"), SHARED_TRIP_PORT: "0" };
  assert.deepEqual(readConfig(base).lookups, { enabled: false }, "lookups are disabled by default");
  assert.deepEqual(readLookupConfig({ SHARED_TRIP_LOOKUPS_ENABLED: "0", SHARED_TRIP_LOOKUP_USER_AGENT: USER_AGENT }), { enabled: false }, "a user agent alone does not enable lookups");
  assert.deepEqual(readLookupConfig(ENABLED), { enabled: true, userAgent: USER_AGENT, nominatimUrl: DEFAULT_NOMINATIM_URL }, "public Nominatim is the default only when enabled");
  assert.equal(readLookupConfig({ ...ENABLED, SHARED_TRIP_LOOKUP_USER_AGENT: "shared-trip-app/1.2 (contact@fictional.invalid)" }).enabled, true, "an email contact is accepted");
  assert.equal(readLookupConfig({ ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "https://geocoder.fictional.invalid/search" }).nominatimUrl, "https://geocoder.fictional.invalid/search");
  for (const env of [{ SHARED_TRIP_LOOKUPS_ENABLED: "yes" }, { SHARED_TRIP_LOOKUPS_ENABLED: "true" }, { SHARED_TRIP_LOOKUPS_ENABLED: "1" },
    { ...ENABLED, SHARED_TRIP_LOOKUP_USER_AGENT: "" }, { ...ENABLED, SHARED_TRIP_LOOKUP_USER_AGENT: "shared-trip-app/1.0" },
    { ...ENABLED, SHARED_TRIP_LOOKUP_USER_AGENT: "shared-trip-app (+https://contact.fictional.invalid/)" },
    { ...ENABLED, SHARED_TRIP_LOOKUP_USER_AGENT: "Mozilla/5.0 shared trip without contact" },
    { ...ENABLED, SHARED_TRIP_LOOKUP_USER_AGENT: "shared-trip-app/1.0 (+https://contact.fictional.invalid/)\n" },
    { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "http://geocoder.fictional.invalid/search" },
    { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "https://geocoder.fictional.invalid/search?key=fictional" },
    { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "https://geocoder.fictional.invalid/search?" },
    { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "https://geocoder.fictional.invalid/search#fragment" },
    { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "https://user:secret@geocoder.fictional.invalid/search" },
    { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "not a url" },
    { SHARED_TRIP_NOMINATIM_URL: "ftp://geocoder.fictional.invalid/search" }]) {
    assert.throws(() => readLookupConfig(env), Error, "invalid lookup configuration is refused at startup");
  }
  assert.throws(() => readConfig({ ...base, SHARED_TRIP_LOOKUPS_ENABLED: "1" }), /SHARED_TRIP_LOOKUP_USER_AGENT/, "enabling requires the operator's identifying user agent");
  console.log("Configuration: disabled by default, explicit opt-in, identifying user agent and HTTPS endpoint without credentials/query/fragment passed.");

  // -------------------------------------------------------------------------------------------
  // Disabled server: an injected fetch is never used.
  {
    const runtime = await start("disabled");
    const api = client(runtime.url);
    let trip = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "dis-create", trip: { title: "Fictional Disabled Lookups" } } }), 201, "create").trip;
    trip = expect(await change(api, trip, "dis-day", [{ type: "upsert_day", day: { id: "dis-day", date: "2032-02-01", slots: [{ id: "dis-plan", name: "Invented walk", googleMapsUrl: GOOGLE_URL }] } }]), 200, "edit").trip;
    for (const kind of ["place", "photo"]) {
      expect(await api.owner(searchRoute(trip.id, kind), { method: "POST", body: { query: "Fictional Harbor Lighthouse" } }), 503, "disabled " + kind + " search", "lookup_disabled");
      expect(await api.owner(searchRoute(trip.id, kind), { method: "POST", body: { query: "x" } }), 503, "disabled refuses before reading the query", "lookup_disabled");
    }
    expect(await api.owner("/api/trips"), 200, "list"); expect(await api.owner("/api/trips/" + trip.id), 200, "read");
    const exported = expect(await api.owner("/api/trips/" + trip.id + "/export"), 200, "export");
    expect(await api.owner("/api/import", { method: "POST", body: { requestId: "dis-import", data: exported } }), 201, "import");
    assert.equal(callCount(), 0, "a disabled server never calls the provider");
    assert.ok(!fs.existsSync(path.join(fs.realpathSync(dataDirOf("disabled")), LOOKUP_CACHE_FILE)), "no cache file without lookups");
    await stop(runtime);
  }
  console.log("Disabled: explicit lookup_disabled errors and zero provider calls, even with an injected fetch.");

  // -------------------------------------------------------------------------------------------
  // Enabled server.
  let runtime = await start("main", ENABLED);
  let api = client(runtime.url);
  let alpha = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "lk-alpha", trip: { title: "Fictional Lookup Coast" } } }), 201, "create alpha").trip;
  alpha = expect(await change(api, alpha, "lk-alpha-seed", [{ type: "upsert_day", day: { id: "lk-day", date: "2032-04-01", slots: [
    { id: "lk-plain", name: "Invented lighthouse visit", time: "10:00" },
    { id: "lk-google", name: "Invented harbor cafe", time: "12:00", googleMapsUrl: GOOGLE_URL, photo: LEGACY_PHOTO }] } }]), 200, "seed alpha").trip;
  assert.equal(slotOf(alpha, "lk-google").lat, 35.1234, "legacy Google URL parsing still derives coordinates");
  assert.equal(slotOf(alpha, "lk-google").address, "1 Invented Quay, Exampleton");
  let beta = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "lk-beta", trip: { title: "Fictional Lookup Hills" } } }), 201, "create beta").trip;
  let gamma = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "lk-gamma", trip: { title: "Fictional Deleted Trip" } } }), 201, "create gamma").trip;
  expect(await api.owner("/api/trips/" + gamma.id, { method: "DELETE", body: { requestId: "lk-gamma-delete", expectedVersion: gamma.version } }), 200, "delete gamma");
  let delta = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "lk-delta", trip: { title: "Fictional Archived Trip" } } }), 201, "create delta").trip;
  delta = expect(await change(api, delta, "lk-delta-archive", [{ type: "archive_trip", archived: true }]), 200, "archive delta").trip;
  const manager = await api.makeAccount("fictional.lookup.manager", "content-manager");
  const viewer = await api.makeAccount("fictional.lookup.viewer");
  const managerToken = expect(await api.owner(`/api/users/${manager.id}/mcp-tokens`, { method: "POST", body: { label: "Fictional lookup probe" } }), 201, "issue manager MCP credential").secret;
  const ownerCookie = (await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token: ownerToken } })).headers.get("set-cookie").split(";")[0];

  // Ordinary reads, writes, imports, exports, pages and MCP never contact a provider.
  expect(await api.owner("/api/trips"), 200, "list"); expect(await api.owner("/api/trips/" + alpha.id), 200, "read");
  expect(await api.as(viewer.cookie, "/api/trips/" + alpha.id), 200, "viewer read"); expect(await api.as(manager.cookie, "/api/session"), 200, "session");
  const alphaExport = expect(await api.owner("/api/trips/" + alpha.id + "/export"), 200, "export");
  expect(await api.owner("/api/import", { method: "POST", body: { requestId: "lk-import-plain", data: alphaExport } }), 201, "import");
  beta = expect(await change(api, beta, "lk-beta-edit", [{ type: "update_trip", fields: { shortName: "Hills" } }]), 200, "unrelated edit").trip;
  for (const page of ["/", "/trips/" + alpha.id]) assert.ok([200, 302, 401, 404].includes((await api.as(manager.cookie, page)).status), "page request");
  {
    const mcp = await mcpSession(runtime.url);
    assert.deepEqual((await mcp.sdk.listTools()).tools.map((tool) => tool.name).sort(), ["apply_trip_changes", "create_trip", "export_trip", "get_trip", "import_trip", "list_trips"], "no new MCP tools");
    assert.ok(!(await mcp.tool("get_trip", { tripId: alpha.id })).isError, "MCP read");
    assert.ok(!(await mcp.tool("list_trips", {})).isError, "MCP list");
    await mcp.close();
  }
  assert.equal(callCount(), 0, "reads, lists, exports, saves, imports, pages and MCP make no provider call");
  console.log("Zero provider calls on ordinary read/list/export/save/import/page/MCP paths with lookups enabled.");

  // Authorization and target checks.
  for (const kind of ["place", "photo"]) {
    const route = searchRoute(alpha.id, kind);
    const body = { query: "Fictional Harbor Lighthouse" };
    expect(await api.call(route, { method: "POST", body, headers: { Origin: api.base } }), 401, "anonymous " + kind);
    expect(await api.as(viewer.cookie, route, { method: "POST", body }), 403, "viewer " + kind, "forbidden");
    expect(await api.as(manager.cookie, route, { method: "POST", body, headers: { Origin: undefined } }), 403, "manager cookie without Origin", "forbidden_origin");
    expect(await api.as(ownerCookie, route, { method: "POST", body, headers: { Origin: undefined } }), 403, "owner cookie without Origin", "forbidden_origin");
    expect(await api.as(manager.cookie, route, { method: "POST", body, headers: { Origin: "https://unrelated.example.org" } }), 403, "cross-origin cookie", "forbidden_origin");
    expect(await api.bearer(managerToken, route, { method: "POST", body }), 401, "MCP credential outside /mcp");
    expect(await api.bearer("stm_" + crypto.randomBytes(32).toString("base64url"), route, { method: "POST", body }), 401, "unknown bearer");
    expect(await api.call(route, { method: "POST", body, headers: { Authorization: "Bearer " + managerToken, Cookie: manager.cookie, Origin: api.base } }), 401, "credential never falls back to a cookie");
    expect(await api.owner(searchRoute("trip-does-not-exist", kind), { method: "POST", body }), 404, "unknown trip", "trip_not_found");
    expect(await api.as(manager.cookie, searchRoute("trip-does-not-exist", kind), { method: "POST", body }), 404, "unknown trip (manager)", "trip_not_found");
    expect(await api.owner(searchRoute("%E0%A4%A", kind), { method: "POST", body }), 404, "undecodable trip ID");
    expect(await api.owner(searchRoute(gamma.id, kind), { method: "POST", body }), 410, "deleted trip", "trip_deleted");
    expect(await api.owner(searchRoute(delta.id, kind), { method: "POST", body }), 409, "archived trip", "trip_archived");
    expect(await api.owner(route), 404, "GET is not a lookup");
    expect(await api.as(manager.cookie, route), 403, "manager GET is not a lookup");
  }
  assert.equal(callCount(), 0, "refused lookups make no provider call");

  // Strict request bodies.
  for (const [label, body] of [["empty", {}], ["number", { query: 5 }], ["short", { query: "a" }], ["long", { query: "x".repeat(201) }],
    ["client endpoint", { query: "Fictional Harbor", url: "https://geocoder.fictional.invalid/search" }], ["extra key", { query: "Fictional Harbor", limit: 50 }],
    ["refresh type", { query: "Fictional Harbor", refresh: "yes" }], ["email", { query: "fictional.traveler@fictional.invalid" }],
    ["long digits", { query: "Booking 12345678" }], ["phone", { query: "+1 555 0100 0199" }], ["control", { query: "bad\u0007query" }],
    ["array", ["Fictional Harbor"]], ["string", "Fictional Harbor"], ["null", null]]) {
    expect(await api.owner(searchRoute(alpha.id, "place"), { method: "POST", body }), 422, "body " + label, "validation_failed");
  }
  expect(await api.owner(searchRoute(alpha.id, "place"), { method: "POST", raw: "query=Fictional", headers: { "Content-Type": "application/x-www-form-urlencoded" } }), 415, "form body");
  expect(await api.owner(searchRoute(alpha.id, "place"), { method: "POST", raw: "{", headers: { "Content-Type": "application/json" } }), 422, "invalid JSON");
  expect(await api.owner(searchRoute(alpha.id, "place"), { method: "POST", body: { query: "x".repeat(9000) } }), 413, "oversized body");
  assert.equal(callCount(), 0, "invalid lookup bodies make no provider call");
  console.log("Authorization: anonymous/viewer/cross-origin/no-Origin/MCP-credential refused; missing, deleted and archived trips; strict bodies, all without provider calls.");

  // -------------------------------------------------------------------------------------------
  // Place search request and results.
  const placeBody = expect(await (spend(), api.owner(searchRoute(alpha.id, "place") + "?endpoint=" + encodeURIComponent("https://geocoder.fictional.invalid/search"),
    { method: "POST", body: { query: "  Fictional   Harbor Lighthouse " } })), 200, "owner place search");
  assert.equal(callCount(), 1, "one provider request");
  const placeCall = provider.calls[0];
  assert.equal(placeCall.url.origin + placeCall.url.pathname, DEFAULT_NOMINATIM_URL, "URL query strings never choose the provider");
  assert.deepEqual([...placeCall.url.searchParams.keys()].sort(), ["addressdetails", "format", "limit", "q"]);
  assert.equal(placeCall.url.searchParams.get("q"), "Fictional Harbor Lighthouse", "normalized query");
  assert.equal(placeCall.url.searchParams.get("format"), "jsonv2"); assert.equal(placeCall.url.searchParams.get("limit"), "5"); assert.equal(placeCall.url.searchParams.get("addressdetails"), "1");
  assert.equal(placeCall.init.method, "GET"); assert.equal(placeCall.init.redirect, "manual", "redirects are never followed");
  assert.ok(placeCall.init.signal instanceof AbortSignal, "abortable");
  assert.deepEqual(Object.keys(placeCall.init.headers).sort(), ["Accept", "User-Agent"], "only Accept and the operator's User-Agent are sent");
  assert.equal(placeCall.init.headers["User-Agent"], USER_AGENT);
  assert.equal(placeBody.cached, false); assert.deepEqual(Object.keys(placeBody).sort(), ["cached", "results"]);
  const places = placeBody.results;
  assert.deepEqual(places.map((place) => place.id), EXPECTED_PLACE_IDS, "only valid, unique OSM results");
  for (const place of places) {
    assert.deepEqual(Object.keys(place).sort(), [...PLACE_KEYS].sort(), "place result fields");
    assert.equal(place.provider, "openstreetmap"); assert.equal(place.license, "ODbL-1.0"); assert.equal(place.attribution, "© OpenStreetMap contributors");
    assert.equal(place.sourceUrl, "https://www.openstreetmap.org/" + place.id);
    assert.equal(place.selectedAt, new Date(fakeNow).toISOString());
  }
  assert.deepEqual(withoutTime([places[0]])[0], { provider: "openstreetmap", id: "node/4100000001", name: "Fictional Harbor Lighthouse",
    address: "Fictional Harbor Lighthouse, 1 Invented Quay, Exampleton, Fictionland", lat: 35.6001234, lng: 139.7005678,
    sourceUrl: "https://www.openstreetmap.org/node/4100000001", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0" });
  assert.equal(places[1].name, "Invented Market Hall", "a missing name falls back to the first address part");

  // Cache: normalized identical query, other trips and other editors; lookups never write trips.
  fakeNow += 5000;
  const cachedBody = expect(await ownerSearch(api, alpha.id, "place", "fictional harbor LIGHTHOUSE"), 200, "identical query");
  assert.equal(cachedBody.cached, true); assert.equal(callCount(), 1, "cache hit makes no provider call");
  assert.deepEqual(withoutTime(cachedBody.results), withoutTime(places));
  assert.equal(cachedBody.results[0].selectedAt, new Date(fakeNow).toISOString(), "selectedAt reflects this response");
  assert.equal(expect(await api.as(manager.cookie, searchRoute(beta.id, "place"), { method: "POST", body: { query: "Fictional Harbor Lighthouse" } }), 200, "manager search on another trip").cached, true);
  spend();
  assert.equal(expect(await api.as(ownerCookie, searchRoute(alpha.id, "place"), { method: "POST", body: { query: "Fictional Harbor Lighthouse" } }), 200, "owner cookie search").cached, true);
  assert.equal((await api.trip(alpha.id)).version, alpha.version, "lookups never change the trip");
  assert.equal((await api.trip(beta.id)).version, beta.version, "lookups never change other trips");

  // Explicit refresh bypasses the cache; starts are spaced by the global interval.
  const sleptBefore = sleeps.length;
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse", { refresh: true }), 200, "refresh").cached, false);
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse", { refresh: true }), 200, "second refresh").cached, false);
  assert.equal(callCount(), 3, "each refresh calls the provider");
  assert.ok(provider.calls[2].at - provider.calls[1].at >= MIN_START_INTERVAL_MS, "upstream starts are at least the minimum interval apart");
  assert.ok(sleeps.length > sleptBefore && sleeps.at(-1) <= MIN_START_INTERVAL_MS, "the second refresh waited for the interval");

  // A failed refresh keeps the cache; a failed new query is not cached.
  const cacheFile = path.join(fs.realpathSync(dataDirOf("main")), LOOKUP_CACHE_FILE);
  const cacheBytes = fs.readFileSync(cacheFile);
  provider.handler = () => json({ error: "Fictional outage" }, 500);
  const failedRefresh = await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse", { refresh: true });
  expect(failedRefresh, 502, "failed refresh", "lookup_unavailable");
  assert.ok(!failedRefresh.text.includes("Fictional outage"), "provider bodies are not echoed");
  assert.ok(fs.readFileSync(cacheFile).equals(cacheBytes), "failed refresh does not rewrite the cache");
  expect(await ownerSearch(api, alpha.id, "place", "Fictional Unlisted Bay"), 502, "failed new query", "lookup_unavailable");
  provider.handler = null;
  const afterFailure = expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse"), 200, "after failed refresh");
  assert.equal(afterFailure.cached, true); assert.deepEqual(withoutTime(afterFailure.results), withoutTime(places), "cached results survive a failed refresh");
  const callsBeforeRetry = callCount();
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Unlisted Bay"), 200, "retry after failure").cached, false, "failures are not cached");
  assert.equal(callCount(), callsBeforeRetry + 1);
  console.log("Places: fixed Nominatim request shape and headers, filtered ODbL results, normalized cache hits across trips/editors, explicit refresh, interval and failure handling passed.");

  // -------------------------------------------------------------------------------------------
  // Photo search.
  const photoCallIndex = callCount();
  const photoBody = expect(await ownerSearch(api, alpha.id, "photo", "Fictional harbor photos"), 200, "photo search");
  const photoCall = provider.calls[photoCallIndex];
  assert.equal(photoCall.url.origin + photoCall.url.pathname, COMMONS_API_URL, "fixed Commons endpoint");
  const params = Object.fromEntries(photoCall.url.searchParams);
  assert.deepEqual(Object.keys(params).sort(), ["action", "format", "formatversion", "generator", "gsrlimit", "gsrnamespace", "gsrsearch", "iiextmetadatafilter", "iiprop", "iiurlwidth", "maxlag", "prop"]);
  assert.equal(params.action, "query"); assert.equal(params.generator, "search"); assert.equal(params.gsrnamespace, "6"); assert.equal(params.gsrlimit, "5");
  assert.equal(params.prop, "imageinfo"); assert.ok(params.iiprop.split("|").includes("url") && params.iiprop.split("|").includes("extmetadata"));
  assert.equal(params.iiurlwidth, "640"); assert.equal(params.iiextmetadatafilter, "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms"); assert.ok(Number(params.maxlag) > 0);
  assert.equal(params.gsrsearch, "Fictional harbor photos"); assert.equal(photoCall.init.redirect, "manual"); assert.equal(photoCall.init.headers["User-Agent"], USER_AGENT);
  const photos = photoBody.results;
  assert.equal(photoBody.cached, false);
  assert.deepEqual(photos.map((photo) => photo.sourceUrl), EXPECTED_PHOTO_FILES.map((file) => "https://commons.wikimedia.org/wiki/File:" + file), "only reusable raster images with complete attribution");
  for (const photo of photos) {
    assert.deepEqual(Object.keys(photo).sort(), [...COMMONS_PHOTO_KEYS].sort(), "photo result fields");
    assert.equal(photo.provider, "wikimedia-commons");
    assert.ok(photo.url.startsWith("https://upload.wikimedia.org/wikipedia/commons/thumb/") && /\/640px-[^/]+\.(?:jpe?g|png)$/i.test(photo.url), "bounded thumbnail on upload.wikimedia.org");
    assert.equal(photo.licenseUrl, COMMONS_LICENSES[photo.license], "canonical license URL");
    assert.ok(photo.credit.includes(photo.author) && photo.credit.includes(photo.license), "credit names author and license");
  }
  assert.deepEqual(photos.map((photo) => [photo.author, photo.license]), [["Invented Artist & Friend", "CC0"], ["Fictional Photographer", "CC BY-SA 4.0"], ["Fictional Walker", "CC BY 2.0"], ["Real Name", "CC BY-SA 4.0"]]);
  assert.ok(!/[<>]|script/i.test(JSON.stringify(photos)), "results never contain markup");
  assert.equal(expect(await ownerSearch(api, alpha.id, "photo", "fictional HARBOR photos"), 200, "photo cache").cached, true);
  const emptyPhotos = expect(await ownerSearch(api, alpha.id, "photo", "Fictional nomatch alley"), 200, "photo no match");
  assert.deepEqual(emptyPhotos, { results: [], cached: false }, "no match is an empty result");
  const callsAfterEmpty = callCount();
  assert.deepEqual(expect(await ownerSearch(api, alpha.id, "photo", "Fictional nomatch alley"), 200, "cached no match"), { results: [], cached: true });
  assert.equal(callCount(), callsAfterEmpty, "empty results are cached too");
  assert.deepEqual(expect(await ownerSearch(api, alpha.id, "place", "Fictional nowhere square"), 200, "place no match"), { results: [], cached: false });
  provider.handler = () => json({ batchcomplete: true, query: { pages: [commonsPage(1, "Fictional_nc_only.jpg", { license: "CC BY-NC 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/" })] } });
  assert.deepEqual(expect(await ownerSearch(api, alpha.id, "photo", "Fictional restricted gallery"), 200, "only restricted matches").results, [], "restricted licenses are never offered");
  provider.handler = null;
  provider.handler = () => json(CURRENT_CDN_FIXTURE);
  const cdnPhotos = expect(await ownerSearch(api, alpha.id, "photo", "Fictional current CDN garden"), 200, "current CDN search").results;
  provider.handler = null;
  assert.equal(cdnPhotos.length, 1);
  assert.equal(new URL(cdnPhotos[0].url).hostname, "thumb.wikimedia.org");
  assert.equal(new URL(cdnPhotos[0].url).search, "");
  freshWindow();
  console.log("Photos: fixed Commons query, reusable licences, complete plain-text attribution, current and legacy thumbnail hosts, tracking removal, empty matches and cache passed.");

  // -------------------------------------------------------------------------------------------
  // Provider misbehavior: explicit errors, nothing cached, provider text never echoed.
  const encoder = new TextEncoder();
  let streamPulls = 0; let streamCancelled = false;
  let neverSignal = null;
  const misbehavior = [
    ["redirect", "place", () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.fictional.invalid/" } }), 502, "lookup_unavailable"],
    ["rate limited", "place", () => json({ error: "Fictional slow down" }, 429), 502, "lookup_unavailable"],
    ["HTML", "place", () => new Response("<html>Fictional</html>", { status: 200, headers: { "Content-Type": "text/html" } }), 502, "lookup_malformed"],
    ["invalid JSON", "place", () => new Response("not json{", { status: 200, headers: JSON_TYPE }), 502, "lookup_malformed"],
    ["object instead of array", "place", () => json({ error: "Fictional" }), 502, "lookup_malformed"],
    ["invalid UTF-8", "place", () => new Response(new Uint8Array([0x5b, 0xff, 0x5d]), { status: 200, headers: JSON_TYPE }), 502, "lookup_malformed"],
    ["missing body", "place", () => fakeResponse({ body: null }), 502, "lookup_malformed"],
    ["declared oversize", "place", () => fakeResponse({ headers: { ...JSON_TYPE, "Content-Length": "10000000" }, body: new Response("[]").body }), 502, "lookup_malformed"],
    ["streamed oversize", "place", () => fakeResponse({ body: new ReadableStream({
      pull(controller) { streamPulls += 1; if (streamPulls > 64) controller.close(); else controller.enqueue(new Uint8Array(64 * 1024).fill(0x20)); },
      cancel() { streamCancelled = true; } }, { highWaterMark: 0 }) }), 502, "lookup_malformed"],
    ["maxlag", "photo", () => json({ error: { code: "maxlag", info: "Fictional lag" } }), 502, "lookup_unavailable"],
    ["malformed Commons", "photo", () => json({ query: "Fictional" }), 502, "lookup_malformed"],
    ["network error", "place", () => Promise.reject(new TypeError("Fictional network failure")), 502, "lookup_unavailable"],
    ["synchronous throw", "place", () => { throw new Error("Fictional crash"); }, 502, "lookup_unavailable"],
    ["timeout honoring abort", "place", (call) => new Promise((_, reject) => { neverSignal = call.init.signal; call.init.signal.addEventListener("abort", () => reject(new DOMException("Fictional abort", "AbortError"))); }), 504, "lookup_timeout"],
    ["timeout ignoring abort", "place", () => new Promise(() => {}), 504, "lookup_timeout"],
    ["stalled body", "photo", () => fakeResponse({ body: new ReadableStream({ start(controller) { controller.enqueue(encoder.encode("{")); } }) }), 504, "lookup_timeout"]
  ];
  for (const [label, kind, handler, status, code] of misbehavior) {
    const cacheSize = runtime.lookups.cache.size;
    provider.handler = handler;
    const response = await ownerSearch(api, alpha.id, kind, "Fictional misbehavior " + label);
    expect(response, status, "provider " + label, code);
    assert.ok(!/Fictional (?:slow down|lag|network failure|crash|abort)|<html>/.test(response.text), "provider details are not echoed: " + label);
    assert.equal(runtime.lookups.cache.size, cacheSize, "failures are not cached: " + label);
  }
  provider.handler = null;
  assert.ok(streamPulls > 0 && streamPulls < 10, "an oversized stream is abandoned early (pulled " + streamPulls + " chunks)");
  assert.ok(streamCancelled, "the oversized stream is cancelled");
  assert.ok(neverSignal?.aborted, "the timed-out request was aborted");
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse"), 200, "service recovers").cached, true);
  console.log("Provider failures: redirects, bad status/type/JSON/UTF-8, missing body, declared and streamed oversize, maxlag, network errors and timeouts mapped to explicit errors without caching.");

  // -------------------------------------------------------------------------------------------
  // Global single flight, start interval and bounded queue.
  freshWindow();
  let release;
  const hold = new Promise((resolve) => { release = resolve; });
  provider.handler = async (call) => { await hold; return defaultHandler(call); };
  provider.maxActive = 0;
  const queueStart = callCount();
  const queued = ["Fictional Queue One", "Fictional Queue Two", "Fictional Queue Three"].map((query) => ownerSearch(api, alpha.id, "place", query));
  await waitFor(() => runtime.lookups.gate.pending === 3 && callCount() === queueStart + 1, "one in flight and two queued");
  expect(await ownerSearch(api, alpha.id, "photo", "Fictional Queue Four"), 503, "queue full", "lookup_busy");
  assert.equal(callCount(), queueStart + 1, "a busy refusal makes no provider call");
  release();
  for (const response of await Promise.all(queued)) expect(response, 200, "queued lookup completes");
  assert.equal(callCount(), queueStart + 3); assert.equal(provider.maxActive, 1, "never more than one upstream request in flight");
  const starts = provider.calls.slice(queueStart).map((call) => call.at);
  for (let index = 1; index < starts.length; index += 1) assert.ok(starts[index] - starts[index - 1] >= MIN_START_INTERVAL_MS, "queued starts keep the minimum interval");

  fakeNow += 10_000;
  let releaseSlow;
  const slowHold = new Promise((resolve) => { releaseSlow = resolve; });
  provider.handler = async (call) => {
    if (call.url.searchParams.get("q") === "Fictional Slow One") { await slowHold; fakeNow += MAX_QUEUE_WAIT_MS + 1000; }
    return defaultHandler(call);
  };
  const slow = ownerSearch(api, alpha.id, "place", "Fictional Slow One");
  await waitFor(() => provider.calls.at(-1)?.url.searchParams.get("q") === "Fictional Slow One", "slow lookup in flight");
  const waiting = ownerSearch(api, alpha.id, "place", "Fictional Slow Two");
  await waitFor(() => runtime.lookups.gate.pending === 2, "second lookup queued");
  releaseSlow();
  expect(await slow, 200, "slow lookup");
  expect(await waiting, 503, "queue wait is bounded", "lookup_busy");
  assert.ok(!provider.calls.some((call) => call.url.searchParams.get("q") === "Fictional Slow Two"), "a lookup that waited too long never reaches the provider");
  provider.handler = null;
  console.log("Rate limiting: one upstream request in flight, >= " + MIN_START_INTERVAL_MS + " ms between starts, bounded queue and bounded queue wait passed.");

  // Per-account cap (cache hits count too); other accounts are independent; the window resets.
  freshWindow();
  const capped = await api.makeAccount("fictional.lookup.capped", "content-manager");
  const capCalls = callCount();
  for (let index = 0; index < ACCOUNT_LOOKUP_LIMIT; index += 1) {
    expect(await api.as(capped.cookie, searchRoute(alpha.id, "place"), { method: "POST", body: { query: "Fictional Harbor Lighthouse" } }), 200, "within the account cap");
  }
  expect(await api.as(capped.cookie, searchRoute(alpha.id, "photo"), { method: "POST", body: { query: "Fictional harbor photos" } }), 429, "account cap", "rate_limited");
  expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse"), 200, "other accounts are unaffected");
  fakeNow += ACCOUNT_LOOKUP_WINDOW_MS + 1;
  expect(await api.as(capped.cookie, searchRoute(alpha.id, "place"), { method: "POST", body: { query: "Fictional Harbor Lighthouse" } }), 200, "cap resets after the window");
  assert.equal(callCount(), capCalls, "cap checks used only cached results");
  console.log("Per-account cap: " + ACCOUNT_LOOKUP_LIMIT + " lookups per window per account, independent accounts and window reset passed.");

  // -------------------------------------------------------------------------------------------
  // Saving selected places and photos (shared validation for web, MCP and import).
  const saveCalls = callCount();
  alpha = await api.trip(alpha.id);
  const chosen = places[0];
  const selectBody = { requestId: "lk-select-place", expectedVersion: alpha.version, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", place: chosen } }] };
  const selected = expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: selectBody }), 200, "select a place");
  alpha = selected.trip;
  assert.deepEqual(slotOf(alpha, "lk-plain").place, chosen, "the chosen result is stored as-is");
  assert.deepEqual([slotOf(alpha, "lk-plain").lat, slotOf(alpha, "lk-plain").lng, slotOf(alpha, "lk-plain").address], [chosen.lat, chosen.lng, chosen.address], "lat/lng/address mirror the place");
  assert.deepEqual(expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: selectBody }), 200, "identical retry"), selected, "identical retry replays");
  expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: { ...selectBody, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", place: places[1] } }] } }), 409, "changed retry", "request_id_conflict");
  expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: { requestId: "lk-stale", expectedVersion: alpha.version - 1, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", place: places[1] } }] } }), 409, "stale write", "version_conflict");
  assert.equal((await api.trip(beta.id)).version, beta.version, "trip isolation: other trips are untouched");

  // The selected place, not the legacy Google URL, owns the location.
  alpha = expect(await change(api, alpha, "lk-google-place", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-google", place: places[1] } }]), 200, "place on a Google plan").trip;
  let google = slotOf(alpha, "lk-google");
  assert.deepEqual([google.lat, google.lng, google.address], [places[1].lat, places[1].lng, places[1].address], "old Google-derived fields do not override the place");
  assert.equal(google.googleMapsUrl, GOOGLE_URL, "legacy URL retained"); assert.equal(google.googleMapsPlaceName, "Fictional Harbor Cafe");
  assert.deepEqual(google.photo, LEGACY_PHOTO, "selecting a place never changes the photo");
  alpha = expect(await change(api, alpha, "lk-google-rename", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-google", name: "Invented harbor cafe terrace" } }]), 200, "unrelated edit").trip;
  assert.equal(slotOf(alpha, "lk-google").lat, places[1].lat, "unrelated edits keep the place location");
  alpha = expect(await change(api, alpha, "lk-google-url", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-google", googleMapsUrl: OTHER_GOOGLE_URL } }]), 200, "Google URL change").trip;
  assert.equal(slotOf(alpha, "lk-google").lat, places[1].lat, "a changed Google URL does not override the place");
  assert.equal(slotOf(alpha, "lk-google").googleMapsUrl, OTHER_GOOGLE_URL);

  // Conflicting duplicates are refused; matching duplicates are accepted.
  for (const [label, plan] of [["conflicting lat with a new place", { id: "lk-plain", place: places[2], lat: places[2].lat + 0.5 }],
    ["conflicting lng", { id: "lk-plain", lng: 0 }], ["conflicting address", { id: "lk-plain", address: "Somewhere else entirely" }],
    ["new plan conflict", { id: "lk-new", name: "Invented pier", place: places[3], lat: 1, lng: 2 }]]) {
    expect(await change(api, alpha, "lk-conflict-" + label.replaceAll(" ", "-"), [{ type: "upsert_plan", dayId: "lk-day", plan }]), 422, label, "validation_failed");
  }
  assert.equal((await api.trip(alpha.id)).version, alpha.version, "conflicts never write");
  alpha = expect(await change(api, alpha, "lk-new-plan", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", name: "Invented pier", time: "15:00", place: places[3], lat: places[3].lat, lng: places[3].lng } }]), 200, "matching duplicates").trip;
  assert.equal(slotOf(alpha, "lk-new").address, places[3].address);

  // Photos are selected independently of places.
  const chosenPhoto = cdnPhotos[0];
  alpha = expect(await change(api, alpha, "lk-photo", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", photo: chosenPhoto } }]), 200, "select a photo").trip;
  assert.deepEqual(slotOf(alpha, "lk-plain").photo, chosenPhoto, "photo stored as chosen"); assert.deepEqual(slotOf(alpha, "lk-plain").place, chosen, "photo selection never changes the place");
  alpha = expect(await change(api, alpha, "lk-replace-place", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", place: places[2] } }]), 200, "replace the place").trip;
  assert.deepEqual(slotOf(alpha, "lk-plain").photo, chosenPhoto, "place selection never changes the photo");
  assert.equal(slotOf(alpha, "lk-plain").lat, places[2].lat, "the new place replaces carried-over coordinates");

  // Removing the place restores the legacy Google URL behavior.
  alpha = expect(await change(api, alpha, "lk-google-unplace", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-google", place: null } }]), 200, "remove place").trip;
  google = slotOf(alpha, "lk-google");
  assert.equal(google.place, undefined); assert.deepEqual([google.lat, google.lng, google.address], [35.2222, 139.3333, "1 Invented Quay, Exampleton"], "location re-derived from the Google URL");
  assert.deepEqual(google.photo, LEGACY_PHOTO);

  // Removing the place from a plan without a Google URL drops the carried-over mirrored lat/lng/address
  // (upsert patch, UI-style full-object upsert and replace_content); values the caller changed are kept,
  // and plans that never had a place keep their own location fields.
  alpha = expect(await change(api, alpha, "lk-unplace-seed", [
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-patch", name: "Invented lighthouse steps", time: "16:00", place: places[0] } },
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-full", name: "Invented market stroll", time: "16:10", place: places[1] } },
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-replace", name: "Invented old town loop", time: "16:20", place: places[2] } },
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-edited", name: "Invented pier bench", time: "16:30", place: places[3] } },
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-legacy", name: "Invented manual spot", time: "16:40", lat: 12.5, lng: 45.25, address: "Fictional manual address" } }
  ]), 200, "seed place-removal plans").trip;
  assert.equal(slotOf(alpha, "lk-unplace-full").lat, places[1].lat, "seeded place is mirrored");
  const fullWithoutPlace = omit(slotOf(alpha, "lk-unplace-full"), "place");
  alpha = expect(await change(api, alpha, "lk-unplace-1", [
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-patch", place: null } },
    { type: "upsert_plan", dayId: "lk-day", plan: { ...fullWithoutPlace, place: null } },
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-edited", place: null, lat: 10.5, lng: 20.5 } },
    { type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-unplace-legacy", place: null } }
  ]), 200, "remove places").trip;
  for (const id of ["lk-unplace-patch", "lk-unplace-full"]) {
    const plan = slotOf(alpha, id);
    assert.deepEqual([plan.place, plan.lat, plan.lng, plan.address], [undefined, undefined, undefined, undefined], id + ": carried-over mirrored fields are removed with the place");
  }
  const edited = slotOf(alpha, "lk-unplace-edited");
  assert.deepEqual([edited.place, edited.lat, edited.lng, edited.address], [undefined, 10.5, 20.5, undefined], "explicitly changed coordinates are kept; the unchanged mirrored address is removed");
  const manual = slotOf(alpha, "lk-unplace-legacy");
  assert.deepEqual([manual.lat, manual.lng, manual.address], [12.5, 45.25, "Fictional manual address"], "a plan that never had a place keeps its own location");
  const unplaceSnapshot = structuredClone(alpha);
  delete unplaceSnapshot.days.find((day) => day.id === "lk-day").slots.find((slot) => slot.id === "lk-unplace-replace").place;
  alpha = expect(await change(api, alpha, "lk-unplace-2", [{ type: "replace_content", trip: unplaceSnapshot }]), 200, "replace_content without the place").trip;
  const replaced = slotOf(alpha, "lk-unplace-replace");
  assert.deepEqual([replaced.place, replaced.lat, replaced.lng, replaced.address], [undefined, undefined, undefined, undefined], "replace_content removal drops the carried-over fields too");
  assert.deepEqual([slotOf(alpha, "lk-unplace-legacy").lat, slotOf(alpha, "lk-unplace-edited").lat], [12.5, 10.5], "replace_content keeps location fields of plans without a stored place");

  // replace_content round trip keeps place and photo.
  const snapshot = structuredClone(alpha); snapshot.shortName = "Lookup coast";
  alpha = expect(await change(api, alpha, "lk-replace-content", [{ type: "replace_content", trip: snapshot }]), 200, "replace_content").trip;
  assert.deepEqual(slotOf(alpha, "lk-plain").place, places[2]); assert.deepEqual(slotOf(alpha, "lk-plain").photo, chosenPhoto);

  // Invalid place and photo objects.
  const p = places[0];
  const badPlaces = [["string", "node/1"], ["array", [p]], ["google provider", { ...p, provider: "google" }],
    ["zero id", { ...p, id: "node/0", sourceUrl: "https://www.openstreetmap.org/node/0" }], ["bad type", { ...p, id: "nodes/12", sourceUrl: "https://www.openstreetmap.org/nodes/12" }],
    ["mismatched source", { ...p, sourceUrl: "https://www.openstreetmap.org/node/999" }], ["foreign source", { ...p, sourceUrl: "https://maps.fictional.invalid/node/4100000001" }],
    ["extra field", { ...p, rating: 5 }], ["sensitive field", { ...p, ["access" + "Token"]: "fictional" }], ["missing selectedAt", omit(p, "selectedAt")],
    ["bad selectedAt", { ...p, selectedAt: "yesterday" }], ["impossible selectedAt", { ...p, selectedAt: "2032-13-45T00:00:00Z" }],
    ["latitude range", { ...p, lat: 91 }], ["string latitude", { ...p, lat: "35.6" }], ["missing lng", omit(p, "lng")],
    ["markup name", { ...p, name: "<img src=x onerror=alert(1)>" }], ["empty name", { ...p, name: "" }], ["long address", { ...p, address: "x".repeat(501) }],
    ["changed attribution", { ...p, attribution: "Fictional Maps Inc." }], ["wrong license", { ...p, license: "CC0" }]];
  const ph = photos[1];
  const badPhotos = [["other image host", { ...ph, url: "https://images.fictional.invalid/thumb/640px-x.jpg" }], ["query on image", { ...ph, url: ph.url + "?download=1" }],
    ["vector image", { ...ph, url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_map.svg" }], ["http image", { ...ph, url: ph.url.replace("https:", "http:") }],
    ["non-File source", { ...ph, sourceUrl: "https://commons.wikimedia.org/wiki/Category:Fictional" }],
    ["NC license", { ...ph, license: "CC BY-NC 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/" }],
    ["ND license", { ...ph, license: "CC BY-ND 4.0", licenseUrl: "https://creativecommons.org/licenses/by-nd/4.0/" }],
    ["ported license", { ...ph, license: "CC BY-SA 3.0 de", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/de/" }],
    ["mismatched license URL", { ...ph, licenseUrl: "https://creativecommons.org/licenses/by/4.0/" }], ["missing author", omit(ph, "author")],
    ["markup author", { ...ph, author: "<a href=\"https://fictional.invalid\">Fictional</a>" }], ["missing credit", omit(ph, "credit")],
    ["extra field", { ...ph, width: 640 }], ["bad selectedAt", { ...ph, selectedAt: "2032-13-45T00:00:00Z" }],
    // Commons provider + selectedAt is the managed snapshot: strict even for old-looking shapes.
    ["null selectedAt", { ...ph, selectedAt: null }], ["empty selectedAt", { ...ph, selectedAt: "" }],
    ["managed without license", omit(omit(ph, "license"), "licenseUrl")], ["managed foreign source", { ...ph, sourceUrl: "https://images.fictional.invalid/x" }],
    ["managed legacy shape", { ...LEGACY_COMMONS_PHOTO, selectedAt: ph.selectedAt }], ["managed sensitive key", { ...ph, ["access" + "Token"]: "fictional" }],
    // Legacy free objects (no managed marker) keep the earlier free-object protections.
    ["legacy sensitive key", { ...LEGACY_MANUAL_PHOTO, ["access" + "Token"]: "fictional" }], ["legacy unsafe URL", { ...LEGACY_MANUAL_PHOTO, url: "javascript:alert(1)" }],
    ["legacy Commons unsafe source", { ...LEGACY_COMMONS_PHOTO, sourceUrl: "data:text/html,fictional" }],
    ["legacy too deep", { ...LEGACY_MANUAL_PHOTO, extra: Array.from({ length: 12 }).reduce((inner) => ({ inner }), {}) }]];
  for (const [label, photo] of badPhotos.slice(-4)) assert.equal(isManagedCommonsPhoto(photo), false, "legacy case is not managed: " + label);
  for (const [label, place] of badPlaces) expect(await change(api, alpha, "lk-bad-place-" + label.replaceAll(" ", "-"), [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", place } }]), 422, "invalid place: " + label, "validation_failed");
  for (const [label, photo] of badPhotos) expect(await change(api, alpha, "lk-bad-photo-" + label.replaceAll(" ", "-"), [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-plain", photo } }]), 422, "invalid photo: " + label, "validation_failed");
  assert.equal((await api.trip(alpha.id)).version, alpha.version, "invalid objects never write");
  alpha = expect(await change(api, alpha, "lk-legacy-photos", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", photo: { url: "https://images.fictional.invalid/pier.jpg", sourceUrl: "https://images.fictional.invalid/pier", credit: "Fictional · CC BY 4.0" } } }]), 200, "legacy photo object").trip;
  alpha = expect(await change(api, alpha, "lk-legacy-photo-path", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", photo: "/photos/fictional-pier.webp" } }]), 200, "legacy photo path").trip;
  assert.equal(slotOf(alpha, "lk-new").photo, "/photos/fictional-pier.webp");

  // Legacy photo objects with a provider label but no managed marker are stored exactly as given and
  // survive unrelated edits and replace_content (no selectedAt added, credit/source untouched).
  const LEGACY_LABELLED = [["lk-legacy-manual", LEGACY_MANUAL_PHOTO], ["lk-legacy-commons", LEGACY_COMMONS_PHOTO],
    ["lk-legacy-unmarked", omit(ph, "selectedAt")], ["lk-legacy-other", { ...ph, provider: "fictional-photos" }]];
  for (const [, photo] of LEGACY_LABELLED) assert.equal(isManagedCommonsPhoto(photo), false, "provider label alone is not the managed marker");
  alpha = expect(await change(api, alpha, "lk-legacy-labelled", LEGACY_LABELLED.map(([id, photo], index) => (
    { type: "upsert_plan", dayId: "lk-day", plan: { id, name: "Invented legacy photo stop " + index, time: "18:0" + index, photo } }))), 200, "legacy photos with provider labels").trip;
  const checkLegacyPhotos = (trip, label) => {
    for (const [id, photo] of LEGACY_LABELLED) assert.deepEqual(slotOf(trip, id).photo, photo, label + ": " + id + " stored unchanged");
  };
  checkLegacyPhotos(alpha, "legacy save");
  alpha = expect(await change(api, alpha, "lk-legacy-labelled-rename", [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-legacy-commons", name: "Invented old pier, renamed" } }]), 200, "unrelated legacy edit").trip;
  checkLegacyPhotos(alpha, "unrelated edit");
  alpha = expect(await change(api, alpha, "lk-legacy-labelled-replace", [{ type: "replace_content", trip: { ...structuredClone(alpha), shortName: "Legacy photos" } }]), 200, "replace_content with legacy photos").trip;
  checkLegacyPhotos(alpha, "replace_content");
  console.log("Saved places/photos: canonical mirroring, conflict refusal, Google-URL precedence and fallback, independent photo/place selection, retries, version conflicts and strict schemas passed.");

  // MCP writes the selected objects through apply_trip_changes (PLAN_KEYS schema) with shared validation.
  {
    const mcp = await mcpSession(runtime.url);
    const read = await mcp.tool("get_trip", { tripId: alpha.id });
    assert.deepEqual(slotOf(read.data.trip, "lk-plain").place, places[2], "MCP reads the saved place");
    const written = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "lk-mcp-place", expectedVersion: read.data.trip.version, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", place: places[0], photo: photos[0] } }] });
    assert.ok(!written.isError, "MCP place/photo write"); alpha = written.data.trip;
    assert.deepEqual(slotOf(alpha, "lk-new").place, places[0]); assert.equal(slotOf(alpha, "lk-new").lat, places[0].lat, "MCP writes mirror the place");
    const refused = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "lk-mcp-bad", expectedVersion: alpha.version, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", place: { ...places[0], provider: "google" } } }] });
    assert.equal(refused.isError, true); assert.equal(refused.data.error.code, "validation_failed", "MCP uses the same place validation");
    const conflictMcp = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "lk-mcp-conflict", expectedVersion: alpha.version, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", lat: 0 } }] });
    assert.equal(conflictMcp.isError, true); assert.equal(conflictMcp.data.error.code, "validation_failed", "MCP refuses conflicting duplicates");
    const unplaced = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "lk-mcp-unplace", expectedVersion: alpha.version, changes: [{ type: "upsert_plan", dayId: "lk-day", plan: { id: "lk-new", place: null } }] });
    assert.ok(!unplaced.isError, "MCP place removal"); alpha = unplaced.data.trip;
    const mcpPlan = slotOf(alpha, "lk-new");
    assert.deepEqual([mcpPlan.place, mcpPlan.lat, mcpPlan.lng, mcpPlan.address], [undefined, undefined, undefined, undefined], "MCP removal drops carried-over mirrored fields");
    assert.deepEqual(mcpPlan.photo, photos[0], "MCP place removal never changes the photo");
    await mcp.close();
  }

  // Export/import carries the saved objects; a tampered conflicting export is refused.
  const exported = expect(await api.owner("/api/trips/" + alpha.id + "/export"), 200, "export with places");
  assert.deepEqual(slotOf(exported.trip, "lk-plain").place, places[2]); assert.deepEqual(slotOf(exported.trip, "lk-plain").photo, chosenPhoto);
  const imported = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "lk-import-places", data: exported } }), 201, "import with places").trip;
  assert.notEqual(imported.id, alpha.id);
  assert.deepEqual(slotOf(imported, "lk-plain").place, places[2]); assert.deepEqual(slotOf(imported, "lk-plain").photo, chosenPhoto);
  assert.deepEqual(slotOf(imported, "lk-google").photo, LEGACY_PHOTO); assert.equal(slotOf(imported, "lk-google").lat, 35.2222);
  checkLegacyPhotos(exported.trip, "export"); checkLegacyPhotos(imported, "import");
  const tampered = structuredClone(exported); slotOf(tampered.trip, "lk-plain").lat += 1;
  expect(await api.owner("/api/import", { method: "POST", body: { requestId: "lk-import-tampered", data: tampered } }), 422, "conflicting import", "validation_failed");
  assert.equal(callCount(), saveCalls, "saving, MCP, export and import never call a provider");
  console.log("MCP place/photo writes, export/import round trip and conflicting-import refusal passed without provider calls.");

  // -------------------------------------------------------------------------------------------
  // Restart persistence.
  const savedAlpha = await api.trip(alpha.id);
  const cacheText = fs.readFileSync(cacheFile, "utf8");
  const cacheDocument = JSON.parse(cacheText);
  assert.equal(cacheDocument.format, "shared-trip-lookup-cache"); assert.ok(Array.isArray(cacheDocument.entries) && cacheDocument.entries.length > 0);
  assert.ok(!/nomatch|misbehavior|selectedAt/i.test(cacheText), "the cache stores digests of queries and no selection times");
  assert.ok(!cacheText.includes(ownerToken) && !cacheText.includes(manager.cookie.split("=")[1]), "no credentials in the cache");
  await stop(runtime);
  runtime = await start("main", ENABLED);
  api = client(runtime.url);
  const restartCalls = callCount();
  assert.deepEqual(await api.trip(alpha.id), savedAlpha, "saved places and photos survive restart");
  expect(await api.owner("/api/trips"), 200, "list after restart"); expect(await api.owner("/api/trips/" + alpha.id + "/export"), 200, "export after restart");
  expect(await change(api, savedAlpha, "lk-after-restart", [{ type: "update_trip", fields: { shortName: "Restarted" } }]), 200, "edit after restart");
  assert.equal(callCount(), restartCalls, "restart and reload paths make no provider call");
  freshWindow();
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse"), 200, "cached place after restart").cached, true);
  const restartedPhotos = expect(await ownerSearch(api, alpha.id, "photo", "Fictional harbor photos"), 200, "cached photos after restart");
  assert.equal(restartedPhotos.cached, true); assert.deepEqual(withoutTime(restartedPhotos.results), withoutTime(photos));
  assert.deepEqual(expect(await ownerSearch(api, alpha.id, "photo", "Fictional nomatch alley"), 200, "cached empty after restart"), { results: [], cached: true });
  assert.equal(callCount(), restartCalls, "cache hits after restart make no provider call");
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse", { refresh: true }), 200, "refresh after restart").cached, false);
  assert.equal(callCount(), restartCalls + 1);
  await stop(runtime);

  // A corrupt cache is ignored (it is not trip content); trips are unaffected.
  fs.writeFileSync(cacheFile, "{not json");
  runtime = await start("main", ENABLED);
  api = client(runtime.url);
  assert.equal(slotOf(await api.trip(alpha.id), "lk-plain").place.id, places[2].id, "trips do not depend on the cache");
  const corruptCalls = callCount();
  assert.equal(expect(await ownerSearch(api, alpha.id, "place", "Fictional Harbor Lighthouse"), 200, "search after corrupt cache").cached, false);
  assert.equal(callCount(), corruptCalls + 1);
  assert.equal(JSON.parse(fs.readFileSync(cacheFile, "utf8")).format, "shared-trip-lookup-cache", "cache rewritten after a successful lookup");
  await stop(runtime);
  console.log("Persistence: saved objects and cache survive restart, cache hits and refresh after restart, corrupt cache ignored.");

  // -------------------------------------------------------------------------------------------
  // Operator-selected Nominatim-compatible endpoint (cache is per endpoint).
  {
    const custom = await start("custom", { ...ENABLED, SHARED_TRIP_NOMINATIM_URL: "https://geocoder.fictional.invalid/osm/search" });
    const customApi = client(custom.url);
    const trip = expect(await customApi.owner("/api/trips", { method: "POST", body: { requestId: "lk-custom", trip: { title: "Fictional Custom Geocoder" } } }), 201, "create").trip;
    const customCalls = callCount();
    freshWindow();
    const body = expect(await ownerSearch(customApi, trip.id, "place", "Fictional Harbor Lighthouse"), 200, "custom endpoint search");
    assert.equal(body.cached, false); assert.equal(callCount(), customCalls + 1);
    const call = provider.calls.at(-1);
    assert.equal(call.url.origin + call.url.pathname, "https://geocoder.fictional.invalid/osm/search", "configured endpoint");
    assert.equal(call.url.searchParams.get("format"), "jsonv2");
    await stop(custom);
  }
  console.log("Configured Nominatim-compatible endpoint passed.");

  // -------------------------------------------------------------------------------------------
  // Cache file byte cap: large but valid Unicode records (900-character URLs, 500-character credit,
  // 300-character author) would exceed the reader's UTF-8 cap at MAX_CACHE_ENTRIES entries; the
  // writer evicts the oldest entries until the file fits, so a restart still loads the cache.
  {
    const dir = dataDirOf("bytecap");
    fs.mkdirSync(dir, { recursive: true });
    const THUMB_PREFIX = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/";
    const fileFor = (tag) => `Fictional_${tag}_`.padEnd(Math.floor((900 - THUMB_PREFIX.length - "/640px-".length) / 2) - 4, "x") + ".jpg";
    const author = "架空の写真家".repeat(50);
    const credit = "クレジット".repeat(100);
    assert.equal(author.length, 300); assert.equal(credit.length, 500);
    const bigPhoto = (tag) => {
      const file = fileFor(tag);
      return { provider: "wikimedia-commons", url: `${THUMB_PREFIX}${file}/640px-${file}`, sourceUrl: `https://commons.wikimedia.org/wiki/File:${file}`,
        credit, author, license: "CC BY-SA 4.0", licenseUrl: COMMONS_LICENSES["CC BY-SA 4.0"] };
    };
    const sample = bigPhoto("sample");
    assert.ok(sample.url.length >= 895 && sample.url.length <= 1000, "900-character image URL within the existing limit (" + sample.url.length + ")");
    assert.ok(normalizeCommonsPhoto({ ...sample, selectedAt: "2032-01-01T00:00:00.000Z" }, "probe", new Issues()), "the large record is production-valid");

    const service = new LookupService({ enabled: true, userAgent: USER_AGENT, dataDir: dir, fetch: lookupFetch, clock: lookupClock, sleep: lookupSleep });
    // Test-only shortcut: prefill the in-memory cache directly instead of making hundreds of lookups.
    const prefillKeys = [];
    for (let index = 0; index < MAX_CACHE_ENTRIES - MAX_LOOKUP_RESULTS; index += 1) {
      const key = "photo:" + crypto.createHash("sha256").update("fictional-prefill-" + index).digest("hex");
      prefillKeys.push(key);
      service.cache.set(key, { results: Array.from({ length: MAX_LOOKUP_RESULTS }, (_, n) => bigPhoto(`p${index}_${n}`)), storedAt: fakeNow });
    }
    const unbounded = Buffer.byteLength(JSON.stringify({ entries: [...service.cache].map(([key, entry]) => ({ key, ...entry })) }), "utf8");
    assert.ok(unbounded > MAX_CACHE_FILE_BYTES, "the prefilled cache alone exceeds the byte cap (" + unbounded + " bytes)");

    provider.handler = (call) => {
      const tag = crypto.createHash("sha256").update(call.url.searchParams.get("gsrsearch")).digest("hex").slice(0, 8);
      return json({ batchcomplete: true, query: { pages: Array.from({ length: MAX_LOOKUP_RESULTS }, (_, n) => commonsPage(n + 1, fileFor(`q${tag}_${n}`), { artist: author })) } });
    };
    const queries = Array.from({ length: MAX_LOOKUP_RESULTS }, (_, index) => "Fictional large gallery " + index);
    const fresh = [];
    const capCalls = callCount();
    for (const query of queries) {
      const body = await service.search("photo", "fictional-bytecap-account", { query });
      assert.equal(body.cached, false); assert.equal(body.results.length, MAX_LOOKUP_RESULTS, "large valid results are returned");
      assert.ok(body.results.every((photo) => photo.url.length > 890 && photo.author === author), "results carry the large Unicode fields");
      fresh.push(withoutTime(body.results));
    }
    provider.handler = null;
    assert.equal(callCount(), capCalls + queries.length);
    const capFile = path.join(dir, LOOKUP_CACHE_FILE);
    const onDisk = fs.statSync(capFile).size;
    assert.ok(onDisk <= MAX_CACHE_FILE_BYTES, `the cache file stays within the byte cap (${onDisk} <= ${MAX_CACHE_FILE_BYTES})`);
    assert.ok(service.cache.size < MAX_CACHE_ENTRIES, "oldest entries were evicted for size, below the entry-count bound");
    assert.ok(!service.cache.has(prefillKeys[0]), "the oldest entry was evicted first");
    assert.deepEqual(JSON.parse(fs.readFileSync(capFile, "utf8")).entries.map((entry) => entry.key), [...service.cache.keys()], "memory and file hold the same entries");

    const reloaded = new LookupService({ enabled: true, userAgent: USER_AGENT, dataDir: dir, fetch: lookupFetch, clock: lookupClock, sleep: lookupSleep });
    assert.equal(reloaded.cache.size, service.cache.size, "every persisted entry is loaded after a restart");
    assert.ok(reloaded.cache.size > queries.length, "older entries survive alongside the newest ones");
    const reloadCalls = callCount();
    for (const [index, query] of queries.entries()) {
      const body = await reloaded.search("photo", "fictional-bytecap-account", { query });
      assert.equal(body.cached, true, "reloaded entry is a cache hit: " + query);
      assert.deepEqual(withoutTime(body.results), fresh[index], "reloaded results are unchanged");
    }
    assert.equal(callCount(), reloadCalls, "cache hits after reload make no provider call");
  }
  console.log("Cache byte cap: persisted file within " + MAX_CACHE_FILE_BYTES + " UTF-8 bytes via oldest-first eviction, memory consistent, reload hits without provider calls.");

  // -------------------------------------------------------------------------------------------
  // Existing content without places: upgrade/enable is a no-op; legacy behavior is unchanged.
  {
    let legacy = await start("legacy");
    let legacyApi = client(legacy.url);
    const tables = () => legacy.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((row) => row.name);
    const importedLegacy = expect(await legacyApi.owner("/api/import", { method: "POST", body: { requestId: "lg-import", data: { trip: {
      slug: "fictional-legacy-shore", title: "Fictional Legacy Shore",
      days: [{ id: "lg-day", date: "2032-06-01", plans: [{ id: "lg-plan", name: "Invented boardwalk", time: "09:00", googleMapsUrl: GOOGLE_URL, photo: LEGACY_PHOTO },
        { id: "lg-free", name: "Invented free afternoon", photo: { url: "https://images.fictional.invalid/free.jpg", sourceUrl: "https://images.fictional.invalid/free", credit: "Fictional · CC0", note: "kept" } },
        { id: "lg-manual", name: "Invented manual photo stop", photo: LEGACY_MANUAL_PHOTO },
        { id: "lg-old-commons", name: "Invented old Commons photo stop", photo: LEGACY_COMMONS_PHOTO }] }]
    } } } }), 201, "legacy import").trip;
    const legacyLabelled = (trip, label) => {
      assert.deepEqual(slotOf(trip, "lg-manual").photo, LEGACY_MANUAL_PHOTO, label + ": old manual-provider photo unchanged");
      assert.deepEqual(slotOf(trip, "lg-old-commons").photo, LEGACY_COMMONS_PHOTO, label + ": old Commons-provider photo unchanged (no selectedAt invented)");
    };
    legacyLabelled(importedLegacy, "legacy import");
    const before = await legacyApi.trip(importedLegacy.id);
    const tablesBefore = tables();
    await stop(legacy);
    legacy = await start("legacy", ENABLED);
    legacyApi = client(legacy.url);
    const legacyCalls = callCount();
    assert.deepEqual(await legacyApi.trip(importedLegacy.id), before, "existing content is unchanged by enabling lookups");
    assert.deepEqual(tables(), tablesBefore, "no database tables were added");
    assert.equal(legacy.db.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION, "schema version unchanged");
    const edited = expect(await change(legacyApi, before, "lg-rename", [{ type: "upsert_plan", dayId: "lg-day", plan: { id: "lg-plan", name: "Invented boardwalk stroll" } }]), 200, "legacy edit").trip;
    const plan = slotOf(edited, "lg-plan");
    assert.equal(plan.place, undefined); assert.equal(plan.lat, 35.1234); assert.equal(plan.address, "1 Invented Quay, Exampleton");
    assert.equal(plan.googleMapsPlaceName, "Fictional Harbor Cafe"); assert.deepEqual(plan.photo, LEGACY_PHOTO);
    assert.deepEqual(slotOf(edited, "lg-free").photo, slotOf(before, "lg-free").photo, "free-form legacy photo objects are preserved");
    legacyLabelled(edited, "unrelated legacy edit");
    const legacyExport = expect(await legacyApi.owner("/api/trips/" + importedLegacy.id + "/export"), 200, "legacy export");
    legacyLabelled(legacyExport.trip, "legacy export");
    const reimported = expect(await legacyApi.owner("/api/import", { method: "POST", body: { requestId: "lg-reimport", data: legacyExport } }), 201, "legacy re-import").trip;
    legacyLabelled(reimported, "legacy re-import");
    assert.equal(callCount(), legacyCalls, "legacy reads and edits make no provider call");
    const editedTrip = await legacyApi.trip(importedLegacy.id);
    await stop(legacy);

    // Validated snapshot (normalizeContent on every trip) and a restore into a fresh data directory.
    const snapshotFile = path.join(temporary, "legacy-snapshot.sqlite");
    await snapshotDatabase(path.join(fs.realpathSync(dataDirOf("legacy")), "shared-trip.sqlite"), snapshotFile);
    await snapshotDatabase(snapshotFile, path.join(dataDirOf("legacy-restored"), "shared-trip.sqlite"));
    const restored = await start("legacy-restored");
    const restoredTrip = await client(restored.url).trip(importedLegacy.id);
    assert.deepEqual(restoredTrip, editedTrip, "restored snapshot keeps the trip exactly");
    legacyLabelled(restoredTrip, "snapshot/restore");
    await stop(restored);
  }
  console.log("Legacy content: unchanged after enabling lookups, no schema change, Google URL behavior and free-form photos preserved.");

  assert.equal(externalAttempts, 0, "no external network access was attempted");
  console.log("Place/photo lookup and saved place contract tests passed.");
} finally {
  for (const sdk of sdkClients.splice(0)) { try { await sdk.close(); } catch { /* already closed */ } }
  for (const runtime of running.splice(0)) { try { await runtime.close(); } catch { /* already closed */ } }
  globalThis.fetch = realFetch;
  fs.rmSync(temporary, { recursive: true, force: true });
}
