import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {readConfig,startServer} from "../server/app.mjs";import {snapshotDatabase,validateSnapshot} from "../server/db.mjs";
import {sanitizeLogoData} from "../server/domain/branding.mjs";import {BRANDING_PRESETS,brandingProblems,themeTokens,contrast} from "../assets/app-template/public/trip-branding.js";
import {fictionalLogo,logoObject} from "./fixtures/branding.mjs";
const folder=fs.mkdtempSync(path.join(os.tmpdir(),"shared-trip-branding-")),owner="fictional-branding-owner-only-0000000000";
const config={SHARED_TRIP_DATA_DIR:path.join(folder,"data"),SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_PORT:"0",SHARED_TRIP_HOST:"127.0.0.1"};
let runtime,client,restored;const nativeFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);assert.equal(url.hostname,"127.0.0.1","fictional test must not contact providers");return nativeFetch(input,init);};
async function api(route,body,{cookie,anonymous=false}={}){const response=await fetch(runtime.url+route,{method:body===undefined?"GET":"POST",headers:{...(!anonymous&&!cookie?{Authorization:"Bearer "+owner}:{}),...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{"Content-Type":"application/json",Origin:runtime.url}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return {status:response.status,data:await response.json()};}
const ok=(r,status=200)=>{assert.equal(r.status,status,"fictional HTTP outcome; payload omitted");return r.data;};
const read=async id=>ok(await api("/api/trips/"+id)).trip;
const patch=async(trip,branding,id,options)=>api("/api/trips/"+trip.id+"/changes",{requestId:id,expectedVersion:trip.version,changes:[{type:"update_trip",fields:{branding}}]},options);
async function tool(name,args,error){const result=await client.callTool({name,arguments:args});const data=result.structuredContent||JSON.parse(result.content[0].text);assert.equal(Boolean(result.isError),Boolean(error));if(error)assert.equal(data.error.code,error);return data;}
try{
 for(const name of Object.keys(BRANDING_PRESETS)){
  const tokens=themeTokens({theme:{preset:name}});for(const bg of [tokens.paper,tokens.card,"#e7e7e7"]){assert.ok(contrast(tokens.text,bg)>=4.5);assert.ok(contrast(tokens.muted,bg)>=4.5);assert.ok(contrast(tokens["accent-text"],bg)>=4.5);assert.ok(contrast(tokens.line,bg)>=3);}
  assert.ok(contrast(tokens.accent,"#ffffff")>=4.5);assert.ok(contrast(tokens.ink,"#fffdf8")>=4.5);
 }
 const png=fictionalLogo(),withMetadata=fictionalLogo({extra:[["tEXt",Buffer.from("Comment\0fictional_metadata_must_not_survive")],["eXIf",Buffer.from("fictional-metadata")]]});
 assert.equal(sanitizeLogoData(withMetadata.toString("base64")),sanitizeLogoData(png.toString("base64")));assert.equal(sanitizeLogoData(sanitizeLogoData(png.toString("base64"))),sanitizeLogoData(png.toString("base64")));
 const broken=Buffer.from(png);broken[30]^=1;
 const invalidPng=[broken,fictionalLogo({width:257}),fictionalLogo({extra:[["acTL",Buffer.alloc(8)]]}),fictionalLogo({extra:[["tRNS",Buffer.alloc(6)]]}),fictionalLogo({tail:Buffer.from("<script>fictional</script>")}),fictionalLogo({raw:Buffer.alloc(5000000)}),fictionalLogo({raw:Buffer.alloc(24*(24*4+1),9)}),Buffer.from("<svg onload='fictional()'/>")];
 for(const bytes of invalidPng)assert.throws(()=>sanitizeLogoData(bytes.toString("base64")));
 assert.equal(brandingProblems({theme:{preset:"custom",ink:"#ffffff",accent:"#000000",background:"#ffffff"}}).length>0,true);
 assert.equal(brandingProblems({theme:{preset:"custom",ink:"#ffffff",accent:"#ffffff",background:"#000000"}}).length>0,true);
 runtime=await startServer(readConfig(config));
 const legacy={title:"Fictional branding trip",theme:{ink:"#17362f",accent:"#db7549",background:"#f3ede3"},googlePlacePhotosEnabled:true,weather:{locations:[]},days:[{id:"day-one",date:"2031-06-10",weatherLocationIds:[],slots:[{id:"plan-one",name:"Fictional gallery",lat:10,lng:20,relatedLinks:[{id:"guide",label:"Guide",url:"https://example.org/fictional"}],photo:{url:"https://example.org/image.png",credit:"Fictional"}}]}]};
 let trip=ok(await api("/api/trips",{requestId:"branding-create",trip:legacy}),201).trip;const original=structuredClone(trip);
 const other=ok(await api("/api/trips",{requestId:"branding-other",trip:{title:"Fictional independent trip"}}),201).trip;
 assert.ok(!Object.hasOwn(await read(trip.id),"branding"),"old trips stay absent; no default rewrite or version increment");
 ok(await patch(trip,{theme:{preset:"sage"}},"branding-anonymous",{anonymous:true}),401);
 const invite=ok(await api("/api/invitations",{}),201).invitation.token,username="fictional.brand.editor",password="Fictional-passphrase-only-12345";
 ok(await api("/api/accept-invite",{invitation:invite,username,password},{anonymous:true}),201);const account=ok(await api("/api/users")).accounts[0];ok(await api(`/api/users/${account.id}/approve`,{}));
 const login=await fetch(runtime.url+"/api/login",{method:"POST",headers:{"Content-Type":"application/json",Origin:runtime.url},body:JSON.stringify({username,password})});assert.equal(login.status,200);const cookie=login.headers.get("set-cookie").split(";")[0];await login.body.cancel();
 ok(await patch(trip,{theme:{preset:"sage"}},"branding-viewer",{cookie}),403);
 ok(await api(`/api/users/${account.id}/role`,{role:"content-manager"}));
 const secret=ok(await api(`/api/users/${account.id}/mcp-tokens`,{label:"Fictional branding regression"}),201).secret;
 const connect=async()=>{client=new Client({name:"fictional-branding-client",version:"1.0.0"});await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{requestInit:{headers:{Authorization:"Bearer "+secret}}}));};await connect();
 const tools=(await client.listTools()).tools;assert.equal(tools.length,6);const operationSchema=tools.find(t=>t.name==="apply_trip_changes").inputSchema.properties.changes.items;const variants=operationSchema.anyOf||operationSchema.oneOf;
 const shape=variants.find(v=>v.properties.type.const==="update_trip").properties.fields.properties.branding.anyOf.find(v=>v.type==="object");assert.equal(shape.additionalProperties,false);assert.ok(shape.properties.logo.anyOf.some(v=>v.type==="null"));assert.ok(shape.properties.theme.anyOf.find(v=>v.properties.preset.const==="custom").required.includes("background"));
 assert.ok(tools.find(t=>t.name==="create_trip").inputSchema.properties.trip.properties.branding);
 const branding={logo:{...logoObject(),data:withMetadata.toString("base64")},theme:{preset:"sage"}};
 const request={tripId:trip.id,expectedVersion:trip.version,requestId:"branding-set",changes:[{type:"update_trip",fields:{branding}}]};
 const saved=await tool("apply_trip_changes",request);trip=saved.trip;assert.equal(trip.version,original.version+1);assert.equal(trip.branding.logo.data,sanitizeLogoData(png.toString("base64")));assert.deepEqual(trip.branding.theme,{preset:"sage"});
 const expected=structuredClone(original);expected.branding=trip.branding;expected.version=trip.version;expected.updatedAt=trip.updatedAt;assert.deepEqual(trip,expected,"only branding and ordinary metadata change");assert.deepEqual((await tool("get_trip",{tripId:trip.id})).trip,trip);
 assert.deepEqual(await tool("apply_trip_changes",request),saved);await tool("apply_trip_changes",{...request,requestId:"branding-stale"},"version_conflict");
 const invalid=[{logo:{...logoObject(),mimeType:"image/svg+xml"}},{logo:{...logoObject(),data:"https://example.org/image.png"}},{logo:{...logoObject(),data:broken.toString("base64")}},{logo:{...logoObject(),data:fictionalLogo({width:257}).toString("base64")}},{logo:{...logoObject(),data:png.toString("base64")+"A"}},{logo:{...logoObject(),src:"https://example.org/"}},{theme:{preset:"sage",accent:"#000000"}},{theme:{preset:"unknown"}},{theme:{preset:"custom",ink:"#ffffff",accent:"#000000",background:"#ffffff"}},{theme:{preset:"custom",ink:"#000000",accent:"javascript:fictional",background:"#ffffff"}}];
 for(const[index,value]of invalid.entries()){
  await tool("apply_trip_changes",{tripId:trip.id,expectedVersion:trip.version,requestId:"branding-invalid-"+index,changes:[{type:"update_trip",fields:{title:"Must roll back",branding:value}}]},"validation_failed");assert.deepEqual(await read(trip.id),trip);
 }
 const custom={logo:trip.branding.logo,theme:{preset:"custom",ink:"#163d30",accent:"#aaee11",background:"#eff8ed"}};
 const race=await Promise.all([patch(trip,custom,"branding-race-a"),patch(trip,{theme:{preset:"ocean"}},"branding-race-b")]);assert.deepEqual(race.map(v=>v.status).sort(),[200,409]);trip=await read(trip.id);
 if(!trip.branding.logo)trip=ok(await patch(trip,{...trip.branding,logo:logoObject()},"branding-backup-logo")).trip;
 assert.ok(trip.branding.logo.data,"backup/export fixture always includes actual raster bytes regardless of race winner");
 assert.deepEqual(await read(other.id),other);
 const exported=await tool("export_trip",{tripId:trip.id});const imported=(await tool("import_trip",{requestId:"branding-import",data:exported})).trip;assert.notEqual(imported.id,trip.id);assert.deepEqual(imported.branding,trip.branding);
 const snapshot=path.join(folder,"snapshot.sqlite");await snapshotDatabase(path.join(config.SHARED_TRIP_DATA_DIR,"shared-trip.sqlite"),snapshot);validateSnapshot(snapshot);
 const restoredDir=path.join(folder,"restore");fs.mkdirSync(restoredDir);fs.copyFileSync(snapshot,path.join(restoredDir,"shared-trip.sqlite"));restored=await startServer(readConfig({...config,SHARED_TRIP_DATA_DIR:restoredDir}));assert.deepEqual(restored.service.getTrip(trip.id).trip,trip);await restored.close();restored=null;
 const beforeRestart=structuredClone(trip);await client.close();client=null;await runtime.close();runtime=await startServer(readConfig(config));await connect();assert.deepEqual(await read(trip.id),beforeRestart);assert.deepEqual(await tool("apply_trip_changes",request),saved);assert.deepEqual(await read(trip.id),beforeRestart);
 trip=(await tool("apply_trip_changes",{tripId:trip.id,expectedVersion:trip.version,requestId:"branding-reset",changes:[{type:"update_trip",fields:{branding:{logo:null,theme:{preset:"default"}}}}]})).trip;assert.equal(trip.branding.logo,null);assert.equal(trip.branding.theme.preset,"default");assert.deepEqual(trip.theme,original.theme);
 trip=(await tool("apply_trip_changes",{tripId:trip.id,expectedVersion:trip.version,requestId:"branding-clear",changes:[{type:"update_trip",fields:{branding:null}}]})).trip;assert.ok(!Object.hasOwn(trip,"branding"));assert.deepEqual(trip.theme,original.theme);
 const audit=JSON.stringify(ok(await api("/api/audit?limit=500")));for(const needle of [branding.logo.data,"Fictional leaf symbol",secret])assert.ok(!audit.includes(needle),"audit excludes logo data and credentials");
 assert.equal(fs.existsSync(path.join(config.SHARED_TRIP_DATA_DIR,"google-allowance.sqlite")),false);
 ok(await api(`/api/users/${account.id}/revoke`,{}));await assert.rejects(()=>tool("get_trip",{tripId:trip.id}));
 console.log("Trip branding tests passed: bounded PNG structure/CRC/inflation and metadata removal, accessible palette tokens, real HTTP/SDK typed discovery, owner/manager writes and viewer denial, atomicity/conflicts/concurrency, durable retries/restart, trip isolation, unchanged legacy content, backup/restore and export/import with embedded logos, reset and payload-free audit. Fictional local-only data; no providers.");
}finally{await client?.close();await restored?.close();await runtime?.close();globalThis.fetch=nativeFetch;assert.ok(folder.startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(folder,{recursive:true,force:true});}
