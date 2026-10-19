// Actual isolated rollback rehearsal: prior public UI + current schema/ACL/share backend.
// Never run an older backend against the newer database or restore historical live data.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync,spawn} from "node:child_process";
import {readConfig,startServer} from "../server/app.mjs";
import {snapshotDatabase,validateSnapshot} from "../server/db.mjs";
import {logoObject} from "./fixtures/branding.mjs";
const repo=path.resolve(import.meta.dirname,".."),root=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-sharing-rollback-"));
const option=process.argv.indexOf("--prior-ref"),prior=option>=0?process.argv[option+1]:"349b2e9fe1b88305f1b2b25c7cfcc87adbb383c3";
const original=path.join(root,"accepted"),restored=path.join(root,"restored"),source=path.join(root,"compatible"),secret=crypto.randomBytes(32).toString("base64url");
const envFor=directory=>({...process.env,SHARED_TRIP_ADMIN_TOKEN:secret,SHARED_TRIP_DATA_DIR:directory,SHARED_TRIP_HOST:"127.0.0.1",SHARED_TRIP_PORT:"0",SHARED_TRIP_ORIGIN:"",SHARED_TRIP_OAUTH_USERNAME:"",SHARED_TRIP_OAUTH_MULTIUSER:"0",SHARED_TRIP_LOOKUPS_ENABLED:"0",SHARED_TRIP_GOOGLE_PLACES_UI_KIT:"0"});
let runtime,child;
async function api(url,route,body){const r=await fetch(url+route,{method:body===undefined?"GET":"POST",headers:{Authorization:"Bearer "+secret,...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(r.ok,route+" "+r.status+(!r.ok?" "+await r.clone().text():""));return r.json();}
const read=async(url,id,token)=>fetch(`${url}/guest/trips/${id}`,{headers:{"X-Trip-Share":token}});
const rows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,JSON.stringify(db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all())]));
try{
 runtime=await startServer(readConfig(envFor(original)));
 const trip=(await api(runtime.url,"/api/trips",{requestId:"fictional-rollback-create",trip:{title:"Fictional rollback journey",days:[{id:"day",date:"2032-06-01",slots:[{id:"plan",name:"Fictional photo stop",uploadedPhoto:logoObject()}]}]}})).trip;
 const issue=async()=>{const s=(await api(runtime.url,`/api/trips/${trip.id}/sharing`)).sharing;return api(runtime.url,`/api/trips/${trip.id}/sharing`,{expectedShareVersion:s.version,expiresAt:null});};
 const old=await issue(),active=await issue();assert.equal((await read(runtime.url,trip.id,old.token)).status,404);
 await api(runtime.url,`/api/trips/${trip.id}/changes`,{requestId:"fictional-later-edit",expectedVersion:trip.version,changes:[{type:"update_trip",fields:{title:"Fictional later saved edit"}}]});
 const content=(await api(runtime.url,`/api/trips/${trip.id}`)).trip,before=rows(runtime.db);
 const snapshot=path.join(root,"current.sqlite");await snapshotDatabase(path.join(original,"shared-trip.sqlite"),snapshot);validateSnapshot(snapshot);await runtime.close();runtime=null;
 // The supported restore path must accept v9 and retain sharing state alongside all older rows.
 execFileSync(process.execPath,[path.join(repo,"server/cli/restore.mjs"),snapshot],{env:envFor(restored),stdio:"pipe"});
 fs.mkdirSync(source,{recursive:true});fs.cpSync(path.join(repo,"server"),path.join(source,"server"),{recursive:true});fs.copyFileSync(path.join(repo,"package.json"),path.join(source,"package.json"));fs.symlinkSync(path.join(repo,"node_modules"),path.join(source,"node_modules"),"dir");
 const files=execFileSync("git",["ls-tree","-r","--name-only",prior,"assets/app-template/public","assets/selfhosted"],{cwd:repo,encoding:"utf8"}).trim().split("\n");
 for(const filename of files){const target=path.join(source,filename);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,execFileSync("git",["show",prior+":"+filename],{cwd:repo}));}
 // Retain the current guest reader and all security-sensitive media/route enforcement.
 for(const filename of ["guest.html","guest.js","guest.css"]){fs.copyFileSync(path.join(repo,"assets/selfhosted",filename),path.join(source,"assets/selfhosted",filename));}
 const code="import {readConfig,startServer} from './server/app.mjs';const r=await startServer(readConfig());console.log(JSON.stringify({url:r.url}));process.on('SIGTERM',async()=>{await r.close();process.exit(0)});";
 child=spawn(process.execPath,["--input-type=module","-e",code],{cwd:source,env:envFor(restored),stdio:["ignore","pipe","pipe"]});
 const url=await new Promise((resolve,reject)=>{let text="",error="";const timer=setTimeout(()=>reject(Error("Compatible service startup timeout")),15000);child.stderr.on("data",v=>error+=v);child.once("exit",code=>{clearTimeout(timer);reject(Error("Compatible service exited "+code+" "+error.slice(0,250)));});child.stdout.on("data",v=>{text+=v;const line=text.split("\n").find(v=>v.startsWith('{"url":'));if(line){clearTimeout(timer);resolve(JSON.parse(line).url);}});});
 assert.deepEqual((await api(url,`/api/trips/${trip.id}`)).trip,content,"compatible backend preserves later content");
 const priorApp=execFileSync("git",["show",prior+":assets/app-template/public/app.js"],{cwd:repo,encoding:"utf8"}),servedApp=await (await fetch(url+"/app.js")).text();
 assert.equal(servedApp.replace(/(?<=\?v=)[a-f0-9]{12}/g,"__CACHE_VERSION__"),priorApp,"actual compatible service serves the prior frontend");
 const guest=await read(url,trip.id,active.token);assert.equal(guest.status,200);const dto=await guest.json();assert.equal(dto.trip.title,content.title);assert.equal((await read(url,trip.id,old.token)).status,404);
 const image=dto.trip.days[0].slots[0].photo.url;assert.equal((await fetch(url+image,{headers:{"X-Trip-Share":active.token}})).status,200);
 const share=(await api(url,`/api/trips/${trip.id}/sharing`)).sharing;await api(url,`/api/trips/${trip.id}/sharing/revoke`,{expectedShareVersion:share.version});assert.equal((await read(url,trip.id,active.token)).status,404);assert.equal((await fetch(url+image,{headers:{"X-Trip-Share":active.token}})).status,404);
 await new Promise(resolve=>{child.once("exit",resolve);child.kill("SIGTERM");});child=null;
 runtime=await startServer(readConfig(envFor(restored)));assert.deepEqual((await api(runtime.url,`/api/trips/${trip.id}`)).trip,content);assert.equal((await read(runtime.url,trip.id,active.token)).status,404,"roll-forward retains the later revocation");
 const after=rows(runtime.db);for(const table of Object.keys(before))if(!["trip_shares","audit_log"].includes(table))assert.equal(after[table],before[table],"preserved table "+table);
 validateSnapshot(path.join(restored,"shared-trip.sqlite"));console.log("Sharing compatible rollback passed: actual prior UI/current security backend service, v9 snapshot/restore, retained later edits and rotation, authenticated reads, capability/image checks, later revocation and roll-forward preservation. Fictional local storage only; no container or live rollout claim.");
}finally{if(child){await new Promise(resolve=>{child.once("exit",resolve);child.kill("SIGTERM");});}await runtime?.close();fs.rmSync(root,{recursive:true,force:true});}
