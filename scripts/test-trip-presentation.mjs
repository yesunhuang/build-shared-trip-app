import {grantFixtureMembership} from "./fixtures/membership.mjs";
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {readConfig,startServer} from "../server/app.mjs";
import {snapshotDatabase,validateSnapshot} from "../server/db.mjs";
import {sanitizeRasterData} from "../server/domain/branding.mjs";
import {COVER_BYTES_MAX,COVER_EDGE_MAX,CARD_CATEGORIES,cardCategory} from "../assets/app-template/public/trip-presentation.js";
import {contrast} from "../assets/app-template/public/trip-branding.js";
import {fictionalLogo,logoObject} from "./fixtures/branding.mjs";
const folder=fs.mkdtempSync(path.join(os.tmpdir(),"shared-trip-presentation-")),owner="fictional-presentation-owner-only-00000000";
const env={SHARED_TRIP_DATA_DIR:path.join(folder,"data"),SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_PORT:"0",SHARED_TRIP_HOST:"127.0.0.1"};
let runtime,client,restored;const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);assert.equal(url.hostname,"127.0.0.1");return nativeFetch(input,init);};
async function api(route,body,{cookie,anonymous=false}={}){const response=await fetch(runtime.url+route,{method:body===undefined?"GET":"POST",headers:{...(!anonymous&&!cookie?{Authorization:"Bearer "+owner}:{}),...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{"Content-Type":"application/json",Origin:runtime.url}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:response.status,data:await response.json()};}
const ok=(r,status=200)=>{assert.equal(r.status,status,"fictional HTTP outcome; payload omitted");return r.data;};
const read=async id=>ok(await api("/api/trips/"+id)).trip;
const change=(trip,changes,requestId,options)=>api(`/api/trips/${trip.id}/changes`,{requestId,expectedVersion:trip.version,changes},options);
async function tool(name,args,error){const result=await client.callTool({name,arguments:args});const data=result.structuredContent||JSON.parse(result.content[0].text);assert.equal(Boolean(result.isError),Boolean(error));if(error)assert.equal(data.error.code,error);return data;}
try{
 for(const[ink,bg,line]of [["#663b13","#fff2df","#916029"],["#253e73","#eaf0ff","#536c9c"],["#154737","#e4f5ed","#36715b"]]){assert.ok(contrast(ink,bg)>=4.5);assert.ok(contrast(line,bg)>=3);}
 assert.equal(cardCategory(undefined),"neutral");assert.equal(cardCategory("car"),"neutral");assert.equal(cardCategory("walking"),"neutral");
 const bytes=fictionalLogo({width:768,height:320}),metadata=fictionalLogo({width:768,height:320,extra:[["tEXt",Buffer.from("Comment\0fictional")]]});
 const sanitize=data=>sanitizeRasterData(data,COVER_BYTES_MAX,COVER_EDGE_MAX);
 assert.equal(sanitize(bytes.toString("base64")),sanitize(metadata.toString("base64")));
 for(const bad of [fictionalLogo({width:1025}),fictionalLogo({extra:[["acTL",Buffer.alloc(8)]]}),fictionalLogo({raw:Buffer.alloc(5000000)}),Buffer.from("<svg/>"),Buffer.concat([bytes,Buffer.from("x")])])assert.throws(()=>sanitize(bad.toString("base64")));
 runtime=await startServer(readConfig(env));
 const base={title:"Fictional cover journey",branding:{logo:logoObject(),theme:{preset:"sage"}},googlePlacePhotosEnabled:true,weather:{locations:[]},days:[{id:"sample-day",date:"2031-06-10",weatherLocationIds:[],slots:[{id:"sample-walk",name:"Fictional walk",planType:"transport",booked:false,notes:"Walk along a fictional river",lat:10,lng:20},{id:"sample-car",name:"Fictional drive",planType:"car",booked:false}]}]};
 let trip=ok(await api("/api/trips",{requestId:"presentation-create",trip:base}),201).trip;const original=structuredClone(trip);
 const other=ok(await api("/api/trips",{requestId:"presentation-other",trip:{title:"Fictional independent journey"}}),201).trip;
 assert.ok(!Object.hasOwn(trip,"cover"));assert.ok(!Object.hasOwn(trip.days[0].slots[0],"cardCategory"));
 const cover={mimeType:"image/png",data:metadata.toString("base64"),alt:'Fictional geometric landscape <not markup>',focusX:25,focusY:70};
 const operations=[{type:"update_trip",fields:{cover}},{type:"upsert_plan",dayId:"sample-day",plan:{id:"sample-walk",cardCategory:"restaurant"}}];
 ok(await change(trip,operations,"presentation-anon",{anonymous:true}),401);
 ok(await api("/api/trips",undefined,{anonymous:true}),401);
 const invite=ok(await api("/api/invitations",{}),201).invitation.token;
 const username="fictional.presentation.editor",password="Fictional-passphrase-only-12345";
 ok(await api("/api/accept-invite",{invitation:invite,username,password},{anonymous:true}),201);
 const account=ok(await api("/api/users")).accounts[0];ok(await api(`/api/users/${account.id}/approve`,{}));
 const login=await fetch(runtime.url+"/api/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:runtime.url},body:JSON.stringify({username,password})});assert.equal(login.status,200);const cookie=login.headers.get("set-cookie").split(";")[0];await login.body.cancel();
 ok(await change(trip,operations,"presentation-viewer",{cookie}),403);
 ok(await api(`/api/users/${account.id}/role`,{role:"content-manager"}));
 grantFixtureMembership(runtime,trip.id,account.id);
 const secret=ok(await api(`/api/users/${account.id}/mcp-tokens`,{label:"Fictional presentation tests"}),201).secret;
 const connect=async()=>{client=new Client({name:"fictional-presentation-client",version:"1.0.0"});await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{requestInit:{headers:{Authorization:"Bearer "+secret}}}));};await connect();
 const inventory=(await client.listTools()).tools;assert.equal(inventory.length,6);
 const items=inventory.find(t=>t.name==="apply_trip_changes").inputSchema.properties.changes.items;const variants=items.anyOf||items.oneOf;
 const fields=variants.find(v=>v.properties.type.const==="update_trip").properties.fields.properties;
 const planFields=variants.find(v=>v.properties.type.const==="upsert_plan").properties.plan.properties;
 assert.ok(fields.cover.anyOf.some(v=>v.type==="null"));assert.equal(fields.cover.anyOf.find(v=>v.type==="object").properties.focusX.maximum,100);assert.deepEqual(planFields.cardCategory.enum,[...CARD_CATEGORIES]);assert.ok(fields.branding);assert.ok(planFields.googlePlaceAssociation);assert.ok(inventory.find(t=>t.name==="create_trip").inputSchema.properties.trip.properties.cover);
 const request={tripId:trip.id,expectedVersion:trip.version,requestId:"presentation-set",changes:operations};
 const saved=await tool("apply_trip_changes",request);trip=saved.trip;
 const expected=structuredClone(original);expected.cover={...cover,data:sanitize(cover.data)};expected.days[0].slots[0].cardCategory="restaurant";expected.version=trip.version;expected.updatedAt=trip.updatedAt;assert.deepEqual(trip,expected,"only cover/category and ordinary metadata change; booking, weather, logo and flags preserved");
 assert.deepEqual((await tool("get_trip",{tripId:trip.id})).trip,trip);assert.deepEqual(await tool("apply_trip_changes",request),saved);await tool("apply_trip_changes",{...request,requestId:"presentation-stale"},"version_conflict");
 const summary=ok(await api("/api/trips")).trips.find(t=>t.id===trip.id);assert.deepEqual(summary.cover,trip.cover);assert.ok(!summary.branding&&!summary.days,"home uses bounded summary, not complete trip content");
 for(const[index,bad]of [{...cover,focusX:101},{...cover,mimeType:"image/svg+xml"},{...cover,data:"https://example.org/fictional.png"},{...cover,data:fictionalLogo({width:1025}).toString("base64")},{...cover,url:"https://example.org/fictional"},{...cover,alt:"bad\ntext"},{...cover,data:"A".repeat(349532)}].entries()){
  ok(await change(trip,[{type:"update_trip",fields:{cover:bad,title:"Must roll back"}}],"presentation-invalid-"+index),422);assert.deepEqual(await read(trip.id),trip);
 }
 ok(await change(trip,[{type:"upsert_plan",dayId:"sample-day",plan:{id:"sample-walk",cardCategory:"flight"}}],"presentation-bad-category"),422);
 ok(await change(trip,[{type:"update_trip",fields:{i18n:{ja:{cover}}}}],"presentation-translated-cover"),422);
 ok(await change(trip,[{type:"upsert_plan",dayId:"sample-day",plan:{id:"sample-walk",i18n:{ja:{cardCategory:"hotel"}}}}],"presentation-translated-category"),422);assert.deepEqual(await read(trip.id),trip);
 for(const category of CARD_CATEGORIES){trip=(await tool("apply_trip_changes",{tripId:trip.id,expectedVersion:trip.version,requestId:"category-"+category,changes:[{type:"upsert_plan",dayId:"sample-day",plan:{id:"sample-walk",cardCategory:category}}]})).trip;assert.equal(trip.days[0].slots[0].cardCategory,category);assert.equal(trip.days[0].slots[0].planType,"transport");assert.equal(trip.days[0].slots[0].booked,false);}
 const race=await Promise.all([change(trip,[{type:"update_trip",fields:{cover:{...trip.cover,focusX:10}}}],"presentation-race-a"),change(trip,[{type:"update_trip",fields:{cover:{...trip.cover,focusX:90}}}],"presentation-race-b")]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);trip=await read(trip.id);
 const exported=await tool("export_trip",{tripId:trip.id});const imported=(await tool("import_trip",{requestId:"presentation-import",data:exported})).trip;assert.deepEqual(imported.cover,trip.cover);assert.deepEqual(imported.days,trip.days);assert.deepEqual(imported.branding,trip.branding);
 const snapshot=path.join(folder,"snapshot.sqlite");await snapshotDatabase(path.join(env.SHARED_TRIP_DATA_DIR,"shared-trip.sqlite"),snapshot);validateSnapshot(snapshot);const restoredDir=path.join(folder,"restore");fs.mkdirSync(restoredDir);fs.copyFileSync(snapshot,path.join(restoredDir,"shared-trip.sqlite"));restored=await startServer(readConfig({...env,SHARED_TRIP_DATA_DIR:restoredDir}));assert.deepEqual(restored.service.getTrip(trip.id).trip,trip);await restored.close();restored=null;
 await client.close();client=null;await runtime.close();runtime=await startServer(readConfig(env));await connect();assert.deepEqual(await read(trip.id),trip);assert.deepEqual(await tool("apply_trip_changes",request),saved);assert.deepEqual(await read(other.id),other);
 const beforeClear=structuredClone(trip);trip=(await tool("apply_trip_changes",{tripId:trip.id,expectedVersion:trip.version,requestId:"presentation-clear",changes:[{type:"update_trip",fields:{cover:null}}]})).trip;const clearExpected={...beforeClear,version:trip.version,updatedAt:trip.updatedAt};delete clearExpected.cover;assert.deepEqual(trip,clearExpected);assert.ok(!ok(await api("/api/trips")).trips.find(t=>t.id===trip.id).cover);
 const audit=JSON.stringify(ok(await api("/api/audit?limit=500")));assert.ok(!audit.includes(cover.data));assert.ok(!audit.includes(cover.alt));assert.equal(fs.existsSync(path.join(env.SHARED_TRIP_DATA_DIR,"google-allowance.sqlite")),false);
 console.log("Trip cover/category tests passed: real HTTP/MCP six-tool discovery and set/read/clear, shared validation, viewer/anonymous denial, manager writes, atomicity/conflicts/concurrent writes, durable retries/restart, isolated backup restore, export/import, preserved branding/bookings/flags/weather, trip isolation, PNG limits/metadata stripping and category contrast. Fictional loopback only.");
}finally{await client?.close();await restored?.close();await runtime?.close();globalThis.fetch=nativeFetch;assert.ok(folder.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(folder,{recursive:true,force:true});}
