// Opt-in public place and photo lookups for trip editors.
//
// Disabled unless the operator sets SHARED_TRIP_LOOKUPS_ENABLED=1 together with an identifying
// SHARED_TRIP_LOOKUP_USER_AGENT (application/version plus the operator's own contact URL or email,
// never invented here). Only the two HTTP routes
//   POST /api/trips/<id>/places/search  and  POST /api/trips/<id>/photos/search
// call this module, each for one explicitly submitted public-place query. Nothing here runs on trip
// reads, lists, exports, saves, imports, polling or MCP; there is no autocomplete, bulk or background
// lookup. A chosen result is saved separately (plan.place / plan.photo through applyTripChanges);
// this cache is not trip content and not a backup.
//
// Providers:
//   places: Nominatim-compatible search (default https://nominatim.openstreetmap.org/search, or the
//           operator's SHARED_TRIP_NOMINATIM_URL), GET format=jsonv2&limit=5&addressdetails=1.
//           Results carry OpenStreetMap ODbL attribution.
//   photos: the fixed Wikimedia Commons API, File namespace search with imageinfo. Only raster
//           thumbnails on thumb.wikimedia.org or upload.wikimedia.org with a complete author and an allowlisted CC0 /
//           CC BY / CC BY-SA license are returned, as plain text. Results are candidates for the
//           editor to choose from; nothing claims a photo matches a place.
//
// Public-service etiquette: one upstream request in flight at a time and at least
// MIN_START_INTERVAL_MS between request starts across both providers, a short bounded queue (busy
// otherwise), a per-account request cap, no redirects, an abort timeout, a streamed size limit, and
// a persistent bounded cache keyed by a digest of the normalized query (query text is not stored).
// Identical queries are answered from the cache, also after a restart; refresh:true bypasses it.
// A failed lookup never replaces a cached entry and never touches a trip.
//
// Code-only test hooks (never read from the environment): fetch, clock, sleep and a shorter
// timeoutMs. Production defaults are unchanged by them.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DomainError, validationError } from "./domain/errors.mjs";
import {
  COMMONS_LICENSES, COMMONS_PROVIDER, Issues, OSM_ATTRIBUTION, OSM_LICENSE, OSM_PROVIDER,
  canonicalCommonsLicense, isPlainObject, normalizeCommonsPhoto, normalizeSelectedPlace
} from "./domain/validate.mjs";

export const DEFAULT_NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
export const COMMONS_API_URL = "https://commons.wikimedia.org/w/api.php";
export const MIN_START_INTERVAL_MS = 1100;
export const LOOKUP_TIMEOUT_MS = 8000;
export const MAX_QUEUED_LOOKUPS = 2; // waiting behind the single in-flight request
export const MAX_QUEUE_WAIT_MS = 5000;
export const ACCOUNT_LOOKUP_LIMIT = 30;
export const ACCOUNT_LOOKUP_WINDOW_MS = 10 * 60_000;
export const MAX_LOOKUP_RESULTS = 5;
export const MAX_CACHE_ENTRIES = 500;
export const LOOKUP_CACHE_FILE = "lookup-cache.json";
const CACHE_FORMAT = "shared-trip-lookup-cache";
// UTF-8 byte cap for the cache file, enforced both when writing (oldest entries are evicted until
// the document fits) and when reading (a larger file is ignored).
export const MAX_CACHE_FILE_BYTES = 8 * 1024 * 1024;
const CACHE_DOCUMENT_HEAD = `{"format":${JSON.stringify(CACHE_FORMAT)},"version":1,"entries":[`;
const CACHE_DOCUMENT_TAIL = "]}";
const MAX_RESPONSE_BYTES = Object.freeze({ place: 256 * 1024, photo: 512 * 1024 });
const RASTER_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const KINDS = new Set(["place", "photo"]);
// Placeholder used only while validating provider candidates; replaced on every response.
const VALIDATION_TIME = "2000-01-01T00:00:00.000Z";
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_GLOBAL = /[\u0000-\u001F\u007F]+/g;

// ---------------------------------------------------------------------------------------------
// Configuration

const USER_AGENT_SHAPE = /^[\x21-\x7e][\x20-\x7e]{8,298}[\x21-\x7e]$/;
const USER_AGENT_PRODUCT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[0-9][A-Za-z0-9.+-]{0,31}(?:\s|$)/;
const USER_AGENT_CONTACT = /(?:https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s();]*|(?:mailto:)?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/;

/** Throws unless value is "<app>/<version> ... <contact URL or email> ..." in printable ASCII. */
export function checkLookupUserAgent(value) {
  if (typeof value !== "string" || !USER_AGENT_SHAPE.test(value) || !USER_AGENT_PRODUCT.test(value) || !USER_AGENT_CONTACT.test(value)) {
    throw new Error("SHARED_TRIP_LOOKUP_USER_AGENT must identify this application and version (for example shared-trip-app/1.0) followed by your own contact HTTPS URL or email address, in 10-300 printable ASCII characters.");
  }
  return value;
}

/** Throws unless value is an HTTPS search endpoint without credentials, port oddities, query or fragment. */
export function checkNominatimUrl(value) {
  let parsed;
  try { parsed = new URL(value); } catch { parsed = null; }
  if (!parsed || typeof value !== "string" || value.length > 500 || parsed.protocol !== "https:" || parsed.username || parsed.password ||
    parsed.search || parsed.hash || value.includes("?") || value.includes("#") || /[\s\\]/.test(value)) {
    throw new Error("SHARED_TRIP_NOMINATIM_URL must be an HTTPS search endpoint without credentials, query or fragment.");
  }
  return parsed.href;
}

/** Reads the opt-in lookup settings. Everything stays disabled unless SHARED_TRIP_LOOKUPS_ENABLED=1. */
export function readLookupConfig(env = process.env) {
  const flag = env.SHARED_TRIP_LOOKUPS_ENABLED;
  if (flag !== undefined && flag !== "" && flag !== "0" && flag !== "1") throw new Error("SHARED_TRIP_LOOKUPS_ENABLED must be 1 to opt in, or 0 / unset.");
  const custom = env.SHARED_TRIP_NOMINATIM_URL !== undefined && env.SHARED_TRIP_NOMINATIM_URL !== "" ? checkNominatimUrl(env.SHARED_TRIP_NOMINATIM_URL) : "";
  if (flag !== "1") return { enabled: false };
  return { enabled: true, userAgent: checkLookupUserAgent(env.SHARED_TRIP_LOOKUP_USER_AGENT), nominatimUrl: custom || DEFAULT_NOMINATIM_URL };
}

// ---------------------------------------------------------------------------------------------
// Errors

const disabled = () => new DomainError("lookup_disabled", 503, "Place and photo lookups are not enabled on this server.");
const busy = () => new DomainError("lookup_busy", 503, "The lookup service is busy. Try again in a moment.");
const unavailable = () => new DomainError("lookup_unavailable", 502, "The lookup provider is unavailable. Try again later.");
const malformed = () => new DomainError("lookup_malformed", 502, "The lookup provider returned an unusable response.");
const timedOut = () => new DomainError("lookup_timeout", 504, "The lookup provider did not respond in time.");
const accountLimited = () => new DomainError("rate_limited", 429, "Too many lookups from this account. Try again later.");

// ---------------------------------------------------------------------------------------------
// Request body

/** { query: string, refresh?: boolean } -> { query, refresh }. */
export function parseLookupBody(body) {
  if (!isPlainObject(body)) throw validationError("The request body must be a JSON object.");
  const unknown = Object.keys(body).filter((key) => key !== "query" && key !== "refresh");
  if (unknown.length) throw validationError(unknown.slice(0, 10).map((key) => ({ path: `body.${key}`, message: "field is not allowed" })));
  if (typeof body.query !== "string") throw validationError([{ path: "body.query", message: "must be a string" }]);
  if (CONTROL.test(body.query)) throw validationError([{ path: "body.query", message: "contains control characters" }]);
  const query = body.query.normalize("NFC").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 200) throw validationError([{ path: "body.query", message: "must be 2-200 characters" }]);
  // Public place names and addresses only: refuse obvious personal data (email addresses, long
  // digit runs such as phone, booking or card numbers) before anything leaves the server.
  if (query.includes("@") || /\d{8,}/.test(query.replace(/[\s().+-]/g, ""))) {
    throw validationError([{ path: "body.query", message: "search for a public place name or address only" }]);
  }
  if (body.refresh !== undefined && typeof body.refresh !== "boolean") throw validationError([{ path: "body.refresh", message: "must be true or false" }]);
  return { query, refresh: body.refresh === true };
}

// ---------------------------------------------------------------------------------------------
// Text helpers

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  const text = value.replace(CONTROL_GLOBAL, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? "" : text;
}

const ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " });
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : " ";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Provider HTML (for example a Commons Artist field) to plain text; "" when unusable or still markup-like. */
export function htmlToText(value, max) {
  if (typeof value !== "string" || value.length > 20_000) return "";
  const stripped = value.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ").replace(/<[^>]*>/g, " ");
  const text = decodeEntities(stripped).replace(CONTROL_GLOBAL, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max || /[<>]/.test(text)) return "";
  return text;
}

// ---------------------------------------------------------------------------------------------
// Provider adapters (pure; exported for focused tests)

const OSM_TYPES = Object.freeze({ node: "node", way: "way", relation: "relation", N: "node", W: "way", R: "relation" });
const COORDINATE = /^[+-]?\d{1,3}(?:\.\d{1,12})?$/;

function coordinate(value) {
  if (typeof value === "number") return value;
  return typeof value === "string" && COORDINATE.test(value) ? Number(value) : NaN;
}

function strip(result) {
  const { selectedAt, ...rest } = result;
  return rest;
}

function placeFromNominatim(item) {
  if (!isPlainObject(item)) return null;
  const type = OSM_TYPES[item.osm_type];
  const rawId = item.osm_id;
  const osmId = typeof rawId === "number" ? rawId : typeof rawId === "string" && /^\d{1,16}$/.test(rawId) ? Number(rawId) : NaN;
  if (!type || !Number.isSafeInteger(osmId) || osmId < 1) return null;
  let address = typeof item.display_name === "string" ? item.display_name.replace(CONTROL_GLOBAL, " ").replace(/\s+/g, " ").trim() : "";
  if (address.length > 500) address = address.slice(0, 499).trimEnd() + "…";
  const name = cleanText(item.name, 200) || cleanText(address.split(",")[0], 200);
  const id = `${type}/${osmId}`;
  const candidate = {
    provider: OSM_PROVIDER, id, name, address, lat: coordinate(item.lat), lng: coordinate(item.lon),
    sourceUrl: `https://www.openstreetmap.org/${id}`, attribution: OSM_ATTRIBUTION, license: OSM_LICENSE, selectedAt: VALIDATION_TIME
  };
  const place = normalizeSelectedPlace(candidate, "result", new Issues());
  return place ? strip(place) : null;
}

/** Nominatim jsonv2 array -> up to five validated place results (without selectedAt). */
export function parseNominatimResults(json) {
  if (!Array.isArray(json) || json.length > 50) throw malformed();
  const out = [];
  const seen = new Set();
  for (const item of json) {
    const place = placeFromNominatim(item);
    if (!place || seen.has(place.id)) continue;
    seen.add(place.id);
    out.push(place);
    if (out.length >= MAX_LOOKUP_RESULTS) break;
  }
  return out;
}

function canonicalUrl(value) {
  if (typeof value !== "string" || value.length > 1000) return "";
  try {
    const url = new URL(value);
    // Current imageinfo responses attach analytics to stable public image URLs.
    // Strip only these known fields; all other query strings still fail strict validation.
    for (const key of ["utm_source", "utm_campaign", "utm_content"]) url.searchParams.delete(key);
    return url.href;
  } catch { return ""; }
}

/** Provider license URL -> the canonical URL for license, or "" when it names anything else. */
function canonicalLicenseUrl(license, value) {
  const canonical = COMMONS_LICENSES[license];
  if (!canonical || typeof value !== "string" || value.length > 300) return "";
  let parsed;
  try { parsed = new URL(value.trim()); } catch { return ""; }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.hostname !== "creativecommons.org" || parsed.port ||
    parsed.username || parsed.password || parsed.search || parsed.hash) return "";
  const base = new URL(canonical).pathname;
  const rest = parsed.pathname.startsWith(base) ? parsed.pathname.slice(base.length) : parsed.pathname + "/" === base ? "" : null;
  if (rest === null || !/^(?:deed\.[a-z]{2,3}(?:[-_][A-Za-z]{2,4})?|legalcode(?:\.[a-z]{2,3})?)?$/.test(rest)) return "";
  return canonical;
}

function photoFromCommons(page) {
  if (!isPlainObject(page) || page.ns !== 6 || typeof page.title !== "string" || !page.title.startsWith("File:")) return null;
  const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
  if (!isPlainObject(info) || !RASTER_MIME.has(info.mime)) return null;
  const meta = isPlainObject(info.extmetadata) ? info.extmetadata : {};
  const field = (name) => (isPlainObject(meta[name]) && typeof meta[name].value === "string" ? meta[name].value : "");
  const author = htmlToText(field("Artist"), 300);
  const license = canonicalCommonsLicense(htmlToText(field("LicenseShortName"), 60));
  const licenseUrl = canonicalLicenseUrl(license, htmlToText(field("LicenseUrl"), 300));
  if (!author || !license || !licenseUrl) return null;
  const candidate = {
    provider: COMMONS_PROVIDER, url: canonicalUrl(info.thumburl), sourceUrl: canonicalUrl(info.descriptionurl),
    credit: `${author} · ${license} · Wikimedia Commons`, author, license, licenseUrl, selectedAt: VALIDATION_TIME
  };
  const photo = normalizeCommonsPhoto(candidate, "result", new Issues());
  return photo ? strip(photo) : null;
}

/** Commons formatversion=2 query response -> up to five validated photo results (without selectedAt). */
export function parseCommonsResults(json) {
  if (!isPlainObject(json)) throw malformed();
  if (json.error !== undefined) throw unavailable(); // includes maxlag: the wiki asked clients to back off
  if (json.query === undefined) return []; // a legitimate search without matches has no query block
  if (!isPlainObject(json.query)) throw malformed();
  const pages = json.query.pages;
  if (pages === undefined) return [];
  if (!Array.isArray(pages) || pages.length > 50) throw malformed();
  const ordered = pages.map((page, position) => ({ page, rank: Number.isInteger(page?.index) ? page.index : 1e6 + position }))
    .sort((a, b) => a.rank - b.rank).map(({ page }) => page);
  const out = [];
  const seen = new Set();
  for (const page of ordered) {
    const photo = photoFromCommons(page);
    if (!photo || seen.has(photo.sourceUrl)) continue;
    seen.add(photo.sourceUrl);
    out.push(photo);
    if (out.length >= MAX_LOOKUP_RESULTS) break;
  }
  return out;
}

function revalidate(kind, result) {
  if (!isPlainObject(result) || Object.hasOwn(result, "selectedAt")) return null;
  const candidate = { ...result, selectedAt: VALIDATION_TIME };
  const checked = kind === "place" ? normalizeSelectedPlace(candidate, "cache", new Issues())
    : isPlainObject(candidate) && candidate.provider === COMMONS_PROVIDER ? normalizeCommonsPhoto(candidate, "cache", new Issues()) : undefined;
  return checked ? strip(checked) : null;
}

// ---------------------------------------------------------------------------------------------
// Bounded streamed response reading

async function readBounded(response, limit) {
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && declared !== "" && !(Number(declared) <= limit)) throw malformed();
  const body = response.body;
  if (!body || typeof body.getReader !== "function") throw malformed();
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw malformed();
      size += value.byteLength;
      if (size > limit) throw malformed();
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
  catch { throw malformed(); }
}

// ---------------------------------------------------------------------------------------------
// Persistent cache (<dataDir>/lookup-cache.json, private, outside the checkout)

function loadCache(file) {
  const entries = new Map();
  let document;
  try {
    if (fs.statSync(file).size > MAX_CACHE_FILE_BYTES) return entries;
    document = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return entries; } // missing or unreadable: start empty (the cache is not trip content)
  if (!isPlainObject(document) || document.format !== CACHE_FORMAT || document.version !== 1 || !Array.isArray(document.entries)) return entries;
  for (const entry of document.entries.slice(-MAX_CACHE_ENTRIES)) {
    if (!isPlainObject(entry) || typeof entry.key !== "string" || !/^(place|photo):[0-9a-f]{64}$/.test(entry.key) ||
      !Array.isArray(entry.results) || entry.results.length > MAX_LOOKUP_RESULTS || !Number.isFinite(entry.storedAt)) continue;
    const kind = entry.key.slice(0, 5);
    const results = entry.results.map((result) => revalidate(kind, result));
    if (results.some((result) => !result)) continue;
    entries.set(entry.key, { results, storedAt: entry.storedAt });
  }
  return entries;
}

// ---------------------------------------------------------------------------------------------
// Service

export class LookupService {
  /**
   * options: { enabled, userAgent, nominatimUrl } (from readLookupConfig) plus dataDir and the
   * code-only hooks fetch, clock, sleep and timeoutMs.
   */
  constructor({ enabled = false, userAgent = "", nominatimUrl = "", dataDir, fetch: fetchImpl, clock, sleep, timeoutMs } = {}) {
    this.enabled = enabled === true;
    this.clock = typeof clock === "function" ? clock : Date.now;
    this.sleep = typeof sleep === "function" ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    this.timeoutMs = Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= LOOKUP_TIMEOUT_MS ? timeoutMs : LOOKUP_TIMEOUT_MS;
    this.cache = new Map();
    this.serialized = new WeakMap();
    this.accounts = new Map();
    this.inflight = new Map();
    this.gate = { tail: Promise.resolve(), pending: 0, lastStart: Number.NEGATIVE_INFINITY };
    this.upstreamRequests = 0;
    if (!this.enabled) return;
    this.userAgent = checkLookupUserAgent(userAgent);
    this.nominatimUrl = checkNominatimUrl(nominatimUrl || DEFAULT_NOMINATIM_URL);
    if (typeof dataDir !== "string" || !dataDir) throw new Error("Lookups need the data directory for their cache.");
    this.fetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
    this.cachePath = path.join(dataDir, LOOKUP_CACHE_FILE);
    this.cache = loadCache(this.cachePath);
  }

  /** kind "place" | "photo"; actor is the stable account reference used for the per-account cap. */
  async search(kind, actor, body) {
    if (!KINDS.has(kind)) throw new Error("Unknown lookup kind.");
    if (!this.enabled) throw disabled();
    const { query, refresh } = parseLookupBody(body);
    this.charge(String(actor || "anonymous"));
    const endpoint = kind === "place" ? this.nominatimUrl : COMMONS_API_URL;
    const key = kind + ":" + crypto.createHash("sha256").update(endpoint + "\n" + query.toLowerCase()).digest("hex");
    if (!refresh) {
      const hit = this.cache.get(key);
      if (hit) return this.respond(hit.results, true);
      const pending = this.inflight.get(key);
      if (pending) return this.respond(await pending, false);
    }
    const work = this.gated(() => (kind === "place" ? this.searchPlaces(query) : this.searchPhotos(query)));
    this.inflight.set(key, work);
    try {
      const results = await work;
      this.remember(key, results);
      return this.respond(results, false);
    } finally {
      if (this.inflight.get(key) === work) this.inflight.delete(key);
    }
  }

  respond(results, cached) {
    const selectedAt = new Date(this.clock()).toISOString();
    return { results: results.map((result) => ({ ...result, selectedAt })), cached };
  }

  charge(actor) {
    const now = this.clock();
    for (const [key, entry] of this.accounts) if (entry.until <= now) this.accounts.delete(key);
    let entry = this.accounts.get(actor);
    if (!entry) { entry = { count: 0, until: now + ACCOUNT_LOOKUP_WINDOW_MS }; this.accounts.set(actor, entry); }
    if (entry.count >= ACCOUNT_LOOKUP_LIMIT) throw accountLimited();
    entry.count += 1;
  }

  // One upstream request at a time across both providers, starts at least MIN_START_INTERVAL_MS
  // apart, at most MAX_QUEUED_LOOKUPS waiting and never longer than MAX_QUEUE_WAIT_MS.
  async gated(task) {
    const gate = this.gate;
    if (gate.pending >= 1 + MAX_QUEUED_LOOKUPS) throw busy();
    gate.pending += 1;
    const enqueuedAt = this.clock();
    const previous = gate.tail;
    let release;
    const finished = new Promise((resolve) => { release = resolve; });
    gate.tail = previous.then(() => finished);
    try {
      await previous;
      const wait = Math.max(0, gate.lastStart + MIN_START_INTERVAL_MS - this.clock());
      if (this.clock() - enqueuedAt + wait > MAX_QUEUE_WAIT_MS) throw busy();
      if (wait > 0) await this.sleep(wait);
      gate.lastStart = this.clock();
      return await task();
    } finally {
      gate.pending -= 1;
      release();
    }
  }

  async request(url, limit) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(timedOut()); }, this.timeoutMs); });
    deadline.catch(() => {});
    this.upstreamRequests += 1;
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => this.fetch(url, {
          method: "GET", redirect: "manual", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal,
          headers: { "User-Agent": this.userAgent, Accept: "application/json" }
        })),
        deadline
      ]);
      if (!response || response.status !== 200 || response.redirected === true || response.type === "opaqueredirect") throw unavailable();
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get?.("content-type") || "")) throw malformed();
      const text = await Promise.race([readBounded(response, limit), deadline]);
      try { return JSON.parse(text); } catch { throw malformed(); }
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (controller.signal.aborted) throw timedOut();
      throw unavailable();
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  async searchPlaces(query) {
    const url = new URL(this.nominatimUrl);
    url.search = new URLSearchParams({ q: query, format: "jsonv2", limit: String(MAX_LOOKUP_RESULTS), addressdetails: "1" }).toString();
    return parseNominatimResults(await this.request(url.href, MAX_RESPONSE_BYTES.place));
  }

  async searchPhotos(query) {
    const url = new URL(COMMONS_API_URL);
    url.search = new URLSearchParams({
      action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: query, gsrnamespace: "6",
      gsrlimit: String(MAX_LOOKUP_RESULTS), prop: "imageinfo", iiprop: "url|extmetadata|mime", iiurlwidth: "640",
      iiextmetadatafilter: "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms", maxlag: "5"
    }).toString();
    return parseCommonsResults(await this.request(url.href, MAX_RESPONSE_BYTES.photo));
  }

  remember(key, results) {
    this.cache.delete(key);
    this.cache.set(key, { results, storedAt: this.clock() });
    while (this.cache.size > MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
    this.persist();
  }

  // One serialized entry and its UTF-8 size, memoized per (immutable) entry object so each persist
  // does not re-serialize the whole cache.
  serializedEntry(key, entry) {
    let memo = this.serialized.get(entry);
    if (!memo) {
      const text = JSON.stringify({ key, storedAt: entry.storedAt, results: entry.results });
      memo = { text, bytes: Buffer.byteLength(text, "utf8") };
      this.serialized.set(entry, memo);
    }
    return memo;
  }

  // Atomic replace; a storage failure keeps the in-memory cache and never fails the lookup. The file
  // must stay within MAX_CACHE_FILE_BYTES (UTF-8) or loadCache would ignore it after a restart, so the
  // oldest entries are evicted, from memory too, until the document fits.
  persist() {
    const parts = [...this.cache].map(([key, entry]) => ({ key, ...this.serializedEntry(key, entry) }));
    let total = Buffer.byteLength(CACHE_DOCUMENT_HEAD + CACHE_DOCUMENT_TAIL, "utf8") + parts.reduce((sum, part) => sum + part.bytes, 0) + Math.max(0, parts.length - 1);
    let first = 0;
    while (first < parts.length && total > MAX_CACHE_FILE_BYTES) {
      total -= parts[first].bytes + (parts.length - first > 1 ? 1 : 0);
      this.cache.delete(parts[first].key);
      first += 1;
    }
    const text = CACHE_DOCUMENT_HEAD + parts.slice(first).map((part) => part.text).join(",") + CACHE_DOCUMENT_TAIL;
    const temporary = this.cachePath + "." + process.pid + "." + crypto.randomBytes(4).toString("hex") + ".tmp";
    try {
      fs.writeFileSync(temporary, text, { mode: 0o600 });
      fs.renameSync(temporary, this.cachePath);
    } catch {
      try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
    }
  }
}
