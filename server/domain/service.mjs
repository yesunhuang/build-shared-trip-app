import crypto from "node:crypto";
import { normalizeContent, applyParsedPlaces, assertSafePayload, isValidId } from "./validate.mjs";
import { applyContentRules } from "./content-rules.mjs";
import { applyOperations, newId, deriveStart, deriveEnd } from "./operations.mjs";
import { importContent } from "./legacy.mjs";
import { conflict, notFound, validationError } from "./errors.mjs";

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  return value;
}
function validate(raw, previous) {
  assertSafePayload(raw);
  const { content, issues, parsedPlaces } = normalizeContent(raw);
  issues.throwIfAny();
  const urls = new Map((previous?.days || []).flatMap((day) => day.slots || []).map((slot) => [slot.id, slot.googleMapsUrl]));
  applyParsedPlaces(content, parsedPlaces, urls);
  applyContentRules(previous, content);
  return content;
}
function withAliases(trip) {
  return { ...trip, slug: trip.id, startDate: deriveStart(trip), endDate: deriveEnd(trip), routeDecoration: trip.route };
}

export class TripService {
  constructor(db) { this.db = db; }
  listTrips() {
    return { trips: this.db.prepare("SELECT data FROM trips ORDER BY archived,id").all().map(({ data }) => {
      const t = JSON.parse(data);
      return { id: t.id, title: t.title, version: t.version, archived: t.archived, dateRange: {start:deriveStart(t),end:deriveEnd(t)}, updatedAt: t.updatedAt };
    }) };
  }
  getTrip(id) {
    if (!isValidId(id)) throw notFound();
    const row = this.db.prepare("SELECT data FROM trips WHERE id=?").get(id);
    if (!row) throw notFound();
    return { trip: withAliases(JSON.parse(row.data)) };
  }
  // record(result, replayed), when given, runs inside the same transaction just before COMMIT (used for
  // payload-free audit metadata). If it throws, the whole write rolls back, so an audit entry never
  // claims a write that did not commit and no committed write lacks its entry.
  transact(scope, requestId, payload, action, record) {
    if (typeof requestId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) throw validationError("requestId must be a stable identifier of at most 128 characters.");
    assertSafePayload(payload);
    const fingerprint = crypto.createHash("sha256").update(JSON.stringify(ordered(payload))).digest("hex");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db.prepare("SELECT fingerprint,result FROM request_log WHERE scope=? AND request_id=?").get(scope, requestId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw conflict("request_id_conflict", "This request identifier was already used for different input.");
        const replay = JSON.parse(prior.result);
        record?.(replay, true);
        this.db.exec("COMMIT");
        return replay;
      }
      const result = action();
      this.db.prepare("INSERT INTO request_log VALUES(?,?,?,?)").run(scope, requestId, fingerprint, JSON.stringify(result));
      record?.(result, false);
      this.db.exec("COMMIT");
      return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  insert(content, preferredId, restored = {}) {
    let id = preferredId;
    if (!isValidId(id) || this.db.prepare("SELECT id FROM trips WHERE id=?").get(id)) id = newId("trip");
    const at = new Date().toISOString();
    if (restored.version !== undefined && (!Number.isSafeInteger(restored.version) || restored.version < 1)) throw validationError("Export version must be a positive safe integer.");
    if (restored.archived !== undefined && typeof restored.archived !== "boolean") throw validationError("Export archive state must be a boolean.");
    for (const key of ["createdAt","updatedAt"]) {
      if (restored[key] !== undefined && (typeof restored[key] !== "string" || !Number.isFinite(Date.parse(restored[key])))) throw validationError("Export timestamps must be valid date strings.");
    }
    const version = restored.version || 1;
    const trip = { ...validate(content), id, version, archived: restored.archived === true, createdAt: restored.createdAt || at, updatedAt: restored.updatedAt || at };
    this.db.prepare("INSERT INTO trips VALUES(?,?,?,?)").run(id, version, Number(trip.archived), JSON.stringify(trip));
    return { trip: withAliases(trip) };
  }
  createTrip({ requestId, trip }, record) {
    return this.transact("create", requestId, { trip }, () => this.insert(trip), record);
  }
  applyTripChanges({ tripId, requestId, expectedVersion, changes }, record) {
    return this.transact("trip:" + tripId, requestId, { tripId, expectedVersion, changes }, () => {
      const { trip: current } = this.getTrip(tripId);
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationError("expectedVersion must be a positive safe integer.");
      if (current.version !== expectedVersion) throw conflict("version_conflict", "The trip changed. Read the latest version before retrying.", { currentVersion: current.version });
      const { slug, startDate, endDate, routeDecoration, id, version, archived, createdAt, updatedAt, ...content } = current;
      const next = applyOperations({ id, version, archived, content }, changes, { expectedVersion });
      const stored = { ...validate(next.content, content), id, version: version + 1, archived: next.archived, createdAt, updatedAt: new Date().toISOString() };
      this.db.prepare("UPDATE trips SET version=?,archived=?,data=? WHERE id=?").run(stored.version, Number(stored.archived), JSON.stringify(stored), id);
      return { trip: withAliases(stored), generated: next.generated };
    }, record);
  }
  importTrip({ requestId, data }, record) {
    return this.transact("import", requestId, { data }, () => {
      const { content, preferredId, warnings } = importContent(data);
      const result = this.insert(content, preferredId, data.format ? data.trip : {});
      if (preferredId && result.trip.id !== preferredId) warnings.push("The incoming trip ID was unavailable or invalid; created a new trip instead of overwriting.");
      return { ...result, warnings };
    }, record);
  }
  exportTrip(id) {
    return { format: "shared-trip-export", formatVersion: 1, exportedAt: new Date().toISOString(), ...this.getTrip(id) };
  }
}
