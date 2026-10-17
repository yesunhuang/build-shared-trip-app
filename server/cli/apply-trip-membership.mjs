// Offline owner-approved finite private membership matrix only; no role or credential changes.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {openDatabase,snapshotDatabase,SCHEMA_VERSION} from "../db.mjs";
import {acquireDataLock} from "../data-lock.mjs";
import {TripService} from "../domain/service.mjs";import {TripMembership} from "../trip-membership.mjs";
import {AuditLog} from "../audit.mjs";import {isValidId} from "../domain/validate.mjs";
import {ACCOUNT_ID_PATTERN} from "../auth/accounts.mjs";
const inside=(file,root)=>{const rel=path.relative(root,file);return rel===""||(!rel.startsWith(".."+path.sep)&&rel!==".."&&!path.isAbsolute(rel));};
function target(file){let parent=file;const rest=[];while(!fs.existsSync(parent)){rest.unshift(path.basename(parent));parent=path.dirname(parent);}return path.resolve(fs.realpathSync(parent),...rest);}
let lock,db;
try{
 const [planArg,backupArg,...extra]=process.argv.slice(2),dataArg=process.env.SHARED_TRIP_DATA_DIR;
 if(!planArg||!backupArg||extra.length||!dataArg)throw Error("arguments");
 const root=fs.realpathSync(path.resolve(import.meta.dirname,"../..")),dataDir=fs.realpathSync(dataArg),planFile=fs.realpathSync(planArg),backup=target(path.resolve(backupArg));
 if([dataDir,planFile,backup].some(file=>inside(file,root))||fs.existsSync(backup)||fs.statSync(planFile).size>262144)throw Error("private_paths");
 const plan=JSON.parse(fs.readFileSync(planFile,"utf8"));
 if(plan.format!=="shared-trip-membership-dry-run"||plan.formatVersion!==3||plan.rolloutApproved!==true||!Array.isArray(plan.accounts)||!Array.isArray(plan.trips)||plan.trips.length>100)throw Error("unapproved_plan");
 const actions=[],ids=new Set();
 for(const trip of plan.trips){
  if(!isValidId(trip.tripId)||ids.has(trip.tripId)||!Number.isSafeInteger(trip.tripVersion)||trip.tripVersion<1||!Number.isSafeInteger(trip.accessVersion)||trip.accessVersion<1||!Array.isArray(trip.proposedChanges)||trip.proposedChanges.length>100||!Number.isSafeInteger(trip.accessVersion+trip.proposedChanges.length))throw Error("invalid_plan");ids.add(trip.tripId);
  const users=new Set();
  trip.proposedChanges.forEach((change,index)=>{
   if(!change||Object.keys(change).some(k=>!["userId","role"].includes(k))||!ACCOUNT_ID_PATTERN.test(change.userId)||users.has(change.userId)||!["member","creator","remove"].includes(change.role))throw Error("invalid_assignment");users.add(change.userId);
   const input={userId:change.userId,role:change.role,expectedAccessVersion:trip.accessVersion+index};
   input.requestId="membership-plan-"+crypto.createHash("sha256").update(JSON.stringify({tripId:trip.tripId,tripVersion:trip.tripVersion,...input})).digest("hex").slice(0,40);actions.push({trip,input});
  });
  if(trip.proposedChanges.filter(c=>c.role==="creator").length>1)throw Error("multiple_creators");
 }
 if(!actions.length)throw Error("empty_plan");
 lock=acquireDataLock(dataDir);const file=path.join(dataDir,"shared-trip.sqlite"),peek=new DatabaseSync(file,{readOnly:true});
 try{if(peek.prepare("PRAGMA user_version").get().user_version!==SCHEMA_VERSION)throw Error("upgrade_required");}finally{peek.close();}
 await snapshotDatabase(file,backup);db=openDatabase(file);
 // Preflight the entire matrix, including restart-safe applied prefixes, before the first write.
 for(const trip of plan.trips){
  const row=db.prepare("SELECT version FROM trips WHERE id=?").get(trip.tripId),access=db.prepare("SELECT revision FROM trip_access WHERE trip_id=?").get(trip.tripId);
  if(!row||row.version!==trip.tripVersion||!access)throw Error("stale_trip");
  let applied=0,gap=false;
  for(const {input} of actions.filter(a=>a.trip===trip)){
   const prior=db.prepare("SELECT 1 FROM request_log WHERE scope=? AND request_id=?").get("membership:"+trip.tripId,input.requestId);
   if(prior){if(gap)throw Error("noncontiguous_retry");applied++;}else gap=true;
   const user=db.prepare("SELECT role,status FROM users WHERE id=?").get(input.userId),reviewed=plan.accounts?.find(a=>a.id===input.userId);if(!user||!reviewed||reviewed.role!==user.role||reviewed.status!==user.status||(input.role!=="remove"&&user.status!=="approved"))throw Error("account_changed");
  }
  if(access.revision!==trip.accessVersion+applied)throw Error("stale_access");
 }
 const before=JSON.stringify(db.prepare("SELECT * FROM trips ORDER BY id").all()),audit=new AuditLog(db),store=new TripMembership(new TripService(db),{record(event){if(JSON.stringify(db.prepare("SELECT * FROM trips ORDER BY id").all())!==before)throw Error("content_changed");audit.record(event);}},{channel:"operator"});
 for(const {trip,input} of actions)store.assign({role:"owner",via:"operator"},trip.tripId,input);
 console.log(JSON.stringify({applied:true,operations:actions.length,contentUnchanged:true,backupValidated:true}));
}catch(error){const code=typeof error.code==="string"&&/^[a-z_]+$/.test(error.code)?error.code:"maintenance_refused";console.error("Membership matrix refused or interrupted ("+code+"). Preserve the private plan and backup; completed operations remain durably retryable. No role or credential configuration is changed.");process.exitCode=1;}
finally{try{db?.close();}finally{lock?.release();}}
