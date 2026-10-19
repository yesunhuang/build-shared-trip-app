// Anonymous read-only trip links (schema v9): real local HTTP server, real SQLite files, official MCP
// SDK client. Every trip, account, image and link here is fictional; no provider is contacted and
// nothing is published.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startServer, readConfig } from "../server/app.mjs";
import { hashPassword } from "../server/auth/passwords.mjs";
import { SCHEMA_VERSION, snapshotDatabase, validateSnapshot } from "../server/db.mjs";
import { pngChunk } from "../server/domain/branding.mjs";
import { LOCALES } from "../server/domain/validate.mjs";
import { DAY_I18N_FIELDS, REMINDER_I18N_FIELDS, SLOT_I18N_FIELDS, TRIP_I18N_FIELDS, SHARE_TRIGGERS } from "../server/trip-sharing.mjs";

assert.equal(SCHEMA_VERSION, 9, "anonymous links are schema v9");
const repo = fileURLToPath(new URL("..", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fictional-trip-sharing-"));
const ownerSecret = "fictional-sharing-owner-0000000000000000";
const password = "Fictional-account-password-only";
const owner = { Authorization: "Bearer " + ownerSecret };
let now = Date.parse("2031-06-11T01:00:00Z");
const config = { ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerSecret, SHARED_TRIP_DATA_DIR: dir, SHARED_TRIP_PORT: "0", SHARED_TRIP_HOST: "127.0.0.1" }),
  clock: () => now, guestLimits: { invalidPerWindow: 1_000_000, requestsPerMinute: 1_000_000 } };

// Fictional, valid 1x1 RGBA PNG bytes (accepted by the server's sanitizer).
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function pngBytes(r, g, b) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(Buffer.from([0, r, g, b, 255]))), pngChunk("IEND", Buffer.alloc(0))]);
}
const png64 = (r, g, b) => pngBytes(r, g, b).toString("base64");
const sha256hex = (value) => crypto.createHash("sha256").update(value).digest("hex");

const photoDir = path.join(dir, "photos"); fs.mkdirSync(photoDir);
const files = { guest: pngBytes(5, 6, 7), compat: pngBytes(9, 9, 9), booking: pngBytes(8, 8, 8), unbound: pngBytes(4, 4, 4), bOnly: pngBytes(3, 3, 3) };
fs.writeFileSync(path.join(photoDir, "fictional-guest.png"), files.guest);
fs.writeFileSync(path.join(photoDir, "fictional-compat-only.png"), files.compat);
fs.writeFileSync(path.join(photoDir, "fictional-booking.png"), files.booking);
fs.writeFileSync(path.join(photoDir, "fictional-unbound.png"), files.unbound);
fs.writeFileSync(path.join(photoDir, "fictional-b-only.png"), files.bOnly);

const HIDDEN = {
  booking: "FICTIONAL-BOOKING-HIDDEN", review: "FICTIONAL-REVIEW-HIDDEN", group: "FICTIONAL-GROUP-HIDDEN", resource: "FICTIONAL-RESOURCE-HIDDEN",
  compat: "FICTIONAL-COMPAT-HIDDEN", link: "https://example.com/fictional-related-hidden", tip: "FICTIONAL-TIP-HIDDEN", i18nReview: "FICTIONAL-I18N-REVIEW-HIDDEN",
  content: "FICTIONAL-CONTENT-HIDDEN", dayTheme: "FICTIONAL-DAY-THEME-HIDDEN", recommendation: "FICTIONAL-RECOMMENDATION-HIDDEN", disclaimer: "FICTIONAL-DISCLAIMER-HIDDEN",
  weather: "FICTIONAL-WEATHER-HIDDEN", queryKey: "FICTIONAL-QUERY-KEY-HIDDEN", person: "FICTIONAL-PERSON-HIDDEN"
};
const TRIP_A = {
  title: "Fictional Harbor Walk", timezone: "Asia/Tokyo", country: "Fictionland", dateRange: { start: "2031-06-10", end: "2031-06-12" },
  participantGroups: [{ id: "grp-a", label: HIDDEN.group, members: [HIDDEN.person] }],
  tips: [HIDDEN.tip], disclaimer: HIDDEN.disclaimer, resources: { note: HIDDEN.resource }, content: { page: HIDDEN.content },
  weather: { locations: [{ id: "w1", name: HIDDEN.weather, lat: 35, lng: 139 }] },
  cover: { mimeType: "image/png", data: png64(10, 20, 30), alt: "Fictional cover", focusX: 40, focusY: 60 },
  branding: { theme: { preset: "ocean" }, logo: { mimeType: "image/png", data: png64(1, 2, 3), alt: "Fictional logo" } },
  i18n: { ja: { title: "架空の港", review: HIDDEN.i18nReview } },
  days: [
    { id: "day-1", date: "2031-06-10", label: "Arrival", area: "Fictional Bay", summary: "Meet at the fictional pier.", notes: "Bring a fictional umbrella.",
      theme: HIDDEN.dayTheme, recommendations: { idea: HIDDEN.recommendation }, compat: { legacy: HIDDEN.compat },
      i18n: { "zh-Hans": { label: "抵达", theme: HIDDEN.dayTheme } },
      slots: [
        { id: "plan-upload", name: "Fictional Museum", time: "10:00", sortTime: "10:00", planType: "sight", cardCategory: "neutral", address: "1 Fictional Street",
          lat: 35.1, lng: 139.1, description: "A fictional gallery.", notes: "Meet at the east door.", booked: true,
          booking: { provider: "Fictional Tickets", url: "/photos/fictional-booking.png", seat: HIDDEN.booking }, review: HIDDEN.review,
          relatedLinks: [{ id: "rl1", label: "Fictional", url: HIDDEN.link }], participantGroupIds: ["grp-a"],
          uploadedPhoto: { mimeType: "image/png", data: png64(200, 100, 50), alt: "Fictional upload" },
          photo: { url: "/photos/fictional-guest.png", credit: "Fictional" }, mapsUrl: "https://www.openstreetmap.org/#map=18/35.1/139.1",
          i18n: { ja: { name: "架空の美術館", review: HIDDEN.i18nReview, booking: HIDDEN.booking } }, compat: { photo: { url: "/photos/fictional-compat-only.png" } } },
        { id: "plan-local", name: "Fictional Garden", time: "13:00", photo: { url: "/photos/fictional-guest.png", credit: "Fictional photographer", alt: "Fictional garden photo", license: "CC0" } },
        { id: "plan-source", name: "Fictional Garden Again", time: "15:00", photoSourceId: "plan-local" },
        { id: "plan-remote", name: "Fictional Tower", time: "17:00", photo: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_tower.jpg" },
        { id: "plan-keyed", name: "Fictional Keyed Photo", photo: "https://images.example.org/fictional.jpg?key=" + HIDDEN.queryKey },
        { id: "plan-google", name: "Fictional Provider Photo", photo: "https://places.googleapis.com/v1/fictional/media" }
      ] },
    { id: "day-2", date: "2031-06-11", label: "Second day", slots: [{ id: "plan-evening", name: "Fictional Dinner", period: "evening", time: "19:00" }] }
  ],
  reminders: [{ id: "rem-1", item: "Fictional ticket check", dueDate: "2031-06-01", done: true, leadDays: 3, notes: "Fictional reminder note", compat: { legacy: HIDDEN.compat } }]
};
const TRIP_B = { title: "Fictional Second Trip", timezone: "Europe/Lisbon", days: [{ id: "b-day", date: "2031-07-01", slots: [{ id: "b-photo", name: "Fictional B plan", photo: { url: "/photos/fictional-b-only.png" } }] }] };

let runtime; let mcp;
const seenUrls = [];
const issuedTokens = [];
const hook = () => runtime.server.prependListener("request", (req) => seenUrls.push(req.url));
async function restart(extra = {}) { await runtime.close(); runtime = await startServer({ ...config, ...extra }); hook(); }

async function call(route, { method, headers = {}, body, origin = true } = {}) {
  method ??= body === undefined ? "GET" : "POST";
  const response = await fetch(runtime.url + route, { method, redirect: "manual",
    headers: { ...(origin ? { Origin: runtime.url } : {}), ...headers, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await response.arrayBuffer());
  let data; try { data = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: response.status, headers: response.headers, data, buf, text: buf.toString("utf8") };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data?.error ?? r.text.slice(0, 200))); return r.data; };
const guest = (route, value, method = "GET", extra = {}) => call(route, { method, headers: { ...(value === undefined ? {} : { "X-Trip-Share": value }), ...extra } });
const GENERIC = { error: { code: "not_found", message: "Not found." } };
function guestHeaders(r, where) {
  assert.match(r.headers.get("cache-control") || "", /no-store/, where + " cache");
  assert.match(r.headers.get("cdn-cache-control") || "", /no-store/, where + " CDN cache");
  assert.equal(r.headers.get("referrer-policy"), "no-referrer", where + " referrer");
  assert.match(r.headers.get("x-robots-tag") || "", /noindex/, where + " robots");
  assert.equal(r.headers.get("set-cookie"), null, where + " never sets a cookie");
  assert.equal(r.headers.get("access-control-allow-origin"), null, where + " no CORS");
}
async function denied(route, value, where) { const r = await guest(route, value); assert.equal(r.status, 404, where); assert.deepEqual(r.data, GENERIC, where + " generic body"); guestHeaders(r, where); return r; }
async function account(username, role = "viewer") {
  const invitation = runtime.accounts.createInvitation().invitation, passwordHash = await hashPassword(password);
  runtime.accounts.redeemInvitation({ token: invitation.token, username, passwordHash });
  const user = runtime.accounts.listAccounts().accounts.find((u) => u.username === username);
  runtime.accounts.approve(user.id); if (role !== "viewer") runtime.accounts.setRole(user.id, { role });
  const result = { ...user, role }; await login(result); return result;
}
async function login(user) { const r = await call("/api/login", { body: { username: user.username, password } }); ok(r); user.auth = { Cookie: r.headers.get("set-cookie").split(";")[0] }; }
const read = async (id, as = owner) => ok(await call("/api/trips/" + id, { headers: as }));
const assign = async (id, user, role) => ok(await call("/api/trips/" + id + "/members", { headers: owner, body: { userId: user.id, role, expectedAccessVersion: (await read(id)).access.version, requestId: "assign-" + crypto.randomUUID() } }));
const sharingState = async (id, as = owner) => ok(await call("/api/trips/" + id + "/sharing", { headers: as })).sharing;
async function share(id, as, { expiresAt = null, version } = {}) {
  version ??= (await sharingState(id)).version;
  const r = await call("/api/trips/" + id + "/sharing", { headers: as, body: { expectedShareVersion: version, expiresAt } });
  if (r.status === 200) { assert.match(r.data.token, /^[A-Za-z0-9_-]{43}$/); assert.equal(Buffer.from(r.data.token, "base64url").length, 32); issuedTokens.push(r.data.token); }
  return r;
}
const revoke = async (id, as, version) => call("/api/trips/" + id + "/sharing/revoke", { headers: as, body: { expectedShareVersion: version ?? (await sharingState(id)).version } });
async function change(id, changes) { const trip = (await read(id)).trip; return ok(await call("/api/trips/" + id + "/changes", { headers: owner, body: { requestId: "change-" + crypto.randomUUID(), expectedVersion: trip.version, changes } })).trip; }
const tableRows = (db, skip = []) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .filter(({ name }) => !skip.includes(name)).map(({ name }) => [name, JSON.stringify(db.prepare('SELECT * FROM "' + name + '" ORDER BY rowid').all())]));
const keysOnly = (value, allowed, where) => { for (const key of Object.keys(value)) assert.ok(allowed.includes(key), where + " has unexpected key " + key); };
function i18nOnly(value, fields, where) {
  for (const [locale, patch] of Object.entries(value)) { assert.ok(LOCALES.includes(locale), where + " locale " + locale); for (const [key, text] of Object.entries(patch)) { assert.ok(fields.includes(key), where + " i18n key " + key); assert.equal(typeof text, "string"); } }
}
function checkProjection(trip, where) {
  keysOnly(trip, ["id", "version", "title", "timezone", "updatedAt", "days", "reminders", "cover", "branding", "i18n"], where);
  if (trip.i18n) i18nOnly(trip.i18n, TRIP_I18N_FIELDS, where + ".i18n");
  if (trip.cover) keysOnly(trip.cover, ["url", "alt", "focusX", "focusY"], where + ".cover");
  if (trip.branding) { keysOnly(trip.branding, ["theme", "logo"], where + ".branding"); if (trip.branding.logo) keysOnly(trip.branding.logo, ["url", "alt"], where + ".logo"); if (trip.branding.theme) keysOnly(trip.branding.theme, ["preset", "ink", "accent", "background"], where + ".theme"); }
  for (const day of trip.days) {
    keysOnly(day, ["id", "date", "label", "area", "summary", "notes", "slots", "i18n"], where + ".day");
    if (day.i18n) i18nOnly(day.i18n, DAY_I18N_FIELDS, where + ".day.i18n");
    for (const slot of day.slots) {
      keysOnly(slot, ["id", "name", "period", "time", "sortTime", "sortOrder", "planType", "cardCategory", "address", "lat", "lng", "description", "notes", "googleMapsUrl", "mapsUrl", "photo", "i18n"], where + ".slot");
      if (slot.photo) keysOnly(slot.photo, ["url", "alt", "credit", "sourceUrl", "license", "licenseUrl"], where + ".photo");
      if (slot.i18n) i18nOnly(slot.i18n, SLOT_I18N_FIELDS, where + ".slot.i18n");
    }
  }
  for (const reminder of trip.reminders) { keysOnly(reminder, ["id", "item", "dueDate", "notes", "i18n"], where + ".reminder"); if (reminder.i18n) i18nOnly(reminder.i18n, REMINDER_I18N_FIELDS, where + ".reminder.i18n"); }
}

runtime = await startServer(config); hook();
try {
  // ---------------------------------------------------------------- fixtures and default state
  const A = ok(await call("/api/trips", { headers: owner, body: { requestId: "fixture-trip-a", trip: TRIP_A } }), 201).trip.id;
  const B = ok(await call("/api/trips", { headers: owner, body: { requestId: "fixture-trip-b", trip: TRIP_B } }), 201).trip.id;
  const creator = await account("fictional.creator"), member = await account("fictional.member"), manager = await account("fictional.manager", "content-manager"), outsider = await account("fictional.outsider");
  await assign(A, creator, "creator"); await assign(A, member, "member"); await assign(A, manager, "member");
  assert.deepEqual(await sharingState(A), { enabled: false, version: 0, expiresAt: null, createdAt: null }, "existing trips stay private by default");
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM trip_shares").get().n, 0);

  // ---------------------------------------------------------------- management authority
  for (const route of ["/sharing", "/sharing/preview"]) assert.equal((await call("/api/trips/" + A + route)).status, 401, "anonymous " + route);
  assert.equal((await call("/api/trips/" + A + "/sharing", { body: { expectedShareVersion: 0, expiresAt: null } })).status, 401);
  for (const [who, user] of [["joined member", member], ["content manager without creator status", manager]]) {
    for (const route of ["/sharing", "/sharing/preview"]) assert.equal((await call("/api/trips/" + A + route, { headers: user.auth })).status, 403, who + " " + route);
    assert.equal((await call("/api/trips/" + A + "/sharing", { headers: user.auth, body: { expectedShareVersion: 0, expiresAt: null } })).status, 403, who + " cannot create");
    assert.equal((await call("/api/trips/" + A + "/sharing/revoke", { headers: user.auth, body: { expectedShareVersion: 0 } })).status, 403, who + " cannot revoke");
  }
  assert.equal((await call("/api/trips/" + A + "/sharing", { headers: outsider.auth })).status, 404, "non-members cannot learn the trip exists");
  assert.equal((await call("/api/trips/" + A + "/sharing", { headers: creator.auth, origin: false, body: { expectedShareVersion: 0, expiresAt: null } })).status, 403, "cross-site form posts are refused");
  assert.equal((await sharingState(A)).version, 0, "refused attempts write nothing");
  assert.deepEqual(await sharingState(A, creator.auth), { enabled: false, version: 0, expiresAt: null, createdAt: null }, "current creator may read state");
  for (const body of [{ expectedShareVersion: -1 }, { expectedShareVersion: 0, expiresAt: "tomorrow" }, { expectedShareVersion: 0, expiresAt: new Date(now - 1000).toISOString() },
    { expectedShareVersion: 0, expiresAt: new Date(now + 30_000).toISOString() }, { expectedShareVersion: 0, expiresAt: new Date(now + 800 * 86_400_000).toISOString() }, { expectedShareVersion: 0, requestId: "extra" }, []]) {
    assert.equal((await call("/api/trips/" + A + "/sharing", { headers: creator.auth, body })).status, 422, "invalid input " + JSON.stringify(body));
  }
  // MCP has no sharing tools, and every principal keeps its existing tool set.
  mcp = new Client({ name: "fictional-sharing-check", version: "1" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(runtime.url + "/mcp"), { requestInit: { headers: owner } }));
  const tools = (await mcp.listTools()).tools.map((t) => t.name);
  assert.equal(tools.length, 6, "owner MCP tool set unchanged"); assert.ok(!tools.some((name) => /shar|link|guest/i.test(name)), "no MCP sharing tool");
  await mcp.close(); mcp = null;

  // ---------------------------------------------------------------- creation: digest only, shown once
  let r = await share(A, creator.auth, { version: 0 }); ok(r);
  let token = r.data.token;
  assert.equal(r.data.sharing.enabled, true); assert.equal(r.data.sharing.version, 1); assert.equal(r.data.sharing.expiresAt, null); assert.ok(Number.isFinite(Date.parse(r.data.sharing.createdAt)));
  assert.deepEqual(Object.keys(r.data).sort(), ["sharing", "token"]); assert.deepEqual(Object.keys(r.data.sharing).sort(), ["createdAt", "enabled", "expiresAt", "version"]);
  assert.match(r.headers.get("cache-control"), /no-store/);
  r = await share(A, creator.auth, { version: 0 }); assert.equal(r.status, 409); assert.equal(r.data.error.code, "share_conflict"); assert.equal(r.data.error.currentVersion, 1);
  let row = runtime.db.prepare("SELECT * FROM trip_shares WHERE trip_id=?").get(A);
  assert.equal(row.token_hash, sha256hex(token)); assert.notEqual(row.token_hash, token); assert.equal(row.issuer, creator.id); assert.ok(Number.isInteger(row.issuer_epoch));
  const stateText = (await call("/api/trips/" + A + "/sharing", { headers: creator.auth })).text;
  assert.ok(!stateText.includes(token) && !stateText.includes(row.token_hash), "state never returns token or digest");
  for (const route of ["/api/trips/" + A, "/api/trips/" + A + "/export"]) { const text = (await call(route, { headers: owner })).text; assert.ok(!text.includes(token) && !text.includes(row.token_hash), route + " carries no share secret"); }
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM request_log WHERE result LIKE ? OR scope LIKE 'shar%'").get("%" + token + "%").n, 0, "no retry record holds a token");

  // ---------------------------------------------------------------- anonymous read: allowlisted projection
  r = await guest("/guest/trips/" + A, token); ok(r); guestHeaders(r, "guest trip");
  assert.match(r.headers.get("content-type"), /^application\/json/); assert.match(r.headers.get("vary") || "", /X-Trip-Share/i);
  assert.match(r.headers.get("content-security-policy") || "", /default-src 'none'/);
  const view = r.data.trip; checkProjection(view, "guest");
  for (const hidden of Object.values(HIDDEN)) assert.ok(!r.text.includes(hidden), "projection excludes " + hidden);
  for (const word of ["iVBORw0KGgo", "/photos/", "booking", "booked", "review", "relatedLinks", "participant", "members", "compat", "resources", "googlePlace", "access", "archived"]) assert.ok(!r.text.includes(word), "projection excludes " + word);
  assert.equal(view.id, A); assert.equal(view.title, "Fictional Harbor Walk"); assert.equal(view.timezone, "Asia/Tokyo"); assert.ok(Number.isInteger(view.version));
  assert.deepEqual(view.i18n, { ja: { title: "架空の港" } });
  assert.deepEqual(view.branding.theme, { preset: "ocean" }); assert.equal(view.branding.logo.alt, "Fictional logo");
  assert.equal(view.cover.alt, "Fictional cover"); assert.equal(view.cover.focusX, 40); assert.equal(view.cover.focusY, 60);
  assert.deepEqual(view.days.map((d) => d.date), ["2031-06-10", "2031-06-11"]);
  const day1 = view.days[0]; assert.equal(day1.summary, "Meet at the fictional pier."); assert.equal(day1.notes, "Bring a fictional umbrella."); assert.deepEqual(day1.i18n, { "zh-Hans": { label: "抵达" } });
  const slot = (id) => view.days.flatMap((d) => d.slots).find((s) => s.id === id);
  const museum = slot("plan-upload");
  assert.equal(museum.address, "1 Fictional Street"); assert.equal(museum.lat, 35.1); assert.equal(museum.lng, 139.1); assert.equal(museum.notes, "Meet at the east door.");
  assert.equal(museum.mapsUrl, "https://www.openstreetmap.org/#map=18/35.1/139.1"); assert.deepEqual(museum.i18n, { ja: { name: "架空の美術館" } });
  const mediaPattern = (key) => new RegExp("^/guest/trips/" + A + "/media/" + key + "\\?h=[0-9a-f]{16}$");
  assert.match(museum.photo.url, mediaPattern("plan-plan-upload"), "uploaded override first"); assert.equal(museum.photo.alt, "Fictional upload"); assert.equal(museum.photo.credit, undefined);
  assert.match(slot("plan-local").photo.url, mediaPattern("plan-plan-local")); assert.equal(slot("plan-local").photo.credit, "Fictional photographer"); assert.equal(slot("plan-local").photo.license, "CC0");
  assert.match(slot("plan-source").photo.url, mediaPattern("plan-plan-source"), "photoSourceId resolves inside the same trip");
  assert.equal(slot("plan-remote").photo.url, "https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional_tower.jpg", "remote HTTP(S) photos pass through");
  assert.equal(slot("plan-keyed").photo, undefined, "credential-looking query URLs are omitted"); assert.equal(slot("plan-google").photo, undefined, "no automatic Google API request");
  assert.equal(slot("plan-evening").period, "evening");
  assert.match(view.cover.url, mediaPattern("cover")); assert.match(view.branding.logo.url, mediaPattern("logo"));
  assert.deepEqual(view.reminders, [{ id: "rem-1", item: "Fictional ticket check", dueDate: "2031-06-01", notes: "Fictional reminder note" }]);
  assert.equal((await guest("/guest/trips/" + A + "?unused=1", token)).status, 200, "query strings are ignored, never needed");
  r = await guest("/guest/trips/" + A, token, "HEAD"); assert.equal(r.status, 200); assert.equal(r.buf.length, 0); guestHeaders(r, "guest HEAD");

  // ---------------------------------------------------------------- guest media: bound and allowed only
  const mediaUrls = [view.cover.url, view.branding.logo.url, ...view.days.flatMap((d) => d.slots).map((s) => s.photo?.url).filter((u) => u?.startsWith("/guest/"))];
  assert.equal(mediaUrls.length, 5);
  const served = [];
  for (const url of mediaUrls) {
    r = await guest(url, token); ok(r); guestHeaders(r, "media"); assert.equal(r.headers.get("content-type"), "image/png"); assert.ok(r.buf.subarray(0, 8).equals(SIGNATURE)); served.push(r.buf);
    r = await guest(url, token, "HEAD"); assert.equal(r.status, 200); assert.equal(r.buf.length, 0);
    await denied(url, undefined, "media requires the header");
  }
  assert.ok(served.some((buf) => buf.equals(files.guest)), "bound local photo is served byte-for-byte");
  assert.equal((await guest("/guest/trips/" + A + "/media/cover", token)).status, 200, "cache-busting query is optional");
  const bindings = runtime.db.prepare("SELECT pathname FROM trip_media WHERE trip_id=?").all(A).map((x) => x.pathname);
  assert.ok(bindings.includes("/photos/fictional-compat-only.png") && bindings.includes("/photos/fictional-booking.png"), "fixture really binds compat/booking-only files");
  for (const id of ["plan-upload", "plan-local", "plan-source", "plan-remote", "plan-keyed", "plan-google", "plan-evening"]) {
    const media = await guest("/guest/trips/" + A + "/media/plan-" + id, token);
    if (media.status === 200) for (const secret of [files.compat, files.booking, files.unbound, files.bOnly]) assert.ok(!media.buf.equals(secret), "no excluded or unbound file through " + id);
  }
  for (const guessed of ["plan-plan-keyed", "plan-plan-remote", "plan-plan-evening", "plan-missing", "plan-b-photo", "photos", "fictional-guest.png", "plan-../photos/fictional-unbound.png",
    "plan-%2E%2E%2Fphotos%2Ffictional-unbound.png", "cover/extra", "", "Cover", "logo.png"]) await denied("/guest/trips/" + A + "/media/" + guessed, token, "guessed media " + guessed);

  // ---------------------------------------------------------------- invalid capabilities: generic 404
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const nonCanonical = token.slice(0, 42) + alphabet[alphabet.indexOf(token[42]) ^ 1];
  for (const [label, value] of [["missing", undefined], ["empty", ""], ["short", token.slice(1)], ["long", token + "A"], ["non-canonical", nonCanonical],
    ["other", crypto.randomBytes(32).toString("base64url")], ["doubled", token + ", " + token], ["padded", token + "="], ["inner space", token.slice(0, 20) + " " + token.slice(20)]]) await denied("/guest/trips/" + A, value, "invalid " + label);
  await denied("/guest/trips/" + A + "?share=" + token, undefined, "a token in the query is never accepted");
  for (const extra of [{ Authorization: "Bearer " + token }, { Cookie: "shared_trip_session=" + token }]) { r = await guest("/guest/trips/" + A, undefined, "GET", extra); assert.equal(r.status, 404); }
  for (const unknown of ["/guest", "/guest/", "/guest/trips", "/guest/trips/", "/guest/trips/" + A + "/", "/guest/trips/" + A + "/changes", "/guest/trips/" + A + "/export", "/guest/trips/" + A + "/media", "/guest/trips/" + A + "/media/"]) await denied(unknown, token, "unknown guest path " + unknown);
  await denied("/guest/trips/no-such-trip", token, "unknown trip");
  r = await guest("/guest/trips/" + A, token, "GET", { Origin: "https://fictional-other.example" }); assert.equal(r.status, 403, "cross-origin pages cannot read guest responses");
  const versionBefore = (await read(A)).trip.version;
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    for (const route of ["/guest/trips/" + A, "/guest/trips/" + A + "/media/cover"]) {
      r = await call(route, { method, headers: { "X-Trip-Share": token }, ...(method === "OPTIONS" ? {} : { body: { title: "Forbidden" } }) });
      assert.equal(r.status, 405, method + " " + route); assert.equal(r.headers.get("allow"), "GET, HEAD"); guestHeaders(r, method);
    }
  }
  assert.equal((await read(A)).trip.version, versionBefore, "guest writes change nothing");

  // ---------------------------------------------------------------- strict route isolation
  const share$ = { "X-Trip-Share": token };
  for (const route of ["/api/session", "/api/trips", "/api/trips/" + A, "/api/trips/" + A + "/export", "/api/trips/" + A + "/sharing", "/api/trips/" + A + "/sharing/preview",
    "/api/trips/" + A + "/invitations", "/api/users", "/api/audit", "/api/google-places/config", "/photos/fictional-guest.png"]) assert.equal((await call(route, { headers: share$ })).status, 401, "share header never authenticates " + route);
  for (const route of ["/api/trips/" + A + "/changes", "/api/trips/" + A + "/sharing", "/api/trips/" + A + "/sharing/revoke", "/api/trips/" + A + "/members", "/api/trips/" + A + "/invitations", "/api/trips", "/api/import", "/api/join-trip", "/api/trips/" + A + "/places/search"]) {
    assert.equal((await call(route, { headers: share$, body: { requestId: "guest-write", expectedVersion: versionBefore, changes: [] } })).status, 401, "share header never writes " + route);
  }
  assert.equal((await call("/api/trips/" + A, { method: "DELETE", headers: share$, body: { requestId: "guest-delete", expectedVersion: versionBefore } })).status, 401);
  for (const headers of [share$, { Authorization: "Bearer " + token }]) assert.equal((await call("/mcp", { headers: { ...headers, Accept: "application/json, text/event-stream" }, body: { jsonrpc: "2.0", id: 1, method: "tools/list" } })).status, 401, "share capability is not an MCP credential");
  assert.equal((await call("/api/trips/" + A, { headers: { Authorization: "Bearer " + token } })).status, 401, "share token is not a bearer credential");
  assert.equal((await call("/api/trips/" + A, { headers: { ...outsider.auth, ...share$ } })).status, 404, "header adds nothing to an account session");
  assert.equal((await call("/photos/fictional-guest.png", { headers: { ...outsider.auth, ...share$ } })).status, 404);
  assert.deepEqual(ok(await call("/api/trips", { headers: { ...outsider.auth, ...share$ } })).trips, [], "no global trip-list permission");
  assert.equal((await read(A)).trip.version, versionBefore);

  // ---------------------------------------------------------------- cross-trip denial
  let tokenB = (await share(B, owner, { version: 0 })).data.token;
  const viewB = ok(await guest("/guest/trips/" + B, tokenB)).trip; checkProjection(viewB, "guest B");
  const bPhoto = viewB.days[0].slots[0].photo.url;
  r = await guest(bPhoto, tokenB); assert.equal(r.status, 200); assert.ok(r.buf.equals(files.bOnly), "B's bound photo is served only under B");
  await denied("/guest/trips/" + B, token, "A token on B"); await denied("/guest/trips/" + A, tokenB, "B token on A");
  await denied(bPhoto, token, "A token on B media"); await denied(view.cover.url, tokenB, "B token on A media");
  await denied("/guest/trips/" + A + "/media/plan-b-photo", token, "another trip's plan key");

  // ---------------------------------------------------------------- latest saved content, no rotation
  await change(A, [{ type: "update_trip", fields: { title: "Fictional Harbor Walk Updated" } }]);
  const updated = ok(await guest("/guest/trips/" + A, token)).trip;
  assert.equal(updated.title, "Fictional Harbor Walk Updated"); assert.equal(updated.version, view.version + 1);
  assert.equal((await sharingState(A)).version, 1, "content edits never rotate or bump the link");

  // ---------------------------------------------------------------- sharer preview equals the guest projection
  const preview = ok(await call("/api/trips/" + A + "/sharing/preview", { headers: owner }));
  assert.deepEqual(preview.trip, updated, "preview is exactly what a visitor receives");
  assert.ok(preview.media.some((m) => m.source === "local" && m.previewPath === "/photos/fictional-guest.png" && m.slotId === "plan-local"));
  assert.ok(preview.media.some((m) => m.source === "embedded" && m.kind === "cover")); assert.ok(preview.media.some((m) => m.source === "remote" && m.slotId === "plan-remote"));
  assert.ok(preview.inclusion.excluded.includes("booking_details") && preview.inclusion.freeTextAndPhotosAreNotSanitized === true && preview.inclusion.anyoneWithLinkCanView === true);
  assert.ok(!JSON.stringify(preview).includes(token) && !JSON.stringify(preview).includes("iVBORw0KGgo"));
  assert.deepEqual(ok(await call("/api/trips/" + A + "/sharing/preview", { headers: creator.auth })).trip, updated);

  // ---------------------------------------------------------------- generic /s shell and assets
  const shellFile = ["guest.html"].map((name) => path.join(repo, "assets/selfhosted", name)).find((file) => fs.existsSync(file));
  r = await call("/s/" + A + "#" + token);
  if (shellFile) {
    assert.equal(r.status, 200); assert.match(r.headers.get("content-type"), /^text\/html/);
    const csp = r.headers.get("content-security-policy") || "";
    assert.match(csp, /script-src 'self'(;|$)/); assert.match(csp, /connect-src 'self'/); assert.match(csp, /img-src 'self' blob: https:/); assert.match(csp, /frame-ancestors 'none'/); assert.ok(!/unsafe-inline|unsafe-eval|googleapis|gstatic/.test(csp));
    assert.equal(r.headers.get("referrer-policy"), "no-referrer"); assert.match(r.headers.get("x-robots-tag"), /noindex/); assert.match(r.headers.get("cache-control"), /no-store/); assert.equal(r.headers.get("set-cookie"), null);
    assert.ok(!r.text.includes("Fictional Harbor") && !r.text.includes(token), "generic unfurl shell");
    assert.equal((await call("/s/unknown-fictional-trip")).text, r.text, "the shell never reveals whether a trip exists");
    assert.equal((await call("/s/" + A, { method: "HEAD" })).status, 200);
  } else { assert.equal(r.status, 404); console.log("Note: assets/selfhosted guest shell not present in this workspace; /s wiring checked for absence only."); }
  assert.equal((await call("/s/" + A + "/extra")).status, 200, "malformed visitor URLs get the friendly generic shell");
  assert.equal((await call("/s/")).status,200);
  for (const asset of ["/guest.js", "/guest.css", "/share-management.js"]) {
    const response = await call(asset);
    if (response.status === 200) { assert.equal(response.headers.get("referrer-policy"), "no-referrer"); assert.ok(!response.text.includes(token)); }
    else assert.equal(response.status, 404, asset);
  }

  // ---------------------------------------------------------------- explicit rotation
  const oldToken = token;
  r = await share(A, creator.auth, { version: 1 }); ok(r); token = r.data.token; assert.equal(r.data.sharing.version, 2); assert.notEqual(token, oldToken);
  await denied("/guest/trips/" + A, oldToken, "rotated token"); await denied(view.cover.url, oldToken, "rotated token media");
  ok(await guest("/guest/trips/" + A, token));

  // ---------------------------------------------------------------- optional expiry
  const expiresAt = new Date(now + 3_600_000).toISOString();
  r = await share(A, creator.auth, { version: 2, expiresAt }); ok(r); token = r.data.token; assert.equal(r.data.sharing.expiresAt, expiresAt);
  ok(await guest("/guest/trips/" + A, token));
  now += 2 * 3_600_000;
  await denied("/guest/trips/" + A, token, "expired"); await denied(view.cover.url, token, "expired media");
  assert.deepEqual(await sharingState(A), { enabled: false, version: 3, expiresAt, createdAt: runtime.db.prepare("SELECT created_at FROM trip_shares WHERE trip_id=?").get(A).created_at });

  // ---------------------------------------------------------------- revocation (creator and owner)
  r = await share(A, creator.auth, { version: 3 }); ok(r); token = r.data.token;
  assert.equal((await revoke(A, creator.auth, 3)).status, 409);
  r = await revoke(A, creator.auth, 4); ok(r); assert.deepEqual(r.data.sharing, { enabled: false, version: 5, expiresAt: null, createdAt: null });
  await denied("/guest/trips/" + A, token, "revoked"); await denied(view.cover.url, token, "revoked media");
  row = runtime.db.prepare("SELECT * FROM trip_shares WHERE trip_id=?").get(A); assert.equal(row.token_hash, null); assert.equal(row.revoked_reason, "revoked"); assert.equal(row.issuer, null);
  assert.equal(ok(await revoke(A, creator.auth, 5)).sharing.version, 5, "revoking nothing is a no-op");
  token = (await share(A, creator.auth, { version: 5 })).data.token;
  ok(await revoke(A, owner, 6)); await denied("/guest/trips/" + A, token, "owner revokes a creator link");

  // ---------------------------------------------------------------- fail-closed issuer authority
  // (a) creator demoted to member, then reassigned: never revived.
  token = (await share(A, creator.auth, { version: 7 })).data.token; ok(await guest("/guest/trips/" + A, token));
  await assign(A, creator, "member");
  await denied("/guest/trips/" + A, token, "demoted creator"); assert.equal(runtime.db.prepare("SELECT revoked_reason FROM trip_shares WHERE trip_id=?").get(A).revoked_reason, "issuer_displaced");
  assert.equal((await call("/api/trips/" + A + "/sharing", { headers: creator.auth })).status, 403, "former creator loses management");
  await assign(A, creator, "creator"); await denied("/guest/trips/" + A, token, "reassignment never revives");
  assert.equal((await sharingState(A)).enabled, false);
  // (b) account revoked, then approved again: never revived.
  token = (await share(A, creator.auth)).data.token; ok(await guest("/guest/trips/" + A, token));
  ok(await call("/api/users/" + creator.id + "/revoke", { headers: owner, body: {} })); await denied("/guest/trips/" + A, token, "revoked issuer account");
  ok(await call("/api/users/" + creator.id + "/approve", { headers: owner, body: {} })); await denied("/guest/trips/" + A, token, "reapproval never revives");
  assert.equal(runtime.db.prepare("SELECT revoked_reason FROM trip_shares WHERE trip_id=?").get(A).revoked_reason, "issuer_inactive");
  assert.equal((await call("/api/trips/" + A + "/sharing", { headers: creator.auth })).status, 401, "old session is dead");
  await login(creator);
  // (c) role change bumps the account epoch: link ends; the creator (now also a content manager) may issue anew.
  token = (await share(A, creator.auth)).data.token;
  ok(await call("/api/users/" + creator.id + "/role", { headers: owner, body: { role: "content-manager" } })); await denied("/guest/trips/" + A, token, "issuer role change");
  await login(creator); token = (await share(A, creator.auth)).data.token; ok(await guest("/guest/trips/" + A, token));
  // (d) creator removed from the trip.
  await assign(A, creator, "remove"); await denied("/guest/trips/" + A, token, "issuer removed from trip");
  assert.equal((await call("/api/trips/" + A + "/sharing", { headers: creator.auth })).status, 404);
  // (e) owner-issued links survive creator changes.
  let ownerToken = (await share(A, owner)).data.token;
  await assign(A, creator, "creator"); await assign(A, creator, "member"); await assign(A, creator, "creator");
  ok(await guest("/guest/trips/" + A, ownerToken));
  // (f) defense in depth: with the trigger removed, the per-request epoch check still fails closed.
  r = await share(A, creator.auth); ok(r); token = r.data.token; await denied("/guest/trips/" + A, ownerToken, "rotation replaces the owner link");
  runtime.db.exec("DROP TRIGGER trip_shares_account_changed");
  runtime.db.prepare("UPDATE users SET session_epoch=session_epoch+1 WHERE id=?").run(creator.id);
  assert.notEqual(runtime.db.prepare("SELECT token_hash FROM trip_shares WHERE trip_id=?").get(A).token_hash, null, "trigger really absent");
  await denied("/guest/trips/" + A, token, "per-request epoch check"); assert.equal((await sharingState(A)).enabled, false);
  await restart();
  assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name=?").get("trip_shares_account_changed").n, 1, "restart restores the trigger");
  await denied("/guest/trips/" + A, token, "stale epoch stays invalid after restart");
  await login(creator);

  // ---------------------------------------------------------------- archive suspends, restore resumes, delete denies
  ownerToken = (await share(A, owner)).data.token; ok(await guest("/guest/trips/" + A, ownerToken));
  await change(A, [{ type: "archive_trip", archived: true }]);
  await denied("/guest/trips/" + A, ownerToken, "archived"); await denied(view.cover.url, ownerToken, "archived media");
  assert.equal((await sharingState(A)).enabled, true, "archive suspends reads without revoking");
  r = await share(A, owner); assert.equal(r.status, 409); assert.equal(r.data.error.code, "trip_archived");
  await change(A, [{ type: "archive_trip", archived: false }]);
  ok(await guest("/guest/trips/" + A, ownerToken)); ok(await guest(view.cover.url, ownerToken));
  await restart(); ok(await guest("/guest/trips/" + A, ownerToken), 200);
  assert.equal(runtime.db.prepare("PRAGMA user_version").get().user_version, 9);
  const versionB = (await read(B)).trip.version;
  ok(await call("/api/trips/" + B, { method: "DELETE", headers: owner, body: { requestId: "delete-fictional-b", expectedVersion: versionB } }));
  await denied("/guest/trips/" + B, tokenB, "deleted trip"); await denied(bPhoto, tokenB, "deleted trip media");
  assert.equal(runtime.db.prepare("SELECT 1 FROM trip_shares WHERE trip_id=?").get(B), undefined, "deletion removes the share row");
  assert.equal((await call("/api/trips/" + B + "/sharing", { headers: owner })).status, 410);

  // ---------------------------------------------------------------- audit and storage never hold tokens
  const events = runtime.audit.list("500").events;
  assert.ok(events.some((e) => e.action === "trip.share.create" && e.tripId === A) && events.some((e) => e.action === "trip.share.revoke" && e.tripId === A));
  const everything = JSON.stringify(tableRows(runtime.db));
  for (const issued of issuedTokens) assert.ok(!everything.includes(issued), "no table stores a raw token");

  // ---------------------------------------------------------------- snapshot validation (v9)
  const snap = path.join(dir, "share-backup.sqlite"); await snapshotDatabase(path.join(dir, "shared-trip.sqlite"), snap); validateSnapshot(snap);
  const tamper = (name, sql, pattern = /share/i) => { const copy = path.join(dir, name); fs.copyFileSync(snap, copy); const db = new DatabaseSync(copy); db.exec(sql); db.close(); assert.throws(() => validateSnapshot(copy), pattern, name); };
  tamper("tamper-plain.sqlite", "UPDATE trip_shares SET token_hash='" + "z".repeat(64) + "' WHERE token_hash IS NOT NULL");
  tamper("tamper-trigger.sqlite", "DROP TRIGGER trip_shares_member_removed");
  tamper("tamper-revoked.sqlite", "UPDATE trip_shares SET revoked_at='2031-01-01T00:00:00.000Z',revoked_reason='revoked' WHERE token_hash IS NOT NULL");
  tamper("tamper-trip.sqlite", "PRAGMA foreign_keys=OFF; UPDATE trip_shares SET trip_id='fictional-missing-trip'", /references|share/i);

  // ---------------------------------------------------------------- bounded abuse limits, no friction for valid links
  await restart({ guestLimits: { invalidPerWindow: 5, requestsPerMinute: 30 } });
  const wrong = crypto.randomBytes(32).toString("base64url");
  for (let i = 0; i < 5; i++) await denied("/guest/trips/" + A, wrong, "invalid attempt " + i);
  r = await guest("/guest/trips/" + A, wrong); assert.equal(r.status, 429); guestHeaders(r, "invalid limit");
  ok(await guest("/guest/trips/" + A, ownerToken), 200);
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) limited = (await guest("/guest/trips/" + A, ownerToken)).status === 429;
  assert.ok(limited, "per-address request ceiling bounds load");
  await runtime.close(); runtime = null;

  // ---------------------------------------------------------------- the fragment never reaches the server; no file holds a token
  for (const url of seenUrls.filter((u) => !u.includes("?share="))) for (const issued of issuedTokens) assert.ok(!url.includes(issued), "request URL carried a token: " + url.slice(0, 40));
  for (const name of fs.readdirSync(dir).filter((f) => f.startsWith("shared-trip.sqlite"))) {
    const bytes = fs.readFileSync(path.join(dir, name)).toString("latin1");
    for (const issued of issuedTokens) assert.ok(!bytes.includes(issued), name + " holds no raw token");
  }

  // ---------------------------------------------------------------- v8 -> v9 migration, idempotent restart, rollback copy
  const mdir = fs.mkdtempSync(path.join(os.tmpdir(), "fictional-share-migrate-"));
  const mconfig = { ...readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerSecret, SHARED_TRIP_DATA_DIR: mdir, SHARED_TRIP_PORT: "0", SHARED_TRIP_HOST: "127.0.0.1" }), clock: () => now };
  let m = await startServer(mconfig);
  const mTrip = m.service.createTrip({ requestId: "fictional-migration-trip", trip: { title: "Fictional migration trip", days: [{ id: "m-day", date: "2031-08-01", slots: [] }] } }).trip.id;
  await m.close();
  const mfile = path.join(mdir, "shared-trip.sqlite");
  let raw = new DatabaseSync(mfile);
  raw.exec(SHARE_TRIGGERS.map((name) => "DROP TRIGGER " + name + ";").join("") + "DROP TABLE trip_shares; PRAGMA user_version=8");
  const priorRows = tableRows(raw); raw.close();
  m = await startServer(mconfig);
  assert.equal(m.db.prepare("PRAGMA user_version").get().user_version, 9);
  assert.deepEqual(tableRows(m.db, ["trip_shares"]), priorRows, "v9 migration rewrites no existing row");
  assert.equal(m.db.prepare("SELECT COUNT(*) AS n FROM trip_shares").get().n, 0, "migrated trips stay private");
  assert.equal(m.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'trip_shares_%'").get().n, 3);
  const retained = () => fs.readdirSync(mdir).filter((f) => /^shared-trip\.sqlite\.before-v9-\d+$/.test(f));
  assert.equal(retained().length, 1, "a pre-v9 snapshot is retained");
  const rollback = new DatabaseSync(path.join(mdir, retained()[0]), { readOnly: true });
  assert.equal(rollback.prepare("PRAGMA user_version").get().user_version, 8); assert.deepEqual(tableRows(rollback), priorRows, "rollback copy is the untouched v8 database");
  assert.equal(rollback.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'trip_shares%'").get().n, 0); rollback.close();
  validateSnapshot(path.join(mdir, retained()[0]));
  const migratedLink = m.sharing.create({ role: "owner", via: "bearer" }, mTrip, { expectedShareVersion: 0 });
  assert.ok(m.sharing.resolve(mTrip, migratedLink.token), "sharing works after migration");
  await m.close();
  m = await startServer(mconfig); assert.equal(retained().length, 1, "migration is idempotent"); assert.ok(m.sharing.resolve(mTrip, migratedLink.token)); await m.close();

  console.log("Trip sharing passed: real HTTP/SQLite v9 links with digest-only storage, owner/current-creator management (members, content managers, outsiders, anonymous, cross-site and MCP refused), allowlisted projection and bound media only, generic 404s, cross-trip and guessed-media denial, GET/HEAD-only guests, header-only capability with no cookie and no /api, /photos or /mcp authority, no-store/no-referrer/noindex headers, content updates without rotation, preview parity, rotation, expiry, revocation, fail-closed issuer loss (demotion, account revocation/reapproval, role change, removal, trigger-independent epoch check), archive suspension/resumption, deletion, restart, snapshot validation/tampering, bounded abuse limits, and v8->v9 migration with a retained rollback copy. Fictional only; no providers, no publication.");
} finally {
  await mcp?.close();
  await runtime?.close();
}
