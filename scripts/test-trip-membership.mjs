// Real HTTP, SQLite and official MCP SDK; all accounts, codes, artwork and media are fictional.
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {execFileSync} from "node:child_process";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {startServer,readConfig} from "../server/app.mjs";
import {hashPassword} from "../server/auth/passwords.mjs";
import {snapshotDatabase,validateSnapshot,openDatabase} from "../server/db.mjs";
import {ContentGateway} from "../server/content-access.mjs";
import {TripService} from "../server/domain/service.mjs";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-trip-members-")),token="fictional-membership-owner-000000000000000",password="Fictional-account-password-only";
const config={...readConfig({SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:dir,SHARED_TRIP_PORT:"0",SHARED_TRIP_HOST:"127.0.0.1"}),clock:()=>Date.parse("2031-06-11T01:00:00Z")};
let runtime=await startServer(config),mcp;
const owner={Authorization:"Bearer "+token};
async function call(route,body,authHeaders=owner,method=body===undefined?"GET":"POST"){
 const r=await fetch(runtime.url+route,{method,headers:{...authHeaders,Origin:runtime.url,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});const text=method==="HEAD"?"":await r.text();let data;try{data=JSON.parse(text);}catch{}return {status:r.status,data,text,headers:r.headers};
}
const ok=(r,status=200)=>{assert.equal(r.status,status,r.data?.error?.code);return r.data;};
async function account(username,role="viewer"){
 const invitation=runtime.accounts.createInvitation().invitation,passwordHash=await hashPassword(password);runtime.accounts.redeemInvitation({token:invitation.token,username,passwordHash});
 const user=runtime.accounts.listAccounts().accounts.find(u=>u.username===username);runtime.accounts.approve(user.id);if(role!=="viewer")runtime.accounts.setRole(user.id,{role});
 const login=await call("/api/login",{username,password},{});ok(login);return {...user,role,authHeaders:{Cookie:login.headers.get("set-cookie").split(";")[0]}};
}
const read=async(id,as=owner)=>ok(await call("/api/trips/"+id,undefined,as));
const assign=async(id,user,role="member",version)=>{const current=await read(id);return call("/api/trips/"+id+"/members",{userId:user.id,role,expectedAccessVersion:version??current.access.version,requestId:"assign-"+crypto.randomUUID()},owner);};
try{
 const a=await account("fictional.alpha"),b=await account("fictional.beta"),manager=await account("fictional.manager","content-manager");
 const input={requestId:"same-create-request",trip:{title:"Fictional garden",timezone:"America/Los_Angeles",participantGroups:[{id:"family",label:"Fictional itinerary group"}],days:[{id:"day-one",date:"2031-06-10",slots:[]}]}};
 const alpha=ok(await call("/api/trips",input,a.authHeaders),201).trip,beta=ok(await call("/api/trips",input,b.authHeaders),201).trip;
 assert.notEqual(alpha.id,beta.id,"ordinary create request namespaces are account-scoped");
 assert.equal(ok(await call("/api/trips",input,a.authHeaders),201).trip.id,alpha.id);
 assert.deepEqual(ok(await call("/api/trips",undefined,a.authHeaders)).trips.map(t=>t.id),[alpha.id]);
 assert.equal(ok(await call("/api/trips",undefined,manager.authHeaders)).trips.length,0,"unassigned managers have no trip visibility");
 for(const route of ["/api/trips/"+alpha.id,"/api/trips/"+alpha.id+"/export"]){assert.equal((await call(route,undefined,b.authHeaders)).status,404);assert.equal((await call(route,undefined,{})).status,401);}
 assert.equal((await call("/api/trips/"+alpha.id+"/changes",{requestId:"cross-write",expectedVersion:1,changes:[{type:"update_trip",fields:{title:"Forbidden"}}]},b.authHeaders)).status,403);
 let data=await read(alpha.id,a.authHeaders);assert.deepEqual(data.members.map(u=>u.id),[a.id]);assert.equal(data.access.canInvite,true);assert.equal(data.access.canEdit,true);assert.equal(data.trip.participantGroups.length,1,"itinerary groups are not accounts");
 // Real local media binding; ordinary editors cannot authorize guessed media by referencing it.
 fs.mkdirSync(path.join(dir,"photos"));fs.writeFileSync(path.join(dir,"photos/fictional-private.png"),"fictional-pixels");
 const media=ok(await call("/api/trips/"+alpha.id+"/changes",{requestId:"owner-media",expectedVersion:alpha.version,changes:[{type:"upsert_plan",dayId:"day-one",plan:{id:"photo-plan",name:"Fictional museum",photo:{url:"/photos/fictional-private.png",credit:"Fictional"}}}]})).trip;
 assert.equal((await call("/photos/fictional-private.png",undefined,a.authHeaders)).status,200);assert.equal((await call("/photos/fictional-private.png",undefined,b.authHeaders)).status,404);assert.equal((await call("/photos/fictional-private.png",undefined,b.authHeaders,"HEAD")).status,404);
 assert.equal((await call("/api/trips/"+beta.id+"/changes",{requestId:"media-id-or",expectedVersion:beta.version,changes:[{type:"upsert_plan",dayId:"day-one",plan:{id:"copied-photo",name:"Fictional",photo:{url:"/photos/fictional-private.png"}}}]},b.authHeaders)).status,403);
 assert.equal((await read(beta.id,b.authHeaders)).trip.version,beta.version);
 assert.equal((await call("/api/trips/"+alpha.id+"/changes",{requestId:"owner-media",expectedVersion:alpha.version,changes:[{type:"upsert_plan",dayId:"day-one",plan:{id:"photo-plan",name:"Fictional museum",photo:{url:"/photos/fictional-private.png",credit:"Fictional"}}}]},a.authHeaders)).status,409,"ordinary creator cannot replay another actor's historical trip result");
 const ownEdit={requestId:"creator-save",expectedVersion:media.version,changes:[{type:"update_trip",fields:{shortName:"Fictional"}}]};ok(await call("/api/trips/"+alpha.id+"/changes",ownEdit,a.authHeaders));ok(await call("/api/trips/"+alpha.id+"/changes",ownEdit,a.authHeaders));
 const before=JSON.stringify((await read(alpha.id)).trip);
 ok(await assign(alpha.id,b));data=await read(alpha.id,b.authHeaders);assert.equal(data.access.canEdit,false);assert.equal(data.access.canInvite,false);
 assert.equal((await call("/api/trips/"+alpha.id+"/invitations",{expectedAccessVersion:data.access.version},b.authHeaders)).status,403);
 assert.equal((await call("/api/trips/"+alpha.id+"/changes",{requestId:"joined-read-only",expectedVersion:media.version,changes:[{type:"update_trip",fields:{title:"Forbidden"}}]},b.authHeaders)).status,403);
 const v=(await read(alpha.id)).access.version;
 const race=await Promise.all([assign(alpha.id,b,"remove",v),assign(alpha.id,manager,"member",v)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 if((await read(alpha.id)).members.some(u=>u.id===b.id))ok(await assign(alpha.id,b,"remove"));
 assert.equal((await call("/api/trips/"+alpha.id,undefined,b.authHeaders)).status,404,"removal takes effect on the existing session");
 assert.equal((await call("/photos/fictional-private.png",undefined,b.authHeaders)).status,404);
 assert.equal(JSON.stringify((await read(alpha.id)).trip),before,"access changes do not rewrite content or version");
 // Single-use, digest-only, revocable trip invitations; no new accounts or grants.
 async function issue(hours=72){const state=await read(alpha.id,a.authHeaders);return ok(await call("/api/trips/"+alpha.id+"/invitations",{expectedAccessVersion:state.access.version,expiresInHours:hours},a.authHeaders),201).invitation;}
 const invite=await issue();assert.match(invite.token,/^[A-Za-z0-9_-]{43}$/);
 const stored=runtime.db.prepare("SELECT * FROM trip_invitations WHERE id=?").get(invite.id);assert.notEqual(stored.token_hash,invite.token);assert.equal(stored.token_hash.length,64);
 assert.ok(!JSON.stringify(runtime.db.prepare("SELECT * FROM audit_log").all()).includes(invite.token));
 assert.ok(!JSON.stringify(runtime.db.prepare("SELECT * FROM request_log").all()).includes(invite.token));
 const join={code:invite.token,requestId:"join-alpha"};ok(await call("/api/join-trip",join,b.authHeaders));ok(await call("/api/join-trip",join,b.authHeaders));
 assert.equal((await read(alpha.id,b.authHeaders)).members.filter(u=>u.id===b.id).length,1);
 assert.equal((await call("/api/join-trip",{code:invite.token,requestId:"used-by-other"},manager.authHeaders)).status,403);
 const revoked=await issue();data=await read(alpha.id);ok(await call("/api/trips/"+alpha.id+"/invitations/"+revoked.id+"/revoke",{expectedAccessVersion:data.access.version},a.authHeaders));
 assert.equal((await call("/api/join-trip",{code:revoked.token,requestId:"revoked-code"},manager.authHeaders)).status,403);
 const expired=await issue(1);runtime.db.prepare("UPDATE trip_invitations SET expires_at=? WHERE id=?").run(1,expired.id);
 assert.equal((await call("/api/join-trip",{code:expired.token,requestId:"expired-code"},manager.authHeaders)).status,403);
 const epochCode=await issue();runtime.accounts.revoke(a.id);runtime.accounts.approve(a.id);const renewed=await call("/api/login",{username:a.username,password},{});ok(renewed);a.authHeaders={Cookie:renewed.headers.get("set-cookie").split(";")[0]};
 assert.equal((await call("/api/join-trip",{code:epochCode.token,requestId:"revoked-issuer-code"},manager.authHeaders)).status,403,"reapproval never revives issuer codes");assert.ok(runtime.db.prepare("SELECT revoked_at FROM trip_invitations WHERE id=?").get(epochCode.id).revoked_at);
 const pending=await issue();ok(await assign(alpha.id,b,"creator"));
 assert.equal((await call("/api/trips/"+alpha.id+"/invitations",{expectedAccessVersion:(await read(alpha.id)).access.version},a.authHeaders)).status,403,"old creator cannot issue");
 assert.equal((await call("/api/join-trip",{code:pending.token,requestId:"former-creator"},manager.authHeaders)).status,403,"old creator codes are invalidated");
 const demotedCode=ok(await call("/api/trips/"+alpha.id+"/invitations",{expectedAccessVersion:(await read(alpha.id)).access.version},b.authHeaders),201).invitation;
 ok(await assign(alpha.id,b,"member"));data=await read(alpha.id,b.authHeaders);assert.equal(data.access.canEdit,false);assert.equal(data.access.canInvite,false);assert.equal(data.access.creator,null);assert.ok(data.members.some(u=>u.id===b.id));
 assert.equal((await call("/api/join-trip",{code:demotedCode.token,requestId:"demoted-creator"},manager.authHeaders)).status,403,"creator demotion retains read membership and revokes its codes");
 ok(await assign(alpha.id,b,"creator"));
 // Authorization is also in the shared gateway, including retries; actual MCP keeps its six tools.
 const gateway=new ContentGateway(runtime.service,runtime.audit,{clock:config.clock});
 const ctx={principal:{role:"viewer",via:"cookie",userId:a.id},channel:"mcp"};assert.throws(()=>gateway.getTrip(ctx,beta.id),e=>e.status===404);
 assert.equal((await call("/mcp",{},a.authHeaders)).status,401,"viewer cookies never acquire MCP rights");
 mcp=new Client({name:"fictional-membership-check",version:"1"});await mcp.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{requestInit:{headers:owner}}));
 assert.equal((await mcp.listTools()).tools.length,6);const got=await mcp.callTool({name:"get_trip",arguments:{tripId:alpha.id}});assert.ok(!got.isError);assert.ok(JSON.parse(got.content[0].text).members.length>=2);
 // Landing uses the trip's own timezone: June 10 is still active in Pacific at this UTC instant.
 const loginA=ok(await call("/api/login",{username:a.username,password},{}));assert.equal(loginA.landingPath,"/trips/"+alpha.id);
 const loginB=ok(await call("/api/login",{username:b.username,password},{}));assert.equal(loginB.landingPath,"/","two accessible active trips use list");
 const draft=ok(await call("/api/trips",{requestId:"undated-draft",trip:{title:"Fictional undated draft"}},a.authHeaders),201).trip;
 assert.equal(gateway.membership.landing(ctx.principal,config.clock()),"/trips/"+alpha.id,"undated drafts do not count");
 const future=ok(await call("/api/trips",{requestId:"future-trip",trip:{title:"Fictional future",timezone:"Asia/Tokyo",days:[{id:"future-day",date:"2031-07-01",slots:[]}]}},a.authHeaders),201).trip;
 assert.equal(gateway.membership.landing(ctx.principal,config.clock()),"/");
 runtime.service.applyTripChanges({tripId:future.id,requestId:"archive-future",expectedVersion:1,changes:[{type:"archive_trip",archived:true}]});assert.equal(gateway.membership.landing(ctx.principal,config.clock()),"/trips/"+alpha.id);
 assert.equal(gateway.membership.landing(ctx.principal,Date.parse("2031-08-01T00:00:00Z")),"/");
 // Durable attempt cap and restart, v7 backup validation; no allowance file is created or changed.
 const rate={role:"viewer",via:"cookie",userId:a.id};for(let i=0;i<20;i++){try{gateway.membership.redeem(rate,{code:"bad",requestId:"bad-"+i});}catch(e){assert.equal(e.status,403);}}
 assert.throws(()=>gateway.membership.redeem(rate,{code:"bad",requestId:"bad-over"}),e=>e.status===429);
 // Durable issuance limits, revision races and bounded retained metadata.
 const codeVersion=(await read(alpha.id)).access.version;
 const issueRace=await Promise.all([call("/api/trips/"+alpha.id+"/invitations",{expectedAccessVersion:codeVersion},b.authHeaders),call("/api/trips/"+alpha.id+"/invitations",{expectedAccessVersion:codeVersion},b.authHeaders)]);assert.deepEqual(issueRace.map(r=>r.status).sort(),[201,409]);
 const beforeAudit=gateway.membership.state(alpha.id).revision,record=runtime.audit.record;runtime.audit.record=()=>{throw new Error("Fictional audit failure");};
 assert.throws(()=>gateway.membership.assign({role:"owner"},alpha.id,{userId:manager.id,role:"member",expectedAccessVersion:beforeAudit,requestId:"audit-failure"}));runtime.audit.record=record;assert.equal(gateway.membership.state(alpha.id).revision,beforeAudit,"audit failure rolls back access changes");
 let inviteClock=config.clock();const bounded=new ContentGateway(runtime.service,runtime.audit,{clock:()=>inviteClock}).membership,bp={role:"viewer",via:"cookie",userId:b.id};
 for(let round=0;round<11;round++){
  inviteClock+=8*86400000;
  for(let i=0;i<20;i++)bounded.issue(bp,alpha.id,{expectedAccessVersion:bounded.state(alpha.id).revision,expiresInHours:1});
  assert.throws(()=>bounded.issue(bp,alpha.id,{expectedAccessVersion:bounded.state(alpha.id).revision}),e=>e.status===429);
 }
 assert.ok(runtime.db.prepare("SELECT COUNT(*) AS n FROM trip_invitations WHERE trip_id=?").get(alpha.id).n<=200);
 ok(await assign(alpha.id,b,"remove"));assert.equal((await call("/api/join-trip",join,b.authHeaders)).status,403,"a durable join replay never restores removed membership");assert.equal((await call("/api/trips/"+alpha.id,undefined,b.authHeaders)).status,404);
 assert.equal(JSON.stringify((await read(alpha.id)).trip),before,"invites, assignment, removal and limits preserve trip content/version");
 ok(await assign(alpha.id,manager));runtime.accounts.revoke(manager.id);ok(await assign(alpha.id,manager,"remove"));assert.equal(runtime.db.prepare("SELECT 1 FROM trip_members WHERE trip_id=? AND user_id=?").get(alpha.id,manager.id),undefined,"owner may permanently remove a revoked account without reapproving it");
 ok(await call("/api/trips/"+draft.id+"/changes",{requestId:"scoped-draft-edit",expectedVersion:1,changes:[{type:"update_trip",fields:{shortName:"Fictional"}}]},a.authHeaders));
 ok(await call("/api/trips/"+draft.id,{requestId:"delete-member-draft",expectedVersion:2},owner,"DELETE"));
 assert.equal((await call("/api/trips",{requestId:"undated-draft",trip:{title:"Fictional undated draft"}},a.authHeaders)).status,410,"deleted account-scoped create retries cannot recover content");
 const removedInput={requestId:"removed-creator-create",trip:{title:"Fictional removed membership"}},removedTrip=ok(await call("/api/trips",removedInput,a.authHeaders),201).trip;
 ok(await assign(removedTrip.id,a,"remove"));assert.equal((await call("/api/trips",removedInput,a.authHeaders)).status,404,"a create retry cannot disclose content after membership removal");assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM trips WHERE id=?").get(removedTrip.id).n,1,"refused retry creates no duplicate trip");
 const redacted=JSON.parse(runtime.db.prepare("SELECT result FROM request_log WHERE scope=? AND request_id=?").get("trip:"+draft.id+":user:"+a.id,"scoped-draft-edit").result);assert.ok(redacted.deletedTrip);assert.equal(Object.hasOwn(redacted,"trip"),false);
 const snap=path.join(dir,"backup.sqlite");await snapshotDatabase(path.join(dir,"shared-trip.sqlite"),snap);validateSnapshot(snap);
 const restoredDir=path.join(dir,"restored");execFileSync(process.execPath,[new URL("../server/cli/restore.mjs",import.meta.url).pathname.replace(/^\/(\w:)/,"$1"),snap],{env:{...process.env,SHARED_TRIP_DATA_DIR:restoredDir},stdio:"pipe"});
 const restoredDb=openDatabase(path.join(restoredDir,"shared-trip.sqlite")),restoredGateway=new ContentGateway(new TripService(restoredDb),runtime.audit,{clock:config.clock});
 assert.throws(()=>restoredGateway.getTrip(ctx,beta.id),e=>e.status===404);assert.equal(restoredGateway.getTrip(ctx,alpha.id).access.canInvite,false);
 for(const table of ["trip_access","trip_members","trip_invitations","trip_media","trip_join_attempts"])assert.ok(JSON.stringify(restoredDb.prepare("SELECT * FROM "+table).all())===JSON.stringify(runtime.db.prepare("SELECT * FROM "+table).all()),"restored "+table+" is exact");restoredDb.close();
 await mcp.close();mcp=null;await runtime.close();runtime=await startServer(config);
 const again=new ContentGateway(runtime.service,runtime.audit,{clock:config.clock});assert.throws(()=>again.membership.redeem(rate,{code:"bad",requestId:"after-restart"}),e=>e.status===429);assert.equal(fs.existsSync(path.join(dir,"google-allowance.sqlite")),false);
 // Genuine v6 fixture: all preexisting rows remain byte-for-byte; no creator/member inferred.
 const old=path.join(dir,"prior.sqlite");fs.copyFileSync(snap,old);let db=new DatabaseSync(old);db.exec("PRAGMA foreign_keys=OFF");for(const name of ["trip_join_attempts","trip_media","trip_invitations","trip_members","trip_access"])db.exec("DROP TABLE "+name);db.exec("DELETE FROM audit_log WHERE action='membership.assign' OR action LIKE 'trip.invitation.%'; DELETE FROM request_log WHERE scope LIKE 'membership:%' OR scope LIKE 'join:%' OR scope LIKE 'create:%' OR scope LIKE 'trip:%:user:%'; PRAGMA user_version=6");const rows=db.prepare("SELECT * FROM trips ORDER BY id").all();const priorTables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),priorRows=Object.fromEntries(priorTables.map(table=>[table,JSON.stringify(db.prepare('SELECT * FROM "'+table+'"').all())]));db.close();
 const planFile=path.join(dir,"private-dry-run.json");const dry=JSON.parse(execFileSync(process.execPath,[new URL("../server/cli/trip-membership-plan.mjs",import.meta.url).pathname.replace(/^\/(\w:)/,"$1"),"--database",old,"--out",planFile],{encoding:"utf8"}));assert.equal(dry.applied,false);assert.equal(dry.newMemberships,0);db=new DatabaseSync(old,{readOnly:true});assert.equal(db.prepare("PRAGMA user_version").get().user_version,6);assert.deepEqual(db.prepare("SELECT * FROM trips ORDER BY id").all(),rows);db.close();const plan=JSON.parse(fs.readFileSync(planFile));assert.equal(plan.applied,false);assert.ok(plan.trips.every(t=>t.creator===null&&t.members.length===0&&t.proposedChanges.length===0));
 db=openDatabase(old);assert.deepEqual(db.prepare("SELECT * FROM trips ORDER BY id").all(),rows);for(const table of priorTables)assert.ok(JSON.stringify(db.prepare('SELECT * FROM "'+table+'"').all())===priorRows[table],"migration preserves every prior row in "+table);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trip_members").get().n,0);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM trip_access WHERE creator IS NOT NULL").get().n,0);db.close();validateSnapshot(old);
 console.log("Trip membership passed: actual HTTP/SQLite/MCP discovery, creator/member/admin paths, two-user isolation, media reference forgery denial, atomic conflicts, digest-only single-use expiring/revoked codes, durable bounded attempts/retries/restart, content preservation, timezone zero/one/multiple landing, backup and v6 migration without invented memberships. Fictional only; no providers or live writes.");
}finally{await mcp?.close();await runtime.close();}
