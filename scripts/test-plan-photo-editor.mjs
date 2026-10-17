import assert from "node:assert/strict";import {JSDOM} from "jsdom";
import {createPlanPhotoFields} from "../assets/app-template/public/plan-photo-editor.js";
import {planPhotoText} from "../assets/app-template/public/plan-photo.js";import {logoObject} from "./fixtures/branding.mjs";
const tick=()=>new Promise(r=>setTimeout(r,0));
for(const language of ["en","zh-Hans","zh-Hant","ja"]){
 const dom=new JSDOM('<!doctype html><body><gmp-place-details-compact>Fictional untouched Google attribution</gmp-place-details-compact></body>'),doc=dom.window.document;let resolve,working=false;
 const photo={...logoObject(),alt:'Fictional <img onerror="unsafe"> literal'},p={name:"Fictional plan",uploadedPhoto:photo};
 const c=createPlanPhotoFields({doc,plan:p,language,onBusy:v=>working=v,prepareFile:()=>new Promise(r=>resolve=r)});doc.body.append(c.root);
 assert.equal(c.root.querySelector("legend").textContent,planPhotoText(language,"title"));assert.equal(c.dirty,false);assert.deepEqual(c.read(),photo);assert.equal(c.root.querySelector("img").alt,photo.alt);assert.equal(c.root.querySelectorAll("script").length,0);
 const input=c.root.querySelector("input[type=file]");Object.defineProperty(input,"files",{value:[{name:"fictional.png"}],configurable:true});input.dispatchEvent(new dom.window.Event("change"));assert(working);assert(c.busy);assert.equal(c.validate(),false);
 c.root.querySelector("button").click();assert.equal(c.read(),null);assert.equal(c.busy,false);assert.equal(c.dirty,true);resolve(photo);await tick();assert.equal(c.read(),null,"cancelled conversion cannot revive upload");
 input.dispatchEvent(new dom.window.Event("change"));resolve(photo);await tick();assert.deepEqual(c.read(),photo);const alt=c.root.querySelector("input[type=text]");alt.value="";alt.dispatchEvent(new dom.window.Event("input"));assert.equal(c.validate(),false);alt.value="Fictional alternate description";alt.dispatchEvent(new dom.window.Event("input"));assert(c.validate());
 c.dispose();assert.equal(c.root.querySelector("img").getAttribute("src"),null);assert.equal(working,false);assert.equal(doc.querySelector("gmp-place-details-compact").textContent,"Fictional untouched Google attribution");dom.window.close();
 const late=new JSDOM("<!doctype html><body>"),d=late.window.document;let done;
 const c2=createPlanPhotoFields({doc:d,plan:p,language,prepareFile:()=>new Promise(r=>done=r)});d.body.append(c2.root);const f=c2.root.querySelector("input[type=file]");Object.defineProperty(f,"files",{value:[{name:"fictional.png"}]});f.dispatchEvent(new late.window.Event("change"));c2.dispose();done(photo);await tick();assert.equal(c2.root.querySelector("img").getAttribute("src"),null);late.window.close();
}
{
 const dom=new JSDOM("<!doctype html><body>"),c=createPlanPhotoFields({doc:dom.window.document,plan:{uploadedPhoto:logoObject()},prepareFile:async()=>{throw Error("fictional invalid image");}});const f=c.root.querySelector("input[type=file]");Object.defineProperty(f,"files",{value:[{}]});f.dispatchEvent(new dom.window.Event("change"));await tick();assert(c.root.querySelector("[role=alert]").textContent);assert.deepEqual(c.read(),logoObject());assert.equal(c.busy,false);c.dispose();dom.window.close();
}
console.log("Plan photo editor DOM checks passed: four languages, labelled native file/alt controls, local preview, invalid input, busy Save guard, remove, late conversion/cancellation/disposal, escaped alt and unchanged Google component. Simulation only.");
