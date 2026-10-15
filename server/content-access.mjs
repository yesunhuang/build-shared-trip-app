// Shared trip-content entry point for the HTTP API and the MCP tools.
//
// Every content operation goes through here with { principal, channel }. Reads require any
// authenticated principal; writes (create, import, changes including delete/replace/archive/
// unarchive) require the owner or a content manager. Successful writes, and identical replays, are
// audited inside the domain transaction (TripService.transact), so the audit never reports a write
// that did not commit. Refusals are audited best effort after the rollback. Audit events never
// contain bodies, titles or credentials; see audit.mjs.
import { DomainError, validationError } from "./domain/errors.mjs";
import { OWNER, canEditContent } from "./auth/policy.mjs";

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const unauthorized = () => new DomainError("unauthorized", 401, "Authentication required.");
const forbidden = () => new DomainError("forbidden", 403, "This action is not available for this account.");

export const actorOf = (principal) => (!principal ? "anonymous" : principal.role === OWNER ? "owner" : principal.userId);

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

  write({ principal, channel }, action, input, run) {
    const base = { actor: actorOf(principal), channel, action, requestId: isObject(input) ? input.requestId : null, tripId: isObject(input) ? input.tripId : null };
    try {
      if (!principal) throw unauthorized();
      if (!canEditContent(principal)) throw forbidden();
      if (!isObject(input)) throw validationError("The request body must be a JSON object.");
      return run((result, replayed) => this.audit.record({ ...base, tripId: result?.trip?.id ?? base.tripId, version: result?.trip?.version, outcome: replayed ? "replayed" : "accepted" }));
    } catch (error) {
      this.audit.safeRecord({ ...base, outcome: "refused", reason: error instanceof DomainError ? error.code : "internal_error" });
      if (error instanceof DomainError) error.audited = true;
      throw error;
    }
  }
}
