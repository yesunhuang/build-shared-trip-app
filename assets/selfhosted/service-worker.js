const CACHE = "shared-trips-shell-__CACHE_VERSION__";
const SHELL = ["/offline.html","/home.css","/icons/icon-192.png","/icons/icon-512.png","/icons/apple-touch-icon.png","/manifest.webmanifest"];
self.addEventListener("install",(event)=>event.waitUntil(caches.open(CACHE).then((cache)=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",(event)=>event.waitUntil(caches.keys().then((names)=>Promise.all(names.filter((n)=>n!==CACHE&&(n.startsWith("shared-trip:/:")||n.startsWith("shared-trips-shell-"))).map((n)=>caches.delete(n)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",(event)=>{
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin||event.request.method!=="GET")return;
  // Protected responses and navigation never enter Cache Storage.
  if(/^\/(?:api|mcp|oauth|guest|s)(?:\/|$)/.test(url.pathname)||url.pathname.startsWith("/.well-known/oauth-"))return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request,{cache:"no-store"}).catch(()=>caches.match("/offline.html")));return;
  }
  if(SHELL.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async(cache)=>{
    // A build query is part of the resource identity. An older worker must not answer a new
    // page's versioned stylesheet with the unversioned bytes it installed for its own shell.
    const key=url.search?event.request.url:url.pathname;
    const cached=await cache.match(key);if(cached)return cached;
    const response=await fetch(event.request);if(response.ok)await cache.put(key,response.clone());return response;
  }));
});
