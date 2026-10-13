// Pure batch-operation application. Produces a raw next-content draft that the
// service then validates as a whole; nothing is persisted here.

import crypto from "node:crypto";
import { DomainError, conflict, validationError } from "./errors.mjs";
import { ALIAS_KEYS, CONTENT_KEYS, LIMITS, SYSTEM_KEYS, isPlainObject, isValidId } from "./validate.mjs";

export const OPERATION_TYPES = Object.freeze([
  "update_trip", "upsert_day", "delete_day", "upsert_plan", "delete_plan",
  "upsert_reminder", "delete_reminder", "archive_trip", "replace_content"
]);

const OPERATION_KEYS = Object.freeze({
  update_trip: ["type", "fields"],
  upsert_day: ["type", "day"],
  delete_day: ["type", "dayId"],
  upsert_plan: ["type", "dayId", "plan"],
  delete_plan: ["type", "dayId", "planId"],
  upsert_reminder: ["type", "reminder"],
  delete_reminder: ["type", "reminderId"],
  archive_trip: ["type", "archived"],
  replace_content: ["type", "trip"]
});

// update_trip may change trip metadata and trip-level collections, but not the
// day/reminder collections (use the dedicated operations or replace_content).
const UPDATABLE_FIELDS = new Set(CONTENT_KEYS.filter((key) => !["days", "reminders"].includes(key)));
const REQUIRED_CONTENT = new Set(["title"]);

export function newId(prefix) {
  return `${prefix}-${crypto.randomBytes(6).toString("hex")}`;
}

function targetNotFound(path, message) {
  return new DomainError("target_not_found", 404, message, { details: [{ path, message }] });
}

/** Map read-only aliases onto canonical content fields. */
export function resolveAliases(raw, base) {
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!ALIAS_KEYS.includes(key) && !SYSTEM_KEYS.includes(key)) out[key] = raw[key];
  }
  const baseRange = base?.dateRange || { start: "", end: "" };
  const range = isPlainObject(out.dateRange) ? { ...out.dateRange } : out.dateRange;
  const rangeTouched = isPlainObject(range)
    && (range.start !== baseRange.start || range.end !== baseRange.end);
  if (!rangeTouched && (raw.startDate !== undefined || raw.endDate !== undefined)) {
    const next = isPlainObject(range) ? range : { ...baseRange };
    if (raw.startDate !== undefined && raw.startDate !== deriveStart(base)) next.start = raw.startDate ?? "";
    if (raw.endDate !== undefined && raw.endDate !== deriveEnd(base)) next.end = raw.endDate ?? "";
    out.dateRange = next;
  } else if (range !== undefined) {
    out.dateRange = range;
  }
  if (raw.routeDecoration !== undefined && (out.route === undefined || out.route === base?.route)
    && raw.routeDecoration !== base?.route) {
    out.route = raw.routeDecoration;
  }
  return out;
}

export function deriveStart(content) {
  return content?.dateRange?.start || content?.days?.[0]?.date || "";
}

export function deriveEnd(content) {
  return content?.dateRange?.end || content?.days?.at?.(-1)?.date || deriveStart(content);
}

function mergeObject(existing, patch) {
  const out = { ...(existing || {}) };
  for (const key of Object.keys(patch)) {
    if (patch[key] === null) delete out[key];
    else out[key] = patch[key];
  }
  return out;
}

function requireObject(value, path, label) {
  if (!isPlainObject(value)) throw validationError([{ path, message: `${label} must be an object` }]);
  return value;
}

function requireId(value, path, label) {
  if (!isValidId(value)) throw validationError([{ path, message: `${label} must be a valid ID` }]);
  return value;
}

function uniqueId(prefix, taken) {
  let id;
  do id = newId(prefix); while (taken.has(id));
  return id;
}

function allPlanIds(content) {
  const ids = new Set();
  for (const day of content.days || []) {
    for (const slot of (Array.isArray(day?.slots) ? day.slots : [])) if (slot?.id) ids.add(slot.id);
  }
  return ids;
}

/**
 * Apply operations to a deep copy of the current trip state.
 * @returns {{ content: object, archived: boolean, generated: object[] }}
 */
export function applyOperations(current, changes, { expectedVersion }) {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > LIMITS.operations) {
    throw validationError([{ path: "changes", message: `must be an array of 1-${LIMITS.operations} operations` }]);
  }
  const content = structuredClone(current.content);
  content.days = Array.isArray(content.days) ? content.days : [];
  content.reminders = Array.isArray(content.reminders) ? content.reminders : [];
  let archived = current.archived;
  const generated = [];

  changes.forEach((operation, index) => {
    const path = `changes[${index}]`;
    requireObject(operation, path, "operation");
    const type = operation.type;
    if (!OPERATION_TYPES.includes(type)) {
      throw validationError([{ path: `${path}.type`, message: `must be one of ${OPERATION_TYPES.join(", ")}` }]);
    }
    const unknown = Object.keys(operation).filter((key) => !OPERATION_KEYS[type].includes(key));
    if (unknown.length) {
      throw validationError(unknown.map((key) => ({ path: `${path}.${key}`, message: `field is not allowed for ${type}` })));
    }
    if (archived && type !== "archive_trip") {
      throw conflict("trip_archived", "The trip is archived. Unarchive it (archive_trip with archived:false) before editing.", { details: [{ path }] });
    }

    switch (type) {
      case "update_trip": {
        const fields = requireObject(operation.fields, `${path}.fields`, "fields");
        const issues = [];
        for (const key of Object.keys(fields)) {
          if (!UPDATABLE_FIELDS.has(key) && !["startDate", "endDate", "routeDecoration"].includes(key)) {
            issues.push({ path: `${path}.fields.${key}`, message: "field cannot be changed with update_trip" });
          } else if (fields[key] === null && REQUIRED_CONTENT.has(key)) {
            issues.push({ path: `${path}.fields.${key}`, message: "field is required" });
          }
        }
        if (issues.length) throw validationError(issues);
        const resolved = resolveAliases(fields, content);
        if (isPlainObject(resolved.dateRange)) {
          resolved.dateRange = { ...(content.dateRange || { start: "", end: "" }), ...resolved.dateRange };
        }
        for (const key of Object.keys(resolved)) {
          if (resolved[key] === null) delete content[key];
          else content[key] = resolved[key];
        }
        break;
      }
      case "upsert_day": {
        const day = requireObject(operation.day, `${path}.day`, "day");
        const patch = { ...day };
        if (patch.plans !== undefined && patch.slots === undefined) {
          patch.slots = patch.plans;
        }
        delete patch.plans;
        if (patch.id === undefined) {
          patch.id = uniqueId("day", new Set(content.days.map((item) => item?.id)));
          generated.push({ operation: index, kind: "day", id: patch.id });
        } else requireId(patch.id, `${path}.day.id`, "day.id");
        const existingIndex = content.days.findIndex((item) => item?.id === patch.id);
        if (existingIndex >= 0) content.days[existingIndex] = mergeObject(content.days[existingIndex], patch);
        else content.days.push(mergeObject({ slots: [] }, patch));
        break;
      }
      case "delete_day": {
        const dayId = requireId(operation.dayId, `${path}.dayId`, "dayId");
        const before = content.days.length;
        content.days = content.days.filter((item) => item?.id !== dayId);
        if (content.days.length === before) throw targetNotFound(`${path}.dayId`, `Day '${dayId}' does not exist in this trip.`);
        break;
      }
      case "upsert_plan": {
        const dayId = requireId(operation.dayId, `${path}.dayId`, "dayId");
        const plan = requireObject(operation.plan, `${path}.plan`, "plan");
        const day = content.days.find((item) => item?.id === dayId);
        if (!day) throw targetNotFound(`${path}.dayId`, `Day '${dayId}' does not exist in this trip.`);
        day.slots = Array.isArray(day.slots) ? day.slots : [];
        const patch = { ...plan };
        if (patch.id === undefined) {
          patch.id = uniqueId("plan", allPlanIds(content));
          generated.push({ operation: index, kind: "plan", id: patch.id, dayId });
        } else requireId(patch.id, `${path}.plan.id`, "plan.id");
        let existing = null;
        for (const candidateDay of content.days) {
          if (!isPlainObject(candidateDay)) continue;
          const slots = Array.isArray(candidateDay.slots) ? candidateDay.slots : [];
          const found = slots.findIndex((slot) => slot?.id === patch.id);
          if (found < 0) continue;
          existing = slots[found];
          if (candidateDay !== day) candidateDay.slots = slots.filter((_, slotIndex) => slotIndex !== found);
          else {
            slots[found] = mergeObject(existing, patch);
            existing = "updated-in-place";
          }
          break;
        }
        if (existing !== "updated-in-place") day.slots.push(mergeObject(existing, patch));
        break;
      }
      case "delete_plan": {
        const dayId = requireId(operation.dayId, `${path}.dayId`, "dayId");
        const planId = requireId(operation.planId, `${path}.planId`, "planId");
        const day = content.days.find((item) => item?.id === dayId);
        if (!day) throw targetNotFound(`${path}.dayId`, `Day '${dayId}' does not exist in this trip.`);
        const slots = Array.isArray(day.slots) ? day.slots : [];
        if (!slots.some((slot) => slot?.id === planId)) {
          throw targetNotFound(`${path}.planId`, `Plan '${planId}' does not exist on day '${dayId}'.`);
        }
        day.slots = slots.filter((slot) => slot?.id !== planId);
        break;
      }
      case "upsert_reminder": {
        const reminder = requireObject(operation.reminder, `${path}.reminder`, "reminder");
        const patch = { ...reminder };
        if (patch.id === undefined) {
          patch.id = uniqueId("reminder", new Set(content.reminders.map((item) => item?.id)));
          generated.push({ operation: index, kind: "reminder", id: patch.id });
        } else requireId(patch.id, `${path}.reminder.id`, "reminder.id");
        const existingIndex = content.reminders.findIndex((item) => item?.id === patch.id);
        if (existingIndex >= 0) content.reminders[existingIndex] = mergeObject(content.reminders[existingIndex], patch);
        else content.reminders.push(mergeObject({ done: false }, patch));
        break;
      }
      case "delete_reminder": {
        const reminderId = requireId(operation.reminderId, `${path}.reminderId`, "reminderId");
        const before = content.reminders.length;
        content.reminders = content.reminders.filter((item) => item?.id !== reminderId);
        if (content.reminders.length === before) throw targetNotFound(`${path}.reminderId`, `Reminder '${reminderId}' does not exist in this trip.`);
        break;
      }
      case "archive_trip": {
        if (typeof operation.archived !== "boolean") {
          throw validationError([{ path: `${path}.archived`, message: "must be true or false" }]);
        }
        archived = operation.archived;
        break;
      }
      case "replace_content": {
        const trip = requireObject(operation.trip, `${path}.trip`, "trip");
        if (trip.id !== current.id) {
          throw validationError([{ path: `${path}.trip.id`, message: "must equal the target trip ID; trip IDs never change" }]);
        }
        if (!Number.isInteger(trip.version)) {
          throw validationError([{ path: `${path}.trip.version`, message: "must be the version of the snapshot being replaced" }]);
        }
        if (trip.version !== expectedVersion || trip.version !== current.version) {
          throw conflict("version_conflict", "The submitted snapshot is not the current trip version. Reload and reapply the change.", {
            currentVersion: current.version
          });
        }
        const next = resolveAliases(trip, content);
        // Archive state is only changed through archive_trip.
        for (const key of Object.keys(content)) delete content[key];
        Object.assign(content, next);
        if (!Array.isArray(content.days)) content.days = [];
        if (!Array.isArray(content.reminders)) content.reminders = [];
        break;
      }
      default:
        break;
    }
  });
  return { content, archived, generated };
}
