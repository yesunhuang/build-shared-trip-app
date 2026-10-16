// Shared helpers for the self-hosted trip server.
// Protected trip data lives only in page memory: nothing here writes trip
// content to localStorage, sessionStorage, IndexedDB, Cache Storage or a
// BroadcastChannel. The admin token, account passwords and invitation codes are
// only sent in a POST body and are never stored by the browser code. A newly
// issued MCP access-token secret arrives once in a POST response; callers keep
// it in page memory only until the owner dismisses it, and nothing here
// stores, copies or transmits it anywhere else.
// Role/capability data from /api/session only adjusts the UI; the server
// enforces every permission independently.

export const TRIP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const LANGUAGE_STORAGE_KEY = "shared-trips-language";
export const DEFAULT_TIMEOUT_MS = 12000;
export const WRITE_TIMEOUT_MS = 20000;
const SIGNOUT_KEY = "shared-trips-signout-pending";
export function signoutPending() {
  try { return localStorage.getItem(SIGNOUT_KEY) === "1"; } catch { return false; }
}
export async function finishPendingLogout() {
  if (!signoutPending()) return;
  try { await hostedApi.logout(); }
  catch (error) { if (error.status !== 401) throw error; }
  localStorage.removeItem(SIGNOUT_KEY);
}

export class HostedRequestError extends Error {
  constructor(message, { status = 0, code = "", body = null } = {}) {
    super(message);
    this.name = "HostedRequestError";
    this.status = status;
    this.code = code;
    this.body = body;
  }

  get isNetwork() { return this.status === 0; }
  get isUnauthorized() { return this.status === 401; }
  get isNotFound() { return this.status === 404; }
  get isConflict() { return this.status === 409; }
}

export function isHostedPage() {
  return typeof window !== "undefined" && window.SHARED_TRIP_HOSTED === true;
}

export function newRequestId(prefix = "web") {
  const random = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

export function isValidTripId(value) {
  return typeof value === "string" && TRIP_ID_PATTERN.test(value);
}

// Parse exactly /trips/<id> or /trips/<id>/ — never guess a different trip.
export function tripIdFromPath(pathname = location.pathname) {
  const match = /^\/trips\/([^/]+)\/?$/.exec(String(pathname || ""));
  if (!match) return "";
  let decoded = "";
  try {
    decoded = decodeURIComponent(match[1]);
  } catch {
    return "";
  }
  return isValidTripId(decoded) ? decoded : "";
}

export function tripIdFromQuery(search = location.search) {
  let value = "";
  try {
    const params = new URLSearchParams(search);
    const all = params.getAll("tripId");
    if (all.length !== 1) return "";
    value = all[0];
  } catch {
    return "";
  }
  return isValidTripId(value) ? value : "";
}

export function tripPath(tripId) {
  return `/trips/${encodeURIComponent(tripId)}`;
}

export function resourcesPath(tripId) {
  return `/resources.html?tripId=${encodeURIComponent(tripId)}`;
}

// Only same-origin trip or resource paths are accepted as post-login targets.
export function safeNextPath(value) {
  const raw = String(value || "");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "";
  let url;
  try {
    url = new URL(raw, location.origin);
  } catch {
    return "";
  }
  if (url.origin !== location.origin) return "";
  if (tripIdFromPath(url.pathname)) {
    const params = new URLSearchParams();
    const day = url.searchParams.get("day");
    const view = url.searchParams.get("view");
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) params.set("day", day);
    if (view === "plan") params.set("view", "plan");
    const query = params.toString();
    return `${tripPath(tripIdFromPath(url.pathname))}${query ? `?${query}` : ""}`;
  }
  if (url.pathname === "/resources.html" && tripIdFromQuery(url.search)) {
    return resourcesPath(tripIdFromQuery(url.search));
  }
  return "";
}

export function loginUrl(next = `${location.pathname}${location.search}`) {
  const safe = safeNextPath(next);
  return safe ? `/login?next=${encodeURIComponent(safe)}` : "/login";
}

export async function requestJSON(path, { method = "GET", body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (signoutPending() && !["/api/logout", "/api/login", "/api/accept-invite"].includes(path)) {
    throw new HostedRequestError("Sign in required", { status: 401, code: "signout_pending" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    clearTimeout(timer);
    throw new HostedRequestError(timedOut ? "Request timed out" : "Network unavailable", {
      status: 0,
      code: timedOut ? "timeout" : "network"
    });
  }

  let payload = null;
  const text = await response.text().catch(() => "");
  clearTimeout(timer);
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const errorInfo = payload?.error && typeof payload.error === "object" ? payload.error : payload;
    throw new HostedRequestError(String(errorInfo?.message || `Request failed (${response.status})`).slice(0, 300), {
      status: response.status,
      code: String(errorInfo?.code || "").slice(0, 80),
      body: payload
    });
  }
  return payload;
}

async function accountLogin(username, password) {
  const result = await requestJSON("/api/login", { method: "POST", body: { username, password }, timeoutMs: WRITE_TIMEOUT_MS });
  try { localStorage.removeItem(SIGNOUT_KEY); } catch {}
  return result;
}

export const ACCOUNT_ROLES = Object.freeze(["viewer", "content-manager"]);

export const hostedApi = Object.freeze({
  session: () => requestJSON("/api/session", { timeoutMs: 8000 }),
  login: async (token) => {
    const result = await requestJSON("/api/login", { method: "POST", body: { token }, timeoutMs: WRITE_TIMEOUT_MS });
    try { localStorage.removeItem(SIGNOUT_KEY); } catch {}
    return result;
  },
  // Username/password sign-in for any approved account (viewer or content manager).
  loginAccount: (username, password) => accountLogin(username, password),
  // Deprecated alias kept for compatibility with older callers.
  loginViewer: (username, password) => accountLogin(username, password),
  acceptInvitation: (invitation, username, password) => requestJSON("/api/accept-invite", {
    method: "POST",
    body: { invitation, username, password },
    timeoutMs: WRITE_TIMEOUT_MS
  }),
  listAccounts: () => requestJSON("/api/users"),
  createInvitation: (expiresInHours = 72) => requestJSON("/api/invitations", { method: "POST", body: { expiresInHours } }),
  approveAccount: (accountId) => requestJSON(`/api/users/${encodeURIComponent(accountId)}/approve`, { method: "POST", body: {} }),
  revokeAccount: (accountId) => requestJSON(`/api/users/${encodeURIComponent(accountId)}/revoke`, { method: "POST", body: {} }),
  // Owner only. Changing a role signs that account out and invalidates its MCP access tokens.
  setAccountRole: (accountId, role) => requestJSON(`/api/users/${encodeURIComponent(accountId)}/role`, {
    method: "POST",
    body: { role },
    timeoutMs: WRITE_TIMEOUT_MS
  }),
  // Owner only. Metadata only; secrets are never listed.
  listMcpTokens: (accountId) => requestJSON(`/api/users/${encodeURIComponent(accountId)}/mcp-tokens`),
  // Owner only, approved content managers only. Returns {token, secret} exactly once.
  // Deliberately single-shot: a failed issuance is reported, never retried automatically.
  issueMcpToken: (accountId, label) => requestJSON(`/api/users/${encodeURIComponent(accountId)}/mcp-tokens`, {
    method: "POST",
    body: { label },
    timeoutMs: WRITE_TIMEOUT_MS
  }),
  revokeMcpToken: (accountId, tokenId) => requestJSON(
    `/api/users/${encodeURIComponent(accountId)}/mcp-tokens/${encodeURIComponent(tokenId)}/revoke`,
    { method: "POST", body: {}, timeoutMs: WRITE_TIMEOUT_MS }
  ),
  // Owner only. Browser (OAuth) connections for an account: {grants:[metadata]}.
  // No credential is returned; the home page keeps only its display-field whitelist.
  listOAuthGrants: (accountId) => requestJSON(`/api/users/${encodeURIComponent(accountId)}/oauth-grants`),
  // Owner only. Returns {grant}. Single-shot: a failed revocation is reported, never retried automatically.
  revokeOAuthGrant: (accountId, grantId) => requestJSON(
    `/api/users/${encodeURIComponent(accountId)}/oauth-grants/${encodeURIComponent(grantId)}/revoke`,
    { method: "POST", body: {}, timeoutMs: WRITE_TIMEOUT_MS }
  ),
  logout: () => requestJSON("/api/logout", { method: "POST", body: {}, timeoutMs: 8000 }),
  listTrips: () => requestJSON("/api/trips"),
  getTrip: (tripId) => requestJSON(`/api/trips/${encodeURIComponent(tripId)}`),
  createTrip: (trip, requestId = newRequestId("create")) => requestJSON("/api/trips", {
    method: "POST",
    body: { requestId, trip },
    timeoutMs: WRITE_TIMEOUT_MS
  }),
  applyChanges: (tripId, expectedVersion, changes, requestId = newRequestId("change")) => requestJSON(
    `/api/trips/${encodeURIComponent(tripId)}/changes`,
    { method: "POST", body: { requestId, expectedVersion, changes }, timeoutMs: WRITE_TIMEOUT_MS }
  ),
  importTrip: (data, requestId = newRequestId("import")) => requestJSON("/api/import", {
    method: "POST",
    body: { requestId, data },
    timeoutMs: WRITE_TIMEOUT_MS
  }),
  exportTrip: (tripId) => requestJSON(`/api/trips/${encodeURIComponent(tripId)}/export`, { timeoutMs: WRITE_TIMEOUT_MS }),
  // Owner/content manager only, and only from an explicit Search or Refresh action in
  // the plan editor. The body carries just the typed public name. Returns {results, cached}.
  searchPlaces: (tripId, query, refresh = false) => requestJSON(
    `/api/trips/${encodeURIComponent(tripId)}/places/search`,
    { method: "POST", body: refresh === true ? { query, refresh: true } : { query }, timeoutMs: WRITE_TIMEOUT_MS }
  ),
  searchPhotos: (tripId, query, refresh = false) => requestJSON(
    `/api/trips/${encodeURIComponent(tripId)}/photos/search`,
    { method: "POST", body: refresh === true ? { query, refresh: true } : { query }, timeoutMs: WRITE_TIMEOUT_MS }
  ),
  // Optional Google Places UI Kit browser configuration ({enabled:false} or {enabled:true, apiKey,
  // libraries}). Called only when the session advertises the feature and a plan actually needs a
  // Google component; the response is kept in page memory only and never stored.
  googlePlacesConfig: () => requestJSON("/api/google-places/config", { timeoutMs: 8000 })
});

// The session lists the optional Google Places UI Kit only when the operator enabled it.
export function sessionHasGooglePlaces(session) { return session?.features?.googlePlacesUiKit === true; }

// Extracts and verifies a trip from a {trip} response. A response for any other
// trip id is rejected rather than displayed.
export function expectTrip(payload, tripId) {
  const trip = payload?.trip;
  if (!trip || typeof trip !== "object" || Array.isArray(trip)) {
    throw new HostedRequestError("Unexpected server response", { status: 500, code: "bad_response" });
  }
  if (tripId && trip.id !== tripId) {
    throw new HostedRequestError("Unexpected trip in server response", { status: 500, code: "trip_mismatch" });
  }
  return trip;
}

export function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function isValidTimeZone(value) {
  if (!value || typeof value !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function tripDateBounds(trip = {}) {
  const dates = (Array.isArray(trip.days) ? trip.days : [])
    .map((day) => day?.date)
    .filter(isISODate)
    .sort();
  const range = trip.dateRange;
  const rangeStart = typeof range === "object" && range ? (range.start || range.startDate || range.from) : "";
  const rangeEnd = typeof range === "object" && range ? (range.end || range.endDate || range.to) : "";
  const start = dates[0] || (isISODate(rangeStart) ? rangeStart : "") || (isISODate(trip.startDate) ? trip.startDate : "");
  const end = dates.at(-1) || (isISODate(rangeEnd) ? rangeEnd : "") || (isISODate(trip.endDate) ? trip.endDate : "") || start;
  return { start, end };
}

// Builds the render/seed form expected by the existing travel UI from the
// canonical server trip. The canonical object itself is never mutated.
export function toRenderTrip(canonicalTrip) {
  const trip = typeof structuredClone === "function"
    ? structuredClone(canonicalTrip)
    : JSON.parse(JSON.stringify(canonicalTrip));
  const { start, end } = tripDateBounds(trip);
  trip.slug = `trip-${trip.id}`;
  trip.title = String(trip.title || "").trim() || "Shared Trips";
  trip.timezone = isValidTimeZone(trip.timezone) ? trip.timezone : "UTC";
  if (start) trip.startDate = start;
  if (end) trip.endDate = end;
  if (!trip.routeDecoration && typeof trip.route === "string") trip.routeDecoration = trip.route;
  trip.days = (Array.isArray(trip.days) ? trip.days : []).map((day) => {
    if (!day || typeof day !== "object") return day;
    if (!Array.isArray(day.slots) && Array.isArray(day.plans)) day.slots = day.plans;
    if (!day.theme && typeof day.label === "string" && day.label.trim()) day.theme = day.label;
    if (day.i18n && typeof day.i18n === "object") {
      Object.values(day.i18n).forEach((patch) => {
        if (patch && typeof patch === "object" && !patch.theme && typeof patch.label === "string") patch.theme = patch.label;
      });
    }
    return day;
  });
  trip.reminders = Array.isArray(trip.reminders) ? trip.reminders : [];
  trip.participantGroups = Array.isArray(trip.participantGroups) ? trip.participantGroups : [];
  trip.tips = Array.isArray(trip.tips) ? trip.tips : [];
  return trip;
}

export function scriptSafeJSON(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// In-memory hand-off from the bootstrap module to app.js (same module instance).
let bootTrip = null;
let bootSession = null;
export function setBootTrip(trip) { bootTrip = trip || null; }
export function getBootTrip() { return bootTrip; }
export function setBootSession(session) { bootSession = session && typeof session === "object" ? session : null; }
export function getBootSession() { return bootSession; }
// Fail closed: anything other than an explicit server capability is read-only.
export function sessionCanEdit(session) { return session?.capabilities?.editTrips === true; }
export function sessionCanManageAccounts(session) { return session?.capabilities?.manageAccounts === true; }
export function sessionCanImport(session) { return session?.capabilities?.importTrips === true; }

const PROTECTED_STORAGE_PREFIXES = ["trip-", "shared-trip-"];

export async function clearProtectedBrowserState() {
  bootTrip = null;
  bootSession = null;
  const seed = document.getElementById("trip-data");
  if (seed) seed.textContent = "";
  try { sessionStorage.clear(); } catch { /* storage may be unavailable */ }
  try {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key !== LANGUAGE_STORAGE_KEY && PROTECTED_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage may be unavailable */ }
  // The self-hosted worker never stores protected responses; remove any that a
  // previous build might have stored, defensively.
  try {
    if ("caches" in window) {
      const names = await caches.keys();
      await Promise.all(names.map(async (name) => {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        await Promise.all(requests.map((request) => {
          const { pathname } = new URL(request.url);
          return /^\/(?:api|mcp|trips|photos|attachments)(?:\/|$)|^\/resources\.html$|^\/login$/.test(pathname)
            ? cache.delete(request)
            : null;
        }));
      }));
    }
  } catch { /* Cache Storage may be unavailable */ }
}

export function redirectToLogin(next) {
  const target = loginUrl(next);
  clearProtectedBrowserState().finally(() => location.replace(target));
  // Also clear visible content immediately, before the async cleanup finishes.
  document.body.replaceChildren();
}

export async function logoutAndLeave() {
  document.body.replaceChildren();
  let durable = false;
  try { localStorage.setItem(SIGNOUT_KEY, "1"); durable = signoutPending(); } catch {}
  try {
    await hostedApi.logout();
    try { localStorage.removeItem(SIGNOUT_KEY); } catch {}
  } catch (error) {
    if (error.status !== 401 && !durable) {
      document.body.replaceChildren();
      const retry = document.createElement("button");
      retry.textContent = "Sign-out failed. Retry";
      retry.addEventListener("click", logoutAndLeave);
      document.body.append(retry);
      await clearProtectedBrowserState();
      return;
    }
  }
  await clearProtectedBrowserState();
  location.replace("/");
}
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === SIGNOUT_KEY && event.newValue === "1") redirectToLogin();
  });
}

// Bounded polling with backoff. Pauses while hidden or offline and resumes on
// visibility, focus, the online event or an explicit retry.
export function createTripPoller({
  load,
  onData,
  onError,
  onExhausted,
  intervalMs = 20000,
  firstRetryMs = 4000,
  maxBackoffMs = 60000,
  maxFailures = 6
}) {
  let timer = null;
  let running = false;
  let inFlight = null;
  let failures = 0;
  let stopped = true;

  function clear() {
    clearTimeout(timer);
    timer = null;
  }

  function schedule(delay) {
    clear();
    if (stopped) return;
    timer = setTimeout(tick, delay);
  }

  async function tick() {
    clear();
    if (stopped || inFlight) return inFlight;
    if (document.visibilityState === "hidden" || navigator.onLine === false) return null;
    running = true;
    inFlight = (async () => {
      try {
        const data = await load();
        failures = 0;
        onData?.(data);
        schedule(intervalMs);
      } catch (error) {
        if (error?.status === 401 || error?.status === 404 || error?.status === 403) {
          stopped = true;
          onError?.(error, { final: true });
          return;
        }
        failures += 1;
        onError?.(error, { final: false, failures });
        if (failures >= maxFailures) {
          onExhausted?.(error);
          return;
        }
        schedule(Math.min(maxBackoffMs, firstRetryMs * (2 ** (failures - 1))));
      } finally {
        running = false;
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function resume() {
    if (stopped) return null;
    failures = 0;
    return tick();
  }

  const onVisibility = () => { if (document.visibilityState === "visible") resume(); };
  const onOnline = () => resume();
  const onFocus = () => { if (!timer && !running) resume(); };

  return {
    start({ immediate = false } = {}) {
      if (!stopped) return;
      stopped = false;
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", onOnline);
      window.addEventListener("focus", onFocus);
      if (immediate) tick();
      else schedule(intervalMs);
    },
    stop() {
      stopped = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onFocus);
    },
    retryNow() {
      failures = 0;
      return tick();
    },
    get failures() { return failures; }
  };
}

export function downloadJSON(value, filename) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(trip = {}, tripId = "") {
  const base = String(trip.title || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 60);
  return `${base || "trip"}-${tripId || trip.id || "export"}.json`;
}
