// Actual self-hosted worker in a deterministic Cache Storage simulation.
import assert from "node:assert/strict";import fs from "node:fs";import vm from "node:vm";
const source=fs.readFileSync(new URL("../assets/selfhosted/service-worker.js",import.meta.url),"utf8").replaceAll("__CACHE_VERSION__","fictional-current");
const handlers={},entries=new Map(),network=[],puts=[];
const cache={addAll:async urls=>urls.forEach(url=>entries.set(url,{marker:"installed-current-shell"})),match:async key=>entries.get(typeof key==="string"?key:key.url),put:async(key,response)=>{puts.push(key);entries.set(key,response);}};
vm.runInNewContext(source,{URL,self:{location:{origin:"https://example.test"},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}},caches:{open:async()=>cache,keys:async()=>[],delete:async()=>{},match:cache.match},fetch:async request=>{network.push(request.url);return{ok:true,marker:request.url,clone(){return this;}};}});
let installation;handlers.install({waitUntil:p=>installation=p});await installation;
async function request(path,options={}){let answer;handlers.fetch({request:{url:"https://example.test"+path,method:"GET",mode:"cors",...options},respondWith:p=>answer=p});return answer;}
assert.equal((await request("/home.css")).marker,"installed-current-shell");assert.equal(network.length,0);
for(const version of ["fictional-current","fictional-next"]){
 const path="/home.css?v="+version;assert.equal((await request(path)).marker,"https://example.test"+path,"versioned CSS never aliases the installed unversioned stylesheet");const count=network.length;assert.equal((await request(path)).marker,"https://example.test"+path);assert.equal(network.length,count,"identical warm version makes no background request");
}
assert.equal(new Set(puts).size,2);
for(const path of ["/api/trips","/guest/trips/fictional","/s/fictional","/mcp","/oauth/token","/.well-known/oauth-protected-resource","/photos/fictional.png"]){const count=network.length;assert.equal(await request(path),undefined);assert.equal(network.length,count,"protected and non-shell requests are left to the browser, never cached");}
assert.equal(await request("/home.css?v=fictional-current",{method:"POST"}),undefined);
console.log("Self-hosted shell cache regression passed: distinct versioned CSS keys, no unversioned stale substitution, warm reuse and unchanged protected-path exclusions.");
