// Optional Google place association for a self-hosted plan (plan.googlePlaceAssociation).
//
// Shared by the browser editor/renderer and the server validator, so both compute exactly the same
// location binding. Pure functions only: nothing here loads Google code, contacts any service, or
// reads or stores Google place content.
//
// Stored shape (exactly these three keys, nothing else):
//   { placeId: "<Google Place ID>",
//     locationBinding: "v1:<sha256 hex of this plan's own location inputs>",
//     publicVenueConfirmed: true }
//
// The Place ID is the only Google-sourced value, and Google's policies allow Place IDs to be kept.
// Google names, addresses, coordinates, ratings, photos and photo references are never stored.
//
// The binding covers only the plan's own (non-Google-Places) location inputs: the selected
// OpenStreetMap place (ID, coordinates, address), else the user-authored full Google Maps link
// (googleMapsUrl, or on legacy plans a well-formed full place link in the mapsUrl alias, which the
// editor normalizes into googleMapsUrl on Save), else saved legacy coordinates and address. Notes,
// names, times, ordering and other fields are excluded, so unrelated edits keep the association.
// A changed or cleared location produces a different binding (or none), and the association is
// then stale.

import { parseFullGoogleMapsPlaceUrl } from "./google-maps-place-url.js?v=v-9f11ec915b16";

export const GOOGLE_PLACE_ASSOCIATION_FIELD = "googlePlaceAssociation";
export const GOOGLE_PLACE_ASSOCIATION_KEYS = Object.freeze(["placeId", "locationBinding", "publicVenueConfirmed"]);
export const LOCATION_BINDING_VERSION = "v1";
// Google Place IDs are opaque URL-safe tokens of variable length. Accept only that alphabet.
export const GOOGLE_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,256}$/;
export const LOCATION_BINDING_PATTERN = /^v1:[0-9a-f]{64}$/;

const OSM_ID = /^(?:node|way|relation)\/[1-9]\d{0,15}$/;
// Same host rule as isGoogleMapsHost in google-maps-place-url.js.
const MAPS_HOSTS = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2,3}(?:\.[a-z]{2})?)$/;

// ---------------------------------------------------------------------------------------------
// SHA-256 (synchronous, dependency-free) so the browser and Node compute identical bindings.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

const rotr = (value, bits) => (value >>> bits) | (value << (32 - bits));

/** Lower-case hex SHA-256 of the UTF-8 encoding of text. */
export function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((word) => word.toString(16).padStart(8, "0")).join("");
}

// ---------------------------------------------------------------------------------------------
// Location binding

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const coordinate = (value, limit) => (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit ? value.toFixed(7) : null);
const addressText = (value) => (typeof value === "string" ? value.normalize("NFC").replace(/\s+/g, " ").trim() : "");

/**
 * The user-authored Google Maps link of a plan, or "". googleMapsUrl wins (the server only stores
 * a well-formed one). A legacy plan may instead carry the link in the mapsUrl alias, which the
 * server stores without parsing: it counts only when it is a full place link with coordinates, by
 * the same rule the editor uses before normalizing it into googleMapsUrl, so normalization keeps
 * the same binding. A malformed alias is not a location link.
 */
function mapsLinkInput(plan) {
  if (typeof plan.googleMapsUrl === "string" && plan.googleMapsUrl.trim()) return plan.googleMapsUrl.trim();
  if (typeof plan.mapsUrl !== "string" || !plan.mapsUrl.trim()) return "";
  const parsed = parseFullGoogleMapsPlaceUrl(plan.mapsUrl);
  return parsed.ok ? parsed.url : "";
}

/**
 * The canonical location inputs of a plan, or null when the plan has no saved location. Order of
 * precedence matches the server: a selected OpenStreetMap place, then a full Google Maps link
 * (googleMapsUrl or a well-formed legacy mapsUrl alias), then saved legacy coordinates.
 */
export function locationBindingInputs(plan) {
  if (!isObject(plan)) return null;
  const place = plan.place;
  if (isObject(place) && typeof place.id === "string" && OSM_ID.test(place.id)) {
    const lat = coordinate(place.lat, 90);
    const lng = coordinate(place.lng, 180);
    if (lat !== null && lng !== null) return ["osm", place.id, lat, lng, addressText(place.address)];
  }
  const mapsLink = mapsLinkInput(plan);
  if (mapsLink) return ["maps-link", mapsLink];
  const lat = coordinate(plan.lat, 90);
  const lng = coordinate(plan.lng, 180);
  if (lat !== null && lng !== null) return ["coordinates", lat, lng, addressText(plan.address)];
  return null;
}

/** "v1:<hex>" for the plan's current location, or "" when it has none. */
export function locationBindingForPlan(plan) {
  const inputs = locationBindingInputs(plan);
  if (!inputs) return "";
  return `${LOCATION_BINDING_VERSION}:${sha256Hex(JSON.stringify([LOCATION_BINDING_VERSION, ...inputs]))}`;
}

// ---------------------------------------------------------------------------------------------
// Association shape

export function isGooglePlaceId(value) {
  return typeof value === "string" && GOOGLE_PLACE_ID_PATTERN.test(value);
}

/**
 * Structural problems of an association object, as [{ key, message }]. An empty list means the
 * shape is valid (the binding still has to match the plan; see associationMatchesPlan).
 */
export function googlePlaceAssociationProblems(raw) {
  if (!isObject(raw)) return [{ key: "", message: "must be an object with placeId, locationBinding and publicVenueConfirmed" }];
  const problems = [];
  for (const key of Object.keys(raw)) {
    if (!GOOGLE_PLACE_ASSOCIATION_KEYS.includes(key)) {
      problems.push({ key, message: "field is not allowed; only the Place ID, the location binding and the public-venue flag are stored, never Google place content" });
    }
  }
  if (!isGooglePlaceId(raw.placeId)) problems.push({ key: "placeId", message: "must be a Google Place ID (8-256 letters, digits, '-' or '_')" });
  if (typeof raw.locationBinding !== "string" || !LOCATION_BINDING_PATTERN.test(raw.locationBinding)) {
    problems.push({ key: "locationBinding", message: "must be the v1 location binding of this plan's saved location" });
  }
  if (raw.publicVenueConfirmed !== true) problems.push({ key: "publicVenueConfirmed", message: "must be true: only an explicitly confirmed public venue can be linked" });
  return problems;
}

/** A clean copy with exactly the three allowed keys, or null when the shape is invalid. */
export function normalizeGooglePlaceAssociation(raw) {
  if (googlePlaceAssociationProblems(raw).length) return null;
  return { placeId: raw.placeId, locationBinding: raw.locationBinding, publicVenueConfirmed: true };
}

/** True when the plan carries a well-formed association bound to its current location. */
export function associationMatchesPlan(plan) {
  const association = normalizeGooglePlaceAssociation(plan?.[GOOGLE_PLACE_ASSOCIATION_FIELD]);
  if (!association) return false;
  const binding = locationBindingForPlan(plan);
  return Boolean(binding) && binding === association.locationBinding;
}

/** The association to save for a plan whose final location is `plan`, or null. */
export function associationForPlan(plan, placeId) {
  const binding = locationBindingForPlan(plan);
  if (!binding || !isGooglePlaceId(placeId)) return null;
  return { placeId, locationBinding: binding, publicVenueConfirmed: true };
}

/**
 * A Place ID typed or pasted by the user: either the bare ID or a Google Maps URL that names it
 * explicitly (query_place_id=…, destination_place_id=… or a place_id:… query). Anything else,
 * including the hexadecimal feature IDs inside /maps/place/ links, is not a Place ID. Returns ""
 * when nothing valid is found. Pure parsing: no request is made.
 */
export function placeIdFromUserInput(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 4096) return "";
  const prefixed = /^place_id:([A-Za-z0-9_-]+)$/.exec(text);
  if (prefixed) return isGooglePlaceId(prefixed[1]) ? prefixed[1] : "";
  if (isGooglePlaceId(text)) return text;
  let url;
  try { url = new URL(text); } catch { return ""; }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || !MAPS_HOSTS.test(host)) return "";
  if (!host.startsWith("maps.") && !url.pathname.startsWith("/maps")) return "";
  for (const key of ["query_place_id", "destination_place_id"]) {
    const candidate = url.searchParams.get(key);
    if (candidate) return isGooglePlaceId(candidate) ? candidate : "";
  }
  for (const key of ["q", "query"]) {
    const match = /^place_id:([A-Za-z0-9_-]+)$/.exec(url.searchParams.get(key) || "");
    if (match) return isGooglePlaceId(match[1]) ? match[1] : "";
  }
  return "";
}
