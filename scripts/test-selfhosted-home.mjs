// Home-page DOM simulation using the actual server. No layout/device claim.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { readConfig, startServer } from "../server/app.mjs";
const directory=fs.mkdtempSync(path.join(os.tmpdir(),"shared-trip-home-"));
const token=crypto.randomBytes(32).toString("base64url");
const runtime=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:directory,SHARED_TRIP_PORT:"0"}));
runtime.service.createTrip({requestId:"home-a",trip:{title:"Fictional home coast"}});
runtime.service.createTrip({requestId:"home-b",trip:{title:"Fictional home hills"}});
const errors=[];const consoleBridge=new VirtualConsole();consoleBridge.on("jsdomError",(e)=>errors.push(e.message));
const dom=new JSDOM(fs.readFileSync(new URL("../assets/selfhosted/index.html",import.meta.url),"utf8"),{url:runtime.url,runScripts:"outside-only",virtualConsole:consoleBridge});
const {window}=dom;window.SHARED_TRIP_HOSTED=true;
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event("close"));};
for(const name of ["window","document","location","localStorage","sessionStorage","FormData"])Object.defineProperty(globalThis,name,{value:window[name],configurable:true});
const nativeFetch=globalThis.fetch;const nativeTimeout=globalThis.setTimeout;const timers=new Set();
globalThis.setTimeout=(fn,delay,...args)=>{const timer=nativeTimeout(()=>{timers.delete(timer);fn(...args);},delay);timer.unref();timers.add(timer);return timer;};
globalThis.fetch=(input,options={})=>nativeFetch(new URL(input,runtime.url),{...options,headers:{...options.headers,Authorization:"Bearer "+token,Origin:runtime.url}});
const until=async(predicate,label)=>{const end=Date.now()+4000;while(!predicate()){if(Date.now()>end)throw new Error("Timed out: "+label+" "+window.document.getElementById("status").textContent);await new Promise((r)=>nativeTimeout(r,10));}};
const submit=(form)=>form.dispatchEvent(new window.Event("submit",{cancelable:true,bubbles:true}));
try{
  const client=new URL("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__",import.meta.url).href;
  const source=fs.readFileSync(new URL("../assets/selfhosted/home.js",import.meta.url),"utf8").replace('"/hosted-client.js?v=__CACHE_VERSION__"',JSON.stringify(client));
  await import("data:text/javascript;base64,"+Buffer.from(source).toString("base64"));
  await until(()=>window.document.querySelectorAll(".trip-card").length===2,"list two trips");
  window.document.getElementById("create").click();
  const create=window.document.querySelector("dialog form");create.elements.title.value="Fictional UI-created trip";submit(create);
  const card=()=>[...window.document.querySelectorAll(".trip-card")].find((c)=>c.querySelector("h2").textContent==="Fictional UI-created trip");
  await until(()=>runtime.service.listTrips().trips.length===3&&!window.document.querySelector("dialog")&&card(),"create and render draft");
  const created=runtime.service.listTrips().trips.find((t)=>t.title==="Fictional UI-created trip");
  assert.equal(card().querySelector("a").getAttribute("href"),"/trips/"+created.id);
  card().querySelector("button").click();
  await until(()=>window.document.querySelector("dialog form"),"open metadata editor");
  const metadata=window.document.querySelector("dialog form");metadata.elements.title.value="Fictional renamed trip";submit(metadata);
  const renamed=()=>[...window.document.querySelectorAll(".trip-card")].find((c)=>c.querySelector("h2").textContent==="Fictional renamed trip");
  await until(()=>runtime.service.getTrip(created.id).trip.title==="Fictional renamed trip"&&!window.document.querySelector("dialog")&&renamed(),"metadata edit rendered");
  renamed().querySelectorAll("button")[1].click();
  await until(()=>runtime.service.getTrip(created.id).trip.archived&&!renamed(),"archive trip");
  const archived=window.document.getElementById("archived");archived.checked=true;archived.dispatchEvent(new window.Event("change"));
  assert.ok(renamed());renamed().querySelectorAll("button")[1].click();
  await until(()=>!runtime.service.getTrip(created.id).trip.archived,"restore trip");
  const picker=window.document.getElementById("import");
  const data=JSON.parse(fs.readFileSync(new URL("../assets/trip.example.json",import.meta.url),"utf8"));
  data.trip.fictionalExtension="Preserved by importer";
  Object.defineProperty(picker,"files",{value:[{size:10000,text:async()=>JSON.stringify(data)}],configurable:true});
  picker.dispatchEvent(new window.Event("change"));
  await until(()=>runtime.service.listTrips().trips.length===4&&window.document.getElementById("status").textContent.includes("fictionalExtension"),"import and visible warnings");
  const imported=runtime.service.listTrips().trips.find((t)=>t.title==="Tide Lines");
  assert.equal(runtime.service.getTrip(imported.id).trip.content.importExtras.fictionalExtension,"Preserved by importer");
  for(const language of ["en","zh-Hans","zh-Hant","ja"]){const selector=window.document.getElementById("language");selector.value=language;selector.dispatchEvent(new window.Event("change"));assert.equal(window.document.documentElement.lang,language);assert.ok(window.document.querySelector("h1").textContent);}
  assert.deepEqual(errors,[]);
  console.log("Home DOM simulation passed: two trips, creation, stable links, metadata editing, archive/restore isolation, import with visible preservation warnings, and four languages. No browser layout claim.");
}finally{
  timers.forEach(clearTimeout);window.close();globalThis.fetch=nativeFetch;globalThis.setTimeout=nativeTimeout;await runtime.close();fs.rmSync(directory,{recursive:true,force:true});
}
