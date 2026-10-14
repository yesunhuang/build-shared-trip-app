// Exclusive ownership of a data directory, shared by the service and the restore CLI.
//
// Ownership is taken only by exclusively creating <dataDir>/server.lock (open "wx", i.e. O_CREAT|O_EXCL)
// and writing the owner's decimal PID: the same path and format as earlier releases.
//
// An existing lock is never removed or reclaimed automatically, even when its PID looks dead. A
// liveness check cannot be made atomic with the unlink. Two contenders can both see a dead owner,
// and the slower one would delete the faster one's fresh lock. Recovery after a crash is therefore
// manual: see references/self-hosted.md#data-directory-lock.
//
// release() removes the lock only if the path still names the file this process created (same
// device and inode). The descriptor stays open while ownership lasts, so the filesystem cannot reuse
// that inode for a replacement file. The remaining check-then-unlink window matters only if someone
// deletes and recreates the lock while this owner is still running. The documented recovery
// procedure forbids that.
import fs from "node:fs";
import path from "node:path";

export const DATA_LOCK_FILE = "server.lock";
export const dataLockPath = (dataDir) => path.join(dataDir, DATA_LOCK_FILE);

export class DataLockHeldError extends Error {
  constructor(lockPath) {
    let recorded = "unknown";
    try { recorded = fs.readFileSync(lockPath, "utf8").trim() || "unknown"; } catch { /* informational only */ }
    super("Data directory is in use or was not shut down cleanly: " + lockPath + " exists (recorded process " + recorded + "). " +
      "Stop the service or restore that uses this directory. If you have verified that every such process has stopped, " +
      "delete this file manually and retry; it is never removed automatically.");
    this.name = "DataLockHeldError";
    this.code = "data_lock_held";
    this.lockPath = lockPath;
  }
}

function removeIfSame(lockPath, identity) {
  let current;
  try { current = fs.lstatSync(lockPath, { bigint: true }); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
  if (current.dev !== identity.dev || current.ino !== identity.ino) return false;
  fs.unlinkSync(lockPath);
  return true;
}

/** Acquire the lock or throw DataLockHeldError (code "data_lock_held") without touching the existing file. */
export function acquireDataLock(dataDir) {
  const lockPath = dataLockPath(dataDir);
  let fd;
  try { fd = fs.openSync(lockPath, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") throw new DataLockHeldError(lockPath); throw error; }
  let identity;
  try {
    identity = fs.fstatSync(fd, { bigint: true });
    fs.writeSync(fd, String(process.pid));
  } catch (error) {
    try { if (identity) removeIfSame(lockPath, identity); } finally { fs.closeSync(fd); }
    throw error;
  }
  let released = false;
  return {
    path: lockPath,
    /** Idempotent. Returns true only when this call removed the file this owner created. */
    release() {
      if (released) return false;
      released = true;
      try { return removeIfSame(lockPath, identity); }
      finally { fs.closeSync(fd); }
    }
  };
}
