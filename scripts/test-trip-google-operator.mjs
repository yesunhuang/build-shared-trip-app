// Fictional offline maintenance against real SQLite and child-process CLI calls.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { openDatabase, validateSnapshot } from "../server/db.mjs";
import { acquireDataLock } from "../server/data-lock.mjs";
import { TripService } from "../server/domain/service.mjs";
import { associationForPlan } from "../assets/app-template/public/google-place-association.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-operator-test-"));
const dataDir = path.join(root, "data"); fs.mkdirSync(dataDir);
const file = path.join(dataDir, "shared-trip.sqlite");
const cli = path.resolve("server/cli/set-trip-google-photos.mjs");
const guard = path.join(root, "env-guard.mjs");
fs.writeFileSync(guard, `const original=process.env;process.env=new Proxy(original,{get(t,k){if(typeof k==='string'&&k.startsWith('SHARED_TRIP_')&&k!=='SHARED_TRIP_DATA_DIR')throw Error('Credential/configuration read forbidden');return t[k];}});`);
const env = { ...process.env, SHARED_TRIP_DATA_DIR: dataDir };
for (const k of Object.keys(env)) if (k.startsWith("SHARED_TRIP_") && k !== "SHARED_TRIP_DATA_DIR") delete env[k];
const run = (id, version, value, request, backup, more = []) => spawnSync(process.execPath, ["--import", pathToFileURL(guard).href, cli, id, String(version), value, request, backup, ...more], { env, encoding: "utf8" });
const backup = n => path.join(root, n + ".sqlite");
function inspect(fn) { const db = openDatabase(file); try { return fn(db, new TripService(db)); } finally { db.close(); } }
let a; let b;
try {
  inspect((db, service) => {
    const plan = { id: "plan-fictional", name: "Fictional public pavilion", lat: 12, lng: 34, address: "Fictional Square", photo: { provider: "manual", url: "https://example.invalid/photo.jpg" } };
    plan.googlePlaceAssociation = associationForPlan(plan, "FictionalPlaceId123");
    a = service.createTrip({ requestId: "fixture-a", trip: { title: "Fictional operator trip", weather: { locations: [{ id: "loc-a", lat: 12, lng: 34 }] }, days: [{ id: "day-a", date: "2031-05-01", weatherLocationIds: [], slots: [plan] }] } }).trip;
    b = service.createTrip({ requestId: "fixture-b", trip: { title: "Fictional other trip" } }).trip;
    // Older stored trips omit the flag; the shared read projection correctly reports false.
    const legacy = JSON.parse(db.prepare("SELECT data FROM trips WHERE id=?").get(a.id).data);
    delete legacy.googlePlacePhotosEnabled;
    db.prepare("UPDATE trips SET data=? WHERE id=?").run(JSON.stringify(legacy), a.id);
  });
  const ledger = path.join(dataDir, "google-allowance.sqlite"); fs.writeFileSync(ledger, "Fictional opaque ledger bytes; never opened by this command");
  const photo = path.join(dataDir, "photos"); fs.mkdirSync(photo); fs.writeFileSync(path.join(photo, "fictional.txt"), "Fictional saved image");
  const lock = acquireDataLock(dataDir);
  try { const r = run(a.id, 1, "true", "enable-a", backup("locked")); assert.notEqual(r.status, 0); assert.match(r.stderr, /ownership/); assert.ok(!fs.existsSync(backup("locked"))); } finally { lock.release(); }
  for (const [version, value, more] of [["01", "true", []], ["1", "1", []], ["1", "TRUE", []], ["1", "false", ["extra"]]]) {
    assert.equal(run(a.id, version, value, "bad-args", backup("bad"), more).status, 2);
  }
  const occupied = backup("occupied"); fs.writeFileSync(occupied, "Fictional prior backup"); assert.notEqual(run(a.id, 1, "true", "occupied", occupied).status, 0); assert.equal(fs.readFileSync(occupied, "utf8"), "Fictional prior backup");
  const insideCheckout = path.resolve("fictional-operator-backup-must-not-exist.sqlite");
  assert.notEqual(run(a.id, 1, "true", "inside-checkout", insideCheckout).status, 0); assert.ok(!fs.existsSync(insideCheckout));
  const unknown = run("trip-fictional-missing", 1, "true", "unknown-trip", backup("unknown")); assert.notEqual(unknown.status, 0); assert.match(unknown.stderr, /trip_not_found/);
  const r = run(a.id, 1, "true", "enable-a", backup("before-enable")); assert.equal(r.status, 0, r.stderr); validateSnapshot(backup("before-enable"));
  const enabled = inspect((db, service) => service.getTrip(a.id).trip); assert.equal(enabled.googlePlacePhotosEnabled, true); assert.equal(enabled.version, 2);
  const strip = ({ googlePlacePhotosEnabled, version, updatedAt, ...t }) => t;
  assert.deepEqual(strip(enabled), strip(a)); assert.deepEqual(inspect((db, service) => service.getTrip(b.id).trip), b);
  const accepted = inspect(db => db.prepare("SELECT actor,channel,action,outcome,version FROM audit_log ORDER BY seq DESC LIMIT 1").get());
  assert.deepEqual({ ...accepted }, { actor: "operator", channel: "operator", action: "trip.change", outcome: "accepted", version: 2 });
  assert.equal(run(a.id, 1, "true", "enable-a", backup("replay")).status, 0);
  assert.deepEqual(inspect((db, service) => service.getTrip(a.id).trip), enabled, "identical replay never writes trip content");
  const stale = run(a.id, 1, "false", "stale-a", backup("stale")); assert.notEqual(stale.status, 0); assert.match(stale.stderr, /version_conflict/);
  const conflict = run(a.id, 2, "false", "enable-a", backup("request-conflict")); assert.notEqual(conflict.status, 0); assert.match(conflict.stderr, /request_id_conflict/);
  assert.deepEqual(inspect((db, service) => service.getTrip(a.id).trip), enabled);
  inspect(db => db.exec("CREATE TRIGGER fictional_fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT,'fictional audit failure'); END"));
  assert.notEqual(run(a.id, 2, "false", "audit-fail", backup("audit-fail")).status, 0);
  inspect((db, service) => { assert.deepEqual(service.getTrip(a.id).trip, enabled); assert.equal(db.prepare("SELECT count(*) AS n FROM request_log WHERE request_id='audit-fail'").get().n, 0); db.exec("DROP TRIGGER fictional_fail_audit"); });
  assert.equal(run(a.id, 2, "false", "disable-a", backup("before-disable")).status, 0);
  assert.equal(inspect((db, service) => service.getTrip(a.id).trip.googlePlacePhotosEnabled), false);
  // Fictional legacy inconsistency: shared validation would drop a stale association. Refuse
  // that side effect INSIDE the transaction instead of changing an unrelated plan.
  inspect(db => { const row = db.prepare("SELECT data FROM trips WHERE id=?").get(a.id); const t = JSON.parse(row.data); t.days[0].slots[0].googlePlaceAssociation.locationBinding = "v1:" + "0".repeat(64); db.prepare("UPDATE trips SET data=? WHERE id=?").run(JSON.stringify(t), a.id); });
  const legacy = inspect(db => db.prepare("SELECT data FROM trips WHERE id=?").get(a.id).data);
  assert.notEqual(run(a.id, 3, "true", "preservation-fail", backup("preservation-fail")).status, 0);
  inspect(db => { assert.equal(db.prepare("SELECT data FROM trips WHERE id=?").get(a.id).data, legacy); assert.equal(db.prepare("SELECT count(*) AS n FROM request_log WHERE request_id='preservation-fail'").get().n, 0); });
  assert.equal(fs.readFileSync(ledger, "utf8"), "Fictional opaque ledger bytes; never opened by this command");
  assert.equal(fs.readFileSync(path.join(photo, "fictional.txt"), "utf8"), "Fictional saved image");
  assert.ok(!fs.existsSync(path.join(dataDir, "server.lock")));
  inspect(db => db.exec("PRAGMA user_version=5"));
  assert.notEqual(run(a.id, 3, "true", "old-schema", backup("old-schema")).status, 0);
  assert.ok(!fs.existsSync(backup("old-schema")), "maintenance never attempts a schema migration");
  const schemaCheck = new DatabaseSync(file);
  try { assert.equal(schemaCheck.prepare("PRAGMA user_version").get().user_version, 5); schemaCheck.exec("PRAGMA user_version=6"); }
  finally { schemaCheck.close(); }
  console.log("Operator Google setting tests passed: real SQLite/CLI, ownership refusal, strict arguments, backup, legacy absent/default-off flag, flag-only preservation, operator audit, conflicts, durable replay, true/false, audit rollback, normalization-side-effect rollback, schema refusal, untouched other trip/photos/ledger and no credential/configuration reads.");
} finally {
  const resolved = fs.realpathSync(root);
  assert.equal(path.dirname(resolved), fs.realpathSync(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("shared-trip-operator-test-"));
  fs.rmSync(resolved, { recursive: true, force: true });
}
