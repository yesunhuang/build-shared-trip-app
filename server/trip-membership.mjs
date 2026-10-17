import crypto from "node:crypto";
import { DomainError, conflict, validationError } from "./domain/errors.mjs";
import { isValidId } from "./domain/validate.mjs";
import { OWNER, canEditContent, isMcpOnlyPrincipal, isReadOnlyMcpPrincipal } from "./auth/policy.mjs";
import { ACCOUNT_ID_PATTERN } from "./auth/accounts.mjs";
import { localPhotoPaths } from "./domain/media.mjs";

const denied=()=>new DomainError("trip_not_found",404,"Trip not found.");
const forbidden=()=>new DomainError("forbidden",403,"This action is not available for this account.");
const invalid=()=>new DomainError("trip_invitation_invalid",403,"This trip invitation is invalid, used, revoked or expired.");
const hash=value=>crypto.createHash("sha256").update(value).digest("hex");
const actor=p=>p.role===OWNER?"owner":p.userId;
const object=v=>v&&typeof v==="object"&&!Array.isArray(v);
const CODE=/^[A-Za-z0-9_-]{43}$/;
export const TRIP_INVITE_ID=/^tiv_[A-Za-z0-9_-]{16}$/;
export const MEMBERSHIP_TABLES=`CREATE TABLE IF NOT EXISTS trip_access (trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE, creator TEXT, revision INTEGER NOT NULL CHECK(revision>0));
CREATE TABLE IF NOT EXISTS trip_members (trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id), joined_at TEXT NOT NULL, PRIMARY KEY(trip_id,user_id));
CREATE TABLE IF NOT EXISTS trip_invitations (id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, issuer TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT REFERENCES users(id), used_at TEXT, revoked_at TEXT);
CREATE INDEX IF NOT EXISTS trip_invitations_trip ON trip_invitations(trip_id);
CREATE TABLE IF NOT EXISTS trip_media (trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, pathname TEXT NOT NULL, PRIMARY KEY(trip_id,pathname));
CREATE TABLE IF NOT EXISTS trip_join_attempts (user_id TEXT PRIMARY KEY REFERENCES users(id), started_at INTEGER NOT NULL, attempts INTEGER NOT NULL);`;

// Rights are account membership, separate from itinerary groups/content and trip content versions.
export class TripMembership {
  constructor(service,audit,{clock=Date.now,origin,channel="http"}={}){this.service=service;this.db=service.db;this.audit=audit;this.clock=clock;this.origin=origin;this.channel=channel==="operator"?"operator":"http";}
  authenticated(principal){
    if(!principal)throw new DomainError("unauthorized",401,"Authentication required.");
    if(principal.role===OWNER)return;
    const row=this.db.prepare("SELECT status,role FROM users WHERE id=?").get(principal.userId);
    if(!row||row.status!=="approved"||row.role!==principal.role)throw forbidden();
  }
  state(id){return isValidId(id)?this.db.prepare("SELECT creator,revision FROM trip_access WHERE trip_id=?").get(id):null;}
  member(p,id){return Boolean(p.userId&&this.db.prepare("SELECT 1 FROM trip_members WHERE trip_id=? AND user_id=?").get(id,p.userId));}
  canRead(p,id){return p.role===OWNER||this.member(p,id);}
  canEdit(p,id){return !isReadOnlyMcpPrincipal(p)&&(p.role===OWNER||(this.member(p,id)&&(canEditContent(p)||this.state(id)?.creator===p.userId)));}
  canInvite(p,id){if(isMcpOnlyPrincipal(p))return false;const state=this.state(id);return p.role===OWNER||Boolean(state&&state.creator===actor(p)&&(p.role===OWNER||this.member(p,id)));}
  require(p,id,edit=false){this.authenticated(p);if(!this.canRead(p,id))throw denied();if(edit&&!this.canEdit(p,id))throw forbidden();return this.service.getTrip(id).trip;}
  projection(p,id){
    this.require(p,id);const state=this.state(id);
    const members=this.db.prepare("SELECT u.id,u.username FROM trip_members m JOIN users u ON u.id=m.user_id WHERE m.trip_id=? AND u.status='approved' ORDER BY u.username,u.id").all(id).map(u=>({...u,creator:state?.creator===u.id}));
    return {members,access:{canEdit:this.canEdit(p,id),canInvite:this.canInvite(p,id),canAssign:p.role===OWNER,creator:state?.creator==="owner"?"administrator":state?.creator??null,version:state?.revision??1}};
  }
  created(p,trip){
    this.db.prepare("UPDATE trip_access SET creator=? WHERE trip_id=?").run(actor(p),trip.id);
    if(p.userId)this.db.prepare("INSERT INTO trip_members VALUES(?,?,?)").run(trip.id,p.userId,new Date(this.clock()).toISOString());
  }
  checkMedia(p,trip){
    const paths=localPhotoPaths(trip,this.origin);
    if(p.role!==OWNER)for(const pathname of paths)if(!this.canReadMedia(p,pathname))throw forbidden();
    this.db.prepare("DELETE FROM trip_media WHERE trip_id=?").run(trip.id);
    for(const pathname of paths)this.db.prepare("INSERT INTO trip_media VALUES(?,?)").run(trip.id,pathname);
  }
  canReadMedia(p,pathname){
    this.authenticated(p);if(p.role===OWNER)return true;
    return Boolean(this.db.prepare("SELECT 1 FROM trip_media f JOIN trip_members m ON f.trip_id=m.trip_id WHERE f.pathname=? AND m.user_id=? LIMIT 1").get(pathname,p.userId));
  }
  list(p){this.authenticated(p);return {trips:this.service.listTrips().trips.filter(t=>this.canRead(p,t.id)).map(t=>({...t,access:{canEdit:this.canEdit(p,t.id)}}))};}
  landing(p,now=this.clock()){
    const eligible=this.list(p).trips.filter(t=>{
      if(t.archived||!t.dateRange.start||!t.dateRange.end)return false;
      try{const trip=this.service.getTrip(t.id).trip;const parts=new Intl.DateTimeFormat("en-US",{timeZone:trip.timezone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(now));const at=Object.fromEntries(parts.map(x=>[x.type,x.value]));return t.dateRange.end>=`${at.year}-${at.month}-${at.day}`;}catch{return false;}
    });
    return eligible.length===1?"/trips/"+encodeURIComponent(eligible[0].id):"/";
  }
  expected(id,input,keys){
    if(!object(input)||Object.keys(input).some(k=>!keys.includes(k)))throw validationError("Unexpected membership fields.");
    const state=this.state(id);if(!state)throw denied();
    if(!Number.isSafeInteger(input.expectedAccessVersion)||input.expectedAccessVersion<1)throw validationError("expectedAccessVersion must be a positive integer.");
    if(state.revision!==input.expectedAccessVersion)throw conflict("membership_conflict","Participants changed. Refresh before retrying.");
    return state;
  }
  transaction(work){this.db.exec("BEGIN IMMEDIATE");try{const value=work();this.db.exec("COMMIT");return value;}catch(e){this.db.exec("ROLLBACK");throw e;}}
  changed(id){this.db.prepare("UPDATE trip_access SET revision=revision+1 WHERE trip_id=?").run(id);}
  record(p,action,id,requestId,outcome="accepted",target){this.audit.record({actor:this.channel==="operator"?"operator":actor(p),channel:this.channel,action,tripId:id,requestId,outcome,target});}
  assign(p,id,input){
    this.require(p,id);if(p.role!==OWNER)throw forbidden();
    if(!object(input)||typeof input.userId!=="string"||!ACCOUNT_ID_PATTERN.test(input.userId)||!["member","creator","remove"].includes(input.role))throw validationError("Choose an account and member, creator or remove.");
    return this.service.transact("membership:"+id,input.requestId,input,()=>{
      const state=this.expected(id,input,["userId","role","expectedAccessVersion","requestId"]);
      const user=this.db.prepare("SELECT status FROM users WHERE id=?").get(input.userId);if(!user||(input.role!=="remove"&&user.status!=="approved"))throw validationError("Choose an approved account.");
      if(input.role==="remove"){
        this.db.prepare("DELETE FROM trip_members WHERE trip_id=? AND user_id=?").run(id,input.userId);
        if(state.creator===input.userId)this.db.prepare("UPDATE trip_access SET creator=NULL WHERE trip_id=?").run(id);
      }else{
        this.db.prepare("INSERT OR IGNORE INTO trip_members VALUES(?,?,?)").run(id,input.userId,new Date(this.clock()).toISOString());
        if(input.role==="creator")this.db.prepare("UPDATE trip_access SET creator=? WHERE trip_id=?").run(input.userId,id);
        else if(state.creator===input.userId)this.db.prepare("UPDATE trip_access SET creator=NULL WHERE trip_id=?").run(id);
      }
      this.db.prepare("UPDATE trip_invitations SET revoked_at=? WHERE trip_id=? AND revoked_at IS NULL AND issuer<>? AND issuer<>'owner'").run(new Date(this.clock()).toISOString(),id,this.state(id).creator??"");
      this.changed(id);return {updated:true};
    },(_result,replayed)=>this.record(p,"membership.assign",id,input.requestId,replayed?"replayed":"accepted",input.userId));
  }
  invitations(p,id){
    this.require(p,id);if(!this.canInvite(p,id))throw forbidden();
    return {invitations:this.db.prepare("SELECT id,created_at AS createdAt,expires_at AS expiresAt,used_at AS usedAt,revoked_at AS revokedAt FROM trip_invitations WHERE trip_id=? ORDER BY CASE WHEN used_at IS NULL AND revoked_at IS NULL AND expires_at>? THEN 0 ELSE 1 END,created_at DESC LIMIT 200").all(id,this.clock()).map(r=>({...r,expiresAt:new Date(r.expiresAt).toISOString()})),accessVersion:this.state(id).revision};
  }
  issue(p,id,input){
    this.require(p,id);if(!this.canInvite(p,id))throw forbidden();
    const hours=input?.expiresInHours??72;if(!Number.isInteger(hours)||hours<1||hours>168)throw validationError("expiresInHours must be 1 to 168.");
    return this.transaction(()=>{
      this.expected(id,input,["expectedAccessVersion","expiresInHours"]);
      if(this.service.getTrip(id).trip.archived)throw forbidden();
      if(this.db.prepare("SELECT COUNT(*) AS n FROM trip_invitations WHERE issuer=? AND created_at>=?").get(actor(p),new Date(this.clock()-3600000).toISOString()).n>=20)throw new DomainError("rate_limited",429,"Try creating trip invitations later.");
      if(this.db.prepare("SELECT COUNT(*) AS n FROM trip_invitations WHERE trip_id=? AND expires_at>? AND revoked_at IS NULL AND used_at IS NULL").get(id,this.clock()).n>=20)throw conflict("too_many_invitations","Revoke unused trip invitations before creating more.");
      // Keep at most 200 rows per trip, including used/revoked/expired metadata.
      const stale=this.db.prepare("SELECT id FROM trip_invitations WHERE trip_id=? AND (expires_at<=? OR revoked_at IS NOT NULL OR used_at IS NOT NULL) ORDER BY created_at,id").all(id,this.clock());
      let retained=this.db.prepare("SELECT COUNT(*) AS n FROM trip_invitations WHERE trip_id=?").get(id).n;
      for(const row of stale){if(retained<200)break;this.db.prepare("DELETE FROM trip_invitations WHERE id=?").run(row.id);retained--;}
      const token=crypto.randomBytes(32).toString("base64url"),inviteId="tiv_"+crypto.randomBytes(12).toString("base64url"),at=new Date(this.clock()).toISOString(),expires=this.clock()+hours*3600000;
      this.db.prepare("INSERT INTO trip_invitations VALUES(?,?,?,?,?,?,NULL,NULL,NULL)").run(inviteId,id,hash(token),actor(p),at,expires);this.changed(id);this.record(p,"trip.invitation.create",id,null,"accepted",inviteId);
      // Returned once; never persisted in request_log, audit or browser storage.
      return {invitation:{id:inviteId,token,expiresAt:new Date(expires).toISOString()},accessVersion:this.state(id).revision};
    });
  }
  revoke(p,id,inviteId,input){
    this.require(p,id);if(!this.canInvite(p,id))throw forbidden();if(!TRIP_INVITE_ID.test(inviteId))throw invalid();
    return this.transaction(()=>{this.expected(id,input,["expectedAccessVersion"]);const row=this.db.prepare("SELECT id FROM trip_invitations WHERE id=? AND trip_id=?").get(inviteId,id);if(!row)throw invalid();this.db.prepare("UPDATE trip_invitations SET revoked_at=COALESCE(revoked_at,?) WHERE id=?").run(new Date(this.clock()).toISOString(),inviteId);this.changed(id);this.record(p,"trip.invitation.revoke",id,null,"accepted",inviteId);return {revoked:true,accessVersion:this.state(id).revision};});
  }
  redeem(p,input){
    this.authenticated(p);if(!p.userId||p.via!=="cookie")throw forbidden();
    const now=this.clock(),prior=this.db.prepare("SELECT * FROM trip_join_attempts WHERE user_id=?").get(p.userId);
    if(prior&&(now<prior.started_at||now-prior.started_at<900000)&&prior.attempts>=20)throw new DomainError("rate_limited",429,"Try joining again later.");
    this.db.prepare("INSERT INTO trip_join_attempts VALUES(?,?,1) ON CONFLICT(user_id) DO UPDATE SET started_at=excluded.started_at,attempts=?").run(p.userId,prior&&now-prior.started_at<900000?prior.started_at:now,prior&&now-prior.started_at<900000?prior.attempts+1:1);
    if(!object(input)||Object.keys(input).some(k=>!["code","requestId"].includes(k))||typeof input.code!=="string"||!CODE.test(input.code))throw invalid();
    return this.service.transact("join:"+p.userId,input.requestId,{digest:hash(input.code)},()=>{
      const row=this.db.prepare("SELECT * FROM trip_invitations WHERE token_hash=? AND expires_at>? AND used_at IS NULL AND revoked_at IS NULL").get(hash(input.code),now);
      if(!row)throw invalid();
      const trip=this.service.getTrip(row.trip_id).trip,state=this.state(row.trip_id);
      if(trip.archived||!state||(row.issuer!=="owner"&&(state.creator!==row.issuer||!this.db.prepare("SELECT 1 FROM users WHERE id=? AND status='approved'").get(row.issuer))))throw invalid();
      if(this.member(p,row.trip_id))throw conflict("already_member","You already belong to this trip.");
      this.db.prepare("INSERT INTO trip_members VALUES(?,?,?)").run(row.trip_id,p.userId,new Date(now).toISOString());
      this.db.prepare("UPDATE trip_invitations SET used_by=?,used_at=? WHERE id=?").run(p.userId,new Date(now).toISOString(),row.id);this.changed(row.trip_id);
      return {joined:true,tripId:row.trip_id};
    },(result,replayed)=>{if(replayed&&!this.member(p,result.tripId))throw invalid();this.record(p,"trip.invitation.redeem",result.tripId,input.requestId,replayed?"replayed":"accepted");});
  }
}
