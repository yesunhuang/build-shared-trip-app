import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openDatabase } from "./db.mjs";
import { TripService } from "./domain/service.mjs";
import { DomainError, errorBody, errorStatus } from "./domain/errors.mjs";
import { handleMcp } from "./mcp.mjs";
import { serveStatic } from "./static.mjs";

export function readConfig(env = process.env) {
  const token = env.SHARED_TRIP_ADMIN_TOKEN;
  if (!token || !/^[-A-Za-z0-9._~+/=]{32,512}$/.test(token)) throw new Error("Set SHARED_TRIP_ADMIN_TOKEN to a random ASCII bearer secret of 32-512 characters.");
  if (!env.SHARED_TRIP_DATA_DIR) throw new Error("Set SHARED_TRIP_DATA_DIR outside the checkout.");
  const directory = path.resolve(env.SHARED_TRIP_DATA_DIR);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const dataDir = fs.realpathSync(directory);
  const repo = fs.realpathSync(path.resolve(import.meta.dirname, ".."));
  if (dataDir === repo || dataDir.startsWith(repo + path.sep)) throw new Error("Data directory must be outside the checkout.");
  const port = Number(env.SHARED_TRIP_PORT ?? 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid listen port.");
  let origin = "";
  if (env.SHARED_TRIP_ORIGIN) {
    const address = new URL(env.SHARED_TRIP_ORIGIN);
    if (!["https:","http:"].includes(address.protocol) || address.username || address.password ||
      address.pathname !== "/" || address.search || address.hash) throw new Error("SHARED_TRIP_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.");
    if (address.protocol === "http:" && !["127.0.0.1","localhost","[::1]"].includes(address.hostname)) throw new Error("Remote SHARED_TRIP_ORIGIN must use HTTPS.");
    origin = address.origin;
  }
  const host = env.SHARED_TRIP_HOST || "127.0.0.1";
  if (!["127.0.0.1","localhost","::1"].includes(host) && !origin) throw new Error("Non-loopback binding requires SHARED_TRIP_ORIGIN.");
  return { token, dataDir, host, port, origin };
}
function sameSecret(a,b) {
  const hash = (s) => crypto.createHash("sha256").update(String(s || "")).digest();
  return crypto.timingSafeEqual(hash(a),hash(b));
}
async function readJSON(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new DomainError("unsupported_media_type",415,"Use application/json.");
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new DomainError("payload_too_large",413,"Request exceeds the size limit.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("validation_failed",422,"Invalid JSON."); }
}
export async function startServer(config) {
  const lock = path.join(config.dataDir, "server.lock");
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock,"utf8"));
    try { process.kill(pid,0); throw new Error("A service already owns this data directory."); }
    catch (error) { if (error.code !== "ESRCH") throw error; fs.unlinkSync(lock); }
  }
  fs.writeFileSync(lock,String(process.pid),{flag:"wx",mode:0o600});
  let db;
  try { db = openDatabase(path.join(config.dataDir,"shared-trip.sqlite")); }
  catch (error) { fs.unlinkSync(lock); throw error; }
  const service = new TripService(db);
  const sessions = new Map();
  const failures = new Map();
  const send = (res,status,payload) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}); res.end(JSON.stringify(payload)); };
  const server = http.createServer(async (req,res) => {
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Referrer-Policy","same-origin");
    res.setHeader("X-Frame-Options","DENY");
    res.setHeader("Cache-Control","no-store");
    try {
      const url = new URL(req.url,"http://localhost");
      const host = req.headers.host;
      const allowedOrigin = config.origin || "http://" + (config.host === "localhost" ? "localhost" : config.host === "::1" ? "[::1]" : config.host) + ":" + server.address().port;
      const configuredHost = new URL(allowedOrigin).host;
      if (host !== configuredHost && !(config.origin && host === config.host + ":" + server.address().port)) throw new DomainError("forbidden_host",403,"Host is not allowed.");
      const origin = req.headers.origin;
      if (origin && origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Origin is not allowed.");
      const pathname = url.pathname;
      if (pathname === "/health" && req.method === "GET") { send(res,200,{status:"ok"}); return; }
      const now = Date.now();
      for (const [key,value] of sessions) if (value < now) sessions.delete(key);
      const match = /^Bearer (.{1,512})$/.exec(req.headers.authorization || "");
      const bearer = Boolean(match && sameSecret(match[1],config.token));
      const cookie = /(?:^|;\s*)shared_trip_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "")?.[1];
      const authenticated = bearer || (cookie && sessions.has(cookie));
      const unsafe = !["GET","HEAD","OPTIONS"].includes(req.method);
      if (pathname === "/api/login" && req.method === "POST") {
        if (origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Same-origin browser request required.");
        const client = req.socket.remoteAddress || "local";
        for (const [key,value] of failures) if (value.until < now) failures.delete(key);
        const failed = failures.get(client) || {count:0,until:now+60_000};
        if (failed.count >= 10) throw new DomainError("rate_limited",429,"Try signing in again later.");
        const body = await readJSON(req);
        if (!body || typeof body.token !== "string" || body.token.length > 512 || !sameSecret(body.token,config.token)) {
          failed.count++; failures.set(client,failed);
          throw new DomainError("unauthorized",401,"Sign-in failed.");
        }
        failures.delete(client);
        if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
        const key = crypto.randomBytes(32).toString("base64url");
        sessions.set(key,now+12*60*60*1000);
        res.setHeader("Set-Cookie","shared_trip_session="+key+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200"+(allowedOrigin.startsWith("https:")?"; Secure":""));
        send(res,200,{authenticated:true}); return;
      }
      if (pathname === "/mcp" || pathname.startsWith("/api/")) {
        if (!authenticated || (pathname === "/mcp" && !bearer)) throw new DomainError("unauthorized",401,"Authentication required.");
        if (unsafe && !bearer && origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Same-origin browser request required.");
      }
      if (pathname === "/api/session" && req.method === "GET") { send(res,200,{authenticated:true}); return; }
      if (pathname === "/api/logout" && req.method === "POST") {
        sessions.delete(cookie);
        res.setHeader("Set-Cookie","shared_trip_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+(allowedOrigin.startsWith("https:")?"; Secure":""));
        send(res,200,{authenticated:false}); return;
      }
      if (pathname === "/mcp") {
        if (req.method !== "POST") { res.setHeader("Allow","POST"); send(res,405,{error:{code:"method_not_allowed",message:"Stateless MCP supports POST."}}); return; }
        await handleMcp(req,res,await readJSON(req),service); return;
      }
      let result; let status = 200;
      if (pathname === "/api/trips" && req.method === "GET") result = service.listTrips();
      else if (pathname === "/api/trips" && req.method === "POST") { result = service.createTrip(await readJSON(req)); status = 201; }
      else if (pathname === "/api/import" && req.method === "POST") { result = service.importTrip(await readJSON(req)); status = 201; }
      else {
        const trip = /^\/api\/trips\/([^/]+)(?:\/(changes|export))?$/.exec(pathname);
        if (trip) {
          const tripId = decodeURIComponent(trip[1]);
          if (!trip[2] && req.method === "GET") result = service.getTrip(tripId);
          else if (trip[2] === "export" && req.method === "GET") result = service.exportTrip(tripId);
          else if (trip[2] === "changes" && req.method === "POST") result = service.applyTripChanges({...await readJSON(req),tripId});
        }
      }
      if (result) { send(res,status,result); return; }
      if (["GET","HEAD"].includes(req.method) && !pathname.startsWith("/api/") && serveStatic(req,res,pathname)) return;
      send(res,404,{error:{code:"not_found",message:"Not found."}});
    } catch (error) {
      if (!res.headersSent) send(res,errorStatus(error),errorBody(error));
      else res.end();
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  try { await new Promise((resolve,reject) => {server.once("error",reject); server.listen(config.port,config.host,resolve);}); }
  catch (error) {db.close();fs.unlinkSync(lock);throw error;}
  return { server, service, db, url: config.origin || "http://" + config.host + ":" + server.address().port,
    close: async () => { await new Promise((resolve) => server.close(resolve)); db.close(); if(fs.existsSync(lock)) fs.unlinkSync(lock); } };
}
