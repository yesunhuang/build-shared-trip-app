// Daily weather association: which forecast points belong to each trip day.
//
// Pure, DOM-free and side-effect-free, so the browser, the tests and (through the same schema) the
// server agree. Nothing here geocodes, parses names/addresses/labels/flight text, contacts a
// provider or invents a place: automatic points come only from valid numeric lat/lng already saved
// on that day's own plans, and every representative is one of those saved coordinates.
//
// Schema (no new stored fields; see references/weather-association.md):
//   - day.weatherLocationIds ABSENT (or null)  -> automatic, inferred in memory on every render
//   - day.weatherLocationIds = []               -> explicit "off" for that day
//   - day.weatherLocationIds = ["id", ...]      -> manual choice of trip.weather.locations entries
//   - legacy trip.weather.dayLocations[dayId] (generator input) keeps its earlier precedence over
//     day.weatherLocationIds when it has an own, non-null value for that day.

export const AUTO_AREA_DIAMETER_KM = 20;
export const POINT_KEY_DECIMALS = 4;
export const FORECAST_HORIZON_DAYS = 16;
export const MAX_POINTS_PER_REQUEST = 40;
export const MAX_TRIP_FORECAST_POINTS = 120;
export const MAX_WEATHER_LOCATIONS = 60;
export const WEATHER_MODES = Object.freeze(["auto", "manual", "off"]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * A usable saved coordinate: two finite numbers in range (the same range the server validates).
 * Every in-range pair is real, including (0, 0); missing values, strings, NaN/Infinity and
 * out-of-range values are not usable.
 */
export function isValidCoordinate(lat, lng) {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Stable fetch identity of a coordinate (about 11 m); duplicates and aliases share one key. */
export function pointKey(lat, lng) {
  const round = (value) => {
    const fixed = Number(value).toFixed(POINT_KEY_DECIMALS);
    return fixed === `-${(0).toFixed(POINT_KEY_DECIMALS)}` ? (0).toFixed(POINT_KEY_DECIMALS) : fixed;
  };
  return `${round(lat)},${round(lng)}`;
}

export function distanceKm(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Distinct saved points of one day's real plans (day.slots), in plan order. Day labels, areas,
 * themes, recommendations, names, addresses and links are never read. Plans sharing a coordinate
 * (for example the same hotel at check-in and check-out) collapse into one point that lists both.
 */
export function savedDayPoints(day) {
  const slots = Array.isArray(day?.slots) ? day.slots : [];
  const byKey = new Map();
  slots.forEach((slot) => {
    if (!isObject(slot) || !isValidCoordinate(slot.lat, slot.lng)) return;
    const key = pointKey(slot.lat, slot.lng);
    const existing = byKey.get(key);
    const slotId = typeof slot.id === "string" ? slot.id : "";
    if (existing) {
      if (slotId) existing.slotIds.push(slotId);
      return;
    }
    byKey.set(key, { key, lat: slot.lat, lng: slot.lng, slotId, slotIds: slotId ? [slotId] : [] });
  });
  return [...byKey.values()];
}

/**
 * Complete-linkage grouping: a point joins a group only if it is within the diameter of EVERY
 * member, so a chain of nearby stops can never pull a genuinely distant group together. Ties go to
 * the tighter group, then the earlier one. The representative is the medoid: the member saved
 * point with the smallest total distance to the others (earliest on ties), never a computed centre.
 */
export function groupDayPoints(points, { diameterKm = AUTO_AREA_DIAMETER_KM } = {}) {
  const groups = [];
  for (const point of points) {
    let best = null;
    let bestSpread = Infinity;
    for (const group of groups) {
      const spread = Math.max(...group.members.map((member) => distanceKm(member, point)));
      if (spread <= diameterKm && spread < bestSpread) {
        best = group;
        bestSpread = spread;
      }
    }
    if (best) best.members.push(point);
    else groups.push({ members: [point] });
  }
  return groups.map((group) => {
    let representative = group.members[0];
    let bestTotal = Infinity;
    for (const candidate of group.members) {
      const total = group.members.reduce((sum, member) => sum + distanceKm(candidate, member), 0);
      if (total < bestTotal - 1e-9) {
        representative = candidate;
        bestTotal = total;
      }
    }
    return {
      representative,
      members: group.members,
      slotIds: group.members.flatMap((member) => member.slotIds)
    };
  });
}

/** Usable explicit locations (valid ID and coordinates), keyed by ID. Invalid entries are kept out. */
export function usableWeatherLocations(trip) {
  const list = Array.isArray(trip?.weather?.locations) ? trip.weather.locations : [];
  const map = new Map();
  list.forEach((location) => {
    if (!isObject(location) || typeof location.id !== "string" || !ID_PATTERN.test(location.id)) return;
    if (!isValidCoordinate(location.lat, location.lng) || map.has(location.id)) return;
    map.set(location.id, location);
  });
  return map;
}

/**
 * The stored choice for one day, distinguishing absence (automatic) from an explicit empty list.
 * Returns { mode, ids, source } where source is "legacy-map", "day" or "auto".
 */
export function explicitDayChoice(trip, day) {
  const dayId = typeof day?.id === "string" ? day.id : "";
  const legacy = isObject(trip?.weather?.dayLocations) ? trip.weather.dayLocations : null;
  let raw;
  let source = "auto";
  if (legacy && dayId && Object.hasOwn(legacy, dayId) && legacy[dayId] !== null && legacy[dayId] !== undefined) {
    raw = legacy[dayId];
    source = "legacy-map";
  } else if (isObject(day) && Object.hasOwn(day, "weatherLocationIds") && day.weatherLocationIds !== null && day.weatherLocationIds !== undefined) {
    raw = day.weatherLocationIds;
    source = "day";
  }
  if (source === "auto") return { mode: "auto", ids: [], source };
  const ids = [].concat(raw).filter((id) => typeof id === "string");
  return { mode: ids.length ? "manual" : "off", ids: [...new Set(ids)], source };
}

/**
 * Forecast entries for one day. Manual entries reference stored locations (unknown or
 * coordinate-less IDs are skipped, never replaced by automatic ones); automatic entries are
 * in-memory areas of that day's own saved plan coordinates; "off" has no entries.
 */
export function resolveDayWeather(trip, day, { locations = usableWeatherLocations(trip), diameterKm = AUTO_AREA_DIAMETER_KM } = {}) {
  const choice = explicitDayChoice(trip, day);
  const base = { dayId: day?.id || "", date: typeof day?.date === "string" ? day.date : "", mode: choice.mode, source: choice.source, entries: [] };
  if (choice.mode === "off") return base;
  if (choice.mode === "manual") {
    base.storedIds = choice.ids;
    base.entries = choice.ids.filter((id) => locations.has(id)).map((id) => {
      const location = locations.get(id);
      return { id: `location:${id}`, kind: "location", locationId: id, lat: location.lat, lng: location.lng, key: pointKey(location.lat, location.lng) };
    });
    return base;
  }
  base.entries = groupDayPoints(savedDayPoints(day), { diameterKm }).map((group, index) => ({
    id: `area:${group.representative.key}`,
    kind: "area",
    index: index + 1,
    lat: group.representative.lat,
    lng: group.representative.lng,
    key: group.representative.key,
    representativeSlotId: group.representative.slotId,
    slotIds: group.slotIds,
    memberCount: group.members.length
  }));
  return base;
}

/** Associations for every day of a trip. Recomputed from the current trip on demand. */
export function resolveTripWeather(trip, options = {}) {
  const locations = usableWeatherLocations(trip);
  const days = new Map();
  (Array.isArray(trip?.days) ? trip.days : []).forEach((day) => {
    if (!isObject(day) || typeof day.id !== "string" || !day.id) return;
    days.set(day.id, resolveDayWeather(trip, day, { ...options, locations }));
  });
  return { timezone: typeof trip?.timezone === "string" && trip.timezone ? trip.timezone : "UTC", locations, days };
}

/** YYYY-MM-DD for an instant in an IANA time zone (UTC when the zone is unusable). */
export function dateInTimeZone(nowMs, timeZone) {
  const format = (zone) => new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowMs));
  try { return format(timeZone || "UTC"); } catch { return format("UTC"); }
}

export function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/**
 * Which unique points need a forecast now: only days dated inside the provider's 16-day window
 * (today in the trip time zone through today + 15), never "off" days or days without points.
 * Repeated coordinates across days and explicit/automatic aliases share one point. The result is
 * capped and split into bounded batches; identity changes when the needed points, time zone or
 * provider-local day changes (never on language, notes or unrelated edits).
 */
export function forecastRequestPlan(resolved, { nowMs = Date.now(), horizonDays = FORECAST_HORIZON_DAYS, maxPoints = MAX_TRIP_FORECAST_POINTS, batchSize = MAX_POINTS_PER_REQUEST } = {}) {
  const timezone = resolved?.timezone || "UTC";
  const today = dateInTimeZone(nowMs, timezone);
  const last = addDays(today, horizonDays - 1);
  const points = new Map();
  for (const day of resolved?.days?.values?.() || []) {
    if (!DATE_PATTERN.test(day.date) || day.date < today || day.date > last) continue;
    for (const entry of day.entries) {
      if (points.has(entry.key)) continue;
      if (points.size >= maxPoints) break;
      points.set(entry.key, { key: entry.key, lat: entry.lat, lng: entry.lng });
    }
  }
  const keys = [...points.keys()].sort();
  const batches = [];
  for (let index = 0; index < keys.length; index += batchSize) batches.push(keys.slice(index, index + batchSize).map((key) => points.get(key)));
  return { timezone, today, lastDate: last, keys, points, batches, identity: `${timezone}|${today}|${keys.join(";")}` };
}

// ---------------------------------------------------------------------------------------------
// Editing: one day's choice -> the smallest validated change set. The same changes are sent by the
// web editor through apply_trip_changes and can be sent by any MCP client.

/** Validate a coordinate pick typed by an editor. Returns { ok, lat, lng } or { ok: false, reason }. */
export function parseCoordinateEntry(latText, lngText) {
  const clean = (value) => String(value ?? "").trim();
  const latRaw = clean(latText);
  const lngRaw = clean(lngText);
  const numeric = /^[-+]?(?:\d+(?:\.\d+)?|\.\d+)$/;
  if (!numeric.test(latRaw) || !numeric.test(lngRaw)) return { ok: false, reason: "format" };
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (!isValidCoordinate(lat, lng)) return { ok: false, reason: "range" };
  return { ok: true, lat, lng };
}

/**
 * Build changes for a day.
 *   choice = { mode: "auto" } | { mode: "off" }
 *          | { mode: "manual", picks: [{ locationId } | { newLocationId, name, lat, lng }] }
 * New locations carry their pre-generated stable ID (so an identical retry is byte-identical); a
 * new pick with the same coordinates as an existing location reuses that location instead.
 * Returns { ok: true, changes, ids } or { ok: false, reason }.
 */
export function buildDayWeatherChanges(trip, dayId, choice) {
  const day = (Array.isArray(trip?.days) ? trip.days : []).find((candidate) => candidate?.id === dayId);
  if (!day) return { ok: false, reason: "missing-day" };
  if (!isObject(choice) || !WEATHER_MODES.includes(choice.mode)) return { ok: false, reason: "mode" };
  if (choice.mode === "auto") return { ok: true, ids: null, changes: [{ type: "upsert_day", day: { id: dayId, weatherLocationIds: null } }] };
  if (choice.mode === "off") return { ok: true, ids: [], changes: [{ type: "upsert_day", day: { id: dayId, weatherLocationIds: [] } }] };
  const picks = Array.isArray(choice.picks) ? choice.picks : [];
  if (!picks.length) return { ok: false, reason: "empty" };
  const stored = Array.isArray(trip?.weather?.locations) ? trip.weather.locations : [];
  const usable = usableWeatherLocations(trip);
  const byKey = new Map([...usable.values()].map((location) => [pointKey(location.lat, location.lng), location.id]));
  const takenIds = new Set(stored.map((location) => location?.id).filter(Boolean));
  const additions = [];
  const ids = [];
  for (const pick of picks) {
    if (!isObject(pick)) return { ok: false, reason: "pick" };
    if (typeof pick.locationId === "string") {
      if (!usable.has(pick.locationId)) return { ok: false, reason: "unknown-location" };
      if (!ids.includes(pick.locationId)) ids.push(pick.locationId);
      continue;
    }
    if (!isValidCoordinate(pick.lat, pick.lng)) return { ok: false, reason: "coordinates" };
    const key = pointKey(pick.lat, pick.lng);
    const reuse = byKey.get(key);
    if (reuse) {
      if (!ids.includes(reuse)) ids.push(reuse);
      continue;
    }
    if (typeof pick.newLocationId !== "string" || !ID_PATTERN.test(pick.newLocationId) || takenIds.has(pick.newLocationId)) return { ok: false, reason: "id" };
    const name = typeof pick.name === "string" ? pick.name.trim().slice(0, 200) : "";
    const location = { id: pick.newLocationId, lat: pick.lat, lng: pick.lng };
    if (name) location.name = name;
    // Localized names copied from the chosen plan's own reviewed translations (never generated).
    if (isObject(pick.i18n)) {
      const i18n = {};
      for (const locale of ["en", "zh-Hans", "zh-Hant", "ja"]) {
        const localized = pick.i18n[locale]?.name;
        if (typeof localized === "string" && localized.trim() && localized.trim() !== name) i18n[locale] = { name: localized.trim().slice(0, 200) };
      }
      if (Object.keys(i18n).length) location.i18n = i18n;
    }
    additions.push(location);
    takenIds.add(location.id);
    byKey.set(key, location.id);
    ids.push(location.id);
  }
  if (stored.length + additions.length > MAX_WEATHER_LOCATIONS) return { ok: false, reason: "limit" };
  const changes = [];
  if (additions.length) {
    const weather = isObject(trip.weather) ? { ...trip.weather } : {};
    delete weather.dayLocations;
    weather.locations = [...stored, ...additions];
    changes.push({ type: "update_trip", fields: { weather } });
  }
  changes.push({ type: "upsert_day", day: { id: dayId, weatherLocationIds: ids } });
  return { ok: true, ids, changes, additions };
}

/**
 * Apply such changes to an in-memory trip (local preview / Firebase mode, which has no server).
 * A legacy weather.dayLocations entry for that day is removed so the new choice is authoritative;
 * other days and other locations are left exactly as they were.
 */
export function applyDayWeatherChangesLocally(trip, dayId, changes) {
  for (const change of changes) {
    if (change.type === "update_trip" && isObject(change.fields?.weather)) {
      const legacy = isObject(trip.weather?.dayLocations) ? trip.weather.dayLocations : null;
      trip.weather = { ...change.fields.weather };
      if (legacy) trip.weather.dayLocations = legacy;
    }
    if (change.type === "upsert_day" && change.day?.id === dayId) {
      const day = trip.days.find((candidate) => candidate?.id === dayId);
      if (!day) continue;
      if (change.day.weatherLocationIds === null) delete day.weatherLocationIds;
      else day.weatherLocationIds = [...change.day.weatherLocationIds];
    }
  }
  if (isObject(trip.weather?.dayLocations) && Object.hasOwn(trip.weather.dayLocations, dayId)) {
    const rest = { ...trip.weather.dayLocations };
    delete rest[dayId];
    trip.weather.dayLocations = rest;
  }
  return trip;
}
