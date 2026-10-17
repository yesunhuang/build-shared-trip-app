// Real SDK discovery and content-manager writes against disposable SQLite/HTTP only.
// All accounts, credentials, venues and Place IDs here are fictional. No provider is contacted.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { locationBindingForPlan } from "../assets/app-template/public/google-place-association.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-mcp-discovery-"));
const owner = "fictional-mcp-schema-owner-only-0000000000";
const config = readConfig({ SHARED_TRIP_ADMIN_TOKEN: owner, SHARED_TRIP_DATA_DIR: root, SHARED_TRIP_HOST: "127.0.0.1", SHARED_TRIP_PORT: "0", SHARED_TRIP_GOOGLE_PLACES_UI_KIT: "0" });
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.hostname, "127.0.0.1", "no external provider request in this fictional test");
  return nativeFetch(input, init);
};
let runtime, sdk;
async function api(route, body, { anonymous = false, cookie } = {}) {
  const response = await fetch(runtime.url + route, { method: body === undefined ? "GET" : "POST", headers: {
    ...(!anonymous && !cookie ? { Authorization: "Bearer " + owner } : {}), ...(cookie ? { Cookie: cookie } : {}),
    ...(body !== undefined ? { "Content-Type": "application/json", Origin: runtime.url } : {})
  }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
function ok(result, status = 200) { assert.equal(result.status, status, "fictional HTTP status; payload omitted"); return result.body; }
async function connect(secret) {
  sdk = new Client({ name: "fictional-place-schema-client", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(runtime.url + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + secret } } }));
}
async function tool(name, args, error) {
  const result = await sdk.callTool({ name, arguments: args });
  const data = result.structuredContent || JSON.parse(result.content[0].text);
  assert.deepEqual(JSON.parse(result.content[0].text), data, "text and structured MCP results agree");
  assert.equal(Boolean(result.isError), Boolean(error), "MCP outcome: " + JSON.stringify(data.error || {}));
  if (error) assert.equal(data.error.code, error);
  return data;
}
const selected = { provider: "openstreetmap", id: "node/900001", name: "Fictional Public Gallery", address: "1 Invented Square", lat: 10, lng: 20,
  sourceUrl: "https://www.openstreetmap.org/node/900001", attribution: "© OpenStreetMap contributors", license: "ODbL-1.0", selectedAt: "2031-06-01T00:00:00.000Z" };
const links = [{ id: "guide", label: "Fictional guide", url: "https://example.org/guide" }];
const fixture = { title: "Fictional discovery trip", timezone: "UTC", googlePlacePhotosEnabled: false, days: [{ id: "day-one", date: "2031-06-10", weatherLocationIds: [], slots: [
  { id: "plan-one", name: "Fictional Public Gallery", place: selected, lat: selected.lat, lng: selected.lng, address: selected.address, notes: "Preserve fictional notes", relatedLinks: links,
    photo: { url: "https://example.org/fictional.jpg", credit: "Fictional illustration" } },
  { id: "plan-empty", name: "Fictional locationless note" }
] }] };
const planOf = trip => trip.days[0].slots.find(p => p.id === "plan-one");
const contentOf = trip => { const result = structuredClone(trip); delete result.version; delete result.updatedAt; return result; };
const read = tripId => tool("get_trip", { tripId });
const change = (trip, requestId, changes, error) => tool("apply_trip_changes", { tripId: trip.id, requestId, expectedVersion: trip.version, changes }, error);
const upsert = value => ({ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", googlePlaceAssociation: value } });
try {
  runtime = await startServer(config);
  const invite = ok(await api("/api/invitations", {}), 201).invitation.token;
  const username = "fictional.schema.manager", password = "Fictional-password-only-1234";
  ok(await api("/api/accept-invite", { invitation: invite, username, password }, { anonymous: true }), 201);
  const account = ok(await api("/api/users")).accounts[0];
  ok(await api(`/api/users/${account.id}/approve`, {}));
  const viewerLogin = await api("/api/login", { username, password }, { anonymous: true });
  ok(viewerLogin); const viewerCookie = viewerLogin.headers.get("set-cookie").split(";")[0];
  const ownerTrip = ok(await api("/api/trips", { requestId: "schema-viewer-fixture", trip: fixture }), 201).trip;
  ok(await api(`/api/trips/${ownerTrip.id}/changes`, { requestId: "schema-viewer-denied", expectedVersion: ownerTrip.version, changes: [upsert(null)] }, { cookie: viewerCookie }), 403);
  for (const headers of [{}, { Cookie: viewerCookie }, { Authorization: "Bearer fictional-invalid-mcp-credential" }]) {
    const response = await fetch(runtime.url + "/mcp", { method: "POST", headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
    assert.equal(response.status, 401, "anonymous, browser cookie and invalid credentials cannot discover or write through MCP"); await response.body?.cancel();
  }
  ok(await api(`/api/users/${account.id}/role`, { role: "content-manager" }));
  const secret = ok(await api(`/api/users/${account.id}/mcp-tokens`, { label: "Fictional discovery regression" }), 201).secret;
  await connect(secret);
  assert.equal(sdk.getServerVersion().version, "1.5.0");
  const inventory = (await sdk.listTools()).tools;
  assert.deepEqual(inventory.map(t => t.name).sort(), ["apply_trip_changes", "create_trip", "export_trip", "get_trip", "import_trip", "list_trips"]);
  const schema = inventory.find(t => t.name === "apply_trip_changes").inputSchema;
  const variants = schema.properties.changes.items.anyOf || schema.properties.changes.items.oneOf;
  const plan = variants.find(t => t.properties.type.const === "upsert_plan").properties.plan.properties;
  const association = plan.googlePlaceAssociation.anyOf.find(s => s.type === "object");
  assert.deepEqual(association.required, ["placeId", "locationBinding", "publicVenueConfirmed"]);
  assert.equal(association.additionalProperties, false); assert.equal(association.properties.publicVenueConfirmed.const, true);
  assert.ok(plan.googlePlaceAssociation.anyOf.some(s => s.type === "null"), "null-clear is discoverable");
  assert.ok(plan.place.anyOf.some(s => s.type === "object")); assert.ok(plan.place.anyOf.some(s => s.type === "null"));
  assert.equal(plan.relatedLinks.type, "array"); assert.equal(plan.relatedLinks.maxItems, 6);
  assert.equal(variants.find(t => t.properties.type.const === "update_trip").properties.fields.properties.googlePlacePhotosEnabled.type, "boolean");
  assert.equal(inventory.find(t => t.name === "create_trip").inputSchema.properties.trip.properties.googlePlacePhotosEnabled.type, "boolean");
  assert.match(inventory.find(t => t.name === "get_trip").description, /planLocationBindings/);
  let trip = (await tool("create_trip", { requestId: "schema-create", trip: fixture })).trip;
  const other = (await tool("create_trip", { requestId: "schema-other", trip: { title: "Fictional independent trip", days: [{ id: "day-one", date: "2031-06-11", slots: [{ id: "plan-one", name: "Fictional other point", lat: 30, lng: 40 }] }] } })).trip;
  const original = structuredClone(trip);
  const initial = await read(trip.id), binding = initial.planLocationBindings.find(p => p.planId === "plan-one").locationBinding;
  assert.equal(binding, locationBindingForPlan(planOf(trip)));
  assert.deepEqual(initial.planLocationBindings.find(p => p.planId === "plan-empty"), { dayId: "day-one", planId: "plan-empty", locationBinding: null });
  assert.notEqual((await read(other.id)).planLocationBindings[0].locationBinding, binding, "same item IDs in another trip do not share context");
  assert.equal(Object.hasOwn(initial.trip, "planLocationBindings"), false);
  assert.equal(Object.hasOwn(ok(await api(`/api/trips/${trip.id}`)), "planLocationBindings"), false, "HTTP and stored trip shape unchanged");
  const value = { placeId: "FictionalPublicVenue_001", locationBinding: binding, publicVenueConfirmed: true };
  const request = { tripId: trip.id, expectedVersion: trip.version, requestId: "schema-set", changes: [upsert(value), { type: "update_trip", fields: { googlePlacePhotosEnabled: true } }] };
  const accepted = await tool("apply_trip_changes", request); trip = accepted.trip;
  assert.deepEqual(await tool("apply_trip_changes", request), accepted, "identical durable request is idempotent");
  const expected = structuredClone(original); planOf(expected).googlePlaceAssociation = value; expected.googlePlacePhotosEnabled = true;
  assert.deepEqual(contentOf(trip), contentOf(expected), "set changes only association and the requested trip boolean");
  assert.deepEqual(planOf((await read(trip.id)).trip).googlePlaceAssociation, value);
  trip = (await change(trip, "schema-note", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", notes: "Later fictional note" } }])).trip;
  assert.deepEqual(planOf(trip).googlePlaceAssociation, value);
  const beforeRestart = structuredClone(trip);
  await sdk.close(); sdk = null; await runtime.close(); runtime = await startServer(config); await connect(secret);
  assert.deepEqual(await tool("apply_trip_changes", request), accepted, "idempotency survives restart and a later edit");
  assert.deepEqual((await read(trip.id)).trip, beforeRestart, "replay cannot overwrite that later edit");
  await tool("apply_trip_changes", { ...request, changes: [upsert(null)] }, "request_id_conflict");
  await tool("apply_trip_changes", { ...request, requestId: "schema-stale" }, "version_conflict");
  const bad = [
    { ...value, placeId: "bad" }, { ...value, placeId: "bad/place/id" }, { ...value, locationBinding: "v1:" + "0".repeat(64) },
    { ...value, publicVenueConfirmed: false }, { ...value, publicVenueConfirmed: undefined },
    ...["name", "address", "lat", "rating", "photos", "photoResourceName"].map(k => ({ ...value, [k]: "Forbidden Google content" }))
  ];
  for (const [index, input] of bad.entries()) {
    await change(trip, "schema-invalid-" + index, [{ type: "update_trip", fields: { title: "Must roll back" } }, upsert(input)], "validation_failed");
    assert.deepEqual((await read(trip.id)).trip, trip, "invalid batches are atomic, with no validation drift");
  }
  await change(trip, "schema-locationless", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-empty", googlePlaceAssociation: value } }], "validation_failed");
  for (const [name, fields] of [["flag", { googlePlacePhotosEnabled: "true" }], ["flag-null", { googlePlacePhotosEnabled: null }]]) await change(trip, "schema-invalid-" + name, [{ type: "update_trip", fields }], "validation_failed");
  for (const [name, fields] of [["place", { place: {} }], ["links", { relatedLinks: [{ id: "bad", label: "Bad", url: "javascript:alert(1)" }] }]]) await change(trip, "schema-invalid-" + name, [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", ...fields } }], "validation_failed");
  const clearRequest = { tripId: trip.id, expectedVersion: trip.version, requestId: "schema-clear", changes: [upsert(null)] };
  trip = (await tool("apply_trip_changes", clearRequest)).trip;
  assert.deepEqual((await tool("apply_trip_changes", clearRequest)).trip, trip);
  assert.equal(Object.hasOwn(planOf((await read(trip.id)).trip), "googlePlaceAssociation"), false);
  assert.equal((await read(trip.id)).planLocationBindings[0].locationBinding, binding, "clear removes the association, not the location");
  trip = (await change(trip, "schema-relink", [upsert(value)])).trip;
  const moved = { ...selected, id: "node/900002", lat: 11, address: "2 Invented Square", sourceUrl: "https://www.openstreetmap.org/node/900002" };
  trip = (await change(trip, "schema-move", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", place: moved, lat: moved.lat, lng: moved.lng, address: moved.address } }])).trip;
  assert.equal(Object.hasOwn(planOf(trip), "googlePlaceAssociation"), false, "location changes invalidate a carried association");
  const newBinding = (await read(trip.id)).planLocationBindings[0].locationBinding;
  assert.notEqual(newBinding, binding); assert.equal(newBinding, locationBindingForPlan(planOf(trip)));
  await change(trip, "schema-old-binding", [upsert(value)], "validation_failed");
  trip = (await change(trip, "schema-new-binding", [upsert({ ...value, locationBinding: newBinding })])).trip;
  trip = (await change(trip, "schema-remove-location", [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", place: null } }])).trip;
  assert.equal(Object.hasOwn(planOf(trip), "googlePlaceAssociation"), false);
  assert.equal((await read(trip.id)).planLocationBindings[0].locationBinding, null);
  assert.deepEqual(planOf(trip).relatedLinks, links); assert.deepEqual(planOf(trip).photo, planOf(original).photo);
  assert.deepEqual(trip.days[0].weatherLocationIds, []); assert.equal(trip.googlePlacePhotosEnabled, true);
  assert.deepEqual((await read(other.id)).trip, other);
  const exported = await tool("export_trip", { tripId: trip.id }); assert.equal(JSON.stringify(exported).includes("planLocationBindings"), false);
  const audit = ok(await api("/api/audit?limit=500"));
  const auditText = JSON.stringify(audit);
  for (const needle of [value.placeId, binding, "Preserve fictional notes", "Later fictional note", secret]) assert.equal(auditText.includes(needle), false, "audit remains payload-free");
  assert.ok(audit.events.some(e => e.channel === "mcp" && e.actor === account.id && e.outcome === "accepted"));
  assert.ok(audit.events.some(e => e.channel === "mcp" && e.outcome === "replayed"));
  assert.equal(fs.existsSync(path.join(root, "google-allowance.sqlite")), false, "no ledger initialization or provider activation");
  ok(await api(`/api/users/${account.id}/revoke`, {}));
  await assert.rejects(() => read(trip.id), "revoked MCP authority is refused without a browser fallback");
  console.log("MCP place discovery regression passed: six real SDK tools, structural optional fields and null-clear, read-only current bindings, content-manager set/read/clear, typed metadata with shared validation errors, atomic failures/conflicts, durable restart/replay, location invalidation, trip isolation and payload-free audit. Fictional local HTTP only; no providers.");
} finally {
  await sdk?.close(); await runtime?.close(); globalThis.fetch = nativeFetch;
  const target = path.resolve(root); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(target).startsWith("shared-trip-mcp-discovery-"));
  fs.rmSync(target, { recursive: true, force: true });
}
