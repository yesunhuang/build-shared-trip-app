import path from "node:path";
import { snapshotDatabase } from "../db.mjs";
try {
  if (!process.env.SHARED_TRIP_DATA_DIR || !process.argv[2]) throw new Error("Usage: SHARED_TRIP_DATA_DIR=<outside-checkout> npm run backup -- <new-snapshot-file>");
  await snapshotDatabase(path.resolve(process.env.SHARED_TRIP_DATA_DIR,"shared-trip.sqlite"),path.resolve(process.argv[2]));
  console.log("Consistent database snapshot created and validated.");
} catch(error){console.error(error.message);process.exitCode=1;}
