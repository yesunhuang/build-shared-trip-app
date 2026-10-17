// Existing Playwright required; actual Chrome with fictional loopback content, no provider access.
// node scripts/test-language-selector-browser.mjs --playwright-module <index.mjs> --output <external dir> [--prior-ref <commit>] [--served-style-file <verified external CSS>]
import fs from "node:fs";import os from "node:os";import path from "node:path";import assert from "node:assert/strict";import {pathToFileURL} from "node:url";import {execFileSync} from "node:child_process";
import {readConfig,startServer} from "../server/app.mjs";
const option=name=>process.argv[process.argv.indexOf(name)+1];assert(process.argv.includes("--playwright-module"));
const {chromium}=await import(pathToFileURL(path.resolve(option("--playwright-module"))).href);
const output=path.resolve(option("--output")),repo=fs.realpathSync(path.resolve(import.meta.dirname,".."));assert(output!==repo&&!output.startsWith(repo+path.sep));fs.mkdirSync(output,{recursive:true});
const servedStyle=process.argv.includes("--served-style-file")?fs.readFileSync(path.resolve(option("--served-style-file")),"utf8"):null;
const data=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-language-selector-")),owner="fictional-language-browser-owner-0000000000000";
let runtime,browser,checks=0,google=0,searches=0;const metrics=[];
try{
 runtime=await startServer(readConfig({SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_DATA_DIR:data,SHARED_TRIP_HOST:"127.0.0.1",SHARED_TRIP_PORT:"0"}));
 const trip=runtime.service.createTrip({requestId:"fictional-language",trip:{title:"Fictional harbor journey",days:[{id:"fictional-day",date:"2032-06-10",slots:[{id:"fictional-plan",name:"Fictional museum visit"}]}]}}).trip;
 const preserved=JSON.stringify(trip);browser=await chromium.launch({channel:"chrome",headless:true});
 async function pageFor(width,height,language,prior){
  const ctx=await browser.newContext({viewport:{width,height},isMobile:width<900,hasTouch:width<900,extraHTTPHeaders:{Authorization:"Bearer "+owner}});
  await ctx.addInitScript(lang=>{if(!localStorage.getItem("shared-trips-language"))localStorage.setItem("shared-trips-language",lang);},language);
  await ctx.route("**/*",route=>{const u=new URL(route.request().url());if(/google/.test(u.host))google++;if(/\/(places|photos)\/search|google-places\/reservations/.test(u.pathname))searches++;if(u.origin!==runtime.url)return route.abort();if((prior||servedStyle)&&u.pathname==="/styles.css")return route.fulfill({contentType:"text/css",body:(prior||servedStyle).replaceAll("__CACHE_VERSION__","fictional-prior")});return route.continue();});
  const page=await ctx.newPage();await page.goto(runtime.url+"/trips/"+trip.id+(width<900?"?view=plan":""));await page.locator(width<900?"#plan-language-select":"#language-select").waitFor({state:"visible"});return {ctx,page};
 }
 async function measure(page,selector){return page.locator(selector).evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect(),parent=el.parentElement.getBoundingClientRect(),canvas=document.createElement("canvas"),c=canvas.getContext("2d");c.font=[s.fontStyle,s.fontWeight,s.fontSize,s.fontFamily].join(" ");const text=el.selectedOptions[0].textContent;const after=getComputedStyle(el.parentElement,"::after");return {text,appearance:s.appearance,font:s.font,paddingLeft:parseFloat(s.paddingLeft),paddingRight:parseFloat(s.paddingRight),available:el.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),measured:c.measureText(text).width,left:r.left,right:r.right,width:r.width,height:r.height,parentLeft:parent.left,parentRight:parent.right,chevron:after.content,chevronBorder:after.borderBottomWidth,outline:s.outlineStyle};});}
 if(process.argv.includes("--prior-ref")){
  const prior=execFileSync("git",["show",option("--prior-ref")+":assets/app-template/public/styles.css"],{cwd:repo,encoding:"utf8"}),{ctx,page}=await pageFor(390,844,"zh-Hant",prior);
  const m=await measure(page,"#plan-language-select");assert.equal(m.appearance,"auto");await page.locator(".plan-language-control").screenshot({path:path.join(output,"fictional-prior-native-selector.png")});metrics.push({prior:true,...m});await ctx.close();
 }
 for(const [width,height] of [[320,800],[360,800],[375,812],[390,844],[412,915],[812,390],[1280,900]])for(const language of ["en","zh-Hans","zh-Hant","ja"]){
  const {ctx,page}=await pageFor(width,height,language);const selector=width<900?"#plan-language-select":"#language-select";
  for(const scale of [1,1.5,2]){
   await page.addStyleTag({content:`html,body{font-size:${16*scale}px}`});await page.locator(selector).selectOption(language);await page.waitForFunction(lang=>document.documentElement.lang===lang,language);
   const el=page.locator(selector);await el.focus();const m=await measure(page,selector);assert.equal(m.appearance,"none");assert(m.available>=m.measured+2,JSON.stringify({width,language,scale,...m}));assert(m.left>=0&&m.right<=width+1,JSON.stringify({width,language,scale,...m}));if(width<900)assert(m.height>=44);else assert((await el.locator("..").boundingBox()).height>=44);assert(m.left>=m.parentLeft-1&&m.right<=m.parentRight+1);assert.equal(await el.evaluate(n=>document.activeElement===n),true);assert.notEqual(m.outline,"none");assert((await el.getAttribute("aria-label")).length>0);assert.equal(await el.locator("option").count(),4);
   if(width<900){assert.notEqual(m.chevron,"none");assert(parseFloat(m.chevronBorder)>0);const back=await page.locator("#close-plan-view").boundingBox();assert(back.x+back.width<=m.parentLeft+1,"back and language controls must not overlap");}
   metrics.push({width,language,scale,...m});checks++;
   if(width===390&&language==="zh-Hant"&&[1,2].includes(scale))await el.locator("..").screenshot({path:path.join(output,`fictional-fixed-traditional-${scale}.png`)});
  }
  if(width<900){await page.locator(selector).tap();await page.keyboard.press("Escape");}
  await page.locator(selector).focus();await page.locator(selector).press("End");await page.waitForFunction(()=>document.documentElement.lang==="ja");await page.reload();await page.waitForFunction(sel=>document.querySelector(sel)?.value==="ja",selector);assert.equal(await page.locator(selector).inputValue(),"ja");await ctx.close();
 }
 assert.equal(JSON.stringify(runtime.service.getTrip(trip.id).trip),preserved);assert.equal(google,0);assert.equal(searches,0);
 const result={actualBrowser:"Chrome",checks,widths:[320,360,375,390,412,812,1280],languages:4,textScales:[1,1.5,2],nativeKeyboardAndReload:true,verifiedServedStyles:!!servedStyle,googleRequests:google,providerSearchesAndReservations:searches,fictionalDataUnchanged:true,physicalAndroid:false};fs.writeFileSync(path.join(output,"results.json"),JSON.stringify({result,metrics},null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await runtime?.close();assert(data.startsWith(os.tmpdir()+path.sep));fs.rmSync(data,{recursive:true,force:true});}
