// Per-trip Google place details/photos choice (trip.googlePlacePhotosEnabled), tested through the
// pure domain functions, real HTTP and the official MCP SDK client against the actual service.
//
// Fictional data only. No Google service is contacted: the global fetch is wrapped so any
// non-loopback request fails the test, the browser key is an obviously fake placeholder and the
// Place IDs are invented strings.
//
// Covers: strict true/false validation on every write path (update_trip, replace_content, create,
// import; HTTP and MCP) with null/strings/numbers refused; default false for new trips and for rows
// stored before the field existed (read, write, restart, export/import) without rewriting them on
// read; independence between trips; owner (cookie and bearer) and content manager allowed; viewer
// (including a forced replace_content), anonymous, pending and revoked refused; atomic batches,
// expectedVersion conflicts and identical requestId retries; the six MCP tools unchanged; the
// preference saved while the site-wide feature is off without enabling anything; OSM place,
// Commons photo, plan IDs and Google associations preserved byte-for-byte when opting in and out.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { GOOGLE_MAPS_BROWSER_KEY_ENV, GOOGLE_PLACES_FLAG_ENV } from "../server/google-places.mjs";
import { CONTENT_KEYS, GOOGLE_PLACE_PHOTOS_FIELD, normalizeContent, tripGooglePlacePhotosEnabled } from "../server/domain/validate.mjs";
import { applyOperations } from "../server/domain/operations.mjs";
import { associationForPlan } from "../assets/app-template/public/google-place-association.js";

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

const FIELD = "googlePlacePhotosEnabled";
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-google-photos-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
const FAKE_BROWSER_KEY = "FAKE-browser-key-for-tests-only-000000000";
const PLACE_A = "FAKE_place_id_for_tests_0101";
const ENABLED = { [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: FAKE_BROWSER_KEY };
const NOT_BOOLEAN = ["true", "false", 1, 0, "", "yes", {}, [], null];

const OSM_HALL = {
  provider: "openstreetmap", id: "node/9200000001", name: "Fictional Lantern Hall", address: "1 Invented Quay, Exampleton",
  lat: 35.6001, lng: 139.7001, sourceUrl: "https://www.openstreetmap.org/node/9200000001", attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0", selectedAt: "2032-01-01T00:00:00.000Z"
};
const COMMONS_PHOTO = {
  provider: "wikimedia-commons", url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_lantern_hall.jpg",
  sourceUrl: "https://commons.wikimedia.org/wiki/File:Fictional_lantern_hall.jpg", credit: "Sample Photographer · CC BY-SA 4.0",
  author: "Sample Photographer", license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/", selectedAt: "2032-01-01T00:00:01.000Z"
};
const MANUAL_PHOTO = { url: "https://example.org/fictional-manual.jpg", sourceUrl: "https://example.org/fictional-manual", credit: "Fictional manual credit" };

function fixtureTrip(extra = {}) {
  const hall = { id: "plan-hall", name: "Fictional Lantern Hall", time: "09:00", place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address, photo: COMMONS_PHOTO };
  return {
    title: "Fictional Lantern Weekend", timezone: "UTC", country: "Fictionland", dateRange: { start: "2032-05-04", end: "2032-05-05" },
    days: [
      { id: "day-one", date: "2032-05-04", slots: [
        { ...hall, googlePlaceAssociation: associationForPlan(hall, PLACE_A) },
        { id: "plan-manual", name: "Fictional Corner Shop", time: "12:00", lat: 35.61, lng: 139.71, address: "2 Invented Lane", photo: MANUAL_PHOTO }
      ] },
      { id: "day-two", date: "2032-05-05", slots: [] }
    ],
    ...extra
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Pure domain checks.

assert.ok(CONTENT_KEYS.includes(FIELD) && GOOGLE_PLACE_PHOTOS_FIELD === FIELD, "the field is ordinary trip content");
{
  const plain = normalizeContent({ title: "Fictional" });
  assert.ok(plain.issues.ok);
  assert.equal(plain.content[FIELD], false, "absent means false");
  assert.equal(normalizeContent({ title: "Fictional", [FIELD]: true }).content[FIELD], true);
  assert.equal(normalizeContent({ title: "Fictional", [FIELD]: false }).content[FIELD], false);
  for (const value of NOT_BOOLEAN) {
    const result = normalizeContent({ title: "Fictional", [FIELD]: value });
    assert.ok(result.issues.list.some((issue) => issue.path === `trip.${FIELD}` && /true or false/.test(issue.message)), `${JSON.stringify(value)} is refused`);
  }
  assert.equal(tripGooglePlacePhotosEnabled({}), false, "an old row without the field reads as false");
  assert.equal(tripGooglePlacePhotosEnabled({ [FIELD]: "true" }), false, "only the boolean true counts");
  assert.equal(tripGooglePlacePhotosEnabled({ [FIELD]: true }), true);
  const current = { id: "t", version: 1, archived: false, content: { title: "Fictional", days: [], reminders: [] } };
  assert.equal(applyOperations(current, [{ type: "update_trip", fields: { [FIELD]: true } }], { expectedVersion: 1 }).content[FIELD], true);
  for (const value of NOT_BOOLEAN) {
    assert.throws(() => applyOperations(current, [{ type: "update_trip", fields: { [FIELD]: value } }], { expectedVersion: 1 }),
      (error) => error.code === "validation_failed", `update_trip refuses ${JSON.stringify(value)} (null is not "remove")`);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Server helpers.

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
    return { status: response.status, body: parsed, text, headers: response.headers };
  }
  const api = {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
    async ownerCookie() {
      return (await call("/api/login", { method: "POST", headers: { Origin: base }, body: { token: ownerToken } })).headers.get("set-cookie").split(";")[0];
    },
    async makeAccount(username, { role, approve = true } = {}) {
      const invitation = expect(await api.owner("/api/invitations", { method: "POST", body: {} }), 201, "invitation").invitation;
      const password = "Fictional-" + crypto.randomBytes(12).toString("base64url");
      expect(await call("/api/accept-invite", { method: "POST", headers: { Origin: base }, body: { invitation: invitation.token, username, password } }), 201, "redeem " + username);
      const id = expect(await api.owner("/api/users"), 200, "accounts").accounts.find((account) => account.username === username).id;
      if (role) expect(await api.owner(`/api/users/${id}/role`, { method: "POST", body: { role } }), 200, "role " + username);
      if (!approve) return { id, password };
      expect(await api.owner(`/api/users/${id}/approve`, { method: "POST" }), 200, "approve " + username);
      const login = await call("/api/login", { method: "POST", headers: { Origin: base }, body: { username, password } });
      expect(login, 200, "sign in " + username);
      return { id, password, cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
    }
  };
  return api;
}

async function mcpSession(base, secret) {
  const sdk = new Client({ name: "fictional-google-photos-probe", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(base + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + secret } } }));
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

const planOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
const changeBody = (trip, requestId, changes) => ({ requestId, expectedVersion: trip.version, changes });
const setPhotos = (value) => [{ type: "update_trip", fields: { [FIELD]: value } }];
const plansOf = (trip) => trip.days.flatMap((day) => (day.slots || []).map((slot) => ({ day: day.id, ...slot })));

try {
  // -------------------------------------------------------------------------------------------
  // 3. Site-wide feature OFF: the trip preference can be saved, but nothing is enabled by it.
  {
    const runtime = await start("site-off");
    const api = client(runtime.url);
    const ownerCookie = await api.ownerCookie();
    let trip = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-off-create", trip: fixtureTrip() } }), 201, "create while off").trip;
    assert.equal(trip[FIELD], false, "new trips are opted out");
    trip = expect(await api.as(ownerCookie, `/api/trips/${trip.id}/changes`, { method: "POST", body: changeBody(trip, "gp-off-opt-in", setPhotos(true)) }), 200, "opt in while the site is off").trip;
    assert.equal(trip[FIELD], true, "the preference is saved while the site-wide feature is off");
    const session = expect(await api.as(ownerCookie, "/api/session"), 200, "session");
    assert.equal(Object.hasOwn(session, "features"), false, "the trip choice never adds the site feature flag");
    assert.deepEqual(expect(await api.as(ownerCookie, "/api/google-places/config"), 200, "config"), { enabled: false }, "and never enables the configuration");
    await stop(runtime);
  }
  // Flag on without a key is the same as off for every trip.
  {
    const runtime = await start("flag-no-key", { [GOOGLE_PLACES_FLAG_ENV]: "1" });
    const api = client(runtime.url);
    const ownerCookie = await api.ownerCookie();
    const trip = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-nokey-create", trip: fixtureTrip({ [FIELD]: true }) } }), 201, "create opted-in trip without a key").trip;
    assert.equal(trip[FIELD], true);
    assert.equal(Object.hasOwn(expect(await api.as(ownerCookie, "/api/session"), 200, "session"), "features"), false, "no key: no feature flag");
    assert.deepEqual(expect(await api.as(ownerCookie, "/api/google-places/config"), 200, "config"), { enabled: false });
    await stop(runtime);
  }

  // -------------------------------------------------------------------------------------------
  // 4. Site-wide feature ON (fake key): roles, validation, atomicity, retries, independence.
  let runtime = await start("site-on", ENABLED);
  let api = client(runtime.url);
  const ownerCookie = await api.ownerCookie();
  const manager = await api.makeAccount("fictional.photos.manager", { role: "content-manager" });
  const viewer = await api.makeAccount("fictional.photos.viewer");
  const pending = await api.makeAccount("fictional.photos.pending", { approve: false });
  const revoked = await api.makeAccount("fictional.photos.revoked");
  const managerSecret = expect(await api.owner(`/api/users/${manager.id}/mcp-tokens`, { method: "POST", body: { label: "Fictional photos probe" } }), 201, "manager MCP credential").secret;

  let alpha = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-alpha", trip: fixtureTrip() } }), 201, "create alpha").trip;
  let beta = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-beta", trip: { ...fixtureTrip(), title: "Fictional Ferry Weekend" } } }), 201, "create beta").trip;
  assert.equal(alpha[FIELD], false, "default off for a new trip");
  assert.equal(beta[FIELD], false);
  const originalPlans = plansOf(alpha);
  assert.deepEqual(planOf(alpha, "plan-hall").place, OSM_HALL);
  assert.deepEqual(planOf(alpha, "plan-hall").photo, COMMONS_PHOTO);

  // Strict validation over HTTP: refused atomically, nothing saved.
  for (const [index, value] of NOT_BOOLEAN.entries()) {
    expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, `gp-bad-${index}`, setPhotos(value)) }), 422, `update_trip ${JSON.stringify(value)}`, "validation_failed");
    const snapshot = { ...structuredClone(alpha), [FIELD]: value };
    expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, `gp-bad-replace-${index}`, [{ type: "replace_content", trip: snapshot }]) }), 422, `replace_content ${JSON.stringify(value)}`, "validation_failed");
    expect(await api.owner("/api/trips", { method: "POST", body: { requestId: `gp-bad-create-${index}`, trip: fixtureTrip({ [FIELD]: value }) } }), 422, `create ${JSON.stringify(value)}`, "validation_failed");
  }
  assert.equal(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip.version, alpha.version, "every refused write left the trip unchanged");

  // Atomic batch: a valid opt-in next to an invalid change is rolled back with it.
  expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-atomic", [...setPhotos(true), { type: "upsert_day", day: { id: "bad-day", date: "2032-02-30" } }]) }), 422, "atomic batch", "validation_failed");
  assert.equal(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip[FIELD], false, "the opt-in was rolled back with the invalid change");

  // Viewer, anonymous, pending and revoked are refused, including a forced replace_content.
  expect(await api.as(viewer.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-viewer", setPhotos(true)) }), 403, "viewer update_trip", "forbidden");
  expect(await api.as(viewer.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-viewer-forced", [{ type: "replace_content", trip: { ...structuredClone(alpha), [FIELD]: true } }]) }), 403, "viewer forced replace_content", "forbidden");
  expect(await api.as(viewer.cookie, "/api/trips", { method: "POST", body: { requestId: "gp-viewer-create", trip: fixtureTrip({ [FIELD]: true }) } }), 403, "viewer create", "forbidden");
  expect(await api.call(`/api/trips/${alpha.id}/changes`, { method: "POST", headers: { Origin: api.base }, body: changeBody(alpha, "gp-anon", setPhotos(true)) }), 401, "anonymous", "unauthorized");
  const pendingLogin = await (({ password }) => api.call("/api/login", { method: "POST", headers: { Origin: api.base }, body: { username: "fictional.photos.pending", password } }))(pending);
  assert.equal(pendingLogin.status, 403, "a pending account gets no session");
  assert.equal(pendingLogin.headers.get("set-cookie"), null);
  expect(await api.owner(`/api/users/${revoked.id}/revoke`, { method: "POST" }), 200, "revoke account");
  expect(await api.as(revoked.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-revoked", setPhotos(true)) }), 401, "revoked session");
  assert.equal(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip[FIELD], false, "no refused principal changed it");

  // Content manager opts in over HTTP; identical retry replays; changed payload and stale version refused.
  const optIn = changeBody(alpha, "gp-manager-opt-in", setPhotos(true));
  const first = expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: optIn }), 200, "manager opts in");
  alpha = first.trip;
  assert.equal(alpha[FIELD], true);
  const replay = expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: optIn }), 200, "identical retry");
  assert.deepEqual(replay.trip, first.trip, "the retry replays the stored result");
  assert.equal(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "read").trip.version, alpha.version, "applied once");
  expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: { ...optIn, changes: setPhotos(false) } }), 409, "same requestId, different input", "request_id_conflict");
  expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: { ...changeBody(alpha, "gp-stale", setPhotos(false)), expectedVersion: alpha.version - 1 } }), 409, "stale version", "version_conflict");
  // Viewers can read the choice (it shapes their page) but not change it.
  assert.equal(expect(await api.as(viewer.cookie, `/api/trips/${alpha.id}`), 200, "viewer read").trip[FIELD], true);

  // Independence: beta is untouched; trip-level only.
  assert.equal(expect(await api.owner(`/api/trips/${beta.id}`), 200, "beta").trip[FIELD], false, "opting one trip in leaves other trips off");
  // Opting in changed nothing else: IDs, OSM place, Commons and manual photos, association.
  assert.deepEqual(plansOf(alpha), originalPlans, "plans, IDs, OSM, Commons/manual photos and associations unchanged by opting in");

  // Owner cookie opts out; owner bearer opts back in; unrelated edits keep the choice.
  alpha = expect(await api.as(ownerCookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-owner-off", setPhotos(false)) }), 200, "owner cookie opts out").trip;
  assert.equal(alpha[FIELD], false);
  assert.deepEqual(plansOf(alpha), originalPlans, "opting out keeps every association and all location/photo data");
  alpha = expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-owner-on", setPhotos(true)) }), 200, "owner bearer opts in").trip;
  alpha = expect(await api.owner(`/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-unrelated", [{ type: "update_trip", fields: { shortName: "Lanterns" } }, { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-manual", notes: "Fictional note" } }]) }), 200, "unrelated edits").trip;
  assert.equal(alpha[FIELD], true, "unrelated edits keep the choice");
  // replace_content (the trip page's own save path) carries the choice from its snapshot.
  {
    const snapshot = structuredClone(alpha);
    planOf(snapshot, "plan-manual").notes = "Fictional snapshot note";
    alpha = expect(await api.as(manager.cookie, `/api/trips/${alpha.id}/changes`, { method: "POST", body: changeBody(alpha, "gp-replace", [{ type: "replace_content", trip: snapshot }]) }), 200, "replace_content").trip;
    assert.equal(alpha[FIELD], true, "replace_content keeps the snapshot's choice");
  }

  // -------------------------------------------------------------------------------------------
  // 5. MCP: same six tools; same validation for owner and content-manager credentials.
  // `label` is for messages only; request IDs use `slug`, which is a legal requestId fragment, so
  // the negative checks below fail on the field value rather than on an invalid requestId.
  for (const [label, slug, secret] of [["owner", "owner", ownerToken], ["content manager", "content-manager", managerSecret]]) {
    assert.match(`gp-mcp-create-default-${slug}`, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, `${label}: request IDs are legal (the service's requestId rule)`);
    const mcp = await mcpSession(api.base, secret);
    const tools = (await mcp.sdk.listTools()).tools.map((tool) => tool.name).sort();
    assert.deepEqual(tools, ["apply_trip_changes", "create_trip", "export_trip", "get_trip", "import_trip", "list_trips"], `${label}: the same six tools, no Google search tool`);
    let current = (await mcp.tool("get_trip", { tripId: beta.id })).data.trip;
    assert.equal(current[FIELD], false, `${label}: get_trip shows the effective choice`);
    for (const value of ["true", 1, null]) {
      const bad = await mcp.tool("apply_trip_changes", { tripId: beta.id, requestId: `gp-mcp-bad-${slug}-${String(value)}`, expectedVersion: current.version, changes: setPhotos(value) });
      assert.equal(bad.isError, true, `${label}: MCP refuses ${JSON.stringify(value)}`);
      assert.equal(bad.data.error.code, "validation_failed");
      assert.doesNotMatch(String(bad.data.error.message ?? ""), /^requestId\b/, `${label}: refused for the field, not the requestId`);
    }
    const on = await mcp.tool("apply_trip_changes", { tripId: beta.id, requestId: `gp-mcp-on-${slug}`, expectedVersion: current.version, changes: setPhotos(true) });
    assert.equal(on.isError, false, JSON.stringify(on.data));
    current = on.data.trip;
    assert.equal(current[FIELD], true);
    const off = await mcp.tool("apply_trip_changes", { tripId: beta.id, requestId: `gp-mcp-off-${slug}`, expectedVersion: current.version, changes: setPhotos(false) });
    beta = off.data.trip;
    assert.equal(beta[FIELD], false);
    const createdOn = await mcp.tool("create_trip", { requestId: `gp-mcp-create-${slug}`, trip: fixtureTrip({ [FIELD]: true }) });
    assert.equal(createdOn.isError, false, JSON.stringify(createdOn.data));
    assert.equal(createdOn.data.trip[FIELD], true, `${label}: create_trip accepts an explicit true`);
    const createdDefault = await mcp.tool("create_trip", { requestId: `gp-mcp-create-default-${slug}`, trip: { title: "Fictional MCP default" } });
    assert.equal(createdDefault.data.trip[FIELD], false, `${label}: create_trip defaults to false`);
    const badCreate = await mcp.tool("create_trip", { requestId: `gp-mcp-create-bad-${slug}`, trip: { title: "Fictional bad", [FIELD]: "yes" } });
    assert.equal(badCreate.isError, true, `${label}: create_trip refuses a non-boolean`);
    assert.doesNotMatch(String(badCreate.data?.error?.message ?? ""), /^requestId\b/, `${label}: create refused for the field, not the requestId`);
    const exported = (await mcp.tool("export_trip", { tripId: alpha.id })).data;
    assert.equal(exported.trip[FIELD], true, `${label}: export carries the choice`);
    const imported = await mcp.tool("import_trip", { requestId: `gp-mcp-import-${slug}`, data: exported });
    assert.equal(imported.isError, false, JSON.stringify(imported.data));
    assert.equal(imported.data.trip[FIELD], true, `${label}: import keeps it`);
    assert.deepEqual(plansOf(imported.data.trip), plansOf(alpha), `${label}: import keeps plan IDs, OSM, Commons and associations`);
    const tampered = structuredClone(exported);
    tampered.trip[FIELD] = "true";
    const badImport = await mcp.tool("import_trip", { requestId: `gp-mcp-import-bad-${slug}`, data: tampered });
    assert.equal(badImport.isError, true, `${label}: import refuses a non-boolean`);
    assert.doesNotMatch(String(badImport.data?.error?.message ?? ""), /^requestId\b/, `${label}: import refused for the field, not the requestId`);
    await mcp.close();
  }
  // Viewers have no MCP access at all; an approved viewer cookie is never an MCP credential.
  expect(await api.as(viewer.cookie, "/mcp", { method: "POST", body: {} }), 401, "viewer cookie at /mcp");

  // HTTP export/import round trip and a legacy import without the field.
  {
    const exported = expect(await api.owner(`/api/trips/${alpha.id}/export`), 200, "export");
    assert.equal(exported.trip[FIELD], true);
    const imported = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-http-import", data: exported } }), 201, "import").trip;
    assert.equal(imported[FIELD], true);
    const legacy = structuredClone(exported);
    delete legacy.trip[FIELD];
    const legacyImported = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-legacy-import", data: legacy } }), 201, "import without the field").trip;
    assert.equal(legacyImported[FIELD], false, "an export from before this field imports as opted out");
    assert.deepEqual(plansOf(legacyImported), plansOf(alpha), "with plans, IDs and associations intact");
    const envelope = { trip: { ...fixtureTrip(), slug: "fictional-legacy-envelope" } };
    const envelopeImported = expect(await api.owner("/api/import", { method: "POST", body: { requestId: "gp-envelope-import", data: envelope } }), 201, "legacy envelope import").trip;
    assert.equal(envelopeImported[FIELD], false);
  }

  // -------------------------------------------------------------------------------------------
  // 6. Old data: a row stored before this field existed (no key in its JSON) survives a restart,
  //    reads as false without being rewritten, and accepts writes. No SQL migration is involved.
  const gamma = expect(await api.owner("/api/trips", { method: "POST", body: { requestId: "gp-gamma", trip: { ...fixtureTrip(), title: "Fictional Old Trip" } } }), 201, "create gamma").trip;
  await stop(runtime);
  const databaseFile = path.join(temporary, "site-on", "shared-trip.sqlite");
  {
    const db = new DatabaseSync(databaseFile);
    const row = db.prepare("SELECT data FROM trips WHERE id=?").get(gamma.id);
    const stored = JSON.parse(row.data);
    delete stored[FIELD];
    db.prepare("UPDATE trips SET data=? WHERE id=?").run(JSON.stringify(stored), gamma.id);
    db.close();
  }
  runtime = await start("site-on", ENABLED);
  api = client(runtime.url);
  {
    const read = expect(await api.owner(`/api/trips/${gamma.id}`), 200, "old row after restart").trip;
    assert.equal(read[FIELD], false, "an old row reads as opted out");
    assert.deepEqual(plansOf(read), plansOf(gamma), "and its plans are unchanged");
    const listed = expect(await api.owner("/api/trips"), 200, "list").trips.find((trip) => trip.id === gamma.id);
    assert.ok(listed, "the old trip is still listed");
    const exportedOld = expect(await api.owner(`/api/trips/${gamma.id}/export`), 200, "export old row");
    assert.equal(exportedOld.trip[FIELD], false, "export shows the default");
    const rawAfterRead = (() => { const db = new DatabaseSync(databaseFile, { readOnly: true }); try { return JSON.parse(db.prepare("SELECT data FROM trips WHERE id=?").get(gamma.id).data); } finally { db.close(); } })();
    assert.equal(Object.hasOwn(rawAfterRead, FIELD), false, "reading never rewrote the stored row (no bulk rewrite)");
    const edited = expect(await api.owner(`/api/trips/${gamma.id}/changes`, { method: "POST", body: changeBody(read, "gp-old-edit", [{ type: "update_trip", fields: { shortName: "Old" } }]) }), 200, "unrelated edit on an old row").trip;
    assert.equal(edited[FIELD], false, "an ordinary write stores the explicit default");
    const optedIn = expect(await api.owner(`/api/trips/${gamma.id}/changes`, { method: "POST", body: changeBody(edited, "gp-old-opt-in", setPhotos(true)) }), 200, "opt in an old trip").trip;
    assert.equal(optedIn[FIELD], true);
    assert.equal(expect(await api.owner(`/api/trips/${alpha.id}`), 200, "alpha after restart").trip[FIELD], true, "explicit choices survive a restart");
  }
  assert.equal(externalAttempts, 0, "no external network access");
  console.log("Per-trip Google place details choice tests passed: strict boolean on every path (HTTP, MCP, create, import, replace_content), default off for new and pre-existing trips (read, write, restart, export/import, no rewrite on read), trip independence, owner/content-manager allowed, viewer/anonymous/pending/revoked refused, atomic batches, version conflicts and identical retries, six MCP tools, saved-but-inert while the site feature or key is off, and OSM/Commons/manual photos, IDs and associations preserved.");
} finally {
  for (const sdk of sdkClients.splice(0)) await sdk.close().catch(() => {});
  for (const runtime of running.splice(0)) await runtime.close().catch(() => {});
  fs.rmSync(temporary, { recursive: true, force: true });
}
