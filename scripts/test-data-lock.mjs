// Data-directory lock tests using real child processes and fictional temporary data.
//
// Race in the previous read/check/unlink/create reclamation, which startup and restore both used:
//   1. server.lock records a dead PID. Contenders A and B both read it and get ESRCH.
//   2. A unlinks it and creates its own lock with flag "wx". A now owns the directory.
//   3. B is still acting on its stale observation. It unlinks A's fresh lock, creates its own,
//      and both processes now write the same database.
// The current policy never removes an existing lock, so step 3 cannot happen. Two scenarios below
// fail against the previous implementation:
//   - staleLockIsNeverReclaimed: the old code deleted a dead-PID lock and started.
//   - replacedLockIsNotRemoved: the old close() unlinked whatever lock file it found.
// No sleeps are used. Coordination is through IPC messages and process exit events.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { fork, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { acquireDataLock, dataLockPath } from "../server/data-lock.mjs";
import { readConfig, startServer } from "../server/app.mjs";
import { snapshotDatabase } from "../server/db.mjs";

const self = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(self), "..");
const restoreCli = path.join(root, "server", "cli", "restore.mjs");
const children = new Set();
const token = "fictional-lock-test-" + "x".repeat(32);
const configFor = (dataDir) => readConfig({ SHARED_TRIP_ADMIN_TOKEN: token, SHARED_TRIP_DATA_DIR: dataDir, SHARED_TRIP_PORT: "0" });
const inode = (file) => fs.statSync(file, { bigint: true }).ino.toString();

if (process.argv[2] === "child") runChild(process.argv[3]);
else await runTests();

// Child roles: "server" (full startServer) or "holder" (the shared lock module, as restore uses it).
function runChild(role) {
  const dataDir = process.env.SHARED_TRIP_DATA_DIR;
  let release = async () => undefined;
  process.on("message", async (message) => {
    if (message === "acquire") {
      try {
        if (role === "server") { const runtime = await startServer(configFor(dataDir)); release = () => runtime.close(); }
        else { const lock = acquireDataLock(dataDir); release = async () => lock.release(); }
        process.send({ acquired: true, pid: process.pid, ino: inode(dataLockPath(dataDir)) });
      } catch (error) { process.send({ acquired: false, code: error.code, message: error.message }); }
    } else if (message === "release") {
      const released = await release();
      process.send({ released: released ?? null });
      process.disconnect();
    }
  });
  // If the parent goes away, release normally (both release paths are idempotent) and let the child exit.
  process.once("disconnect", () => { release().catch(() => {}); });
  process.send({ ready: true });
}

function track(proc) {
  const exited = new Promise((resolve) => { proc.once("exit", resolve); proc.once("error", resolve); });
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
  proc.once("exit", (code, signal) => {
    gone = true;
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(role + " child exited (" + (code ?? signal) + ") before replying"));
  });
  const next = () => queue.length ? Promise.resolve(queue.shift())
    : gone ? Promise.reject(new Error(role + " child already exited"))
    : new Promise((resolve, reject) => waiters.push({ resolve, reject }));
  assert.deepEqual(await next(), { ready: true });
  return { exited, request: (message) => { proc.send(message); return next(); } };
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

async function seed(dataDir) {
  const runtime = await startServer(configFor(dataDir));
  runtime.service.createTrip({ requestId: "seed-" + path.basename(dataDir), trip: { title: "Fictional Lock Harbor" } });
  await runtime.close();
}

// File names plus inode and content hash of regular files. WAL/SHM sidecars are recorded by name only.
function fingerprint(dir) {
  return fs.readdirSync(dir).sort().map((name) => {
    const file = path.join(dir, name);
    const stat = fs.lstatSync(file, { bigint: true });
    if (!stat.isFile() || /-(?:wal|shm)$/.test(name)) return name;
    return name + ":" + stat.ino + ":" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  });
}

async function staleLockIsNeverReclaimed(temporary, snapshot) {
  const dir = path.join(temporary, "stale");
  await seed(dir);
  const lock = dataLockPath(dir);
  fs.writeFileSync(lock, String(await exitedPid()), { flag: "wx", mode: 0o600 });
  const before = fingerprint(dir);
  await assert.rejects(startServer(configFor(dir)), { code: "data_lock_held" });
  const contender = await launch("server", dir);
  assert.equal((await contender.request("acquire")).code, "data_lock_held");
  await contender.request("release"); await contender.exited;
  const restore = await runRestore(dir, snapshot);
  assert.notEqual(restore.code, 0, restore.output);
  assert.match(restore.output, /server\.lock/);
  assert.deepEqual(fingerprint(dir), before, "stale lock or data changed by a refused contender");
  fs.unlinkSync(lock); // documented manual recovery after verifying no owner runs
  const runtime = await startServer(configFor(dir));
  assert.equal(fs.readFileSync(lock, "utf8"), String(process.pid));
  assert.equal(runtime.service.listTrips().trips.length, 1);
  await runtime.close();
  assert.equal(fs.existsSync(lock), false);
}

async function liveOwnerBlocksRestoreAndStartup(temporary, snapshot) {
  const dir = path.join(temporary, "live");
  await seed(dir);
  const lock = dataLockPath(dir);
  const owner = await launch("server", dir);
  const held = await owner.request("acquire");
  assert.equal(held.acquired, true, held.message);
  const before = fingerprint(dir);
  const restore = await runRestore(dir, snapshot);
  assert.notEqual(restore.code, 0, restore.output);
  assert.match(restore.output, /server\.lock/);
  const second = await launch("server", dir);
  assert.equal((await second.request("acquire")).code, "data_lock_held");
  await second.request("release"); await second.exited;
  await assert.rejects(startServer(configFor(dir)), { code: "data_lock_held" });
  assert.throws(() => acquireDataLock(dir), { code: "data_lock_held" });
  assert.deepEqual(fingerprint(dir), before, "a refused contender changed the owner's lock or data");
  assert.equal(inode(lock), held.ino);
  assert.equal(fs.readFileSync(lock, "utf8"), String(held.pid));
  await owner.request("release"); await owner.exited;
  assert.equal(fs.existsSync(lock), false);
  const restored = await runRestore(dir, snapshot);
  assert.equal(restored.code, 0, restored.output);
  assert.equal(fs.existsSync(lock), false);
}

// Real concurrent contenders. The schedule varies between runs; the invariants checked do not.
async function contentionRound(temporary, snapshot, round) {
  const dir = path.join(temporary, "contention-" + round);
  fs.mkdirSync(dir);
  const lock = dataLockPath(dir);
  const contenders = await Promise.all(["server", "holder", "server", "server"].map((role) => launch(role, dir)));
  const restoring = runRestore(dir, snapshot);
  const results = await Promise.all(contenders.map((contender) => contender.request("acquire")));
  const restore = await restoring;
  const winners = results.filter((result) => result.acquired);
  for (const loser of results.filter((result) => !result.acquired)) assert.equal(loser.code, "data_lock_held", loser.message);
  assert.ok(winners.length <= 1, "more than one concurrent owner: " + JSON.stringify(winners));
  if (restore.code !== 0) assert.match(restore.output, /server\.lock/);
  assert.ok(winners.length === 1 || restore.code === 0, "nobody acquired an unlocked directory");
  if (winners.length) {
    // The winner's lock survived every loser and the restore contender.
    assert.equal(inode(lock), winners[0].ino);
    assert.equal(fs.readFileSync(lock, "utf8"), String(winners[0].pid));
  } else assert.equal(fs.existsSync(lock), false);
  for (const contender of contenders) { await contender.request("release"); await contender.exited; }
  assert.equal(fs.existsSync(lock), false);
}

async function replacedLockIsNotRemoved(temporary) {
  const dir = path.join(temporary, "replaced");
  const lock = dataLockPath(dir);
  const runtime = await startServer(configFor(dir));
  fs.unlinkSync(lock); // simulates a wrongful manual "recovery" while the owner is still alive
  const intruder = await launch("holder", dir);
  const replacement = await intruder.request("acquire");
  assert.equal(replacement.acquired, true, replacement.message);
  await Promise.all([runtime.close(), runtime.close()]);
  await runtime.close();
  assert.equal(inode(lock), replacement.ino, "cleanup of another owner removed the replacement lock");
  assert.equal(fs.readFileSync(lock, "utf8"), String(replacement.pid));
  assert.deepEqual(await intruder.request("release"), { released: true });
  await intruder.exited;
  assert.equal(fs.existsSync(lock), false);
  const own = acquireDataLock(dir);
  assert.equal(own.release(), true);
  assert.equal(own.release(), false);
  assert.equal(fs.existsSync(lock), false);
}

async function startupFailuresReleaseOwnLock(temporary) {
  const dir = path.join(temporary, "port-in-use");
  await seed(dir);
  const blocker = net.createServer();
  await new Promise((resolve, reject) => { blocker.once("error", reject); blocker.listen(0, "127.0.0.1", resolve); });
  try { await assert.rejects(startServer({ ...configFor(dir), port: blocker.address().port }), { code: "EADDRINUSE" }); }
  finally { await new Promise((resolve) => blocker.close(resolve)); }
  assert.equal(fs.existsSync(dataLockPath(dir)), false);
  const runtime = await startServer(configFor(dir));
  assert.equal(runtime.service.listTrips().trips.length, 1);
  await runtime.close();

  const broken = path.join(temporary, "unopenable");
  fs.mkdirSync(path.join(broken, "shared-trip.sqlite"), { recursive: true });
  await assert.rejects(startServer(configFor(broken)));
  assert.equal(fs.existsSync(dataLockPath(broken)), false);
  assert.ok(fs.statSync(path.join(broken, "shared-trip.sqlite")).isDirectory());
}

async function runTests() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "shared-trip-lock-"));
  try {
    const sourceDir = path.join(temporary, "source");
    await seed(sourceDir);
    const snapshot = path.join(temporary, "source.sqlite");
    await snapshotDatabase(path.join(sourceDir, "shared-trip.sqlite"), snapshot);
    await staleLockIsNeverReclaimed(temporary, snapshot);
    console.log("A dead-PID lock survives startup, child startup and restore; data unchanged; manual recovery works.");
    await liveOwnerBlocksRestoreAndStartup(temporary, snapshot);
    console.log("A live server's lock blocks restore and other startups without being modified.");
    for (let round = 0; round < 3; round++) await contentionRound(temporary, snapshot, round);
    console.log("Concurrent server/holder/restore contenders produce at most one owner and never delete its lock.");
    await replacedLockIsNotRemoved(temporary);
    console.log("Close and release are idempotent and never remove a replacement lock.");
    await startupFailuresReleaseOwnLock(temporary);
    console.log("Listen and database-open failures release only the owned lock.");
  } finally {
    for (const { proc, exited } of [...children]) { proc.kill(); await exited; }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
