import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { openDatabase } from "./db.mjs";
import { TripService } from "./domain/service.mjs";
import { DomainError, errorBody, errorStatus, conflict, validationError } from "./domain/errors.mjs";
import { handleMcp } from "./mcp.mjs";
import { acquireDataLock } from "./data-lock.mjs";
import { serveStatic } from "./static.mjs";
import { AccountStore, INVITATION_TOKEN_PATTERN, invitationInvalid } from "./auth/accounts.mjs";
import { boundedPassword, dummyVerify, hashPassword, normalizeUsername, passwordProblem, verifyPassword } from "./auth/passwords.mjs";
import { AttemptLimiter, SESSION_COOKIE, SESSION_TTL_MS, SessionStore } from "./auth/sessions.mjs";
import { OWNER, VIEWER, capabilitiesFor, isProtectedMediaPath, viewerMayAccess } from "./auth/policy.mjs";

// Private trip photos live in <dataDir>/photos, outside the checkout and every static directory, and
// are served only by the authenticated media handler below.
const PHOTO_SUBDIR = "photos";
const MEDIA_TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };
const SMALL_BODY = 8192;

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
async function readJSON(req, limit = 2_000_000) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new DomainError("unsupported_media_type",415,"Use application/json.");
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new DomainError("payload_too_large",413,"Request exceeds the size limit.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new DomainError("validation_failed",422,"Invalid JSON."); }
}
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const unauthorized = (message = "Authentication required.") => new DomainError("unauthorized",401,message);
const forbidden = () => new DomainError("forbidden",403,"This action is not available for this account.");

// Photos default to <config.dataDir>/photos. config.photoDir is an optional, code-only override
// (tests may use a disposable directory). It is not read from the environment.
export async function startServer(config) {
  // Data-directory ownership (crash-recoverable SQLite-based ownership) is defined in data-lock.mjs,
  // not here. Startup never deletes a foreign or legacy server.lock: if ownership cannot be taken it
  // fails closed and leaves the data untouched.
  const lock = acquireDataLock(config.dataDir);
  let db;
  try { db = openDatabase(path.join(config.dataDir,"shared-trip.sqlite")); }
  catch (error) { lock.release(); throw error; }
  const service = new TripService(db);
  const accounts = new AccountStore(db);
  const sessions = new SessionStore();
  const loginLimiter = new AttemptLimiter({ limit: 10, windowMs: 60_000, message: "Try signing in again later." });
  const inviteLimiter = new AttemptLimiter({ limit: 10, windowMs: 15 * 60_000, message: "Try again later." });
  const photoDir = path.resolve(config.photoDir || path.join(config.dataDir, PHOTO_SUBDIR));
  const send = (res,status,payload) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}); res.end(JSON.stringify(payload)); };

  // Every protected request re-reads the viewer account, so approval state and revocation apply
  // immediately to sessions that were issued earlier.
  function principalFromCookie(key, now) {
    const session = sessions.get(key, now);
    if (!session) return null;
    if (session.role === OWNER) return { role: OWNER, via: "cookie" };
    const account = accounts.sessionRecord(session.userId);
    if (!account || account.status !== "approved" || account.session_epoch !== session.epoch) { sessions.delete(key); return null; }
    return { role: VIEWER, via: "cookie", userId: account.id, username: account.username };
  }

  function serveProtectedMedia(req, res, pathname) {
    // Only flat photo files with a known image type; no attachment store exists, so /attachments/* is always 404.
    const match = /^\/photos\/([A-Za-z0-9][A-Za-z0-9_-]{0,127}(\.webp|\.png|\.jpe?g))$/.exec(pathname);
    if (match && ["GET","HEAD"].includes(req.method)) {
      try {
        const root = fs.realpathSync(photoDir);
        const file = fs.realpathSync(path.join(root, match[1]));
        if (path.dirname(file) === root && fs.statSync(file).isFile()) {
          const data = fs.readFileSync(file);
          res.writeHead(200,{"Content-Type":MEDIA_TYPES[match[2]],"Content-Length":data.length,"Cache-Control":"no-store"});
          res.end(req.method === "HEAD" ? undefined : data);
          return;
        }
      } catch { /* missing file or directory: generic 404 below */ }
    }
    send(res,404,{error:{code:"not_found",message:"Not found."}});
  }

  const server = http.createServer(async (req,res) => {
    res.setHeader("X-Content-Type-Options","nosniff");
    // Cross-origin requests (e.g. OpenStreetMap tiles, whose usage policy requires a valid Referer)
    // receive only this origin, never trip IDs or other private paths; HTTPS -> HTTP sends none.
    res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
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
      sessions.sweep(now);
      const secure = allowedOrigin.startsWith("https:") ? "; Secure" : "";
      const authorization = req.headers.authorization || "";
      const match = /^Bearer (.{1,512})$/.exec(authorization);
      const bearer = Boolean(match && sameSecret(match[1],config.token));
      const cookie = new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([A-Za-z0-9_-]+)").exec(req.headers.cookie || "")?.[1];
      // A presented but wrong bearer token never falls back to a cookie session.
      const principal = bearer ? { role: OWNER, via: "bearer" } : /^Bearer\s/i.test(authorization) ? null : principalFromCookie(cookie, now);
      const unsafe = !["GET","HEAD","OPTIONS"].includes(req.method);
      const client = req.socket.remoteAddress || "local";
      const issueSession = (data) => {
        sessions.delete(cookie);
        const key = sessions.create(data, Date.now());
        res.setHeader("Set-Cookie",SESSION_COOKIE+"="+key+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+(SESSION_TTL_MS/1000)+secure);
      };

      if (pathname === "/api/login" && req.method === "POST") {
        if (origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Same-origin browser request required.");
        loginLimiter.check(client, now);
        const body = await readJSON(req, SMALL_BODY);
        const failed = () => { loginLimiter.fail(client, Date.now()); return unauthorized("Sign-in failed."); };
        const ownerForm = isObject(body) && "token" in body && !("username" in body) && !("password" in body);
        const viewerForm = isObject(body) && !("token" in body) && "username" in body && "password" in body;
        if (ownerForm) {
          if (typeof body.token !== "string" || body.token.length > 512 || !sameSecret(body.token,config.token)) throw failed();
          issueSession({ role: OWNER });
          send(res,200,{authenticated:true,role:OWNER}); return;
        }
        if (!viewerForm) throw failed();
        const username = normalizeUsername(body.username);
        const secret = boundedPassword(body.password);
        const record = username && secret !== null ? accounts.loginRecord(username) : undefined;
        const valid = record ? await verifyPassword(secret, record.password_hash) : await dummyVerify();
        if (!valid) throw failed();
        // Re-read after the asynchronous hash: an approval state change during hashing wins.
        const current = accounts.sessionRecord(record.id);
        if (!current || current.status !== "approved") throw new DomainError("access_denied",403,"Access is not available for this account.");
        issueSession({ role: VIEWER, userId: current.id, epoch: current.session_epoch });
        send(res,200,{authenticated:true,role:VIEWER,username:current.username}); return;
      }

      if (pathname === "/api/accept-invite" && req.method === "POST") {
        if (origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Same-origin browser request required.");
        inviteLimiter.check(client, now);
        const body = await readJSON(req, SMALL_BODY);
        const invitation = isObject(body) && typeof body.invitation === "string" ? body.invitation.trim() : "";
        if (!INVITATION_TOKEN_PATTERN.test(invitation) || !accounts.invitationUsable(invitation, now)) { inviteLimiter.fail(client, now); throw invitationInvalid(); }
        const username = normalizeUsername(body.username);
        if (!username) throw validationError("Usernames use 3-32 lowercase letters, digits, dots, hyphens or underscores and start with a letter or digit.");
        const problem = passwordProblem(body.password);
        if (problem) throw validationError(problem);
        if (accounts.usernameTaken(username)) throw conflict("username_unavailable","Choose a different username.");
        const passwordHash = await hashPassword(body.password);
        send(res,201,accounts.redeemInvitation({ token: invitation, username, passwordHash }, Date.now())); return;
      }

      const media = isProtectedMediaPath(pathname);
      if (pathname === "/mcp" || pathname.startsWith("/api/") || media) {
        if (!principal || (pathname === "/mcp" && principal.via !== "bearer")) throw unauthorized();
        if (unsafe && principal.via !== "bearer" && origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Same-origin browser request required.");
        if (principal.role !== OWNER && !viewerMayAccess(req.method, pathname)) throw forbidden();
      }
      if (media) { serveProtectedMedia(req,res,pathname); return; }
      const requireOwner = () => { if (principal?.role !== OWNER) throw forbidden(); };
      if (pathname === "/api/session" && req.method === "GET") {
        send(res,200,{authenticated:true,role:principal.role,...(principal.username?{username:principal.username}:{}),capabilities:capabilitiesFor(principal)}); return;
      }
      if (pathname === "/api/logout" && req.method === "POST") {
        sessions.delete(cookie);
        res.setHeader("Set-Cookie",SESSION_COOKIE+"=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+secure);
        send(res,200,{authenticated:false}); return;
      }
      if (pathname === "/mcp") {
        requireOwner();
        if (req.method !== "POST") { res.setHeader("Allow","POST"); send(res,405,{error:{code:"method_not_allowed",message:"Stateless MCP supports POST."}}); return; }
        await handleMcp(req,res,await readJSON(req),service); return;
      }
      let result; let status = 200;
      if (pathname === "/api/trips" && req.method === "GET") result = service.listTrips();
      else if (pathname === "/api/trips" && req.method === "POST") { requireOwner(); result = service.createTrip(await readJSON(req)); status = 201; }
      else if (pathname === "/api/import" && req.method === "POST") { requireOwner(); result = service.importTrip(await readJSON(req)); status = 201; }
      else if (pathname === "/api/invitations" && req.method === "POST") { requireOwner(); result = accounts.createInvitation(await readJSON(req, SMALL_BODY)); status = 201; }
      else if (pathname === "/api/users" && req.method === "GET") { requireOwner(); result = accounts.listAccounts(); }
      else {
        const account = /^\/api\/users\/([^/]+)\/(approve|revoke)$/.exec(pathname);
        const trip = /^\/api\/trips\/([^/]+)(?:\/(changes|export))?$/.exec(pathname);
        if (account && req.method === "POST") {
          requireOwner();
          let id = "";
          try { id = decodeURIComponent(account[1]); } catch { /* invalid escape: treated as unknown */ }
          result = account[2] === "approve" ? accounts.approve(id) : accounts.revoke(id);
          if (account[2] === "revoke") sessions.deleteForAccount(result.account.id);
        } else if (trip) {
          const tripId = decodeURIComponent(trip[1]);
          if (!trip[2] && req.method === "GET") result = service.getTrip(tripId);
          else if (trip[2] === "export" && req.method === "GET") result = service.exportTrip(tripId);
          else if (trip[2] === "changes" && req.method === "POST") { requireOwner(); result = service.applyTripChanges({...await readJSON(req),tripId}); }
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
  catch (error) { try { db.close(); } finally { lock.release(); } throw error; }
  let closing;
  return { server, service, accounts, db, url: config.origin || "http://" + config.host + ":" + server.address().port,
    close: () => closing ??= (async () => {
      await new Promise((resolve) => server.close(() => resolve()));
      try { db.close(); } finally { lock.release(); }
    })() };
}
