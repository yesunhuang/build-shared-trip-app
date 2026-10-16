// Offline operator-only, one-field trip maintenance. No credentials or provider calls.
// Uses the service/restore ownership lock, a mandatory fresh backup, the shared gateway,
// transaction, version checks, durable retry record and payload-free operator audit.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, snapshotDatabase, SCHEMA_VERSION } from "../db.mjs";
import { acquireDataLock } from "../data-lock.mjs";
import { TripService } from "../domain/service.mjs";
import { isValidId } from "../domain/validate.mjs";
import { DomainError } from "../domain/errors.mjs";
import { ContentGateway } from "../content-access.mjs";
import { AuditLog } from "../audit.mjs";
import { OWNER, OPERATOR } from "../auth/policy.mjs";

const USAGE = "Usage: SHARED_TRIP_DATA_DIR=<outside-checkout> node server/cli/set-trip-google-photos.mjs <trip-id> <expected-version> <true|false> <request-id> <new-backup-file>";
const inside = (file, root) => file === root || file.startsWith(root + path.sep);
function realTarget(file) {
  let parent = path.dirname(file); const rest = [path.basename(file)];
  while (!fs.existsSync(parent)) { rest.unshift(path.basename(parent)); const next = path.dirname(parent); if (next === parent) break; parent = next; }
  return path.join(fs.existsSync(parent) ? fs.realpathSync(parent) : parent, ...rest);
}
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
const contentOnly = ({ googlePlacePhotosEnabled, version, updatedAt, ...trip }) => JSON.stringify(ordered(trip));
class Refusal extends Error { constructor(message, exitCode = 1) { super(message); this.exitCode = exitCode; } }
let lock; let db;
try {
  const [tripId, versionText, valueText, requestId, backupArgument, ...extra] = process.argv.slice(2);
  if (extra.length || !isValidId(tripId) || !/^[1-9][0-9]{0,15}$/.test(versionText || "") || !Number.isSafeInteger(Number(versionText))
    || !["true", "false"].includes(valueText) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId || "") || !backupArgument) throw new Refusal(USAGE, 2);
  const configured = process.env.SHARED_TRIP_DATA_DIR; // The only application environment value read.
  if (!configured) throw new Refusal(USAGE, 2);
  const repo = fs.realpathSync(path.resolve(import.meta.dirname, "..", ".."));
  let dataDir;
  try { dataDir = fs.realpathSync(path.resolve(configured)); } catch { throw new Refusal("Refused: data directory does not exist."); }
  if (!fs.statSync(dataDir).isDirectory() || inside(dataDir, repo)) throw new Refusal("Refused: use an existing data directory outside the checkout.");
  const backup = realTarget(path.resolve(backupArgument));
  if (inside(backup, repo) || inside(path.resolve(backupArgument), repo) || fs.existsSync(backup)) throw new Refusal("Refused: backup must be a new file outside the checkout.");
  try { lock = acquireDataLock(dataDir); } catch { throw new Refusal("Refused: data-directory ownership is unavailable. Stop the application or other maintenance first."); }
  const file = path.join(dataDir, "shared-trip.sqlite");
  if (!fs.existsSync(file)) throw new Refusal("Refused: no trip database exists.");
  const peek = new DatabaseSync(file, { readOnly: true });
  try { if (peek.prepare("PRAGMA user_version").get().user_version !== SCHEMA_VERSION) throw new Refusal("Refused: upgrade the database separately before maintenance."); }
  finally { peek.close(); }
  try { await snapshotDatabase(file, backup); } catch { throw new Refusal("Refused: a validated recoverable backup could not be written."); }
  db = openDatabase(file);
  const service = new TripService(db); const audit = new AuditLog(db);
  const context = { principal: { role: OWNER, via: OPERATOR }, channel: OPERATOR };
  const before = service.getTrip(tripId).trip; // Fresh read after backup, under exclusive ownership.
  const value = valueText === "true"; const expectedVersion = Number(versionText);
  let outcome;
  const observed = {
    record(event) {
      // This callback runs INSIDE the shared domain transaction, before its COMMIT.
      // Refuse normalization side effects instead of committing an unrelated content change.
      const after = service.getTrip(tripId).trip;
      if (event.outcome === "accepted" && (after.googlePlacePhotosEnabled !== value || after.version !== before.version + 1 || contentOnly(after) !== contentOnly(before))) {
        throw new Error("Unrelated content would change");
      }
      audit.record(event); outcome = event.outcome;
    },
    safeRecord: event => audit.safeRecord(event)
  };
  const gateway = new ContentGateway(service, observed);
  gateway.applyTripChanges(context, { tripId, expectedVersion, requestId, changes: [{ type: "update_trip", fields: { googlePlacePhotosEnabled: value } }] });
  console.log(outcome === "replayed" ? "Request replayed; no trip content changed. Validated backup retained." : "Trip Google setting updated. Validated pre-mutation backup retained.");
} catch (error) {
  if (error instanceof Refusal) { console.error(error.message); process.exitCode = error.exitCode; }
  else if (error instanceof DomainError) {
    const code = /^[a-z][a-z_]{0,47}$/.test(error.code) ? error.code : "domain_refusal";
    console.error("Refused (" + code + "). No setting update committed."); process.exitCode = 1;
  } else { console.error("Maintenance failed; no further changes made. An audit or preservation failure rolls back the setting transaction."); process.exitCode = 1; }
} finally {
  try { db?.close(); } catch { console.error("Could not close database cleanly."); process.exitCode = 1; }
  try { lock?.release(); } catch { console.error("Could not release ownership cleanly; it ends on process exit."); process.exitCode = 1; }
}
