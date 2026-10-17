// Shared trip-content entry point for the HTTP API and the MCP tools.
//
// Every content operation goes through here with { principal, channel }. Ordinary accounts read
// only joined trips, may create their own, and edit only trips they currently own as creator.
// Owner/content-manager global rights remain intact; import stays privileged. Successful writes and replays are
// audited inside the domain transaction (TripService.transact), so the audit never reports a write
// that did not commit. Refusals are audited best effort after the rollback. Audit events never
// contain bodies, titles or credentials; see audit.mjs.
//
// Permanent trip deletion (deleteTrip, audit action trip.delete) is owner-only: an owner cookie or
// owner bearer over HTTP, or the offline host-operator CLI (channel "operator"). It is never
// reachable through MCP and is not a change operation, so content managers cannot delete trips.
import { DomainError, conflict, validationError } from "./domain/errors.mjs";
import { OPERATOR, OWNER, canDeleteTrips, canEditContent } from "./auth/policy.mjs";
import { TripMembership } from "./trip-membership.mjs";
import { localPhotoPaths } from "./domain/media.mjs";
import {assertSafePayload} from "./domain/validate.mjs";

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
  constructor(service, audit, options) { this.service = service; this.audit = audit; this.membership=new TripMembership(service,audit,options); }

  read({ principal }) { this.membership.authenticated(principal); }
  listTrips(context) { return this.membership.list(context.principal); }
  getTrip(context, tripId) { this.membership.require(context.principal,tripId); return {...this.service.getTrip(tripId),...this.membership.projection(context.principal,tripId)}; }
  exportTrip(context, tripId) { this.membership.require(context.principal,tripId); return this.service.exportTrip(tripId); }

  createTrip(context, input) {
    return this.write(context, "trip.create", input, (record) => {
      assertSafePayload(input);
      if(!canEditContent(context.principal)&&localPhotoPaths(input?.trip,this.membership.origin).size)throw forbidden();
      const scope=canEditContent(context.principal)?"create":"create:"+context.principal.userId;
      return this.service.createTrip(input,(result,replayed)=>{if(!replayed){this.membership.created(context.principal,result.trip);this.membership.checkMedia(context.principal,result.trip);}else this.membership.require(context.principal,result.trip.id);record(result,replayed);},scope);
    },()=>true);
  }
  importTrip(context, input) {
    return this.write(context, "trip.import", input, (record) => this.service.importTrip(input,(result,replayed)=>{if(!replayed){this.membership.created(context.principal,result.trip);this.membership.checkMedia(context.principal,result.trip);}record(result,replayed);}));
  }
  /** input: { tripId, requestId, expectedVersion, changes } */
  applyTripChanges(context, input) {
    return this.write(context, changeAction(input?.changes), input, (record) => this.service.applyTripChanges(input,(result,replayed)=>{if(!replayed)this.membership.checkMedia(context.principal,result.trip);record(result,replayed);},canEditContent(context.principal)?undefined:"trip:"+input.tripId+":user:"+context.principal.userId),p=>this.membership.canEdit(p,input?.tripId));
  }
  /**
   * Target check for HTTP-only place/photo lookups: a current owner/manager/trip creator
   * and an existing, unarchived trip. It only reads the trip; lookups never write trip content (a
   * chosen result is saved separately through applyTripChanges).
   */
  lookupTarget({ principal }, tripId) {
    const trip=this.membership.require(principal,tripId,true);
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
      this.read({principal});
      if (!allowed(principal, channel)) throw forbidden();
      if (!isObject(input)) throw validationError("The request body must be a JSON object.");
      if(input.tripId&&action!=="trip.delete"&&!canEditContent(principal))this.membership.require(principal,input.tripId);
      return run((result, replayed) => this.audit.record({ ...base, tripId: result?.trip?.id ?? result?.tripId ?? base.tripId,
        version: result?.trip?.version ?? result?.version, outcome: replayed ? "replayed" : "accepted" }));
    } catch (error) {
      this.audit.safeRecord({ ...base, outcome: "refused", reason: error instanceof DomainError ? error.code : "internal_error" });
      if (error instanceof DomainError) error.audited = true;
      throw error;
    }
  }
}
