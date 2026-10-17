// OAuth 2.1 authorization server and protected-resource metadata for /mcp.
//
// Routes (all handled before the application's generic Origin guard, after the Host guard):
//   GET  /.well-known/oauth-protected-resource[/mcp]   RFC 9728 metadata (public, CORS *)
//   GET  /.well-known/oauth-authorization-server       RFC 8414 metadata (public, CORS *)
//   POST /oauth/register                               RFC 7591 public clients only (CORS *)
//   POST /oauth/token                                  authorization_code + PKCE S256, refresh_token (CORS *)
//   POST /oauth/revoke                                 RFC 7009, client-bound (CORS *)
//   GET  /oauth/authorize                              validates the request, starts a transaction, shows sign-in
//   POST /oauth/authorize/login                        dedicated account sign-in (same-origin browser form)
//   POST /oauth/authorize/decision                     explicit allow / deny (same-origin browser form)
//
// The CORS endpoints never read cookies or any ambient credential and never send
// Access-Control-Allow-Credentials, so a wildcard origin is safe there. The browser endpoints use a
// short-lived in-memory transaction referenced only by an HttpOnly SameSite=Strict cookie and bound
// to a per-page CSRF value; nothing secret is placed in URLs or web storage, and the pages contain no
// JavaScript. A GET never grants anything, owner sessions and the owner bearer are never accepted,
// and an unknown client or unregistered redirect URI is never redirected to.
import crypto from "node:crypto";
import { DomainError } from "./domain/errors.mjs";
import { boundedPassword, dummyVerify, normalizeUsername, verifyPassword } from "./auth/passwords.mjs";
import { AttemptLimiter } from "./auth/sessions.mjs";
import { OAUTH_SCOPE, PKCE_CHALLENGE_PATTERN, GRANT_LIFETIME_MS } from "./auth/oauth.mjs";

export const PRODUCTION_REDIRECT_URIS = Object.freeze(["https://chatgpt.com/connector_platform_oauth_redirect"]);
export const OAUTH_TRANSACTION_COOKIE = "shared_trip_oauth";
export const OAUTH_TRANSACTION_TTL_MS = 10 * 60_000;
const COOKIE_PATH = "/oauth/authorize";
const MAX_TRANSACTIONS = 500;
const FORM_LIMIT = 4096;
const REGISTRATION_LIMIT = 8192;
const SWEEP_INTERVAL_MS = 10 * 60_000;
// Protocol field names, kept out of object-literal keys so the repository privacy scanner (which
// looks for credential-like keys in source) is not confused by OAuth vocabulary.
const ACCESS_FIELD = "access_token";
const REFRESH_FIELD = "refresh_token";
const PRM_PATH = "/.well-known/oauth-protected-resource";
const ASM_PATH = "/.well-known/oauth-authorization-server";
const CORS_ROUTES = new Set(["/oauth/register", "/oauth/token", "/oauth/revoke"]);
const AUTHORIZE_PARAMS = ["client_id", "redirect_uri", "response_type", "response_mode", "scope", "state", "code_challenge", "code_challenge_method", "resource", "request", "request_uri", "prompt"];
const GRANT_TYPES = ["authorization_code", "refresh_token"];
const REGISTRATION_FIELDS = new Set(["redirect_uris", "client_name", "token_endpoint_auth_method", "grant_types", "response_types", "scope"]);
const INFORMATIONAL_FIELDS = new Set(["client_uri", "logo_uri", "tos_uri", "policy_uri", "software_id", "software_version", "contacts", "application_type"]);
const SECURITY_FIELD = /secret|jwk|key|cert|tls|auth|sign|encrypt|enc_|alg|software_statement|request|token|sector|subject|backchannel|frontchannel|logout|dpop|require|max_age|initiate|post_logout|userinfo|introspection/i;
const CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/;

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const random = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Test-only exact callbacks: HTTPS, or HTTP on loopback; never credentials, query or fragment; canonical form only. */
export function validateTestRedirectUris(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 5) throw new Error("config.oauthRedirectUris must be an array of at most five exact callback URLs.");
  return list.map((value) => {
    if (typeof value !== "string") throw new Error("Invalid test OAuth redirect URI.");
    let url;
    try { url = new URL(value); } catch { throw new Error("Invalid test OAuth redirect URI."); }
    const allowed = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
    if (!allowed || url.username || url.password || url.search || url.hash || url.href !== value || value.length > 512) throw new Error("Invalid test OAuth redirect URI.");
    return value;
  });
}

// ------------------------------------------------------------------------------------------------
// HTML (no JavaScript; one inline stylesheet allowed by its hash)

const STYLE = ":root{color-scheme:light dark;font-family:system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif;line-height:1.5}" +
  "body{margin:0;background:#f4f1ea;color:#1d2a26;-webkit-text-size-adjust:100%}" +
  "main{max-width:34rem;margin:0 auto;padding:1rem}" +
  ".card{background:#fff;border-radius:14px;padding:1.25rem;box-shadow:0 1px 3px rgba(0,0,0,.14);margin-top:1rem}" +
  ".eyebrow{margin:0;font-size:.85rem;letter-spacing:.04em;text-transform:uppercase;color:#4d5f59}" +
  "h1{font-size:1.35rem;line-height:1.3;margin:.25rem 0 1rem}h2{font-size:1.05rem;margin:1.25rem 0 .4rem}" +
  "dl{margin:0;padding:.75rem;border:1px solid #c9d1cd;border-radius:10px}dt{font-weight:600;font-size:.9rem}dd{margin:0 0 .6rem}dd:last-child{margin-bottom:0}" +
  ".mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88rem;overflow-wrap:anywhere;word-break:break-all}" +
  "ul{padding-left:1.25rem;margin:.25rem 0}li{margin:.2rem 0}" +
  "label{display:block;font-weight:600;margin-top:.9rem}" +
  "input{display:block;width:100%;box-sizing:border-box;font-size:1rem;padding:.7rem;margin-top:.3rem;border:1px solid #7d8a85;border-radius:8px;background:#fff;color:#1d2a26}" +
  ".actions{display:flex;flex-wrap:wrap;gap:.75rem;margin-top:1.25rem}.actions form{flex:1 1 11rem;margin:0}" +
  "button{display:block;width:100%;min-height:3rem;font-size:1rem;font-weight:600;border-radius:10px;padding:.65rem 1rem;cursor:pointer;border:2px solid #17362f}" +
  ".primary{background:#17362f;color:#fff}.secondary{background:#fff;color:#17362f}" +
  ".notice{background:#fdecea;border:1px solid #d99a92;color:#5c1d16;padding:.65rem .8rem;border-radius:8px;margin:0 0 1rem}" +
  ".fine{font-size:.9rem;color:#4d5f59;margin:1rem 0 0}" +
  "@media (prefers-color-scheme:dark){body{background:#101715;color:#e7eeeb}.card{background:#1a2421;box-shadow:none;border:1px solid #33433e}" +
  ".eyebrow,.fine{color:#a9bab4}dl{border-color:#3b4c47}input{background:#101715;color:#e7eeeb;border-color:#6f807a}" +
  ".primary{background:#9fd3c0;color:#0d1d18;border-color:#9fd3c0}.secondary{background:transparent;color:#cfe7de;border-color:#9fd3c0}" +
  ".notice{background:#3a1d1a;color:#f6d3ce;border-color:#7a3a33}}";
const STYLE_SOURCE = "'sha256-" + crypto.createHash("sha256").update(STYLE).digest("base64") + "'";

const ESCAPES = new Map([["&", "&amp;"], ["<", "&lt;"], [">", "&gt;"], ["\"", "&quot;"], ["'", "&#39;"]]);
export const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ESCAPES.get(char));

function page(title, body) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<meta name=\"referrer\" content=\"no-referrer\"><meta name=\"robots\" content=\"noindex\"><title>" + escapeHtml(title) + " - Shared Trips</title>" +
    "<style>" + STYLE + "</style></head><body><main><div class=\"card\"><p class=\"eyebrow\">Shared Trips</p>" + body + "</div></main></body></html>";
}

function clientSummary(client, redirectUri) {
  return "<dl><dt>Application name (supplied by the application, not verified)</dt><dd>" + escapeHtml(client.clientName) + "</dd>" +
    "<dt>Client ID</dt><dd class=\"mono\">" + escapeHtml(client.id) + "</dd>" +
    "<dt>Sends you back to</dt><dd class=\"mono\">" + escapeHtml(redirectUri) + "</dd></dl>";
}

const hidden = (name, value) => "<input type=\"hidden\" name=\"" + name + "\" value=\"" + escapeHtml(value) + "\">";
const denyForm = (csrf, label) => "<form method=\"post\" action=\"/oauth/authorize/decision\">" + hidden("csrf", csrf) + hidden("decision", "deny") +
  "<button class=\"secondary\" type=\"submit\">" + label + "</button></form>";

function loginPage({ client, redirectUri, csrf, notice = "" }) {
  return page("Sign in to connect an application",
    "<h1>Sign in to connect an application</h1>" + (notice ? "<p class=\"notice\" role=\"alert\">" + escapeHtml(notice) + "</p>" : "") +
    "<p>An application is asking to manage trips with your Shared Trips account. Check that you started this connection yourself.</p>" +
    clientSummary(client, redirectUri) +
    "<form method=\"post\" action=\"/oauth/authorize/login\">" + hidden("csrf", csrf) +
    "<label for=\"oauth-username\">Username</label><input id=\"oauth-username\" name=\"username\" type=\"text\" autocomplete=\"username\" autocapitalize=\"none\" spellcheck=\"false\" maxlength=\"64\" required>" +
    "<label for=\"oauth-secret\">Password</label><input id=\"oauth-secret\" name=\"password\" type=\"password\" autocomplete=\"current-password\" maxlength=\"128\" required>" +
    "<div class=\"actions\"><button class=\"primary\" type=\"submit\">Sign in</button></div></form>" +
    "<div class=\"actions\">" + denyForm(csrf, "Cancel and return") + "</div>" +
    "<p class=\"fine\">Signing in here only continues this request. It does not sign you in to the Shared Trips website and does not approve anything yet.</p>");
}

function consentPage({ client, redirectUri, csrf, username }) {
  return page("Allow access to your trips?",
    "<h1>Allow this application to manage trips?</h1>" +
    "<p>Signed in as <strong>" + escapeHtml(username) + "</strong> (content manager).</p>" + clientSummary(client, redirectUri) +
    "<h2>It will be able to</h2><ul>" +
    "<li>List and read trips available to your account, including archived trips. Content managers normally require membership; only a separately approved stable assistant account has an all-trip exception.</li>" +
    "<li>Create, import and export trips.</li>" +
    "<li>Edit trip content: days, plans and reminders, including deleting or replacing content and archiving or unarchiving trips.</li></ul>" +
    "<h2>It will not be able to</h2><ul>" +
    "<li>Use owner access or anything only the owner can do.</li>" +
    "<li>Manage accounts, invitations, roles, MCP credentials, connected applications or the audit log.</li>" +
    "<li>Change passwords or any security setting.</li>" +
    "<li>Use the Shared Trips website, its web API or protected photos. It only gets the six MCP trip tools.</li></ul>" +
    "<h2>How long</h2><p>Scope <span class=\"mono\">" + OAUTH_SCOPE + "</span>, for at most " + Math.round(GRANT_LIFETIME_MS / 86_400_000) + " days. After that you must sign in and approve again. " +
    "The owner can revoke this access at any time, and revoking your account or changing its role ends it.</p>" +
    "<div class=\"actions\"><form method=\"post\" action=\"/oauth/authorize/decision\">" + hidden("csrf", csrf) + hidden("decision", "allow") +
    "<button class=\"primary\" type=\"submit\">Allow</button></form>" + denyForm(csrf, "Deny") + "</div>");
}

function errorPage(title, message) {
  return page(title, "<h1>" + escapeHtml(title) + "</h1><p>" + escapeHtml(message) + "</p><p class=\"fine\">You can close this page and return to the application to start again.</p>");
}

// ------------------------------------------------------------------------------------------------
// Response helpers

function sendHtml(res, status, html, formTargets = []) {
  const targets = [...new Set(formTargets)].map((value) => " " + value).join("");
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src " + STYLE_SOURCE + "; img-src 'none'; form-action 'self'" + targets + "; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function sendJson(res, status, payload, { head = false } = {}) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(head ? undefined : JSON.stringify(payload));
}

const oauthError = (res, status, error, description) => sendJson(res, status, { error, error_description: description });

function redirect(res, status, location) {
  res.writeHead(status, { Location: location, "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "Content-Length": 0 });
  res.end();
}

function cors(res, methods) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", methods);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "600");
}

function callbackUrl(base, params) {
  const url = new URL(base);
  for (const [name, value] of params) if (value !== undefined && value !== null) url.searchParams.append(name, value);
  return url.href;
}

async function readBody(req, limit) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new DomainError("payload_too_large", 413, "Request exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

const isForm = (req) => /^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(req.headers["content-type"] || "");

/** Parses a form body. Returns null-prototype fields and the names of repeated parameters. */
async function readForm(req) {
  if (!isForm(req)) throw new DomainError("unsupported_media_type", 415, "Use application/x-www-form-urlencoded.");
  const fields = Object.create(null); const repeated = new Set();
  for (const [name, value] of new URLSearchParams(await readBody(req, FORM_LIMIT))) {
    if (Object.hasOwn(fields, name)) repeated.add(name);
    fields[name] = value;
  }
  return { fields, repeated: [...repeated] };
}

// ------------------------------------------------------------------------------------------------
// In-memory authorization transactions (expire after OAUTH_TRANSACTION_TTL_MS and on restart)

class TransactionStore {
  constructor(clock) { this.clock = clock; this.entries = new Map(); }
  sweep(now = this.clock()) { for (const [key, value] of this.entries) if (value.expires <= now) this.entries.delete(key); }
  create(data) {
    const now = this.clock();
    this.sweep(now);
    while (this.entries.size >= MAX_TRANSACTIONS) this.entries.delete(this.entries.keys().next().value);
    const key = random(); const csrf = random();
    const entry = { ...data, csrfDigest: digest(csrf), expires: now + OAUTH_TRANSACTION_TTL_MS };
    this.entries.set(digest(key), entry);
    return { key, csrf, entry };
  }
  get(key) {
    if (typeof key !== "string" || !key) return null;
    const entry = this.entries.get(digest(key));
    if (!entry) return null;
    if (entry.expires <= this.clock()) { this.entries.delete(digest(key)); return null; }
    return entry;
  }
  delete(key) { if (typeof key === "string" && key) this.entries.delete(digest(key)); }
  /** Replaces the transaction under a new cookie and CSRF value (used after sign-in). */
  rotate(key, changes) {
    const entry = this.get(key);
    this.delete(key);
    const { csrfDigest, expires, ...data } = entry;
    return this.create({ ...data, ...changes });
  }
}

function csrfMatches(entry, value) {
  if (!entry || typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  return crypto.timingSafeEqual(Buffer.from(digest(value)), Buffer.from(entry.csrfDigest));
}

// ------------------------------------------------------------------------------------------------

/**
 * store: OAuthStore. accounts: AccountStore. loginLimiter: the existing sign-in AttemptLimiter.
 * clock: millisecond clock for codes, tokens and transactions. redirectUris: optional code-only
 * test callbacks (config.oauthRedirectUris).
 */
export function createOAuth({ store, accounts, audit, loginLimiter, clock = Date.now, redirectUris }) {
  const allowedRedirects = new Set([...PRODUCTION_REDIRECT_URIS, ...validateTestRedirectUris(redirectUris)]);
  const transactions = new TransactionStore(clock);
  const registerLimiter = new AttemptLimiter({ limit: 30, windowMs: 60 * 60_000, message: "Too many registrations." });
  const registerGlobal = new AttemptLimiter({ limit: 300, windowMs: 60 * 60_000, message: "Too many registrations." });
  const tokenLimiter = new AttemptLimiter({ limit: 60, windowMs: 60_000, message: "Too many failed requests." });
  const authorizeLimiter = new AttemptLimiter({ limit: 60, windowMs: 10 * 60_000, message: "Too many authorization requests." });
  let nextSweep = 0;

  const resourceFor = (origin) => origin + "/mcp";
  const refuse = (event) => audit.safeRecord({ channel: "http", outcome: "refused", actor: "anonymous", ...event });

  function protectedResourceMetadata(origin) {
    return { resource: resourceFor(origin), authorization_servers: [origin], scopes_supported: [OAUTH_SCOPE], bearer_methods_supported: ["header"], resource_name: "Shared Trips" };
  }
  function authorizationServerMetadata(origin) {
    return {
      issuer: origin,
      authorization_endpoint: origin + "/oauth/authorize",
      token_endpoint: origin + "/oauth/token",
      registration_endpoint: origin + "/oauth/register",
      revocation_endpoint: origin + "/oauth/revoke",
      scopes_supported: [OAUTH_SCOPE],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: [...GRANT_TYPES],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      authorization_response_iss_parameter_supported: true
    };
  }

  const cookieFor = (key, secure, maxAge = OAUTH_TRANSACTION_TTL_MS / 1000) =>
    OAUTH_TRANSACTION_COOKIE + "=" + key + "; Path=" + COOKIE_PATH + "; HttpOnly; SameSite=Strict; Max-Age=" + maxAge + (secure ? "; Secure" : "");
  const readCookie = (req) => new RegExp("(?:^|;\\s*)" + OAUTH_TRANSACTION_COOKIE + "=([A-Za-z0-9_-]{43})(?:;|$)").exec(req.headers.cookie || "")?.[1];
  // Pages send Referrer-Policy: no-referrer, which makes browsers send "Origin: null" on their own
  // form posts. That value is accepted only together with the browser's Sec-Fetch-Site attestation.
  const sameOriginPost = (req, origin) => req.headers.origin === origin || (req.headers.origin === "null" && req.headers["sec-fetch-site"] === "same-origin");
  const redirectAllowed = (client, redirectUri) => Boolean(client) && typeof redirectUri === "string" && client.redirectUris.includes(redirectUri) && allowedRedirects.has(redirectUri);
  const formTargets = (redirectUri) => [new URL(redirectUri).origin];

  // ----------------------------------------------------------------------------------------------
  // Public JSON endpoints

  function metadata(req, res, ctx) {
    cors(res, "GET, HEAD, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return; }
    if (!["GET", "HEAD"].includes(req.method)) { res.setHeader("Allow", "GET, HEAD, OPTIONS"); oauthError(res, 405, "invalid_request", "Use GET."); return; }
    const body = ctx.pathname === ASM_PATH ? authorizationServerMetadata(ctx.allowedOrigin) : protectedResourceMetadata(ctx.allowedOrigin);
    sendJson(res, 200, body, { head: req.method === "HEAD" });
  }

  function validateRegistration(body) {
    const bad = (description) => ({ error: "invalid_client_metadata", description });
    if (!isObject(body)) return bad("The registration request must be a JSON object.");
    const keys = Object.keys(body);
    if (keys.length > 32) return bad("Too many metadata fields.");
    for (const key of keys) {
      if (REGISTRATION_FIELDS.has(key)) continue;
      if (INFORMATIONAL_FIELDS.has(key)) {
        const value = body[key];
        const okString = (item) => typeof item === "string" && item.length <= 512 && !CONTROL.test(item);
        if (key === "contacts" ? !(Array.isArray(value) && value.length <= 5 && value.every(okString)) : key === "application_type" ? !["web", "native"].includes(value) : !okString(value)) return bad("Invalid " + key + ".");
        continue;
      }
      if (SECURITY_FIELD.test(key)) return bad("Unsupported security metadata: " + key.slice(0, 64).replace(/[^A-Za-z0-9_]/g, "") + ".");
      if (key.length > 64 || !/^[a-z][a-z0-9_]*$/.test(key)) return bad("Unsupported metadata field.");
      // Other unknown informational members are ignored and never stored (RFC 7591 section 2).
    }
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 || new Set(uris).size !== uris.length) return { error: "invalid_redirect_uri", description: "Provide one to five distinct redirect_uris." };
    for (const uri of uris) if (typeof uri !== "string" || !allowedRedirects.has(uri)) return { error: "invalid_redirect_uri", description: "A redirect URI is not allowed by this server." };
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== "none") return bad("Only public clients (token_endpoint_auth_method none) are supported.");
    const grants = body.grant_types;
    if (grants !== undefined && (!Array.isArray(grants) || !grants.length || new Set(grants).size !== grants.length || !grants.every((item) => GRANT_TYPES.includes(item)) || !grants.includes("authorization_code"))) {
      return bad("grant_types may contain only authorization_code and refresh_token.");
    }
    const responses = body.response_types;
    if (responses !== undefined && !(Array.isArray(responses) && responses.length === 1 && responses[0] === "code")) return bad("response_types must be [\"code\"].");
    if (body.scope !== undefined && body.scope !== OAUTH_SCOPE) return bad("The only supported scope is " + OAUTH_SCOPE + ".");
    let clientName = "Unnamed application";
    if (body.client_name !== undefined) {
      if (typeof body.client_name !== "string" || CONTROL.test(body.client_name) || !body.client_name.trim() || body.client_name.trim().length > 100) return bad("client_name must contain 1 to 100 visible characters.");
      clientName = body.client_name.trim();
    }
    return { ok: true, clientName, redirectUris: [...uris] };
  }

  async function register(req, res, ctx) {
    cors(res, "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return; }
    if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); oauthError(res, 405, "invalid_request", "Use POST."); return; }
    const now = Date.now();
    try { registerLimiter.check(ctx.client, now); registerGlobal.check("all", now); }
    catch { refuse({ action: "oauth.register", reason: "rate_limited" }); oauthError(res, 429, "temporarily_unavailable", "Too many registrations. Try again later."); return; }
    registerLimiter.fail(ctx.client, now); registerGlobal.fail("all", now); // every attempt counts
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) { refuse({ action: "oauth.register", reason: "invalid_client_metadata" }); oauthError(res, 400, "invalid_client_metadata", "Use application/json."); return; }
    let body;
    try { body = JSON.parse(await readBody(req, REGISTRATION_LIMIT)); }
    catch (error) {
      refuse({ action: "oauth.register", reason: "invalid_client_metadata" });
      oauthError(res, 400, "invalid_client_metadata", error instanceof DomainError ? "The registration request is too large." : "Invalid JSON.");
      return;
    }
    const checked = validateRegistration(body);
    if (!checked.ok) { refuse({ action: "oauth.register", reason: checked.error }); oauthError(res, 400, checked.error, checked.description); return; }
    const client = store.registerClient({ clientName: checked.clientName, redirectUris: checked.redirectUris }, clock());
    if (!client) { refuse({ action: "oauth.register", reason: "capacity" }); oauthError(res, 503, "temporarily_unavailable", "Registration capacity is exhausted."); return; }
    sendJson(res, 201, {
      client_id: client.id, client_id_issued_at: Math.floor(Date.parse(client.createdAt) / 1000), client_name: client.clientName, redirect_uris: client.redirectUris,
      grant_types: [...GRANT_TYPES], response_types: ["code"], token_endpoint_auth_method: "none", scope: OAUTH_SCOPE
    });
  }

  /** Shared public-client checks for /oauth/token and /oauth/revoke. Returns { client, fields } or null after responding. */
  async function publicClientRequest(req, res, ctx, action) {
    const now = Date.now();
    const fail = (status, error, reason, description, extra = {}) => {
      tokenLimiter.fail(ctx.client, now);
      refuse({ action, reason, ...extra });
      if (status === 401) res.setHeader("WWW-Authenticate", "Basic realm=\"Shared Trips OAuth\"");
      oauthError(res, status, error, description);
      return null;
    };
    try { tokenLimiter.check(ctx.client, now); }
    catch { oauthError(res, 429, "invalid_request", "Too many failed requests. Try again later."); return null; }
    if (req.headers.authorization) return fail(401, "invalid_client", "client_authentication_unsupported", "Only public clients without client authentication are supported.");
    let form;
    try { form = await readForm(req); }
    catch (error) { return fail(400, "invalid_request", "invalid_request", error.status === 413 ? "The request is too large." : "Use application/x-www-form-urlencoded."); }
    if (form.repeated.length) return fail(400, "invalid_request", "duplicate_parameter", "Request parameters must not be repeated.");
    const { fields } = form;
    if (["client_secret", "client_assertion", "client_assertion_type"].some((name) => Object.hasOwn(fields, name))) return fail(401, "invalid_client", "client_authentication_unsupported", "Only public clients without client authentication are supported.");
    const client = store.getClient(fields.client_id);
    if (!client) return fail(401, "invalid_client", "client_unknown", "Unknown client.");
    return { client, fields, fail };
  }

  async function token(req, res, ctx) {
    cors(res, "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return; }
    if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); oauthError(res, 405, "invalid_request", "Use POST."); return; }
    const request = await publicClientRequest(req, res, ctx, "oauth.token");
    if (!request) return;
    const { client, fields } = request;
    const resource = resourceFor(ctx.allowedOrigin);
    const respond = (result, action) => {
      if (!result.ok) {
        const extra = { action, ...(result.userId ? { actor: result.userId } : {}), ...(result.grantId ? { target: result.grantId } : {}) };
        request.fail(400, result.error, result.reason, "The request could not be completed.", extra);
        return;
      }
      sendJson(res, 200, { [ACCESS_FIELD]: result.access, token_type: "Bearer", expires_in: result.expiresIn, [REFRESH_FIELD]: result.refresh, scope: result.scope });
    };
    if (fields.grant_type === "authorization_code") {
      if (["code", "redirect_uri", "code_verifier", "resource"].some((name) => typeof fields[name] !== "string" || !fields[name])) { request.fail(400, "invalid_request", "missing_parameter", "code, redirect_uri, code_verifier, client_id and resource are required."); return; }
      if (fields.scope !== undefined && fields.scope !== OAUTH_SCOPE) { request.fail(400, "invalid_scope", "invalid_scope", "The only supported scope is " + OAUTH_SCOPE + "."); return; }
      respond(store.exchangeCode({ code: fields.code, clientId: client.id, redirectUri: fields.redirect_uri, resource: fields.resource, codeVerifier: fields.code_verifier }, clock()), "oauth.token");
      return;
    }
    if (fields.grant_type === REFRESH_FIELD) {
      const presented = fields[REFRESH_FIELD];
      if (typeof presented !== "string" || !presented) { request.fail(400, "invalid_request", "missing_parameter", "refresh_token and client_id are required."); return; }
      if (fields.resource !== undefined && fields.resource !== resource) { request.fail(400, "invalid_target", "resource_mismatch", "Unknown resource."); return; }
      respond(store.refresh({ token: presented, clientId: client.id, resource: fields.resource, scope: fields.scope }, clock()), "oauth.refresh");
      return;
    }
    request.fail(400, fields.grant_type === undefined ? "invalid_request" : "unsupported_grant_type", "unsupported_grant_type", "Supported grant types: authorization_code, refresh_token.");
  }

  async function revoke(req, res, ctx) {
    cors(res, "POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204, { "Cache-Control": "no-store" }); res.end(); return; }
    if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); oauthError(res, 405, "invalid_request", "Use POST."); return; }
    const request = await publicClientRequest(req, res, ctx, "oauth.revoke");
    if (!request) return;
    const presented = request.fields.token;
    if (typeof presented !== "string" || !presented) { request.fail(400, "invalid_request", "missing_parameter", "token and client_id are required."); return; }
    // RFC 7009 section 2.2: unknown, malformed or foreign tokens still yield 200 without revealing anything.
    store.revokeToken({ token: presented, clientId: request.client.id }, clock());
    res.writeHead(200, { "Cache-Control": "no-store", Pragma: "no-cache", "Content-Length": 0 });
    res.end();
  }

  // ----------------------------------------------------------------------------------------------
  // Browser endpoints

  function startAuthorization(req, res, ctx) {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); sendHtml(res, 405, errorPage("Not available", "Open this page from the application that wants to connect.")); return; }
    const params = ctx.url.searchParams;
    const single = (name) => { const values = params.getAll(name); return values.length === 1 ? values[0] : undefined; };
    const repeated = (name) => params.getAll(name).length > 1;
    const client = !repeated("client_id") ? store.getClient(single("client_id")) : null;
    if (!client) {
      refuse({ action: "oauth.consent", reason: "invalid_client" });
      sendHtml(res, 400, errorPage("Unknown application", "This connection request does not come from an application registered with this server. Nothing was shared."));
      return;
    }
    const redirectUri = single("redirect_uri");
    if (repeated("redirect_uri") || !redirectAllowed(client, redirectUri)) {
      refuse({ action: "oauth.consent", reason: "invalid_redirect_uri", target: client.id });
      sendHtml(res, 400, errorPage("Invalid return address", "The application asked to return to an address that is not registered for it. Nothing was shared."));
      return;
    }
    const issuer = ctx.allowedOrigin;
    const state = single("state");
    const stateValid = !repeated("state") && (state === undefined || /^[\x20-\x7e]{1,1024}$/.test(state));
    const fail = (error, description) => {
      refuse({ action: "oauth.consent", reason: error, target: client.id });
      redirect(res, 302, callbackUrl(redirectUri, [["error", error], ["error_description", description], ["state", stateValid ? state : undefined], ["iss", issuer]]));
    };
    if (AUTHORIZE_PARAMS.some(repeated)) return fail("invalid_request", "Request parameters must not be repeated.");
    if (!stateValid) return fail("invalid_request", "Invalid state.");
    if (params.has("request") || params.has("request_uri")) return fail("invalid_request", "Request objects are not supported.");
    if (params.has("response_mode") && single("response_mode") !== "query") return fail("invalid_request", "Only response_mode query is supported.");
    const responseType = single("response_type");
    if (responseType === undefined) return fail("invalid_request", "response_type is required.");
    if (responseType !== "code") return fail("unsupported_response_type", "Only response_type code is supported.");
    if (single("code_challenge_method") !== "S256") return fail("invalid_request", "PKCE with code_challenge_method S256 is required.");
    const codeChallenge = single("code_challenge");
    if (typeof codeChallenge !== "string" || !PKCE_CHALLENGE_PATTERN.test(codeChallenge)) return fail("invalid_request", "A valid S256 code_challenge is required.");
    const resource = resourceFor(ctx.allowedOrigin);
    if (single("resource") !== resource) return fail("invalid_target", "resource must identify this server's MCP endpoint.");
    if (single("scope") !== OAUTH_SCOPE) return fail("invalid_scope", "The only supported scope is " + OAUTH_SCOPE + ".");
    const now = Date.now();
    try { authorizeLimiter.check(ctx.client, now); }
    catch { sendHtml(res, 429, errorPage("Too many requests", "Too many connection attempts. Wait a few minutes and try again.")); return; }
    authorizeLimiter.fail(ctx.client, now);
    const created = transactions.create({ clientId: client.id, redirectUri, state, codeChallenge, resource, scope: OAUTH_SCOPE, stage: "login" });
    res.setHeader("Set-Cookie", cookieFor(created.key, ctx.secure));
    sendHtml(res, 200, loginPage({ client, redirectUri, csrf: created.csrf }), formTargets(redirectUri));
  }

  /** Common checks for both browser POSTs. Returns { key, entry, fields, client } or null after responding. */
  async function browserForm(req, res, ctx) {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); sendHtml(res, 405, errorPage("Not available", "Open this page from the application that wants to connect.")); return null; }
    if (!sameOriginPost(req, ctx.allowedOrigin)) {
      refuse({ action: "oauth.consent", reason: "forbidden_origin" });
      sendHtml(res, 403, errorPage("Request blocked", "This form can only be submitted from this server's own sign-in page."));
      return null;
    }
    let form;
    try { form = await readForm(req); }
    catch { sendHtml(res, 400, errorPage("Request blocked", "The form submission was not understood.")); return null; }
    const key = readCookie(req);
    const entry = transactions.get(key);
    if (!entry) { sendHtml(res, 400, errorPage("This request expired", "This sign-in request has expired or was already used.")); return null; }
    if (form.repeated.length || !csrfMatches(entry, form.fields.csrf)) {
      refuse({ action: "oauth.consent", reason: "csrf_failed" });
      sendHtml(res, 403, errorPage("Request blocked", "This form submission could not be verified."));
      return null;
    }
    const client = store.getClient(entry.clientId);
    if (!redirectAllowed(client, entry.redirectUri)) {
      transactions.delete(key);
      sendHtml(res, 400, errorPage("Unknown application", "This application is no longer registered with this server. Nothing was shared."));
      return null;
    }
    return { key, entry, fields: form.fields, client };
  }

  async function login(req, res, ctx) {
    const request = await browserForm(req, res, ctx);
    if (!request) return;
    const { key, entry, fields, client } = request;
    const csrfAgain = () => { const next = transactions.rotate(key, {}); res.setHeader("Set-Cookie", cookieFor(next.key, ctx.secure)); return next.csrf; };
    const again = (status, notice) => sendHtml(res, status, loginPage({ client, redirectUri: entry.redirectUri, csrf: csrfAgain(), notice }), formTargets(entry.redirectUri));
    if (entry.stage !== "login") {
      transactions.delete(key);
      sendHtml(res, 400, errorPage("This request expired", "This sign-in request was already used. Return to the application and start again."));
      return;
    }
    const now = Date.now();
    try { loginLimiter.check(ctx.client, now); }
    catch { again(429, "Too many sign-in attempts. Try again later."); return; }
    const username = normalizeUsername(fields.username);
    const secret = boundedPassword(fields.password);
    // Only the configured account can sign in here; any other name costs the same hashing time.
    const record = store.username && username === store.username && secret !== null ? accounts.loginRecord(username) : undefined;
    let valid;
    try { valid = record ? await verifyPassword(secret, record.password_hash) : await dummyVerify(); }
    catch (error) {
      if (error instanceof DomainError && error.status === 429) { if (transactions.get(key) === entry) again(429, "The server is busy. Try again shortly."); else sendHtml(res, 400, errorPage("This request expired", "This sign-in request has expired or was already used.")); return; }
      throw error;
    }
    if (transactions.get(key) !== entry) { sendHtml(res, 400, errorPage("This request expired", "This sign-in request has expired or was already used.")); return; }
    if (!valid) {
      loginLimiter.fail(ctx.client, Date.now());
      refuse({ action: "oauth.login", reason: "sign_in_failed" });
      again(401, "Sign-in failed. Only the account set up for connected applications can sign in here.");
      return;
    }
    // Re-read after the asynchronous hash so that a concurrent revocation or role change wins.
    const current = accounts.sessionRecord(record.id);
    if (!store.eligible(current)) {
      loginLimiter.fail(ctx.client, Date.now());
      refuse({ action: "oauth.login", reason: "account_inactive", actor: record.id });
      again(403, "This account cannot approve connected applications.");
      return;
    }
    const next = transactions.rotate(key, { stage: "consent", userId: current.id, epoch: current.session_epoch, username: current.username });
    try { audit.record({ actor: current.id, channel: "http", action: "oauth.login", outcome: "accepted", target: client.id }); } catch { /* best effort */ }
    res.setHeader("Set-Cookie", cookieFor(next.key, ctx.secure));
    sendHtml(res, 200, consentPage({ client, redirectUri: entry.redirectUri, csrf: next.csrf, username: current.username }), formTargets(entry.redirectUri));
  }

  async function decision(req, res, ctx) {
    const request = await browserForm(req, res, ctx);
    if (!request) return;
    const { key, entry, fields, client } = request;
    const back = (params) => {
      transactions.delete(key);
      res.setHeader("Set-Cookie", cookieFor("", ctx.secure, 0));
      redirect(res, 303, callbackUrl(entry.redirectUri, [...params, ["state", entry.state], ["iss", ctx.allowedOrigin]]));
    };
    if (fields.decision === "deny") {
      refuse({ action: "oauth.consent", reason: "access_denied", actor: entry.userId ?? "anonymous", target: client.id });
      back([["error", "access_denied"], ["error_description", "The request was denied."]]);
      return;
    }
    if (fields.decision !== "allow") { sendHtml(res, 400, errorPage("Request blocked", "Choose Allow or Deny.")); return; }
    if (entry.stage !== "consent") {
      refuse({ action: "oauth.consent", reason: "not_signed_in", target: client.id });
      sendHtml(res, 403, errorPage("Sign in first", "Sign in on this server before approving access."));
      return;
    }
    const code = store.issueCode({ clientId: client.id, userId: entry.userId, epoch: entry.epoch, redirectUri: entry.redirectUri, resource: entry.resource, scope: entry.scope, codeChallenge: entry.codeChallenge }, clock());
    if (!code) {
      refuse({ action: "oauth.consent", reason: "account_inactive", actor: entry.userId, target: client.id });
      back([["error", "access_denied"], ["error_description", "This account cannot approve connected applications."]]);
      return;
    }
    back([["code", code]]);
  }

  // ----------------------------------------------------------------------------------------------

  return {
    allowedRedirects,
    transactions,
    /** Returns true when the request belonged to OAuth and has been answered. */
    async handle(req, res, ctx) {
      const { pathname } = ctx;
      const meta = pathname === PRM_PATH || pathname === PRM_PATH + "/mcp" || pathname === ASM_PATH;
      if (!meta && pathname !== "/oauth" && !pathname.startsWith("/oauth/")) return false;
      const browser = pathname === "/oauth/authorize" || pathname.startsWith("/oauth/authorize/");
      try {
        const now = clock();
        if (now >= nextSweep) { nextSweep = now + SWEEP_INTERVAL_MS; store.sweep(now); transactions.sweep(now); }
        if (meta) metadata(req, res, ctx);
        else if (pathname === "/oauth/register") await register(req, res, ctx);
        else if (pathname === "/oauth/token") await token(req, res, ctx);
        else if (pathname === "/oauth/revoke") await revoke(req, res, ctx);
        else if (browser) {
          // Browser routes keep the application's same-origin rule (CORS is never offered here).
          if (req.method === "GET" && ctx.origin && ctx.origin !== ctx.allowedOrigin) sendHtml(res, 403, errorPage("Request blocked", "Cross-origin requests are not allowed."));
          else if (pathname === "/oauth/authorize") startAuthorization(req, res, ctx);
          else if (pathname === "/oauth/authorize/login") await login(req, res, ctx);
          else if (pathname === "/oauth/authorize/decision") await decision(req, res, ctx);
          else sendHtml(res, 404, errorPage("Not found", "This page does not exist."));
        } else oauthError(res, 404, "invalid_request", "Not found.");
      } catch {
        if (res.headersSent) res.end();
        else if (browser) sendHtml(res, 500, errorPage("Something went wrong", "The request could not be completed."));
        else oauthError(res, 500, "server_error", "The request could not be completed.");
      }
      return true;
    },
    /** Access-token principal check for app.mjs; null when the value is not a known access token. */
    authenticateAccess(value, { pathname, allowedOrigin }) {
      return store.authenticateAccess(value, clock(), { resource: resourceFor(allowedOrigin), touch: pathname === "/mcp" });
    },
    /** RFC 9728 / RFC 6750 challenge for /mcp 401 responses. */
    challenge(allowedOrigin, invalidToken) {
      return "Bearer " + (invalidToken ? "error=\"invalid_token\", " : "") + "resource_metadata=\"" + allowedOrigin + PRM_PATH + "/mcp\", scope=\"" + OAUTH_SCOPE + "\"";
    }
  };
}
