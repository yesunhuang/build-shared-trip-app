import assert from "node:assert/strict";import {JSDOM} from "jsdom";
import {createTripParticipantsDialog,createJoinTripControl,membershipText} from "../assets/app-template/public/trip-members-editor.js";
import {sessionForTrip,sessionCanEdit} from "../assets/app-template/public/hosted-client.js";
const tick=()=>new Promise(r=>setTimeout(r,0));
function documentFor(){const d=new JSDOM("<!doctype html><body><button>Launcher</button></body>",{url:"https://example.test"});d.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new d.window.Event("close"));};return d.window.document;}
for(const language of ["en","zh-Hans","zh-Hant","ja"]){
 const doc=documentFor(),t=k=>membershipText(language,k);let state={trip:{id:"fictional"},access:{canInvite:true,canAssign:false,canEdit:true,version:1},members:[{id:"sample-user",username:'Fictional <img src=x onerror=bad()>',creator:true}]},issued=0;
 const api={getTrip:async()=>structuredClone(state),tripInvitations:async()=>({invitations:[]}),createTripInvitation:async(id,input)=>{issued++;assert.equal(id,"fictional");assert.equal(input.expectedAccessVersion,1);state.access.version++;return {invitation:{token:"F".repeat(43)}};}};
 const panel=createTripParticipantsDialog({document:doc,tripId:"fictional",language,api});doc.body.append(panel.dialog);await panel.load();
 assert.equal(panel.dialog.querySelector("h2").textContent,t("title"));assert.equal(panel.dialog.querySelectorAll("img").length,0);assert.ok(panel.dialog.textContent.includes("<img"));
 const create=[...panel.dialog.querySelectorAll("button")].find(b=>b.textContent===t("invite"));create.click();create.click();await tick();await tick();assert.equal(issued,1);assert.equal(panel.dialog.querySelector("code").textContent,"F".repeat(43));
 [...panel.dialog.querySelectorAll("button")].find(b=>b.textContent===t("hide")).click();assert.equal(panel.dialog.querySelector("code").textContent,"");panel.dialog.close();assert.equal(doc.querySelector("dialog"),null);
 state.access={...state.access,canInvite:false,canAssign:false};const member=createTripParticipantsDialog({document:doc,tripId:"fictional",language,api});doc.body.append(member.dialog);await member.load();assert.equal([...member.dialog.querySelectorAll("button")].some(b=>b.textContent===t("invite")),false);member.dialog.close();
 // Unknown join outcome retries the identical request; no code in DOM, URLs or attributes.
 const requests=[];let joined=0,release;
 const join=createJoinTripControl({document:doc,language,api:{joinTrip:input=>{requests.push(structuredClone(input));if(requests.length===1)return Promise.reject({status:0});return new Promise(r=>release=r);}},onJoined:()=>joined++});doc.body.append(join.element);join.element.open=true;
 const form=join.element.querySelector("form"),field=form.querySelector("input"),submit=form.querySelector("button");field.value="J".repeat(43);form.dispatchEvent(new doc.defaultView.Event("submit",{cancelable:true}));await tick();assert.equal(field.value,"");assert.ok(!join.element.outerHTML.includes("J".repeat(43)));assert.equal(submit.textContent,t("retry"));
 form.dispatchEvent(new doc.defaultView.Event("submit",{cancelable:true}));form.dispatchEvent(new doc.defaultView.Event("submit",{cancelable:true}));assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);assert.equal(submit.disabled,true);release({joined:true});await tick();assert.equal(joined,1);
 doc.defaultView.close();
}
{
 const doc=documentFor();let version=1,calls=0;const api={getTrip:async()=>({trip:{id:"fictional"},members:[],access:{canAssign:true,canInvite:false,version}}),listAccounts:async()=>({accounts:[{id:"approved",username:"Fictional approved",status:"approved"},{id:"pending",username:"Fictional pending",status:"pending"}]}),assignTripMember:async(id,input)=>{calls++;assert.equal(input.userId,"approved");assert.equal(input.expectedAccessVersion,1);throw {status:409};}};
 const panel=createTripParticipantsDialog({document:doc,tripId:"fictional",api});doc.body.append(panel.dialog);await panel.load();const form=panel.dialog.querySelector("form");assert.equal(form.elements.account.options.length,2);form.elements.account.value="approved";form.dispatchEvent(new doc.defaultView.Event("submit",{cancelable:true}));await tick();assert.equal(calls,1);assert.equal(form.elements.account.value,"approved");assert.equal(panel.dialog.querySelector('[role="status"]').textContent,membershipText("en","conflict"));panel.dialog.close();doc.defaultView.close();
}
{
 const doc=documentFor();let release;const panel=createTripParticipantsDialog({document:doc,tripId:"fictional",api:{getTrip:()=>new Promise(r=>release=r)}});doc.body.append(panel.dialog);const loading=panel.load();panel.dialog.close();release({trip:{id:"fictional"},members:[{username:"Late private label"}],access:{}});await loading;assert.equal(doc.querySelector("dialog"),null);assert.ok(!doc.body.textContent.includes("Late private label"));doc.defaultView.close();
}
assert.equal(sessionCanEdit(sessionForTrip({capabilities:{editTrips:false}},{access:{canEdit:true}})),true,"creator receives trip-specific editing UI");
assert.equal(sessionCanEdit(sessionForTrip({capabilities:{editTrips:true}},{access:{canEdit:false}})),false,"server trip capability wins");
console.log("Membership UI DOM tests passed: four languages, participant labels escaped, member/creator/admin controls, explicit conflict recovery, once-only code reveal/clear, cancelled late reads, duplicate-click suppression and identical manual retry after uncertain joins. No browser/device claim.");
