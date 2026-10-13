// Write-time content rules shared by every edit path (web, MCP, replace_content,
// import). They fix two editing bugs found in review:
//  1. editing a source-language field must not leave an older translation that
//     would override the new value; dependent i18n fields are dropped so the UI
//     falls back to the source text (no translation model is called);
//  2. editing a time must keep sortTime/sortOrder and the actual order consistent.

import { deriveSortTime, isPlainObject } from "./validate.mjs";

// i18n patch key -> source fields it depends on (default: same key).
const ROOT_ALIASES = Object.freeze({ routeDecoration: ["route"], route: ["route"] });

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a && b && typeof a === "object") {
    if (Array.isArray(b)) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]));
  }
  return false;
}

/**
 * Drop next.i18n[locale][key] when the source field(s) for key changed between
 * prev and next, unless the caller also changed that same translation.
 * Returns the number of removed translated fields.
 */
export function invalidateDependentI18n(prev, next, aliases = {}) {
  if (!prev || !isPlainObject(next) || !isPlainObject(next.i18n)) return 0;
  let removed = 0;
  for (const locale of Object.keys(next.i18n)) {
    const patch = next.i18n[locale];
    if (!isPlainObject(patch)) continue;
    const prevPatch = isPlainObject(prev.i18n?.[locale]) ? prev.i18n[locale] : {};
    for (const key of Object.keys(patch)) {
      const sources = aliases[key] || [key];
      const sourceChanged = sources.some((source) => !deepEqual(prev[source], next[source]));
      if (!sourceChanged) continue;
      const translationChangedByCaller = !deepEqual(prevPatch[key], patch[key]);
      if (translationChangedByCaller) continue;
      delete patch[key];
      removed += 1;
    }
    if (!Object.keys(patch).length) delete next.i18n[locale];
  }
  if (!Object.keys(next.i18n).length) delete next.i18n;
  return removed;
}

function byId(list) {
  const map = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    if (item && typeof item === "object" && item.id) map.set(item.id, item);
  }
  return map;
}

function invalidateRecommendations(prevDay, nextDay) {
  const prevRecs = prevDay?.recommendations;
  const nextRecs = nextDay?.recommendations;
  if (!isPlainObject(prevRecs) || !isPlainObject(nextRecs)) return;
  for (const category of Object.keys(nextRecs)) {
    const nextList = nextRecs[category];
    const prevList = prevRecs[category];
    if (!Array.isArray(nextList) || !Array.isArray(prevList)) continue;
    nextList.forEach((item, index) => {
      if (isPlainObject(item) && isPlainObject(prevList[index])) invalidateDependentI18n(prevList[index], item);
    });
  }
}

const PERIOD_RANK = Object.freeze({ morning: 0, noon: 1, evening: 2 });

function startMinutes(slot) {
  const value = slot.sortTime || deriveSortTime(slot.time);
  if (!value) return Number.POSITIVE_INFINITY;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Recompute sort metadata for one day. prevSlots maps plan id -> previous plan
 * (anywhere in the previous trip). Returns true when the day was re-sorted.
 */
export function reconcileDaySchedule(day, prevSlots, prevDaySlotIds) {
  let scheduleChanged = false;
  let existingTimeChanged = false;
  for (const slot of day.slots) {
    const prev = prevSlots.get(slot.id);
    const timeChanged = !prev || prev.time !== slot.time || prev.period !== slot.period;
    const callerSetSortTime = prev ? prev.sortTime !== slot.sortTime : slot.sortTime !== undefined;
    if (timeChanged && !callerSetSortTime) {
      const derived = deriveSortTime(slot.time);
      if (derived) slot.sortTime = derived;
      else delete slot.sortTime;
    }
    if (prev && timeChanged) existingTimeChanged = true;
    if (timeChanged || !prevDaySlotIds.has(slot.id)) scheduleChanged = true;
  }
  const usesSortOrder = day.slots.some((slot) => slot.sortOrder !== undefined);
  const partialSortOrder = usesSortOrder && day.slots.some((slot) => slot.sortOrder === undefined);
  if (!scheduleChanged && !partialSortOrder) return false;

  if (usesSortOrder && !partialSortOrder && !existingTimeChanged) {
    // Only additions/moves that carry an explicit, complete manual order: keep it,
    // and make the array order match the metadata.
    day.slots = day.slots
      .map((slot, index) => ({ slot, index }))
      .sort((a, b) => a.slot.sortOrder - b.slot.sortOrder || a.index - b.index)
      .map(({ slot }) => slot);
    return true;
  }

  const decorated = day.slots.map((slot, index) => ({
    slot,
    period: PERIOD_RANK[slot.period] ?? 3,
    minutes: startMinutes(slot),
    index
  }));
  decorated.sort((a, b) => a.period - b.period || a.minutes - b.minutes || a.index - b.index);
  day.slots = decorated.map(({ slot }) => slot);
  if (usesSortOrder) day.slots.forEach((slot, index) => { slot.sortOrder = index + 1; });
  return true;
}

/**
 * Apply all write-time rules to a validated next content, comparing with the
 * previous content (null for a new trip). Mutates next.
 */
export function applyContentRules(prev, next) {
  const previous = prev || { days: [], reminders: [], participantGroups: [] };
  invalidateDependentI18n(prev, next, ROOT_ALIASES);

  const prevGroups = byId(previous.participantGroups);
  for (const group of next.participantGroups) invalidateDependentI18n(prevGroups.get(group.id), group);

  const prevLocations = byId(previous.weather?.locations);
  for (const location of next.weather?.locations || []) invalidateDependentI18n(prevLocations.get(location.id), location);

  const prevReminders = byId(previous.reminders);
  for (const reminder of next.reminders) invalidateDependentI18n(prevReminders.get(reminder.id), reminder);

  const prevDays = byId(previous.days);
  const prevSlots = new Map();
  for (const day of previous.days || []) for (const slot of day.slots || []) prevSlots.set(slot.id, slot);

  for (const day of next.days) {
    const prevDay = prevDays.get(day.id);
    invalidateDependentI18n(prevDay, day);
    invalidateRecommendations(prevDay, day);
    for (const slot of day.slots) invalidateDependentI18n(prevSlots.get(slot.id), slot);
    const prevDaySlotIds = new Set((prevDay?.slots || []).map((slot) => slot.id));
    reconcileDaySchedule(day, prevSlots, prevDaySlotIds);
  }
  return next;
}
