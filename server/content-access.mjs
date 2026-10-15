// Shared trip-content entry point for the HTTP API and the MCP tools.
//
// Every content operation goes through here with { principal, channel }. Reads require any
// authenticated principal; writes (create, import, changes including delete/replace/archive/
// unarchive) require the owner or a content manager. Successful writes, and identical replays, are
// audited inside the domain transaction (TripService.transact), so the audit never reports a write
// that did not commit. Refusals are audited best effort after the rollback. Audit events never
// contain bodies, titles or credentials; see audit.mjs.
//
// Permanent trip deletion (deleteTrip, audit action trip.delete) is owner-only: an owner cookie or
// owner bearer over HTTP, or the offline host-operator CLI (channel "operator"). It is never
// reachable through MCP and is not a change operation, so content managers cannot delete trips.
import { DomainError, conflict, validationError } from "./domain/errors.mjs";
import { OPERATOR, OWNER, canDeleteTrips, canEditContent } from "./auth/policy.mjs";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const unauthorized = () => new DomainError("unauthorized", 401, "Authentication required.");
const forbidden = () => new DomainError("forbidden", 403, "This action is not available for this account.");

export const actorOf = (principal) => (!principal ? "anonymous" : principal.role === OWNER ? (principal.via === OPERATOR ? OPERATOR : "owner") : principal.userId);

function changeAction(changes) {
  if (!Array.isArray(changes) || !changes.length) return "trip.change";
  if (changes.some((change) => change?.type === "replace_content")) return "trip.replace_content";
  if (changes.every((change) => change?.type === "archive_trip")) {
    const last = changes.at(-1).archived;
    return last === true ? "trip.archive" : last === false ? "trip.unarchive" : "trip.change";
  }
  return "trip.change";
}

export class ContentGateway {
  constructor(service, audit) { this.service = service; this.audit = audit; }

  read({ principal }) { if (!principal) throw unauthorized(); }
  listTrips(context) { this.read(context); return this.service.listTrips(); }
  getTrip(context, tripId) { this.read(context); return this.service.getTrip(tripId); }
  exportTrip(context, tripId) { this.read(context); return this.service.exportTrip(tripId); }

  createTrip(context, input) {
    return this.write(context, "trip.create", input, (record) => this.service.createTrip(input, record));
  }
  importTrip(context, input) {
    return this.write(context, "trip.import", input, (record) => this.service.importTrip(input, record));
  }
  /** input: { tripId, requestId, expectedVersion, changes } */
  applyTripChanges(context, input) {
    return this.write(context, changeAction(input?.changes), input, (record) => this.service.applyTripChanges(input, record));
  }
  /**
   * Target check for the HTTP-only public place/photo lookups: an editor (owner or content manager)
   * and an existing, unarchived trip. It only reads the trip; lookups never write trip content (a
   * chosen result is saved separately through applyTripChanges).
   */
  lookupTarget({ principal }, tripId) {
    if (!principal) throw unauthorized();
    if (!canEditContent(principal)) throw forbidden();
    const { trip } = this.service.getTrip(tripId);
    if (trip.archived) throw conflict("trip_archived", "The trip is archived. Unarchive it before searching for places or photos.");
    return trip.id;
  }
  /** input: { tripId, requestId, expectedVersion }. Owner-only permanent deletion. */
  deleteTrip(context, input) {
    return this.write(context, "trip.delete", input, (record) => this.service.deleteTrip(input, record), canDeleteTrips);
  }

  write({ principal, channel }, action, input, run, allowed = canEditContent) {
    const base = { actor: actorOf(principal), channel, action, requestId: isObject(input) ? input.requestId : null, tripId: isObject(input) ? input.tripId : null };
    try {
      if (!principal) throw unauthorized();
      if (!allowed(principal, channel)) throw forbidden();
      if (!isObject(input)) throw validationError("The request body must be a JSON object.");
      return run((result, replayed) => this.audit.record({ ...base, tripId: result?.trip?.id ?? result?.tripId ?? base.tripId,
        version: result?.trip?.version ?? result?.version, outcome: replayed ? "replayed" : "accepted" }));
    } catch (error) {
      this.audit.safeRecord({ ...base, outcome: "refused", reason: error instanceof DomainError ? error.code : "internal_error" });
      if (error instanceof DomainError) error.audited = true;
      throw error;
    }
  }
}
