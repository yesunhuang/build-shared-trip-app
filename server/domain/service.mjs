import crypto from "node:crypto";
import {
  GOOGLE_PLACE_PHOTOS_FIELD, normalizeContent, applyGooglePlaceAssociations, applyParsedPlaces, applySelectedPlaces, assertSafePayload,
  isValidId, tripGooglePlacePhotosEnabled
} from "./validate.mjs";
import { applyContentRules } from "./content-rules.mjs";
import { applyOperations, newId, deriveStart, deriveEnd } from "./operations.mjs";
import { importContent } from "./legacy.mjs";
import { conflict, notFound, tripDeleted, validationError } from "./errors.mjs";

const DELETE_KEYS = new Set(["tripId", "requestId", "expectedVersion"]);
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
// Retry records of a permanently deleted trip are rewritten to this minimal marker. The request ID and
// fingerprint stay, so an identical stale replay is refused (410 trip_deleted) instead of returning
// deleted content or recreating the trip, and a changed payload still gets 409 request_id_conflict.
const deletionMarker = (tripId, version) => JSON.stringify({ deletedTrip: { tripId, version } });

function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
  return value;
}
function validate(raw, previous) {
  assertSafePayload(raw);
  const { content, issues, parsedPlaces } = normalizeContent(raw);
  issues.throwIfAny();
  // A plan whose selected place is removed re-derives its location from its legacy Google URL (the
  // URL is treated as changed); while a place is selected, the place owns lat/lng/address.
  const urls = new Map((previous?.days || []).flatMap((day) => day.slots || []).map((slot) => [slot.id, slot.place ? null : slot.googleMapsUrl]));
  applyParsedPlaces(content, parsedPlaces, urls);
  applySelectedPlaces(content, previous);
  // A Google place association stays only while it is bound to the plan's final location; a stale
  // carried-over one is dropped and a mismatched new one refuses the write (see validate.mjs).
  applyGooglePlaceAssociations(content, previous);
  applyContentRules(previous, content);
  return content;
}
// Read projection. Rows stored before trip.googlePlacePhotosEnabled existed are left untouched in
// the database and read as false; the next ordinary write stores the explicit value.
function withAliases(trip) {
  return {
    ...trip, [GOOGLE_PLACE_PHOTOS_FIELD]: tripGooglePlacePhotosEnabled(trip),
    slug: trip.id, startDate: deriveStart(trip), endDate: deriveEnd(trip), routeDecoration: trip.route
  };
}

export class TripService {
  constructor(db) { this.db = db; }
  listTrips() {
    return { trips: this.db.prepare("SELECT data FROM trips ORDER BY archived,id").all().map(({ data }) => {
      const t = JSON.parse(data);
      return { id: t.id, title: t.title, version: t.version, archived: t.archived, dateRange: {start:deriveStart(t),end:deriveEnd(t)}, updatedAt: t.updatedAt, ...(t.cover?{cover:t.cover}:{}) };
    }) };
  }
  getTrip(id) {
    if (!isValidId(id)) throw notFound();
    const row = this.db.prepare("SELECT data FROM trips WHERE id=?").get(id);
    if (!row) throw this.isDeleted(id) ? tripDeleted() : notFound();
    return { trip: withAliases(JSON.parse(row.data)) };
  }
  isDeleted(id) { return Boolean(this.db.prepare("SELECT 1 AS hit FROM trip_tombstones WHERE id=?").get(id)); }
  /** A stable trip ID is unavailable while a live trip or a deletion tombstone holds it. */
  idTaken(id) { return Boolean(this.db.prepare("SELECT id FROM trips WHERE id=?").get(id)) || this.isDeleted(id); }
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
        if (replay?.deletedTrip) throw tripDeleted();
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
    // Existing or deleted (tombstoned) IDs are never reused: the import gets a fresh ID instead.
    for (let attempt = 0; !isValidId(id) || this.idTaken(id); attempt++) {
      if (attempt >= 8) throw new Error("Could not allocate a trip identifier.");
      id = newId("trip");
    }
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
  /**
   * Owner-only permanent deletion (authorization is enforced by ContentGateway). input is exactly
   * { tripId, requestId, expectedVersion }. In one transaction: removes the trip row (active or
   * archived), writes a content-free tombstone, redacts every retry record that could return the
   * trip's content (its per-trip change results and the create/import results that produced it),
   * stores this request's minimal result and runs record() (the audit entry). Any failure rolls all
   * of it back. Shared photos and backups are not touched.
   */
  deleteTrip(input, record) {
    if (!isPlainObject(input)) throw validationError("The request body must be a JSON object.");
    const unknown = Object.keys(input).filter((key) => !DELETE_KEYS.has(key));
    if (unknown.length) throw validationError("Deletion accepts only requestId and expectedVersion.");
    const { tripId, requestId, expectedVersion } = input;
    if (!isValidId(tripId)) throw notFound();
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw validationError("expectedVersion must be a positive safe integer.");
    return this.transact("delete", requestId, { tripId, expectedVersion }, () => {
      const row = this.db.prepare("SELECT version FROM trips WHERE id=?").get(tripId);
      if (!row) throw this.isDeleted(tripId) ? tripDeleted() : notFound();
      if (row.version !== expectedVersion) throw conflict("version_conflict", "The trip changed. Read the latest version before retrying.", { currentVersion: row.version });
      const removed = this.db.prepare("DELETE FROM trips WHERE id=? AND version=?").run(tripId, expectedVersion);
      if (removed.changes !== 1) throw new Error("Trip deletion did not apply.");
      this.db.prepare("INSERT INTO trip_tombstones (id,deleted_version,deleted_at) VALUES (?,?,?)").run(tripId, expectedVersion, new Date().toISOString());
      const marker = deletionMarker(tripId, expectedVersion);
      this.db.prepare("UPDATE request_log SET result=? WHERE scope=?").run(marker, "trip:" + tripId);
      const redact = this.db.prepare("UPDATE request_log SET result=? WHERE scope=? AND request_id=?");
      for (const prior of this.db.prepare("SELECT scope,request_id,result FROM request_log WHERE scope IN ('create','import')").all()) {
        let stored = null;
        try { stored = JSON.parse(prior.result); } catch { stored = null; }
        if (stored?.trip?.id === tripId) redact.run(marker, prior.scope, prior.request_id);
      }
      return { deleted: true, tripId, version: expectedVersion };
    }, record);
  }
  exportTrip(id) {
    return { format: "shared-trip-export", formatVersion: 1, exportedAt: new Date().toISOString(), ...this.getTrip(id) };
  }
}
