import assert from "node:assert/strict";import fs from "node:fs";import path from "node:path";import os from "node:os";import crypto from "node:crypto";import {spawnSync} from "node:child_process";
import {startServer,readConfig} from "../server/app.mjs";import {hashPassword} from "../server/auth/passwords.mjs";import {openDatabase,validateSnapshot} from "../server/db.mjs";
import {TripMembership} from "../server/trip-membership.mjs";import {TripService} from "../server/domain/service.mjs";import {AuditLog} from "../server/audit.mjs";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-membership-cli-")),data=path.join(dir,"data"),planFile=path.join(dir,"private-plan.json"),env={...process.env,SHARED_TRIP_DATA_DIR:data};
for(const key of Object.keys(env))if(key.startsWith("SHARED_TRIP_")&&key!=="SHARED_TRIP_DATA_DIR")delete env[key];
let runtime=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:"fictional-cli-owner-000000000000000000",SHARED_TRIP_DATA_DIR:data,SHARED_TRIP_PORT:"0"}));
const cli=(file,args=[])=>spawnSync(process.execPath,[file,...args],{encoding:"utf8",env,windowsHide:true});
try{
 const users=[];for(const username of ["fictional.member","fictional.editor"]){const invite=runtime.accounts.createInvitation().invitation,passwordHash=await hashPassword("Fictional-password-00000");runtime.accounts.redeemInvitation({token:invite.token,username,passwordHash});const u=runtime.accounts.listAccounts().accounts.find(x=>x.username===username);runtime.accounts.approve(u.id);users.push(u);}
 runtime.accounts.setRole(users[1].id,{role:"content-manager"});
 const trip=runtime.service.createTrip({requestId:"cli-fixture",trip:{title:"Fictional membership matrix"}}).trip;
 let result=cli("server/cli/trip-membership-plan.mjs",["--database",path.join(data,"shared-trip.sqlite"),"--out",planFile]);assert.equal(result.status,0);
 const plan=JSON.parse(fs.readFileSync(planFile));assert.equal(plan.formatVersion,3);assert.equal(plan.rolloutApproved,false);assert.ok(plan.trips.every(t=>t.proposedChanges.length===0));
 plan.trips[0].proposedChanges=[{userId:users[0].id,role:"creator"},{userId:users[1].id,role:"member"}];
 fs.writeFileSync(planFile,JSON.stringify(plan));result=cli("server/cli/apply-trip-membership.mjs",[planFile,path.join(dir,"unapproved.sqlite")]);assert.notEqual(result.status,0);assert.equal(fs.existsSync(path.join(dir,"unapproved.sqlite")),false);
 plan.rolloutApproved=true;plan.formatVersion=2;fs.writeFileSync(planFile,JSON.stringify(plan));result=cli("server/cli/apply-trip-membership.mjs",[planFile,path.join(dir,"obsolete.sqlite")]);assert.notEqual(result.status,0);assert.equal(fs.existsSync(path.join(dir,"obsolete.sqlite")),false);
 plan.formatVersion=3;fs.writeFileSync(planFile,JSON.stringify(plan));result=cli("server/cli/apply-trip-membership.mjs",[planFile,path.join(dir,"locked.sqlite")]);assert.notEqual(result.status,0);assert.equal(fs.existsSync(path.join(dir,"locked.sqlite")),false);
 // Simulate interruption after the first approved operation; the CLI must resume its exact prefix.
 const input={...plan.trips[0].proposedChanges[0],expectedAccessVersion:plan.trips[0].accessVersion};input.requestId="membership-plan-"+crypto.createHash("sha256").update(JSON.stringify({tripId:trip.id,tripVersion:trip.version,...input})).digest("hex").slice(0,40);
 new TripMembership(runtime.service,runtime.audit,{channel:"operator"}).assign({role:"owner",via:"operator"},trip.id,input);
 const before=JSON.stringify(runtime.db.prepare("SELECT * FROM trips ORDER BY id").all()),accounts=JSON.stringify(runtime.db.prepare("SELECT * FROM users ORDER BY id").all());
 fs.writeFileSync(path.join(data,"google-allowance.sqlite"),"Fictional untouched external allowance");const allowance=fs.readFileSync(path.join(data,"google-allowance.sqlite"));await runtime.close();runtime=null;
 const backup=path.join(dir,"accepted.sqlite");result=cli("server/cli/apply-trip-membership.mjs",[planFile,backup]);assert.equal(result.status,0,result.stderr);validateSnapshot(backup);
 let db=openDatabase(path.join(data,"shared-trip.sqlite"));assert.equal(JSON.stringify(db.prepare("SELECT * FROM trips ORDER BY id").all()),before);assert.equal(JSON.stringify(db.prepare("SELECT * FROM users ORDER BY id").all()),accounts);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trip_members WHERE trip_id=?").get(trip.id).n,2);const revision=db.prepare("SELECT revision FROM trip_access WHERE trip_id=?").get(trip.id).revision;assert.equal(revision,3);assert.ok(db.prepare("SELECT channel,actor FROM audit_log WHERE action='membership.assign'").all().every(e=>e.channel==="operator"&&e.actor==="operator"));db.close();
 result=cli("server/cli/apply-trip-membership.mjs",[planFile,path.join(dir,"retry.sqlite")]);assert.equal(result.status,0);db=openDatabase(path.join(data,"shared-trip.sqlite"));assert.equal(db.prepare("SELECT revision FROM trip_access WHERE trip_id=?").get(trip.id).revision,revision);db.close();assert.ok(fs.readFileSync(path.join(data,"google-allowance.sqlite")).equals(allowance));
 plan.trips[0].tripVersion++;fs.writeFileSync(planFile,JSON.stringify(plan));result=cli("server/cli/apply-trip-membership.mjs",[planFile,path.join(dir,"stale.sqlite")]);assert.notEqual(result.status,0);
 assert.ok(!result.stdout.includes(users[0].id));
 console.log("Private membership plan/apply CLI passed: explicit finite ordinary membership rows, approval and offline lock, validated backup, whole-matrix preflight, interrupted prefix and durable replay, stale-version refusal, exact trip/account preservation and untouched external allowance. Fictional only.");
}finally{await runtime?.close();fs.rmSync(dir,{recursive:true,force:true});}
