import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readConfig, startServer } from "../server/app.mjs";
import { snapshotDatabase, validateSnapshot } from "../server/db.mjs";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(),"shared-trip-integration-"));
const token = crypto.randomBytes(32).toString("base64url");
const config = readConfig({ SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:path.join(temporary,"main"),SHARED_TRIP_PORT:"0" });
let runtime = await startServer(config);
const all = [runtime];
const clients = [];
async function api(route,{method="GET",body,bearer=true,headers={},base=runtime.url}={}) {
  const response = await fetch(base+route,{method,headers:{...(bearer?{Authorization:"Bearer "+token}:{}),...(body!==undefined?{"Content-Type":"application/json"}:{}),...headers},body:body!==undefined?JSON.stringify(body):undefined});
  return {status:response.status,headers:response.headers,body:await response.json()};
}
async function write(trip,changes,requestId=crypto.randomUUID(),expectedVersion=trip.version){
  return api("/api/trips/"+trip.id+"/changes",{method:"POST",body:{requestId,expectedVersion,changes}});
}
function ok(response,status=200){assert.equal(response.status,status,JSON.stringify(response.body));return response.body;}
try {
  assert.equal((await api("/api/trips",{bearer:false})).status,401);
  assert.equal((await api("/mcp",{method:"POST",bearer:false,body:{}})).status,401);
  assert.equal((await api("/api/trips",{headers:{Origin:"https://unrelated.example.org"}})).status,403);
  const login=await api("/api/login",{method:"POST",bearer:false,headers:{Origin:runtime.url},body:{token}});
  ok(login);const cookie=login.headers.get("set-cookie").split(";")[0];
  assert.match(login.headers.get("set-cookie"),/HttpOnly; SameSite=Strict/);
  assert.equal((await api("/api/session",{bearer:false,headers:{Cookie:cookie}})).status,200);
  assert.equal((await api("/api/trips",{method:"POST",bearer:false,headers:{Cookie:cookie},body:{requestId:"csrf",trip:{title:"Blocked"}}})).status,403);
  ok(await api("/api/logout",{method:"POST",bearer:false,headers:{Cookie:cookie,Origin:runtime.url}}));
  assert.equal((await api("/api/session",{bearer:false,headers:{Cookie:cookie}})).status,401);
  console.log("Authentication, hostile origins and cookie write protection passed.");

  let a=ok(await api("/api/trips",{method:"POST",body:{requestId:"create-a",trip:{title:"Fictional Coast"}}}),201).trip;
  const b=ok(await api("/api/trips",{method:"POST",body:{requestId:"create-b",trip:{title:"Fictional Mountain"}}}),201).trip;
  assert.equal(ok(await api("/api/trips")).trips.length,2);
  assert.equal((await api("/api/trips/missing-trip")).status,404);
  const originalCreate=ok(await api("/api/trips",{method:"POST",body:{requestId:"create-a",trip:{title:"Fictional Coast"}}}),201);
  assert.equal(originalCreate.trip.id,a.id);
  assert.equal((await api("/api/trips",{method:"POST",body:{requestId:"create-a",trip:{title:"Changed payload"}}})).status,409);
  a=ok(await write(a,[{type:"upsert_day",day:{id:"day-a",date:"2030-06-01",slots:[
    {id:"plan-1",name:"Original name",period:"morning",time:"10:00",sortTime:"10:00",sortOrder:1,review:"Original notes",i18n:{"zh-Hans":{name:"旧名称",review:"旧说明"},"ja":{name:"以前の名前"}}},
    {id:"plan-2",name:"Other stop",period:"morning",time:"09:00",sortTime:"09:00",sortOrder:2}
  ]}},{type:"upsert_reminder",reminder:{id:"todo-a",item:"Original reminder",dueDate:"2030-06-01",done:false,i18n:{"ja":{item:"以前の予定"}}}}])).trip;
  assert.equal(ok(await api("/api/trips/"+b.id)).trip.version,b.version);
  assert.equal((await write(a,[{type:"update_trip",fields:{title:"Stale"}}],"stale",1)).status,409);
  const version=a.version;
  assert.equal((await write(a,[{type:"upsert_reminder",reminder:{id:"atomic",item:"Must not persist"}},{type:"upsert_day",day:{id:"invalid",date:"2030-02-30"}}])).status,422);
  assert.equal(ok(await api("/api/trips/"+a.id)).trip.version,version);
  assert.ok(!ok(await api("/api/trips/"+a.id)).trip.reminders.some((r)=>r.id==="atomic"));
  const changed=[{type:"upsert_plan",dayId:"day-a",plan:{id:"plan-1",name:"Edited name",review:"Edited notes",time:"11:00"}},{type:"upsert_reminder",reminder:{id:"todo-a",item:"Edited reminder",done:true}}];
  const committed=ok(await write(a,changed,"repeat-edit"));const repeated=ok(await write(a,changed,"repeat-edit"));assert.deepEqual(repeated,committed);a=committed.trip;
  assert.deepEqual(a.days[0].slots.map((p)=>p.id),["plan-2","plan-1"]);
  assert.equal(a.days[0].slots[1].sortTime,"11:00");
  assert.equal(a.days[0].slots[1].sortOrder,2);
  assert.equal(a.days[0].slots[1].i18n,undefined);
  assert.equal(a.reminders[0].i18n,undefined);
  assert.equal(a.reminders[0].done,true);
  const replacement=structuredClone(a);replacement.days[0].slots[1].name="Snapshot edit";
  a=ok(await write(a,[{type:"replace_content",trip:replacement}])).trip;
  assert.equal(a.days[0].slots[1].name,"Snapshot edit");
  console.log("Two trips, isolation, empty drafts, atomic batches, stale versions, durable retries, translations and time sorting passed.");

  const sdk=new Client({name:"fictional-integration",version:"1.0.0"});clients.push(sdk);
  await sdk.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{requestInit:{headers:{Authorization:"Bearer "+token}}}));
  const listed=(await sdk.listTools()).tools;
  assert.deepEqual(listed.map((t)=>t.name).sort(),["apply_trip_changes","create_trip","get_trip","list_trips"]);
  const readHints={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  assert.deepEqual(Object.fromEntries(listed.map((t)=>[t.name,t.annotations])),{
    list_trips:readHints,get_trip:readHints,
    create_trip:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
    apply_trip_changes:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:false}
  });
  const mcp=async(name,args)=> {
    const result=await sdk.callTool({name,arguments:args});
    return {isError:result.isError,data:result.structuredContent||JSON.parse(result.content[0].text)};
  };
  const created=await mcp("create_trip",{requestId:"mcp-create",trip:{title:"Fictional AI trip"}});
  assert.ok(!created.isError);assert.equal(ok(await api("/api/trips/"+created.data.trip.id)).trip.title,"Fictional AI trip");
  const batched=await mcp("apply_trip_changes",{tripId:created.data.trip.id,requestId:"mcp-batch",expectedVersion:1,changes:[
    {type:"upsert_day",day:{id:"mcp-day",date:"2030-06-02"}},
    {type:"upsert_plan",dayId:"mcp-day",plan:{id:"mcp-plan",name:"Fictional MCP stop",time:"10:00"}},
    {type:"upsert_reminder",reminder:{id:"mcp-todo",item:"Fictional MCP reminder",done:true}}
  ]});
  assert.ok(!batched.isError);assert.equal(batched.data.trip.reminders[0].done,true);
  assert.equal(ok(await api("/api/trips/"+created.data.trip.id)).trip.days[0].slots[0].name,"Fictional MCP stop");
  const rejected=await mcp("apply_trip_changes",{tripId:created.data.trip.id,requestId:"mcp-invalid-batch",expectedVersion:2,changes:[
    {type:"update_trip",fields:{title:"Must roll back"}},
    {type:"upsert_day",day:{id:"invalid-mcp-day",date:"2030-02-30"}}
  ]});
  assert.equal(rejected.isError,true);assert.equal(ok(await api("/api/trips/"+created.data.trip.id)).trip.title,"Fictional AI trip");
  const aiEdit=await mcp("apply_trip_changes",{tripId:a.id,requestId:"mcp-edit",expectedVersion:a.version,changes:[{type:"update_trip",fields:{title:"MCP edited coast"}}]});
  assert.ok(!aiEdit.isError);a=aiEdit.data.trip;
  assert.equal(ok(await api("/api/trips/"+a.id)).trip.title,"MCP edited coast");
  a=ok(await write(a,[{type:"update_trip",fields:{title:"Web edited coast"}}])).trip;
  assert.equal((await mcp("get_trip",{tripId:a.id})).data.trip.title,"Web edited coast");
  assert.equal((await mcp("get_trip",{tripId:"missing-trip"})).isError,true);
  const mcpConflict=await mcp("apply_trip_changes",{tripId:a.id,requestId:"mcp-stale",expectedVersion:1,changes:[{type:"archive_trip",archived:true}]});
  assert.equal(mcpConflict.data.error.code,"version_conflict");
  await sdk.close();clients.pop();
  console.log("Actual MCP initialization, discovery, tool calls and bidirectional HTTP/MCP editing passed (official SDK, protocol 2025-11-25).");

  const fixture=JSON.parse(fs.readFileSync(new URL("../assets/trip.example.json",import.meta.url)));
  assert.equal((await api("/api/import",{method:"POST",body:{requestId:"bad-import",data:{trip:{title:"Invalid",days:"wrong type"}}}})).status,422);
  const extraFixture=structuredClone(fixture);extraFixture.trip.days[0].fictionalNote="Retained content";
  const extraImport=ok(await api("/api/import",{method:"POST",body:{requestId:"extra-import",data:extraFixture}}),201);
  assert.equal(extraImport.trip.days[0].compat.unmapped.fictionalNote,"Retained content");
  assert.ok(extraImport.warnings.some((warning)=>warning.includes("fictionalNote")));
  const imported=ok(await api("/api/import",{method:"POST",body:{requestId:"legacy",data:fixture}}),201);
  assert.equal(imported.trip.days[0].slots[0].id,fixture.trip.days[0].plans[0].id);
  assert.deepEqual(imported.trip.resources,fixture.trip.resources);
  const duplicate=ok(await api("/api/import",{method:"POST",body:{requestId:"legacy-again",data:fixture}}),201);
  assert.notEqual(duplicate.trip.id,imported.trip.id);
  a=ok(await write(a,[{type:"archive_trip",archived:true}])).trip;
  assert.equal((await write(a,[{type:"update_trip",fields:{title:"Blocked archive edit"}}])).status,409);
  assert.equal(ok(await api("/api/trips/"+b.id)).trip.archived,false);
  const exported=ok(await api("/api/trips/"+a.id+"/export"));
  const restoreConfig=readConfig({SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:path.join(temporary,"export-restore"),SHARED_TRIP_PORT:"0"});
  const restored=await startServer(restoreConfig);all.push(restored);
  const roundtrip=ok(await api("/api/import",{method:"POST",base:restored.url,body:{requestId:"restore-export",data:exported}}),201);
  assert.deepEqual(roundtrip.trip,a);
  const snapshot=path.join(temporary,"consistent.sqlite");
  await snapshotDatabase(path.join(config.dataDir,"shared-trip.sqlite"),snapshot);validateSnapshot(snapshot);
  const backupDir=path.join(temporary,"backup-restore");
  execFileSync(process.execPath,["server/cli/restore.mjs",snapshot],{env:{...process.env,SHARED_TRIP_DATA_DIR:backupDir},stdio:"pipe"});
  const restoredBackup=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:backupDir,SHARED_TRIP_PORT:"0"}));all.push(restoredBackup);
  assert.deepEqual(ok(await api("/api/trips/"+a.id,{base:restoredBackup.url})).trip,a);
  assert.throws(()=>execFileSync(process.execPath,["server/cli/restore.mjs",snapshot],{env:{...process.env,SHARED_TRIP_DATA_DIR:config.dataDir},stdio:"pipe"}));
  await runtime.close();all.splice(all.indexOf(runtime),1);runtime=await startServer(config);all.push(runtime);
  assert.deepEqual(ok(await api("/api/trips/"+a.id)).trip,a);
  const count=ok(await api("/api/trips")).trips.length;
  assert.equal(ok(await api("/api/trips",{method:"POST",body:{requestId:"create-a",trip:{title:"Fictional Coast"}}}),201).trip.id,a.id);
  assert.equal(ok(await api("/api/trips")).trips.length,count);
  assert.equal((await api("/api/session",{bearer:false,headers:{Cookie:cookie}})).status,401);
  console.log("Legacy import, duplicate import, reversible archive, export restoration, live consistent backup, restore lock and restart persistence passed.");

  const priorDir=path.join(temporary,"prior-version");fs.mkdirSync(priorDir);
  const prior=new DatabaseSync(path.join(priorDir,"shared-trip.sqlite"));
  prior.exec("CREATE TABLE trips(id TEXT PRIMARY KEY,version INTEGER NOT NULL,archived INTEGER NOT NULL,data TEXT NOT NULL);CREATE TABLE request_log(scope TEXT,request_id TEXT,fingerprint TEXT,result TEXT,PRIMARY KEY(scope,request_id));PRAGMA user_version=1");
  const oldTrip={id:"prior-trip",version:3,archived:false,title:"Fictional prior release",timezone:"UTC",days:[{id:"prior-day",date:"2030-01-01",plans:[{id:"prior-plan",name:"Prior stop",time:"10:00"}]}],reminders:[]};
  prior.prepare("INSERT INTO trips VALUES(?,?,?,?)").run(oldTrip.id,3,0,JSON.stringify(oldTrip));prior.close();
  const upgraded=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:priorDir,SHARED_TRIP_PORT:"0"}));all.push(upgraded);
  const oldRead=ok(await api("/api/trips/prior-trip",{base:upgraded.url})).trip;
  assert.equal(oldRead.id,oldTrip.id);assert.equal(oldRead.version,3);assert.equal(oldRead.days[0].slots[0].id,"prior-plan");
  assert.equal(upgraded.db.prepare("PRAGMA user_version").get().user_version,3);
  const priorSnapshot=fs.readdirSync(priorDir).find((file)=>/^shared-trip\.sqlite\.before-v3-\d+$/.test(file));
  assert.ok(priorSnapshot);
  const retained=new DatabaseSync(path.join(priorDir,priorSnapshot),{readOnly:true});
  assert.equal(retained.prepare("PRAGMA user_version").get().user_version,1);retained.close();
  assert.deepEqual(ok(await api("/api/users",{base:upgraded.url})),{accounts:[],invitations:[]});
  console.log("Fictional schema-v1 upgrade to v3 preserves trip/item identity, adds empty account tables and keeps a pre-migration snapshot.");
  const navigation=await fetch(runtime.url+"/trips/"+a.id,{headers:{Authorization:"Bearer "+token}});
  const html=await navigation.text();assert.equal(navigation.headers.get("cache-control"),"no-store");assert.ok(!html.includes(a.title));assert.ok(html.includes("/hosted-bootstrap.js"));
  const manifest=await (await fetch(runtime.url+"/manifest.webmanifest")).json();assert.equal(manifest.id,"/");assert.equal(manifest.scope,"/");assert.equal(manifest.start_url,"/");
  console.log("Generic protected navigation and a single stable PWA identity passed. Browser/device installation is a separate check.");
} finally {
  for(const client of clients)await client.close().catch(()=>{});
  for(const item of all.reverse())await item.close();
  fs.rmSync(temporary,{recursive:true,force:true});
}
