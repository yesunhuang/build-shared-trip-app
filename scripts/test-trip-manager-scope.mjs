// Fictional HTTP, SQLite and real MCP SDK acceptance. No deployment or external provider calls.
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {readConfig,startServer} from "../server/app.mjs";
import {hashPassword} from "../server/auth/passwords.mjs";
import {ContentGateway} from "../server/content-access.mjs";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-manager-scope-")),password="Fictional-private-fixture-password",ownerToken="fictional-scope-owner-0000000000000000";
const config={...readConfig({SHARED_TRIP_ADMIN_TOKEN:ownerToken,SHARED_TRIP_DATA_DIR:dir,SHARED_TRIP_PORT:"0"}),clock:()=>Date.parse("2031-06-01T12:00:00Z")};
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
 assert.throws(()=>readConfig({SHARED_TRIP_ADMIN_TOKEN:ownerToken,SHARED_TRIP_DATA_DIR:dir,SHARED_TRIP_ALL_TRIP_ASSISTANT_USER_ID:"fictional.assistant"}));
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
 config.allTripAssistantUserId=assistant.id;runtime=await startServer(config);for(const user of [manager,other,assistant])user.headers=await login(user);
 assert.equal(ok(await call("/api/trips",undefined,manager.headers)).trips.length,0,"ordinary manager never inherits the exception");
 assert.equal(ok(await call("/api/trips",undefined,assistant.headers)).trips.length,runtime.service.listTrips().trips.length);
 assert.equal((await call("/photos/fictional-scope.png",undefined,assistant.headers)).status,200);
 fs.writeFileSync(path.join(dir,"photos","fictional-unbound.png"),"Unbound fictional pixels");assert.equal((await call("/photos/fictional-unbound.png",undefined,assistant.headers)).status,404);
 const assistantMcp=await sdk(assistant);assert.equal((await tool(assistantMcp,"get_trip",{tripId:beta.id})).error,false);
 runtime.db.prepare("UPDATE users SET username=? WHERE id=?").run("fictional.renamed.assistant",assistant.id);
 assert.equal((await call("/api/trips/"+beta.id,undefined,assistant.headers)).status,200,"exception follows the stable principal across a fictional rename");
 const reusedName=await account("fictional.assistant");assert.equal((await call("/api/trips/"+beta.id,undefined,reusedName.headers)).status,404,"a later account with the old name never inherits the exception");
 const unchanged=JSON.stringify(runtime.service.getTrip(beta.id).trip);runtime.accounts.revoke(assistant.id);assert.equal((await call("/api/trips/"+beta.id,undefined,assistant.headers)).status,401);await assert.rejects(()=>tool(assistantMcp,"get_trip",{tripId:beta.id}));assert.equal(JSON.stringify(runtime.service.getTrip(beta.id).trip),unchanged);
 const gateway=new ContentGateway(runtime.service,runtime.audit,{allTripAssistantUserId:other.username});assert.throws(()=>gateway.getTrip({principal:{role:"content-manager",userId:other.id}},beta.id),e=>e.status===404,"username cannot activate an exception");
 runtime.accounts.approve(assistant.id);runtime.accounts.setRole(assistant.id,{role:"viewer"});const restricted=new ContentGateway(runtime.service,runtime.audit,{allTripAssistantUserId:assistant.id});assert.throws(()=>restricted.getTrip({principal:{role:"viewer",userId:assistant.id}},beta.id),e=>e.status===404,"the configured principal still needs the approved content-manager role");
 console.log("Manager membership scope passed: actual HTTP/MCP isolation for existing/new/unassigned managers; member editing, future trips, exports/media/lookups, scoped and attributed legacy retries, removal and landing; exact configured stable-principal exception, no username/role bypass, revocation and bound-only media. Fictional only.");
}finally{for(const client of clients)await client.close();await runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
