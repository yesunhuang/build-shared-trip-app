// DOM simulation against the real HTTP service. This is not browser layout,
// pointer-gesture, physical-device, or PWA-installation evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { JSDOM, VirtualConsole } from "jsdom";
import { readConfig, startServer } from "../server/app.mjs";

const directory=fs.mkdtempSync(path.join(os.tmpdir(),"shared-trip-ui-"));
const token=crypto.randomBytes(32).toString("base64url");
const runtime=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:token,SHARED_TRIP_DATA_DIR:directory,SHARED_TRIP_PORT:"0"}));
const trip=runtime.service.createTrip({requestId:"ui-create",trip:{title:"Fictional editor draft"}}).trip;
const errors=[];
const virtualConsole=new VirtualConsole();
virtualConsole.on("jsdomError",(error)=>{if(!error.message.includes("Not implemented: navigation"))errors.push(error.message);});
const html=fs.readFileSync(new URL("../assets/app-template/public/index.html",import.meta.url),"utf8").replace("__TRIP_DATA_JSON__","{}");
const dom=new JSDOM(html,{url:runtime.url+"/trips/"+trip.id,runScripts:"outside-only",pretendToBeVisual:true,virtualConsole});
const {window}=dom;
window.SHARED_TRIP_HOSTED=true;
window.matchMedia=(query)=>({matches:false,media:query,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}});
window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
window.scrollTo=function(){};
window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event("close"));};
const nativeTimeout=globalThis.setTimeout;
const nativeClear=globalThis.clearTimeout;
const nativeFetch=globalThis.fetch;
const timers=new Set();
globalThis.setTimeout=(fn,delay,...args)=>{
  // Accelerate reconnect/poll waits, while keeping actual HTTP deadlines realistic.
  // Clamping a 20-second write deadline to 100 ms makes valid local writes fail under load.
  // The poller's named tick also uses 20 seconds; keep that wait accelerated.
  const requestDeadline=fn.name!=="tick"&&[8000,12000,20000].includes(delay);
  const timer=nativeTimeout(()=>{timers.delete(timer);fn(...args);},requestDeadline?delay:Math.min(delay,100));timers.add(timer);timer.unref();return timer;
};
globalThis.clearTimeout=(timer)=>{timers.delete(timer);nativeClear(timer);};
for(const key of ["window","document","location","localStorage","sessionStorage","FormData","HTMLElement","HTMLInputElement","HTMLSelectElement","HTMLDialogElement","Node","Element"]){
  Object.defineProperty(globalThis,key,{value:window[key],writable:true,configurable:true});
}
Object.defineProperty(globalThis,"navigator",{value:window.navigator,configurable:true});
globalThis.getComputedStyle=window.getComputedStyle.bind(window);
globalThis.matchMedia=window.matchMedia;
globalThis.requestAnimationFrame=(fn)=>globalThis.setTimeout(()=>fn(Date.now()),16);
globalThis.cancelAnimationFrame=globalThis.clearTimeout;
globalThis.confirm=()=>true;
// The original template defines its map/checklist utility functions inline.
for (const script of window.document.querySelectorAll("script:not([src])")) {
  if (script.type === "application/json") continue;
  window.eval(script.textContent);
  for (const match of script.textContent.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (typeof window[match[1]] === "function") globalThis[match[1]] = window[match[1]];
  }
}
let firstFailure=true;let unavailable=false;
const requests=[];
const failedResponses=[];
globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==="string"?input:input.url,runtime.url);requests.push(url.href);
  if(!url.pathname.startsWith("/api/"))throw new Error("External content unavailable in DOM simulation.");
  if(firstFailure&&url.pathname==="/api/trips/"+trip.id){firstFailure=false;throw new Error("Simulated initial connection failure.");}
  if(unavailable)throw new Error("Simulated disconnected client.");
  const response=await nativeFetch(url,{...options,headers:{...options.headers,Authorization:"Bearer "+token}});
  if(!response.ok)failedResponses.push(await response.clone().json());
  return response;
};
const current=()=>runtime.service.getTrip(trip.id).trip;
const until=async(predicate,label)=>{
  const deadline=Date.now()+5000;
  while(!predicate()){if(Date.now()>deadline)throw new Error("Timed out: "+label+" "+JSON.stringify(failedResponses)+" "+window.document.getElementById("toast")?.textContent);await new Promise((r)=>nativeTimeout(r,10));}
};
const submit=(form)=>form.dispatchEvent(new window.Event("submit",{bubbles:true,cancelable:true}));
const fill=(form,fields)=>{for(const [key,value]of Object.entries(fields))form.elements.namedItem(key).value=value;};
const itemEditor=(id)=>{
  const row=window.document.querySelector('[data-slot-id="'+id+'"]');
  assert.ok(row,"Plan appears in DOM");
  row.querySelector("details").open=true;
  row.querySelector("button").click();
  return window.document.getElementById("item-form");
};
try{
  await import("../assets/app-template/public/hosted-bootstrap.js?v=__CACHE_VERSION__");
  await until(()=>window.document.querySelector(".empty-state--dates button")&&!window.document.querySelector(".hosted-boot"),"initial failure then bootstrap recovery");
  assert.ok(requests.filter((url)=>url.endsWith("/api/trips/"+trip.id)).length>=2);
  window.document.querySelector(".empty-state--dates button").click();
  const dateForm=window.document.querySelector(".hosted-editor form");
  fill(dateForm,{date:"2030-06-01",theme:"Fictional day"});submit(dateForm);
  await until(()=>current().days.length===1&&!window.document.querySelector(".hosted-editor"),"add date");
  for(const [name,time]of [["First fictional stop","11:00"],["Second fictional stop","09:00"]]){
    window.document.querySelector(".day-heading__actions button").click();
    const form=window.document.getElementById("item-form");
    fill(form,{name,time,period:"morning",review:"Fictional notes",googleMapsUrl:"",planType:"sight",booked:"false"});
    submit(form);
    await until(()=>current().days[0].slots.some((s)=>s.name===name)&&!window.document.getElementById("item-dialog").open,"add plan");
  }
  window.document.getElementById("add-reminder").click();
  const reminderForm=window.document.getElementById("todo-form");fill(reminderForm,{item:"Fictional reminder",dueDate:"2030-06-01"});submit(reminderForm);
  await until(()=>current().reminders.length===1&&!window.document.getElementById("todo-dialog").open,"add reminder");
  const first=current().days[0].slots.find((s)=>s.name==="First fictional stop");
  runtime.service.applyTripChanges({tripId:trip.id,requestId:"translation",expectedVersion:current().version,changes:[{type:"upsert_plan",dayId:current().days[0].id,plan:{id:first.id,i18n:{"ja":{name:"以前の名前",review:"以前の説明"}}}}]});
  const language=window.document.getElementById("language-select");language.value="ja";language.dispatchEvent(new window.Event("change"));
  await until(()=>window.document.getElementById("itinerary-days").textContent.includes("以前の名前"),"poll independent update");
  const editor=itemEditor(first.id);fill(editor,{name:"Edited source name",review:"Edited source notes",time:"08:00"});submit(editor);
  await until(()=>current().days[0].slots[0].name==="Edited source name"&&!window.document.getElementById("item-dialog").open,"edit name notes time");
  assert.equal(current().days[0].slots[0].i18n,undefined);
  assert.equal(current().days[0].slots[0].sortTime,"08:00");
  assert.ok(window.document.getElementById("itinerary-days").textContent.includes("Edited source name"));
  const stale=itemEditor(first.id);fill(stale,{review:"Must not overwrite newer notes"});
  runtime.service.applyTripChanges({tripId:trip.id,requestId:"concurrent",expectedVersion:current().version,changes:[{type:"upsert_plan",dayId:current().days[0].id,plan:{id:first.id,review:"Newer remote notes"}}]});
  await until(()=>window.document.getElementById("itinerary-days").textContent.includes("Newer remote notes"),"concurrent poll");
  submit(stale);await new Promise((r)=>nativeTimeout(r,30));
  assert.equal(current().days[0].slots[0].review,"Newer remote notes");
  assert.equal(window.document.getElementById("toast").dataset.error,"true");
  window.document.getElementById("item-dialog").close();
  unavailable=true;window.dispatchEvent(new window.Event("offline"));
  const checkbox=window.document.querySelector("#reminder-list input[type=checkbox]");
  checkbox.checked=true;checkbox.dispatchEvent(new window.Event("change"));
  await new Promise((r)=>nativeTimeout(r,30));assert.equal(current().reminders[0].done,false);assert.equal(checkbox.checked,false);
  unavailable=false;window.dispatchEvent(new window.Event("online"));
  await until(()=>window.document.getElementById("sync-status").dataset.state==="synced","disconnect/reconnect");
  for(const lang of ["en","zh-Hans","zh-Hant","ja"]){language.value=lang;language.dispatchEvent(new window.Event("change"));assert.equal(window.document.documentElement.lang,lang);assert.equal(window.document.getElementById("trip-title").textContent,"Fictional editor draft");}
  assert.ok(!requests.some((url)=>url.includes("firebase")));
  assert.equal(window.localStorage.getItem("trip-"+trip.id+"-preview"),null);
  const client=await import("../assets/app-template/public/hosted-client.js?v=__CACHE_VERSION__");
  unavailable=true;await client.logoutAndLeave();
  assert.equal(client.signoutPending(),true);
  assert.equal(window.document.body.textContent,"");
  await assert.rejects(client.hostedApi.getTrip(trip.id),(error)=>error.status===401);
  unavailable=false;await client.finishPendingLogout();assert.equal(client.signoutPending(),false);
  assert.deepEqual(errors,[]);
  console.log("DOM simulation passed: initial failure recovery, empty draft, date/plan/reminder creation, independent updates, translated source editing, time ordering, stale open form rejection, failed offline write, reconnect, four languages, and pending sign-out isolation. No browser layout or installation claim.");
}finally{
  timers.forEach(nativeClear);window.close();globalThis.fetch=nativeFetch;globalThis.setTimeout=nativeTimeout;globalThis.clearTimeout=nativeClear;
  await runtime.close();fs.rmSync(directory,{recursive:true,force:true});
}
