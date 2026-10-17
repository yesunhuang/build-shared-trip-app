// Optional existing Chrome/Playwright acceptance. All accounts, images and trips are fictional.
// --playwright-module <index.mjs> --output <external dir> [--served-assets-file <verified JSON>]
import assert from "node:assert/strict";import fs from "node:fs";import os from "node:os";import path from "node:path";import {pathToFileURL} from "node:url";
import {readConfig,startServer} from "../server/app.mjs";import {fictionalLogo,logoObject} from "./fixtures/branding.mjs";
const option=k=>process.argv[process.argv.indexOf(k)+1];assert(process.argv.includes("--playwright-module"));const {chromium}=await import(pathToFileURL(path.resolve(option("--playwright-module"))).href);
const output=path.resolve(option("--output")),repo=fs.realpathSync(path.resolve(import.meta.dirname,".."));assert(output!==repo&&!output.startsWith(repo+path.sep));fs.mkdirSync(output,{recursive:true});
const served=process.argv.includes("--served-assets-file")?JSON.parse(fs.readFileSync(option("--served-assets-file"),"utf8")):null;
// Keep the boot session and app on one served module graph. Mixing a local bootstrap
// with a different release's hosted-client creates two independent module instances.
if(served)for(const entry of ["/hosted-bootstrap.js","/hosted-client.js","/app.js"])assert(served[entry],"served acceptance needs the coherent entrypoint graph: "+entry);
const data=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-photo-browser-")),owner="fictional-photo-browser-owner-0000000000000",png=fictionalLogo({width:480,height:270});
let runtime,browser,checks=0;const requests=[];
try{
 runtime=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_DATA_DIR:data,SHARED_TRIP_HOST:"127.0.0.1",SHARED_TRIP_PORT:"0"}));
 const base={title:"Fictional harbor photo walk",branding:{logo:logoObject(),theme:{preset:"sage"}},cover:logoObject(),googlePlacePhotosEnabled:true,weather:{locations:[]},days:[{id:"fictional-day",date:"2032-06-10",weatherLocationIds:[],slots:[{id:"fictional-plan",name:"Fictional museum",review:"Fictional preserved review",photo:{url:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Fictional.jpg",sourceUrl:"https://commons.wikimedia.org/wiki/File:Fictional.jpg",credit:"Fictional original credit"}}]}]};
 browser=await chromium.launch({channel:"chrome",headless:true});
 for(const width of [320,390,1280])for(const language of ["en","zh-Hans","zh-Hant","ja"]){
  const input=structuredClone(base);if(width===320&&language==="en"){input.days[0].slots.push({id:"fictional-source",name:"Fictional source photo",photo:input.days[0].slots[0].photo});delete input.days[0].slots[0].photo;input.days[0].slots[0].photoSourceId="fictional-source";}
  const trip=runtime.service.createTrip({requestId:"fixture-"+width+language,trip:input}).trip,context=await browser.newContext({viewport:{width,height:900},isMobile:width<500,hasTouch:width<500,extraHTTPHeaders:{Authorization:"Bearer "+owner}});
  await context.addInitScript(lang=>{if(!localStorage.getItem("shared-trips-language"))localStorage.setItem("shared-trips-language",lang);},language);
  await context.route("**/*",route=>{const u=new URL(route.request().url());requests.push({host:u.hostname,path:u.pathname});if(u.hostname==="upload.wikimedia.org")return route.fulfill({contentType:"image/png",body:png});if(u.origin!==runtime.url)return route.abort();if(served?.[u.pathname])return route.fulfill({contentType:u.pathname.endsWith(".css")?"text/css":"text/javascript",body:served[u.pathname]});return route.continue();});
  const page=await context.newPage();await page.goto(runtime.url+"/trips/"+trip.id+(width<500?"?view=plan":""));
  const item=page.locator('[data-slot-id="fictional-plan"]'),dialog=page.locator("#item-dialog"),fields=page.locator(".plan-photo-editor");
  // The actual app uses native details. Open it without requiring map or provider data.
  async function open(){await item.locator("summary").click();await item.locator(".icon-button").first().click();await fields.waitFor();}
  async function editAgain(){if(!await item.locator("details").evaluate(n=>n.open))await item.locator("summary").click();await item.locator(".icon-button").first().click();await fields.waitFor();}
  async function upload(buffer,mime="image/png"){await fields.locator("input[type=file]").setInputFiles({name:"fictional-image."+(mime==="image/jpeg"?"jpg":mime.split("/")[1]),mimeType:mime,buffer});await page.waitForFunction(()=>document.querySelector(".plan-photo-editor")?.getAttribute("aria-busy")==="false");}
  const cancel=()=>dialog.locator(".dialog-actions [data-close-dialog]").click();
  async function save(){await dialog.locator('button[type="submit"]').click();await dialog.waitFor({state:"hidden"});}
  await open();assert.equal(await fields.locator("input[type=file]").getAttribute("accept"),"image/png,image/jpeg,image/webp");
  await upload(png);await fields.locator("input[type=text]").fill("Fictional harbor photograph <literal>");
  assert((await fields.locator("img").getAttribute("src")).startsWith("data:image/png;base64,"));assert.equal(runtime.service.getTrip(trip.id).trip.version,trip.version,"preview has no write");
  const bounds=await dialog.evaluate(n=>({scroll:n.scrollWidth,client:n.clientWidth,rect:n.getBoundingClientRect().toJSON()}));assert(bounds.scroll<=bounds.client+1);assert(bounds.rect.x>=0&&bounds.rect.right<=width+1);assert((await fields.locator("input[type=file]").boundingBox()).height>=44);for(const row of await fields.locator(".field").all()){const label=await row.locator("span").boundingBox(),control=await row.locator("input").boundingBox();assert(control.y>=label.y+label.height,"photo label stacks above its control");}
  await cancel();assert.equal(runtime.service.getTrip(trip.id).trip.version,trip.version);
  await editAgain();assert.equal(await fields.locator("img").getAttribute("src"),null);await upload(png);await fields.locator("input[type=text]").fill("Fictional first image");await save();
  let saved=runtime.service.getTrip(trip.id).trip;assert.equal(saved.days[0].slots[0].uploadedPhoto.alt,"Fictional first image");assert.deepEqual(saved.days[0].slots[0].photo,trip.days[0].slots[0].photo);assert.deepEqual(saved.branding,trip.branding);assert.deepEqual(saved.cover,trip.cover);assert.deepEqual(saved.weather,trip.weather);assert.equal(saved.googlePlacePhotosEnabled,true);
  const polled=page.waitForResponse(r=>r.url().endsWith("/api/trips/"+trip.id)&&r.request().method()==="GET");await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await polled;assert.equal(runtime.service.getTrip(trip.id).trip.version,saved.version);
  await page.reload();await item.locator(".location-photo img[data-uploaded-photo]").waitFor();assert.equal(await item.locator(".location-photo img").getAttribute("alt"),"Fictional first image");
  // Generate actual JPEG/WebP files in this browser from synthetic raster content, then decode
  // and convert them through the real file-input/canvas path. No image library or service.
  for(const mime of ["image/jpeg","image/webp"]){
   const encoded=await page.evaluate(type=>{const c=document.createElement("canvas");c.width=180;c.height=120;const x=c.getContext("2d");x.fillStyle="#35745f";x.fillRect(0,0,180,120);x.fillStyle="#e8eede";x.fillRect(10,10,70,90);return c.toDataURL(type);},mime);assert(encoded.startsWith("data:"+mime));
   await editAgain();await upload(Buffer.from(encoded.split(",")[1],"base64"),mime);await fields.locator("input[type=text]").fill("Fictional replacement "+mime);await save();saved=runtime.service.getTrip(trip.id).trip;assert.equal(saved.days[0].slots[0].uploadedPhoto.mimeType,"image/png");assert.equal(saved.days[0].slots[0].uploadedPhoto.alt,"Fictional replacement "+mime);
  }
  if(width===390&&language==="en"){
   const jpeg=await page.evaluate(()=>{const c=document.createElement("canvas");c.width=180;c.height=120;c.getContext("2d").fillRect(0,0,180,120);return c.toDataURL("image/jpeg").split(",")[1];});
   const bytes=Buffer.from(jpeg,"base64"),exif=Buffer.alloc(32);exif.write("Exif",0,"ascii");exif.write("II",6,"ascii");exif.writeUInt16LE(42,8);exif.writeUInt32LE(8,10);exif.writeUInt16LE(1,14);exif.writeUInt16LE(0x112,16);exif.writeUInt16LE(3,18);exif.writeUInt32LE(1,20);exif.writeUInt16LE(6,24);const app=Buffer.alloc(4);app.writeUInt16BE(0xffe1);app.writeUInt16BE(exif.length+2,2);
   await editAgain();await upload(Buffer.concat([bytes.subarray(0,2),app,exif,bytes.subarray(2)]),"image/jpeg");const converted=Buffer.from((await fields.locator("img").getAttribute("src")).split(",")[1],"base64");assert.equal(converted.readUInt32BE(16),120);assert.equal(converted.readUInt32BE(20),180);assert(!converted.includes(Buffer.from("Exif")));await cancel();
   await editAgain();await upload(Buffer.from("GIF89a synthetic unsupported"),"image/gif");assert(await fields.locator("[role=alert]").textContent());await cancel();
  }
  await editAgain();const before=runtime.service.getTrip(trip.id).trip;await upload(Buffer.from("fictional invalid PNG contents"));assert(await fields.locator("[role=alert]").textContent());assert.equal(runtime.service.getTrip(trip.id).trip.version,before.version);await cancel();
  await editAgain();await upload(png);runtime.service.applyTripChanges({tripId:trip.id,expectedVersion:before.version,requestId:"fictional-concurrent-"+trip.id,changes:[{type:"upsert_plan",dayId:"fictional-day",plan:{id:"fictional-plan",notes:"Concurrent fictional note"}}]});await dialog.locator('button[type="submit"]').click();assert(await dialog.isVisible());assert.equal(runtime.service.getTrip(trip.id).trip.days[0].slots[0].uploadedPhoto.alt,before.days[0].slots[0].uploadedPhoto.alt,"stale draft refuses overwrite");await cancel();await page.reload();
  await editAgain();await fields.locator("[data-plan-photo-clear]").click();await save();saved=runtime.service.getTrip(trip.id).trip;assert(!saved.days[0].slots[0].uploadedPhoto);assert.deepEqual(saved.days[0].slots[0].photo,trip.days[0].slots[0].photo);assert.equal(saved.days[0].slots[0].notes,"Concurrent fictional note");assert.equal(saved.days[0].slots[0].photoSourceId,trip.days[0].slots[0].photoSourceId);await item.locator(".location-photo img").waitFor();assert(!(await item.locator(".location-photo img").getAttribute("src")).startsWith("data:"),"clear displays preserved Commons/legacy source");
  // Upload on an added plan uses the same ordinary Save/Cancel path.
  if(width===390&&language==="en"){
   await editAgain();await upload(png);await fields.locator("input[type=text]").fill("Fictional preview image");await dialog.screenshot({path:path.join(output,"fictional-phone-upload.png")});await cancel();
   await page.locator(".day-heading__actions .button").first().click();await fields.waitFor();await dialog.locator('[name="name"]').fill("Fictional newly added plan");await upload(png);await fields.locator("input[type=text]").fill("Fictional new plan image");await save();assert(runtime.service.getTrip(trip.id).trip.days[0].slots.some(p=>p.name==="Fictional newly added plan"&&p.uploadedPhoto?.alt==="Fictional new plan image"));
  }
  checks++;await context.close();
 }
 assert.equal(requests.some(x=>/google/.test(x.host)),false);assert.equal(requests.some(x=>/\/(places|photos)\/search|google-places\/reservations/.test(x.path)),false);
 const result={browser:"actual Chrome with phone/touch emulation",cases:checks,widths:[320,390,1280],languages:4,inputs:["PNG","JPEG","WebP"],previewCancelUploadReplaceClear:true,invalidFileAndConflict:true,pollReloadPersistence:true,legacyPhotoSourceIdFallback:true,exifOrientationSixAndUnsupportedFormat:true,preservedCommonsAndBranding:true,providerSearchesGoogleAndReservations:0,verifiedServedAssets:!!served,physicalAndroid:false};fs.writeFileSync(path.join(output,"results.json"),JSON.stringify(result));console.log(JSON.stringify(result));
}finally{await browser?.close();await runtime?.close();assert(data.startsWith(os.tmpdir()+path.sep));fs.rmSync(data,{recursive:true,force:true});}
