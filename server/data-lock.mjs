// Exclusive ownership of a data directory, shared by the service and the restore CLI.
//
// File layout inside <dataDir>:
//
//   server-ownership.sqlite  Authority. A persistent, normally zero-byte SQLite database, which
//                            SQLite treats as a valid empty database. An owner opens it with
//                            journal_mode=DELETE (rollback journal, never WAL), busy_timeout=0,
//                            and runs BEGIN EXCLUSIVE. It keeps that transaction open for its whole
//                            lifetime without writing anything. The EXCLUSIVE lock is an OS
//                            byte-range lock: fcntl on POSIX, LockFileEx on Windows. See
//                            https://www.sqlite.org/lockingv3.html. The OS drops it when the
//                            process exits for any reason, including SIGKILL, OOM, or a crash. A
//                            later contender's BEGIN EXCLUSIVE then succeeds without any file being
//                            deleted. Nothing in this module ever writes, truncates, or unlinks the
//                            file. Creating it is a single create-if-absent of an empty file, so a
//                            crash during first creation leaves an empty file, which is still a
//                            valid database. It is separate from shared-trip.sqlite, so trip
//                            transactions and their WAL are unaffected.
//
//   server-ownership.sqlite-journal
//                            Owned by SQLite only; this module never opens, reads, or unlinks it.
//                            A write transaction on a zero-page database makes SQLite stage page 1
//                            in its cache (btree newDatabase), and that creates the rollback journal.
//                            So the journal exists for as long as an owner holds the lock. It records
//                            no pages, because SQLite journals only pages that existed when the
//                            transaction began, and the database file stays zero bytes because
//                            nothing is committed. ROLLBACK on release() deletes the journal. After a
//                            hard kill it stays behind. That is not a hot journal: SQLite's
//                            hasHotJournal() (pager.c) treats a journal next to a zero-page database
//                            as removable, and the next connection deletes it itself, but only after
//                            confirming that no connection holds a RESERVED lock and while it holds
//                            RESERVED. A contender that is refused while an owner lives never gets a
//                            SHARED lock, so it never reaches that step.
//
//   server.lock              Compatibility marker for releases that used the PID-file lock. The
//                            first line is the owner's decimal PID, so those releases see an
//                            existing lock and refuse to start. The second line tags the file as
//                            this mechanism's marker and records the ownership database's file ID.
//                            The file is never interpreted as ownership: it is installed, replaced,
//                            or removed only while this process holds the SQLite lock above.
//
// Acquisition, all synchronous:
//   1. Create server-ownership.sqlite if it is absent (O_EXCL; an existing file is never opened by fs).
//   2. Take the SQLite EXCLUSIVE lock. If another process holds it, fail with
//      DataLockHeldError(reason "owned") immediately; no other file is touched.
//   3. Holding the lock, inspect server.lock:
//      - absent: link a fully written temporary marker into place. link fails if the file appears in
//        the meantime, so the create is atomic and never overwrites.
//      - our marker naming this same ownership file: its writer must be dead, because we hold the
//        lock, so atomically rename a fresh marker over it.
//      - anything else (a legacy PID lock, an empty or unknown file, or a marker naming a different
//        ownership file): refuse with DataLockHeldError(reason "foreign_lock"), leave it unchanged,
//        and release the SQLite lock.
//   There is no PID liveness check and no check-then-unlink reclamation. Recovery of a dead owner's
//   state happens only under the OS lock, which a live owner cannot lose.
//
// release() removes the marker if it still has this owner's exact content. It then rolls back and
// closes the ownership connection. Repeated calls return false.
//
// Caveats:
//   - POSIX fcntl locks belong to the process. Closing any descriptor this process holds on
//     server-ownership.sqlite drops every lock the process holds on it. SQLite coordinates its own
//     connections, but other code in an owner process must never fs.open/read that file. stat is fine.
//   - Network filesystems and some VM/container shared folders do not reliably implement these
//     locks (see the SQLite FAQ). Use local storage. Hard links are required for the marker.
//   - Windows documents that locks of a terminated process are released by the OS, but that the time
//     it takes "depends upon available system resources". Under unusual load, a contender started
//     right after a hard kill may therefore be refused once and need to be retried.
//   - Mixed versions are not coordinated. Upgrade: stop every older service and restore first. A
//     leftover legacy server.lock is refused and must be deleted manually after you verify that its
//     owner has stopped. Rollback: stop every new-release process first. A crashed new owner leaves
//     a marker, which older releases also refuse until it is deleted manually. Older releases do not
//     know about server-ownership.sqlite. Releases before the fail-closed PID lock reclaimed dead
//     PIDs, and how they parse this two-line marker cannot be verified here; never run them
//     alongside this release.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export const DATA_OWNERSHIP_FILE = "server-ownership.sqlite";
export const DATA_LOCK_FILE = "server.lock";
export const dataOwnershipPath = (dataDir) => path.join(dataDir, DATA_OWNERSHIP_FILE);
export const dataLockPath = (dataDir) => path.join(dataDir, DATA_LOCK_FILE);

const MARKER_TAG = "shared-trip-ownership-v1";
const MARKER_PATTERN = /^(\d+)\nshared-trip-ownership-v1 owner=(\d+) nonce=([0-9a-f]{32})\n$/;
const TEMP_PATTERN = /^server\.lock\.[0-9a-f]{32}\.tmp$/;
const SQLITE_BUSY = 5;

// Strong references to live owners. Garbage collection of an open connection would release the lock.
const owners = new Set();

export class DataLockHeldError extends Error {
  constructor(reason, filePath, recorded) {
    super(reason === "owned"
      ? "Data directory is in use by another running service or restore (it holds the lock on " + filePath + "). " +
        "Stop that process and retry. Do not delete " + DATA_OWNERSHIP_FILE + " or " + DATA_LOCK_FILE +
        "; ownership is released automatically when its process exits, including after a crash."
      : "Data directory has a " + DATA_LOCK_FILE + " that this release cannot attribute to a stopped owner: " + filePath +
        " (content " + describe(recorded) + "). It may belong to a running older release or another process. " +
        "Stop every service and restore that uses this directory, then, after verifying none is running, delete " +
        DATA_LOCK_FILE + " manually and retry. It is never removed automatically.");
    this.name = "DataLockHeldError";
    this.code = "data_lock_held";
    this.reason = reason;
    this.lockPath = filePath;
  }
}

function describe(content) {
  if (content === null || content === undefined) return "unavailable";
  return "unrecognized or legacy marker";
}

function readIfPresent(file) {
  try { return fs.readFileSync(file, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

// stat never opens a descriptor, so it cannot drop this process's POSIX locks.
const fileId = (file) => fs.statSync(file, { bigint: true }).ino.toString();

function ensureOwnershipFile(file) {
  // A brand-new inode cannot carry locks, so closing this descriptor is safe. If the file already
  // exists, open fails with EEXIST without creating a descriptor.
  try { fs.closeSync(fs.openSync(file, "wx", 0o600)); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}

function isBusy(error) {
  return ((Number(error?.errcode) & 0xff) === SQLITE_BUSY) || /database is locked/i.test(String(error?.message));
}

function closeConnection(db) {
  try { db.exec("ROLLBACK"); }
  catch { /* no open transaction */ }
  finally { db.close(); }
}

function lockOwnershipDatabase(file) {
  let db;
  try {
    db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout=0");
    const mode = db.prepare("PRAGMA journal_mode=DELETE").get()?.journal_mode;
    if (mode !== "delete") throw new Error("Ownership database " + file + " could not use the rollback journal (journal_mode " + mode + ").");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch (error) {
    if (db) { try { closeConnection(db); } catch { /* report the original failure */ } }
    if (isBusy(error)) throw new DataLockHeldError("owned", file);
    throw error;
  }
}

// Every marker temporary is created only by a lock holder. While we hold the lock, any match is
// debris from a holder that died between creating and placing it.
function removeStaleTemporaries(dataDir) {
  for (const name of fs.readdirSync(dataDir)) {
    if (!TEMP_PATTERN.test(name)) continue;
    try { fs.unlinkSync(path.join(dataDir, name)); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

function installMarker(dataDir, ownershipId) {
  const lockPath = dataLockPath(dataDir);
  const existing = readIfPresent(lockPath);
  if (existing !== null && MARKER_PATTERN.exec(existing)?.[2] !== ownershipId) throw new DataLockHeldError("foreign_lock", lockPath, existing);
  const nonce = crypto.randomBytes(16).toString("hex");
  const content = process.pid + "\n" + MARKER_TAG + " owner=" + ownershipId + " nonce=" + nonce + "\n";
  const temporary = path.join(dataDir, DATA_LOCK_FILE + "." + nonce + ".tmp");
  fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
  try {
    if (existing === null) fs.linkSync(temporary, lockPath); // never overwrites a file created meanwhile
    else fs.renameSync(temporary, lockPath); // atomically replaces the dead predecessor's marker
  } catch (error) {
    if (error.code === "EEXIST") throw new DataLockHeldError("foreign_lock", lockPath, readIfPresent(lockPath));
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* renamed away, or collected by the next owner */ }
  }
  return content;
}

function removeMarkerIfOwn(lockPath, content) {
  if (readIfPresent(lockPath) !== content) return false; // missing or replaced: leave it alone
  try { fs.unlinkSync(lockPath); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

/**
 * Acquire exclusive ownership of dataDir, synchronously. Throws DataLockHeldError (code "data_lock_held")
 * without changing existing files when another process owns the directory or a foreign server.lock exists.
 * A previously absent, empty ownership database may be created before a foreign marker is rejected.
 * Returns { path, ownershipPath, release() }.
 */
export function acquireDataLock(dataDir) {
  const ownershipPath = dataOwnershipPath(dataDir);
  const lockPath = dataLockPath(dataDir);
  ensureOwnershipFile(ownershipPath);
  const before = fileId(ownershipPath);
  const db = lockOwnershipDatabase(ownershipPath);
  let content;
  try {
    const ownershipId = fileId(ownershipPath);
    if (ownershipId !== before) throw new Error("Ownership database " + ownershipPath + " was replaced during acquisition; nothing was changed. Retry after checking the data directory.");
    removeStaleTemporaries(dataDir);
    content = installMarker(dataDir, ownershipId);
  } catch (error) {
    try { closeConnection(db); } catch { /* report the original failure */ }
    throw error;
  }
  let released = false;
  const handle = {
    path: lockPath,
    ownershipPath,
    /** Idempotent. Returns true only for the call that released ownership. */
    release() {
      if (released) return false;
      released = true;
      try { removeMarkerIfOwn(lockPath, content); } // still under the lock, so no other owner can be racing
      finally {
        owners.delete(handle);
        closeConnection(db);
      }
      return true;
    }
  };
  owners.add(handle);
  return handle;
}
