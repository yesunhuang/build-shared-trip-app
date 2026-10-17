#!/usr/bin/env node
// Dry run only. Does not call openDatabase (which migrates) and cannot apply permissions.
import fs from "node:fs";import path from "node:path";import crypto from "node:crypto";import {DatabaseSync} from "node:sqlite";
const args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!["--database","--out"].includes(args[i])||!args[i+1]||options[args[i]])throw new Error("Use --database <private SQLite file> --out <new private plan file>. Dry run only.");options[args[i]]=args[i+1];}
if(!options["--database"]||!options["--out"])throw new Error("Use --database <private SQLite file> --out <new private plan file>. Dry run only.");
const root=fs.realpathSync(path.resolve(import.meta.dirname,"../..")),destination=path.resolve(options["--out"]),database=fs.realpathSync(path.resolve(options["--database"]));
function resolvedTarget(file){let parent=file;const suffix=[];while(!fs.existsSync(parent)){suffix.unshift(path.basename(parent));parent=path.dirname(parent);}return path.resolve(fs.realpathSync(parent),...suffix);}
for(const file of [destination,database]){const relative=path.relative(root,resolvedTarget(file));if(relative===""||(!relative.startsWith(".."+path.sep)&&relative!==".."&&!path.isAbsolute(relative)))throw new Error("Database and migration plan must stay outside the public checkout.");}
if(fs.existsSync(destination))throw new Error("Refusing to overwrite an existing plan.");
const db=new DatabaseSync(database,{readOnly:true});
try{
 db.exec("BEGIN");if(db.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")throw new Error("Invalid source database.");
 const version=db.prepare("PRAGMA user_version").get().user_version;if(version<4||version>7)throw new Error("Unsupported source schema.");
 // Inspect access-relevant public account columns only. Never read credential or OAuth tables.
 const digest=crypto.createHash("sha256");
 const accounts=db.prepare("SELECT id,username,role,status FROM users ORDER BY username").all();
 const trips=db.prepare("SELECT id,version,archived,json_extract(data,'$.title') AS title FROM trips ORDER BY id").all().map(row=>{const state=version>=7?db.prepare("SELECT creator,revision FROM trip_access WHERE trip_id=?").get(row.id):null;return {tripId:row.id,tripVersion:row.version,archived:Boolean(row.archived),title:row.title,creator:state?.creator??null,accessVersion:state?.revision??1,members:version>=7?db.prepare("SELECT user_id AS userId FROM trip_members WHERE trip_id=? ORDER BY user_id").all(row.id):[],proposedChanges:[]};});
 digest.update(JSON.stringify({accounts,trips}));
 const plan={format:"shared-trip-membership-dry-run",formatVersion:3,sourceSchema:version,sourceAccessStateDigest:digest.digest("hex"),fingerprintScope:"Trip identity/version/archive/title, public account fields and membership/creator metadata; excludes credentials, OAuth and itinerary payloads.",generatedAt:new Date().toISOString(),applied:false,rolloutApproved:false,ownerAllTripAccess:"preserved",existingContentManagers:"member_trips_only_without_credential_or_grant_change",accounts,ordinaryAccounts:accounts.filter(u=>u.role==="viewer"),contentManagers:accounts.filter(u=>u.role==="content-manager"),trips,decisionsRequired:["Apply only the owner-approved private finite per-trip matrix through ordinary membership rows; never enroll an assistant in future trips automatically.","Explicit creator assignment where desired; legacy ownership is unknown.","Only the owner administrator has global access; every content manager edits member trips only.","Confirm schema-v7 rollout and a rollback image retaining owner-only global access and current membership enforcement."]};
 db.exec("COMMIT");fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});fs.writeFileSync(destination,JSON.stringify(plan,null,2)+"\n",{flag:"wx",mode:0o600});
 console.log(JSON.stringify({dryRun:true,applied:false,sourceSchema:version,trips:trips.length,ordinaryAccountDecisions:plan.ordinaryAccounts.filter(u=>u.status==="approved").length,existingCreatorsInferred:0,newMemberships:0,liveCodesIssued:0}));
}finally{db.close();}
