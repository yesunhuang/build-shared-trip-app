// Optional Google Places UI Kit: server configuration and plan.googlePlaceAssociation contract,
// tested through real HTTP and the official MCP SDK client against the actual service.
//
// Fictional data only. No Google service is contacted: the global fetch is wrapped so any
// non-loopback request fails the test, the browser key is an obviously fake placeholder, and the
// Place IDs are invented strings that only match the documented ID alphabet.
//
// Covers: disabled-by-default configuration and strict env parsing; the protected no-store,
// key-free configuration route (anonymous, viewer, content manager, owner, MCP credential outside
// /mcp) and a refused reservation while no allowance is configured;
// the session feature flag only when enabled; the key never appearing in trip reads, exports,
// static pages or the audit log; the shared SHA-256 binding against node:crypto; a binding that
// covers only location inputs; Place ID parsing from user input; strict association shape with
// forbidden Google content rejected; mismatched/locationless associations refused atomically;
// unrelated edits keeping the association; location change/clear and replace_content dropping a
// stale carried-over one; durable retries and version conflicts; MCP writes; export/import.
import assert from "node:assert/strict";
import {grantFixtureMembership} from "./fixtures/membership.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { GOOGLE_MAPS_BROWSER_KEY_ENV, GOOGLE_PLACES_FLAG_ENV, readGooglePlacesConfig } from "../server/google-places.mjs";
import {
  GOOGLE_PLACE_ASSOCIATION_KEYS, associationForPlan, associationMatchesPlan, googlePlaceAssociationProblems,
  locationBindingForPlan, placeIdFromUserInput, sha256Hex
} from "../assets/app-template/public/google-place-association.js";

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

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-google-places-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
// Obviously fictional placeholders. They are never sent anywhere.
const FAKE_BROWSER_KEY = "FAKE-browser-key-for-tests-only-000000000";
const PLACE_A = "FAKE_place_id_for_tests_0001";
const PLACE_B = "FAKE_place_id_for_tests_0002";
const PLACE_C = "FAKE_place_id_for_tests_0003";
const ENABLED = { [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: FAKE_BROWSER_KEY };
const FORBIDDEN_GOOGLE_FIELDS = ["displayName", "name", "formattedAddress", "address", "location", "lat", "lng", "rating", "userRatingCount", "photos", "photo", "photoName", "googleMapsURI", "viewport"];

const OSM_HALL = {
  provider: "openstreetmap", id: "node/9100000001", name: "Fictional Lantern Hall", address: "1 Invented Quay, Exampleton",
  lat: 35.6001, lng: 139.7001, sourceUrl: "https://www.openstreetmap.org/node/9100000001", attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0", selectedAt: "2032-01-01T00:00:00.000Z"
};
const OSM_PIER = {
  provider: "openstreetmap", id: "way/9100000002", name: "Fictional Ferry Pier", address: "Pier Road, Exampleton",
  lat: 35.6101, lng: 139.7101, sourceUrl: "https://www.openstreetmap.org/way/9100000002", attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0", selectedAt: "2032-01-02T00:00:00.000Z"
};
const MAPS_URL = "https://www.google.com/maps/place/Fictional+Harbor+Cafe,+1+Invented+Quay,+Exampleton/@35.1,139.1,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d35.1234!4d139.5678!16s";
const OTHER_MAPS_URL = MAPS_URL.replace("!3d35.1234!4d139.5678", "!3d35.2222!4d139.3333");

// ---------------------------------------------------------------------------------------------
// 1. Pure checks: configuration parsing, SHA-256, binding, Place ID input, association shape.

assert.deepEqual(readGooglePlacesConfig({}), { enabled: false }, "off by default");
assert.deepEqual(readGooglePlacesConfig({ [GOOGLE_PLACES_FLAG_ENV]: "0", [GOOGLE_MAPS_BROWSER_KEY_ENV]: FAKE_BROWSER_KEY }), { enabled: false });
assert.deepEqual(readGooglePlacesConfig({ [GOOGLE_PLACES_FLAG_ENV]: "1" }), { enabled: false }, "enabled without a key stays off");
assert.deepEqual(readGooglePlacesConfig({ [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: "" }), { enabled: false }, "empty deploy-example key stays off");
assert.deepEqual(readGooglePlacesConfig({ [GOOGLE_MAPS_BROWSER_KEY_ENV]: FAKE_BROWSER_KEY }), { enabled: false }, "a key alone never enables anything");
assert.deepEqual(readGooglePlacesConfig(ENABLED), { enabled: true, browserKey: FAKE_BROWSER_KEY });
for (const flag of ["true", "yes", "2", " 1"]) assert.throws(() => readGooglePlacesConfig({ [GOOGLE_PLACES_FLAG_ENV]: flag }), /must be 1/, `flag ${JSON.stringify(flag)} refused`);
for (const key of ["short", "has spaces in the key value 0000000000", "x".repeat(101), "bad/characters/in/the/key/000000000000"]) {
  assert.throws(() => readGooglePlacesConfig({ [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: key }), /browser API key/);
}
const tokenLike = "A".repeat(40);
assert.throws(() => readGooglePlacesConfig({ [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: tokenLike }, { adminToken: tokenLike }), /admin token/);
assert.throws(() => readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, "bad"), [GOOGLE_PLACES_FLAG_ENV]: "on" }), /must be 1/);
assert.deepEqual(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, "plain") }).googlePlaces, { enabled: false });

for (const sample of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(63), "a".repeat(64), "a".repeat(65), "a".repeat(1000), "旅行 · ランタン 🏮", JSON.stringify(["v1", "osm", "node/1", "1.0000000", "2.0000000", ""])]) {
  assert.equal(sha256Hex(sample), crypto.createHash("sha256").update(sample, "utf8").digest("hex"), `SHA-256 matches node:crypto for length ${sample.length}`);
}

{
  const base = { id: "p", name: "Hall", notes: "Bring tickets", time: "09:00", sortTime: "09:00", sortOrder: 1, review: "x", place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address, i18n: { ja: { name: "ホール" } } };
  const binding = locationBindingForPlan(base);
  assert.match(binding, /^v1:[0-9a-f]{64}$/);
  for (const [key, value] of [["name", "Renamed"], ["notes", "Different private note"], ["time", "11:00"], ["sortTime", "11:00"], ["sortOrder", 7], ["review", "y"], ["i18n", {}], ["booked", true], ["participantGroupIds", ["g"]], ["photo", { url: "https://example.org/x.jpg" }]]) {
    assert.equal(locationBindingForPlan({ ...base, [key]: value }), binding, `${key} is not part of the location binding`);
  }
  assert.equal(locationBindingForPlan({ ...base, place: { ...OSM_HALL, address: "  1 Invented   Quay, Exampleton " } }), binding, "address whitespace is normalized");
  assert.equal(locationBindingForPlan({ ...base, place: { ...OSM_HALL, selectedAt: "2033-01-01T00:00:00.000Z", name: "Other label" } }), binding, "selection time and OSM label are not location inputs");
  assert.notEqual(locationBindingForPlan({ ...base, place: OSM_PIER }), binding, "another OSM object changes the binding");
  assert.notEqual(locationBindingForPlan({ ...base, place: { ...OSM_HALL, lat: 35.6002 } }), binding, "moved coordinates change the binding");
  assert.notEqual(locationBindingForPlan({ ...base, place: { ...OSM_HALL, address: "2 Invented Quay" } }), binding, "a changed address changes the binding");
  assert.equal(locationBindingForPlan({ id: "p", name: "No location" }), "", "no location, no binding");
  const linked = { id: "p", name: "Cafe", googleMapsUrl: MAPS_URL, lat: 35.1234, lng: 139.5678 };
  assert.notEqual(locationBindingForPlan(linked), locationBindingForPlan({ ...linked, googleMapsUrl: OTHER_MAPS_URL }), "a different Maps link changes the binding");
  assert.equal(locationBindingForPlan(linked), locationBindingForPlan({ ...linked, lat: 1, lng: 2 }), "a Maps-link plan is bound to its link");
  const coords = { id: "p", name: "Legacy", lat: 35.1, lng: 139.1, address: "Old road" };
  assert.notEqual(locationBindingForPlan(coords), locationBindingForPlan({ ...coords, address: "New road" }));
  assert.notEqual(locationBindingForPlan(coords), locationBindingForPlan(linked));
  assert.equal(locationBindingForPlan({ ...linked, place: OSM_HALL }), locationBindingForPlan({ place: OSM_HALL }), "a selected place takes precedence, as on the server");
}

{
  // Legacy mapsUrl alias: the same precedence slot as googleMapsUrl, so the editor normalizing it
  // into googleMapsUrl on Save keeps the binding. Malformed aliases are not location links.
  const alias = { id: "p", name: "Cafe", mapsUrl: MAPS_URL, lat: 35.1234, lng: 139.5678, address: "1 Invented Quay, Exampleton" };
  const aliasBinding = locationBindingForPlan(alias);
  const coordinatesOnly = locationBindingForPlan({ lat: alias.lat, lng: alias.lng, address: alias.address });
  assert.match(aliasBinding, /^v1:[0-9a-f]{64}$/);
  assert.equal(aliasBinding, locationBindingForPlan({ googleMapsUrl: MAPS_URL }), "a well-formed mapsUrl alias binds exactly like googleMapsUrl");
  assert.notEqual(aliasBinding, coordinatesOnly, "the alias, not the derived coordinates, is the location input");
  const normalized = { ...alias, googleMapsUrl: MAPS_URL, googleMapsPlaceName: "Fictional Harbor Cafe", googleMapsPlaceLabel: "Fictional Harbor Cafe, 1 Invented Quay, Exampleton", notes: "Edited note", name: "Edited title" };
  assert.equal(locationBindingForPlan(normalized), aliasBinding, "editor normalization plus a note/title edit keeps the binding");
  assert.equal(associationMatchesPlan({ ...normalized, googlePlaceAssociation: associationForPlan(alias, PLACE_C) }), true, "an alias-bound association stays current after normalization");
  assert.equal(locationBindingForPlan({ ...alias, mapsUrl: `  ${MAPS_URL}  ` }), aliasBinding, "surrounding whitespace is ignored, as the server trims it");
  assert.notEqual(locationBindingForPlan({ ...alias, mapsUrl: OTHER_MAPS_URL }), aliasBinding, "a different alias link changes the binding");
  assert.equal(locationBindingForPlan({ ...alias, googleMapsUrl: OTHER_MAPS_URL }), locationBindingForPlan({ googleMapsUrl: OTHER_MAPS_URL }), "googleMapsUrl wins over the alias");
  assert.equal(locationBindingForPlan({ ...alias, place: OSM_HALL }), locationBindingForPlan({ place: OSM_HALL }), "a selected OSM place still takes precedence over the alias");
  for (const malformed of [
    "https://maps.app.goo.gl/FictionalShortLink", MAPS_URL.replace("https:", "http:"), MAPS_URL.replace("!3d35.1234!4d139.5678", ""),
    MAPS_URL.replace("www.google.com", "maps.example.org"), "https://www.google.com/search?q=Fictional+Harbor+Cafe", "not a link", ""
  ]) {
    assert.equal(locationBindingForPlan({ ...alias, mapsUrl: malformed }), coordinatesOnly, `malformed alias ${JSON.stringify(malformed.slice(0, 40))} falls back to saved coordinates`);
  }
  assert.equal(locationBindingForPlan({ mapsUrl: "https://maps.app.goo.gl/FictionalShortLink" }), "", "a malformed alias alone is no location");
  assert.equal(associationForPlan({ mapsUrl: MAPS_URL.replace("https:", "http:") }, PLACE_C), null, "nothing can be bound to a malformed alias alone");
}

assert.equal(placeIdFromUserInput(PLACE_A), PLACE_A);
assert.equal(placeIdFromUserInput(`place_id:${PLACE_A}`), PLACE_A);
assert.equal(placeIdFromUserInput(`https://www.google.com/maps/search/?api=1&query=Fictional%20Hall&query_place_id=${PLACE_A}`), PLACE_A);
assert.equal(placeIdFromUserInput(`https://www.google.com/maps/dir/?api=1&destination=X&destination_place_id=${PLACE_B}`), PLACE_B);
assert.equal(placeIdFromUserInput(`https://maps.google.com/?q=place_id:${PLACE_B}`), PLACE_B);
assert.equal(placeIdFromUserInput(MAPS_URL), "", "a /maps/place/ link carries a feature ID, not a Place ID");
assert.equal(placeIdFromUserInput(`https://evil.example/maps/search/?query_place_id=${PLACE_A}`), "", "only Google Maps hosts");
assert.equal(placeIdFromUserInput(`http://www.google.com/maps/search/?query_place_id=${PLACE_A}`), "", "HTTPS only");
assert.equal(placeIdFromUserInput(`https://www.google.com/search?query_place_id=${PLACE_A}`), "", "Maps paths only");
assert.equal(placeIdFromUserInput("Fictional Lantern Hall"), "", "a venue name is not an ID");
assert.equal(placeIdFromUserInput("bad id!"), "");

{
  const good = { placeId: PLACE_A, locationBinding: locationBindingForPlan({ place: OSM_HALL }), publicVenueConfirmed: true };
  assert.deepEqual(googlePlaceAssociationProblems(good), []);
  assert.deepEqual(GOOGLE_PLACE_ASSOCIATION_KEYS, ["placeId", "locationBinding", "publicVenueConfirmed"]);
  for (const field of FORBIDDEN_GOOGLE_FIELDS) {
    assert.ok(googlePlaceAssociationProblems({ ...good, [field]: "Fictional Google value" }).some((problem) => problem.key === field), `Google content field ${field} is rejected`);
  }
  assert.ok(googlePlaceAssociationProblems({ ...good, publicVenueConfirmed: false }).length, "public venue must be confirmed");
  assert.ok(googlePlaceAssociationProblems({ ...good, placeId: "short" }).length);
  assert.ok(googlePlaceAssociationProblems({ ...good, locationBinding: "v2:abc" }).length);
  assert.ok(googlePlaceAssociationProblems("ChIJ").length);
  assert.equal(associationForPlan({ name: "No location" }, PLACE_A), null);
  assert.equal(associationMatchesPlan({ place: OSM_HALL, googlePlaceAssociation: good }), true);
  assert.equal(associationMatchesPlan({ place: OSM_PIER, googlePlaceAssociation: good }), false, "a stale binding never displays");
}

// ---------------------------------------------------------------------------------------------
// 2. Server helpers

const running = [];
const sdkClients = [];
async function start(name, env = {}) {
  const runtime = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, name), SHARED_TRIP_PORT: "0", ...env }));
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
  async function call(route, { method = "GET", body, headers = {} } = {}) {
    const sent = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
    const response = await fetch(base + route, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (route.startsWith("/api/")) assert.equal(response.headers.get("cache-control"), "no-store", `${method} ${route} must be no-store`);
    return { status: response.status, body: parsed, text, headers: response.headers };
  }
  const api = {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } }),
    bearer: (secret, route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + secret, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
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

async function mcpSession(base) {
  const sdk = new Client({ name: "fictional-google-association-probe", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + ownerToken } } }));
  sdkClients.push(sdk);
  return {
    async tool(name, args) {
      const result = await sdk.callTool({ name, arguments: args });
      return { isError: Boolean(result.isError), data: result.structuredContent || JSON.parse(result.content[0].text) };
    },
    async close() { sdkClients.splice(sdkClients.indexOf(sdk), 1); await sdk.close(); }
  };
}

const planOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
const change = (api, trip, requestId, changes) => api.owner(`/api/trips/${trip.id}/changes`, { method: "POST", body: { requestId, expectedVersion: trip.version, changes } });

function fixtureTrip() {
  return {
    title: "Fictional Lantern Weekend", timezone: "UTC", country: "Fictionland", dateRange: { start: "2032-05-04", end: "2032-05-05" },
    days: [
      { id: "day-one", date: "2032-05-04", slots: [
        { id: "plan-hall", name: "Fictional Lantern Hall", time: "09:00", notes: "Fictional private note", place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address },
        { id: "plan-cafe", name: "Fictional Harbor Cafe", time: "12:00", googleMapsUrl: MAPS_URL },
        { id: "plan-legacy", name: "Fictional old pier", time: "15:00", lat: 35.05, lng: 139.05, address: "Old pier road" },
        { id: "plan-placeholder", name: "Fictional free evening", time: "19:00" }
      ] },
      { id: "day-two", date: "2032-05-05", slots: [] }
    ]
  };
}

function assertNoGoogleContent(trip, label) {
  for (const plan of trip.days.flatMap((day) => day.slots || [])) {
    const association = plan.googlePlaceAssociation;
    if (!association) continue;
    assert.deepEqual(Object.keys(association).sort(), [...GOOGLE_PLACE_ASSOCIATION_KEYS].sort(), `${label}: ${plan.id} stores only the three association keys`);
    assert.equal(association.publicVenueConfirmed, true);
  }
}

// ---------------------------------------------------------------------------------------------
// 3. Disabled by default: no feature flag, config route reports off, nothing else changes.

try {
  {
    const runtime = await start("disabled");
    const api = client(runtime.url);
    const ownerCookie = (await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token: ownerToken } })).headers.get("set-cookie").split(";")[0];
    const ownerSession = expect(await api.as(ownerCookie, "/api/session"), 200, "owner session");
    assert.equal(Object.hasOwn(ownerSession, "features"), false, "disabled: the session carries no Google feature flag");
    assert.deepEqual(expect(await api.as(ownerCookie, "/api/google-places/config"), 200, "disabled config"), { enabled: false });
    expect(await api.call("/api/google-places/config"), 401, "anonymous config refused", "unauthorized");
    const viewer = await api.makeAccount("fictional.disabled.viewer");
    assert.deepEqual(expect(await api.as(viewer.cookie, "/api/google-places/config"), 200, "viewer config while disabled"), { enabled: false });
    assert.equal(Object.hasOwn(expect(await api.as(viewer.cookie, "/api/session"), 200, "viewer session"), "features"), false);
    // Associations are ordinary trip data and stay valid (and portable) while the feature is off.
    const created = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-disabled-create", trip: fixtureTrip() } }), 201, "create while disabled").trip;
    const hall = planOf(created, "plan-hall");
    const saved = expect(await change(api, created, "gp-disabled-link", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-hall", googlePlaceAssociation: associationForPlan(hall, PLACE_A) } }]), 200, "association saved while disabled").trip;
    assert.equal(planOf(saved, "plan-hall").googlePlaceAssociation.placeId, PLACE_A);
    await stop(runtime);
  }

  // -------------------------------------------------------------------------------------------
  // 4. Enabled with a fake key: protected config route, session flag, no key leaks.
  const runtime = await start("enabled", ENABLED);
  const api = client(runtime.url);
  const ownerCookie = (await api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { token: ownerToken } })).headers.get("set-cookie").split(";")[0];
  const manager = await api.makeAccount("fictional.google.manager", "content-manager");
  const viewer = await api.makeAccount("fictional.google.viewer");
  const managerToken = expect(await api.owner(`/api/users/${manager.id}/mcp-tokens`, { method: "POST", body: { label: "Fictional association probe" } }), 201, "issue manager MCP credential").secret;

  // The key is no longer served by the configuration route: browsers receive it only inside a granted
  // allowance reservation (see scripts/test-google-allowance.mjs), so nothing can bootstrap Google
  // without one.
  const expectedConfig = { enabled: true, libraries: ["places"], keyDelivery: "reservation" };
  for (const [label, response] of [
    ["owner cookie", await api.as(ownerCookie, "/api/google-places/config")],
    ["owner bearer", await api.owner("/api/google-places/config")],
    ["content manager", await api.as(manager.cookie, "/api/google-places/config")],
    ["viewer", await api.as(viewer.cookie, "/api/google-places/config")]
  ]) {
    assert.deepEqual(expect(response, 200, label + " config"), expectedConfig, label + " receives the key-free browser config");
    assert.ok(!JSON.stringify(response.body).includes(FAKE_BROWSER_KEY), label + ": the config route never carries the key");
  }
  // Allowance unconfigured (the default): a reservation is refused, so no key is handed out either.
  const unconfiguredTrip = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-unconfigured-trip", trip: { ...fixtureTrip(), googlePlacePhotosEnabled: true } } }), 201, "opted-in trip").trip;
  grantFixtureMembership(runtime,unconfiguredTrip.id,manager.id);
  const denied = await api.as(manager.cookie, `/api/trips/${unconfiguredTrip.id}/google-places/reservations`, { method: "POST", body: { requestId: "fictional-unconfigured-0001", kind: "search" } });
  expect(denied, 503, "no allowance configured", "google_allowance_unconfigured");
  assert.ok(!denied.text.includes(FAKE_BROWSER_KEY), "a refused reservation never carries the key");
  expect(await api.call("/api/google-places/config"), 401, "anonymous refused", "unauthorized");
  expect(await api.bearer(managerToken, "/api/google-places/config"), 401, "an MCP credential never reaches the HTTP config route");
  expect(await api.as(viewer.cookie, "/api/google-places/config", { method: "POST", body: {} }), 403, "viewers cannot POST to it");
  expect(await api.as(ownerCookie, "/api/google-places/config", { headers: { Origin: "https://elsewhere.example" } }), 403, "cross-origin refused", "forbidden_origin");
  for (const cookie of [ownerCookie, manager.cookie, viewer.cookie]) {
    const session = expect(await api.as(cookie, "/api/session"), 200, "session");
    assert.deepEqual(session.features, { googlePlacesUiKit: true }, "enabled: the session advertises the feature without the key");
    assert.ok(!JSON.stringify(session).includes(FAKE_BROWSER_KEY), "the session never carries the key");
  }

  const created = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-create", trip: fixtureTrip() } }), 201, "create").trip;
  for (const route of [`/api/trips/${created.id}`, `/api/trips/${created.id}/export`, "/api/trips"]) {
    assert.ok(!(await api.as(viewer.cookie, route)).text.includes(FAKE_BROWSER_KEY), `${route} never carries the key`);
  }
  for (const route of [`/trips/${created.id}`, "/app.js", "/google-places-ui-kit.js", "/hosted-client.js", "/", "/service-worker.js"]) {
    const page = await api.call(route);
    assert.equal(page.status, 200, route);
    assert.ok(!page.text.includes(FAKE_BROWSER_KEY), `public asset ${route} never embeds the key`);
  }

  // -------------------------------------------------------------------------------------------
  // 5. Association writes through HTTP.
  grantFixtureMembership(runtime,created.id,manager.id);
  let trip = created;
  const hall = planOf(trip, "plan-hall");
  const cafe = planOf(trip, "plan-cafe");
  const legacy = planOf(trip, "plan-legacy");
  assert.ok(cafe.lat === 35.1234 && cafe.lng === 139.5678, "Maps-link coordinates derived as before");
  const hallAssociation = associationForPlan(hall, PLACE_A);
  const versionBefore = trip.version;

  const rejected = async (label, plan) => {
    const body = expect(await change(api, trip, "gp-reject-" + crypto.randomBytes(4).toString("hex"), [{ type: "upsert_plan", dayId: "day-one", plan }]), 422, label, "validation_failed");
    const current = expect(await api.owner(`/api/trips/${trip.id}`), 200, "re-read").trip;
    assert.equal(current.version, trip.version, label + ": nothing saved");
    return body;
  };
  for (const field of FORBIDDEN_GOOGLE_FIELDS) {
    await rejected(`Google content ${field} cannot be stored`, { id: "plan-hall", googlePlaceAssociation: { ...hallAssociation, [field]: field === "rating" ? 4.5 : "Fictional Google value" } });
  }
  await rejected("unconfirmed public venue", { id: "plan-hall", googlePlaceAssociation: { ...hallAssociation, publicVenueConfirmed: false } });
  await rejected("malformed Place ID", { id: "plan-hall", googlePlaceAssociation: { ...hallAssociation, placeId: "no spaces allowed" } });
  await rejected("binding of another location", { id: "plan-hall", googlePlaceAssociation: associationForPlan({ place: OSM_PIER }, PLACE_A) });
  await rejected("locationless plan", { id: "plan-placeholder", googlePlaceAssociation: associationForPlan({ place: OSM_HALL }, PLACE_A) });
  await rejected("association with a plan-level Google field", { id: "plan-hall", googlePlaceAssociation: hallAssociation, googlePlaceRating: 4.4 });
  assert.equal(expect(await api.owner(`/api/trips/${trip.id}`), 200, "read").trip.version, versionBefore, "every refused write left the trip unchanged");

  const linkBody = { requestId: "gp-link", expectedVersion: trip.version, changes: [
    { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-hall", googlePlaceAssociation: hallAssociation } },
    { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", googlePlaceAssociation: associationForPlan(cafe, PLACE_B) } },
    { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-legacy", googlePlaceAssociation: associationForPlan(legacy, PLACE_B) } }
  ] };
  const linked = expect(await api.owner(`/api/trips/${trip.id}/changes`, { method: "POST", body: linkBody }), 200, "link three plans");
  trip = linked.trip;
  assert.deepEqual(planOf(trip, "plan-hall").googlePlaceAssociation, hallAssociation, "stored exactly as sent");
  assert.equal(planOf(trip, "plan-cafe").googlePlaceAssociation.placeId, PLACE_B);
  assert.equal(planOf(trip, "plan-legacy").googlePlaceAssociation.placeId, PLACE_B, "legacy coordinates can be a location binding");
  assert.deepEqual(planOf(trip, "plan-hall").place, OSM_HALL, "the OSM place is untouched");
  assertNoGoogleContent(trip, "after linking");

  // Durable retry: identical replay returns the same result; changed payload with the same ID is refused.
  const replay = expect(await api.owner(`/api/trips/${trip.id}/changes`, { method: "POST", body: linkBody }), 200, "identical retry");
  assert.deepEqual(replay.trip, linked.trip, "retry replays the stored result");
  assert.equal(expect(await api.owner(`/api/trips/${trip.id}`), 200, "read").trip.version, trip.version, "the retry applied nothing twice");
  expect(await api.owner(`/api/trips/${trip.id}/changes`, { method: "POST", body: { ...linkBody, changes: linkBody.changes.slice(0, 1) } }), 409, "same requestId, different input", "request_id_conflict");
  expect(await change(api, { ...trip, version: trip.version - 1 }, "gp-stale", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-hall", notes: "x" } }]), 409, "stale version", "version_conflict");

  // Unrelated edits keep the association (notes, name, time, order, photo, move to another day).
  trip = expect(await change(api, trip, "gp-unrelated", [
    { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-hall", notes: "Changed fictional note", name: "Fictional Lantern Hall (evening)", time: "18:30", sortOrder: 4, photo: { url: "https://example.org/fictional.jpg", sourceUrl: "https://example.org/fictional", credit: "Fictional credit" } } }
  ]), 200, "unrelated edit").trip;
  assert.deepEqual(planOf(trip, "plan-hall").googlePlaceAssociation, hallAssociation, "unrelated edits never touch the association");
  trip = expect(await change(api, trip, "gp-move-day", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall" } }]), 200, "move to another day").trip;
  assert.deepEqual(planOf(trip, "plan-hall").googlePlaceAssociation, hallAssociation, "moving a plan to another day keeps it");

  // Location change through a merge (carried over): stale association removed, new location saved.
  trip = expect(await change(api, trip, "gp-relocate", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", place: OSM_PIER } }]), 200, "change OSM place").trip;
  assert.equal(Object.hasOwn(planOf(trip, "plan-hall"), "googlePlaceAssociation"), false, "a changed location drops the stale association");
  assert.equal(planOf(trip, "plan-hall").lat, OSM_PIER.lat);
  // Re-linking for the new location in the same request as a location change is accepted.
  const backAtHall = { ...planOf(trip, "plan-hall"), place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address };
  trip = expect(await change(api, trip, "gp-relocate-relink", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address, googlePlaceAssociation: associationForPlan(backAtHall, PLACE_B) } }]), 200, "location change plus new link").trip;
  assert.equal(planOf(trip, "plan-hall").googlePlaceAssociation.placeId, PLACE_B);
  // Maps link changed: removed. Address edit on a legacy-coordinate plan: removed.
  trip = expect(await change(api, trip, "gp-new-link", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", googleMapsUrl: OTHER_MAPS_URL } }]), 200, "new Maps link").trip;
  assert.equal(Object.hasOwn(planOf(trip, "plan-cafe"), "googlePlaceAssociation"), false, "a changed Maps link drops the association");
  trip = expect(await change(api, trip, "gp-legacy-address", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-legacy", address: "New fictional road" } }]), 200, "legacy address edit").trip;
  assert.equal(Object.hasOwn(planOf(trip, "plan-legacy"), "googlePlaceAssociation"), false, "a changed saved address drops the association");
  // Clear the selected place entirely: no location, no association.
  trip = expect(await change(api, trip, "gp-clear", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", place: null } }]), 200, "clear location").trip;
  assert.equal(Object.hasOwn(planOf(trip, "plan-hall"), "googlePlaceAssociation"), false, "clearing the location drops the association");
  assert.equal(Object.hasOwn(planOf(trip, "plan-hall"), "lat"), false, "mirrored coordinates removed as before");

  // replace_content (the web editor's path): a carried-over association follows only its own location.
  trip = expect(await change(api, trip, "gp-relink-hall", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", place: OSM_HALL, googlePlaceAssociation: associationForPlan({ place: OSM_HALL }, PLACE_A) } }]), 200, "relink").trip;
  {
    const snapshot = structuredClone(trip);
    planOf(snapshot, "plan-hall").notes = "Snapshot note edit";
    trip = expect(await change(api, trip, "gp-replace-keep", [{ type: "replace_content", trip: snapshot }]), 200, "replace_content unrelated").trip;
    assert.equal(planOf(trip, "plan-hall").googlePlaceAssociation.placeId, PLACE_A, "replace_content keeps a current association");
    const moved = structuredClone(trip);
    Object.assign(planOf(moved, "plan-hall"), { place: OSM_PIER, lat: OSM_PIER.lat, lng: OSM_PIER.lng, address: OSM_PIER.address });
    trip = expect(await change(api, trip, "gp-replace-move", [{ type: "replace_content", trip: moved }]), 200, "replace_content relocate").trip;
    assert.equal(Object.hasOwn(planOf(trip, "plan-hall"), "googlePlaceAssociation"), false, "replace_content drops a stale carried-over association");
    const forged = structuredClone(trip);
    planOf(forged, "plan-hall").googlePlaceAssociation = associationForPlan({ place: OSM_HALL }, PLACE_A);
    expect(await change(api, trip, "gp-replace-forged", [{ type: "replace_content", trip: forged }]), 422, "replace_content with a new mismatched association", "validation_failed");
    trip = expect(await change(api, trip, "gp-null", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", googlePlaceAssociation: associationForPlan(planOf(trip, "plan-hall"), PLACE_A) } }]), 200, "link pier").trip;
    trip = expect(await change(api, trip, "gp-null-remove", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", googlePlaceAssociation: null } }]), 200, "explicit removal").trip;
    assert.equal(Object.hasOwn(planOf(trip, "plan-hall"), "googlePlaceAssociation"), false, "null removes the association");
  }

  // Viewers can read a saved association but never write one.
  grantFixtureMembership(runtime,trip.id,viewer.id);
  trip = expect(await change(api, trip, "gp-final-link", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", googlePlaceAssociation: associationForPlan(planOf(trip, "plan-hall"), PLACE_A) } }]), 200, "final link").trip;
  assert.equal(planOf(expect(await api.as(viewer.cookie, `/api/trips/${trip.id}`), 200, "viewer read").trip, "plan-hall").googlePlaceAssociation.placeId, PLACE_A);
  expect(await api.as(viewer.cookie, `/api/trips/${trip.id}/changes`, { method: "POST", body: { requestId: "gp-viewer", expectedVersion: trip.version, changes: [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", googlePlaceAssociation: null } }] } }), 403, "viewer write refused");
  trip = expect(await api.as(manager.cookie, `/api/trips/${trip.id}/changes`, { method: "POST", body: { requestId: "gp-manager", expectedVersion: trip.version, changes: [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", notes: "Manager note" } }] } }), 200, "manager unrelated edit").trip;
  assert.equal(planOf(trip, "plan-hall").googlePlaceAssociation.placeId, PLACE_A);

  // Legacy mapsUrl alias through the server: the editor's Save normalization (googleMapsUrl added
  // beside the alias, replace_content) with an unrelated note/title edit keeps the association.
  {
    const alias = { id: "plan-alias", name: "Fictional Alias Cafe", time: "16:00", mapsUrl: OTHER_MAPS_URL, lat: 35.2222, lng: 139.3333, address: "1 Invented Quay, Exampleton" };
    const aliasAssociation = associationForPlan(alias, PLACE_C);
    trip = expect(await change(api, trip, "gp-alias-link", [{ type: "upsert_plan", dayId: "day-one", plan: { ...alias, googlePlaceAssociation: aliasAssociation } }]), 200, "plan with a legacy mapsUrl alias linked").trip;
    assert.deepEqual(planOf(trip, "plan-alias").googlePlaceAssociation, aliasAssociation, "an alias-bound association is accepted");
    assert.equal(planOf(trip, "plan-alias").mapsUrl, OTHER_MAPS_URL);
    trip = expect(await change(api, trip, "gp-alias-note", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-alias", notes: "Fictional alias note" } }]), 200, "alias note edit").trip;
    assert.deepEqual(planOf(trip, "plan-alias").googlePlaceAssociation, aliasAssociation, "a note edit keeps it");
    const snapshot = structuredClone(trip);
    Object.assign(planOf(snapshot, "plan-alias"), {
      googleMapsUrl: OTHER_MAPS_URL, googleMapsPlaceName: "Fictional Harbor Cafe", googleMapsPlaceLabel: "Fictional Harbor Cafe, 1 Invented Quay, Exampleton",
      address: "1 Invented Quay, Exampleton", lat: 35.2222, lng: 139.3333, approximateLocation: false, name: "Fictional Alias Cafe (renamed)", notes: "Edited fictional note"
    });
    trip = expect(await change(api, trip, "gp-alias-normalize", [{ type: "replace_content", trip: snapshot }]), 200, "editor-style normalization of the alias").trip;
    assert.equal(planOf(trip, "plan-alias").googleMapsUrl, OTHER_MAPS_URL, "the alias was normalized into googleMapsUrl");
    assert.deepEqual(planOf(trip, "plan-alias").googlePlaceAssociation, aliasAssociation, "normalization plus a note/title edit keeps the association");
    trip = expect(await change(api, trip, "gp-alias-relocate", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-alias", googleMapsUrl: MAPS_URL } }]), 200, "a different link after normalization").trip;
    assert.equal(Object.hasOwn(planOf(trip, "plan-alias"), "googlePlaceAssociation"), false, "a real link change still drops it");

    // A malformed alias is no location link: only the saved coordinates can bind, as before.
    const short = { id: "plan-alias-short", name: "Fictional Short Link Stall", time: "17:00", mapsUrl: "https://maps.app.goo.gl/FictionalShortLink", lat: 35.3, lng: 139.4, address: "Fictional Lane" };
    const before = trip.version;
    expect(await change(api, trip, "gp-alias-short-forged", [{ type: "upsert_plan", dayId: "day-one", plan: { ...short, googlePlaceAssociation: associationForPlan({ googleMapsUrl: short.mapsUrl }, PLACE_C) } }]), 422, "an association bound to a malformed alias link is refused", "validation_failed");
    assert.equal(expect(await api.owner(`/api/trips/${trip.id}`), 200, "read").trip.version, before, "nothing saved");
    trip = expect(await change(api, trip, "gp-alias-short", [{ type: "upsert_plan", dayId: "day-one", plan: { ...short, googlePlaceAssociation: associationForPlan(short, PLACE_C) } }]), 200, "malformed alias plan bound to its coordinates").trip;
    assert.equal(planOf(trip, "plan-alias-short").googlePlaceAssociation.locationBinding, locationBindingForPlan({ lat: 35.3, lng: 139.4, address: "Fictional Lane" }));

    // A selected OSM place keeps precedence over an alias on the same plan.
    expect(await change(api, trip, "gp-alias-osm-forged", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", mapsUrl: MAPS_URL, googlePlaceAssociation: associationForPlan({ mapsUrl: MAPS_URL }, PLACE_C) } }]), 422, "an alias never overrides a selected OSM place", "validation_failed");
    trip = expect(await change(api, trip, "gp-alias-osm", [{ type: "upsert_plan", dayId: "day-two", plan: { id: "plan-hall", mapsUrl: MAPS_URL } }]), 200, "alias added beside the OSM place").trip;
    assert.equal(planOf(trip, "plan-hall").googlePlaceAssociation.placeId, PLACE_A, "adding an alias to an OSM plan is not a location change");
  }

  // -------------------------------------------------------------------------------------------
  // 6. MCP: same validation and the same stale-association rule.
  const mcp = await mcpSession(api.base);
  {
    const cafeNow = planOf(trip, "plan-cafe");
    const bad = await mcp.tool("apply_trip_changes", { tripId: trip.id, requestId: "gp-mcp-bad", expectedVersion: trip.version,
      changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", googlePlaceAssociation: { ...associationForPlan(cafeNow, PLACE_B), formattedAddress: "Fictional" } } }] });
    assert.equal(bad.isError, true, "MCP refuses Google content");
    assert.equal(bad.data.error.code, "validation_failed");
    const good = await mcp.tool("apply_trip_changes", { tripId: trip.id, requestId: "gp-mcp-good", expectedVersion: trip.version,
      changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", googlePlaceAssociation: associationForPlan(cafeNow, PLACE_B) } }] });
    assert.equal(good.isError, false, JSON.stringify(good.data));
    trip = good.data.trip;
    assert.equal(planOf(trip, "plan-cafe").googlePlaceAssociation.placeId, PLACE_B);
    const notes = await mcp.tool("apply_trip_changes", { tripId: trip.id, requestId: "gp-mcp-notes", expectedVersion: trip.version,
      changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", notes: "MCP fictional note" } }] });
    trip = notes.data.trip;
    assert.equal(planOf(trip, "plan-cafe").googlePlaceAssociation.placeId, PLACE_B, "MCP unrelated edit keeps it");
    const relocated = await mcp.tool("apply_trip_changes", { tripId: trip.id, requestId: "gp-mcp-move", expectedVersion: trip.version,
      changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", googleMapsUrl: MAPS_URL } }] });
    trip = relocated.data.trip;
    assert.equal(Object.hasOwn(planOf(trip, "plan-cafe"), "googlePlaceAssociation"), false, "MCP location change drops it");
    trip = (await mcp.tool("apply_trip_changes", { tripId: trip.id, requestId: "gp-mcp-relink", expectedVersion: trip.version,
      changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-cafe", googlePlaceAssociation: associationForPlan(planOf(trip, "plan-cafe"), PLACE_B) } }] })).data.trip;
    await mcp.close();
  }

  // -------------------------------------------------------------------------------------------
  // 7. Export / import keep associations, IDs and validation; tampered imports are refused.
  const exported = expect(await api.owner(`/api/trips/${trip.id}/export`), 200, "export");
  assertNoGoogleContent(exported.trip, "export");
  assert.equal(planOf(exported.trip, "plan-hall").googlePlaceAssociation.placeId, PLACE_A);
  const imported = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-import", data: exported } }), 201, "import export");
  assert.notEqual(imported.trip.id, trip.id, "a duplicate import gets a new trip ID instead of overwriting");
  for (const id of ["plan-hall", "plan-cafe"]) {
    assert.deepEqual(planOf(imported.trip, id).googlePlaceAssociation, planOf(trip, id).googlePlaceAssociation, `${id} association survives import with its plan ID`);
  }
  assert.deepEqual(expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-import", data: exported } }), 201, "identical import retry").trip.id, imported.trip.id, "import retry replays");
  const tampered = structuredClone(exported);
  Object.assign(planOf(tampered.trip, "plan-hall"), { place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address });
  assert.notEqual(locationBindingForPlan(planOf(tampered.trip, "plan-hall")), planOf(tampered.trip, "plan-hall").googlePlaceAssociation.locationBinding, "the negative import fixture actually changes the location");
  expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-import-tampered", data: tampered } }), 422, "import with a mismatched binding", "validation_failed");
  const smuggled = structuredClone(exported);
  planOf(smuggled.trip, "plan-hall").googlePlaceAssociation.photos = [{ name: "places/FAKE/photos/FAKE" }];
  expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-import-smuggled", data: smuggled } }), 422, "import with Google photo data", "validation_failed");

  // Nothing about the key or Google content reached the audit log; no external request was made.
  const auditText = JSON.stringify(expect(await api.owner("/api/audit?limit=200"), 200, "audit"));
  assert.ok(!auditText.includes(FAKE_BROWSER_KEY), "audit log never contains the key");
  assert.ok(!auditText.includes(PLACE_A), "audit entries never contain Place IDs (payload-free)");
  assert.equal(externalAttempts, 0, "no external network access");
  console.log("Google place association and UI Kit configuration tests passed.");
} finally {
  for (const sdk of sdkClients.splice(0)) await sdk.close().catch(() => {});
  for (const runtime of running.splice(0)) await runtime.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}
