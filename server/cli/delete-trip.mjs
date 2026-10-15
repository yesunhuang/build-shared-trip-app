// Offline, host-operator permanent deletion of one trip (schema v6).
//
//   SHARED_TRIP_DATA_DIR=<outside-checkout> npm run delete-trip -- <trip-id> <expected-version> <request-id> <new-backup-file>
//
// For an authorized host operator who should not handle the owner's admin secret. It reads only
// SHARED_TRIP_DATA_DIR (never SHARED_TRIP_ADMIN_TOKEN or any other credential setting or file) and:
//   1. validates the arguments, without touching any file;
//   2. takes data-directory ownership with acquireDataLock, so it refuses while the service, a
//      restore or another maintenance command runs, and changes nothing in that case;
//   3. writes a new private snapshot to <new-backup-file> (which must not exist) with the online
//      backup API and validates it; no routine mutation happens unless this succeeds;
//   4. opens the database (applying any pending schema migration with its own validated snapshot)
//      and calls the same ContentGateway.deleteTrip / TripService.deleteTrip used by
//      DELETE /api/trips/<id>, as the owner principal on the audit channel "operator" (actor
//      "operator"). Exact expectedVersion matching, atomic tombstone/redaction/audit and durable
//      request-ID replay are therefore identical to the web path. Re-running the identical
//      trip/version/request ID (with another new backup file) after an interruption or restart
//      reports the earlier deletion without changing anything;
//   5. releases the database and ownership in every case.
// Output is a fixed message: never trip content or titles, paths, environment values or secrets.
// It generates no credentials. Shared photos and earlier backups are never touched.
import fs from "node:fs";
import path from "node:path";
import { openDatabase, snapshotDatabase, validateSnapshot } from "../db.mjs";
import { acquireDataLock } from "../data-lock.mjs";
import { TripService } from "../domain/service.mjs";
import { isValidId } from "../domain/validate.mjs";
import { DomainError } from "../domain/errors.mjs";
import { AuditLog } from "../audit.mjs";
import { ContentGateway } from "../content-access.mjs";
import { OPERATOR, OWNER } from "../auth/policy.mjs";

const USAGE = "Usage: SHARED_TRIP_DATA_DIR=<outside-checkout> npm run delete-trip -- <trip-id> <expected-version> <request-id> <new-backup-file>";
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const VERSION = /^[1-9][0-9]{0,15}$/;
const DATABASE_FILE = "shared-trip.sqlite";

class Refusal extends Error {
  constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; }
}

const insideCheckout = (target, repo) => target === repo || target.startsWith(repo + path.sep);
function realTarget(file) {
  // Resolve symbolic links in the deepest existing ancestor so the checkout test cannot be bypassed.
  let parent = path.dirname(file); const rest = [path.basename(file)];
  while (!fs.existsSync(parent)) { rest.unshift(path.basename(parent)); const up = path.dirname(parent); if (up === parent) break; parent = up; }
  return path.join(fs.existsSync(parent) ? fs.realpathSync(parent) : parent, ...rest);
}

function domainMessage(error) {
  switch (error.code) {
    case "version_conflict": {
      const current = Number.isSafeInteger(error.extra?.currentVersion) ? " (current version " + error.extra.currentVersion + ")" : "";
      return "Refused: the expected version does not match the trip" + current + ". Read the trip again; no trip was deleted.";
    }
    case "trip_not_found": return "Refused: no trip has that ID. No trip was deleted.";
    case "trip_deleted": return "Refused: that trip was already deleted by a different request. Nothing changed.";
    case "request_id_conflict": return "Refused: this request ID was already used for a different deletion. Use a new request ID; nothing changed.";
    case "validation_failed": return "Refused: invalid arguments. " + USAGE;
    default: return /^[a-z][a-z_]{0,47}$/.test(String(error.code)) ? "Refused (" + error.code + "). No trip was deleted." : "Refused. No trip was deleted.";
  }
}

let lock = null; let db = null;
try {
  const args = process.argv.slice(2);
  if (args.length !== 4) throw new Refusal(USAGE, 2);
  const [tripId, versionText, requestId, backupArgument] = args;
  if (!isValidId(tripId) || !VERSION.test(versionText) || !Number.isSafeInteger(Number(versionText)) || !REQUEST_ID.test(requestId) || !backupArgument) throw new Refusal("Refused: invalid arguments. " + USAGE, 2);
  const expectedVersion = Number(versionText);

  const configured = process.env.SHARED_TRIP_DATA_DIR;
  if (!configured) throw new Refusal("Set SHARED_TRIP_DATA_DIR to the existing data directory. " + USAGE, 2);
  const repo = fs.realpathSync(path.resolve(import.meta.dirname, "..", ".."));
  let dataDir;
  try { dataDir = fs.realpathSync(path.resolve(configured)); } catch { throw new Refusal("Refused: the data directory does not exist. Nothing was changed."); }
  if (!fs.statSync(dataDir).isDirectory()) throw new Refusal("Refused: the data directory is not a directory. Nothing was changed.");
  if (insideCheckout(dataDir, repo)) throw new Refusal("Refused: the data directory must be outside the checkout. Nothing was changed.");
  const databaseFile = path.join(dataDir, DATABASE_FILE);
  const backupFile = realTarget(path.resolve(backupArgument));
  if (insideCheckout(backupFile, repo) || insideCheckout(path.resolve(backupArgument), repo)) throw new Refusal("Refused: the backup file must be outside the checkout. Nothing was changed.");
  if (fs.existsSync(backupFile)) throw new Refusal("Refused: the backup file already exists; choose a new file. Nothing was changed.");

  try { lock = acquireDataLock(dataDir); }
  catch (error) {
    if (error?.code === "data_lock_held") throw new Refusal("Refused: the data directory is in use by a running service, restore or other maintenance command (or has an unrecognized lock marker). Stop it and retry; nothing was changed.");
    throw new Refusal("Refused: could not take data-directory ownership. Nothing was changed.");
  }
  if (!fs.existsSync(databaseFile)) throw new Refusal("Refused: the data directory has no trip database. Nothing was changed.");

  try { await snapshotDatabase(databaseFile, backupFile); validateSnapshot(backupFile); }
  catch { throw new Refusal("Refused: the backup could not be written and validated. No trip was deleted."); }

  try { db = openDatabase(databaseFile); }
  catch { throw new Refusal("Refused: the database could not be opened or migrated. No trip was deleted; the validated backup is retained."); }
  const audit = new AuditLog(db);
  let outcome = null;
  // Same audit storage; the wrapper only observes whether the gateway recorded a new deletion or a replay.
  const observed = { record: (event) => { audit.record(event); outcome = event.outcome; }, safeRecord: (event) => audit.safeRecord(event) };
  const gateway = new ContentGateway(new TripService(db), observed);
  let result;
  try { result = gateway.deleteTrip({ principal: { role: OWNER, via: OPERATOR }, channel: OPERATOR }, { tripId, requestId, expectedVersion }); }
  catch (error) {
    if (error instanceof DomainError) throw new Refusal(domainMessage(error));
    throw new Refusal("Deletion failed and was rolled back. No trip was deleted; the validated backup is retained.");
  }
  if (result?.deleted !== true || result.tripId !== tripId) throw new Refusal("Deletion returned an unexpected result. Check the trip list before retrying.");
  console.log(outcome === "replayed"
    ? "Already deleted by this request ID; nothing changed. A new validated backup was written."
    : "Trip deleted permanently (deleted version " + result.version + "). A validated pre-deletion backup was written first.");
} catch (error) {
  console.error(error instanceof Refusal ? error.message : "Unexpected failure. No further changes were made.");
  process.exitCode = error instanceof Refusal ? error.exitCode : 1;
} finally {
  try { db?.close(); }
  catch { console.error("Could not close the database cleanly."); process.exitCode = 1; }
  try { lock?.release(); }
  catch { console.error("Could not release data-directory ownership; it is released when this process exits."); process.exitCode = 1; }
}
