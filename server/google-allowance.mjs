// Server-authoritative monthly allowance for the optional Google Places UI Kit.
//
// Every app-controlled, potentially billable Google action in a browser (the first SDK bootstrap
// together with its first component, every Place Details construction, every editor search query,
// every Place ID preview, every explicit retry and every re-instantiation) first needs a one-use
// reservation from POST /api/trips/<id>/google-places/reservations. The count is shared by every
// user, tab and trip of this server and is kept in its own SQLite file,
//   <dataDir>/google-allowance.sqlite
// separate from the trip database, so trip schema v6, trip backups, restores and rollbacks are
// untouched, and restoring a trip snapshot never rolls the counter back.
//
// Nothing is automatic:
//   - No allowance is assumed. SHARED_TRIP_GOOGLE_MONTHLY_ALLOWANCE (the share of the monthly free
//     Query (Essentials) usage that the owner has allocated to this app, at most the verified free
//     cap of 10,000) and SHARED_TRIP_GOOGLE_ALLOWANCE_HEADROOM (a safety margin of at least 1 kept
//     unused) must both be set explicitly. At most allowance - headroom reservations are granted per
//     Pacific month. The gate exists to stop below the free cap; it never authorizes paid usage.
//   - The server never creates the ledger. An operator creates it once, offline, with
//     server/cli/google-allowance.mjs init (explicit month and a conservative baseline). Missing,
//     unreadable, corrupt or inconsistent ledgers (including missing month or baseline records),
//     invalid configuration, unusable time-zone data and an untrustworthy clock all refuse new
//     Google work. Trip reading and editing never depend on this module.
//   - Reservations are never refunded. A permit that was never used, expired, or whose response was
//     lost still counts (conservative), and a durable idempotency key makes a retried transport
//     return the same single-use permit instead of a second one.
//
// Months follow Google's billing reset: the first day of the month at midnight Pacific time
// (America/Los_Angeles, with daylight saving), never UTC or the server's local month. Reservations
// are refused for MONTH_BOUNDARY_MARGIN_MS on both sides of a month boundary, and a permit always
// expires before the next boundary, so clock skew between this server and Google cannot move an
// event into the other month.
//
// Clock faults are durable. An implausible wall clock, a wall clock behind the ledger's newest
// recorded time (or in an earlier month than its latest month record), and an in-process wall-clock
// jump against the monotonic clock are written into the ledger itself (meta clock_fault), so every
// connection and every later start stays paused. Only the operator's explicit
// `reconcile-clock --month <current Pacific month> --baseline <n>` clears a fault; it never lowers a
// count. A new Pacific month is started at zero only by a process that started inside the ledger's
// latest recorded month and has seen its wall clock advance with its monotonic clock since then. A
// process that starts in a later month (downtime across a reset, or a clock that jumped while it
// was stopped) cannot tell those apart and waits for the operator to confirm the month with
// reconcile-clock and a conservative baseline for it.
//
// Limits (also in references/google-places-ui-kit.md): the ledger counts what this app's own code
// asks for. It cannot see or stop use of the browser key outside this app, extra requests the SDK
// makes on its own, or other consumers on the same billing account; an old ledger copy put back in
// place undercounts; and a clock that is consistently wrong from the start cannot be detected
// without an external time source. It is a conservative self-limit, not a provider-enforced cap.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { DomainError, conflict, validationError } from "./domain/errors.mjs";
import { isPlainObject, isValidId } from "./domain/validate.mjs";
import { GOOGLE_PLACE_ASSOCIATION_FIELD, associationMatchesPlan, isGooglePlaceId } from "../assets/app-template/public/google-place-association.js";

export const GOOGLE_MONTHLY_ALLOWANCE_ENV = "SHARED_TRIP_GOOGLE_MONTHLY_ALLOWANCE";
export const GOOGLE_ALLOWANCE_HEADROOM_ENV = "SHARED_TRIP_GOOGLE_ALLOWANCE_HEADROOM";
export const ALLOWANCE_LEDGER_FILE = "google-allowance.sqlite";
export const ALLOWANCE_TIME_ZONE = "America/Los_Angeles";
export const LEDGER_FORMAT = "shared-trip-google-allowance";
// Version 2 adds durable clock-fault and month-record metadata. Version 1 files came only from an
// unreleased draft and are refused (fail closed), never upgraded silently.
export const LEDGER_VERSION = 2;
// Google's free monthly Places UI Kit Query (Essentials) usage per billing account, as verified
// from Google's public pricing on 2026-10-15. The allocated allowance may never exceed it: this
// gate is meant to stop below the free cap, never to authorize paid usage. Recheck before use.
export const VERIFIED_FREE_QUERY_CAP = 10_000;
export const MAX_MONTHLY_ALLOWANCE = VERIFIED_FREE_QUERY_CAP;
// The headroom must be positive: some unseen usage (SDK requests, metering differences) is assumed.
export const MIN_HEADROOM = 1;
// Recorded counts (baselines, raises) may exceed the allowance; they then simply leave no capacity.
export const MAX_LEDGER_COUNT = 9_999_999;
export const CLOCK_FAULTS = Object.freeze(["clock_jump", "clock_backward", "clock_implausible"]);
// A permit is valid for at most this long after the server issued it (and never past the margin
// before the next Pacific month). It covers a first-use SDK load (15 s timeout) plus dispatch.
export const PERMIT_TTL_MS = 45_000;
// A new permit is refused when less than this much validity would remain.
export const MIN_PERMIT_MS = 10_000;
export const MONTH_BOUNDARY_MARGIN_MS = 2 * 60_000;
// The wall clock may not be earlier than the newest time already recorded in the ledger.
export const CLOCK_BACKWARD_TOLERANCE_MS = 1_000;
// While the process runs, the wall clock must advance with the monotonic clock.
export const CLOCK_DRIFT_TOLERANCE_MS = 30_000;
export const MIN_WALL_CLOCK_MS = Date.UTC(2025, 0, 1);
export const MAX_WALL_CLOCK_MS = Date.UTC(2100, 0, 1);
export const RESERVATION_KINDS = Object.freeze(["details", "search", "preview"]);
export const RESERVATION_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
export const PERMIT_ID_PATTERN = /^gpr_[A-Za-z0-9_-]{24}$/;
const LEDGER_ID_PATTERN = /^gal_[0-9a-f]{32}$/;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const COUNT_TEXT = /^(?:0|[1-9]\d{0,6})$/;
const DIGEST = /^[0-9a-f]{64}$/;
// initial_month: the month named at init (the oldest month record). latest_month: the newest month
// record. month_count: the number of month records. Together they let every start-up and every
// transaction notice a missing month or baseline record instead of treating it as a fresh zero.
const META_KEYS = Object.freeze(["format", "version", "basis", "ledger_id", "created_at", "high_water_ms",
  "initial_month", "latest_month", "month_count", "clock_fault", "clock_fault_at"]);
const LEDGER_SCHEMA = [
  "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE months (month TEXT PRIMARY KEY, used INTEGER NOT NULL CHECK (used >= 0), baseline INTEGER NOT NULL CHECK (baseline >= 0), CHECK (used >= baseline))",
  "CREATE TABLE reservations (id TEXT PRIMARY KEY, actor TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('details','search','preview')), trip_id TEXT NOT NULL, month TEXT NOT NULL REFERENCES months(month), issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, UNIQUE (actor, request_id))",
  "CREATE INDEX reservations_month ON reservations(month)"
].join("; ");

// ---------------------------------------------------------------------------------------------
// Configuration (never throws: a bad value disables Google work but never stops the app)

/**
 * { state: "unconfigured" } when neither value is set (the default), { state: "invalid", problem }
 * for anything malformed or only half set, or { state: "configured", allowance, headroom, limit }.
 */
export function readAllowanceConfig(env = process.env) {
  const rawAllowance = env[GOOGLE_MONTHLY_ALLOWANCE_ENV];
  const rawHeadroom = env[GOOGLE_ALLOWANCE_HEADROOM_ENV];
  const isSet = (value) => value !== undefined && value !== "";
  const invalid = (problem) => Object.freeze({ state: "invalid", problem });
  if (!isSet(rawAllowance) && !isSet(rawHeadroom)) return Object.freeze({ state: "unconfigured" });
  if (!isSet(rawAllowance) || !isSet(rawHeadroom)) {
    return invalid(`Set both ${GOOGLE_MONTHLY_ALLOWANCE_ENV} and ${GOOGLE_ALLOWANCE_HEADROOM_ENV} explicitly, or neither.`);
  }
  if (typeof rawAllowance !== "string" || typeof rawHeadroom !== "string" || !COUNT_TEXT.test(rawAllowance) || !COUNT_TEXT.test(rawHeadroom)) {
    return invalid(`${GOOGLE_MONTHLY_ALLOWANCE_ENV} and ${GOOGLE_ALLOWANCE_HEADROOM_ENV} must be whole numbers without signs, spaces or separators.`);
  }
  const allowance = Number(rawAllowance);
  const headroom = Number(rawHeadroom);
  if (allowance < 1 || allowance > MAX_MONTHLY_ALLOWANCE) {
    return invalid(`${GOOGLE_MONTHLY_ALLOWANCE_ENV} must be between 1 and ${MAX_MONTHLY_ALLOWANCE} (the verified free monthly Query (Essentials) cap; this gate never authorizes paid usage).`);
  }
  if (headroom < MIN_HEADROOM) return invalid(`${GOOGLE_ALLOWANCE_HEADROOM_ENV} must be at least ${MIN_HEADROOM}; some usage outside the app's own count is always assumed.`);
  if (headroom >= allowance) return invalid(`${GOOGLE_ALLOWANCE_HEADROOM_ENV} must be smaller than ${GOOGLE_MONTHLY_ALLOWANCE_ENV}.`);
  return Object.freeze({ state: "configured", allowance, headroom, limit: allowance - headroom });
}

// ---------------------------------------------------------------------------------------------
// Pacific billing months

let pacificFormatter = null;
function formatter() {
  pacificFormatter ??= new Intl.DateTimeFormat("en-US", {
    timeZone: ALLOWANCE_TIME_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
  return pacificFormatter;
}

/** Calendar fields of an instant in America/Los_Angeles. Throws on unusable input or ICU data. */
export function pacificParts(ms) {
  if (!Number.isFinite(ms)) throw new Error("Invalid time.");
  const out = {};
  for (const part of formatter().formatToParts(new Date(ms))) if (part.type !== "literal") out[part.type] = Number(part.value);
  for (const key of ["year", "month", "day", "hour", "minute", "second"]) if (!Number.isInteger(out[key])) throw new Error("Unusable time-zone data.");
  return out;
}

const monthKey = (year, month) => `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;

/** "YYYY-MM" of the Pacific billing month containing ms. */
export function pacificMonthOf(ms) {
  const parts = pacificParts(ms);
  return monthKey(parts.year, parts.month);
}

/** The instant of midnight Pacific time on the first day of a month (07:00 or 08:00 UTC). */
export function pacificMonthStart(year, month) {
  // Daylight-saving changes happen at 02:00 local time, never at midnight, so the first midnight of
  // a month is exactly one of these two instants. Anything else means unusable time-zone data.
  const matches = [7, 8].map((hour) => Date.UTC(year, month - 1, 1, hour)).filter((ms) => {
    const parts = pacificParts(ms);
    return parts.year === year && parts.month === month && parts.day === 1 && parts.hour === 0 && parts.minute === 0 && parts.second === 0;
  });
  if (matches.length !== 1) throw new Error("Unusable time-zone data.");
  return matches[0];
}

/** { start, end } (end exclusive) of a "YYYY-MM" Pacific month. */
export function pacificMonthBounds(key) {
  const match = MONTH_PATTERN.exec(String(key));
  if (!match) throw new Error("Invalid month.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  return { start: pacificMonthStart(year, month), end: month === 12 ? pacificMonthStart(year + 1, 1) : pacificMonthStart(year, month + 1) };
}

// Known instants around the 2026 daylight-saving changes (second Sunday of March, first Sunday of
// November, which is also the first day of that month).
const TIME_ZONE_VECTORS = Object.freeze([
  [Date.UTC(2026, 0, 15, 12), 1, 15, 4],
  [Date.UTC(2026, 6, 15, 12), 7, 15, 5],
  [Date.UTC(2026, 2, 8, 9, 59), 3, 8, 1],
  [Date.UTC(2026, 2, 8, 10, 0), 3, 8, 3],
  [Date.UTC(2026, 10, 1, 6, 59), 10, 31, 23],
  [Date.UTC(2026, 10, 1, 8, 59), 11, 1, 1],
  [Date.UTC(2026, 10, 1, 9, 0), 11, 1, 1]
]);

/** True only when the runtime resolves America/Los_Angeles with correct daylight-saving data. */
export function timeZoneSupported() {
  try {
    if (formatter().resolvedOptions().timeZone !== ALLOWANCE_TIME_ZONE) return false;
    return TIME_ZONE_VECTORS.every(([ms, month, day, hour]) => {
      const parts = pacificParts(ms);
      return parts.month === month && parts.day === day && parts.hour === hour;
    }) && pacificMonthStart(2026, 11) === Date.UTC(2026, 10, 1, 7) && pacificMonthStart(2027, 1) === Date.UTC(2027, 0, 1, 8);
  } catch { return false; }
}

const usableWallClock = (wall) => Number.isSafeInteger(wall) && wall >= MIN_WALL_CLOCK_MS && wall < MAX_WALL_CLOCK_MS;

// ---------------------------------------------------------------------------------------------
// Ledger validation, creation and owner adjustments

/**
 * Full consistency check of an open ledger connection. Returns { ledgerId, highWater, createdAt,
 * initialMonth, latestMonth, monthCount, clockFault, clockFaultAt, months: Map<month, {used,
 * baseline}> } or throws an Error naming the problem (never data values).
 */
export function validateLedger(db) {
  if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("The ledger failed SQLite's integrity check.");
  if (db.prepare("PRAGMA user_version").get().user_version !== LEDGER_VERSION) throw new Error("The ledger has an unknown format version.");
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
  for (const table of ["meta", "months", "reservations"]) if (!tables.has(table)) throw new Error("The ledger is missing a table.");
  const meta = readMeta(db);
  checkMonthRecords(db, meta);
  const months = new Map();
  for (const row of db.prepare("SELECT month,used,baseline FROM months").all()) {
    if (!MONTH_PATTERN.test(row.month) || !Number.isSafeInteger(row.used) || !Number.isSafeInteger(row.baseline) || row.baseline < 0 || row.used < row.baseline) {
      throw new Error("The ledger has an invalid month row.");
    }
    months.set(row.month, { used: row.used, baseline: row.baseline });
  }
  const counts = new Map();
  let newest = 0;
  for (const row of db.prepare("SELECT id,actor,request_id,fingerprint,kind,trip_id,month,issued_at,expires_at FROM reservations").all()) {
    if (!PERMIT_ID_PATTERN.test(row.id) || typeof row.actor !== "string" || !row.actor || row.actor.length > 128 ||
      typeof row.request_id !== "string" || !RESERVATION_REQUEST_ID_PATTERN.test(row.request_id) || !DIGEST.test(row.fingerprint) ||
      !RESERVATION_KINDS.includes(row.kind) || !isValidId(row.trip_id) || !months.has(row.month) ||
      !Number.isSafeInteger(row.issued_at) || !Number.isSafeInteger(row.expires_at) || row.expires_at < row.issued_at) {
      throw new Error("The ledger has an invalid reservation row.");
    }
    counts.set(row.month, (counts.get(row.month) || 0) + 1);
    newest = Math.max(newest, row.issued_at);
  }
  for (const [month, row] of months) {
    if (row.used !== row.baseline + (counts.get(month) || 0)) throw new Error("The ledger's monthly totals do not match its reservations.");
  }
  if (meta.highWater < newest) throw new Error("The ledger's recorded clock is older than its newest reservation.");
  return { ...meta, months };
}

const isMillis = (value) => /^\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value));

function readMeta(db) {
  const rows = db.prepare("SELECT key,value FROM meta").all();
  const meta = new Map(rows.map((row) => [row.key, row.value]));
  if (rows.length !== META_KEYS.length || !META_KEYS.every((key) => typeof meta.get(key) === "string")) throw new Error("The ledger metadata is incomplete.");
  const initialMonth = meta.get("initial_month");
  const latestMonth = meta.get("latest_month");
  const fault = meta.get("clock_fault");
  const faultAt = meta.get("clock_fault_at");
  if (meta.get("format") !== LEDGER_FORMAT || meta.get("version") !== String(LEDGER_VERSION) || meta.get("basis") !== ALLOWANCE_TIME_ZONE ||
    !LEDGER_ID_PATTERN.test(meta.get("ledger_id")) || !Number.isFinite(Date.parse(meta.get("created_at"))) || !isMillis(meta.get("high_water_ms")) ||
    !MONTH_PATTERN.test(initialMonth) || !MONTH_PATTERN.test(latestMonth) || latestMonth < initialMonth || !/^[1-9]\d{0,5}$/.test(meta.get("month_count")) ||
    !(fault === "" ? faultAt === "" : CLOCK_FAULTS.includes(fault) && isMillis(faultAt))) {
    throw new Error("The ledger metadata is invalid.");
  }
  return {
    ledgerId: meta.get("ledger_id"), createdAt: meta.get("created_at"), highWater: Number(meta.get("high_water_ms")),
    initialMonth, latestMonth, monthCount: Number(meta.get("month_count")), clockFault: fault, clockFaultAt: fault ? Number(faultAt) : null
  };
}

// The month records must be exactly those the metadata promises: never an empty table, never a
// missing initial or latest month, never fewer rows than were created. Run at start-up (inside
// validateLedger) and inside every reservation and operator transaction, before any new month could
// be created, so a lost baseline record can never be mistaken for a fresh month at zero.
function checkMonthRecords(db, meta) {
  const row = db.prepare("SELECT COUNT(*) AS n, MIN(month) AS first, MAX(month) AS last FROM months").get();
  if (row.n !== meta.monthCount || row.first !== meta.initialMonth || row.last !== meta.latestMonth) {
    throw new Error("The ledger is missing month records: its initial, latest or monthly baseline rows do not match its metadata.");
  }
}

const setMeta = (db, key, value) => {
  if (db.prepare("UPDATE meta SET value=? WHERE key=?").run(value, key).changes !== 1) throw new Error("The ledger metadata is incomplete.");
};

// Records the first clock fault (a later one never overwrites it). Never moves the high-water mark:
// the faulty wall time is kept only as information.
function persistClockFault(db, fault, wall) {
  db.prepare("UPDATE meta SET value=? WHERE key='clock_fault_at' AND (SELECT value FROM meta WHERE key='clock_fault')=''")
    .run(String(usableWallClock(wall) ? wall : 0));
  db.prepare("UPDATE meta SET value=? WHERE key='clock_fault' AND value=''").run(fault);
}

function checkOperatorInputs({ month, wall, amount, name }) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_LEDGER_COUNT) throw new Error(`${name} must be a whole number between 0 and ${MAX_LEDGER_COUNT}.`);
  if (!usableWallClock(wall)) throw new Error("The system clock is outside the supported range; fix it first.");
  if (!timeZoneSupported()) throw new Error("This runtime lacks usable America/Los_Angeles time-zone data.");
  const current = pacificMonthOf(wall);
  if (month !== current) throw new Error(`The current Pacific billing month is ${current} on this system clock. Pass --month ${current} to confirm it, or fix the clock.`);
  return current;
}

// One validated operator write. The clock may not be behind the ledger; counts only ever rise.
function operatorWrite(file, wall, change) {
  if (!fs.existsSync(file)) throw new Error("No Google allowance ledger exists; create one with init.");
  const db = new DatabaseSync(file);
  let result;
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL");
    validateLedger(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      const meta = readMeta(db);
      checkMonthRecords(db, meta);
      if (wall < meta.highWater - CLOCK_BACKWARD_TOLERANCE_MS) {
        throw new Error(`The system clock is earlier than the ledger's newest recorded time (${new Date(meta.highWater).toISOString()}); fix the clock first. Counts are never lowered.`);
      }
      result = change(db, meta);
      setMeta(db, "high_water_ms", String(Math.max(meta.highWater, wall)));
      db.exec("COMMIT");
    } catch (error) { try { db.exec("ROLLBACK"); } catch { /* nothing to roll back */ } throw error; }
  } finally { db.close(); }
  return result;
}

/**
 * Creates a new ledger at file. Refuses when anything already exists there (an existing ledger is
 * never replaced or reset). baseline is the owner's conservative count of Query events this app
 * may already have used in the current Pacific month (0 only when that is known).
 */
export function initLedger(file, { baseline, month, wall = Date.now() } = {}) {
  const current = checkOperatorInputs({ month, wall, amount: baseline, name: "--baseline" });
  if (fs.existsSync(file)) throw new Error("A Google allowance ledger already exists. It is never replaced or reset; use status or raise.");
  const temporary = `${file}.init-${process.pid}-${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    const db = new DatabaseSync(temporary);
    try {
      db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON");
      db.exec("BEGIN IMMEDIATE");
      db.exec(LEDGER_SCHEMA);
      const meta = db.prepare("INSERT INTO meta (key,value) VALUES (?,?)");
      meta.run("format", LEDGER_FORMAT);
      meta.run("version", String(LEDGER_VERSION));
      meta.run("basis", ALLOWANCE_TIME_ZONE);
      meta.run("ledger_id", "gal_" + crypto.randomBytes(16).toString("hex"));
      meta.run("created_at", new Date(wall).toISOString());
      meta.run("high_water_ms", String(wall));
      meta.run("initial_month", current);
      meta.run("latest_month", current);
      meta.run("month_count", "1");
      meta.run("clock_fault", "");
      meta.run("clock_fault_at", "");
      db.prepare("INSERT INTO months (month,used,baseline) VALUES (?,?,?)").run(current, baseline, baseline);
      db.exec(`PRAGMA user_version=${LEDGER_VERSION}`);
      db.exec("COMMIT");
    } finally { db.close(); }
    fs.chmodSync(temporary, 0o600);
    const check = new DatabaseSync(temporary, { readOnly: true });
    try { validateLedger(check); } finally { check.close(); }
    // A hard link never overwrites: it fails if another ledger appeared in the meantime.
    fs.linkSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  return ledgerStatus(file, { wall });
}

const laterMonthError = (latest) => new Error(`The ledger already records a later Pacific month (${latest}) than this system clock; fix the clock first. Counts are never lowered.`);

/**
 * Raises the current Pacific month's count by add (for example after the owner sees higher usage
 * in the provider console). There is deliberately no way to lower a count. The month must already
 * be the ledger's latest month record; a month without a record is confirmed with reconcileClock.
 * Raising never clears a recorded clock fault.
 */
export function raiseLedger(file, { add, month, wall = Date.now() } = {}) {
  const current = checkOperatorInputs({ month, wall, amount: add, name: "--add" });
  if (add < 1) throw new Error("--add must be at least 1.");
  operatorWrite(file, wall, (db, meta) => {
    if (current < meta.latestMonth) throw laterMonthError(meta.latestMonth);
    if (current > meta.latestMonth) {
      throw new Error(`The ledger has no record for ${current} yet. Confirm the month and its usage so far with reconcile-clock --month ${current} --baseline <n> instead.`);
    }
    if (db.prepare("UPDATE months SET used=used+?, baseline=baseline+? WHERE month=?").run(add, add, current).changes !== 1) throw new Error("The ledger is missing this month's record.");
  });
  return ledgerStatus(file, { wall });
}

/**
 * The operator's explicit clock and month confirmation. Run it with a trustworthy clock (time sync
 * checked) after a recorded clock fault or after a start in a Pacific month that the ledger has no
 * record of yet. It:
 *   - requires month to be the current Pacific month on this clock and the clock not to be behind
 *     the ledger's newest recorded time (or in an earlier month than its latest month record);
 *   - for a month the ledger already records, keeps the higher of its own count and baseline (the
 *     owner's conservative count of Query (Essentials) events used so far this month), so nothing
 *     is ever lowered or credited back;
 *   - for a later month without a record, creates it with that baseline (never assumed to be zero);
 *   - clears the recorded clock fault. Restart the app afterwards; a running process stays paused.
 * Returns ledgerStatus() plus clearedFault (the fault that was cleared, or "").
 */
export function reconcileClock(file, { baseline, month, wall = Date.now() } = {}) {
  const current = checkOperatorInputs({ month, wall, amount: baseline, name: "--baseline" });
  const clearedFault = operatorWrite(file, wall, (db, meta) => {
    if (current < meta.latestMonth) throw laterMonthError(meta.latestMonth);
    if (current === meta.latestMonth) {
      const row = db.prepare("SELECT used FROM months WHERE month=?").get(current);
      if (!row) throw new Error("The ledger is missing this month's record.");
      const extra = Math.max(0, baseline - row.used);
      if (extra > 0) db.prepare("UPDATE months SET used=used+?, baseline=baseline+? WHERE month=?").run(extra, extra, current);
    } else {
      db.prepare("INSERT INTO months (month,used,baseline) VALUES (?,?,?)").run(current, baseline, baseline);
      setMeta(db, "latest_month", current);
      setMeta(db, "month_count", String(meta.monthCount + 1));
    }
    setMeta(db, "clock_fault", "");
    setMeta(db, "clock_fault_at", "");
    return meta.clockFault;
  });
  return { ...ledgerStatus(file, { wall }), clearedFault };
}

/** Read-only summary for the operator CLI. Never changes or creates the file. */
export function ledgerStatus(file, { wall = Date.now(), config = null } = {}) {
  const status = { exists: fs.existsSync(file), valid: false, problem: "", notice: "" };
  let month = "";
  try { if (usableWallClock(wall) && timeZoneSupported()) month = pacificMonthOf(wall); } catch { month = ""; }
  status.month = month;
  if (config?.state === "configured") Object.assign(status, { allowance: config.allowance, headroom: config.headroom, limit: config.limit });
  else if (config) status.configuration = config.state;
  if (!status.exists) { status.problem = "missing"; return status; }
  try {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=5000");
      const ledger = validateLedger(db);
      status.valid = true;
      status.ledgerId = ledger.ledgerId;
      status.latestMonth = ledger.latestMonth;
      status.newestRecordedTime = new Date(ledger.highWater).toISOString();
      status.clockFault = ledger.clockFault;
      status.clockFaultAt = ledger.clockFault && ledger.clockFaultAt ? new Date(ledger.clockFaultAt).toISOString() : "";
      const row = month ? ledger.months.get(month) : undefined;
      status.used = row ? row.used : null;
      if (config?.state === "configured" && row) status.remaining = Math.max(0, config.limit - row.used);
      if (ledger.clockFault) status.problem = `a clock fault (${ledger.clockFault}) is recorded; Google work stays paused until an operator runs reconcile-clock with a trustworthy clock`;
      else if (!month) status.problem = "the system clock or time-zone data is unusable";
      else if (ledger.highWater > wall + CLOCK_BACKWARD_TOLERANCE_MS) status.problem = "clock is earlier than the ledger's newest recorded time";
      else if (month < ledger.latestMonth) status.problem = "the ledger records a later month than this clock";
      else if (month > ledger.latestMonth) {
        status.notice = `${month} has no ledger record yet. A server that has run continuously since ${ledger.latestMonth} starts it at zero with its first reservation; ` +
          `a server started in ${month} waits until an operator confirms it with reconcile-clock --month ${month} --baseline <n>.`;
      }
    } finally { db.close(); }
  } catch (error) { status.problem = error.message; }
  return status;
}

// ---------------------------------------------------------------------------------------------
// Request body and trip checks for the reservation route

/** { requestId, kind, planId?, placeId? } -> normalized input, or a 422 validation error. */
export function parseReservationBody(body) {
  if (!isPlainObject(body)) throw validationError("The request body must be a JSON object.");
  const unknown = Object.keys(body).filter((key) => !["requestId", "kind", "planId", "placeId"].includes(key));
  if (unknown.length) throw validationError(unknown.slice(0, 10).map((key) => ({ path: `body.${key}`, message: "field is not allowed" })));
  if (typeof body.requestId !== "string" || !RESERVATION_REQUEST_ID_PATTERN.test(body.requestId)) {
    throw validationError([{ path: "body.requestId", message: "must be 16-128 letters, digits, '-' or '_'" }]);
  }
  if (!RESERVATION_KINDS.includes(body.kind)) throw validationError([{ path: "body.kind", message: `must be one of ${RESERVATION_KINDS.join(", ")}` }]);
  const problems = [];
  if (body.kind === "details") {
    if (!isValidId(body.planId)) problems.push({ path: "body.planId", message: "must be the ID of a plan in this trip" });
  } else if (body.planId !== undefined) problems.push({ path: "body.planId", message: "is only allowed for details" });
  if (body.kind === "search") {
    if (body.placeId !== undefined) problems.push({ path: "body.placeId", message: "is not allowed for search; the query is never sent to this server" });
  } else if (!isGooglePlaceId(body.placeId)) problems.push({ path: "body.placeId", message: "must be a Google Place ID" });
  if (problems.length) throw validationError(problems);
  return { requestId: body.requestId, kind: body.kind, planId: body.planId ?? "", placeId: body.placeId ?? "" };
}

/** True when planId is a plan of trip whose saved association is current and names placeId. */
export function planHasCurrentAssociation(trip, planId, placeId) {
  for (const day of Array.isArray(trip?.days) ? trip.days : []) {
    for (const plan of Array.isArray(day?.slots) ? day.slots : []) {
      if (plan?.id === planId) return associationMatchesPlan(plan) && plan[GOOGLE_PLACE_ASSOCIATION_FIELD]?.placeId === placeId;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Errors (generic messages: no paths, counts or configuration values)

const unconfigured = () => new DomainError("google_allowance_unconfigured", 503, "Google place features have no monthly allowance on this server.");
const unavailable = () => new DomainError("google_allowance_unavailable", 503, "Google place features are paused on this server.");
const clockUncertain = () => new DomainError("google_allowance_clock_uncertain", 503, "Google place features are paused until the server clock is trustworthy.");
const monthBoundary = () => new DomainError("google_allowance_month_boundary", 503, "Google place features pause briefly around the monthly reset. Try again in a few minutes.");
const exhausted = () => new DomainError("google_allowance_exhausted", 429, "Google place features have reached this site's limit for this month.");

// ---------------------------------------------------------------------------------------------
// Service

export class GoogleAllowance {
  /**
   * dataDir: the server's data directory. config: readAllowanceConfig() output. clock: optional,
   * code-only test hook { wall(): ms, monotonic(): ms } (never read from the environment).
   */
  constructor({ dataDir, config, clock } = {}) {
    this.file = path.join(dataDir, ALLOWANCE_LEDGER_FILE);
    this.config = config?.state ? config : Object.freeze({ state: "unconfigured" });
    this.wallClock = typeof clock?.wall === "function" ? clock.wall : Date.now;
    this.monotonicClock = typeof clock?.monotonic === "function" ? clock.monotonic : () => performance.now();
    this.db = null;
    this.identity = null;
    this.clockFault = "";
    this.anchor = null;
    this.state = this.config.state === "configured" ? "starting" : this.config.state;
    this.reason = this.config.state === "invalid" ? this.config.problem : "";
    // Unconfigured or invalid: the ledger is never opened, read or written; the app runs normally.
    if (this.state !== "starting") return;
    if (!timeZoneSupported()) { this.fail("This runtime lacks usable America/Los_Angeles time-zone data."); return; }
    this.open();
    // Anchors the in-process clock check. A clock problem pauses Google work (and is recorded in the
    // ledger); it never stops the server from starting.
    if (this.state === "ready") this.startupClockCheck();
  }

  /**
   * Non-secret summary for start-up logs and tests. state: unconfigured | invalid | missing |
   * unavailable | clock_uncertain (a recorded clock fault) | month_unconfirmed (started in a Pacific
   * month without a ledger record) | ready | closed.
   */
  status() { return { state: this.state, reason: this.reason, clockFault: this.clockFault }; }

  readClocks() {
    let wall = Number.NaN;
    let monotonic = Number.NaN;
    try { wall = this.wallClock(); } catch { /* implausible */ }
    try { monotonic = this.monotonicClock(); } catch { /* implausible */ }
    return { wall, monotonic };
  }

  // "" when the clock is trustworthy for this ledger, otherwise the fault to record. month() is only
  // called for a plausible wall clock; unusable time-zone data throws (unavailable, not a fault).
  clockFaultFor(wall, monotonic, meta) {
    if (!usableWallClock(wall) || !Number.isFinite(monotonic)) return "clock_implausible";
    if (this.anchor) {
      const elapsed = monotonic - this.anchor.monotonic;
      if (elapsed < 0 || Math.abs(wall - (this.anchor.wall + elapsed)) > CLOCK_DRIFT_TOLERANCE_MS) return "clock_jump";
    }
    if (wall < meta.highWater - CLOCK_BACKWARD_TOLERANCE_MS || pacificMonthOf(wall) < meta.latestMonth) return "clock_backward";
    return "";
  }

  pauseForClock(fault) {
    this.state = "clock_uncertain";
    this.clockFault = fault;
    this.reason = `A clock fault (${fault}) is recorded in the ledger. An operator must check time sync and run server/cli/google-allowance.mjs reconcile-clock, then restart the app.`;
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }

  startupClockCheck() {
    let meta;
    let month;
    let fault;
    const { wall, monotonic } = this.readClocks();
    try {
      meta = readMeta(this.db);
      if (meta.clockFault) { this.pauseForClock(meta.clockFault); return; }
      fault = this.clockFaultFor(wall, monotonic, meta);
      if (!fault) month = pacificMonthOf(wall);
    } catch (error) { this.fail(error?.message || "The ledger cannot be read."); return; }
    if (fault) {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        try { persistClockFault(this.db, fault, wall); this.db.exec("COMMIT"); }
        catch (error) { try { this.db.exec("ROLLBACK"); } catch { /* ignore */ } throw error; }
      } catch (error) { this.fail(error?.message || "The ledger cannot record a clock fault."); return; }
      this.pauseForClock(fault);
      return;
    }
    this.anchor = { wall, monotonic };
    if (month > meta.latestMonth) {
      // Downtime across a reset and a clock that jumped forward while the app was stopped look the
      // same from here. Nothing is written; an operator confirms the month (and its usage so far).
      this.state = "month_unconfirmed";
      this.reason = `This server started in ${month}, which has no ledger record, and did not run continuously since ${meta.latestMonth}. ` +
        `An operator must confirm the month with server/cli/google-allowance.mjs reconcile-clock --month ${month} --baseline <n>, then restart the app.`;
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  fail(reason) {
    this.state = "unavailable";
    this.reason = reason;
    try { this.db?.close(); } catch { /* already closed */ }
    this.db = null;
  }

  open() {
    let before;
    try { before = fs.lstatSync(this.file); }
    catch (error) {
      if (error?.code === "ENOENT") { this.state = "missing"; this.reason = "No ledger exists; an operator must create one with server/cli/google-allowance.mjs init."; }
      else this.fail("The ledger cannot be inspected.");
      return;
    }
    if (!before.isFile()) { this.fail("The ledger path is not a regular file."); return; }
    let db = null;
    try {
      // Read-write so that SQLite can roll back a transaction interrupted by a crash. The file was
      // seen to exist just before; the identity check below catches a replacement in between.
      db = new DatabaseSync(this.file);
      const after = fs.statSync(this.file);
      if (after.ino !== before.ino || after.dev !== before.dev) throw new Error("The ledger file changed while it was opened.");
      db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL");
      // Validate one SQLite snapshot while other processes may commit reservations.
      db.exec("BEGIN");
      try { validateLedger(db); db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
      this.db = db;
      this.identity = { ino: after.ino, dev: after.dev };
      this.state = "ready";
      this.reason = "";
    } catch (error) {
      try { db?.close(); } catch { /* ignore */ }
      this.fail(error?.message || "The ledger cannot be opened.");
    }
  }

  close() {
    try { this.db?.close(); } catch { /* ignore */ }
    this.db = null;
    if (this.state === "ready") this.state = "closed";
  }

  requireReady() {
    if (this.state === "ready" && this.db) return;
    if (this.state === "unconfigured") throw unconfigured();
    if (this.state === "clock_uncertain" || this.state === "month_unconfirmed") throw clockUncertain();
    throw unavailable();
  }

  checkIdentity() {
    let now;
    try { now = fs.statSync(this.file); } catch { now = null; }
    if (!now || now.ino !== this.identity.ino || now.dev !== this.identity.dev) { this.fail("The ledger file disappeared or was replaced while the server was running."); throw unavailable(); }
  }

  /**
   * One atomic reservation. input: { actor, requestId, kind, tripId, planId, placeId }. Returns
   * { granted: true, replayed, permit: { id, kind, tripId, placeId, month, validForMs } } or throws
   * a DomainError. Repeating the same actor + requestId with the same input returns the same permit
   * (with its remaining validity) and never counts twice; different input is a 409.
   */
  reserve({ actor, requestId, kind, tripId, planId = "", placeId = "" }) {
    this.requireReady();
    this.checkIdentity();
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify([kind, tripId, planId, placeId])).digest("hex");
    const db = this.db;
    let open = false;
    let pause = "";
    const rollback = () => { if (open) { open = false; try { db.exec("ROLLBACK"); } catch { /* the connection is failed below */ } } };
    try {
      db.exec("BEGIN IMMEDIATE");
      open = true;
      // Accounting state first: complete metadata, every promised month record, no recorded fault
      // (possibly recorded by another connection or by an earlier run).
      const meta = readMeta(db);
      checkMonthRecords(db, meta);
      if (meta.clockFault) { rollback(); pause = meta.clockFault; throw clockUncertain(); }
      // The clock is read while holding the write lock, so another connection's newer high-water
      // mark can never look like a backward clock here.
      const { wall, monotonic } = this.readClocks();
      const fault = this.clockFaultFor(wall, monotonic, meta);
      if (fault) {
        persistClockFault(db, fault, wall);
        db.exec("COMMIT");
        open = false;
        pause = fault;
        throw clockUncertain();
      }
      this.anchor = { wall, monotonic };
      const month = pacificMonthOf(wall);
      const bounds = pacificMonthBounds(month);
      if (wall < bounds.start || wall >= bounds.end) throw new Error("Unusable time-zone data.");
      const prior = db.prepare("SELECT id,fingerprint,month,expires_at FROM reservations WHERE actor=? AND request_id=?").get(actor, requestId);
      if (prior) {
        rollback();
        if (prior.fingerprint !== fingerprint) throw conflict("request_id_conflict", "This request identifier was already used for different input.");
        // A replay never extends a permit, never carries it into another month and never counts again.
        const validForMs = prior.month === month ? Math.max(0, prior.expires_at - wall) : 0;
        return { granted: true, replayed: true, permit: { id: prior.id, kind, tripId, placeId: placeId || null, month: prior.month, validForMs } };
      }
      const notBefore = bounds.start + MONTH_BOUNDARY_MARGIN_MS;
      const notAfter = bounds.end - MONTH_BOUNDARY_MARGIN_MS;
      if (wall < notBefore || notAfter - wall < MIN_PERMIT_MS) { rollback(); throw monthBoundary(); }
      if (month > meta.latestMonth) {
        // A legitimate in-process rollover: this process is "ready" only because it started inside
        // the latest recorded month, and every observation since then has advanced with the
        // monotonic clock. The month records were just checked, so this is a genuinely new month
        // after every recorded one, never a lost record being re-created at zero.
        db.prepare("INSERT INTO months (month,used,baseline) VALUES (?,0,0)").run(month);
        setMeta(db, "latest_month", month);
        setMeta(db, "month_count", String(meta.monthCount + 1));
      }
      const row = db.prepare("SELECT used,baseline FROM months WHERE month=?").get(month);
      if (!row) throw new Error("The ledger is missing this month's record.");
      const counted = db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE month=?").get(month).n;
      if (row.used !== row.baseline + counted) throw new Error("The ledger's monthly total does not match its reservations.");
      if (row.used >= this.config.limit) { rollback(); throw exhausted(); }
      const id = "gpr_" + crypto.randomBytes(18).toString("base64url");
      const expiresAt = Math.min(wall + PERMIT_TTL_MS, notAfter);
      db.prepare("INSERT INTO reservations (id,actor,request_id,fingerprint,kind,trip_id,month,issued_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(id, actor, requestId, fingerprint, kind, tripId, month, wall, expiresAt);
      if (db.prepare("UPDATE months SET used=used+1 WHERE month=? AND used=?").run(month, row.used).changes !== 1) throw new Error("The ledger changed during a reservation.");
      db.prepare("UPDATE meta SET value=? WHERE key='high_water_ms'").run(String(Math.max(meta.highWater, wall)));
      db.exec("COMMIT");
      open = false;
      return { granted: true, replayed: false, permit: { id, kind, tripId, placeId: placeId || null, month, validForMs: expiresAt - wall } };
    } catch (error) {
      rollback();
      if (pause) this.pauseForClock(pause);
      if (error instanceof DomainError) throw error;
      // Unknown accounting state (I/O error, corruption, concurrent tampering): stop granting.
      this.fail(error?.message || "The ledger failed.");
      throw unavailable();
    }
  }
}
