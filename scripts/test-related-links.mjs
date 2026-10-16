import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { relatedLinksProblems, relatedLinkUrl } from "../assets/app-template/public/related-links.js";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-related-links-"));
const secret = crypto.randomBytes(32).toString("base64url");
const config = readConfig({ SHARED_TRIP_ADMIN_TOKEN: secret, SHARED_TRIP_DATA_DIR: root, SHARED_TRIP_PORT: "0" });
let runtime = await startServer(config), sdk;
const links = [{ id: "booking", label: "Fictional booking <b>page</b>", url: "https://example.org/booking?a=1&b=2" }, { id: "guide", label: "Guide", url: "https://example.org/guide" }];
async function api(route, body, { cookie, anonymous = false } = {}) {
  const response = await fetch(runtime.url + route, { method: body ? "POST" : "GET", headers: {
    ...(!anonymous && !cookie ? { Authorization: "Bearer " + secret } : {}),
    ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json", Origin: runtime.url } : {})
  }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
function ok(value, status = 200) { assert.equal(value.status, status, "HTTP status; payload omitted"); return value.body; }
let serial = 0;
const write = (trip, value, options = {}, extra = {}) => api(`/api/trips/${trip.id}/changes`, { expectedVersion: trip.version, requestId: `related-${++serial}`, changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", relatedLinks: value } }], ...extra }, options);
const planOf = (trip) => trip.days[0].slots[0];
try {
  assert.deepEqual(relatedLinksProblems(links), []);
  for (const url of ["https://example.org/%ZZ", "https://example.org/%FF", "https://example.org/%C2%80", "https://example.org/%E2%80%AE", "https://example.org:99999/"]) assert.equal(relatedLinkUrl(url), "", "malformed URL or encoded invisible control refused");
  for (const url of ["javascript:alert(1)", "data:text/html,x", "//example.org", "/relative", "https://user:pw@example.org/", "https://@example.org/", "https://example.org/a\nb", "https://example.org/%0a", "https://example.org/%5c", "https://", " https://example.org/", "https://example.org/\\x", "https://example.org/\u202efoo"]) assert.equal(relatedLinkUrl(url), "", "unsafe link refused");
  for (const value of [null, {}, [...links, links[0]], Array.from({ length: 7 }, (_, i) => ({ ...links[0], id: `link-${i}` })), [{ ...links[0], label: "" }], [{ ...links[0], label: "x".repeat(81) }], [{ ...links[0], extra: true }]]) assert.ok(relatedLinksProblems(value).length);
  let trip = ok(await api("/api/trips", { requestId: "related-create", trip: { title: "Fictional related links", timezone: "UTC", days: [{ id: "day-one", date: "2031-06-10", slots: [{ id: "plan-one", name: "Invented Gallery", notes: "Preserve notes", relatedLinks: links }] }] } }), 201).trip;
  const other = ok(await api("/api/trips", { requestId: "related-other", trip: { title: "Fictional independent trip" } }), 201).trip;
  assert.deepEqual(planOf(trip).relatedLinks, links);
  const stale = structuredClone(trip);
  const ordered = [links[1], { ...links[0], label: "Changed booking" }];
  trip = ok(await write(trip, ordered)).trip;
  assert.deepEqual(planOf(trip).relatedLinks, ordered);
  assert.equal(planOf(trip).notes, "Preserve notes");
  ok(await write(stale, []), 409);
  for (const value of [[{ ...links[0], url: "javascript:alert(1)" }], [links[0], links[0]], [{ ...links[0], label: "\u0000bad" }]]) ok(await write(trip, value), 422);
  const before = structuredClone(trip);
  ok(await api(`/api/trips/${trip.id}/changes`, { requestId: "related-atomic", expectedVersion: trip.version, changes: [{ type: "update_trip", fields: { title: "Must roll back" } }, { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", relatedLinks: [{ ...links[0], url: "bad" }] } }] }), 422);
  assert.deepEqual(ok(await api(`/api/trips/${trip.id}`)).trip, before);
  const invitation = ok(await api("/api/invitations", {}), 201).invitation;
  const password = "Fictional-" + crypto.randomBytes(16).toString("hex");
  ok(await api("/api/accept-invite", { invitation: invitation.token, username: "sample-link-reader", password }, { anonymous: true }), 201);
  const account = ok(await api("/api/users")).accounts.find((item) => item.username === "sample-link-reader");
  ok(await api(`/api/users/${account.id}/approve`, {}));
  let login = await api("/api/login", { username: "sample-link-reader", password }, { anonymous: true }); ok(login);
  const viewerCookie = login.headers.get("set-cookie").split(";")[0];
  ok(await write(trip, [], { cookie: viewerCookie }), 403);
  ok(await write(trip, [], { anonymous: true }), 401);
  ok(await api(`/api/users/${account.id}/role`, { role: "content-manager" }));
  login = await api("/api/login", { username: "sample-link-reader", password }, { anonymous: true }); ok(login);
  const managerCookie = login.headers.get("set-cookie").split(";")[0];
  const request = { requestId: "related-retry", expectedVersion: trip.version, changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", relatedLinks: [links[0]] } }] };
  const accepted = ok(await api(`/api/trips/${trip.id}/changes`, request, { cookie: managerCookie })); trip = accepted.trip;
  assert.deepEqual(ok(await api(`/api/trips/${trip.id}/changes`, request, { cookie: managerCookie })), accepted);
  const exported = ok(await api(`/api/trips/${trip.id}/export`));
  const imported = ok(await api("/api/import", { requestId: "related-import", data: exported }), 201).trip;
  assert.deepEqual(planOf(imported).relatedLinks, [links[0]]);
  sdk = new Client({ name: "fictional-related-links", version: "1.0.0" });
  await sdk.connect(new StreamableHTTPClientTransport(new URL(runtime.url + "/mcp"), { requestInit: { headers: { Authorization: "Bearer " + secret } } }));
  const tools = await sdk.listTools();
  assert.ok(JSON.stringify(tools.tools.find((tool) => tool.name === "apply_trip_changes").inputSchema).includes("relatedLinks"));
  const result = await sdk.callTool({ name: "apply_trip_changes", arguments: { tripId: trip.id, expectedVersion: trip.version, requestId: "related-mcp", changes: [{ type: "upsert_plan", dayId: "day-one", plan: { id: "plan-one", relatedLinks: ordered } }] } });
  assert.ok(!result.isError, "actual SDK MCP accepted related links");
  trip = ok(await api(`/api/trips/${trip.id}`)).trip; assert.deepEqual(planOf(trip).relatedLinks, ordered);
  assert.deepEqual(ok(await api(`/api/trips/${other.id}`)).trip, other);
  await sdk.close(); sdk = null; await runtime.close(); runtime = await startServer(config);
  assert.deepEqual(planOf(ok(await api(`/api/trips/${trip.id}`)).trip).relatedLinks, ordered);
  trip = ok(await write(trip, [])).trip; assert.deepEqual(planOf(trip).relatedLinks, []);
  console.log("Related links HTTP/SQLite/official MCP SDK tests passed: shared unsafe-input validation, stable ordered IDs, edit/remove, atomic failure, conflicts, durable retries, viewer/anonymous denial, manager edits, import/export, restart persistence and trip isolation. Fictional only; no providers.");
} finally { await sdk?.close(); await runtime.close(); const resolved = path.resolve(root); assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("shared-trip-related-links-")); fs.rmSync(resolved, { recursive: true, force: true }); }
