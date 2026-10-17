// Optional actual-browser acceptance; supply an existing Playwright module and external artifact dir.
// Only disposable fictional accounts and loopback requests. No production credentials or consent.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {pathToFileURL} from "node:url";
import {readConfig,startServer} from "../server/app.mjs";
import {hashPassword} from "../server/auth/passwords.mjs";
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE_FILE).href);
const artifacts=path.resolve(process.env.BROWSER_ARTIFACT_DIR), repo=fs.realpathSync(path.resolve(import.meta.dirname,".."));
assert(artifacts!==repo&&!artifacts.startsWith(repo+path.sep));fs.mkdirSync(artifacts,{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-oauth-browser-"));
const password="Fictional-browser-password-only", callback="http://127.0.0.1:4199/callback";
const runtime=await startServer({...readConfig({SHARED_TRIP_ADMIN_TOKEN:crypto.randomBytes(32).toString("base64url"),SHARED_TRIP_HOST:"127.0.0.1",SHARED_TRIP_PORT:"0",SHARED_TRIP_DATA_DIR:temp,SHARED_TRIP_OAUTH_MULTIUSER:"1"}),oauthRedirectUris:[callback]});
const browser=await chromium.launch({channel:"chrome",headless:true});
try{
 const users=[];
 for(const role of ["viewer","content-manager"]){
  const username="fictional."+role, invitation=runtime.accounts.createInvitation().invitation;
  const passwordHash=await hashPassword(password);runtime.accounts.redeemInvitation({token:invitation.token,username,passwordHash});
  const u=runtime.accounts.listAccounts().accounts.find(x=>x.username===username);runtime.accounts.approve(u.id);
  if(role!=="viewer")runtime.accounts.setRole(u.id,{role});users.push({username,role});
 }
 const registered=await fetch(runtime.url+"/oauth/register",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({client_name:"Fictional Browser Connector With A Long Display Name",redirect_uris:[callback],token_endpoint_auth_method:"none"})});
 assert.equal(registered.status,201);const clientId=(await registered.json()).client_id;
 for(const width of [320,390,1280])for(const u of users){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<500});const page=await context.newPage();let outbound=0;
  await page.route("**/*",route=>{const url=new URL(route.request().url());if(url.origin===runtime.url)return route.continue();if(url.href.startsWith(callback)){const p=url.searchParams;assert.equal(p.get("state"),"fictional-browser-state");assert.equal(p.get("iss"),runtime.url);return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Fictional callback completed</title><p>Callback received</p>"});}outbound++;return route.abort();});
  async function begin(){const verifier=crypto.randomBytes(32).toString("base64url");const q=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:"code",scope:"trips:read trips:manage",resource:runtime.url+"/mcp",state:"fictional-browser-state",code_challenge:crypto.createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256"});await page.goto(runtime.url+"/oauth/authorize?"+q);}
  const bounds=async()=>{assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));for(const b of await page.locator('button,input:not([type="hidden"])').all()){const box=await b.boundingBox();assert(box&&box.height>=44&&box.x>=0&&box.x+box.width<=width);}};
  await begin();await bounds();await page.getByLabel("Username",{exact:true}).fill(u.username);await page.getByLabel("Password",{exact:true}).fill(password);await page.getByLabel("Password",{exact:true}).press("Enter");
  await page.getByRole("heading",{name:u.role==="viewer"?"Allow this application to read your trips?":"Allow this application to manage trips?",exact:true}).waitFor();await bounds();
  assert((await page.locator("body").innerText()).includes(u.role==="viewer"?"trips:read":"trips:manage"));
  const allow=page.getByRole("button",{name:"Allow",exact:true});await allow.focus();assert(await allow.evaluate(el=>el===document.activeElement));
  await page.screenshot({path:path.join(artifacts,`consent-${u.role}-${width}.png`),fullPage:true});await allow.press("Enter");await page.waitForURL(callback+"?**");assert(new URL(page.url()).searchParams.has("code"));
  await begin();await page.getByRole("button",{name:"Cancel and return"}).click();await page.waitForURL(callback+"?**");assert.equal(new URL(page.url()).searchParams.get("error"),"access_denied");assert.equal(outbound,0);await context.close();
 }
 console.log("OAuth browser checks passed: actual Chrome, desktop/320/390 phone emulation, role/scope consent, native Enter/focus, touch-sized bounds, explicit allow/deny, zero external requests. Physical devices and recipient hosts untested.");
}finally{await browser.close();await runtime.close();assert(temp.startsWith(os.tmpdir()+path.sep));fs.rmSync(temp,{recursive:true,force:true});}
