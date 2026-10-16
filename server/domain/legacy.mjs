import { CONTENT_KEYS, ALIAS_KEYS, SYSTEM_KEYS, DAY_KEYS, PLAN_KEYS, REMINDER_KEYS, GROUP_KEYS, LOCATION_KEYS, assertSafePayload, isPlainObject } from "./validate.mjs";
import { newId, resolveAliases } from "./operations.mjs";
import { validationError } from "./errors.mjs";

export function importContent(data) {
  assertSafePayload(data);
  if (!isPlainObject(data)) throw validationError("Import must be a JSON object.");
  if (data.trip !== undefined && !isPlainObject(data.trip)) throw validationError("Import trip must be an object.");
  if (data.app !== undefined && !isPlainObject(data.app)) throw validationError("Authoring app must be an object.");
  if (data.format && (data.format !== "shared-trip-export" || data.formatVersion !== 1)) throw validationError("Unsupported export format.");
  const raw = structuredClone(data.trip || data);
  if (!isPlainObject(raw)) throw validationError("Import trip must be an object.");
  const warnings = [];
  function preserveExtra(object, allowed, location) {
    const keys = Object.keys(object).filter((key) => !allowed.has(key));
    if (!keys.length) return;
    const extra = Object.fromEntries(keys.map((key) => [key,object[key]]));
    keys.forEach((key) => delete object[key]);
    object.compat = { ...(object.compat || {}), unmapped: { ...(object.compat?.unmapped || {}), ...extra } };
    warnings.push("Preserved unmapped " + location + " fields in compat.unmapped: " + keys.join(", "));
  }
  if (data.app) {
    raw.title = data.app.name || raw.title;
    raw.shortName = data.app.shortName || raw.shortName;
    raw.metaDescription = data.app.metaDescription || raw.metaDescription;
    raw.theme = data.app.theme || raw.theme;
  }
  raw.title ||= raw.slug || "Imported trip";
  raw.days ||= [];
  raw.reminders ||= [];
  if (!Array.isArray(raw.days) || !Array.isArray(raw.reminders)) throw validationError("Days and reminders must be arrays.");
  for (const day of raw.days) {
    if (!isPlainObject(day)) throw validationError("Every day must be an object.");
    day.id ||= newId("day");
    day.slots ||= day.plans || [];
    if (!Array.isArray(day.slots)) throw validationError("Day plans must be an array.");
    delete day.plans;
    for (const slot of day.slots) {
      if (!isPlainObject(slot)) throw validationError("Every plan must be an object.");
      slot.id ||= newId("plan");
      preserveExtra(slot,PLAN_KEYS,"plan");
    }
    preserveExtra(day,DAY_KEYS,"day");
  }
  for (const reminder of raw.reminders) {
    if (!isPlainObject(reminder)) throw validationError("Every reminder must be an object.");
    reminder.id ||= newId("reminder");
    preserveExtra(reminder,REMINDER_KEYS,"reminder");
  }
  if (raw.participantGroups !== undefined && !Array.isArray(raw.participantGroups)) throw validationError("Participant groups must be an array.");
  if (raw.weather !== undefined && !isPlainObject(raw.weather)) throw validationError("Weather must be an object.");
  if (raw.weather?.locations !== undefined && !Array.isArray(raw.weather.locations)) throw validationError("Weather locations must be an array.");
  for (const group of raw.participantGroups || []) {
    if (!isPlainObject(group)) throw validationError("Every participant group must be an object.");
    preserveExtra(group,GROUP_KEYS,"participant group");
  }
  for (const location of raw.weather?.locations || []) {
    if (!isPlainObject(location)) throw validationError("Every weather location must be an object.");
    preserveExtra(location,LOCATION_KEYS,"weather location");
  }
  if (raw.weather?.dayLocations) {
    // Same precedence as the generated runtime: an own, non-null dayLocations entry (including an
    // explicit [] "off") is that day's explicit choice; a day without one keeps its own field, and
    // a day with neither stays automatic (property absent).
    const dayLocations = isPlainObject(raw.weather.dayLocations) ? raw.weather.dayLocations : {};
    for (const day of raw.days) {
      const mapped = Object.hasOwn(dayLocations, day.id) ? dayLocations[day.id] : undefined;
      if (mapped !== undefined && mapped !== null) day.weatherLocationIds = [].concat(mapped);
    }
    raw.content = { ...(raw.content || {}), legacyWeatherDayLocations: raw.weather.dayLocations };
    delete raw.weather.dayLocations;
    warnings.push("Mapped weather.dayLocations to per-day weatherLocationIds; original retained in content.");
  }
  const allowed = new Set([...CONTENT_KEYS, ...ALIAS_KEYS, ...SYSTEM_KEYS]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  for (const key of unknown) { warnings.push("Preserved unmapped trip field in content.importExtras: " + key); }
  const extra = Object.fromEntries(unknown.map((key) => [key, raw[key]]));
  unknown.forEach((key) => delete raw[key]);
  if ((data.trip && !data.format) || Object.keys(extra).length) {
    raw.content = { ...(raw.content || {}), importExtras: extra };
    // Preserve the authoring envelope without coupling runtime to its backend.
    raw.content.authoringEnvelope = Object.fromEntries(Object.entries(data).filter(([key]) => key !== "trip"));
    if (data.trip && !data.format) warnings.push("Authoring envelope retained in content.authoringEnvelope; only supported content fields affect the app.");
    if (data.sync) warnings.push("Legacy synchronization configuration retained as content; no external backend is contacted.");
  }
  const content = resolveAliases(raw);
  if (raw.dateRange !== undefined) content.dateRange = raw.dateRange;
  return { content, preferredId: data.format ? raw.id : (raw.id || raw.slug), warnings };
}
