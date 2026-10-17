// Canonical trip validation and normalization.
//
// Daily-editing validation: drafts may be nearly empty. Generator completeness
// rules (photos, recommendation counts, full translations) are intentionally not
// applied here. Everything a client submits is treated as data.

import { parseFullGoogleMapsPlaceUrl } from "../../assets/app-template/public/google-maps-place-url.js";
import {
  GOOGLE_PLACE_ASSOCIATION_FIELD, googlePlaceAssociationProblems, locationBindingForPlan, normalizeGooglePlaceAssociation
} from "../../assets/app-template/public/google-place-association.js";
import { validationError } from "./errors.mjs";
import { relatedLinksProblems } from "../../assets/app-template/public/related-links.js";
import { normalizeBranding, normalizeCover, normalizeUploadedPhoto } from "./branding.mjs";
import { CARD_CATEGORIES } from "../../assets/app-template/public/trip-presentation.js";

export const LOCALES = Object.freeze(["en", "zh-Hans", "zh-Hant", "ja"]);
export const PERIODS = Object.freeze(["morning", "noon", "evening"]);
export const PLAN_TYPES = Object.freeze([
  "flight", "stay", "restaurant", "transport", "car", "sight", "activity", "event", "shopping", "other"
]);

export const LIMITS = Object.freeze({
  days: 31,
  slotsPerDay: 80,
  reminders: 80,
  groups: 50,
  tips: 100,
  weatherLocations: 60,
  operations: 100,
  freeDepth: 10,
  freeArray: 500,
  freeKeys: 200,
  keyLength: 100,
  freeString: 8000,
  tripJsonChars: 1_500_000
});

// Per-trip choice to show optional Google place details/photos (Places UI Kit) for this trip. A
// strict boolean, false by default: trips stored before this field existed simply lack it and are
// read as false (no bulk rewrite or SQL migration). It is ordinary trip content, written through
// the same validated operations (update_trip, replace_content, create, import) by the owner and
// content managers only. It never enables anything by itself: the operator's site-wide setting and
// browser key are also required (see server/google-places.mjs).
export const GOOGLE_PLACE_PHOTOS_FIELD = "googlePlacePhotosEnabled";

// Writable content fields of a canonical trip.
export const CONTENT_KEYS = Object.freeze([
  "title", "shortName", "metaDescription", "timezone", "country", "dateRange", "route",
  "days", "reminders", "participantGroups", "tips", "disclaimer", "theme", "i18n",
  "weather", "resources", "content", "branding", "cover", GOOGLE_PLACE_PHOTOS_FIELD
]);
// Read-only aliases emitted for the existing runtime template.
export const ALIAS_KEYS = Object.freeze(["slug", "startDate", "endDate", "routeDecoration"]);
// Server-managed fields. Accepted (and checked/ignored) on replace_content only.
export const SYSTEM_KEYS = Object.freeze(["id", "version", "archived", "createdAt", "updatedAt", "buildId"]);

const CONTENT_KEY_SET = new Set(CONTENT_KEYS);
export const DAY_KEYS = new Set([
  "id", "date", "label", "area", "theme", "summary", "notes", "weatherLocationIds", "slots",
  "recommendations", "i18n", "compat"
]);
export const PLAN_KEYS = new Set([
  "id", "name", "period", "time", "sortTime", "sortOrder", "planType", "cardCategory", "booked",
  "participantGroupIds", "review", "notes", "description", "relatedLinks", "googleMapsUrl", "mapsUrl",
  "googleMapsPlaceName", "googleMapsPlaceLabel", "googleMapsFeatureId", "address", "lat", "lng",
  "approximateLocation", "place", "photo", "photoSourceId", "uploadedPhoto", "booking", "routeGroup", "i18n", "compat",
  GOOGLE_PLACE_ASSOCIATION_FIELD
]);

// Selected public place (optional plan.place). Chosen explicitly by an editor from an
// OpenStreetMap/Nominatim-compatible lookup result; when present it is the canonical source of the
// plan's lat/lng/address (see applySelectedPlaces). Strict, bounded, allowlisted shape.
export const OSM_PROVIDER = "openstreetmap";
export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
export const OSM_LICENSE = "ODbL-1.0";
export const PLACE_KEYS = new Set(["provider", "id", "name", "address", "lat", "lng", "sourceUrl", "attribution", "license", "selectedAt"]);
const OSM_ID = /^(node|way|relation)\/[1-9]\d{0,15}$/;

// Selected Wikimedia Commons photo: the managed snapshot written by the photo picker. A plan.photo
// object is treated as one only when it has provider "wikimedia-commons" AND an own selectedAt field
// (see isManagedCommonsPhoto); it is then validated strictly by normalizeCommonsPhoto. Every other
// photo object, including older records that merely carry a provider label (for example
// { provider: "manual", ... } or a pre-picker { provider: "wikimedia-commons", url, credit } without
// selectedAt), keeps the earlier bounded free-object validation and is stored unchanged. Only these
// licenses, unported, at these canonical URLs, are accepted in managed snapshots.
export const COMMONS_PROVIDER = "wikimedia-commons";
export const COMMONS_PHOTO_KEYS = new Set(["provider", "url", "sourceUrl", "credit", "author", "license", "licenseUrl", "selectedAt"]);
export const COMMONS_LICENSES = Object.freeze(Object.fromEntries([
  ["CC0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  ...["1.0", "2.0", "2.5", "3.0", "4.0"].flatMap((version) => [
    [`CC BY ${version}`, `https://creativecommons.org/licenses/by/${version}/`],
    [`CC BY-SA ${version}`, `https://creativecommons.org/licenses/by-sa/${version}/`]
  ])
]));
const COMMONS_UPLOAD_PATH = /^\/wikipedia\/commons\/(?:thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+\/[^/]+|[0-9a-f]\/[0-9a-f]{2}\/[^/]+)$/;
const RASTER_EXTENSION = /\.(?:jpe?g|png|webp)$/i;
const COMMONS_FILE_PATH = /^\/wiki\/File:[^/]+$/;
const ISO_TIMESTAMP = /^(\d{4})-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MARKUP = /[<>]/;
export const REMINDER_KEYS = new Set(["id", "item", "dueDate", "done", "leadDays", "notes", "i18n", "compat"]);
export const GROUP_KEYS = new Set(["id", "label", "members", "alwaysTogether", "i18n", "compat"]);
export const WEATHER_KEYS = new Set(["locations"]);
export const LOCATION_KEYS = new Set(["id", "name", "lat", "lng", "i18n", "compat"]);
const THEME_KEYS = new Set(["ink", "accent", "background"]);
const DATE_RANGE_KEYS = new Set(["start", "end"]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Same intent as scripts/validate-trip.mjs: booking references and identity
// secrets never belong in shared trip data.
const SENSITIVE_KEY = /(?:confirmation(?:number|code)?|booking(?:reference|code)|passport|ticketnumber|cardnumber|securitycode|cvv|privatekey|serviceaccount|clientemail|clientsecret|refreshtoken|accesstoken|idtoken|authtoken|bearertoken|sessiontoken|secretaccesskey|password|credential)/i;
const URL_KEY = /(?:^url$|^href$|^link$|Url$|URL$)/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isValidId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isRealDate(value) {
  if (typeof value !== "string") return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isSensitiveKey(key) {
  return SENSITIVE_KEY.test(String(key).replace(/[^a-z0-9]/gi, ""));
}

export function isValidTimeZone(value) {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** First HH:MM in a free-form time label ("From 15:00" -> "15:00"), or "". */
export function deriveSortTime(time) {
  const match = String(time || "").match(/(?:^|[^\d])(\d{1,2}):(\d{2})(?!\d)/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

export function isSafeUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 4096 || /[\s\\]/.test(trimmed) || CONTROL_CHARS.test(trimmed)) return false;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
  if (parsed.username || parsed.password) return false;
  return true;
}

export class Issues {
  constructor(prefix = "") {
    this.prefix = prefix;
    this.list = [];
  }

  add(path, message) {
    if (this.list.length < 100) this.list.push({ path: this.prefix ? `${this.prefix}.${path}` : path, message });
  }

  get ok() {
    return this.list.length === 0;
  }

  throwIfAny(message) {
    if (this.list.length) throw validationError(this.list, message);
  }
}

/**
 * Rejects prototype-pollution keys anywhere in an untrusted payload, and caps depth.
 * Run on every request body before any merge/copy happens.
 */
export function assertSafePayload(value, path = "body") {
  const issues = new Issues();
  scanKeys(value, path, 0, issues);
  issues.throwIfAny("The request contains forbidden or excessively nested keys.");
}

function scanKeys(value, path, depth, issues) {
  if (!issues.ok && issues.list.length >= 20) return;
  if (depth > 24) {
    issues.add(path, "nesting is too deep");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanKeys(item, `${path}[${index}]`, depth + 1, issues));
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) {
        issues.add(`${path}.${key}`, "forbidden key");
        continue;
      }
      scanKeys(value[key], `${path}.${key}`, depth + 1, issues);
    }
  }
}

// ---------------------------------------------------------------------------
// Primitive checks

function text(value, path, issues, { max = 500, required = false, fallback = undefined } = {}) {
  if (value === undefined || value === null) {
    if (required) issues.add(path, "is required");
    return fallback;
  }
  if (typeof value !== "string") {
    issues.add(path, "must be a string");
    return fallback;
  }
  if (value.length > max) issues.add(path, `must be at most ${max} characters`);
  if (CONTROL_CHARS.test(value)) issues.add(path, "contains control characters");
  if (required && !value.trim()) issues.add(path, "must not be empty");
  return value;
}

function bool(value, path, issues) {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.add(path, "must be true or false");
    return undefined;
  }
  return value;
}

function number(value, path, issues, { min = -1e9, max = 1e9, integer = false } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    issues.add(path, `must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
    return undefined;
  }
  return value;
}

function idValue(value, path, issues) {
  if (!isValidId(value)) {
    issues.add(path, "must be an ID of 1-100 letters, digits, '.', '_' or '-' starting with a letter or digit");
    return undefined;
  }
  return value;
}

function dateValue(value, path, issues, { allowEmpty = false } = {}) {
  if (allowEmpty && (value === undefined || value === null || value === "")) return "";
  if (!isRealDate(value)) {
    issues.add(path, "must be a real calendar date in YYYY-MM-DD form");
    return allowEmpty ? "" : undefined;
  }
  return value;
}

function urlValue(value, path, issues) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    issues.add(path, "must be a URL string");
    return undefined;
  }
  if (!isSafeUrl(value)) {
    issues.add(path, "must be an https/http URL or a root-relative path");
    return undefined;
  }
  return value.trim();
}

function idList(value, path, issues, known, knownLabel) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) {
    issues.add(path, "must be an array of at most 100 IDs");
    return undefined;
  }
  const out = [];
  value.forEach((item, index) => {
    const id = idValue(item, `${path}[${index}]`, issues);
    if (id === undefined) return;
    if (known && !known.has(id)) issues.add(`${path}[${index}]`, `references unknown ${knownLabel} '${id}'`);
    if (!out.includes(id)) out.push(id);
  });
  return out;
}

function checkKeys(object, allowed, path, issues) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) issues.add(`${path}.${key}`, "field is not allowed");
    else if (isSensitiveKey(key)) issues.add(`${path}.${key}`, "sensitive field names are not allowed");
  }
}

/** Bounded free-form JSON (compatibility content). Returns a safe deep copy. */
export function freeJson(value, path, issues, depth = 0, key = "") {
  if (depth > LIMITS.freeDepth) {
    issues.add(path, "is nested too deeply");
    return undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      issues.add(path, "must be a finite number");
      return undefined;
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > LIMITS.freeString) issues.add(path, `must be at most ${LIMITS.freeString} characters`);
    if (CONTROL_CHARS.test(value)) issues.add(path, "contains control characters");
    if ((URL_KEY.test(key) || key === "photo") && !isSafeUrl(value)) {
      issues.add(path, "must be an https/http URL or a root-relative path");
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > LIMITS.freeArray) issues.add(path, `must have at most ${LIMITS.freeArray} items`);
    return value.slice(0, LIMITS.freeArray).map((item, index) => freeJson(item, `${path}[${index}]`, issues, depth + 1, key));
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length > LIMITS.freeKeys) issues.add(path, `must have at most ${LIMITS.freeKeys} keys`);
    const out = {};
    for (const childKey of keys.slice(0, LIMITS.freeKeys)) {
      const childPath = `${path}.${childKey}`;
      if (FORBIDDEN_OBJECT_KEYS.has(childKey)) {
        issues.add(childPath, "forbidden key");
        continue;
      }
      if (!childKey || childKey.length > LIMITS.keyLength) {
        issues.add(childPath, `keys must be 1-${LIMITS.keyLength} characters`);
        continue;
      }
      if (isSensitiveKey(childKey)) {
        issues.add(childPath, "sensitive field names are not allowed");
        continue;
      }
      const child = freeJson(value[childKey], childPath, issues, depth + 1, childKey);
      if (child !== undefined) out[childKey] = child;
    }
    return out;
  }
  issues.add(path, "has an unsupported value type");
  return undefined;
}

function freeObject(value, path, issues) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  return freeJson(value, path, issues);
}

function i18nValue(value, path, issues) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    issues.add(path, "must be an object keyed by locale");
    return undefined;
  }
  const out = {};
  for (const locale of Object.keys(value)) {
    if (!LOCALES.includes(locale)) {
      issues.add(`${path}.${locale}`, `locale must be one of ${LOCALES.join(", ")}`);
      continue;
    }
    const patch = value[locale];
    if (!isPlainObject(patch)) {
      issues.add(`${path}.${locale}`, "must be an object of translated fields");
      continue;
    }
    if (Object.hasOwn(patch, "relatedLinks")) issues.add(`${path}.${locale}.relatedLinks`, "links are structural plan content, not a translation override");
    for(const key of ["cover","cardCategory","uploadedPhoto"])if(Object.hasOwn(patch,key))issues.add(`${path}.${locale}.${key}`,"presentation data is structural content, not a translation override");
    const copy = freeJson(patch, `${path}.${locale}`, issues, 1);
    if (copy && Object.keys(copy).length) out[locale] = copy;
  }
  return Object.keys(out).length ? out : undefined;
}

function assignDefined(target, key, value) {
  if (value !== undefined) target[key] = value;
}

// ---------------------------------------------------------------------------
// Structured objects

function normalizeGroup(raw, path, issues) {
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  checkKeys(raw, GROUP_KEYS, path, issues);
  const out = {};
  assignDefined(out, "id", idValue(raw.id, `${path}.id`, issues));
  assignDefined(out, "label", text(raw.label, `${path}.label`, issues, { max: 200 }));
  if (raw.members !== undefined) {
    if (!Array.isArray(raw.members) || raw.members.length > 50) issues.add(`${path}.members`, "must be an array of at most 50 names");
    else out.members = raw.members.map((member, index) => text(member, `${path}.members[${index}]`, issues, { max: 120, fallback: "" }));
  }
  assignDefined(out, "alwaysTogether", bool(raw.alwaysTogether, `${path}.alwaysTogether`, issues));
  assignDefined(out, "i18n", i18nValue(raw.i18n, `${path}.i18n`, issues));
  assignDefined(out, "compat", freeObject(raw.compat, `${path}.compat`, issues));
  return out;
}

function normalizeLocation(raw, path, issues) {
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  checkKeys(raw, LOCATION_KEYS, path, issues);
  const out = {};
  assignDefined(out, "id", idValue(raw.id, `${path}.id`, issues));
  assignDefined(out, "name", text(raw.name, `${path}.name`, issues, { max: 200 }));
  assignDefined(out, "lat", number(raw.lat, `${path}.lat`, issues, { min: -90, max: 90 }));
  assignDefined(out, "lng", number(raw.lng, `${path}.lng`, issues, { min: -180, max: 180 }));
  assignDefined(out, "i18n", i18nValue(raw.i18n, `${path}.i18n`, issues));
  assignDefined(out, "compat", freeObject(raw.compat, `${path}.compat`, issues));
  return out;
}

function normalizeWeather(raw, path, issues) {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  checkKeys(raw, WEATHER_KEYS, path, issues);
  const out = { locations: [] };
  if (raw.locations !== undefined) {
    if (!Array.isArray(raw.locations) || raw.locations.length > LIMITS.weatherLocations) {
      issues.add(`${path}.locations`, `must be an array of at most ${LIMITS.weatherLocations} locations`);
    } else {
      const seen = new Set();
      raw.locations.forEach((location, index) => {
        const item = normalizeLocation(location, `${path}.locations[${index}]`, issues);
        if (!item) return;
        if (item.id && seen.has(item.id)) issues.add(`${path}.locations[${index}].id`, `duplicate location ID '${item.id}'`);
        if (item.id) seen.add(item.id);
        out.locations.push(item);
      });
    }
  }
  return out;
}

/** ISO-8601 UTC timestamp such as 2032-03-04T05:06:07.000Z. */
export function isIsoTimestamp(value) {
  if (typeof value !== "string" || value.length > 30) return false;
  const match = ISO_TIMESTAMP.exec(value);
  if (!match || Number(match[1]) < 2000 || Number(match[1]) > 2200) return false;
  return Number.isFinite(Date.parse(value));
}

// Canonical absolute HTTPS URL on exactly one host: no credentials, port, query or fragment, and
// already in WHATWG-serialized form (so the stored string is exactly what a browser would request).
function canonicalHttpsUrl(value, host) {
  if (typeof value !== "string" || !value || value.length > 1000 || /[\s\\]/.test(value) || CONTROL_CHARS.test(value)) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const allowedHost = Array.isArray(host) ? host.includes(parsed.hostname) : parsed.hostname === host;
  if (parsed.protocol !== "https:" || !allowedHost || parsed.port || parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash || value.includes("?") || value.includes("#") || parsed.href !== value) return null;
  return parsed;
}

/** Provider-derived display text: bounded, no control characters and never markup. */
function plainText(value, path, issues, max) {
  if (typeof value !== "string" || !value.trim()) {
    issues.add(path, "is required");
    return undefined;
  }
  if (value.length > max) issues.add(path, `must be at most ${max} characters`);
  else if (CONTROL_CHARS.test(value)) issues.add(path, "contains control characters");
  else if (MARKUP.test(value)) issues.add(path, "must be plain text without markup");
  else return value;
  return undefined;
}

function requireNumber(value, path, issues, min, max) {
  if (value === undefined || value === null) {
    issues.add(path, "is required");
    return undefined;
  }
  return number(value, path, issues, { min, max });
}

function exactValue(value, expected, path, issues) {
  if (value !== expected) {
    issues.add(path, `must be ${JSON.stringify(expected)}`);
    return undefined;
  }
  return value;
}

function selectedAtValue(value, path, issues) {
  if (!isIsoTimestamp(value)) {
    issues.add(path, "must be an ISO-8601 UTC timestamp such as 2032-03-04T05:06:07.000Z");
    return undefined;
  }
  return value;
}

/**
 * plan.place: an explicitly selected OpenStreetMap object. Every field is required; sourceUrl,
 * attribution and license are fixed by the ID, so a client cannot attach arbitrary links or text.
 */
export function normalizeSelectedPlace(raw, path, issues) {
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  const before = issues.list.length;
  checkKeys(raw, PLACE_KEYS, path, issues);
  const out = {};
  out.provider = exactValue(raw.provider, OSM_PROVIDER, `${path}.provider`, issues);
  if (typeof raw.id !== "string" || !OSM_ID.test(raw.id)) issues.add(`${path}.id`, "must be an OpenStreetMap object such as node/123, way/123 or relation/123");
  else out.id = raw.id;
  out.name = plainText(raw.name, `${path}.name`, issues, 200);
  out.address = plainText(raw.address, `${path}.address`, issues, 500);
  out.lat = requireNumber(raw.lat, `${path}.lat`, issues, -90, 90);
  out.lng = requireNumber(raw.lng, `${path}.lng`, issues, -180, 180);
  if (out.id) exactValue(raw.sourceUrl, `https://www.openstreetmap.org/${out.id}`, `${path}.sourceUrl`, issues);
  out.sourceUrl = out.id ? `https://www.openstreetmap.org/${out.id}` : undefined;
  out.attribution = exactValue(raw.attribution, OSM_ATTRIBUTION, `${path}.attribution`, issues);
  out.license = exactValue(raw.license, OSM_LICENSE, `${path}.license`, issues);
  out.selectedAt = selectedAtValue(raw.selectedAt, `${path}.selectedAt`, issues);
  return issues.list.length === before ? out : undefined;
}

/** Canonical Commons license name from a provider short name, or "" when it is not allowlisted. */
export function canonicalCommonsLicense(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (/^CC0(?: 1\.0)?$/i.test(name)) return "CC0";
  const match = /^CC[ -]BY(-SA)?[ -](1\.0|2\.0|2\.5|3\.0|4\.0)$/i.exec(name);
  return match ? `CC BY${match[1] ? "-SA" : ""} ${match[2]}` : "";
}

/**
 * True for the managed Commons snapshot shape: provider "wikimedia-commons" plus an own selectedAt
 * field (whatever its value; a bad value is then rejected by normalizeCommonsPhoto). Search results
 * and every snapshot the picker saves carry selectedAt. A provider label alone is legacy metadata,
 * not proof that the object came from this picker, so it does not make an object managed: such
 * records keep free-object validation and are never rewritten (no invented timestamp, no changed
 * credit or source).
 */
export function isManagedCommonsPhoto(value) {
  return isPlainObject(value) && value.provider === COMMONS_PROVIDER && Object.hasOwn(value, "selectedAt");
}

/**
 * Managed plan.photo snapshot: only a selected Wikimedia Commons image with a complete author and an
 * allowlisted CC0 / CC BY / CC BY-SA license at its canonical URL. Every field is required. Provider
 * parsing and cache revalidation call this directly (strict regardless of the managed marker).
 */
export function normalizeCommonsPhoto(raw, path, issues) {
  const before = issues.list.length;
  checkKeys(raw, COMMONS_PHOTO_KEYS, path, issues);
  const out = {};
  out.provider = exactValue(raw.provider, COMMONS_PROVIDER, `${path}.provider`, issues);
  const image = canonicalHttpsUrl(raw.url, ["upload.wikimedia.org", "thumb.wikimedia.org"]);
  if (!image || !COMMONS_UPLOAD_PATH.test(image.pathname) || !RASTER_EXTENSION.test(image.pathname)
    || (image.hostname === "thumb.wikimedia.org" && !image.pathname.startsWith("/wikipedia/commons/thumb/"))) {
    issues.add(`${path}.url`, "must be a Commons JPEG, PNG or WebP URL on upload.wikimedia.org, or a Commons thumbnail on thumb.wikimedia.org");
  } else out.url = raw.url;
  const source = canonicalHttpsUrl(raw.sourceUrl, "commons.wikimedia.org");
  if (!source || !COMMONS_FILE_PATH.test(source.pathname)) issues.add(`${path}.sourceUrl`, "must be a https://commons.wikimedia.org/wiki/File: page");
  else out.sourceUrl = raw.sourceUrl;
  out.credit = plainText(raw.credit, `${path}.credit`, issues, 500);
  out.author = plainText(raw.author, `${path}.author`, issues, 300);
  if (typeof raw.license !== "string" || !Object.hasOwn(COMMONS_LICENSES, raw.license)) {
    issues.add(`${path}.license`, `must be one of ${Object.keys(COMMONS_LICENSES).join(", ")}`);
  } else {
    out.license = raw.license;
    out.licenseUrl = exactValue(raw.licenseUrl, COMMONS_LICENSES[raw.license], `${path}.licenseUrl`, issues);
  }
  out.selectedAt = selectedAtValue(raw.selectedAt, `${path}.selectedAt`, issues);
  return issues.list.length === before ? out : undefined;
}

/**
 * plan.googlePlaceAssociation: exactly { placeId, locationBinding, publicVenueConfirmed: true }.
 * Any other key (a Google name, address, location, rating, photo or photo reference) is rejected,
 * so Google place content can never be stored. Whether the binding matches the plan's final
 * location is checked afterwards by applyGooglePlaceAssociations.
 */
export function normalizeGooglePlaceAssociationValue(raw, path, issues) {
  const problems = googlePlaceAssociationProblems(raw);
  if (problems.length) {
    for (const { key, message } of problems) issues.add(key ? `${path}.${key}` : path, message);
    return undefined;
  }
  return normalizeGooglePlaceAssociation(raw);
}

function normalizePlan(raw, path, issues, ctx) {
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  checkKeys(raw, PLAN_KEYS, path, issues);
  const out = {};
  if (raw.relatedLinks !== undefined) {
    const problems = relatedLinksProblems(raw.relatedLinks);
    for (const problem of problems) issues.add(`${path}.relatedLinks${problem.key}`, problem.message);
    if (!problems.length) out.relatedLinks = raw.relatedLinks.map(({ id, label, url }) => ({ id, label, url }));
  }
  assignDefined(out, "id", idValue(raw.id, `${path}.id`, issues));
  assignDefined(out, "name", text(raw.name, `${path}.name`, issues, { max: 200, required: true }));
  if (raw.period !== undefined && raw.period !== null && raw.period !== "") {
    if (!PERIODS.includes(raw.period)) issues.add(`${path}.period`, `must be one of ${PERIODS.join(", ")}`);
    else out.period = raw.period;
  }
  assignDefined(out, "time", text(raw.time, `${path}.time`, issues, { max: 80 }));
  if (raw.sortTime !== undefined && raw.sortTime !== null && raw.sortTime !== "") {
    if (typeof raw.sortTime !== "string" || !HHMM_PATTERN.test(raw.sortTime)) issues.add(`${path}.sortTime`, "must be HH:MM (00:00-23:59)");
    else out.sortTime = raw.sortTime;
  }
  if (raw.sortOrder !== undefined && raw.sortOrder !== null) {
    assignDefined(out, "sortOrder", number(raw.sortOrder, `${path}.sortOrder`, issues, { min: -1e6, max: 1e6 }));
  }
  if (raw.planType !== undefined && raw.planType !== null && raw.planType !== "") {
    if (!PLAN_TYPES.includes(raw.planType)) issues.add(`${path}.planType`, `must be one of ${PLAN_TYPES.join(", ")}`);
    else out.planType = raw.planType;
  }
  assignDefined(out, "booked", bool(raw.booked, `${path}.booked`, issues));
  if(raw.cardCategory!==undefined){
    if(!CARD_CATEGORIES.includes(raw.cardCategory))issues.add(`${path}.cardCategory`, `must be one of ${CARD_CATEGORIES.join(", ")}`);
    else out.cardCategory=raw.cardCategory;
  }
  assignDefined(out, "participantGroupIds", idList(raw.participantGroupIds, `${path}.participantGroupIds`, issues, ctx.groupIds, "participant group"));
  assignDefined(out, "review", text(raw.review, `${path}.review`, issues, { max: 4000 }));
  assignDefined(out, "notes", text(raw.notes, `${path}.notes`, issues, { max: 4000 }));
  assignDefined(out, "description", text(raw.description, `${path}.description`, issues, { max: 4000 }));

  const mapsUrl = urlValue(raw.googleMapsUrl, `${path}.googleMapsUrl`, issues);
  if (mapsUrl) {
    const parsed = parseFullGoogleMapsPlaceUrl(mapsUrl);
    if (!parsed.ok) {
      issues.add(`${path}.googleMapsUrl`, `must be a full Google Maps place URL with !3d/!4d coordinates (${parsed.reason})`);
    } else {
      out.googleMapsUrl = parsed.url;
      ctx.parsedPlaces?.set(out, parsed);
    }
  }
  assignDefined(out, "mapsUrl", urlValue(raw.mapsUrl, `${path}.mapsUrl`, issues));
  assignDefined(out, "googleMapsPlaceName", text(raw.googleMapsPlaceName, `${path}.googleMapsPlaceName`, issues, { max: 500 }));
  assignDefined(out, "googleMapsPlaceLabel", text(raw.googleMapsPlaceLabel, `${path}.googleMapsPlaceLabel`, issues, { max: 500 }));
  assignDefined(out, "googleMapsFeatureId", text(raw.googleMapsFeatureId, `${path}.googleMapsFeatureId`, issues, { max: 200 }));
  assignDefined(out, "address", text(raw.address, `${path}.address`, issues, { max: 500 }));
  assignDefined(out, "lat", number(raw.lat, `${path}.lat`, issues, { min: -90, max: 90 }));
  assignDefined(out, "lng", number(raw.lng, `${path}.lng`, issues, { min: -180, max: 180 }));
  assignDefined(out, "approximateLocation", bool(raw.approximateLocation, `${path}.approximateLocation`, issues));
  if (raw.place !== undefined && raw.place !== null) assignDefined(out, "place", normalizeSelectedPlace(raw.place, `${path}.place`, issues));
  if (raw.photo !== undefined && raw.photo !== null) {
    if (typeof raw.photo === "string") assignDefined(out, "photo", urlValue(raw.photo, `${path}.photo`, issues));
    // Managed Commons snapshot (Commons provider + selectedAt): strict schema. Anything else,
    // including legacy objects with only a provider label, keeps the earlier free-object checks
    // (sensitive keys, safe URLs, depth/size bounds) and is stored as given.
    else if (isManagedCommonsPhoto(raw.photo)) assignDefined(out, "photo", normalizeCommonsPhoto(raw.photo, `${path}.photo`, issues));
    else assignDefined(out, "photo", freeObject(raw.photo, `${path}.photo`, issues));
  }
  assignDefined(out, "photoSourceId", text(raw.photoSourceId, `${path}.photoSourceId`, issues, { max: 200 }));
  assignDefined(out, "uploadedPhoto", normalizeUploadedPhoto(raw.uploadedPhoto, `${path}.uploadedPhoto`, issues));
  const association = raw[GOOGLE_PLACE_ASSOCIATION_FIELD];
  if (association !== undefined && association !== null) {
    assignDefined(out, GOOGLE_PLACE_ASSOCIATION_FIELD, normalizeGooglePlaceAssociationValue(association, `${path}.${GOOGLE_PLACE_ASSOCIATION_FIELD}`, issues));
  }
  assignDefined(out, "booking", freeObject(raw.booking, `${path}.booking`, issues));
  assignDefined(out, "routeGroup", text(raw.routeGroup, `${path}.routeGroup`, issues, { max: 80 }));
  assignDefined(out, "i18n", i18nValue(raw.i18n, `${path}.i18n`, issues));
  assignDefined(out, "compat", freeObject(raw.compat, `${path}.compat`, issues));
  return out;
}

function normalizeDay(raw, path, issues, ctx) {
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  checkKeys(raw, DAY_KEYS, path, issues);
  const out = {};
  assignDefined(out, "id", idValue(raw.id, `${path}.id`, issues));
  assignDefined(out, "date", dateValue(raw.date, `${path}.date`, issues));
  assignDefined(out, "label", text(raw.label, `${path}.label`, issues, { max: 200 }));
  assignDefined(out, "area", text(raw.area, `${path}.area`, issues, { max: 200 }));
  assignDefined(out, "theme", text(raw.theme, `${path}.theme`, issues, { max: 200 }));
  assignDefined(out, "summary", text(raw.summary, `${path}.summary`, issues, { max: 4000 }));
  assignDefined(out, "notes", text(raw.notes, `${path}.notes`, issues, { max: 4000 }));
  assignDefined(out, "weatherLocationIds", idList(raw.weatherLocationIds, `${path}.weatherLocationIds`, issues, ctx.locationIds, "weather location"));
  out.slots = [];
  if (raw.slots !== undefined && raw.slots !== null) {
    if (!Array.isArray(raw.slots) || raw.slots.length > LIMITS.slotsPerDay) {
      issues.add(`${path}.slots`, `must be an array of at most ${LIMITS.slotsPerDay} plans`);
    } else {
      raw.slots.forEach((slot, index) => {
        const plan = normalizePlan(slot, `${path}.slots[${index}]`, issues, ctx);
        if (!plan) return;
        if (plan.id) {
          if (ctx.planIds.has(plan.id)) issues.add(`${path}.slots[${index}].id`, `duplicate plan ID '${plan.id}' in this trip`);
          ctx.planIds.add(plan.id);
        }
        out.slots.push(plan);
      });
    }
  }
  assignDefined(out, "recommendations", freeObject(raw.recommendations, `${path}.recommendations`, issues));
  assignDefined(out, "i18n", i18nValue(raw.i18n, `${path}.i18n`, issues));
  assignDefined(out, "compat", freeObject(raw.compat, `${path}.compat`, issues));
  return out;
}

function normalizeReminder(raw, path, issues) {
  if (!isPlainObject(raw)) {
    issues.add(path, "must be an object");
    return undefined;
  }
  checkKeys(raw, REMINDER_KEYS, path, issues);
  const out = {};
  assignDefined(out, "id", idValue(raw.id, `${path}.id`, issues));
  assignDefined(out, "item", text(raw.item, `${path}.item`, issues, { max: 300, required: true }));
  out.dueDate = dateValue(raw.dueDate, `${path}.dueDate`, issues, { allowEmpty: true });
  out.done = raw.done === undefined ? false : bool(raw.done, `${path}.done`, issues) ?? false;
  assignDefined(out, "leadDays", number(raw.leadDays, `${path}.leadDays`, issues, { min: 0, max: 365, integer: true }));
  assignDefined(out, "notes", text(raw.notes, `${path}.notes`, issues, { max: 4000 }));
  assignDefined(out, "i18n", i18nValue(raw.i18n, `${path}.i18n`, issues));
  assignDefined(out, "compat", freeObject(raw.compat, `${path}.compat`, issues));
  return out;
}

function normalizeArray(raw, path, issues, max, label, normalizeItem) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > max) {
    issues.add(path, `must be an array of at most ${max} ${label}`);
    return [];
  }
  const out = [];
  const seen = new Set();
  raw.forEach((item, index) => {
    const value = normalizeItem(item, `${path}[${index}]`, issues);
    if (value === undefined) return;
    if (value && typeof value === "object" && value.id) {
      if (seen.has(value.id)) issues.add(`${path}[${index}].id`, `duplicate ID '${value.id}'`);
      seen.add(value.id);
    }
    out.push(value);
  });
  return out;
}

/**
 * trip.googlePlacePhotosEnabled: exactly true or false. Absent means false (the default for older
 * trips and new trips). Strings ("true"), numbers (1), null and objects are refused, so a forced or
 * malformed write can never switch it on by accident.
 */
function googlePlacePhotosValue(value, path, issues) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    issues.add(path, "must be true or false");
    return false;
  }
  return value;
}

/** Read projection: the effective per-trip choice (stored rows without the field read as false). */
export function tripGooglePlacePhotosEnabled(trip) {
  return isPlainObject(trip) && trip[GOOGLE_PLACE_PHOTOS_FIELD] === true;
}

/**
 * Normalize a full content object (no system/alias keys). Returns
 * { content, issues, parsedPlaces } — callers throw when issues are present.
 */
export function normalizeContent(raw, { prefix = "trip" } = {}) {
  const issues = new Issues();
  const parsedPlaces = new Map();
  if (!isPlainObject(raw)) {
    issues.add(prefix, "must be an object");
    return { content: null, issues, parsedPlaces };
  }
  for (const key of Object.keys(raw)) {
    if (!CONTENT_KEY_SET.has(key)) issues.add(`${prefix}.${key}`, "field is not allowed");
  }
  const out = {};
  out.title = text(raw.title, `${prefix}.title`, issues, { max: 200, required: true, fallback: "" });
  assignDefined(out, "shortName", text(raw.shortName, `${prefix}.shortName`, issues, { max: 60 }));
  assignDefined(out, "metaDescription", text(raw.metaDescription, `${prefix}.metaDescription`, issues, { max: 500 }));
  const timezone = raw.timezone === undefined || raw.timezone === null || raw.timezone === "" ? "UTC" : raw.timezone;
  if (!isValidTimeZone(timezone)) issues.add(`${prefix}.timezone`, "must be a valid IANA time zone such as Europe/Lisbon");
  out.timezone = timezone;
  out.country = text(raw.country, `${prefix}.country`, issues, { max: 120 }) ?? "";

  out.dateRange = { start: "", end: "" };
  if (raw.dateRange !== undefined && raw.dateRange !== null) {
    if (!isPlainObject(raw.dateRange)) issues.add(`${prefix}.dateRange`, "must be an object with start and end");
    else {
      checkKeys(raw.dateRange, DATE_RANGE_KEYS, `${prefix}.dateRange`, issues);
      out.dateRange.start = dateValue(raw.dateRange.start, `${prefix}.dateRange.start`, issues, { allowEmpty: true });
      out.dateRange.end = dateValue(raw.dateRange.end, `${prefix}.dateRange.end`, issues, { allowEmpty: true });
      if (out.dateRange.start && out.dateRange.end && out.dateRange.end < out.dateRange.start) {
        issues.add(`${prefix}.dateRange.end`, "must not be before start");
      }
    }
  }
  out.route = text(raw.route, `${prefix}.route`, issues, { max: 300 }) ?? "";

  out.participantGroups = normalizeArray(raw.participantGroups, `${prefix}.participantGroups`, issues, LIMITS.groups, "groups", normalizeGroup);
  const weather = normalizeWeather(raw.weather, `${prefix}.weather`, issues);
  if (weather) out.weather = weather;

  const ctx = {
    groupIds: new Set(out.participantGroups.map((group) => group.id).filter(Boolean)),
    locationIds: new Set((weather?.locations || []).map((location) => location.id).filter(Boolean)),
    planIds: new Set(),
    parsedPlaces
  };
  out.days = normalizeArray(raw.days, `${prefix}.days`, issues, LIMITS.days, "days", (day, path, list) => normalizeDay(day, path, list, ctx));
  const dates = new Map();
  out.days.forEach((day, index) => {
    if (!day.date) return;
    if (dates.has(day.date)) issues.add(`${prefix}.days[${index}].date`, `duplicate day date ${day.date}`);
    dates.set(day.date, true);
  });
  out.days.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  out.reminders = normalizeArray(raw.reminders, `${prefix}.reminders`, issues, LIMITS.reminders, "reminders", normalizeReminder);
  out.tips = normalizeArray(raw.tips, `${prefix}.tips`, issues, LIMITS.tips, "tips", (tip, path, list) => {
    if (typeof tip === "string") return text(tip, path, list, { max: 2000 });
    if (isPlainObject(tip)) return freeJson(tip, path, list, 1);
    list.add(path, "must be a string or an object");
    return undefined;
  });
  assignDefined(out, "disclaimer", text(raw.disclaimer, `${prefix}.disclaimer`, issues, { max: 2000 }));
  if (raw.theme !== undefined && raw.theme !== null) {
    if (!isPlainObject(raw.theme)) issues.add(`${prefix}.theme`, "must be an object");
    else {
      checkKeys(raw.theme, THEME_KEYS, `${prefix}.theme`, issues);
      const theme = {};
      for (const key of THEME_KEYS) {
        if (raw.theme[key] === undefined) continue;
        if (typeof raw.theme[key] !== "string" || !HEX_COLOR.test(raw.theme[key])) issues.add(`${prefix}.theme.${key}`, "must be a hex color such as #17362f");
        else theme[key] = raw.theme[key];
      }
      out.theme = theme;
    }
  }
  assignDefined(out, "i18n", i18nValue(raw.i18n, `${prefix}.i18n`, issues));
  assignDefined(out, "resources", freeObject(raw.resources, `${prefix}.resources`, issues));
  assignDefined(out, "content", freeObject(raw.content, `${prefix}.content`, issues));
  assignDefined(out, "branding", normalizeBranding(raw.branding, `${prefix}.branding`, issues));
  assignDefined(out, "cover", normalizeCover(raw.cover, `${prefix}.cover`, issues));
  out[GOOGLE_PLACE_PHOTOS_FIELD] = googlePlacePhotosValue(raw[GOOGLE_PLACE_PHOTOS_FIELD], `${prefix}.${GOOGLE_PLACE_PHOTOS_FIELD}`, issues);

  // Missing required IDs on nested objects are reported above (idValue).
  if (issues.ok && JSON.stringify(out).length > LIMITS.tripJsonChars) {
    issues.add(prefix, `trip data exceeds ${LIMITS.tripJsonChars} characters`);
  }
  return { content: out, issues, parsedPlaces };
}

/**
 * Fill derived map fields for plans whose googleMapsUrl was parsed. Only applied
 * when the URL is new or changed, so a caller's own derived fields stay intact.
 * A plan with a selected place (plan.place) is skipped: the place, not the legacy
 * Google URL, owns its coordinates and address.
 */
export function applyParsedPlaces(content, parsedPlaces, previousUrls) {
  for (const day of content.days) {
    for (const slot of day.slots) {
      const parsed = parsedPlaces.get(slot);
      if (!parsed || slot.place) continue;
      const before = previousUrls.get(slot.id);
      if (before === slot.googleMapsUrl && Number.isFinite(slot.lat) && Number.isFinite(slot.lng)) continue;
      slot.googleMapsPlaceName = parsed.placeName;
      slot.googleMapsPlaceLabel = parsed.placeLabel;
      if (parsed.featureId) slot.googleMapsFeatureId = parsed.featureId;
      else delete slot.googleMapsFeatureId;
      if (parsed.address && (before !== slot.googleMapsUrl || !slot.address)) slot.address = parsed.address;
      slot.lat = parsed.lat;
      slot.lng = parsed.lng;
      slot.approximateLocation = false;
      if (!slot.photoSourceId && slot.id) slot.photoSourceId = slot.id;
    }
  }
}

const MIRRORED_PLACE_FIELDS = Object.freeze(["lat", "lng", "address"]);

/**
 * Mirror plan.lat/lng/address from a selected plan.place (the canonical source). previous is the
 * stored content before this write (null for a new trip or import). A duplicate field equal to the
 * place value, or carried over unchanged from the stored plan (for example the earlier Google-derived
 * coordinates when a place is first selected), is replaced by the place value. A duplicate that the
 * caller changed to anything else is a conflict and the whole write is refused, never silently
 * overwritten.
 *
 * Removing a selection: when the stored plan had a place, the new plan has none and no googleMapsUrl
 * (which would re-derive its own location in applyParsedPlaces), each of lat/lng/address that still
 * equals both the stored plan value and the stored place value is a carried-over mirror and is
 * removed, so no stale marker remains. A value the caller changed is kept. Plans that had no place
 * before (legacy plans) are untouched.
 */
export function applySelectedPlaces(content, previous) {
  const stored = new Map();
  for (const day of previous?.days || []) for (const slot of day?.slots || []) if (slot?.id) stored.set(slot.id, slot);
  const issues = new Issues();
  content.days.forEach((day, dayIndex) => {
    day.slots.forEach((slot, slotIndex) => {
      const prior = stored.get(slot.id);
      if (!slot.place) {
        if (!isPlainObject(prior?.place) || slot.googleMapsUrl) return;
        for (const key of MIRRORED_PLACE_FIELDS) {
          if (slot[key] !== undefined && slot[key] === prior[key] && prior[key] === prior.place[key]) delete slot[key];
        }
        return;
      }
      for (const key of MIRRORED_PLACE_FIELDS) {
        const value = slot.place[key];
        if (slot[key] === undefined || slot[key] === value) continue;
        if (prior && prior[key] === slot[key]) continue;
        issues.add(`trip.days[${dayIndex}].slots[${slotIndex}].${key}`, `conflicts with place.${key}; omit it or send the selected place's value`);
      }
      for (const key of MIRRORED_PLACE_FIELDS) slot[key] = slot.place[key];
    });
  });
  issues.throwIfAny("A plan's coordinates or address conflict with its selected place.");
}

// Daily weather associations (see references/weather-association.md) use only the shared schema in
// normalizeContent: optional lat/lng (finite numbers in range when present, including 0), valid
// unique IDs and known references. There is no extra completeness or (0, 0) rule, so every location
// accepted by earlier versions stays importable and editable; a location without a complete pair is
// kept as saved and the browser simply never fetches it.

const sameAssociation = (a, b) => isPlainObject(a) && isPlainObject(b)
  && a.placeId === b.placeId && a.locationBinding === b.locationBinding && a.publicVenueConfirmed === b.publicVenueConfirmed;

/**
 * Keep every plan.googlePlaceAssociation bound to the plan's own final location. Runs on every write
 * (web replace_content and upsert_plan, MCP apply_trip_changes, create and import) after
 * applyParsedPlaces and applySelectedPlaces, so the binding is computed from the stored location.
 *
 * - Binding matches the current location: kept (unrelated edits never touch it).
 * - Carried over unchanged from the stored plan, but the location changed or was cleared: the
 *   association is stale and is removed, so an old Google place never follows a new location.
 * - Sent new or changed by the caller (including every association in a create or import) but not
 *   bound to the current location, or on a plan without a location: the whole write is refused.
 */
export function applyGooglePlaceAssociations(content, previous) {
  const stored = new Map();
  for (const day of previous?.days || []) for (const slot of day?.slots || []) if (slot?.id) stored.set(slot.id, slot);
  const issues = new Issues();
  content.days.forEach((day, dayIndex) => {
    day.slots.forEach((slot, slotIndex) => {
      const association = slot[GOOGLE_PLACE_ASSOCIATION_FIELD];
      if (!association) return;
      const binding = locationBindingForPlan(slot);
      if (binding && binding === association.locationBinding) return;
      if (sameAssociation(stored.get(slot.id)?.[GOOGLE_PLACE_ASSOCIATION_FIELD], association)) {
        delete slot[GOOGLE_PLACE_ASSOCIATION_FIELD];
        return;
      }
      issues.add(`trip.days[${dayIndex}].slots[${slotIndex}].${GOOGLE_PLACE_ASSOCIATION_FIELD}.locationBinding`, binding
        ? "does not match this plan's saved location; choose the Google place again for the current location"
        : "needs a saved location (a selected OpenStreetMap place, a full Google Maps link or saved coordinates)");
    });
  });
  issues.throwIfAny("A Google place link does not match its plan's saved location.");
}
