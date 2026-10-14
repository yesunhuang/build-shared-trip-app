// Data-directory ownership tests using real child processes and disposable fictional storage.
//
// Coordination uses only IPC replies and child "exit" events; there are no sleeps or timeouts.
// Rule: the parent never opens server-ownership.sqlite with fs (stat only). Closing any descriptor on
// that file would drop the parent's own POSIX locks whenever the parent is the owner.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { acquireDataLock, dataLockPath, dataOwnershipPath, DATA_OWNERSHIP_FILE } from "../server/data-lock.mjs";
import { readConfig, startServer } from "../server/app.mjs";
import { snapshotDatabase } from "../server/db.mjs";

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), "..");
const restoreCli = path.join(root, "server", "cli", "restore.mjs");
const children = new Set();
const parentOwned = new Set(); // cleanup callbacks for ownership currently held by this process
const token = "fictional-lock-test-" + "x".repeat(32);
const configFor = (dataDir) => readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: dataDir, SHARED_TRIP_PORT: "0" });
const titleChange = (title) => [{ type: "update_trip", fields: { title } }];
const summary = (trip) => ({ id: trip.id, version: trip.version, title: trip.title });
const HELD = /Data directory (?:is in use|has a server\.lock)/;

// ---- child side --------------------------------------------------------------------------------
// Roles: "server" runs the full startServer path. "holder" takes only the shared ownership module,
// as restore does.
function runChild(role) {
  const dataDir = process.env.SHARED_TRIP_DATA_DIR;
  let runtime = null; let lock = null;
  const release = async () => {
    const [ownedRuntime, ownedLock] = [runtime, lock];
    runtime = null; lock = null;
    if (ownedRuntime) { await ownedRuntime.close(); return true; }
    if (ownedLock) return ownedLock.release();
    return null;
  };
  const handlers = {
    async acquire() {
      if (role === "server") runtime = await startServer(configFor(dataDir));
      else lock = acquireDataLock(dataDir);
      return { pid: process.pid };
    },
    seed: ({ requestId, title }) => summary(runtime.service.createTrip({ requestId, trip: { title } }).trip),
    edit: ({ tripId, requestId, expectedVersion, title }) =>
      summary(runtime.service.applyTripChanges({ tripId, requestId, expectedVersion, changes: titleChange(title) }).trip),
    read: ({ tripId }) => summary(runtime.service.getTrip(tripId).trip),
    release: async () => ({ released: await release() }),
    exit: () => process.exit(0) // a normal exit while still owning, without calling release()
  };
  process.on("message", async (message) => {
    let reply;
    try { reply = { ok: true, ...(await handlers[message.op](message)) }; }
    catch (error) { reply = { ok: false, code: error.code, reason: error.reason, message: error.message }; }
    process.send(reply, () => { if (message.op === "release") process.disconnect(); });
  });
  // If the parent disappears, release normally (idempotent) and let the event loop drain.
  process.once("disconnect", () => { release().catch(() => {}); });
  process.send({ ready: true });
}

// ---- parent helpers ----------------------------------------------------------------------------
function track(proc) {
  const exited = new Promise((resolve) => {
    proc.once("exit", (code, signal) => resolve({ code, signal }));
    proc.once("error", (error) => resolve({ code: null, signal: null, error }));
  });
  const entry = { proc, exited };
  children.add(entry);
  exited.then(() => children.delete(entry));
  return exited;
}

async function launch(role, dataDir) {
  const proc = fork(self, ["child", role], { env: { ...process.env, SHARED_TRIP_DATA_DIR: dataDir }, stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const exited = track(proc);
  const queue = []; const waiters = []; let gone = false;
  proc.on("message", (message) => { const waiter = waiters.shift(); if (waiter) waiter.resolve(message); else queue.push(message); });
  exited.then(({ code, signal }) => {
    gone = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(role + " child exited (" + (code ?? signal) + ") before replying"));
  });
  const next = () => queue.length ? Promise.resolve(queue.shift())
    : gone ? Promise.reject(new Error(role + " child already exited"))
    : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  assert.deepEqual(await next(), { ready: true });
  const request = (op, args = {}) => { proc.send({ op, ...args }); return next(); };
  return {
    role, pid: proc.pid, exited, request,
    acquire: () => request("acquire"),
    async stop() { const reply = await request("release"); await exited; return reply; },
    exitWithoutRelease() { proc.send({ op: "exit" }); return exited; },
    hardKill() { proc.kill("SIGKILL"); return exited; } // TerminateProcess on Windows
  };
}

function runRestore(dataDir, snapshot) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [restoreCli, snapshot], { cwd: root, env: { ...process.env, SHARED_TRIP_DATA_DIR: dataDir }, stdio: ["ignore", "pipe", "pipe"] });
    track(proc);
    let output = "";
    proc.stdout.on("data", (chunk) => { output += chunk; });
    proc.stderr.on("data", (chunk) => { output += chunk; });
    proc.once("error", reject);
    proc.once("close", (code) => resolve({ code, output }));
  });
}

async function exitedPid() {
  const proc = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await track(proc);
  return proc.pid;
}

function ownInParent(release) { parentOwned.add(release); return () => { parentOwned.delete(release); return release(); }; }

async function withServer(dir, action) {
  const runtime = await startServer(configFor(dir));
  const close = ownInParent(() => runtime.close());
  try { return await action(runtime); }
  finally { await close(); }
}

const seed = (dir, title = "Fictional Lock Harbor") => withServer(dir, (runtime) =>
  summary(runtime.service.createTrip({ requestId: "seed-" + path.basename(dir), trip: { title } }).trip));

const inode = (file) => fs.statSync(file, { bigint: true }).ino.toString();
const readIfPresent = (file) => fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
const markerPid = (dir) => { const content = readIfPresent(dataLockPath(dir)); return content === null ? null : Number(content.split("\n")[0]); };
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

// Names, inodes and content hashes. The ownership database is recorded by inode, size and mtime only,
// and SQLite sidecars by name only. Call this only while the parent owns nothing, so reading trip
// database files cannot disturb the parent's own SQLite locks.
function fingerprint(dir) {
  assert.equal(parentOwned.size, 0, "fingerprint must not run while the parent owns a data directory");
  return fs.readdirSync(dir).sort().map((name) => {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file, { bigint: true });
    if (name === DATA_OWNERSHIP_FILE) return name + ":" + stat.ino + ":" + stat.size + ":" + stat.mtimeNs;
    if (!stat.isFile() || /-(?:wal|shm|journal)$/.test(name)) return name;
    return name + ":" + stat.ino + ":" + sha256(fs.readFileSync(file));
  });
}

// After a graceful release, ROLLBACK has deleted SQLite's rollback journal, so nothing may remain.
// After a hard kill, SQLite's own server-ownership.sqlite-journal may remain. The owner's transaction
// creates it, and nothing runs cleanup. The size check below proves the database still has zero pages,
// so SQLite treats that journal as non-hot and the next connection deletes it under a RESERVED lock.
// Nothing else is tolerated: no WAL/SHM, no other sidecar, and no marker temporaries. Every
// hard-kill sequence later calls the strict form after a graceful owner, which proves the journal
// was reclaimed and does not accumulate.
const OWNERSHIP_JOURNAL = DATA_OWNERSHIP_FILE + "-journal";
function assertQuiescentLayout(dir, ownershipIno, { afterHardKill = false } = {}) {
  const ownership = fs.statSync(dataOwnershipPath(dir), { bigint: true });
  assert.equal(ownership.ino.toString(), ownershipIno, "the persistent ownership database was replaced");
  assert.equal(ownership.size, 0n, "the ownership database must never be written");
  const debris = fs.readdirSync(dir).filter((name) => /^server-ownership\.sqlite-|^server\.lock\..*\.tmp$/.test(name))
    .filter((name) => !(afterHardKill && name === OWNERSHIP_JOURNAL));
  assert.deepEqual(debris, [], "ownership journal or marker temporaries left behind");
}

function assertRefused(reply, reason) {
  assert.equal(reply.ok, false, "unexpectedly acquired: " + JSON.stringify(reply));
  assert.equal(reply.code, "data_lock_held", reply.message);
  assert.equal(reply.reason, reason, reply.message);
}

// ---- scenarios ---------------------------------------------------------------------------------
async function contentionHasExactlyOneOwner(temporary, snapshot) {
  for (let round = 0; round < 4; round++) {
    const dir = path.join(temporary, "contention-" + round);
    // Round 0 races the very first creation of the ownership database in an empty directory.
    const seeded = round === 0 ? (fs.mkdirSync(dir), null) : await seed(dir);
    const contenders = await Promise.all(["server", "holder", "server", "holder", "server"].map((role) => launch(role, dir)));
    const results = await Promise.all(contenders.map((contender) => contender.acquire()));
    const winners = contenders.filter((_, index) => results[index].ok);
    assert.equal(winners.length, 1, "expected exactly one owner: " + JSON.stringify(results));
    results.filter((result) => !result.ok).forEach((result) => assertRefused(result, "owned"));
    const [owner] = winners;
    assert.equal(markerPid(dir), owner.pid);
    const ownershipIno = inode(dataOwnershipPath(dir));
    const before = fingerprint(dir);
    const restore = await runRestore(dir, snapshot);
    assert.notEqual(restore.code, 0, restore.output);
    assert.match(restore.output, HELD);
    assert.throws(() => acquireDataLock(dir), { code: "data_lock_held", reason: "owned" });
    await assert.rejects(startServer(configFor(dir)), { code: "data_lock_held", reason: "owned" });
    assert.deepEqual(fingerprint(dir), before, "a refused contender changed the owner's files");
    for (const contender of contenders) await contender.stop();
    assert.equal(fs.existsSync(dataLockPath(dir)), false);
    assertQuiescentLayout(dir, ownershipIno);
    if (seeded) await withServer(dir, (runtime) => assert.deepEqual(summary(runtime.service.getTrip(seeded.id).trip), seeded));
  }

  // Restore races the long-lived owners. Ownership is exclusive at every instant: if the restore
  // succeeded, no child can have held the directory during its whole run, and vice versa.
  for (let round = 0; round < 3; round++) {
    const dir = path.join(temporary, "restore-race-" + round);
    await seed(dir);
    const contenders = await Promise.all(["server", "holder", "server"].map((role) => launch(role, dir)));
    const restoring = runRestore(dir, snapshot);
    const results = await Promise.all(contenders.map((contender) => contender.acquire()));
    const restore = await restoring;
    const winners = results.filter((result) => result.ok);
    results.filter((result) => !result.ok).forEach((result) => assertRefused(result, "owned"));
    assert.ok(winners.length <= 1, "more than one concurrent owner: " + JSON.stringify(winners));
    if (restore.code !== 0) assert.match(restore.output, HELD);
    assert.ok(winners.length === 1 || restore.code === 0, "an unowned directory was refused to everybody");
    if (winners.length) assert.equal(markerPid(dir), winners[0].pid);
    for (const contender of contenders) await contender.stop();
    assert.equal(fs.existsSync(dataLockPath(dir)), false);
  }
}

async function hardKillAllowsImmediateRestart(temporary, snapshot, snapshotTrip) {
  const dir = path.join(temporary, "hard-kill");
  fs.mkdirSync(dir);
  const first = await launch("server", dir);
  assert.equal((await first.acquire()).ok, true);
  const created = await first.request("seed", { requestId: "kill-seed", title: "Fictional Kill Harbor" });
  const edited = await first.request("edit", { tripId: created.id, requestId: "kill-edit-1", expectedVersion: created.version, title: "Fictional Kill Harbor, edited" });
  assert.equal(edited.version, created.version + 1);
  const ownershipIno = inode(dataOwnershipPath(dir));
  assert.equal(markerPid(dir), first.pid);
  const killed = await first.hardKill();
  assert.ok(killed.signal === "SIGKILL" || killed.code !== 0, "owner was not terminated: " + JSON.stringify(killed));
  assert.equal(markerPid(dir), first.pid, "a hard kill runs no cleanup, so the dead owner's marker remains");

  // Restart immediately, with nothing deleted manually.
  let current = await withServer(dir, (runtime) => {
    assert.equal(markerPid(dir), process.pid, "the dead owner's marker was replaced under the new ownership");
    assert.deepEqual(summary(runtime.service.getTrip(created.id).trip), { id: edited.id, version: edited.version, title: edited.title });
    // The request log survived as well: replaying the committed edit is idempotent.
    const replay = runtime.service.applyTripChanges({ tripId: created.id, requestId: "kill-edit-1", expectedVersion: created.version, changes: titleChange(edited.title) });
    assert.equal(replay.trip.version, edited.version);
    return summary(runtime.service.applyTripChanges({ tripId: created.id, requestId: "restart-edit", expectedVersion: edited.version, changes: titleChange("Fictional Kill Harbor, after restart") }).trip);
  });
  assert.equal(current.version, edited.version + 1);
  assert.equal(fs.existsSync(dataLockPath(dir)), false);

  // Repeated kill/restart cycles through both the full server and the bare ownership holder.
  for (const role of ["server", "holder", "server", "holder"]) {
    const owner = await launch(role, dir);
    const acquired = await owner.acquire();
    assert.equal(acquired.ok, true, acquired.message);
    if (role === "server") {
      assert.deepEqual(summary(await owner.request("read", { tripId: created.id })), current);
      current = summary(await owner.request("edit", { tripId: created.id, requestId: "cycle-" + current.version, expectedVersion: current.version, title: "Fictional Kill Harbor, cycle " + current.version }));
    }
    await owner.hardKill();
    assert.equal(markerPid(dir), owner.pid);
    assertQuiescentLayout(dir, ownershipIno, { afterHardKill: true });
  }
  await withServer(dir, (runtime) => assert.deepEqual(summary(runtime.service.getTrip(created.id).trip), current));
  // A graceful owner after the kills: SQLite reclaimed the dead owners' journal, and ROLLBACK removed its own.
  assertQuiescentLayout(dir, ownershipIno);

  // Restore can run immediately after a hard-killed owner, and it keeps the prior data as a snapshot.
  const last = await launch("holder", dir);
  assert.equal((await last.acquire()).ok, true);
  await last.hardKill();
  const restored = await runRestore(dir, snapshot);
  assert.equal(restored.code, 0, restored.output);
  assert.equal(fs.existsSync(dataLockPath(dir)), false);
  await withServer(dir, (runtime) => assert.deepEqual(runtime.service.listTrips().trips.map((trip) => [trip.id, trip.version]), [[snapshotTrip.id, snapshotTrip.version]]));
  const prior = fs.readdirSync(dir).find((name) => name.startsWith("shared-trip.sqlite.before-restore-"));
  assert.ok(prior, "restore did not keep the prior target");
  const db = new DatabaseSync(path.join(dir, prior), { readOnly: true });
  try { assert.deepEqual(db.prepare("SELECT id,version FROM trips").all().map((row) => [row.id, row.version]), [[current.id, current.version]]); }
  finally { db.close(); }
  assertQuiescentLayout(dir, ownershipIno);
}

async function gracefulReleaseRepeats(temporary) {
  const dir = path.join(temporary, "graceful");
  fs.mkdirSync(dir);
  let ownershipIno = null;
  for (let cycle = 0; cycle < 4; cycle++) {
    const lock = acquireDataLock(dir);
    const release = ownInParent(() => lock.release());
    ownershipIno ??= inode(dataOwnershipPath(dir));
    assert.equal(lock.path, dataLockPath(dir));
    assert.equal(markerPid(dir), process.pid);
    // A second connection in the same process is refused, and closing it must not drop the first lock.
    assert.throws(() => acquireDataLock(dir), { code: "data_lock_held", reason: "owned" });
    const probe = await launch("holder", dir);
    assertRefused(await probe.acquire(), "owned");
    await probe.stop();
    assert.equal(release(), true);
    assert.equal(lock.release(), false);
    assert.equal(lock.release(), false);
    assert.equal(fs.existsSync(dataLockPath(dir)), false);
    assertQuiescentLayout(dir, ownershipIno);
  }
  for (let cycle = 0; cycle < 3; cycle++) {
    const holder = await launch("holder", dir);
    assert.equal((await holder.acquire()).ok, true);
    assert.deepEqual(await holder.stop(), { ok: true, released: true });
    assert.equal(fs.existsSync(dataLockPath(dir)), false);
  }
  const runtime = await startServer(configFor(dir));
  const close = ownInParent(() => runtime.close());
  await Promise.all([runtime.close(), runtime.close()]);
  await close();
  assert.equal(fs.existsSync(dataLockPath(dir)), false);
  // A normal process exit without release(): the OS frees ownership and the next owner replaces the marker.
  const leaver = await launch("holder", dir);
  assert.equal((await leaver.acquire()).ok, true);
  assert.equal((await leaver.exitWithoutRelease()).code, 0);
  assert.equal(markerPid(dir), leaver.pid);
  const next = await launch("server", dir);
  assert.equal((await next.acquire()).ok, true);
  assert.equal(markerPid(dir), next.pid);
  assert.deepEqual(await next.stop(), { ok: true, released: true });
  assert.equal(fs.existsSync(dataLockPath(dir)), false);
  assertQuiescentLayout(dir, ownershipIno);
}

async function startupFailuresReleaseOwnership(temporary) {
  const dir = path.join(temporary, "port-in-use");
  const seeded = await seed(dir);
  const blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once("error", reject); blocker.listen(0, "127.0.0.1", resolve); });
  try { await assert.rejects(startServer({ ...configFor(dir), port: blocker.address().port }), { code: "EADDRINUSE" }); }
  finally { await new Promise((resolve) => blocker.close(resolve)); }
  assert.equal(fs.existsSync(dataLockPath(dir)), false);
  const probe = await launch("holder", dir);
  assert.equal((await probe.acquire()).ok, true, "a failed listen kept ownership");
  await probe.stop();
  await withServer(dir, (runtime) => assert.deepEqual(summary(runtime.service.getTrip(seeded.id).trip), seeded));

  const broken = path.join(temporary, "unopenable");
  fs.mkdirSync(path.join(broken, "shared-trip.sqlite"), { recursive: true });
  await assert.rejects(startServer(configFor(broken)));
  assert.equal(fs.existsSync(dataLockPath(broken)), false);
  assert.ok(fs.statSync(path.join(broken, "shared-trip.sqlite")).isDirectory());
  const brokenProbe = await launch("holder", broken);
  assert.equal((await brokenProbe.acquire()).ok, true, "a failed database open kept ownership");
  await brokenProbe.stop();

  // An unusable ownership database fails closed with an ordinary error and creates nothing.
  const unusable = path.join(temporary, "unusable-ownership");
  fs.mkdirSync(path.join(unusable, DATA_OWNERSHIP_FILE), { recursive: true });
  assert.throws(() => acquireDataLock(unusable), (error) => error.code !== "data_lock_held");
  await assert.rejects(startServer(configFor(unusable)), (error) => error.code !== "data_lock_held");
  assert.deepEqual(fs.readdirSync(unusable), [DATA_OWNERSHIP_FILE]);
}

async function contenderCannotDisturbOwner(temporary, snapshot) {
  const dir = path.join(temporary, "undisturbed");
  const seeded = await seed(dir);
  const owner = await launch("server", dir);
  assert.equal((await owner.acquire()).ok, true);
  const before = fingerprint(dir);
  for (let attempt = 0; attempt < 3; attempt++) assert.throws(() => acquireDataLock(dir), { code: "data_lock_held", reason: "owned" });
  await assert.rejects(startServer(configFor(dir)), { code: "data_lock_held", reason: "owned" });
  for (const role of ["holder", "server"]) {
    const rival = await launch(role, dir);
    assertRefused(await rival.acquire(), "owned");
    await rival.stop();
  }
  const restore = await runRestore(dir, snapshot);
  assert.notEqual(restore.code, 0, restore.output);
  assert.match(restore.output, HELD);
  assert.deepEqual(fingerprint(dir), before, "a contender modified the owner's ownership database, marker or data");
  assert.deepEqual(summary(await owner.request("read", { tripId: seeded.id })), seeded);

  // Wrongful deletion of the ownership database while its owner lives. Windows normally refuses
  // the deletion because SQLite keeps the file open without delete sharing. On POSIX the owner keeps
  // its lock on the unlinked inode, so a contender locks a fresh empty file. The marker still names
  // the live owner's file, so the contender refuses.
  let deleted = true;
  try { fs.unlinkSync(dataOwnershipPath(dir)); } catch { deleted = false; }
  if (deleted) {
    assert.throws(() => acquireDataLock(dir), { code: "data_lock_held", reason: "foreign_lock" });
    const rival = await launch("server", dir);
    assertRefused(await rival.acquire(), "foreign_lock");
    await rival.stop();
    assert.equal(markerPid(dir), owner.pid);
  } else assert.deepEqual(fingerprint(dir), before);
  assert.deepEqual(summary(await owner.request("read", { tripId: seeded.id })), seeded);
  assert.deepEqual(await owner.stop(), { ok: true, released: true });
  assert.equal(fs.existsSync(dataLockPath(dir)), false);
  await withServer(dir, (runtime) => assert.deepEqual(summary(runtime.service.getTrip(seeded.id).trip), seeded));
}

async function legacyLocksAreRefusedUnchanged(temporary, snapshot) {
  const dir = path.join(temporary, "legacy");
  const seeded = await seed(dir);
  const lockPath = dataLockPath(dir);
  // A directory last used by a PID-lock release has no ownership database yet. Nothing owns this
  // disposable directory, so removing the file here only emulates that prior state.
  fs.unlinkSync(dataOwnershipPath(dir));
  const withoutOwnership = (entries) => entries.filter((entry) => !entry.startsWith(DATA_OWNERSHIP_FILE + ":"));
  const check = async (label, content) => {
    fs.writeFileSync(lockPath, content, { flag: "wx", mode: 0o600 });
    const pre = withoutOwnership(fingerprint(dir));
    assert.throws(() => acquireDataLock(dir), { code: "data_lock_held", reason: "foreign_lock" }, label);
    assert.equal(fs.statSync(dataOwnershipPath(dir)).size, 0, label + ": only an empty ownership database may be created");
    const before = fingerprint(dir);
    assert.deepEqual(withoutOwnership(before), pre, label);
    await assert.rejects(startServer(configFor(dir)), { code: "data_lock_held", reason: "foreign_lock" }, label);
    const contender = await launch("server", dir);
    assertRefused(await contender.acquire(), "foreign_lock");
    await contender.stop();
    const restore = await runRestore(dir, snapshot);
    assert.notEqual(restore.code, 0, restore.output);
    assert.match(restore.output, /server\.lock/);
    assert.deepEqual(fingerprint(dir), before, label + ": a refused attempt changed the lock or data");
    assert.equal(fs.readFileSync(lockPath, "utf8"), content, label);
    fs.unlinkSync(lockPath); // the documented one-time manual step after verifying that no older process runs
  };
  await check("dead legacy PID", String(await exitedPid()));
  await check("live legacy PID", String(process.pid));
  await check("empty legacy lock", "");
  await check("unknown content", "fictional unknown lock\n");
  const ownershipIno = BigInt(inode(dataOwnershipPath(dir)));
  await check("marker for another ownership database", "4242\nshared-trip-ownership-v1 owner=" + (ownershipIno + 1n) + " nonce=" + "0".repeat(32) + "\n");
  await check("truncated marker", "4242\nshared-trip-ownership-v1 owner=" + ownershipIno + "\n");
  await withServer(dir, (runtime) => {
    assert.deepEqual(runtime.service.listTrips().trips.map((trip) => trip.id), [seeded.id]);
    assert.deepEqual(summary(runtime.service.getTrip(seeded.id).trip), seeded);
  });
  assert.equal(fs.existsSync(lockPath), false);
}

async function restoreCannotReplaceLiveOwner(temporary, snapshot, snapshotTrip) {
  const dir = path.join(temporary, "live-restore");
  fs.mkdirSync(dir);
  const owner = await launch("server", dir);
  assert.equal((await owner.acquire()).ok, true);
  const live = await owner.request("seed", { requestId: "live-seed", title: "Fictional Live Cove" });
  const before = fingerprint(dir);
  for (let attempt = 0; attempt < 2; attempt++) {
    const restore = await runRestore(dir, snapshot);
    assert.notEqual(restore.code, 0, restore.output);
    assert.match(restore.output, HELD);
  }
  assert.deepEqual(fingerprint(dir), before, "a refused restore changed the live database");
  assert.equal(fs.readdirSync(dir).some((name) => /\.(?:restore|before-restore)-/.test(name)), false, "a refused restore staged files");
  assert.deepEqual(summary(await owner.request("read", { tripId: live.id })), { id: live.id, version: live.version, title: live.title });
  await owner.hardKill();
  const restored = await runRestore(dir, snapshot);
  assert.equal(restored.code, 0, restored.output);
  await withServer(dir, (runtime) => assert.deepEqual(runtime.service.listTrips().trips.map((trip) => [trip.id, trip.version]), [[snapshotTrip.id, snapshotTrip.version]]));
}

async function runTests() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-lock-"));
  try {
    const sourceDir = path.join(temporary, "source");
    const snapshotTrip = await seed(sourceDir, "Fictional Snapshot Bay");
    const snapshot = path.join(temporary, "source.sqlite");
    await snapshotDatabase(path.join(sourceDir, "shared-trip.sqlite"), snapshot);
    await contentionHasExactlyOneOwner(temporary, snapshot);
    console.log("Concurrent servers and holders: exactly one owner. Restore, startup and acquisition by others refused without changes.");
    await hardKillAllowsImmediateRestart(temporary, snapshot, snapshotTrip);
    console.log("Hard-killed owners are replaced immediately without manual deletion; trip IDs, versions and request log survive.");
    await gracefulReleaseRepeats(temporary);
    console.log("Repeated graceful release and exit without release leave the persistent ownership database reusable.");
    await startupFailuresReleaseOwnership(temporary);
    console.log("Listen, trip-database and ownership-database failures release or create no ownership.");
    await contenderCannotDisturbOwner(temporary, snapshot);
    console.log("Contenders cannot modify or remove a live owner's ownership database, marker or data.");
    await legacyLocksAreRefusedUnchanged(temporary, snapshot);
    console.log("Legacy and unattributable server.lock files are refused deterministically and left unchanged.");
    await restoreCannotReplaceLiveOwner(temporary, snapshot, snapshotTrip);
    console.log("Restore cannot replace a live owner's database, and succeeds immediately after that owner is killed.");
  } finally {
    for (const release of [...parentOwned]) { try { await release(); } catch { /* best effort */ } }
    for (const { proc, exited } of [...children]) { proc.kill("SIGKILL"); await exited; }
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
  }
}

if (process.argv[2] === "child") runChild(process.argv[3]);
else await runTests();
