import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { snapshotDatabase, validateSnapshot, openDatabase } from "../db.mjs";
import { readConfig } from "../app.mjs";
import { acquireDataLock } from "../data-lock.mjs";
let lock = null;
try {
  if(!process.argv[2])throw new Error("Usage: SHARED_TRIP_DATA_DIR=<outside-checkout> npm run restore -- <snapshot-file>");
  const config=readConfig({...process.env,SHARED_TRIP_ADMIN_TOKEN:"restore-placeholder-"+"x".repeat(32)});
  const source=path.resolve(process.argv[2]);validateSnapshot(source);
  const target=path.join(config.dataDir,"shared-trip.sqlite");
  if(source===target)throw new Error("Restore source must differ from the target.");
  // Held from before staging until after the final rename. An existing lock is never removed here.
  lock=acquireDataLock(config.dataDir);
  const staging=target+".restore-"+Date.now();
  await snapshotDatabase(source,staging);
  const replacement=openDatabase(staging);replacement.close();validateSnapshot(staging);
  if(fs.existsSync(target)){
    await snapshotDatabase(target,target+".before-restore-"+Date.now());
    const prior=new DatabaseSync(target);prior.exec("PRAGMA wal_checkpoint(TRUNCATE)");prior.close();
  }
  fs.renameSync(staging,target);
  console.log("Snapshot restored and validated; prior target snapshot retained when present.");
}catch(error){console.error(error.message);process.exitCode=1;}
finally {
  try { lock?.release(); }
  catch (error) { console.error("Could not release "+lock.path+": "+error.message); process.exitCode=1; }
}
