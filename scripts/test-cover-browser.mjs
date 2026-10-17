// Optional real Chrome acceptance. Supply an existing playwright-core module; no install or provider access.
// node scripts/test-cover-browser.mjs --playwright-module <absolute index.mjs> --output <disposable directory>
// --prior-ref <public pre-cover commit> additionally exercises the actual older controlling worker.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { startServer, readConfig } from "../server/app.mjs";
import { fictionalLogo } from "./fixtures/branding.mjs";

const option = name => process.argv[process.argv.indexOf(name) + 1];
assert.ok(process.argv.includes("--playwright-module"), "Supply an already-installed playwright-core module");
const { chromium } = await import(pathToFileURL(path.resolve(option("--playwright-module"))));
const output = process.argv.includes("--output") ? path.resolve(option("--output")) : fs.mkdtempSync(path.join(os.tmpdir(), "fictional-cover-browser-"));
fs.mkdirSync(output, { recursive: true });
const owner = "fictional-responsive-owner-000000000000000000";
const data = fs.mkdtempSync(path.join(os.tmpdir(), "fictional-cover-data-"));
let runtime, browser, stage = "current";
const results = [], external = [], providerSearches = [], old = {};
try {
  runtime = await startServer(readConfig({ SHARED_TRIP_DATA_DIR: data, SHARED_TRIP_ADMIN_TOKEN: owner, SHARED_TRIP_PORT: "0", SHARED_TRIP_HOST: "127.0.0.1" }));
  const title = "Fictional long journey / 架空の長い旅 / 虚构的长途旅行 / 虛構的長途旅行 " + "LongUnbrokenFictionalDestination".repeat(3);
  const trips = [[1024,256],[1024,1024],[256,1024]].map(([width,height],i) => runtime.service.createTrip({ requestId: "responsive-cover-"+i, trip: { title: "Fictional artwork journey "+i, cover: { mimeType: "image/png", data: fictionalLogo({width,height}).toString("base64"), alt: "Fictional geometric artwork "+i, focusX: 30, focusY: 70 } } }).trip);
  runtime.service.createTrip({requestId:"responsive-legacy",trip:{title:"Fictional legacy trip without artwork"}});
  if (process.argv.includes("--prior-ref")) {
    const root = fileURLToPath(new URL("../", import.meta.url));
    for (const [url,file] of Object.entries({"/":"assets/selfhosted/index.html","/home.js":"assets/selfhosted/home.js","/home.css":"assets/selfhosted/home.css","/service-worker.js":"assets/selfhosted/service-worker.js","/hosted-client.js":"assets/app-template/public/hosted-client.js"})) {
      old[url] = execFileSync("git",["show",option("--prior-ref")+":"+file],{cwd:root,encoding:"utf8"}).replaceAll("__CACHE_VERSION__","fictional-prior");
    }
    const handler = runtime.server.listeners("request")[0];
    runtime.server.removeListener("request",handler);
    runtime.server.on("request",(req,res)=>{
      const pathname=new URL(req.url,runtime.url).pathname;
      if ((stage==="prior" || (stage==="upgrade" && pathname==="/service-worker.js")) && old[pathname]) {
        res.writeHead(200,{"Content-Type":pathname.endsWith(".css")?"text/css":pathname==="/"?"text/html":"text/javascript","Cache-Control":"no-store"});res.end(old[pathname]);
      } else handler(req,res);
    });
  }
  browser = await chromium.launch({channel:"chrome",headless:true,chromiumSandbox:true});
  async function context(width,height,language="en") {
    const ctx=await browser.newContext({viewport:{width,height},isMobile:width<900,hasTouch:width<900,deviceScaleFactor:width<900?3:1,extraHTTPHeaders:{Authorization:"Bearer "+owner}});
    ctx.on("request",request=>{if(/\/(?:places|photos)\/search|google-places\/reservations/.test(new URL(request.url()).pathname))providerSearches.push(request.url());});
    await ctx.addInitScript(lang=>localStorage.setItem("shared-trips-language",lang),language);
    await ctx.route("**/*",route=>{if(new URL(route.request().url()).origin===runtime.url)return route.continue();external.push(new URL(route.request().url()).hostname);return route.abort();});
    return ctx;
  }
  async function bounds(page,width,selector,container,label) {
    await page.locator(selector).first().waitFor();
    await page.waitForFunction(sel=>[...document.querySelectorAll(sel)].every(i=>i.complete&&i.naturalWidth>0),selector);
    const metrics=await page.evaluate(({selector,container})=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,inner:innerWidth,images:[...document.querySelectorAll(selector)].map(i=>{const r=i.getBoundingClientRect(),c=i.closest(container).getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,containerLeft:c.left,containerRight:c.right,natural:i.naturalWidth,position:i.style.objectPosition,fit:getComputedStyle(i).objectFit};})}),{selector,container});
    // Android expands innerWidth to accommodate oversized intrinsic content. Never use it as the reference.
    assert.ok(metrics.scroll<=width+1, label+": document exceeds configured viewport "+JSON.stringify(metrics));
    assert.equal(metrics.client,width,label+": client viewport");
    for(const image of metrics.images){assert.ok(image.width>0&&image.left>=image.containerLeft-1&&image.right<=image.containerRight+1,label+": cover exceeds container");assert.equal(image.position,"30% 70%",label+": saved focus retained");}
    results.push({label,width,...metrics});
  }
  if (Object.keys(old).length) {
    stage="prior";const ctx=await context(360,800),page=await ctx.newPage();
    await page.goto(runtime.url);await page.locator(".trip-card").first().waitFor();
    await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener("controllerchange",resolve,{once:true}));});
    stage="upgrade";await page.reload();await bounds(page,360,".trip-card-cover",".trip-card","actual prior controlling worker upgrade");
    assert.equal(await page.evaluate(()=>!!navigator.serviceWorker.controller),true);
    await page.screenshot({path:path.join(output,"fictional-old-worker-upgrade.png"),fullPage:true});await ctx.close();stage="current";
  }
  {
    const ctx=await context(360,800),page=await ctx.newPage();await page.goto(runtime.url);
    await bounds(page,360,".trip-card-cover",".trip-card","fictional home preview");
    await page.locator(".trip-card").filter({has:page.locator(".trip-card-cover")}).first().screenshot({path:path.join(output,"fictional-home-card.png")});
    await page.goto(runtime.url+"/trips/"+trips[0].id);await bounds(page,360,".hero > .trip-cover",".hero","fictional header preview");
    await page.locator(".hero").screenshot({path:path.join(output,"fictional-header.png")});await ctx.close();
  }
  for(const trip of trips) runtime.service.applyTripChanges({tripId:trip.id,expectedVersion:trip.version,requestId:"long-title-"+trip.id,changes:[{type:"update_trip",fields:{title}}]});
  for(const [width,height] of [[320,800],[360,800],[375,812],[390,844],[412,915],[812,390],[1280,900]]) {
    for(const [index,language] of ["en","zh-Hans","zh-Hant","ja"].entries()) {
      const ctx=await context(width,height,language),page=await ctx.newPage();
      for(const scale of [1,1.5]) {
        await page.goto(runtime.url);await page.locator(".trip-card-cover").first().waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"),language);
        await page.addStyleTag({content:`html {font-size:${16*scale}px} body {font-size:${16*scale}px}`});
        await bounds(page,width,".trip-card-cover",".trip-card",`home ${language} text ${scale}`);
        assert.equal(await page.locator(".trip-card").count(),4);assert.equal(await page.locator(".trip-card-cover").count(),3);
        // Exercise the undecoded/loading layout independently of image intrinsic dimensions.
        const image=page.locator(".trip-card-cover").first();const src=await image.getAttribute("src");await image.evaluate(i=>i.removeAttribute("src"));
        assert.ok(await image.evaluate((i,w)=>i.getBoundingClientRect().right<=w,width),"loading cover bounded");
        await image.evaluate((i,value)=>i.src=value,src);await bounds(page,width,".trip-card-cover",".trip-card",`home decoded ${language} text ${scale}`);
        if(language==="en"&&scale===1&&[360,1280].includes(width))await page.screenshot({path:path.join(output,`fictional-home-${width}.png`),fullPage:true});
        await page.goto(runtime.url+"/trips/"+trips[index%trips.length].id);await page.locator(".hero > .trip-cover").waitFor();
        assert.equal(await page.locator("html").getAttribute("lang"),language);
        await page.addStyleTag({content:`html {font-size:${16*scale}px} body {font-size:${16*scale}px}`});
        await bounds(page,width,".hero > .trip-cover",".hero",`header ${language} text ${scale}`);
        assert.equal(await page.locator(".hero > .trip-cover").count(),1);assert.equal(await page.locator(".hero > .trip-cover").evaluate(i=>getComputedStyle(i).objectFit),"cover");
        if(language==="en"&&scale===1&&width===360)await page.screenshot({path:path.join(output,"fictional-header-360.png"),fullPage:true});
      }
      await ctx.close();
    }
  }
  assert.equal(external.filter(host=>/google/i.test(host)).length,0,"no Google SDK or billable calls");
  assert.equal(providerSearches.length,0,"cover views make no provider search or allowance reservation");
  fs.writeFileSync(path.join(output,"results.json"),JSON.stringify({checks:results.length,results,blockedExternal:[...new Set(external)]},null,2));
  console.log(JSON.stringify({browser:"Chrome desktop and mobile/touch emulation",checks:results.length,widths:[320,360,375,390,412,812,1280],languages:4,textScales:[1,1.5],imageAspects:3,actualPriorWorkerUpgrade:!!Object.keys(old).length,googleRequests:0,physicalDeviceTested:false}));
} finally {await browser?.close();await runtime?.close();}
