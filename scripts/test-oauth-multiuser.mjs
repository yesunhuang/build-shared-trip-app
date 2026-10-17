// Actual HTTP + official MCP SDK. Every identity, password, code and trip is disposable fiction.
import assert from "node:assert/strict";
import fs from "node:fs";import os from "node:os";import path from "node:path";import crypto from "node:crypto";
import {execFileSync} from "node:child_process";import {DatabaseSync} from "node:sqlite";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {readConfig,startServer} from "../server/app.mjs";
import {hashPassword} from "../server/auth/passwords.mjs";
import {OAuthStore,GRANT_LIFETIME_MS,ACCESS_TTL_MS} from "../server/auth/oauth.mjs";
import {ContentGateway} from "../server/content-access.mjs";
import {snapshotDatabase,validateSnapshot,SCHEMA_VERSION} from "../server/db.mjs";
import {requestedScopes,consentScope} from "../server/auth/oauth-scopes.mjs";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"fictional-multiuser-oauth-")),data=path.join(root,"data"),callback="https://oauth-client.fictional.invalid/multiuser";
const owner="fictional-multiuser-owner-0000000000000000",password="Fictional-account-password-only",secrets=[owner,password],clients=[];
let now=Date.now(),runtime;
const config={...readConfig({SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_DATA_DIR:data,SHARED_TRIP_HOST:"127.0.0.1",SHARED_TRIP_PORT:"0",SHARED_TRIP_OAUTH_USERNAME:"fictional.editor.alpha"}),clock:()=>now,oauthRedirectUris:[callback]};
const remember=value=>(secrets.push(value),value),csrf=html=>remember(/name="csrf" value="([A-Za-z0-9_-]+)"/.exec(html)[1]);
const cookie=r=>remember(r.headers.get("set-cookie").split(";")[0]);
async function request(route,{method="GET",body,form,token,session}={}){
 const headers={Origin:runtime.url,Connection:"close",...token?{Authorization:"Bearer "+token}:{},...session?{Cookie:session}:{}};
 if(body!==undefined)headers["Content-Type"]="application/json";if(form)headers["Content-Type"]="application/x-www-form-urlencoded";
 const r=await fetch(runtime.url+route,{method,headers,body:form?new URLSearchParams(form):body===undefined?undefined:JSON.stringify(body),redirect:"manual"});
 const text=await r.text();let json;try{json=JSON.parse(text)}catch{}return {status:r.status,headers:r.headers,text,json};
}
const own=(route,body)=>request(route,{token:owner,method:body===undefined?"GET":"POST",body});
const ok=(r,status=200)=>(assert.equal(r.status,status),r.json);
async function account(username,role="viewer",approved=true){
 const invitation=runtime.accounts.createInvitation().invitation;remember(invitation.token);const passwordHash=await hashPassword(password);
 runtime.accounts.redeemInvitation({token:invitation.token,username,passwordHash});const a=runtime.accounts.listAccounts().accounts.find(x=>x.username===username);
 if(approved)runtime.accounts.approve(a.id);if(role!=="viewer")runtime.accounts.setRole(a.id,{role});return {...a,role};
}
async function assign(trip,user,role="member"){
 const state=ok(await own("/api/trips/"+trip.id));return ok(await own("/api/trips/"+trip.id+"/members",{userId:user.id,role,expectedAccessVersion:state.access.version,requestId:crypto.randomUUID()}));
}
async function register(name){return ok(await request("/oauth/register",{method:"POST",body:{client_name:name,redirect_uris:[callback],token_endpoint_auth_method:"none"}}),201).client_id;}
async function begin(clientId,scope="trips:read trips:manage"){
 const verifier=remember(crypto.randomBytes(32).toString("base64url")),challenge=crypto.createHash("sha256").update(verifier).digest("base64url");
 const query=new URLSearchParams({client_id:clientId,redirect_uri:callback,response_type:"code",scope,resource:runtime.url+"/mcp",state:"fictional-user-state",code_challenge:challenge,code_challenge_method:"S256"});
 const r=await request("/oauth/authorize?"+query);assert.equal(r.status,200);return {clientId,verifier,session:cookie(r),csrf:csrf(r.text)};
}
async function sign(flow,user,extra={}){
 const r=await request("/oauth/authorize/login",{method:"POST",session:flow.session,form:{csrf:flow.csrf,username:user.username,password,...extra}});
 return {response:r,...r.status===200?{...flow,session:cookie(r),csrf:csrf(r.text)}:{}};
}
async function allow(flow){
 const r=await request("/oauth/authorize/decision",{method:"POST",session:flow.session,form:{csrf:flow.csrf,decision:"allow"}});assert.equal(r.status,303);
 const url=new URL(r.headers.get("location"));assert.equal(url.searchParams.get("state"),"fictional-user-state");assert.equal(url.searchParams.get("iss"),runtime.url);
 return {...flow,code:remember(url.searchParams.get("code"))};
}
async function exchange(flow,changes={}){return request("/oauth/token",{method:"POST",form:{grant_type:"authorization_code",client_id:flow.clientId,redirect_uri:callback,resource:runtime.url+"/mcp",code:flow.code,code_verifier:flow.verifier,...changes}});}
const tokens=r=>{const v=ok(r);remember(v.access_token);remember(v.refresh_token);return v;};
async function grant(clientId,user,scope){const signed=await sign(await begin(clientId,scope),user);assert.equal(signed.response.status,200);const flow=await allow(signed);return {flow,token:tokens(await exchange(flow)),consent:signed.response.text};}
async function refresh(clientId,token,changes={}){return request("/oauth/token",{method:"POST",form:{grant_type:"refresh_token",client_id:clientId,resource:runtime.url+"/mcp",["refresh_token"]:token,...changes}});}
async function sdk(token){const c=new Client({name:"fictional-multiuser-acceptance",version:"1.0.0"});await c.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{requestInit:{headers:{Authorization:"Bearer "+token}}}));clients.push(c);return c;}
const tool=async(c,name,args)=>{try{const r=await c.callTool({name,arguments:args});return {failed:!!r.isError,data:r.structuredContent||JSON.parse(r.content[0].text)};}catch{return {failed:true};}};
const names=async c=>(await c.listTools()).tools.map(t=>t.name).sort();
async function denied(token){await assert.rejects(()=>sdk(token));}
const tableRows=db=>Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({name})=>[name,JSON.stringify(db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all())]));
try{
 assert.equal(requestedScopes("trips:manage  trips:read trips:read"),"trips:read trips:manage");assert.equal(requestedScopes("trips:read\ntrips:manage"),null);assert.equal(consentScope("viewer","trips:manage"),"trips:read");
 assert.equal(readConfig({...{SHARED_TRIP_ADMIN_TOKEN:owner,SHARED_TRIP_DATA_DIR:data},SHARED_TRIP_OAUTH_MULTIUSER:"true"}).oauthMultiuser,false);
 runtime=await startServer(config);config.port=Number(new URL(runtime.url).port);
 const alpha=await account("fictional.editor.alpha","content-manager"),beta=await account("fictional.editor.beta","content-manager"),member=await account("fictional.member"),pending=await account("fictional.pending","viewer",false);
 const a=ok(await own("/api/trips",{requestId:"fictional-alpha-trip",trip:{title:"Fictional alpha garden"}}),201).trip,b=ok(await own("/api/trips",{requestId:"fictional-beta-trip",trip:{title:"Fictional beta harbor"}}),201).trip;
 await assign(a,alpha);await assign(a,member,"creator");await assign(b,beta);
 const ca=await register("Fictional legacy client"),cb=await register("Fictional member client"),cc=await register("Fictional beta client");
 const legacy=await grant(ca,alpha,"trips:manage");assert.equal(legacy.token.scope,"trips:manage");
 const rejected=await sign(await begin(cb),member);assert.equal(rejected.response.status,401,"legacy singleton mode remains manager-only");
 const prior=tableRows(runtime.db),legacyPrincipal=runtime.oauth.authenticateAccess(legacy.token.access_token,now,{resource:runtime.url+"/mcp",touch:false});
 assert.equal(legacyPrincipal.scope,"trips:manage");
 await runtime.close();runtime=null;let db=new DatabaseSync(path.join(data,"shared-trip.sqlite"));db.exec("PRAGMA user_version=7");db.close();
 fs.writeFileSync(path.join(data,"google-allowance.sqlite"),"Fictional separate allowance remains untouched");const ledger=fs.readFileSync(path.join(data,"google-allowance.sqlite"));
 config.oauthMultiuser=true;runtime=await startServer(config);assert.equal(runtime.db.prepare("PRAGMA user_version").get().user_version,SCHEMA_VERSION);assert.deepEqual(tableRows(runtime.db),prior,"v7 upgrade changes no existing rows");
 assert.equal(config.oauthUsername,alpha.username,"singleton setting is not repointed");
 const old=await sdk(legacy.token.access_token);assert.equal((await names(old)).length,6);assert.equal((await tool(old,"get_trip",{tripId:a.id})).failed,false);
 const memberGrant=await grant(cb,member,"trips:manage"),betaGrant=await grant(cc,beta,"trips:read trips:manage"),readEditor=await grant(ca,alpha,"trips:read");
 assert.equal(memberGrant.token.scope,"trips:read");assert.ok(memberGrant.consent.includes("read-only access")&&memberGrant.consent.includes("three read-only MCP tools"));assert.equal(betaGrant.token.scope,"trips:manage");assert.equal(readEditor.token.scope,"trips:read");
 assert.equal(runtime.accounts.sessionRecord(member.id).role,"viewer");
 const m=await sdk(memberGrant.token.access_token),e=await sdk(betaGrant.token.access_token),read=await sdk(readEditor.token.access_token);
 assert.deepEqual(await names(m),["export_trip","get_trip","list_trips"]);assert.equal((await names(e)).length,6);assert.deepEqual(await names(read),await names(m));
 const projection=(await tool(m,"get_trip",{tripId:a.id})).data;assert.equal(projection.access.canEdit,false);assert.equal(projection.access.canInvite,false);
 assert.equal((await tool(m,"export_trip",{tripId:a.id})).failed,false);assert.equal((await tool(m,"get_trip",{tripId:b.id})).failed,true);assert.equal((await tool(m,"export_trip",{tripId:b.id})).failed,true);
 assert.equal((await tool(e,"get_trip",{tripId:a.id})).failed,true);assert.equal((await tool(e,"get_trip",{tripId:b.id})).failed,false);
 for(const name of ["create_trip","import_trip","apply_trip_changes"])assert.equal((await tool(m,name,{tripId:a.id,requestId:"read-must-not-write",expectedVersion:a.version,changes:[{type:"update_trip",fields:{title:"Never applied"}}],trip:{title:"Never created"},data:{}})).failed,true);
 const gateway=new ContentGateway(runtime.service,runtime.audit),before=JSON.stringify(runtime.service.getTrip(a.id).trip);
 for(const user of [alpha,member]){const context={principal:{userId:user.id,role:user.role,via:"oauth",scope:"trips:read"},channel:"mcp"};assert.throws(()=>gateway.createTrip(context,{requestId:"no-create",trip:{title:"Never created"}}),x=>x.status===403);assert.throws(()=>gateway.applyTripChanges(context,{tripId:a.id,requestId:"no-edit",expectedVersion:a.version,changes:[{type:"update_trip",fields:{title:"Never applied"}}]}),x=>x.status===403);}
 assert.equal(JSON.stringify(runtime.service.getTrip(a.id).trip),before);
 for(const token of [memberGrant.token.access_token,betaGrant.token.access_token])for(const route of ["/api/trips","/api/users","/photos/fictional-private.png"])assert.equal((await request(route,{token})).status,401,"MCP OAuth never authorizes website/media routes");
 const edit={tripId:b.id,requestId:"beta-versioned-write",expectedVersion:b.version,changes:[{type:"update_trip",fields:{country:"Fictional beta region"}}]},changed=await tool(e,"apply_trip_changes",edit);assert.equal(changed.failed,false);assert.deepEqual(await tool(e,"apply_trip_changes",edit),changed);assert.equal((await tool(e,"apply_trip_changes",{...edit,requestId:"beta-stale"})).failed,true);
 // One registered client can have separate account-bound grants; a website cookie never switches identities.
 const sameClient=await grant(ca,member);const store=new OAuthStore(runtime.db,{multiuser:true,username:alpha.username});assert.equal(store.authenticateAccess(sameClient.token.access_token,now,{resource:runtime.url+"/mcp",touch:false}).userId,member.id);
 for(const overrides of [{client_id:cb},{redirect_uri:callback+"?wrong=1"},{resource:runtime.url+"/wrong"},{code_verifier:"B".repeat(43)}])assert.equal((await exchange(legacy.flow,overrides)).status,400);
 assert.equal((await tool(old,"get_trip",{tripId:a.id})).failed,false,"foreign replay cannot revoke the legitimate grant");
 assert.equal((await exchange(legacy.flow)).status,400);await denied(legacy.token.access_token);assert.equal((await tool(e,"get_trip",{tripId:b.id})).failed,false,"another account's grant survives replay");
 assert.equal((await refresh(cc,memberGrant.token.refresh_token)).status,400);const rotated=tokens(await refresh(cb,memberGrant.token.refresh_token,{scope:"trips:read"}));assert.equal(rotated.scope,"trips:read");
 assert.equal((await refresh(cb,rotated.refresh_token,{scope:"trips:manage"})).status,400);assert.equal((await refresh(cc,memberGrant.token.refresh_token)).status,400);assert.ok(store.authenticateAccess(rotated.access_token,now,{resource:runtime.url+"/mcp",touch:false}).ok);
 assert.equal((await refresh(cb,memberGrant.token.refresh_token)).status,400);await denied(rotated.access_token);assert.equal((await tool(e,"get_trip",{tripId:b.id})).failed,false);
 const active=await sdk(sameClient.token.access_token);await assign(a,member,"remove");assert.equal((await tool(active,"get_trip",{tripId:a.id})).failed,true);assert.equal((await tool(active,"export_trip",{tripId:a.id})).failed,true);assert.equal((await tool(active,"list_trips",{})).data.trips.length,0);await assign(a,member);
 assert.equal((await tool(active,"get_trip",{tripId:a.id})).failed,false);
 // Revoke one exact client grant without affecting another grant for that account or another account.
 const retained=await grant(cb,member,"trips:read");assert.equal((await request("/oauth/revoke",{method:"POST",form:{client_id:ca,token:retained.token.refresh_token}})).status,200);assert.ok(store.authenticateAccess(retained.token.access_token,now,{resource:runtime.url+"/mcp",touch:false}).ok);
 assert.equal((await request("/oauth/revoke",{method:"POST",form:{client_id:ca,token:sameClient.token.refresh_token}})).status,200);await denied(sameClient.token.access_token);assert.ok(store.authenticateAccess(retained.token.access_token,now,{resource:runtime.url+"/mcp",touch:false}).ok);
 for(const acct of [pending])assert.equal((await sign(await begin(cb),acct)).response.status,403);
 const csrfFlow=await begin(cb);assert.equal((await request("/oauth/authorize/login",{method:"POST",session:csrfFlow.session,form:{csrf:"X".repeat(43),username:member.username,password}})).status,403);
 const roleFlow=await sign(await begin(cc),beta);assert.equal(roleFlow.response.status,200);runtime.accounts.setRole(beta.id,{role:"viewer"});assert.equal(new URL((await request("/oauth/authorize/decision",{method:"POST",session:roleFlow.session,form:{csrf:roleFlow.csrf,decision:"allow"}})).headers.get("location")).searchParams.get("error"),"access_denied");await denied(betaGrant.token.access_token);
 const memberBefore=runtime.accounts.sessionRecord(member.id);const snapshot=path.join(root,"multiuser.sqlite");await snapshotDatabase(path.join(data,"shared-trip.sqlite"),snapshot);validateSnapshot(snapshot);
 const restored=path.join(root,"restore");execFileSync(process.execPath,["server/cli/restore.mjs",snapshot],{env:{...process.env,SHARED_TRIP_DATA_DIR:restored,SHARED_TRIP_HOST:"127.0.0.1"},stdio:"pipe"});db=new DatabaseSync(path.join(restored,"shared-trip.sqlite"),{readOnly:true});assert.deepEqual(db.prepare("SELECT * FROM trip_members ORDER BY trip_id,user_id").all(),runtime.db.prepare("SELECT * FROM trip_members ORDER BY trip_id,user_id").all());assert.ok(new OAuthStore(db,{multiuser:true}).authenticateAccess(retained.token.access_token,now,{resource:runtime.url+"/mcp",touch:false}).ok);db.close();
 // Exercise discovery and automatic refresh with the SDK's actual OAuth provider, including a
 // token response capped below the discovery/registration scope hint.
 const memory={},provider={get redirectUrl(){return callback},get clientMetadata(){return {client_name:"Fictional read-only SDK",redirect_uris:[callback],grant_types:["authorization_code","refresh_token"],response_types:["code"],token_endpoint_auth_method:"none"}},state(){return "fictional-user-state"},clientInformation(){return memory.client},saveClientInformation(v){memory.client=v},tokens(){return memory.tokens},saveTokens(v){memory.tokens=v;remember(v.access_token);remember(v.refresh_token)},redirectToAuthorization(v){memory.url=v},saveCodeVerifier(v){memory.verifier=remember(v)},codeVerifier(){return memory.verifier}};
 const transport=new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{authProvider:provider}),unauthenticated=new Client({name:"fictional-read-sdk",version:"1.0.0"});
 await assert.rejects(()=>unauthenticated.connect(transport));await unauthenticated.close();assert.ok(memory.url);
 const authUrl=new URL(memory.url);assert.equal(authUrl.searchParams.get("scope"),"trips:read trips:manage");const start=await request(authUrl.pathname+authUrl.search);assert.equal(start.status,200);
 const signed=await sign({clientId:memory.client.client_id,verifier:memory.verifier,session:cookie(start),csrf:csrf(start.text)},member);assert.equal(signed.response.status,200);const flow=await allow(signed);await transport.finishAuth(flow.code);assert.equal(memory.tokens.scope,"trips:read");
 const oauthClient=new Client({name:"fictional-read-sdk",version:"1.0.0"});await oauthClient.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{authProvider:provider}));assert.deepEqual(await names(oauthClient),["export_trip","get_trip","list_trips"]);await oauthClient.close();
 const oldRefresh=memory.tokens.refresh_token;now+=ACCESS_TTL_MS+1000;const renewedClient=new Client({name:"fictional-read-sdk",version:"1.0.0"});await renewedClient.connect(new StreamableHTTPClientTransport(new URL(runtime.url+"/mcp"),{authProvider:provider}));clients.push(renewedClient);assert.equal((await tool(renewedClient,"get_trip",{tripId:a.id})).failed,false);assert.equal(memory.tokens.scope,"trips:read");assert.ok(memory.tokens.refresh_token!==oldRefresh);
 runtime.accounts.revoke(member.id);await denied(memory.tokens.access_token);assert.equal(runtime.accounts.sessionRecord(member.id).role,memberBefore.role);assert.equal((await refresh(memory.client.client_id,memory.tokens.refresh_token)).status,400);
 assert.ok(fs.readFileSync(path.join(data,"google-allowance.sqlite")).equals(ledger));
 const durable=JSON.stringify({audit:runtime.db.prepare("SELECT * FROM audit_log").all(),codes:runtime.db.prepare("SELECT * FROM oauth_codes").all(),tokens:runtime.db.prepare("SELECT * FROM oauth_tokens").all()});assert.ok(!secrets.some(secret=>secret&&durable.includes(secret)),"no raw fixture passwords, tokens or codes in durable records");
 assert.ok(GRANT_LIFETIME_MS===90*86400000);
 console.log("Multiuser OAuth passed: actual HTTP/official MCP SDK, legacy v7 upgrade and existing grants, independently bound accounts/clients, read/manage scope consent and role caps, three/six tools, creator/read-only write denial, member isolation/removal, API/media boundary, versioned retries/conflicts, cross-client code/replay and refresh isolation, account/role revocation, CSRF, read-scope backup/restore, unchanged separate allowance and payload-free audit. Fictional only; no external provider or live consent.");
}finally{for(const c of clients)await c.close().catch(()=>{});await runtime?.close();fs.rmSync(root,{recursive:true,force:true});}
