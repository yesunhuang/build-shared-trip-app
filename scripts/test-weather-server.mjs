// Daily weather associations through the shared domain, real HTTP and the official MCP SDK client
// against the actual service (SQLite in a disposable directory). Fictional data only; any
// non-loopback request fails the test. No weather provider is contacted by the server.
//
// Covers: absence (automatic) vs [] (off) vs [ids] (manual) on create/import/replace/update; manual,
// off and back-to-automatic writes via the web editor's operations and via MCP; choices surviving
// plan edits, coordinate changes and full-snapshot saves; stable IDs and unrelated days/locations;
// validation of malformed coordinates, IDs, modes and references (atomic); roles; expectedVersion
// conflicts and identical-requestId retries; legacy dayLocations precedence; export/import; trip
// independence.
import assert from "node:assert/strict";
import {grantFixtureMembership} from "./fixtures/membership.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { normalizeContent } from "../server/domain/validate.mjs";
import { importContent } from "../server/domain/legacy.mjs";
import { buildDayWeatherChanges, resolveTripWeather } from "../assets/app-template/public/weather-association.js";

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

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-weather-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
const HARBOUR = { id: "loc-harbour", name: "Fictional Harbour", lat: 41.11, lng: 12.22, i18n: { ja: { name: "架空の港" }, "zh-Hans": { name: "虚构港口" } } };
const HILL = { id: "loc-hill", name: "Fictional Hill", lat: 41.5, lng: 12.6 };

function fixtureTrip(extra = {}) {
  return {
    title: "Fictional Weather Weekend", timezone: "Europe/Rome", country: "Fictionland", dateRange: { start: "2032-05-04", end: "2032-05-07" },
    weather: { locations: [HARBOUR, HILL] },
    days: [
      { id: "day-auto", date: "2032-05-04", label: "Fictional City Day", slots: [
        { id: "plan-hotel", name: "Fictional Hotel", time: "09:00", lat: 41.1, lng: 12.2 },
        { id: "plan-museum", name: "Fictional Museum", time: "11:00", lat: 41.12, lng: 12.21 }
      ] },
      { id: "day-off", date: "2032-05-05", weatherLocationIds: [], slots: [{ id: "plan-walk", name: "Fictional Walk", time: "10:00", lat: 41.2, lng: 12.3 }] },
      { id: "day-manual", date: "2032-05-06", weatherLocationIds: ["loc-harbour"], slots: [{ id: "plan-boat", name: "Fictional Boat", time: "10:00", lat: 41.3, lng: 12.4 }] },
      { id: "day-plain", date: "2032-05-07", slots: [] }
    ],
    ...extra
  };
}

// (0, 0) is a real point; partial and coordinate-less explicit locations were accepted before this
// feature and must stay importable/editable (kept as saved, never fetched, never auto-replaced).
const ZERO_POINT = { id: "zero-point", name: "Fictional explicitly saved equatorial point", lat: 0, lng: 0 };
const LEGACY_PARTIAL = { id: "loc-legacy-partial", name: "Fictional older entry", lat: 41.4 };
const LEGACY_EMPTY = { id: "loc-legacy-empty", name: "Fictional older unnamed point" };
function legacyWeatherTrip() {
  return {
    title: "Fictional Legacy Weather", timezone: "UTC", country: "Fictionland", dateRange: { start: "2032-06-01", end: "2032-06-04" },
    weather: { locations: [ZERO_POINT, LEGACY_PARTIAL, LEGACY_EMPTY, HILL] },
    days: [
      { id: "g-zero", date: "2032-06-01", weatherLocationIds: ["zero-point"], slots: [] },
      { id: "g-partial", date: "2032-06-02", weatherLocationIds: ["loc-legacy-partial", "loc-legacy-empty"], slots: [{ id: "g-plan", name: "Fictional Pier", time: "10:00", lat: 41.2, lng: 12.3 }] },
      { id: "g-off", date: "2032-06-03", weatherLocationIds: [], slots: [] },
      { id: "g-auto-zero", date: "2032-06-04", slots: [{ id: "g-zero-plan", name: "Fictional Buoy", time: "09:00", lat: 0, lng: 0 }] }
    ]
  };
}

const dayOf = (trip, id) => trip.days.find((day) => day.id === id);
const modeOf = (trip, id) => resolveTripWeather(trip).days.get(id).mode;
const hasField = (trip, id) => Object.hasOwn(dayOf(trip, id), "weatherLocationIds");

// ---------------------------------------------------------------------------------------------
// 1. Domain checks (shared by every entry point).
{
  const normalized = normalizeContent(fixtureTrip());
  assert.ok(normalized.issues.ok, JSON.stringify(normalized.issues.list));
  assert.equal(Object.hasOwn(dayOf(normalized.content, "day-auto"), "weatherLocationIds"), false, "absence stays absence");
  assert.deepEqual(dayOf(normalized.content, "day-off").weatherLocationIds, [], "[] stays []");
  for (const [label, mutate, pathPart] of [
    ["unknown reference", (trip) => { trip.days[2].weatherLocationIds = ["loc-missing"]; }, "weatherLocationIds[0]"],
    ["non-array mode", (trip) => { trip.days[2].weatherLocationIds = "loc-harbour"; }, "weatherLocationIds"],
    ["bad id", (trip) => { trip.weather.locations.push({ id: "bad id", name: "x", lat: 1, lng: 2 }); }, "locations[2].id"],
    ["string latitude", (trip) => { trip.weather.locations[0] = { ...HARBOUR, lat: "41.11" }; }, "locations[0].lat"],
    ["out of range", (trip) => { trip.weather.locations[0] = { ...HARBOUR, lng: 190 }; }, "locations[0].lng"],
    ["duplicate id", (trip) => { trip.weather.locations.push({ ...HILL }); }, "locations[2].id"],
    ["unknown weather key", (trip) => { trip.weather.mode = "auto"; }, "weather.mode"]
  ]) {
    const trip = fixtureTrip();
    mutate(trip);
    const result = normalizeContent(trip);
    assert.ok(result.issues.list.some((issue) => issue.path.includes(pathPart)), `${label}: ${JSON.stringify(result.issues.list)}`);
  }
  // The shared schema keeps optional coordinates (as before this feature): (0, 0) and older partial
  // or coordinate-less explicit locations are accepted unchanged, with their IDs and mappings.
  {
    const accepted = normalizeContent(legacyWeatherTrip());
    assert.ok(accepted.issues.ok, JSON.stringify(accepted.issues.list));
    assert.deepEqual(accepted.content.weather.locations, [ZERO_POINT, LEGACY_PARTIAL, LEGACY_EMPTY, HILL], "every explicit location kept as saved");
    assert.deepEqual(dayOf(accepted.content, "g-partial").weatherLocationIds, ["loc-legacy-partial", "loc-legacy-empty"]);
    assert.deepEqual(dayOf(accepted.content, "g-zero").weatherLocationIds, ["zero-point"]);
  }
  // Type/range checks stay strict for every location and plan, including around 0.
  for (const [label, location, pathPart] of [
    ["NaN latitude", { id: "n", lat: NaN, lng: 0 }, "locations[0].lat"],
    ["Infinity longitude", { id: "n", lat: 0, lng: Infinity }, "locations[0].lng"],
    ["string zero", { id: "n", lat: "0", lng: 0 }, "locations[0].lat"],
    ["null latitude", { id: "n", lat: null, lng: 0 }, "locations[0].lat"],
    ["out of range latitude", { id: "n", lat: 90.5, lng: 0 }, "locations[0].lat"],
    ["out of range longitude", { id: "n", lat: 0, lng: -180.5 }, "locations[0].lng"],
    ["bad id", { id: "bad id", lat: 0, lng: 0 }, "locations[0].id"]
  ]) {
    const result = normalizeContent({ ...fixtureTrip(), weather: { locations: [location] }, days: [] });
    assert.ok(result.issues.list.some((issue) => issue.path.includes(pathPart)), `${label}: ${JSON.stringify(result.issues.list)}`);
  }
  {
    const zeroPlan = normalizeContent({ ...fixtureTrip(), days: [{ id: "z", date: "2032-05-04", slots: [{ id: "z-plan", name: "Fictional Buoy", time: "09:00", lat: 0, lng: 0 }] }] });
    assert.ok(zeroPlan.issues.ok, JSON.stringify(zeroPlan.issues.list));
    assert.deepEqual(resolveTripWeather(zeroPlan.content).days.get("z").entries.map((entry) => [entry.lat, entry.lng]), [[0, 0]], "a numeric saved plan at (0, 0) is a valid automatic point");
  }

  // Legacy import: own dayLocations entries keep the runtime precedence; absent stays automatic.
  const { content, warnings } = importContent({ trip: {
    title: "Fictional Legacy", weather: { locations: [HARBOUR, HILL], dayLocations: { "d-off": [], "d-on": ["loc-hill"], "d-null": null } },
    days: [{ id: "d-off", date: "2032-01-01", weatherLocationIds: ["loc-harbour"], slots: [] }, { id: "d-on", date: "2032-01-02", weatherLocationIds: ["loc-harbour"], slots: [] },
      { id: "d-null", date: "2032-01-03", weatherLocationIds: ["loc-harbour"], slots: [] }, { id: "d-none", date: "2032-01-04", slots: [] }]
  } });
  assert.deepEqual(dayOf(content, "d-off").weatherLocationIds, [], "legacy [] is an explicit off");
  assert.deepEqual(dayOf(content, "d-on").weatherLocationIds, ["loc-hill"], "legacy mapping wins as it did at runtime");
  assert.deepEqual(dayOf(content, "d-null").weatherLocationIds, ["loc-harbour"], "a null legacy entry keeps the day's own field");
  assert.equal(Object.hasOwn(dayOf(content, "d-none"), "weatherLocationIds"), false, "no mapping: automatic");
  assert.ok(warnings.some((warning) => warning.includes("dayLocations")));
  assert.equal(Object.hasOwn(content.weather, "dayLocations"), false);
}

// ---------------------------------------------------------------------------------------------
// 2. Real HTTP and MCP.
const running = [];
const sdkClients = [];
async function start(name) {
  const runtime = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, name), SHARED_TRIP_PORT: "0" }));
  running.push(runtime);
  return runtime;
}
function expect(response, status, label, code) {
  assert.ok(response.status === status, `${label} (expected ${status}, got ${response.status}, ${JSON.stringify(response.body?.error ?? null)})`);
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
    return { status: response.status, body: parsed, headers: response.headers };
  }
  const api = {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
    async makeAccount(username, { role } = {}) {
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
async function mcpSession(base, secret) {
  const sdk = new Client({ name: "fictional-weather-probe", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + secret } } }));
  sdkClients.push(sdk);
  return {
    async tool(name, args) {
      const result = await sdk.callTool({ name, arguments: args });
      return { isError: Boolean(result.isError), data: result.structuredContent || JSON.parse(result.content[0].text) };
    }
  };
}
const changeBody = (trip, requestId, changes) => ({ requestId, expectedVersion: trip.version, changes });

try {
  const runtime = await start("weather");
  const api = client(runtime.url);
  const manager = await api.makeAccount("fictional.weather.manager", { role: "content-manager" });
  const viewer = await api.makeAccount("fictional.weather.viewer");
  const managerSecret = expect(await api.owner(`/api/users/${manager.id}/mcp-tokens`, { method: "POST", body: { label: "Fictional weather probe" } }), 201, "manager MCP credential").secret;
  const post = (who, trip, requestId, changes) => api.as(who.cookie, `/api/trips/${trip.id}/changes`, { method: "POST", body: changeBody(trip, requestId, changes) });

  let alpha = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "wx-alpha", trip: fixtureTrip() } }), 201, "create alpha").trip;
  grantFixtureMembership(runtime,alpha.id,viewer.id);
  let beta = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "wx-beta", trip: { ...fixtureTrip(), title: "Fictional Other Weekend" } } }), 201, "create beta").trip;
  assert.equal(hasField(alpha, "day-auto"), false, "create: absence preserved");
  assert.deepEqual(dayOf(alpha, "day-off").weatherLocationIds, [], "create: [] preserved");
  assert.deepEqual(dayOf(alpha, "day-manual").weatherLocationIds, ["loc-harbour"]);
  assert.deepEqual(alpha.weather.locations, [HARBOUR, HILL], "locations and localized names kept");
  grantFixtureMembership(runtime,alpha.id,manager.id);
  const betaBefore = structuredClone(beta);

  // Plan edits (upsert_plan, coordinates changed) and a web-style full snapshot keep every choice.
  alpha = expect(await post(manager, alpha, "wx-plan-edit", [
    { type: "upsert_plan", dayId: "day-off", plan: { id: "plan-walk", lat: 41.25, notes: "Fictional note" } },
    { type: "upsert_plan", dayId: "day-manual", plan: { id: "plan-boat", lat: 41.35, lng: 12.45 } },
    { type: "upsert_plan", dayId: "day-auto", plan: { id: "plan-extra", name: "Fictional Far Stop", lat: 42.5, lng: 13.5 } }
  ]), 200, "plan edits").trip;
  assert.deepEqual(dayOf(alpha, "day-off").weatherLocationIds, [], "off survives a plan edit");
  assert.deepEqual(dayOf(alpha, "day-manual").weatherLocationIds, ["loc-harbour"], "manual survives a coordinate edit");
  assert.equal(hasField(alpha, "day-auto"), false, "automatic stays automatic (never written)");
  assert.equal(resolveTripWeather(alpha).days.get("day-auto").entries.length, 2, "the new far stop adds its own automatic area");
  const snapshot = structuredClone(alpha);
  dayOf(snapshot, "day-plain").notes = "Fictional plain-day note";
  alpha = expect(await post(manager, alpha, "wx-replace", [{ type: "replace_content", trip: snapshot }]), 200, "replace_content").trip;
  assert.equal(hasField(alpha, "day-auto"), false);
  assert.deepEqual(dayOf(alpha, "day-off").weatherLocationIds, []);

  // Web editor: manual with a saved plan point (new stable location) plus an existing one.
  const manual = buildDayWeatherChanges(alpha, "day-auto", { mode: "manual", picks: [
    { newLocationId: "weather-fictional-hotel", name: "Fictional Hotel", lat: 41.1, lng: 12.2 }, { locationId: "loc-hill" }
  ] });
  assert.ok(manual.ok);
  const manualBody = changeBody(alpha, "wx-manual", manual.changes);
  const first = expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: manualBody }), 200, "manual choice");
  alpha = first.trip;
  assert.deepEqual(dayOf(alpha, "day-auto").weatherLocationIds, ["weather-fictional-hotel", "loc-hill"]);
  assert.deepEqual(alpha.weather.locations.slice(0, 2), [HARBOUR, HILL], "existing locations unchanged");
  assert.deepEqual(alpha.weather.locations[2], { id: "weather-fictional-hotel", name: "Fictional Hotel", lat: 41.1, lng: 12.2 });
  assert.deepEqual(dayOf(alpha, "day-off").weatherLocationIds, [], "other days untouched");
  assert.deepEqual(dayOf(alpha, "day-manual").weatherLocationIds, ["loc-harbour"]);
  // Identical retry replays; same requestId with different input and a stale form are refused.
  const replay = expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: manualBody }), 200, "identical retry");
  assert.deepEqual(replay.trip, first.trip);
  assert.equal(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip.version, alpha.version, "applied once");
  expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: { ...manualBody, changes: buildDayWeatherChanges(alpha, "day-auto", { mode: "off" }).changes } }), 409, "same requestId, different input", "request_id_conflict");
  expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: { ...changeBody(alpha, "wx-stale", buildDayWeatherChanges(alpha, "day-auto", { mode: "off" }).changes), expectedVersion: alpha.version - 1 } }), 409, "stale open form", "version_conflict");
  assert.deepEqual(dayOf(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip, "day-auto").weatherLocationIds, ["weather-fictional-hotel", "loc-hill"], "the stale write changed nothing");

  // Manual choice wins after later plan edits and an unrelated metadata change.
  alpha = expect(await post(manager, alpha, "wx-after-manual", [
    { type: "upsert_plan", dayId: "day-auto", plan: { id: "plan-hotel", lat: 41.15 } },
    { type: "update_trip", fields: { route: "Fictional loop" } }
  ]), 200, "edits after manual").trip;
  assert.deepEqual(dayOf(alpha, "day-auto").weatherLocationIds, ["weather-fictional-hotel", "loc-hill"]);
  assert.equal(alpha.weather.locations[2].lat, 41.1, "a manual location is not moved by a plan edit");

  // Validation over HTTP is atomic and leaves the trip unchanged.
  const bad = [
    ["unknown reference", [{ type: "upsert_day", day: { id: "day-plain", weatherLocationIds: ["loc-missing"] } }]],
    ["mode string", [{ type: "upsert_day", day: { id: "day-plain", weatherLocationIds: "off" } }]],
    ["string coordinate", [{ type: "update_trip", fields: { weather: { locations: [...alpha.weather.locations, { id: "loc-str", name: "Str", lat: "40", lng: 12 }] } } }]],
    ["atomic batch", [{ type: "upsert_day", day: { id: "day-plain", weatherLocationIds: [] } }, { type: "upsert_day", day: { id: "day-off", weatherLocationIds: ["nope"] } }]],
    ["removing a referenced location", [{ type: "update_trip", fields: { weather: { locations: [HARBOUR] } } }]]
  ];
  for (const [index, [label, changes]] of bad.entries()) {
    expect(await post(manager, alpha, `wx-bad-${index}`, changes), 422, label, "validation_failed");
  }
  const unchanged = expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip;
  assert.equal(unchanged.version, alpha.version, "every refused write left the trip unchanged");
  assert.equal(hasField(unchanged, "day-plain"), false);

  // Roles: viewers read but never write (including a forced snapshot); anonymous refused.
  expect(await post(viewer, alpha, "wx-viewer", buildDayWeatherChanges(alpha, "day-plain", { mode: "off" }).changes), 403, "viewer write", "forbidden");
  expect(await post(viewer, alpha, "wx-viewer-forced", [{ type: "replace_content", trip: { ...structuredClone(alpha), days: alpha.days.map((day) => ({ ...day, weatherLocationIds: [] })) } }]), 403, "viewer forced replace", "forbidden");
  expect(await api.call(`/api/trips/${alpha.id}/changes`, { method: "POST", headers: { Origin: api.base }, body: changeBody(alpha, "wx-anon", []) }), 401, "anonymous");
  assert.deepEqual(dayOf(expect(await api.as(viewer.cookie, `/api/trips/${alpha.id}`), 200, "viewer read").trip, "day-auto").weatherLocationIds, ["weather-fictional-hotel", "loc-hill"]);

  // MCP (content-manager token): off, back to automatic and manual, through the same operations.
  const mcp = await mcpSession(api.base, managerSecret);
  let read = await mcp.tool("get_trip", { tripId: alpha.id });
  assert.equal(read.isError, false);
  assert.equal(read.data.trip.version, alpha.version);
  let mcpResult = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "wx-mcp-off", expectedVersion: alpha.version, changes: buildDayWeatherChanges(alpha, "day-auto", { mode: "off" }).changes });
  assert.equal(mcpResult.isError, false, JSON.stringify(mcpResult.data));
  alpha = mcpResult.data.trip;
  assert.deepEqual(dayOf(alpha, "day-auto").weatherLocationIds, [], "MCP: explicit off");
  assert.equal(modeOf(alpha, "day-auto"), "off");
  const retry = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "wx-mcp-off", expectedVersion: alpha.version - 1, changes: buildDayWeatherChanges(alpha, "day-auto", { mode: "off" }).changes });
  assert.equal(retry.isError, false, "MCP identical retry replays");
  assert.equal(retry.data.trip.version, alpha.version);
  const stale = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "wx-mcp-stale", expectedVersion: alpha.version - 1, changes: buildDayWeatherChanges(alpha, "day-auto", { mode: "auto" }).changes });
  assert.equal(stale.isError, true);
  assert.equal(stale.data.error.code, "version_conflict");
  mcpResult = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "wx-mcp-auto", expectedVersion: alpha.version, changes: buildDayWeatherChanges(alpha, "day-auto", { mode: "auto" }).changes });
  alpha = mcpResult.data.trip;
  assert.equal(hasField(alpha, "day-auto"), false, "MCP: back to automatic removes the property");
  assert.equal(modeOf(alpha, "day-auto"), "auto");
  assert.equal(alpha.weather.locations.length, 3, "returning to automatic keeps saved locations (never silently cleared)");
  const invalidMcp = await mcp.tool("apply_trip_changes", { tripId: alpha.id, requestId: "wx-mcp-bad", expectedVersion: alpha.version, changes: [{ type: "upsert_day", day: { id: "day-plain", weatherLocationIds: ["nope"] } }] });
  assert.equal(invalidMcp.isError, true);
  assert.equal(invalidMcp.data.error.code, "validation_failed", "MCP uses the same validation");

  // Export and import keep absence, [] and IDs; MCP export/import too.
  const exported = expect(await api.owner(`/api/trips/${alpha.id}/export`), 200, "export");
  const imported = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "wx-import", data: exported } }), 201, "import").trip;
  assert.notEqual(imported.id, alpha.id);
  for (const id of ["day-auto", "day-off", "day-manual", "day-plain"]) {
    assert.equal(hasField(imported, id), hasField(alpha, id), `import keeps presence for ${id}`);
    assert.deepEqual(dayOf(imported, id).weatherLocationIds, dayOf(alpha, id).weatherLocationIds);
  }
  assert.deepEqual(imported.weather, alpha.weather, "locations, IDs and localized names round-trip");
  const mcpExport = await mcp.tool("export_trip", { tripId: alpha.id });
  const mcpImport = await mcp.tool("import_trip", { requestId: "wx-mcp-import", data: mcpExport.data });
  assert.equal(mcpImport.isError, false, JSON.stringify(mcpImport.data));
  assert.deepEqual(dayOf(mcpImport.data.trip, "day-off").weatherLocationIds, []);
  assert.equal(hasField(mcpImport.data.trip, "day-auto"), false);

  // Previously valid explicit partial points and (0,0) survive actual HTTP and MCP writes/imports.
  let legacy = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "wx-legacy-create", trip: legacyWeatherTrip() } }), 201, "create old explicit entries").trip;
  grantFixtureMembership(runtime,legacy.id,manager.id);
  legacy = expect(await post(manager, legacy, "wx-legacy-replace", [{ type: "replace_content", trip: structuredClone(legacy) }]), 200, "replace old explicit entries").trip;
  const legacyMcp = await mcp.tool("apply_trip_changes", { tripId: legacy.id, requestId: "wx-legacy-mcp", expectedVersion: legacy.version,
    changes: [{ type: "update_trip", fields: { weather: structuredClone(legacy.weather) } }] });
  assert.equal(legacyMcp.isError, false, JSON.stringify(legacyMcp.data));
  assert.deepEqual(legacyMcp.data.trip.weather.locations, [ZERO_POINT, LEGACY_PARTIAL, LEGACY_EMPTY, HILL]);
  const legacyExport = expect(await api.owner(`/api/trips/${legacy.id}/export`), 200, "export old explicit entries");
  const legacyImport = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "wx-legacy-import", data: legacyExport } }), 201, "import old explicit entries").trip;
  assert.deepEqual(legacyImport.weather.locations, legacy.weather.locations);
  assert.deepEqual(dayOf(legacyImport, "g-partial").weatherLocationIds, ["loc-legacy-partial", "loc-legacy-empty"]);
  assert.deepEqual(dayOf(legacyImport, "g-off").weatherLocationIds, []);
  assert.equal(resolveTripWeather(legacyImport).days.get("g-partial").entries.length, 0, "partial explicit entries stay unavailable, never auto-replaced");
  assert.deepEqual(resolveTripWeather(legacyImport).days.get("g-zero").entries.map(({lat,lng}) => [lat,lng]), [[0,0]]);

  // Independence: the other trip never changed.
  const betaAfter = expect(await api.owner(`/api/trips/${beta.id}`), 200, "beta").trip;
  assert.deepEqual(betaAfter, betaBefore, "editing one trip's weather leaves other trips unchanged");

  // A restart keeps the stored choices.
  const dataDir = path.join(temporary, "weather");
  await runtime.close(); running.splice(running.indexOf(runtime), 1);
  const restarted = await startServer(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: dataDir, SHARED_TRIP_PORT: "0" }));
  running.push(restarted);
  const afterRestart = expect(await client(restarted.url).owner(`/api/trips/${alpha.id}`), 200, "after restart").trip;
  assert.deepEqual(afterRestart.days, alpha.days);
} finally {
  for (const sdk of sdkClients.splice(0)) await sdk.close().catch(() => {});
  for (const runtime of running.splice(0)) await runtime.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
  globalThis.fetch = realFetch;
}
assert.equal(externalAttempts, 0, "no external request");
console.log("Weather association server tests passed (domain, real HTTP and MCP SDK client, fictional data).");
