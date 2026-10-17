// Fictional HTTP, SQLite and real MCP SDK acceptance. No deployment or external provider calls.
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {readConfig,startServer} from "../server/app.mjs";
import {hashPassword} from "../server/auth/passwords.mjs";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-manager-scope-")),password="Fictional-private-fixture-password",ownerToken="fictional-scope-owner-0000000000000000";
let fixtureNow=Date.parse("2031-06-01T12:00:00Z");
const config={...readConfig({SHARED_TRIP_ADMIN_TOKEN:ownerToken,SHARED_TRIP_DATA_DIR:dir,SHARED_TRIP_PORT:"0"}),clock:()=>fixtureNow};
let runtime=await startServer(config);const clients=[];
async function call(route,body,headers={Authorization:"Bearer "+ownerToken},method=body===undefined?"GET":"POST"){
 const response=await fetch(runtime.url+route,{method,headers:{...headers,Origin:runtime.url,...(body===undefined?{}:{"Content-Type":"application/json"})},body:body===undefined?undefined:JSON.stringify(body)});let data;try{data=await response.json();}catch{}return {status:response.status,data,headers:response.headers};
}
const ok=(r,status=200)=>{assert.equal(r.status,status,r.data?.error?.code);return r.data;};
async function login(user){const r=await call("/api/login",{username:user.username,password},{});ok(r);return {Cookie:r.headers.get("set-cookie").split(";")[0]};}
async function account(username){const code=runtime.accounts.createInvitation().invitation,passwordHash=await hashPassword(password);runtime.accounts.redeemInvitation({token:code.token,username,passwordHash});const user=runtime.accounts.listAccounts().accounts.find(u=>u.username===username);runtime.accounts.approve(user.id);runtime.accounts.setRole(user.id,{role:"content-manager"});return {...user,headers:await login(user)};}
const create=async(title)=>ok(await call("/api/trips",{requestId:crypto.randomUUID(),trip:{title,timezone:"UTC",days:[{id:"day-one",date:"2031-06-02",slots:[]}]}}),201).trip;
async function assign(trip,user,role="member"){const current=ok(await call("/api/trips/"+trip.id));return ok(await call("/api/trips/"+trip.id+"/members",{userId:user.id,role,expectedAccessVersion:current.access.version,requestId:crypto.randomUUID()}));}
async function sdk(user){const issued=runtime.tokens.issue(user.id,{label:"Fictional scope check"},config.clock());const client=new Client({name:"fictional-scope",version:"1"});await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{requestInit:{headers:{Authorization:"Bearer "+issued.secret}}}));clients.push(client);return client;}
const tool=async(client,name,args)=>{const r=await client.callTool({name,arguments:args});return {error:Boolean(r.isError),data:JSON.parse(r.content[0].text)};};
try{
 const alpha=await create("Fictional member garden"),beta=await create("Fictional private harbor");
 const manager=await account("fictional.old.manager"),other=await account("fictional.new.manager"),assistant=await account("fictional.assistant");
 for(const user of [manager,other,assistant])assert.equal(ok(await call("/api/trips",undefined,user.headers)).trips.length,0);
 await assign(alpha,manager);
 let r=ok(await call("/api/trips/"+alpha.id,undefined,manager.headers));assert.equal(r.access.canEdit,true);assert.equal(r.access.canInvite,false);
 for(const user of [manager,other]){
  for(const suffix of ["","/export"])assert.equal((await call("/api/trips/"+beta.id+suffix,undefined,user.headers)).status,404);
  assert.equal((await call("/api/trips/"+beta.id+"/changes",{requestId:crypto.randomUUID(),expectedVersion:1,changes:[{type:"update_trip",fields:{shortName:"Refused"}}]},user.headers)).status,403);
  assert.equal((await call("/api/trips/"+beta.id+"/places/search",{query:"Fictional public park"},user.headers)).status,404);
  assert.equal((await call("/api/trips/"+beta.id+"/google-places/reservations",{requestId:crypto.randomUUID(),kind:"details",planId:"private-photo",placeId:"FictionalVenue"},user.headers)).status,404);
 }
 const future=await create("Fictional future account isolation");assert.equal((await call("/api/trips/"+future.id,undefined,manager.headers)).status,404);
 fs.mkdirSync(path.join(dir,"photos"));fs.writeFileSync(path.join(dir,"photos","fictional-scope.png"),"Fictional pixels");
 ok(await call("/api/trips/"+beta.id+"/changes",{requestId:"private-photo",expectedVersion:1,changes:[{type:"upsert_plan",dayId:"day-one",plan:{id:"private-photo",name:"Fictional harbor",photo:{url:"/photos/fictional-scope.png"}}}]}));
 assert.equal((await call("/photos/fictional-scope.png",undefined,manager.headers)).status,404);
 assert.equal((await call("/photos/fictional-scope.png",undefined,manager.headers,"HEAD")).status,404);
 assert.equal((await call("/api/trips/"+alpha.id+"/changes",{requestId:"photo-forgery",expectedVersion:1,changes:[{type:"upsert_plan",dayId:"day-one",plan:{id:"guessed-photo",name:"Fictional garden",photo:{url:"/photos/fictional-scope.png"}}}]},manager.headers)).status,403);
 const change={requestId:"manager-edit",expectedVersion:1,changes:[{type:"update_trip",fields:{shortName:"Member edit"}}]};ok(await call("/api/trips/"+alpha.id+"/changes",change,manager.headers));ok(await call("/api/trips/"+alpha.id+"/changes",change,manager.headers));
 // A v6 global retry is usable only with proof of its original actor and current membership.
 runtime.db.prepare("UPDATE request_log SET scope=? WHERE scope=? AND request_id=?").run("trip:"+alpha.id,"trip:"+alpha.id+":user:"+manager.id,change.requestId);
 ok(await call("/api/trips/"+alpha.id+"/changes",change,manager.headers));
 const mcp=await sdk(manager);assert.equal((await mcp.listTools()).tools.length,6);assert.deepEqual((await tool(mcp,"list_trips",{})).data.trips.map(t=>t.id),[alpha.id]);
 for(const name of ["get_trip","export_trip"])assert.equal((await tool(mcp,name,{tripId:beta.id})).error,true);
 assert.equal((await tool(mcp,"apply_trip_changes",{tripId:beta.id,requestId:"mcp-idor",expectedVersion:2,changes:[{type:"update_trip",fields:{title:"Refused"}}]})).error,true);
 const edited=await tool(mcp,"apply_trip_changes",{tripId:alpha.id,requestId:"mcp-member-edit",expectedVersion:2,changes:[{type:"update_trip",fields:{country:"Fictional region"}}]});assert.equal(edited.error,false);
 assert.equal(ok(await call("/api/login",{username:manager.username,password},{})).landingPath,"/trips/"+alpha.id);
 assert.equal(ok(await call("/api/login",{username:other.username,password},{})).landingPath,"/");
 await assign(alpha,manager,"remove");assert.equal((await call("/api/trips/"+alpha.id+"/changes",change,manager.headers)).status,403);assert.equal((await tool(mcp,"get_trip",{tripId:alpha.id})).error,true);
 const ownInput={requestId:"manager-owned-create",trip:{title:"Fictional manager own trip"}},own=ok(await call("/api/trips",ownInput,manager.headers),201).trip;
 runtime.db.prepare("UPDATE request_log SET scope='create' WHERE scope=? AND request_id=?").run("create:"+manager.id,ownInput.requestId);
 assert.equal(ok(await call("/api/trips",ownInput,manager.headers),201).trip.id,own.id);
 await assign(own,manager,"remove");assert.equal((await call("/api/trips",ownInput,manager.headers)).status,404);
 const importedInput={requestId:"manager-import-retry",data:{trip:{title:"Fictional imported membership"}}},imported=ok(await call("/api/import",importedInput,manager.headers),201).trip;
 runtime.db.prepare("UPDATE request_log SET scope='import' WHERE scope=? AND request_id=?").run("import:"+manager.id,importedInput.requestId);assert.equal(ok(await call("/api/import",importedInput,manager.headers),201).trip.id,imported.id);
 await assign(imported,manager,"remove");assert.equal((await call("/api/import",importedInput,manager.headers)).status,404,"attributed import retries still require current membership");
 const missing={requestId:"legacy-missing-proof",trip:{title:"Fictional uncertain legacy result"}},uncertain=ok(await call("/api/trips",missing,other.headers),201).trip;
 runtime.db.prepare("UPDATE request_log SET scope='create' WHERE scope=? AND request_id=?").run("create:"+other.id,missing.requestId);runtime.db.prepare("DELETE FROM audit_log WHERE request_id=?").run(missing.requestId);
 assert.equal((await call("/api/trips",missing,other.headers)).status,409);assert.equal(runtime.service.listTrips().trips.filter(t=>t.id===uncertain.id).length,1);
 for(const client of clients.splice(0))await client.close();await runtime.close();
 runtime=await startServer(config);for(const user of [manager,other,assistant])user.headers=await login(user);
 assert.equal(ok(await call("/api/trips",undefined,manager.headers)).trips.length,0);
 // A finite migration matrix uses ordinary member rows for the trips present in this snapshot.
 const existing=runtime.service.listTrips().trips;for(const trip of existing)await assign(trip,assistant);
 assert.deepEqual(ok(await call("/api/trips",undefined,assistant.headers)).trips.map(t=>t.id).sort(),existing.map(t=>t.id).sort());
 assert.equal((await call("/photos/fictional-scope.png",undefined,assistant.headers)).status,200);
 fs.writeFileSync(path.join(dir,"photos","fictional-unbound.png"),"Unbound fictional pixels");assert.equal((await call("/photos/fictional-unbound.png",undefined,assistant.headers)).status,404);
 fixtureNow=Date.parse("2031-07-01T12:00:00Z");assistant.headers=await login(assistant);
 fs.writeFileSync(path.join(dir,"photos","fictional-later.png"),"Fictional later trip pixels");
 const laterInput={requestId:"future-owner-create",trip:{title:"Fictional later unassigned trip",timezone:"UTC",days:[{id:"day-future",date:"2031-07-02",slots:[{id:"future-photo",name:"Fictional later museum",photo:{url:"/photos/fictional-later.png"}}]}]}},later=ok(await call("/api/trips",laterInput),201).trip;
 const laterEdit={requestId:"future-owner-edit",expectedVersion:1,changes:[{type:"update_trip",fields:{shortName:"Fictional later"}}]};ok(await call("/api/trips/"+later.id+"/changes",laterEdit));
 const assistantMcp=await sdk(assistant);assert.equal((await tool(assistantMcp,"get_trip",{tripId:beta.id})).error,false);
 assert.equal(ok(await call("/api/login",{username:assistant.username,password},{})).landingPath,"/","an inaccessible sole upcoming trip cannot become the landing target");
 assert.equal(ok(await call("/api/trips",undefined,assistant.headers)).trips.some(t=>t.id===later.id),false);
 for(const suffix of ["","/export"])assert.equal((await call("/api/trips/"+later.id+suffix,undefined,assistant.headers)).status,404);
 for(const method of ["GET","HEAD"])assert.equal((await call("/photos/fictional-later.png",undefined,assistant.headers,method)).status,404);
 assert.equal((await call("/api/trips/"+later.id+"/places/search",{query:"Fictional public museum"},assistant.headers)).status,404);
 assert.equal((await call("/api/trips/"+later.id+"/google-places/reservations",{requestId:"future-google-denied",kind:"search"},assistant.headers)).status,404);
 assert.equal((await call("/api/trips/"+later.id+"/changes",laterEdit,assistant.headers)).status,403);
 const count=runtime.service.listTrips().trips.length;assert.equal((await call("/api/trips",laterInput,assistant.headers)).status,403);assert.equal(runtime.service.listTrips().trips.length,count,"a replay containing an inaccessible image neither returns content nor executes a new create");
 for(const name of ["get_trip","export_trip"])assert.equal((await tool(assistantMcp,name,{tripId:later.id})).error,true);
 assert.equal((await tool(assistantMcp,"apply_trip_changes",{tripId:later.id,...laterEdit})).error,true);
 assert.equal((await tool(assistantMcp,"create_trip",laterInput)).error,true);
 assert.equal((await tool(assistantMcp,"list_trips",{})).data.trips.some(t=>t.id===later.id),false);
 const currentAlpha=ok(await call("/api/trips/"+alpha.id)).trip;ok(await call("/api/trips/"+alpha.id+"/changes",{requestId:"member-upcoming-date",expectedVersion:currentAlpha.version,changes:[{type:"upsert_day",day:{id:"day-one",date:"2031-07-03"}}]}));
 assert.equal(ok(await call("/api/login",{username:assistant.username,password},{})).landingPath,"/trips/"+alpha.id,"one assigned upcoming trip wins despite an unassigned future trip");
 const editable=await tool(assistantMcp,"get_trip",{tripId:alpha.id});assert.equal((await tool(assistantMcp,"apply_trip_changes",{tripId:alpha.id,requestId:"assistant-member-edit",expectedVersion:editable.data.trip.version,changes:[{type:"update_trip",fields:{country:"Fictional assigned area"}}]})).error,false);
 const selfCreated=await tool(assistantMcp,"create_trip",{requestId:"assistant-normal-create",trip:{title:"Fictional assistant own draft"}});assert.equal(selfCreated.error,false);assert.equal(ok(await call("/api/trips/"+selfCreated.data.trip.id,undefined,assistant.headers)).access.canInvite,true,"normal creator membership remains intact");
 const unchanged=JSON.stringify(runtime.service.getTrip(beta.id).trip);runtime.accounts.revoke(assistant.id);assert.equal((await call("/api/trips/"+beta.id,undefined,assistant.headers)).status,401);await assert.rejects(()=>tool(assistantMcp,"get_trip",{tripId:beta.id}));assert.equal(JSON.stringify(runtime.service.getTrip(beta.id).trip),unchanged);
 console.log("Manager membership scope passed: actual HTTP/MCP isolation, explicit existing-trip assignment through ordinary member rows, authorized editing, future-unassigned denial for lists/reads/writes/exports/media/lookups/reservations/retry replay and zero/one landing, normal creator membership, scoped legacy retries and revocation. Only the owner has global access. Fictional only.");
}finally{for(const client of clients)await client.close();await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
