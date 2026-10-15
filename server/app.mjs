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
import { CONTENT_MANAGER, LOOKUP_ROUTE, OWNER, capabilitiesFor, isMcpOnlyPrincipal, isProtectedMediaPath, mayAccess } from "./auth/policy.mjs";
import { LookupService, readLookupConfig } from "./lookups.mjs";
import { McpTokenStore } from "./auth/mcp-tokens.mjs";
import { AuditLog } from "./audit.mjs";
import { ContentGateway, actorOf } from "./content-access.mjs";
import { OAUTH_ACCESS_PATTERN, OAuthStore } from "./auth/oauth.mjs";
import { createOAuth } from "./oauth-http.mjs";

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
  // OAuth: the single account that may approve connected applications. Omitted => nobody can.
  let oauthUsername = "";
  if (env.SHARED_TRIP_OAUTH_USERNAME !== undefined && env.SHARED_TRIP_OAUTH_USERNAME !== "") {
    oauthUsername = normalizeUsername(env.SHARED_TRIP_OAUTH_USERNAME);
    if (!oauthUsername) throw new Error("SHARED_TRIP_OAUTH_USERNAME must be an existing account's username (3-32 lowercase letters, digits, dots, hyphens or underscores).");
  }
  // Public place/photo lookups: disabled unless SHARED_TRIP_LOOKUPS_ENABLED=1 with an identifying
  // SHARED_TRIP_LOOKUP_USER_AGENT (see lookups.mjs). Disabled => no provider is ever contacted.
  const lookups = readLookupConfig(env);
  return { token, dataDir, host, port, origin, oauthUsername, lookups };
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

const decodeSegment = (value) => { try { return decodeURIComponent(value); } catch { return ""; } }; // invalid escape: treated as unknown

// Photos default to <config.dataDir>/photos. config.photoDir is an optional, code-only override
// (tests may use a disposable directory). config.clock is an optional, code-only millisecond clock for
// credential expiry and audit timestamps (tests inject one). Neither is read from the environment.
// config.oauthRedirectUris is an optional, code-only list of exact test callbacks (HTTPS or HTTP
// loopback) allowed in addition to the fixed production callback; it is never read from the environment.
// config.lookups comes from readConfig (opt-in). config.lookupFetch, config.lookupClock,
// config.lookupSleep and config.lookupTimeoutMs are optional, code-only test hooks for the lookup
// service (injected provider fetch, clock, delay and a shorter abort timeout); none is read from the
// environment and none changes the production rate limits.
export async function startServer(config) {
  const clock = typeof config.clock === "function" ? config.clock : Date.now;
  const oauthUsername = config.oauthUsername ? normalizeUsername(config.oauthUsername) : "";
  if (config.oauthUsername && !oauthUsername) throw new Error("Invalid OAuth username.");
  // Data-directory ownership (crash-recoverable SQLite-based ownership) is defined in data-lock.mjs,
  // not here. Startup never deletes a foreign or legacy server.lock: if ownership cannot be taken it
  // fails closed and leaves the data untouched.
  const lock = acquireDataLock(config.dataDir);
  let db;
  try { db = openDatabase(path.join(config.dataDir,"shared-trip.sqlite")); }
  catch (error) { lock.release(); throw error; }
  const service = new TripService(db);
  const audit = new AuditLog(db, { clock });
  const accounts = new AccountStore(db, { audit });
  const tokens = new McpTokenStore(db, { audit });
  const gateway = new ContentGateway(service, audit);
  const sessions = new SessionStore();
  const loginLimiter = new AttemptLimiter({ limit: 10, windowMs: 60_000, message: "Try signing in again later." });
  const inviteLimiter = new AttemptLimiter({ limit: 10, windowMs: 15 * 60_000, message: "Try again later." });
  const oauthStore = new OAuthStore(db, { audit, username: oauthUsername });
  let oauth; let lookups;
  try {
    oauth = createOAuth({ store: oauthStore, accounts, audit, loginLimiter, clock, redirectUris: config.oauthRedirectUris });
    lookups = new LookupService({ ...(config.lookups?.enabled === true ? config.lookups : { enabled: false }), dataDir: config.dataDir,
      fetch: config.lookupFetch, clock: config.lookupClock || clock, sleep: config.lookupSleep, timeoutMs: config.lookupTimeoutMs });
  }
  catch (error) { try { db.close(); } finally { lock.release(); } throw error; }
  const photoDir = path.resolve(config.photoDir || path.join(config.dataDir, PHOTO_SUBDIR));
  const send = (res,status,payload) => { res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}); res.end(JSON.stringify(payload)); };

  // Every protected request re-reads the account, so approval state, role changes and revocation
  // apply immediately to sessions that were issued earlier.
  function principalFromCookie(key, now) {
    const session = sessions.get(key, now);
    if (!session) return null;
    if (session.role === OWNER) return { role: OWNER, via: "cookie" };
    const account = accounts.sessionRecord(session.userId);
    if (!account || account.status !== "approved" || account.session_epoch !== session.epoch || account.role !== session.role) { sessions.delete(key); return null; }
    return { role: account.role, via: "cookie", userId: account.id, username: account.username };
  }

  // Owner bearer first (unchanged and compatible). Any other bearer is tried as a content-manager MCP
  // credential, which yields a principal only at /mcp. A presented but unusable bearer never falls
  // back to a cookie session.
  // OAuth access tokens are likewise accepted only at /mcp, with content-manager permissions, and
  // are re-checked against grant, resource, scope and the account on every request.
  function principalFromBearer(value, pathname, protectedPath, allowedOrigin) {
    if (value && sameSecret(value, config.token)) return { role: OWNER, via: "bearer" };
    const atMcp = pathname === "/mcp";
    const isOAuth = Boolean(value) && OAUTH_ACCESS_PATTERN.test(value);
    const credential = !value ? null : isOAuth ? oauth.authenticateAccess(value, { pathname, allowedOrigin }) : tokens.authenticate(value, clock(), { touch: atMcp });
    if (!credential) return null;
    const refuse = (reason) => { if (protectedPath) audit.safeRecord({ actor: credential.userId, channel: atMcp ? "mcp" : "http", action: "auth.refused", outcome: "refused", reason }); return null; };
    if (!credential.ok) return refuse(credential.reason);
    if (!atMcp) return refuse(isOAuth ? "oauth_token_wrong_route" : "mcp_token_wrong_route");
    if (isOAuth) return { role: CONTENT_MANAGER, via: "oauth", userId: credential.userId, username: credential.username, grantId: credential.grantId };
    return { role: CONTENT_MANAGER, via: "mcp-token", userId: credential.userId, username: credential.username, tokenId: credential.tokenId };
  }

  // Owner-only administration: refusals are audited best effort (successes are audited by the stores
  // inside their transactions).
  async function administer(action, target, work) {
    try { return await work(); }
    catch (error) {
      audit.safeRecord({ actor: "owner", channel: "http", action, outcome: "refused", reason: error instanceof DomainError ? error.code : "internal_error", target });
      throw error;
    }
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
    let deniedActor = null; let deniedChannel = "http";
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
      // OAuth metadata/endpoints apply their own Origin rules (public-client CORS only on the
      // credential-free JSON endpoints; same-origin for the browser forms). Everything else keeps
      // the global guard below.
      if (await oauth.handle(req, res, { url, pathname: url.pathname, allowedOrigin, origin, client: req.socket.remoteAddress || "local", secure: allowedOrigin.startsWith("https:") })) return;
      if (origin && origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Origin is not allowed.");
      const pathname = url.pathname;
      if (pathname === "/health" && req.method === "GET") { send(res,200,{status:"ok"}); return; }
      const now = Date.now();
      sessions.sweep(now);
      const secure = allowedOrigin.startsWith("https:") ? "; Secure" : "";
      const authorization = req.headers.authorization || "";
      const match = /^Bearer (.{1,512})$/.exec(authorization);
      const cookie = new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([A-Za-z0-9_-]+)").exec(req.headers.cookie || "")?.[1];
      const media = isProtectedMediaPath(pathname);
      const protectedPath = pathname === "/mcp" || pathname.startsWith("/api/") || media;
      // A presented but wrong bearer token never falls back to a cookie session.
      const bearerPresented = /^Bearer\s/i.test(authorization);
      const principal = bearerPresented ? principalFromBearer(match?.[1], pathname, protectedPath, allowedOrigin) : principalFromCookie(cookie, now);
      if (principal) { deniedActor = actorOf(principal); deniedChannel = principal.via === "mcp-token" || principal.via === "oauth" ? "mcp" : "http"; }
      // /mcp 401 responses advertise the protected-resource metadata and the only scope (RFC 9728).
      const mcpUnauthorized = () => { res.setHeader("WWW-Authenticate", oauth.challenge(allowedOrigin, bearerPresented)); return unauthorized(); };
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
        issueSession({ role: current.role, userId: current.id, epoch: current.session_epoch });
        send(res,200,{authenticated:true,role:current.role,username:current.username}); return;
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

      if (protectedPath) {
        // Browser sessions (owner or account) never authorize MCP; only the owner bearer or a valid
        // content-manager credential does.
        if (pathname === "/mcp" && (!principal || principal.via === "cookie")) throw mcpUnauthorized();
        if (!principal) throw unauthorized();
        if (unsafe && principal.via === "cookie" && origin !== allowedOrigin) throw new DomainError("forbidden_origin",403,"Same-origin browser request required.");
        if (principal.role !== OWNER && !mayAccess(principal, req.method, pathname)) throw forbidden();
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
        if (!(principal.role === OWNER && principal.via === "bearer") && !isMcpOnlyPrincipal(principal)) throw mcpUnauthorized();
        if (req.method !== "POST") { res.setHeader("Allow","POST"); send(res,405,{error:{code:"method_not_allowed",message:"Stateless MCP supports POST."}}); return; }
        await handleMcp(req,res,await readJSON(req),gateway,principal); return;
      }
      const context = { principal, channel: "http" };
      let result; let status = 200;
      if (pathname === "/api/trips" && req.method === "GET") result = gateway.listTrips(context);
      else if (pathname === "/api/trips" && req.method === "POST") { result = gateway.createTrip(context, await readJSON(req)); status = 201; }
      else if (pathname === "/api/import" && req.method === "POST") { result = gateway.importTrip(context, await readJSON(req)); status = 201; }
      else if (pathname === "/api/invitations" && req.method === "POST") { requireOwner(); result = await administer("invitation.create", null, async () => accounts.createInvitation(await readJSON(req, SMALL_BODY))); status = 201; }
      else if (pathname === "/api/users" && req.method === "GET") { requireOwner(); result = accounts.listAccounts(); }
      else if (pathname === "/api/audit" && req.method === "GET") { requireOwner(); result = audit.list(url.searchParams.get("limit")); }
      else {
        const account = /^\/api\/users\/([^/]+)\/(approve|revoke|role)$/.exec(pathname);
        const credentials = /^\/api\/users\/([^/]+)\/mcp-tokens$/.exec(pathname);
        const credential = /^\/api\/users\/([^/]+)\/mcp-tokens\/([^/]+)\/revoke$/.exec(pathname);
        const oauthGrants = /^\/api\/users\/([^/]+)\/oauth-grants$/.exec(pathname);
        const oauthGrant = /^\/api\/users\/([^/]+)\/oauth-grants\/([^/]+)\/revoke$/.exec(pathname);
        const trip = /^\/api\/trips\/([^/]+)(?:\/(changes|export))?$/.exec(pathname);
        const lookup = LOOKUP_ROUTE.exec(pathname);
        if (lookup && req.method === "POST") {
          // Explicit, editor-only public place/photo search for one existing trip. The provider URL
          // is fixed server configuration; the body carries only { query, refresh? }. Nothing is
          // written to the trip; a chosen result is saved with an ordinary change request.
          gateway.lookupTarget(context, decodeSegment(lookup[1]));
          const body = await readJSON(req, SMALL_BODY);
          result = await lookups.search(lookup[2] === "places" ? "place" : "photo", actorOf(principal), body);
        } else if (account && req.method === "POST") {
          requireOwner();
          const id = decodeSegment(account[1]);
          if (account[2] === "role") {
            const { account: changed, changed: roleChanged } = await administer("account.role", id, async () => accounts.setRole(id, await readJSON(req, SMALL_BODY), clock()));
            // The store already bumped the epoch; dropping in-memory sessions is additional cleanup.
            if (roleChanged) sessions.deleteForAccount(changed.id);
            result = { account: changed };
          } else {
            result = await administer("account." + account[2], id, () => account[2] === "approve" ? accounts.approve(id, clock()) : accounts.revoke(id, clock()));
            if (account[2] === "revoke") sessions.deleteForAccount(result.account.id);
          }
        } else if (credentials && ["GET","POST"].includes(req.method)) {
          requireOwner();
          const id = decodeSegment(credentials[1]);
          if (req.method === "GET") result = tokens.list(id);
          else { result = await administer("token.issue", id, async () => tokens.issue(id, await readJSON(req, SMALL_BODY), clock())); status = 201; }
        } else if (credential && req.method === "POST") {
          requireOwner();
          const id = decodeSegment(credential[1]); const tokenId = decodeSegment(credential[2]);
          result = await administer("token.revoke", tokenId, () => tokens.revoke(id, tokenId, clock()));
        } else if (oauthGrants && req.method === "GET") {
          // Owner-only, metadata only: never codes, tokens or digests.
          requireOwner();
          result = oauthStore.listGrants(decodeSegment(oauthGrants[1]), clock());
        } else if (oauthGrant && req.method === "POST") {
          requireOwner();
          const id = decodeSegment(oauthGrant[1]); const grantId = decodeSegment(oauthGrant[2]);
          result = await administer("oauth.grant.revoke", grantId, () => oauthStore.revokeGrant(id, grantId, clock()));
        } else if (trip && !trip[2] && req.method === "DELETE") {
          // Owner-only permanent deletion. Non-owner sessions were already refused by the route
          // allowlist (403) and non-owner bearers never reach here (401); requireOwner is explicit
          // defense in depth. The trip ID comes only from the path.
          requireOwner();
          const body = await readJSON(req, SMALL_BODY);
          if (!isObject(body)) throw validationError("The request body must be a JSON object.");
          if (Object.hasOwn(body, "tripId")) throw validationError("The trip ID comes from the URL; omit tripId from the body.");
          result = gateway.deleteTrip(context, { ...body, tripId: decodeSegment(trip[1]) });
        } else if (trip) {
          const tripId = decodeURIComponent(trip[1]);
          if (!trip[2] && req.method === "GET") result = gateway.getTrip(context, tripId);
          else if (trip[2] === "export" && req.method === "GET") result = gateway.exportTrip(context, tripId);
          else if (trip[2] === "changes" && req.method === "POST") result = gateway.applyTripChanges(context, {...await readJSON(req),tripId});
        }
      }
      if (result) { send(res,status,result); return; }
      if (["GET","HEAD"].includes(req.method) && !pathname.startsWith("/api/") && serveStatic(req,res,pathname)) return;
      send(res,404,{error:{code:"not_found",message:"Not found."}});
    } catch (error) {
      if (error instanceof DomainError && error.code === "forbidden" && !error.audited && deniedActor) audit.safeRecord({ actor: deniedActor, channel: deniedChannel, action: "access.denied", outcome: "refused", reason: "forbidden" });
      if (!res.headersSent) send(res,errorStatus(error),errorBody(error));
      else res.end();
    }
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  try { await new Promise((resolve,reject) => {server.once("error",reject); server.listen(config.port,config.host,resolve);}); }
  catch (error) { try { db.close(); } finally { lock.release(); } throw error; }
  let closing;
  return { server, service, accounts, tokens, audit, db, oauth: oauthStore, lookups, url: config.origin || "http://" + config.host + ":" + server.address().port,
    close: () => closing ??= (async () => {
      await new Promise((resolve) => server.close(() => resolve()));
      try { db.close(); } finally { lock.release(); }
    })() };
}
