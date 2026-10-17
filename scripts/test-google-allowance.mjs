// Google Places UI Kit monthly allowance (server/google-allowance.mjs), tested against the real
// service over local HTTP and real SQLite files. Fictional data only.
//
// No Google service is contacted: the server never calls Google, the global fetch is wrapped so that
// any non-loopback request fails the test, the browser keys are obviously fake placeholders and the
// Place IDs are invented. Clocks are injected through the code-only hook (config.googleAllowanceClock);
// the operator CLI is run as a real child process with the real clock.
//
// Covers: Pacific (America/Los_Angeles) billing months versus UTC and the server's own time zone,
// both daylight-saving transitions and the PDT/PST month starts; strict, non-throwing configuration
// capped at the verified 10,000 free Query cap with a positive headroom (high baselines simply leave
// no capacity); the offline init/raise/reconcile-clock/status CLI (explicit month, no overwrite, no
// lowering, no secrets printed); durable clock faults (in-process jump, backward and implausible
// clocks) recorded in the ledger, surviving restarts and other connections until an explicit
// reconcile-clock, which never lowers a count; no fresh month on a start in an unrecorded month;
// legitimate in-process Pacific rollovers and restarts after them; missing month/baseline records
// (deleted while closed, at runtime, before a rollover, later months, the initial month) failing
// closed without being re-created at zero;
// permissions (viewer details only, editors search/preview, anonymous, pending, revoked, owner
// bearer, MCP token, cross-origin); association/opt-in re-checks; invalid payloads; no trip version
// change; one allowance shared across users, tabs and trips; a concurrent last-unit race over HTTP
// and across separate SQLite connections (worker threads); durable idempotency across restarts,
// replays that never extend or move a permit, request-ID conflicts; non-refundable work after a
// discarded response; month-boundary margins and delayed replays crossing a month; backward clocks
// across restarts, in-process clock jumps and implausible clocks; configuration and key changes
// that never reset consumption, lowering the limit; missing, corrupt, inconsistent and tampered
// ledgers failing closed without being re-created while trips keep working; trip backup/restore
// leaving the ledger's high-water count intact.
import assert from "node:assert/strict";
import {grantFixtureMembership} from "./fixtures/membership.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { readConfig, startServer } from "../server/app.mjs";
import { snapshotDatabase, validateSnapshot, SCHEMA_VERSION } from "../server/db.mjs";
import { GOOGLE_MAPS_BROWSER_KEY_ENV, GOOGLE_PLACES_FLAG_ENV } from "../server/google-places.mjs";
import {
  ALLOWANCE_LEDGER_FILE, GOOGLE_ALLOWANCE_HEADROOM_ENV, GOOGLE_MONTHLY_ALLOWANCE_ENV, MAX_LEDGER_COUNT, MAX_MONTHLY_ALLOWANCE, MIN_PERMIT_MS,
  MONTH_BOUNDARY_MARGIN_MS, PERMIT_TTL_MS, VERIFIED_FREE_QUERY_CAP,
  GoogleAllowance, initLedger, ledgerStatus, pacificMonthBounds, pacificMonthOf, pacificMonthStart, pacificParts, raiseLedger,
  readAllowanceConfig, reconcileClock, timeZoneSupported, validateLedger
} from "../server/google-allowance.mjs";
import { associationForPlan } from "../assets/app-template/public/google-place-association.js";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CLI = path.join(REPO, "server", "cli", "google-allowance.mjs");
const RESTORE_CLI = path.join(REPO, "server", "cli", "restore.mjs");

// ---------------------------------------------------------------------------------------------
// Network guard: only loopback traffic (the local test server) may leave this process.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) return Promise.reject(new Error("External network access is not allowed in this test."));
  return realFetch(input, init);
};

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-google-allowance-"));
const ownerToken = crypto.randomBytes(32).toString("base64url");
// Obviously fictional placeholders, never sent anywhere.
const FAKE_KEY = "FAKE-browser-key-for-tests-only-000000000";
const OTHER_FAKE_KEY = "FAKE-browser-key-for-tests-only-111111111";
const PLACE_A = "FAKE_place_id_allowance_0001";
const PLACE_B = "FAKE_place_id_allowance_0002";
const PLACE_C = "FAKE_place_id_allowance_0003";
const ENABLED = { [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: FAKE_KEY };
const allowanceEnv = (allowance, headroom) => ({ [GOOGLE_MONTHLY_ALLOWANCE_ENV]: String(allowance), [GOOGLE_ALLOWANCE_HEADROOM_ENV]: String(headroom) });
// A fictional instant well inside a Pacific month: 2031-05-10 11:00 PDT.
const T0 = Date.UTC(2031, 4, 10, 18, 0, 0);
const OSM_HALL = {
  provider: "openstreetmap", id: "node/9200000001", name: "Fictional Allowance Hall", address: "1 Invented Quay, Exampleton",
  lat: 35.6001, lng: 139.7001, sourceUrl: "https://www.openstreetmap.org/node/9200000001", attribution: "© OpenStreetMap contributors",
  license: "ODbL-1.0", selectedAt: "2031-01-01T00:00:00.000Z"
};
const OSM_PIER = { ...OSM_HALL, id: "way/9200000002", name: "Fictional Allowance Pier", address: "Pier Road, Exampleton", lat: 35.6101, lng: 139.7101, sourceUrl: "https://www.openstreetmap.org/way/9200000002" };
const MAPS_URL = "https://www.google.com/maps/place/Fictional+Allowance+Cafe,+1+Invented+Quay,+Exampleton/@35.1,139.1,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x1!8m2!3d35.1234!4d139.5678!16s";

function fakeClock(start) {
  let wall = start;
  let monotonic = 50_000;
  return {
    wall: () => wall, monotonic: () => monotonic,
    advance(ms) { wall += ms; monotonic += ms; },
    advanceTo(target) { const ms = target - wall; assert.ok(ms >= 0, "fake clock only moves forward here"); wall += ms; monotonic += ms; },
    jumpWall(ms) { wall += ms; },
    get now() { return wall; }
  };
}
// Wall and monotonic readings set independently, to model stepped clocks, suspended hosts and
// restarts (a new process starts its monotonic clock anywhere).
function manualClock(wall, monotonic = 0) {
  const now = { wall, monotonic };
  return { wall: () => now.wall, monotonic: () => now.monotonic, set(next) { Object.assign(now, next); }, get now() { return now.wall; } };
}
const ledgerFile = (dir) => path.join(dir, ALLOWANCE_LEDGER_FILE);
const freshDir = (name) => { const dir = path.join(temporary, name); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir; };
const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function monthRows(dir) {
  const db = new DatabaseSync(ledgerFile(dir), { readOnly: true });
  try { return Object.fromEntries(db.prepare("SELECT month,used FROM months ORDER BY month").all().map((row) => [row.month, row.used])); }
  finally { db.close(); }
}
function ledgerMeta(dir) {
  const db = new DatabaseSync(ledgerFile(dir), { readOnly: true });
  try { return Object.fromEntries(db.prepare("SELECT key,value FROM meta").all().map((row) => [row.key, row.value])); }
  finally { db.close(); }
}
// An outside writer (foreign keys off, as a careless manual edit would be).
function tamperLedger(dir, sql) {
  const db = new DatabaseSync(ledgerFile(dir), { enableForeignKeyConstraints: false });
  try { db.exec("PRAGMA busy_timeout=5000"); db.exec(sql); } finally { db.close(); }
}
const rejectsWith = (code, status) => (error) => error?.code === code && (status === undefined || error.status === status);

// ---------------------------------------------------------------------------------------------
// 1. Pacific billing months (pure)

assert.equal(timeZoneSupported(), true, "this runtime has usable America/Los_Angeles data");
{
  const cases = [
    // [instant, Pacific month, what it shows]
    [Date.UTC(2031, 0, 1, 0, 0), "2030-12", "UTC midnight on 1 January is still December in Pacific time"],
    [Date.UTC(2031, 0, 1, 7, 59, 59, 999), "2030-12", "PST: the last millisecond of December"],
    [Date.UTC(2031, 0, 1, 8, 0), "2031-01", "PST: the month starts at 08:00 UTC"],
    [Date.UTC(2026, 10, 1, 6, 59, 59, 999), "2026-10", "PDT: the last millisecond of October 2026"],
    [Date.UTC(2026, 10, 1, 7, 0), "2026-11", "PDT: November 2026 starts at 07:00 UTC, the same day daylight saving ends"],
    [Date.UTC(2026, 11, 1, 7, 30), "2026-11", "PST again by December: 07:30 UTC is still November"],
    [Date.UTC(2026, 11, 1, 8, 0), "2026-12", "PST: December starts at 08:00 UTC"],
    [Date.UTC(2027, 2, 1, 7, 59), "2027-02", "before the March 2027 start (PST)"],
    [Date.UTC(2027, 2, 1, 8, 0), "2027-03", "March 2027 starts at 08:00 UTC"],
    [Date.UTC(2027, 3, 1, 6, 59), "2027-03", "before the April 2027 start (PDT)"],
    [Date.UTC(2027, 3, 1, 7, 0), "2027-04", "April 2027 starts at 07:00 UTC"]
  ];
  for (const [ms, month, label] of cases) assert.equal(pacificMonthOf(ms), month, label);
  // Spring-forward day (second Sunday of March 2027): 01:59 PST is followed by 03:00 PDT.
  assert.deepEqual([pacificParts(Date.UTC(2027, 2, 14, 9, 59)).hour, pacificParts(Date.UTC(2027, 2, 14, 10, 0)).hour], [1, 3]);
  assert.equal(pacificMonthOf(Date.UTC(2027, 2, 14, 10, 0)), "2027-03", "a daylight-saving change inside a month never changes the month");
  assert.deepEqual(pacificMonthBounds("2026-11"), { start: Date.UTC(2026, 10, 1, 7), end: Date.UTC(2026, 11, 1, 8) }, "November 2026 is one hour longer than 30 days");
  assert.equal(pacificMonthBounds("2026-12").end, Date.UTC(2027, 0, 1, 8), "December rolls into the next year");
  assert.deepEqual(pacificMonthBounds("2028-02"), { start: Date.UTC(2028, 1, 1, 8), end: Date.UTC(2028, 2, 1, 8) }, "leap-year February");
  assert.equal(pacificMonthStart(2031, 5), Date.UTC(2031, 4, 1, 7));
  for (const bad of ["2031-13", "2031-5", "31-05", "", "2031-00"]) assert.throws(() => pacificMonthBounds(bad), /Invalid month/);
  assert.throws(() => pacificMonthOf(Number.NaN));
  // The server's own time zone is irrelevant.
  const originalTz = process.env.TZ;
  try {
    for (const zone of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"]) {
      process.env.TZ = zone;
      assert.equal(pacificMonthOf(Date.UTC(2031, 0, 1, 0, 0)), "2030-12", `unchanged with TZ=${zone}`);
    }
    process.env.TZ = "Asia/Tokyo";
    assert.equal(new Date(Date.UTC(2031, 0, 1, 0, 0)).getMonth(), 0, "fixture: a local-month implementation would say January here");
  } finally {
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Configuration: explicit, never automatic, never throws

assert.deepEqual(readAllowanceConfig({}), { state: "unconfigured" }, "no allowance unless configured");
assert.equal(VERIFIED_FREE_QUERY_CAP, 10_000, "the verified free monthly Query (Essentials) cap");
assert.equal(MAX_MONTHLY_ALLOWANCE, VERIFIED_FREE_QUERY_CAP, "the allocated allowance can never exceed the free cap");
assert.deepEqual(readAllowanceConfig(allowanceEnv(10000, 1000)), { state: "configured", allowance: 10000, headroom: 1000, limit: 9000 }, "10,000 allocated with 1,000 headroom allows at most 9,000 reservations");
assert.deepEqual(readAllowanceConfig(allowanceEnv(10000, 1)), { state: "configured", allowance: 10000, headroom: 1, limit: 9999 }, "the largest possible limit stays below the free cap");
assert.deepEqual(readAllowanceConfig(allowanceEnv(2, 1)), { state: "configured", allowance: 2, headroom: 1, limit: 1 });
for (const env of [
  { [GOOGLE_MONTHLY_ALLOWANCE_ENV]: "10000" }, { [GOOGLE_ALLOWANCE_HEADROOM_ENV]: "1000" },
  { [GOOGLE_MONTHLY_ALLOWANCE_ENV]: "10000", [GOOGLE_ALLOWANCE_HEADROOM_ENV]: "" },
  allowanceEnv("-1", 0), allowanceEnv("1e4", 0), allowanceEnv(" 100", 0), allowanceEnv("10,000", 0), allowanceEnv("0", 0), allowanceEnv("010", 0),
  allowanceEnv(100, 100), allowanceEnv(100, 101), allowanceEnv(1_000_001, 1), allowanceEnv(100, "1.5"), allowanceEnv("abc", 0),
  // Above the verified free cap: never an entitlement to paid usage.
  allowanceEnv(10001, 1000), allowanceEnv(1_000_000, 1000), allowanceEnv(1_000_000, 0), allowanceEnv(9_999_999, 1),
  // No positive safety headroom.
  allowanceEnv(10000, 0), allowanceEnv(100, 0), allowanceEnv(1, 0), allowanceEnv(1, 1), allowanceEnv(100, "-1")
]) {
  const config = readAllowanceConfig(env);
  assert.equal(config.state, "invalid", `invalid: ${JSON.stringify(env)}`);
  assert.ok(typeof config.problem === "string" && config.problem.length > 10);
}
assert.equal(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, "cfg"), ...allowanceEnv("lots", 0) }).googleAllowance.state, "invalid", "a bad allowance never stops the app from starting");
assert.equal(readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: path.join(temporary, "cfg") }).googleAllowance.state, "unconfigured");

// ---------------------------------------------------------------------------------------------
// 3. Ledger service with injected clocks (no HTTP)

const unitInput = (n, extra = {}) => ({ actor: "usr_fictional_unit", requestId: `unit-request-${String(n).padStart(8, "0")}`, kind: "search", tripId: "fictional-unit-trip", ...extra });
const unitService = (dir, clock, env = allowanceEnv(5, 2)) => new GoogleAllowance({ dataDir: dir, config: readAllowanceConfig(env), clock });

{
  // 3a. Limit, idempotency, replay validity, no extension.
  const dir = freshDir("unit-limit");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: T0 });
  const clock = fakeClock(T0 + 1000);
  const service = unitService(dir, clock);
  assert.deepEqual(service.status(), { state: "ready", reason: "", clockFault: "" });
  const first = service.reserve(unitInput(1));
  assert.equal(first.replayed, false);
  assert.match(first.permit.id, /^gpr_[A-Za-z0-9_-]{24}$/);
  assert.deepEqual({ ...first.permit, id: "" }, { id: "", kind: "search", tripId: "fictional-unit-trip", placeId: null, month: "2031-05", validForMs: PERMIT_TTL_MS });
  clock.advance(10_000);
  const replay = service.reserve(unitInput(1));
  assert.deepEqual([replay.replayed, replay.permit.id, replay.permit.validForMs], [true, first.permit.id, PERMIT_TTL_MS - 10_000], "a replay returns the same permit with less, never more, validity");
  assert.throws(() => service.reserve(unitInput(1, { kind: "preview", placeId: PLACE_A })), rejectsWith("request_id_conflict", 409), "same key, different input");
  const otherActor = service.reserve(unitInput(1, { actor: "usr_fictional_other" }));
  assert.notEqual(otherActor.permit.id, first.permit.id, "idempotency keys are scoped to one account");
  service.reserve(unitInput(2));
  assert.throws(() => service.reserve(unitInput(3)), rejectsWith("google_allowance_exhausted", 429), "allowance 5 with headroom 2: only 3 reservations");
  assert.throws(() => service.reserve(unitInput(4)), rejectsWith("google_allowance_exhausted", 429));
  assert.equal(service.reserve(unitInput(2)).replayed, true, "a replay of a counted reservation still answers after exhaustion");
  clock.advance(PERMIT_TTL_MS);
  assert.equal(service.reserve(unitInput(1)).permit.validForMs, 0, "an expired permit is never renewed");
  assert.deepEqual(monthRows(dir), { "2031-05": 3 }, "replays and denials never count");
  service.close();
}

{
  // 3b. Month boundaries, delayed replays crossing a month, UTC versus Pacific, PDT/PST starts.
  const dir = freshDir("unit-months");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: T0 });
  const clock = fakeClock(T0);
  const service = unitService(dir, clock, allowanceEnv(50, 10));
  const may = pacificMonthBounds("2031-05");
  clock.advanceTo(may.end - MONTH_BOUNDARY_MARGIN_MS - 20_000);
  assert.equal(new Date(clock.now).getUTCMonth(), 5, "fixture: UTC already says June");
  const late = service.reserve(unitInput(10));
  assert.deepEqual([late.permit.month, late.permit.validForMs], ["2031-05", 20_000], "counted in the Pacific month, and the permit ends before the boundary margin");
  clock.advance(20_000 - MIN_PERMIT_MS + 1);
  assert.throws(() => service.reserve(unitInput(11)), rejectsWith("google_allowance_month_boundary", 503), "too little time left before the boundary: refused, not counted");
  clock.advanceTo(may.end + 30_000);
  assert.throws(() => service.reserve(unitInput(12)), rejectsWith("google_allowance_month_boundary", 503), "just after the reset: refused, not counted");
  const replayAcross = service.reserve(unitInput(10));
  assert.deepEqual([replayAcross.permit.month, replayAcross.permit.validForMs], ["2031-05", 0], "a delayed replay crossing the month can never start work");
  clock.advanceTo(may.end + MONTH_BOUNDARY_MARGIN_MS + 1000);
  assert.equal(service.reserve(unitInput(13)).permit.month, "2031-06", "the new Pacific month starts at zero");
  // November starts in PDT (07:00 UTC), December in PST (08:00 UTC).
  clock.advanceTo(Date.UTC(2031, 10, 1, 6, 50));
  assert.equal(service.reserve(unitInput(14)).permit.month, "2031-10");
  clock.advanceTo(Date.UTC(2031, 10, 1, 7, 5));
  assert.equal(service.reserve(unitInput(15)).permit.month, "2031-11");
  clock.advanceTo(Date.UTC(2031, 11, 1, 7, 30));
  assert.equal(service.reserve(unitInput(16)).permit.month, "2031-11", "07:30 UTC on 1 December is still November (PST); a fixed offset would be wrong");
  clock.advanceTo(Date.UTC(2031, 11, 1, 8, 5));
  assert.equal(service.reserve(unitInput(17)).permit.month, "2031-12");
  assert.deepEqual(monthRows(dir), { "2031-05": 1, "2031-06": 1, "2031-10": 1, "2031-11": 2, "2031-12": 1 });
  assert.equal(service.status().state, "ready", "legitimate in-process rollovers are never clock faults");
  service.close();
  const meta = ledgerMeta(dir);
  assert.deepEqual([meta.initial_month, meta.latest_month, meta.month_count, meta.clock_fault, meta.clock_fault_at], ["2031-05", "2031-12", "5", "", ""],
    "every new month is recorded as the latest month record");
  // A normal restart after the rollovers, inside the latest recorded month: counts persist.
  const restarted = unitService(dir, manualClock(clock.now + 60_000, 7), allowanceEnv(50, 10));
  assert.equal(restarted.status().state, "ready");
  assert.equal(restarted.reserve(unitInput(18)).permit.month, "2031-12");
  assert.equal(restarted.reserve(unitInput(17)).replayed, true, "idempotency survives the restart");
  restarted.close();
  assert.deepEqual(monthRows(dir), { "2031-05": 1, "2031-06": 1, "2031-10": 1, "2031-11": 2, "2031-12": 2 });
}

const uncertain = rejectsWith("google_allowance_clock_uncertain", 503);
const MAY15 = Date.UTC(2031, 4, 15, 12);
const JUNE15 = Date.UTC(2031, 5, 15, 12);

{
  // 3c-1. The coordinator's sequence: an in-process jump into the next month is recorded in the
  //       ledger, and a restart at the same bad wall time neither grants nor starts a new month.
  const dir = freshDir("unit-clock-durable");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: MAY15 });
  const clock = manualClock(MAY15, 0);
  let service = unitService(dir, clock, allowanceEnv(21, 1));
  assert.equal(service.reserve(unitInput(20)).permit.month, "2031-05");
  clock.set({ wall: JUNE15, monotonic: 1000 });
  assert.throws(() => service.reserve(unitInput(21)), uncertain, "a month of wall time in one monotonic second is a clock fault");
  assert.deepEqual([service.status().state, service.status().clockFault], ["clock_uncertain", "clock_jump"]);
  assert.throws(() => service.reserve(unitInput(22)), uncertain, "and stays closed in this process");
  service.close();
  let meta = ledgerMeta(dir);
  assert.deepEqual([meta.clock_fault, meta.clock_fault_at, meta.high_water_ms, meta.latest_month], ["clock_jump", String(JUNE15), String(MAY15), "2031-05"],
    "the fault is durable; the faulty time never becomes the high-water mark");
  service = unitService(dir, manualClock(JUNE15, 0), allowanceEnv(21, 1));
  assert.deepEqual([service.status().state, service.status().clockFault], ["clock_uncertain", "clock_jump"], "a restart does not clear the fault");
  assert.throws(() => service.reserve(unitInput(23)), uncertain, "a restart at the same bad wall time grants nothing");
  service.close();
  assert.deepEqual(monthRows(dir), { "2031-05": 1 }, "no new month was started on the advanced clock");
  // A restart with the correct clock does not clear it either.
  service = unitService(dir, manualClock(MAY15 + 60_000, 5), allowanceEnv(21, 1));
  assert.equal(service.status().state, "clock_uncertain", "a corrected clock alone does not clear the fault");
  assert.throws(() => service.reserve(unitInput(24)), uncertain);
  service.close();
  const status = ledgerStatus(ledgerFile(dir), { wall: MAY15 + 60_000 });
  assert.equal(status.valid, true);
  assert.equal(status.clockFault, "clock_jump");
  assert.match(status.problem, /reconcile-clock/, "status tells the operator what to do");
  // The operator reconciles: explicit current month, never lowered.
  assert.throws(() => reconcileClock(ledgerFile(dir), { month: "2031-06", baseline: 0, wall: MAY15 + 120_000 }), /current Pacific billing month is 2031-05/, "the month must be confirmed");
  assert.throws(() => reconcileClock(ledgerFile(dir), { month: "2031-05", wall: MAY15 + 120_000 }), /--baseline/, "the baseline must be explicit");
  assert.throws(() => reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: -1, wall: MAY15 + 120_000 }), /--baseline/);
  assert.equal(ledgerMeta(dir).clock_fault, "clock_jump", "refused reconciliations change nothing");
  const reconciled = reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: MAY15 + 120_000 });
  assert.deepEqual([reconciled.clearedFault, reconciled.clockFault, reconciled.used, reconciled.problem], ["clock_jump", "", 1, ""], "a lower baseline never lowers the count");
  meta = ledgerMeta(dir);
  assert.deepEqual([meta.clock_fault, meta.clock_fault_at], ["", ""]);
  service = unitService(dir, manualClock(MAY15 + 180_000, 0), allowanceEnv(21, 1));
  assert.deepEqual(service.status(), { state: "ready", reason: "", clockFault: "" }, "after reconciliation and a restart");
  assert.equal(service.reserve(unitInput(25)).permit.month, "2031-05");
  service.close();
  assert.deepEqual(monthRows(dir), { "2031-05": 2 });
}

{
  // 3c-2. A start in a Pacific month without a ledger record (downtime across the reset, or a clock
  //       that jumped while the app was stopped) never allocates a fresh month by itself.
  const dir = freshDir("unit-clock-downtime");
  initLedger(ledgerFile(dir), { baseline: 3, month: "2031-05", wall: MAY15 });
  let service = unitService(dir, manualClock(MAY15 + 1000, 0), allowanceEnv(21, 1));
  service.reserve(unitInput(30));
  service.close();
  const before = digest(ledgerFile(dir));
  const JUNE2 = Date.UTC(2031, 5, 2, 12);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    service = unitService(dir, manualClock(JUNE2 + attempt * 1000, attempt), allowanceEnv(21, 1));
    assert.equal(service.status().state, "month_unconfirmed", `restart ${attempt}: the new month needs confirmation`);
    assert.match(service.status().reason, /reconcile-clock --month 2031-06/);
    assert.throws(() => service.reserve(unitInput(31 + attempt)), uncertain, `restart ${attempt}: nothing is granted`);
    service.close();
  }
  assert.equal(digest(ledgerFile(dir)), before, "an unconfirmed month writes nothing and creates no month record");
  assert.deepEqual(monthRows(dir), { "2031-05": 4 });
  assert.match(ledgerStatus(ledgerFile(dir), { wall: JUNE2 }).notice, /reconcile-clock --month 2031-06/);
  assert.throws(() => raiseLedger(ledgerFile(dir), { add: 2, month: "2031-06", wall: JUNE2 + 5_000 }), /reconcile-clock/, "raise never creates a month record");
  const confirmed = reconcileClock(ledgerFile(dir), { month: "2031-06", baseline: 6, wall: JUNE2 + 5_000 });
  assert.deepEqual([confirmed.used, confirmed.latestMonth, confirmed.clearedFault], [6, "2031-06", ""], "the operator's baseline for the new month, never an assumed zero");
  service = unitService(dir, manualClock(JUNE2 + 6_000, 0), allowanceEnv(21, 1));
  assert.equal(service.status().state, "ready");
  assert.equal(service.reserve(unitInput(34)).permit.month, "2031-06");
  service.close();
  assert.equal(reconcileClock(ledgerFile(dir), { month: "2031-06", baseline: 2, wall: JUNE2 + 8_000 }).used, 7, "reconciling never lowers a count");
  assert.equal(reconcileClock(ledgerFile(dir), { month: "2031-06", baseline: 9, wall: JUNE2 + 9_000 }).used, 9, "a higher observed count is kept");
  assert.deepEqual(monthRows(dir), { "2031-05": 4, "2031-06": 9 });
  // A restart with the clock back in May is now a backward clock: recorded, and not reconcilable
  // from that clock (counts are never moved back into an earlier month).
  service = unitService(dir, manualClock(MAY15 + 5_000, 0), allowanceEnv(21, 1));
  assert.deepEqual([service.status().state, service.status().clockFault], ["clock_uncertain", "clock_backward"]);
  service.close();
  assert.throws(() => reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: MAY15 + 6_000 }), /earlier than the ledger/);
  assert.equal(ledgerMeta(dir).clock_fault, "clock_backward");
  assert.deepEqual(monthRows(dir), { "2031-05": 4, "2031-06": 9 });
}

{
  // 3c-3. Normal restarts; backward, in-process and implausible clocks are all recorded and
  //       survive restarts, also for other connections, until reconcile-clock.
  const dir = freshDir("unit-clock");
  initLedger(ledgerFile(dir), { baseline: 1, month: "2031-05", wall: T0 });
  const H = T0 + 3_600_000;
  let clock = fakeClock(H);
  let service = unitService(dir, clock, allowanceEnv(21, 1));
  const kept = service.reserve(unitInput(40));
  service.close();
  // Normal restart: counts and idempotency survive.
  service = unitService(dir, fakeClock(H + 5_000), allowanceEnv(21, 1));
  const replay = service.reserve(unitInput(40));
  assert.deepEqual([replay.replayed, replay.permit.id, replay.permit.validForMs], [true, kept.permit.id, PERMIT_TTL_MS - 5_000], "durable across a restart");
  service.close();
  // Restart with the clock set back an hour: recorded at start-up.
  service = unitService(dir, fakeClock(T0), allowanceEnv(21, 1));
  assert.deepEqual([service.status().state, service.status().clockFault], ["clock_uncertain", "clock_backward"], "a backward clock at start-up fails closed");
  assert.throws(() => service.reserve(unitInput(41)), uncertain);
  service.close();
  service = unitService(dir, fakeClock(H + 6_000), allowanceEnv(21, 1));
  assert.equal(service.status().state, "clock_uncertain", "and stays closed after the clock passes the ledger's newest time");
  assert.throws(() => service.reserve(unitInput(42)), uncertain);
  service.close();
  assert.deepEqual(monthRows(dir), { "2031-05": 2 }, "nothing counted while the clock is uncertain");
  assert.equal(reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: H + 7_000 }).clearedFault, "clock_backward");

  // In-process forward jump within the month; the recorded fault also stops another connection.
  clock = fakeClock(H + 8_000);
  service = unitService(dir, clock, allowanceEnv(21, 1));
  service.reserve(unitInput(43));
  const sibling = unitService(dir, fakeClock(H + 8_500), allowanceEnv(21, 1));
  assert.equal(sibling.status().state, "ready");
  clock.jumpWall(2 * 3_600_000);
  assert.throws(() => service.reserve(unitInput(44)), uncertain, "a forward jump fails closed");
  clock.jumpWall(-2 * 3_600_000);
  assert.throws(() => service.reserve(unitInput(45)), uncertain, "and stays closed when the clock steps back");
  assert.equal(service.status().clockFault, "clock_jump");
  assert.throws(() => sibling.reserve(unitInput(46)), uncertain, "another connection sees the recorded fault");
  assert.equal(sibling.status().clockFault, "clock_jump");
  sibling.close();
  service.close();
  assert.equal(reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: H + 10_000 }).clearedFault, "clock_jump");

  // In-process backward jump, and a monotonic clock running backwards.
  const backwards = fakeClock(H + 11_000);
  service = unitService(dir, backwards, allowanceEnv(21, 1));
  backwards.jumpWall(-120_000);
  assert.throws(() => service.reserve(unitInput(47)), uncertain, "a backward in-process jump fails closed");
  service.close();
  reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: H + 12_000 });
  const monotonicBack = manualClock(H + 13_000, 10_000);
  service = unitService(dir, monotonicBack, allowanceEnv(21, 1));
  monotonicBack.set({ monotonic: 9_000 });
  assert.throws(() => service.reserve(unitInput(48)), uncertain, "a monotonic clock running backwards is untrustworthy");
  assert.equal(service.status().clockFault, "clock_jump");
  service.close();
  reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: H + 14_000 });

  // Implausible clocks: recorded at start-up (fault time 0 when the wall clock itself is unusable).
  service = unitService(dir, fakeClock(Date.UTC(2020, 0, 1)), allowanceEnv(21, 1));
  assert.deepEqual([service.status().state, service.status().clockFault], ["clock_uncertain", "clock_implausible"]);
  assert.throws(() => service.reserve(unitInput(49)), uncertain, "an implausible clock never starts work");
  service.close();
  assert.equal(ledgerMeta(dir).clock_fault_at, "0");
  assert.throws(() => reconcileClock(ledgerFile(dir), { month: "2020-01", baseline: 0, wall: Date.UTC(2020, 0, 1) }), /outside the supported range/, "never reconciled from an implausible clock");
  reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: H + 15_000 });
  for (const [label, hook] of [
    ["a non-finite monotonic clock", { wall: () => H + 16_000, monotonic: () => Number.NaN }],
    ["a throwing wall clock", { wall: () => { throw new Error("fictional clock failure"); }, monotonic: () => 1 }],
    ["a non-integer wall clock", { wall: () => H + 16_000.5, monotonic: () => 1 }]
  ]) {
    service = unitService(dir, hook, allowanceEnv(21, 1));
    assert.deepEqual([service.status().state, service.status().clockFault], ["clock_uncertain", "clock_implausible"], label);
    assert.throws(() => service.reserve(unitInput(50)), uncertain, label);
    service.close();
    reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: H + 17_000 });
  }
  service = unitService(dir, fakeClock(H + 18_000), allowanceEnv(21, 1));
  assert.equal(service.status().state, "ready");
  service.reserve(unitInput(51));
  service.close();
  assert.deepEqual(monthRows(dir), { "2031-05": 4 }, "baseline 1 + three granted reservations; reconciliations never lowered or added");
}

{
  // 3d. Configuration changes never reset consumption; lowering denies; unconfigured/invalid deny.
  const dir = freshDir("unit-config");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: T0 });
  const clock = fakeClock(T0 + 1000);
  let service = unitService(dir, clock, allowanceEnv(6, 1));
  for (let n = 30; n < 33; n += 1) service.reserve(unitInput(n));
  service.close();
  service = unitService(dir, clock, allowanceEnv(3, 1));
  assert.throws(() => service.reserve(unitInput(33)), rejectsWith("google_allowance_exhausted", 429), "a lowered limit below current use denies at once");
  service.close();
  service = unitService(dir, clock, allowanceEnv(11, 1));
  assert.equal(service.reserve(unitInput(34)).replayed, false, "a raised limit continues from the stored count");
  service.close();
  assert.deepEqual(monthRows(dir), { "2031-05": 4 });
  // Values outside the bounds (above the free cap, or no positive headroom) are invalid: Google
  // work stops, but nothing in the ledger is touched or reset.
  for (const env of [{}, allowanceEnv(4, 4), allowanceEnv(10001, 1000), allowanceEnv(10000, 0)]) {
    const before = digest(ledgerFile(dir));
    service = unitService(dir, clock, env);
    assert.throws(() => service.reserve(unitInput(35)), (error) => ["google_allowance_unconfigured", "google_allowance_unavailable"].includes(error.code) && error.status === 503);
    service.close();
    assert.equal(digest(ledgerFile(dir)), before, "an unconfigured or invalid configuration never touches the ledger");
  }
}

{
  // 3e. Missing, corrupt, inconsistent and tampered ledgers fail closed and are never re-created.
  const clock = fakeClock(T0 + 1000);
  const missing = freshDir("unit-missing");
  const absent = unitService(missing, clock);
  assert.equal(absent.status().state, "missing");
  assert.throws(() => absent.reserve(unitInput(40)), rejectsWith("google_allowance_unavailable", 503));
  assert.equal(fs.existsSync(ledgerFile(missing)), false, "a missing ledger is never re-created at zero");

  const corrupt = freshDir("unit-corrupt");
  fs.writeFileSync(ledgerFile(corrupt), crypto.randomBytes(4096));
  const corruptDigest = digest(ledgerFile(corrupt));
  const broken = unitService(corrupt, clock);
  assert.equal(broken.status().state, "unavailable");
  assert.throws(() => broken.reserve(unitInput(41)), rejectsWith("google_allowance_unavailable", 503));
  broken.close();
  assert.equal(digest(ledgerFile(corrupt)), corruptDigest, "a corrupt ledger is left exactly as found");

  const tamper = (name, sql) => {
    const dir = freshDir(name);
    initLedger(ledgerFile(dir), { baseline: 2, month: "2031-05", wall: T0 });
    const db = new DatabaseSync(ledgerFile(dir));
    db.exec(sql);
    db.close();
    const service = unitService(dir, clock);
    assert.equal(service.status().state, "unavailable", `${name} fails closed at start-up`);
    assert.throws(() => service.reserve(unitInput(42)), rejectsWith("google_allowance_unavailable", 503));
    service.close();
  };
  tamper("unit-total", "UPDATE months SET used = 1, baseline = 0");
  tamper("unit-basis", "UPDATE meta SET value='UTC' WHERE key='basis'");
  tamper("unit-meta", "DELETE FROM meta WHERE key='ledger_id'");
  tamper("unit-version-draft", "PRAGMA user_version=1");
  tamper("unit-version-future", "PRAGMA user_version=3");
  tamper("unit-table", "DROP TABLE reservations");
  tamper("unit-month-count", "UPDATE meta SET value='2' WHERE key='month_count'");
  tamper("unit-latest-meta", "UPDATE meta SET value='2031-04' WHERE key='latest_month'");
  tamper("unit-fault-value", "UPDATE meta SET value='bogus' WHERE key='clock_fault'");
  tamper("unit-fault-time", "UPDATE meta SET value='clock_jump' WHERE key='clock_fault'");
  tamper("unit-fault-meta", "DELETE FROM meta WHERE key='clock_fault'");
  tamper("unit-months-gone", "DELETE FROM months");
  tamper("unit-highwater", `INSERT INTO reservations VALUES ('gpr_${"A".repeat(24)}','usr_x','fictional-tamper-0001','${"0".repeat(64)}','search','fictional-trip','2031-05',${T0 + 99_999_999},${T0 + 99_999_999}); UPDATE months SET used = used + 1`);

  // Inconsistent while running: detected on the next reservation and sticky.
  const running = freshDir("unit-running");
  initLedger(ledgerFile(running), { baseline: 0, month: "2031-05", wall: T0 });
  const service = unitService(running, clock);
  service.reserve(unitInput(43));
  const db = new DatabaseSync(ledgerFile(running));
  db.exec("PRAGMA busy_timeout=5000; UPDATE months SET used = used - 1, baseline = 0");
  db.close();
  assert.throws(() => service.reserve(unitInput(44)), rejectsWith("google_allowance_unavailable", 503), "a ledger changed underneath the server stops granting");
  const repair = new DatabaseSync(ledgerFile(running));
  repair.exec("PRAGMA busy_timeout=5000; UPDATE months SET used = used + 1");
  repair.close();
  assert.throws(() => service.reserve(unitInput(45)), rejectsWith("google_allowance_unavailable", 503), "unknown accounting state stays closed until a restart");
  assert.equal(service.status().state, "unavailable");
  service.close();
}

{
  // 3f. Unusable time-zone data fails closed.
  const dir = freshDir("unit-timezone");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: T0 });
  const prototype = Intl.DateTimeFormat.prototype;
  const original = prototype.resolvedOptions;
  prototype.resolvedOptions = function patched() { return { ...original.call(this), timeZone: "UTC" }; };
  try {
    assert.equal(timeZoneSupported(), false);
    const service = unitService(dir, fakeClock(T0 + 1000));
    assert.equal(service.status().state, "unavailable");
    assert.throws(() => service.reserve(unitInput(50)), rejectsWith("google_allowance_unavailable", 503));
    service.close();
  } finally { prototype.resolvedOptions = original; }
  assert.equal(timeZoneSupported(), true);
}

{
  // 3h. Missing month and baseline records fail closed; an unknown baseline is never re-created at
  //     zero, neither at start-up nor inside a transaction (including one that would start a month).
  const unavailableError = rejectsWith("google_allowance_unavailable", 503);
  const JUNE10 = Date.UTC(2031, 5, 10, 18);

  // The coordinator's sequence: baseline 8, every month row deleted while the app is stopped.
  const closedDir = freshDir("unit-months-deleted");
  initLedger(ledgerFile(closedDir), { baseline: 8, month: "2031-05", wall: T0 });
  tamperLedger(closedDir, "DELETE FROM months");
  let service = unitService(closedDir, fakeClock(T0 + 1000), allowanceEnv(21, 1));
  assert.equal(service.status().state, "unavailable", "an empty months table is refused at start-up");
  assert.match(service.status().reason, /missing month records/);
  assert.throws(() => service.reserve(unitInput(60)), unavailableError);
  service.close();
  assert.deepEqual(monthRows(closedDir), {}, "May is never re-created at zero");
  const missingStatus = ledgerStatus(ledgerFile(closedDir), { wall: T0 + 1000 });
  assert.deepEqual([missingStatus.valid, /missing month records/.test(missingStatus.problem)], [false, true]);
  assert.throws(() => raiseLedger(ledgerFile(closedDir), { add: 1, month: "2031-05", wall: T0 + 2000 }), /missing month records/, "raise never repairs it");
  assert.throws(() => reconcileClock(ledgerFile(closedDir), { month: "2031-05", baseline: 8, wall: T0 + 2000 }), /missing month records/, "reconcile never repairs it");
  assert.deepEqual(monthRows(closedDir), {});

  // Deleted while the app runs, before any reservation (no reservation rows exist).
  const runtimeDir = freshDir("unit-months-runtime");
  initLedger(ledgerFile(runtimeDir), { baseline: 8, month: "2031-05", wall: T0 });
  service = unitService(runtimeDir, fakeClock(T0 + 1000), allowanceEnv(21, 1));
  assert.equal(service.status().state, "ready");
  tamperLedger(runtimeDir, "DELETE FROM months");
  assert.throws(() => service.reserve(unitInput(61)), unavailableError, "checked inside the reservation transaction");
  assert.equal(service.status().state, "unavailable");
  assert.throws(() => service.reserve(unitInput(62)), unavailableError, "and stays closed");
  service.close();
  assert.deepEqual(monthRows(runtimeDir), {});

  // Deleted at runtime just before an in-process rollover would create the next month.
  const rolloverDir = freshDir("unit-months-before-rollover");
  initLedger(ledgerFile(rolloverDir), { baseline: 8, month: "2031-05", wall: T0 });
  const rolloverClock = fakeClock(T0 + 1000);
  service = unitService(rolloverDir, rolloverClock, allowanceEnv(21, 1));
  tamperLedger(rolloverDir, "DELETE FROM months");
  rolloverClock.advanceTo(pacificMonthBounds("2031-05").end + MONTH_BOUNDARY_MARGIN_MS + 1000);
  assert.throws(() => service.reserve(unitInput(63)), unavailableError, "never treated as a fresh month");
  service.close();
  assert.deepEqual(monthRows(rolloverDir), {}, "no June record either");

  // A later month's baseline record (confirmed by the operator) deleted while stopped and at runtime.
  for (const variant of ["closed", "runtime"]) {
    const dir = freshDir(`unit-later-month-${variant}`);
    initLedger(ledgerFile(dir), { baseline: 2, month: "2031-05", wall: T0 });
    reconcileClock(ledgerFile(dir), { month: "2031-06", baseline: 5, wall: JUNE10 });
    assert.deepEqual(monthRows(dir), { "2031-05": 2, "2031-06": 5 });
    let laterService = null;
    if (variant === "runtime") {
      laterService = unitService(dir, fakeClock(JUNE10 + 1000), allowanceEnv(21, 1));
      assert.equal(laterService.status().state, "ready");
    }
    tamperLedger(dir, "DELETE FROM months WHERE month='2031-06'");
    laterService ??= unitService(dir, fakeClock(JUNE10 + 1000), allowanceEnv(21, 1));
    if (variant === "closed") assert.equal(laterService.status().state, "unavailable", "a missing latest-month record is refused at start-up");
    assert.throws(() => laterService.reserve(unitInput(64)), unavailableError, `${variant}: refused`);
    laterService.close();
    assert.deepEqual(monthRows(dir), { "2031-05": 2 }, `${variant}: June's baseline 5 is never re-created at zero`);
  }

  // A later month record with reservations deleted together with them (foreign keys off), and the
  // initial month record deleted while a later one remains.
  for (const [label, sql, expected] of [
    ["later month with its reservations", "DELETE FROM reservations WHERE month='2031-06'; DELETE FROM months WHERE month='2031-06'", { "2031-05": 3 }],
    ["initial month", "DELETE FROM reservations WHERE month='2031-05'; DELETE FROM months WHERE month='2031-05'", { "2031-06": 1 }]
  ]) {
    const dir = freshDir(`unit-month-gone-${label.replaceAll(" ", "-")}`);
    initLedger(ledgerFile(dir), { baseline: 2, month: "2031-05", wall: T0 });
    const rolling = fakeClock(T0 + 1000);
    service = unitService(dir, rolling, allowanceEnv(21, 1));
    service.reserve(unitInput(65));
    rolling.advanceTo(pacificMonthBounds("2031-05").end + MONTH_BOUNDARY_MARGIN_MS + 1000);
    assert.equal(service.reserve(unitInput(66)).permit.month, "2031-06", "fixture: a legitimate rollover");
    service.close();
    tamperLedger(dir, sql);
    assert.deepEqual(monthRows(dir), expected, "fixture");
    service = unitService(dir, fakeClock(rolling.now + 1000), allowanceEnv(21, 1));
    assert.equal(service.status().state, "unavailable", `${label}: refused at start-up`);
    assert.throws(() => service.reserve(unitInput(67)), unavailableError);
    service.close();
    assert.deepEqual(monthRows(dir), expected, `${label}: nothing re-created`);
  }
}

{
  // 3i. A high observed baseline may exceed the limit; it simply leaves no capacity.
  const dir = freshDir("unit-high-baseline");
  initLedger(ledgerFile(dir), { baseline: 12_000, month: "2031-05", wall: T0 });
  const config = readAllowanceConfig(allowanceEnv(10000, 1000));
  const service = new GoogleAllowance({ dataDir: dir, config, clock: fakeClock(T0 + 1000) });
  assert.equal(service.status().state, "ready");
  assert.throws(() => service.reserve(unitInput(70)), rejectsWith("google_allowance_exhausted", 429));
  service.close();
  const status = ledgerStatus(ledgerFile(dir), { wall: T0 + 1000, config });
  assert.deepEqual([status.used, status.limit, status.remaining, status.problem], [12_000, 9000, 0, ""]);
  assert.equal(raiseLedger(ledgerFile(dir), { add: 500, month: "2031-05", wall: T0 + 2000 }).used, 12_500, "raises above the limit are recorded");
  assert.throws(() => initLedger(ledgerFile(freshDir("unit-huge-baseline")), { baseline: MAX_LEDGER_COUNT + 1, month: "2031-05", wall: T0 }), /--baseline/);
  assert.throws(() => initLedger(ledgerFile(freshDir("unit-no-baseline")), { month: "2031-05", wall: T0 }), /--baseline/, "no default baseline");
}

{
  // 3g. Concurrent last units across separate SQLite connections (worker threads, one ledger).
  const dir = freshDir("unit-workers");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: T0 });
  const workerSource = `
    const { parentPort, workerData } = require("node:worker_threads");
    (async () => {
      const { GoogleAllowance, readAllowanceConfig } = await import(workerData.moduleUrl);
      const service = new GoogleAllowance({ dataDir: workerData.dir, config: readAllowanceConfig(workerData.env), clock: { wall: () => workerData.wall, monotonic: () => 1 } });
      const result = { granted: 0, exhausted: 0, other: [] };
      for (let i = 0; i < workerData.attempts; i += 1) {
        try { service.reserve({ actor: "usr_fictional_worker_" + workerData.index, requestId: "worker-" + workerData.index + "-" + String(i).padStart(10, "0"), kind: "search", tripId: "fictional-worker-trip" }); result.granted += 1; }
        catch (error) { if (error.code === "google_allowance_exhausted") result.exhausted += 1; else result.other.push(error.code || error.message); }
      }
      service.close();
      parentPort.postMessage(result);
    })().catch((error) => parentPort.postMessage({ crash: error.message }));`;
  const moduleUrl = pathToFileURL(path.join(REPO, "server", "google-allowance.mjs")).href;
  const results = await Promise.all([0, 1, 2, 3].map((index) => new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, { eval: true, workerData: { moduleUrl, dir, env: allowanceEnv(45, 5), wall: T0 + 2000, attempts: 15, index } });
    worker.once("message", resolve);
    worker.once("error", reject);
  })));
  for (const result of results) assert.ok(!result.crash && result.other.length === 0, `worker result ${JSON.stringify(result)}`);
  assert.equal(results.reduce((sum, result) => sum + result.granted, 0), 40, "exactly the limit across four concurrent connections");
  assert.equal(results.reduce((sum, result) => sum + result.exhausted, 0), 20);
  assert.deepEqual(monthRows(dir), { "2031-05": 40 });
  const check = new DatabaseSync(ledgerFile(dir), { readOnly: true });
  try { assert.equal(validateLedger(check).months.get("2031-05").used, 40, "the ledger stays consistent"); } finally { check.close(); }
}

// ---------------------------------------------------------------------------------------------
// 4. Operator CLI (real child process, real clock)

async function stableCurrentMonth() {
  for (;;) {
    const now = Date.now();
    const month = pacificMonthOf(now);
    const { start, end } = pacificMonthBounds(month);
    if (end - now > 120_000 && now - start > 60_000) return month;
    await new Promise((resolve) => setTimeout(resolve, Math.max(end - now, 0) + 61_000));
  }
}
function cli(dir, args, extraEnv = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SHARED_TRIP_")));
  const result = spawnSync(process.execPath, [CLI, ...args], { env: { ...env, ...(dir ? { SHARED_TRIP_DATA_DIR: dir } : {}), ...extraEnv }, encoding: "utf8" });
  return { status: result.status, out: `${result.stdout}\n${result.stderr}` };
}
{
  const dir = freshDir("cli");
  const month = await stableCurrentMonth();
  const [year, number] = month.split("-").map(Number);
  const wrongMonth = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  let run = cli(dir, ["status"]);
  assert.equal(run.status, 2, "status reports a missing ledger");
  assert.match(run.out, /ledger: missing/);
  assert.equal(fs.existsSync(ledgerFile(dir)), false, "status never creates a ledger");
  assert.equal(cli(dir, ["init", "--baseline", "7"]).status, 1, "init needs an explicit month");
  run = cli(dir, ["init", "--month", wrongMonth, "--baseline", "7"]);
  assert.equal(run.status, 1);
  assert.ok(run.out.includes(month), "the wrong month is refused and the current Pacific month named");
  assert.equal(cli(dir, ["init", "--month", month, "--baseline", "-3"]).status, 1);
  assert.equal(cli(dir, ["init", "--month", month]).status, 1, "init needs an explicit baseline");
  assert.equal(fs.existsSync(ledgerFile(dir)), false, "nothing is created by refused commands");
  run = cli(dir, ["init", "--month", month, "--baseline", "7"], { ...ENABLED, ...allowanceEnv(10000, 1000) });
  assert.equal(run.status, 0, run.out);
  assert.ok(!run.out.includes(FAKE_KEY), "the CLI never prints the browser key");
  if (process.platform !== "win32") assert.equal(fs.statSync(ledgerFile(dir)).mode & 0o777, 0o600, "the ledger is private (0600)");
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes(".tmp")), [], "no temporary file is left behind");
  const created = digest(ledgerFile(dir));
  run = cli(dir, ["init", "--month", month, "--baseline", "0"]);
  assert.equal(run.status, 1);
  assert.match(run.out, /never replaced or reset/);
  assert.equal(digest(ledgerFile(dir)), created, "an existing ledger is never replaced");
  run = cli(dir, ["status"]);
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /clock fault recorded: none/);
  assert.match(run.out, new RegExp(`latest month recorded in the ledger: ${month}`));
  assert.equal(cli(dir, ["reconcile-clock", "--month", wrongMonth, "--baseline", "0"]).status, 1, "reconcile-clock needs the current month");
  assert.equal(cli(dir, ["reconcile-clock", "--month", month]).status, 1, "reconcile-clock needs an explicit baseline");
  assert.equal(cli(dir, ["reconcile-clock", "--month", month, "--baseline", "-1"]).status, 1);
  assert.equal(digest(ledgerFile(dir)), created, "refused reconciliations change nothing");
  run = cli(dir, ["reconcile-clock", "--month", month, "--baseline", "2"], { ...ENABLED, ...allowanceEnv(10000, 1000) });
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /No count was lowered/);
  assert.match(run.out, /reserved this month \(including baseline and raises\): 7/, "a lower baseline never lowers the count");
  assert.ok(!run.out.includes(FAKE_KEY), "reconcile-clock never prints the browser key");
  assert.equal(cli(dir, ["status"], allowanceEnv(10001, 1000)).out.includes("allowance configuration in this environment: invalid"), true, "an allowance above the free cap is reported as invalid");
  assert.equal(cli(dir, ["raise", "--month", month, "--add", "0"]).status, 1, "raise adds at least one");
  assert.equal(cli(dir, ["raise", "--month", wrongMonth, "--add", "3"]).status, 1);
  run = cli(dir, ["raise", "--month", month, "--add", "3"]);
  assert.equal(run.status, 0, run.out);
  run = cli(dir, ["status"], allowanceEnv(10000, 1000));
  assert.equal(run.status, 0, run.out);
  assert.match(run.out, /reserved this month \(including baseline and raises\): 10/);
  assert.match(run.out, /maximum reservations per month: 9000/);
  assert.match(run.out, /remaining this month: 8990/);
  assert.equal(cli(dir, ["lower", "--month", month, "--add", "1"]).status, 1, "there is no command that lowers a count");
  assert.equal(cli(path.join(REPO, "scripts"), ["status"]).status, 1, "a data directory inside the checkout is refused");
  assert.equal(cli("", ["status"]).status, 1, "SHARED_TRIP_DATA_DIR is required");
  assert.equal(ledgerStatus(ledgerFile(dir)).used, 10);
  assert.throws(() => raiseLedger(ledgerFile(dir), { add: 1, month, wall: Date.now() - 5_000 }), /earlier than the ledger/, "raise refuses a clock behind the ledger");
  assert.equal(ledgerStatus(ledgerFile(dir)).used, 10, "a refused raise changes nothing");
}

// ---------------------------------------------------------------------------------------------
// 5. Real HTTP service

const running = [];
const logs = [];
async function start(dir, env, clock) {
  const config = readConfig({ SHARED_TRIP_ADMIN_TOKEN: ownerToken, SHARED_TRIP_DATA_DIR: dir, SHARED_TRIP_PORT: "0", ...env });
  const runtime = await startServer({ ...config, googleAllowanceClock: clock, googleAllowanceLog: (message) => logs.push(message) });
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
    const sent = { ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
    const response = await fetch(base + route, { method, headers: sent, body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (route.startsWith("/api/")) assert.equal(response.headers.get("cache-control"), "no-store", `${method} ${route} must be no-store`);
    return { status: response.status, body: parsed, text };
  }
  const api = {
    base, call,
    owner: (route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + ownerToken, ...options.headers } }),
    bearer: (secret, route, options = {}) => call(route, { ...options, headers: { Authorization: "Bearer " + secret, ...options.headers } }),
    as: (cookie, route, options = {}) => call(route, { ...options, headers: { Cookie: cookie, Origin: base, ...options.headers } }),
    async ownerCookie() {
      const login = await realFetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ token: ownerToken }) });
      assert.equal(login.status, 200);
      return (login.headers.get("set-cookie") || "").split(";")[0];
    },
    async signIn(account) {
      const login = await realFetch(base + "/api/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ username: account.username, ["pass" + "word"]: account.password }) });
      if (login.status !== 200) return { status: login.status, cookie: "" };
      return { status: 200, cookie: (login.headers.get("set-cookie") || "").split(";")[0] };
    },
    async makeAccount(username, { role, approve = true } = {}) {
      const invitation = expect(await api.owner("/api/invitations", { method: "POST", body: {} }), 201, "invitation").invitation;
      const password = "Fictional-" + crypto.randomBytes(12).toString("base64url");
      expect(await call("/api/accept-invite", { method: "POST", headers: { Origin: base }, body: { invitation: invitation.token, username, password } }), 201, "redeem " + username);
      const id = expect(await api.owner("/api/users"), 200, "accounts").accounts.find((account) => account.username === username).id;
      if (role) expect(await api.owner(`/api/users/${id}/role`, { method: "POST", body: { role } }), 200, "role " + username);
      if (approve) expect(await api.owner(`/api/users/${id}/approve`, { method: "POST" }), 200, "approve " + username);
      const account = { id, username, password, cookie: "" };
      if (approve) account.cookie = (await api.signIn(account)).cookie;
      return account;
    }
  };
  return api;
}

const planOf = (trip, id) => trip.days.flatMap((day) => day.slots || []).find((slot) => slot.id === id);
function tripPayload(title, enabled) {
  return {
    title, timezone: "UTC", dateRange: { start: "2031-05-20", end: "2031-05-21" }, googlePlacePhotosEnabled: enabled,
    days: [{ id: "day-one", date: "2031-05-20", slots: [
      { id: "plan-hall", name: "Fictional Allowance Hall", time: "09:00", place: OSM_HALL, lat: OSM_HALL.lat, lng: OSM_HALL.lng, address: OSM_HALL.address },
      { id: "plan-cafe", name: "Fictional Allowance Cafe", time: "12:00", googleMapsUrl: MAPS_URL },
      { id: "plan-free", name: "Fictional free evening", time: "19:00" }
    ] }]
  };
}
async function createLinkedTrip(api, requestId, title, enabled, links) {
  const created = expect(await api.owner("/api/trips", { method: "POST", body: { requestId, trip: tripPayload(title, enabled) } }), 201, "create " + title).trip;
  const changes = links.map(([planId, placeId]) => ({ type: "upsert_plan", dayId: "day-one", plan: { id: planId, googlePlaceAssociation: associationForPlan(planOf(created, planId), placeId) } }));
  return expect(await api.owner(`/api/trips/${created.id}/changes`, { method: "POST", body: { requestId: requestId + "-link", expectedVersion: created.version, changes } }), 200, "link " + title).trip;
}
const route = (tripId) => `/api/trips/${encodeURIComponent(tripId)}/google-places/reservations`;
let keyCounter = 0;
const newKey = () => `fictional-http-${String(++keyCounter).padStart(8, "0")}`;
const reserve = (api, cookie, tripId, body) => api.as(cookie, route(tripId), { method: "POST", body: { requestId: newKey(), ...body } });
function granted(response, { kind, tripId, placeId = null, key = FAKE_KEY }, label) {
  const body = expect(response, 200, label);
  assert.equal(body.granted, true, label);
  assert.match(body.permit.id, /^gpr_[A-Za-z0-9_-]{24}$/);
  assert.deepEqual([body.permit.kind, body.permit.tripId, body.permit.placeId, body.permit.month], [kind, tripId, placeId, "2031-05"], label);
  assert.ok(body.permit.validForMs > 0 && body.permit.validForMs <= PERMIT_TTL_MS, label + ": short validity");
  assert.equal(body.apiKey, key, label + ": the key arrives only with a grant");
  assert.deepEqual(body.libraries, ["places"]);
  return body;
}
const usedNow = (dir, clock) => { const status = ledgerStatus(ledgerFile(dir), { wall: clock.now }); assert.ok(status.valid, "ledger valid: " + status.problem); return status.used; };
function postDiscardingResponse(base, path_, cookie, body) {
  const url = new URL(base + path_);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, method: "POST",
      headers: { Host: url.host, Cookie: cookie, Origin: base, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
    (response) => { response.destroy(); resolve(response.statusCode); });
    request.on("error", reject);
    request.end(payload);
  });
}

try {
  const dir = freshDir("http");
  initLedger(ledgerFile(dir), { baseline: 0, month: "2031-05", wall: T0 });
  const clock = fakeClock(T0 + 60_000);
  let runtime = await start(dir, { ...ENABLED, ...allowanceEnv(8, 2) }, clock);
  let api = client(runtime.url);
  let ownerCookie = await api.ownerCookie();
  const manager = await api.makeAccount("fictional.allowance.manager", { role: "content-manager" });
  const viewer = await api.makeAccount("fictional.allowance.viewer");
  const viewer2 = await api.makeAccount("fictional.allowance.viewer2");
  const pending = await api.makeAccount("fictional.allowance.pending", { approve: false });
  const revoked = await api.makeAccount("fictional.allowance.revoked");
  const managerToken = expect(await api.owner(`/api/users/${manager.id}/mcp-tokens`, { method: "POST", body: { label: "Fictional allowance probe" } }), 201, "MCP token").secret;
  let tripA = await createLinkedTrip(api, "allowance-trip-a", "Fictional Allowance Trip A", true, [["plan-hall", PLACE_A], ["plan-cafe", PLACE_B]]);
  const tripB = await createLinkedTrip(api, "allowance-trip-b", "Fictional Allowance Trip B", true, [["plan-hall", PLACE_C]]);
  const tripC = await createLinkedTrip(api, "allowance-trip-c", "Fictional Allowance Trip C", false, [["plan-hall", PLACE_A]]);
  for(const trip of [tripA,tripB,tripC])for(const user of [viewer,viewer2,manager])grantFixtureMembership(runtime,trip.id,user.id);
  const versionA = tripA.version;
  assert.deepEqual(expect(await api.as(viewer.cookie, "/api/session"), 200, "session").features, { googlePlacesUiKit: true });

  // 5a. Permissions and current-state checks. Every refusal leaves the ledger untouched.
  const first = { requestId: newKey(), body: { kind: "details", planId: "plan-hall", placeId: PLACE_A }, trip: tripA.id };
  first.response = granted(await api.as(viewer.cookie, route(tripA.id), { method: "POST", body: { requestId: first.requestId, ...first.body } }),
    { kind: "details", tripId: tripA.id, placeId: PLACE_A }, "viewer: saved details");
  expect(await reserve(api, viewer.cookie, tripA.id, { kind: "search" }), 403, "viewer: no search", "forbidden");
  expect(await reserve(api, viewer.cookie, tripA.id, { kind: "preview", placeId: PLACE_C }), 403, "viewer: no preview", "forbidden");
  granted(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), { kind: "search", tripId: tripA.id }, "content manager: editor search");
  granted(await reserve(api, manager.cookie, tripA.id, { kind: "preview", placeId: PLACE_C }), { kind: "preview", tripId: tripA.id, placeId: PLACE_C }, "content manager: Place ID preview");
  granted(await reserve(api, ownerCookie, tripA.id, { kind: "details", planId: "plan-cafe", placeId: PLACE_B }), { kind: "details", tripId: tripA.id, placeId: PLACE_B }, "owner session: details");
  assert.equal(usedNow(dir, clock), 4);
  const refusals = [
    ["anonymous", api.call(route(tripA.id), { method: "POST", body: { requestId: newKey(), kind: "search" } }), 401, "unauthorized"],
    ["owner bearer", api.owner(route(tripA.id), { method: "POST", body: { requestId: newKey(), kind: "search" } }), 403, "forbidden"],
    ["MCP credential", api.bearer(managerToken, route(tripA.id), { method: "POST", body: { requestId: newKey(), kind: "search" } }), 401, undefined],
    ["cross-origin", api.as(manager.cookie, route(tripA.id), { method: "POST", body: { requestId: newKey(), kind: "search" }, headers: { Origin: "https://elsewhere.example" } }), 403, "forbidden_origin"],
    ["unlinked Place ID", reserve(api, viewer.cookie, tripA.id, { kind: "details", planId: "plan-hall", placeId: PLACE_B }), 409, "google_place_not_linked"],
    ["plan without location", reserve(api, viewer.cookie, tripA.id, { kind: "details", planId: "plan-free", placeId: PLACE_A }), 409, "google_place_not_linked"],
    ["unknown plan", reserve(api, viewer.cookie, tripA.id, { kind: "details", planId: "plan-missing", placeId: PLACE_A }), 409, "google_place_not_linked"],
    ["trip not opted in", reserve(api, viewer.cookie, tripC.id, { kind: "details", planId: "plan-hall", placeId: PLACE_A }), 409, "google_trip_not_enabled"],
    ["editor search in a trip not opted in", reserve(api, manager.cookie, tripC.id, { kind: "search" }), 409, "google_trip_not_enabled"],
    ["unknown trip", reserve(api, viewer.cookie, "fictional-no-such-trip", { kind: "details", planId: "plan-hall", placeId: PLACE_A }), 404, "trip_not_found"]
  ];
  for (const [label, pendingResponse, status, code] of refusals) expect(await pendingResponse, status, label, code);
  expect(await api.signIn(pending), 403, "a pending account cannot sign in at all");
  expect(await api.owner(`/api/users/${revoked.id}/revoke`, { method: "POST" }), 200, "revoke");
  expect(await reserve(api, revoked.cookie, tripA.id, { kind: "details", planId: "plan-hall", placeId: PLACE_A }), 401, "a revoked session is refused", "unauthorized");
  // A location change makes the saved association stale; it can no longer be reserved.
  const moved = expect(await api.owner(`/api/trips/${tripB.id}/changes`, { method: "POST", body: { requestId: "allowance-move-b", expectedVersion: tripB.version, changes: [
    { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-hall", place: OSM_PIER, lat: OSM_PIER.lat, lng: OSM_PIER.lng, address: OSM_PIER.address } }] } }), 200, "move trip B hall").trip;
  assert.equal(planOf(moved, "plan-hall").googlePlaceAssociation, undefined, "fixture: the stale association was dropped");
  expect(await reserve(api, viewer2.cookie, tripB.id, { kind: "details", planId: "plan-hall", placeId: PLACE_C }), 409, "stale association", "google_place_not_linked");
  const relinked = expect(await api.owner(`/api/trips/${tripB.id}/changes`, { method: "POST", body: { requestId: "allowance-relink-b", expectedVersion: moved.version, changes: [
    { type: "upsert_plan", dayId: "day-one", plan: { id: "plan-hall", googlePlaceAssociation: associationForPlan(planOf(moved, "plan-hall"), PLACE_C) } }] } }), 200, "relink trip B").trip;
  assert.equal(usedNow(dir, clock), 4, "no refusal was counted");

  // 5b. Invalid payloads (content manager) never count.
  const invalid = [
    ["wrong content type", api.as(manager.cookie, route(tripA.id), { method: "POST", raw: "requestId=x", headers: { "Content-Type": "text/plain" } }), 415],
    ["malformed JSON", api.as(manager.cookie, route(tripA.id), { method: "POST", raw: "{\"requestId\":" }), 422],
    ["array body", api.as(manager.cookie, route(tripA.id), { method: "POST", body: [] }), 422],
    ["unknown field (search text)", reserve(api, manager.cookie, tripA.id, { kind: "search", query: "Fictional Hall" }), 422],
    ["missing requestId", api.as(manager.cookie, route(tripA.id), { method: "POST", body: { kind: "search" } }), 422],
    ["short requestId", api.as(manager.cookie, route(tripA.id), { method: "POST", body: { requestId: "short", kind: "search" } }), 422],
    ["unsafe requestId", api.as(manager.cookie, route(tripA.id), { method: "POST", body: { requestId: "fictional request id 01", kind: "search" } }), 422],
    ["unknown kind", reserve(api, manager.cookie, tripA.id, { kind: "photos" }), 422],
    ["details without plan", reserve(api, manager.cookie, tripA.id, { kind: "details", placeId: PLACE_A }), 422],
    ["details with a bad Place ID", reserve(api, manager.cookie, tripA.id, { kind: "details", planId: "plan-hall", placeId: "bad id!" }), 422],
    ["search with a Place ID", reserve(api, manager.cookie, tripA.id, { kind: "search", placeId: PLACE_A }), 422],
    ["preview without Place ID", reserve(api, manager.cookie, tripA.id, { kind: "preview" }), 422],
    ["preview with a plan", reserve(api, manager.cookie, tripA.id, { kind: "preview", planId: "plan-hall", placeId: PLACE_A }), 422],
    ["oversized body", api.as(manager.cookie, route(tripA.id), { method: "POST", raw: JSON.stringify({ requestId: newKey(), kind: "search", pad: "x".repeat(9000) }) }), 413]
  ];
  for (const [label, pendingResponse, status] of invalid) expect(await pendingResponse, status, label);
  assert.equal(usedNow(dir, clock), 4, "invalid payloads never count");

  // 5c. One allowance across users, tabs and trips (limit 6).
  granted(await reserve(api, viewer2.cookie, tripB.id, { kind: "details", planId: "plan-hall", placeId: PLACE_C }), { kind: "details", tripId: tripB.id, placeId: PLACE_C }, "another viewer, another trip");
  granted(await reserve(api, viewer.cookie, tripA.id, { kind: "details", planId: "plan-hall", placeId: PLACE_A }), { kind: "details", tripId: tripA.id, placeId: PLACE_A }, "the first viewer's second tab");
  for (const [label, cookie, tripId, body] of [
    ["manager, trip B", manager.cookie, tripB.id, { kind: "search" }],
    ["owner, trip A", ownerCookie, tripA.id, { kind: "details", planId: "plan-hall", placeId: PLACE_A }],
    ["viewer 2, trip B", viewer2.cookie, tripB.id, { kind: "details", planId: "plan-hall", placeId: PLACE_C }]
  ]) {
    const response = await reserve(api, cookie, tripId, body);
    expect(response, 429, "exhausted for everyone: " + label, "google_allowance_exhausted");
    assert.ok(!response.text.includes(FAKE_KEY), "a denial never carries the key");
  }
  assert.equal(usedNow(dir, clock), 6);
  assert.equal(expect(await api.owner(`/api/trips/${tripA.id}`), 200, "read A").trip.version, versionA, "reservations never change a trip version");

  // 5d. Restart with one more unit and a different key: counts and idempotency survive, and only one
  //     of twelve concurrent requests wins the last unit.
  clock.advance(5_000);
  await stop(runtime);
  runtime = await start(dir, { [GOOGLE_PLACES_FLAG_ENV]: "1", [GOOGLE_MAPS_BROWSER_KEY_ENV]: OTHER_FAKE_KEY, ...allowanceEnv(9, 2) }, clock);
  api = client(runtime.url);
  ownerCookie = await api.ownerCookie();
  for (const account of [manager, viewer, viewer2]) account.cookie = (await api.signIn(account)).cookie;
  assert.equal(usedNow(dir, clock), 6, "a restart, a new key and a raised allowance never reset the count");
  const replay = expect(await api.as(viewer.cookie, route(first.trip), { method: "POST", body: { requestId: first.requestId, ...first.body } }), 200, "replay after restart");
  assert.deepEqual([replay.replayed, replay.permit.id], [true, first.response.permit.id], "the same permit after a restart");
  assert.ok(replay.permit.validForMs <= PERMIT_TTL_MS - 5_000, "with no more validity than it had left");
  assert.equal(replay.apiKey, OTHER_FAKE_KEY, "a replay carries the current key, never more permits");
  expect(await api.as(viewer.cookie, route(first.trip), { method: "POST", body: { requestId: first.requestId, kind: "details", planId: "plan-cafe", placeId: PLACE_B } }), 409, "same key, other input", "request_id_conflict");
  const race = await Promise.all(Array.from({ length: 12 }, (_, index) => {
    const [cookie, tripId, body] = [
      [manager.cookie, tripA.id, { kind: "search" }],
      [viewer.cookie, tripA.id, { kind: "details", planId: "plan-hall", placeId: PLACE_A }],
      [viewer2.cookie, tripB.id, { kind: "details", planId: "plan-hall", placeId: PLACE_C }],
      [ownerCookie, tripB.id, { kind: "preview", placeId: PLACE_B }]
    ][index % 4];
    return reserve(api, cookie, tripId, body);
  }));
  const winners = race.filter((response) => response.status === 200);
  assert.equal(winners.length, 1, "exactly one concurrent request wins the last unit");
  assert.equal(winners[0].body.apiKey, OTHER_FAKE_KEY, "the current key is delivered");
  assert.ok(race.filter((response) => response.status !== 200).every((response) => response.status === 429 && response.body.error.code === "google_allowance_exhausted"));
  assert.equal(usedNow(dir, clock), 7);
  clock.advance(PERMIT_TTL_MS);
  assert.equal(expect(await api.as(viewer.cookie, route(first.trip), { method: "POST", body: { requestId: first.requestId, ...first.body } }), 200, "late replay").permit.validForMs, 0, "an expired permit stays expired");

  // 5e. Lowering the limit below current use denies at once.
  await stop(runtime);
  runtime = await start(dir, { ...ENABLED, ...allowanceEnv(5, 1) }, clock);
  api = client(runtime.url);
  manager.cookie = (await api.signIn(manager)).cookie;
  expect(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), 429, "lowered limit", "google_allowance_exhausted");
  assert.equal(usedNow(dir, clock), 7);

  // 5f. A discarded response is still counted; the retry with the same key is the same permit;
  //     there is no refund route.
  await stop(runtime);
  runtime = await start(dir, { ...ENABLED, ...allowanceEnv(12, 2) }, clock);
  api = client(runtime.url);
  ownerCookie = await api.ownerCookie();
  for (const account of [manager, viewer, viewer2]) account.cookie = (await api.signIn(account)).cookie;
  const lostKey = newKey();
  assert.equal(await postDiscardingResponse(api.base, route(tripA.id), manager.cookie, { requestId: lostKey, kind: "search" }), 200, "the server answered; the client discarded it unread");
  assert.equal(usedNow(dir, clock), 8, "uncertain work is counted, never refunded");
  const recovered = expect(await api.as(manager.cookie, route(tripA.id), { method: "POST", body: { requestId: lostKey, kind: "search" } }), 200, "transport retry");
  assert.equal(recovered.replayed, true, "the retry is the same single permit");
  assert.equal(usedNow(dir, clock), 8);
  expect(await api.as(ownerCookie, route(tripA.id), { method: "DELETE", body: { requestId: lostKey } }), 404, "no refund route", "not_found");

  // 5g. Opt-out between approval and dispatch: a replay is refused once the trip is opted out.
  tripA = expect(await api.owner(`/api/trips/${tripA.id}`), 200, "read A").trip;
  const optOut = expect(await api.owner(`/api/trips/${tripA.id}/changes`, { method: "POST", body: { requestId: "allowance-opt-out-a", expectedVersion: tripA.version, changes: [{ type: "update_trip", fields: { googlePlacePhotosEnabled: false } }] } }), 200, "opt out A").trip;
  expect(await api.as(manager.cookie, route(tripA.id), { method: "POST", body: { requestId: lostKey, kind: "search" } }), 409, "replay after opt-out", "google_trip_not_enabled");
  tripA = expect(await api.owner(`/api/trips/${tripA.id}/changes`, { method: "POST", body: { requestId: "allowance-opt-in-a", expectedVersion: optOut.version, changes: [{ type: "update_trip", fields: { googlePlacePhotosEnabled: true } }] } }), 200, "opt in A").trip;

  // 5h. Trip backup and restore never roll the ledger back.
  const backup = path.join(temporary, "http-backup.sqlite");
  await snapshotDatabase(path.join(dir, "shared-trip.sqlite"), backup);
  validateSnapshot(backup);
  const backupDb = new DatabaseSync(backup, { readOnly: true });
  try {
    assert.equal(backupDb.prepare("PRAGMA user_version").get().user_version, SCHEMA_VERSION, "the trip schema version is unchanged");
    const tables = backupDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
    assert.ok(!tables.some((name) => ["months", "reservations", "meta"].includes(name)), "trip backups contain no allowance ledger");
  } finally { backupDb.close(); }
  expect(await api.owner(`/api/trips/${tripA.id}/changes`, { method: "POST", body: { requestId: "allowance-after-backup", expectedVersion: tripA.version, changes: [{ type: "update_trip", fields: { title: "Fictional Allowance Trip A (edited after backup)" } }] } }), 200, "edit after backup");
  granted(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), { kind: "search", tripId: tripA.id }, "a reservation after the backup");
  assert.equal(usedNow(dir, clock), 9);
  const ledgerBefore = digest(ledgerFile(dir));
  await stop(runtime);
  const childEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("SHARED_TRIP_")));
  const restored = spawnSync(process.execPath, [RESTORE_CLI, backup], { env: { ...childEnv, SHARED_TRIP_DATA_DIR: dir }, encoding: "utf8" });
  assert.equal(restored.status, 0, `${restored.stdout}\n${restored.stderr}`);
  assert.equal(digest(ledgerFile(dir)), ledgerBefore, "a trip restore leaves the ledger file untouched");
  runtime = await start(dir, { ...ENABLED, ...allowanceEnv(12, 2) }, clock);
  api = client(runtime.url);
  manager.cookie = (await api.signIn(manager)).cookie;
  assert.equal(expect(await api.owner(`/api/trips/${tripA.id}`), 200, "read restored A").trip.title, "Fictional Allowance Trip A", "the trip content was rolled back");
  assert.equal(usedNow(dir, clock), 9, "the high-water count was not rolled back");
  granted(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), { kind: "search", tripId: tripA.id }, "10th of 10");
  expect(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), 429, "limit 10 reached", "google_allowance_exhausted");

  // 5i. Missing and corrupt ledgers: Google work stops, trips keep working, nothing is re-created.
  await stop(runtime);
  const aside = path.join(temporary, "http-ledger-aside.sqlite");
  fs.renameSync(ledgerFile(dir), aside);
  for (const variant of ["missing", "corrupt"]) {
    if (variant === "corrupt") fs.writeFileSync(ledgerFile(dir), crypto.randomBytes(2048));
    const before = variant === "corrupt" ? digest(ledgerFile(dir)) : "";
    runtime = await start(dir, { ...ENABLED, ...allowanceEnv(12, 2) }, clock);
    api = client(runtime.url);
    manager.cookie = (await api.signIn(manager)).cookie;
    const read = expect(await api.as(manager.cookie, `/api/trips/${tripA.id}`), 200, `${variant}: reading works`).trip;
    expect(await api.as(manager.cookie, `/api/trips/${tripA.id}/changes`, { method: "POST", body: { requestId: `allowance-edit-${variant}`, expectedVersion: read.version, changes: [{ type: "update_trip", fields: { title: `Fictional Allowance Trip A (${variant})` } }] } }), 200, `${variant}: editing works`);
    const refused = await reserve(api, manager.cookie, tripA.id, { kind: "search" });
    expect(refused, 503, `${variant}: Google work refused`, "google_allowance_unavailable");
    assert.ok(!refused.text.includes(FAKE_KEY));
    assert.ok(logs.some((message) => message.includes("no Google work will be granted")), "the operator is told at start-up");
    await stop(runtime);
    if (variant === "missing") assert.equal(fs.existsSync(ledgerFile(dir)), false, "a missing ledger is never re-created");
    else { assert.equal(digest(ledgerFile(dir)), before, "a corrupt ledger is left as found"); fs.rmSync(ledgerFile(dir)); }
  }
  fs.renameSync(aside, ledgerFile(dir));

  // 5j. Global flag off, allowance unconfigured, invalid allowance: refused; trips unaffected.
  for (const [label, env, status, code] of [
    ["flag off", { ...allowanceEnv(12, 2), [GOOGLE_PLACES_FLAG_ENV]: "0", [GOOGLE_MAPS_BROWSER_KEY_ENV]: FAKE_KEY }, 503, "google_places_disabled"],
    ["no allowance configured", ENABLED, 503, "google_allowance_unconfigured"],
    ["invalid allowance", { ...ENABLED, ...allowanceEnv(5, 5) }, 503, "google_allowance_unavailable"],
    ["the same ledger back in place (its limit already used)", { ...ENABLED, ...allowanceEnv(12, 2) }, 429, "google_allowance_exhausted"]
  ]) {
    runtime = await start(dir, env, clock);
    api = client(runtime.url);
    manager.cookie = (await api.signIn(manager)).cookie;
    expect(await api.as(manager.cookie, `/api/trips/${tripA.id}`), 200, `${label}: reading works`);
    expect(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), status, label, code);
    await stop(runtime);
  }
  assert.equal(usedNow(dir, clock), 10, "nothing above reset or added to the count");

  // 5k. A clock fault over HTTP: recorded, paused across a restart, trips unaffected, cleared only by
  //     reconcile-clock.
  runtime = await start(dir, { ...ENABLED, ...allowanceEnv(20, 2) }, clock);
  api = client(runtime.url);
  manager.cookie = (await api.signIn(manager)).cookie;
  clock.jumpWall(3 * 3_600_000);
  const jumped = await reserve(api, manager.cookie, tripA.id, { kind: "search" });
  expect(jumped, 503, "in-process clock jump", "google_allowance_clock_uncertain");
  assert.ok(!jumped.text.includes(FAKE_KEY), "a clock denial never carries the key");
  expect(await api.as(manager.cookie, `/api/trips/${tripA.id}`), 200, "clock fault: reading works");
  await stop(runtime);
  logs.length = 0;
  runtime = await start(dir, { ...ENABLED, ...allowanceEnv(20, 2) }, clock);
  assert.ok(logs.some((message) => message.includes("clock_uncertain") && message.includes("no Google work will be granted")), "the operator is told at start-up");
  api = client(runtime.url);
  manager.cookie = (await api.signIn(manager)).cookie;
  expect(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), 503, "the fault survives a restart", "google_allowance_clock_uncertain");
  const editable = expect(await api.as(manager.cookie, `/api/trips/${tripA.id}`), 200, "clock fault: reading works after the restart").trip;
  expect(await api.as(manager.cookie, `/api/trips/${tripA.id}/changes`, { method: "POST", body: { requestId: "allowance-edit-clock-fault", expectedVersion: editable.version, changes: [{ type: "update_trip", fields: { title: "Fictional Allowance Trip A (clock fault)" } }] } }), 200, "clock fault: editing works");
  await stop(runtime);
  assert.equal(usedNow(dir, clock), 10, "a clock fault never changes the count");
  reconcileClock(ledgerFile(dir), { month: "2031-05", baseline: 0, wall: clock.now });
  runtime = await start(dir, { ...ENABLED, ...allowanceEnv(20, 2) }, clock);
  api = client(runtime.url);
  manager.cookie = (await api.signIn(manager)).cookie;
  granted(await reserve(api, manager.cookie, tripA.id, { kind: "search" }), { kind: "search", tripId: tripA.id }, "after reconcile-clock and a restart");
  await stop(runtime);
  assert.equal(usedNow(dir, clock), 11);

  console.log("Google allowance tests passed with fictional data, injected clocks and no external requests: Pacific months versus UTC/local, both DST transitions; explicit non-throwing configuration capped at the 10,000 free cap with positive headroom (10,000 - 1,000 = 9,000; high baselines leave no capacity); offline init/raise/reconcile-clock/status CLI; permissions (viewer details only, editors search/preview, anonymous/pending/revoked/owner-bearer/MCP/cross-origin refused); association and opt-in re-checks; invalid payloads; no trip version change; one allowance across users, tabs and trips; last-unit races over HTTP and across worker-thread connections; durable idempotency across restarts without extension; discarded responses counted with no refund route; month-boundary margins and delayed replays; durable clock faults (in-process jumps, backward and implausible clocks) across restarts and connections until reconcile-clock, no fresh month on a start in an unrecorded month, legitimate in-process rollovers and restarts after them; configuration/key changes and lowering; missing/corrupt/inconsistent/tampered ledgers and missing month/baseline records failing closed without re-creation while trips keep working; trip backup/restore leaving the ledger intact.");
} finally {
  for (const runtime of [...running]) await runtime.close().catch(() => {});
  globalThis.fetch = realFetch;
  fs.rmSync(temporary, { recursive: true, force: true });
}
