import {ContentGateway} from "../../server/content-access.mjs";
// Explicit owner assignment for fictional legacy suites. Never infers real membership.
export function grantFixtureMembership(runtime,tripId,userId){
 const store=new ContentGateway(runtime.service,runtime.audit).membership;
 return store.assign({role:"owner",via:"bearer"},tripId,{userId,role:"member",expectedAccessVersion:store.state(tripId).revision,requestId:"fixture-member-"+crypto.randomUUID()});
}
