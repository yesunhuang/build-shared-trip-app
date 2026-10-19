// Optional actual Chrome acceptance against fictional local data only.
// node scripts/test-trip-sharing-browser.mjs --playwright-module <existing module> --output <external directory>
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {readConfig,startServer} from "../server/app.mjs";
import {logoObject} from "./fixtures/branding.mjs";
const option=name=>process.argv[process.argv.indexOf(name)+1];
assert(process.argv.includes("--playwright-module")&&process.argv.includes("--output"));
const {chromium}=await import(pathToFileURL(path.resolve(option("--playwright-module"))).href);
const output=path.resolve(option("--output")),repo=fs.realpathSync(path.resolve(import.meta.dirname,".."));
assert(output!==repo&&!output.startsWith(repo+path.sep));fs.mkdirSync(output,{recursive:true});
const data=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-visitor-browser-")),owner=crypto.randomBytes(32).toString("base64url");
let runtime,browser,cases=0;const requests=[],errors=[];
try{
 runtime=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_DATA_DIR:data,SHARED_TRIP_HOST:"127.0.0.1",SHARED_TRIP_PORT:"0"}));
 async function api(route,body){const r=await fetch(runtime.url+route,{method:body===undefined?"GET":"POST",headers:{Authorization:"Bearer "+owner,...(body===undefined?{}:{"Content-Type":"application/json"})},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(r.ok,"fixture API "+route+" returned "+r.status+(!r.ok?" "+await r.clone().text():""));return r.json();}
 const timezone="Pacific/Kiritimati",parts=Object.fromEntries(new Intl.DateTimeFormat("en-US",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(p=>[p.type,p.value]));
 const today=`${parts.year}-${parts.month}-${parts.day}`,offset=n=>new Date(Date.parse(today+"T12:00:00Z")+n*86400000).toISOString().slice(0,10);
 const trip=(await api("/api/trips",{requestId:"fictional-visitor-browser",trip:{title:"Fictional Harbor Walk",timezone,cover:logoObject(),branding:{logo:logoObject(),theme:{preset:"sage"}},days:[-1,0,1].map((n,i)=>({id:n===0?"today":"day-"+i,date:offset(n),label:"Fictional day "+(i+1),summary:"Meet beside the fictional museum entrance.",notes:"Bring water. This is fictional acceptance content.",slots:[{id:"late-"+i,name:"Fictional garden",time:"15:30",notes:"Use the labelled east entrance."},{id:"early-"+i,name:"Fictional Museum",time:"09:00",address:"1 Example Promenade, Fictional Harbor",description:"A deliberately long fictional place description for narrow-screen reading.",uploadedPhoto:logoObject()}]})),reminders:[{id:"water",item:"Bring a water bottle",dueDate:today}]}})).trip;
 let state=(await api(`/api/trips/${trip.id}/sharing`)).sharing;
 const issued=await api(`/api/trips/${trip.id}/sharing`,{expectedShareVersion:state.version,expiresAt:null});
 const capability=issued.token,link=runtime.url+"/s/"+trip.id+"#"+capability;
 browser=await chromium.launch({channel:"chrome",headless:true});
 for(const width of [320,390,1280])for(const language of ["en","zh-Hans","zh-Hant","ja"])for(const textScale of [1,2]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,locale:language==="zh-Hans"?"zh-CN":language==="zh-Hant"?"zh-TW":language});
  await context.addInitScript(()=>{Object.defineProperty(navigator,"clipboard",{value:undefined,configurable:true});Object.defineProperty(navigator,"share",{value:undefined,configurable:true});});
  await context.route("**/*",route=>{const req=route.request(),u=new URL(req.url());requests.push({origin:u.origin,path:u.pathname,referer:req.headers().referer||"",hasShare:Boolean(req.headers()["x-trip-share"])});return u.origin===runtime.url?route.continue():route.abort();});
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  const shell=await page.goto(link);assert.equal(shell.headers()["referrer-policy"],"no-referrer");assert.match(shell.headers()["cache-control"],/no-store/);
  await page.locator("#trip").waitFor({state:"visible"});await page.locator("#language").selectOption(language);
  await page.evaluate(scale=>document.documentElement.style.fontSize=(scale*100)+"%",textScale);
  await page.waitForFunction(()=>[document.querySelector("#logo"),document.querySelector("#cover-img"),document.querySelector("#slots .g-photo img")].every(n=>n&&n.src.startsWith("blob:")&&n.complete&&n.naturalWidth>0));
  assert.equal(await page.locator("html").getAttribute("lang"),language);
  assert.equal(await page.locator('#day-list [aria-pressed="true"]').count(),1,"one selected date");
  assert.equal(await page.locator('#day-list [aria-pressed="true"]').getAttribute("data-day-index"),"1","today in trip timezone");
  assert((await page.locator("#day-date").textContent()).length>0);
  const ordering=await page.locator("#slots").innerText();assert(ordering.indexOf("09:00")<ordering.indexOf("15:30"),"chronological itinerary");
  const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert(dimensions.scroll<=dimensions.client+1,`no overflow at ${width}/${language}/${textScale}`);
  for(const node of await page.locator("button:visible,select:visible").all()){const box=await node.boundingBox();assert(box.height>=43&&box.width>=43,"generous touch target");}
  for(const anchor of await page.locator("#trip a").all()){const href=await anchor.getAttribute("href");assert(!href.includes(capability));assert.match(await anchor.getAttribute("rel"),/noreferrer/);assert.equal(await anchor.getAttribute("target"),"_blank");}
  if(width===390&&language==="en"&&textScale===1){
   const map=page.locator('#slots a[href^="https://www.google.com/maps/"]').first();
   // Hold a real pointer press while another client saves and a refresh arrives.
   await map.scrollIntoViewIfNeeded();await map.evaluate(n=>window.__fictionalPressedLink=n);const box=await map.boundingBox(),oldTitle=await page.locator("#trip-title").textContent();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
   const prior=runtime.service.getTrip(trip.id).trip;await api(`/api/trips/${trip.id}/changes`,{requestId:crypto.randomUUID(),expectedVersion:prior.version,changes:[{type:"update_trip",fields:{title:"Fictional Harbor Walk — tap update"}}]});
   const checked=page.waitForResponse(r=>new URL(r.url()).pathname===`/guest/trips/${trip.id}`);await page.evaluate(()=>window.dispatchEvent(new Event("online")));await checked;await page.waitForFunction(()=>document.querySelector("#check-updates").getAttribute("aria-busy")==="false");assert.equal(await page.locator("#trip-title").textContent(),oldTitle,"saved update waits for native tap");assert(await map.evaluate(n=>n===window.__fictionalPressedLink));
   let popupPromise=context.waitForEvent("page"),requestPromise=context.waitForEvent("request",{predicate:r=>r.url().startsWith("https://www.google.com/maps/")});await page.mouse.up();let [popup,mapRequest]=await Promise.all([popupPromise,requestPromise]);assert(!mapRequest.url().includes(capability));assert(!mapRequest.headers().referer);await popup.close();await page.waitForFunction(()=>document.querySelector("#trip-title").textContent.includes("tap update"));
   popupPromise=context.waitForEvent("page");requestPromise=context.waitForEvent("request",{predicate:r=>r.url().startsWith("https://www.google.com/maps/")});await map.focus();await map.press("Enter");[popup,mapRequest]=await Promise.all([popupPromise,requestPromise]);assert(!mapRequest.headers().referer);await popup.close();
   await page.locator("#slots .g-place-actions button").first().click();assert((await page.evaluate(()=>window.getSelection().toString())).includes("Example Promenade"),"address has native selection fallback");
  }
  await page.locator("#next-day").click();const chosen=await page.locator("#day-date").textContent();
  const next=runtime.service.getTrip(trip.id).trip;await api(`/api/trips/${trip.id}/changes`,{requestId:crypto.randomUUID(),expectedVersion:next.version,changes:[{type:"update_trip",fields:{title:"Fictional Harbor Walk — updated"}}]});
  await page.locator("#check-updates").click();await page.waitForFunction(()=>document.querySelector("#trip-title").textContent.includes("updated"));assert.equal(await page.locator("#day-date").textContent(),chosen,"refresh preserves chosen day");
  if(width===390&&language==="zh-Hans"&&textScale===1)await page.screenshot({path:path.join(output,"fictional-visitor-phone.png"),fullPage:true});
  if(width===320&&language==="ja"&&textScale===2)await page.screenshot({path:path.join(output,"fictional-visitor-large-text.png"),fullPage:true});
  if(width===1280&&language==="en"&&textScale===1)await page.screenshot({path:path.join(output,"fictional-visitor-desktop.png"),fullPage:true});
  await page.locator("#share-button").click();await page.locator("#share-fallback").waitFor({state:"visible"});assert.equal(await page.locator("#share-url").inputValue(),link);
  if(width===390&&language==="en"&&textScale===1){
   await context.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event("online")));await page.locator("#stale").waitFor({state:"visible"});assert(await page.locator("#trip").isVisible());await context.setOffline(false);await page.locator("#stale").waitFor({state:"hidden"});
  }
  cases++;await context.close();
 }
 const context=await browser.newContext();const page=await context.newPage();await page.goto(link);await page.locator("#trip").waitFor({state:"visible"});
 state=(await api(`/api/trips/${trip.id}/sharing`)).sharing;await api(`/api/trips/${trip.id}/sharing/revoke`,{expectedShareVersion:state.version});await page.evaluate(()=>window.dispatchEvent(new Event("online")));await page.locator("#denied").waitFor({state:"visible"});assert(await page.locator("#trip").isHidden());assert.equal(await page.locator("#slots").textContent(),"");assert.equal((await context.cookies()).length,0,"no derived guest/account session");await context.close();
 const malformedContext=await browser.newContext({locale:"zh-CN"});const malformedPage=await malformedContext.newPage();await malformedPage.goto(runtime.url+"/s/");await malformedPage.locator("#denied").waitFor({state:"visible"});assert((await malformedPage.locator("#denied").innerText()).includes("分享链接"));await malformedContext.close();
 // Exercise the management control through the actual authenticated trip header.
 let managementCases=0;
 for(const width of [320,390,1280])for(const language of ["en","zh-Hans","zh-Hant","ja"]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500});
  await context.addInitScript(lang=>{localStorage.setItem("shared-trips-language",lang);Object.defineProperty(navigator,"clipboard",{value:undefined,configurable:true});Object.defineProperty(navigator,"share",{value:undefined,configurable:true});},language);
  await context.route("**/*",route=>new URL(route.request().url()).origin===runtime.url?route.continue():route.abort());
  const login=await context.request.post(runtime.url+"/api/login",{headers:{Origin:runtime.url},data:{token:owner}});assert.equal(login.status(),200);
  const page=await context.newPage();await page.goto(runtime.url+"/trips/"+trip.id);
  await page.locator(".stm-launcher").click();const dialog=page.locator(".stm-dialog[open]");await dialog.waitFor();
  await dialog.locator('[data-share-action="create"]').waitFor({state:"visible"});await page.waitForFunction(()=>!document.querySelector('[data-share-action="create"]').disabled);
  assert.equal(await dialog.getAttribute("lang"),language);assert((await dialog.locator("[data-share-preview]").textContent()).includes("Fictional Museum"));
  await dialog.locator('[name="shareExpiryEnabled"]').check();
  for(const scale of [1,2]){await page.evaluate(v=>document.documentElement.style.fontSize=(100*v)+"%",scale);const dims=await dialog.evaluate(n=>({scroll:n.scrollWidth,client:n.clientWidth,rect:n.getBoundingClientRect().toJSON()}));if(dims.scroll>dims.client+1){await dialog.screenshot({path:path.join(output,"fictional-management-overflow.png")});const overflow=await dialog.evaluate(n=>[...n.querySelectorAll("*")].map(e=>({tag:e.tagName,cls:e.className,text:e.textContent.slice(0,60),width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth,white:getComputedStyle(e).whiteSpace})).filter(e=>e.scroll>e.client+1||e.width>n.clientWidth));console.log(JSON.stringify({managementOverflow:{width,language,scale,dims,overflow}}));}assert(dims.scroll<=dims.client+1,`management overflow ${width}/${language}/${scale}`);assert(dims.rect.x>=0&&dims.rect.right<=width+1);for(const control of await dialog.locator("button:visible,.stm-check:visible,input[type=text]:visible").all()){assert((await control.boundingBox()).height>=43,"management touch target");}}
  await page.evaluate(()=>document.documentElement.style.fontSize="100%");await dialog.locator('[name="shareExpiryEnabled"]').uncheck();
  await dialog.locator('[name="shareReviewed"]').check();await dialog.locator('[data-share-action="create"]').click();const linkField=dialog.locator('[name="shareLink"]');await linkField.waitFor({state:"visible"});const generated=await linkField.inputValue();assert(generated.startsWith(runtime.url+"/s/"+trip.id+"#"));
  await dialog.locator('[data-share-action="copy"]').click();assert.equal(await linkField.evaluate(n=>n.selectionEnd-n.selectionStart),generated.length,"copy fallback selects link");
  await dialog.locator('[name="shareReviewed"]').check();await dialog.locator('[data-share-action="create"]').click();await dialog.locator('[data-share-action="confirm"]').click();await page.waitForFunction(old=>document.querySelector('[name="shareLink"]').value&&document.querySelector('[name="shareLink"]').value!==old,generated);assert.equal((await fetch(generated.split("#")[0].replace("/s/","/guest/trips/"),{headers:{"X-Trip-Share":generated.split("#")[1]}})).status,404);
  await dialog.locator('[data-share-action="revoke"]').click();await dialog.locator('[data-share-action="confirm"]').click();await linkField.waitFor({state:"hidden"});await dialog.locator("[data-share-close]").click();assert.equal(await page.locator(".stm-dialog").count(),0);managementCases++;await context.close();
 }
 assert.equal(errors.length,0,errors.join("; "));assert(requests.filter(r=>r.hasShare).every(r=>r.origin===runtime.url&&r.path.startsWith("/guest/")));assert(requests.every(r=>!r.referer.includes(capability)));assert(requests.filter(r=>r.origin!==runtime.url).every(r=>!r.referer),"external maps receive no referrer");assert(!requests.some(r=>/google-places|\/search$/.test(r.path)));
 const result={browser:"actual Chrome with phone/touch emulation",cases,managementCases,widths:[320,390,1280],languages:4,textScale:[1,2],timezone,todaySelection:true,chronology:true,preservedDayAfterSavedEdit:true,copyFallback:true,nativeMapAndKeyboard:true,savedEditDuringNativePress:true,imagesActuallyLoaded:true,poorNetworkRecovery:true,revocationClearsContent:true,noDerivedCookies:true,noCapabilityInReferrers:true,providerSearchesOrReservations:0,physicalWeChat:false};fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await runtime?.close();fs.rmSync(data,{recursive:true,force:true});}
