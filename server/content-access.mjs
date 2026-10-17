// Shared trip-content entry point for the HTTP API and the MCP tools.
//
// Every content operation goes through here with { principal, channel }. Ordinary accounts read
// only joined trips, may create their own, and edit only trips they currently own as creator.
// Content managers edit only joined trips. Only the owner has all-trip access;
// import remains a content-manager capability. Successful writes and replays are
// audited inside the domain transaction (TripService.transact), so the audit never reports a write
// that did not commit. Refusals are audited best effort after the rollback. Audit events never
// contain bodies, titles or credentials; see audit.mjs.
//
// Permanent trip deletion (deleteTrip, audit action trip.delete) is owner-only: an owner cookie or
// owner bearer over HTTP, or the offline host-operator CLI (channel "operator"). It is never
// reachable through MCP and is not a change operation, so content managers cannot delete trips.
import { DomainError, conflict, validationError } from "./domain/errors.mjs";
import { OPERATOR, OWNER, canDeleteTrips, canEditContent, isReadOnlyMcpPrincipal } from "./auth/policy.mjs";
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

  retryScope(principal,base,requestId){
    if(principal.role===OWNER)return base;
    const scoped=base.startsWith("trip:")?base+":user:"+principal.userId:base+":"+principal.userId;
    if(typeof requestId!=="string"||this.service.db.prepare("SELECT 1 FROM request_log WHERE scope=? AND request_id=?").get(scoped,requestId))return scoped;
    const old=this.service.db.prepare("SELECT result FROM request_log WHERE scope=? AND request_id=?").get(base,requestId);
    if(!old)return scoped;
    const result=JSON.parse(old.result),tripId=result.trip?.id??result.deletedTrip?.tripId;
    const actions=base==="create"?["trip.create"]:base==="import"?["trip.import"]:["trip.change","trip.replace_content","trip.archive","trip.unarchive"];
    const proofs=this.service.db.prepare("SELECT actor,action,version FROM audit_log WHERE trip_id=? AND request_id=? AND outcome='accepted'").all(tripId??null,requestId).filter(r=>actions.includes(r.action)&&r.version===result.trip?.version);
    if(proofs.length&&proofs.every(r=>r.actor===principal.userId))return base;
    if(!proofs.length)throw conflict("request_id_conflict","An older retry cannot be attributed safely. Reconcile the current trip before using a new request ID.");
    throw conflict("request_id_conflict","This older request belongs to another actor. Use a new request ID for a new operation.");
  }

  createTrip(context, input) {
    return this.write(context, "trip.create", input, (record) => {
      assertSafePayload(input);
      if(context.principal.role!==OWNER)for(const pathname of localPhotoPaths(input?.trip,this.membership.origin))if(!this.membership.canReadMedia(context.principal,pathname))throw forbidden();
      const scope=this.retryScope(context.principal,"create",input.requestId);
      return this.service.createTrip(input,(result,replayed)=>{if(!replayed){this.membership.created(context.principal,result.trip);this.membership.checkMedia(context.principal,result.trip);}else this.membership.require(context.principal,result.trip.id);record(result,replayed);},scope);
    },()=>true);
  }
  importTrip(context, input) {
    return this.write(context, "trip.import", input, (record) => {
      assertSafePayload(input);
      if(context.principal.role!==OWNER)for(const pathname of localPhotoPaths(input?.data,this.membership.origin))if(!this.membership.canReadMedia(context.principal,pathname))throw forbidden();
      return this.service.importTrip(input,(result,replayed)=>{if(!replayed){this.membership.created(context.principal,result.trip);this.membership.checkMedia(context.principal,result.trip);}else this.membership.require(context.principal,result.trip.id);record(result,replayed);},this.retryScope(context.principal,"import",input.requestId));
    });
  }
  /** input: { tripId, requestId, expectedVersion, changes } */
  applyTripChanges(context, input) {
    return this.write(context, changeAction(input?.changes), input, (record) => this.service.applyTripChanges(input,(result,replayed)=>{if(!replayed)this.membership.checkMedia(context.principal,result.trip);record(result,replayed);},this.retryScope(context.principal,"trip:"+input.tripId,input.requestId)),p=>this.membership.canEdit(p,input?.tripId));
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
      if (isReadOnlyMcpPrincipal(principal)) throw forbidden();
      if (!allowed(principal, channel)) throw forbidden();
      if (!isObject(input)) throw validationError("The request body must be a JSON object.");
      if(input.tripId&&action!=="trip.delete"&&principal.role!==OWNER)this.membership.require(principal,input.tripId);
      return run((result, replayed) => this.audit.record({ ...base, tripId: result?.trip?.id ?? result?.tripId ?? base.tripId,
        version: result?.trip?.version ?? result?.version, outcome: replayed ? "replayed" : "accepted" }));
    } catch (error) {
      this.audit.safeRecord({ ...base, outcome: "refused", reason: error instanceof DomainError ? error.code : "internal_error" });
      if (error instanceof DomainError) error.audited = true;
      throw error;
    }
  }
}
