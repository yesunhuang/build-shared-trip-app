import assert from "node:assert/strict";import {JSDOM} from "jsdom";
import {createBrandingEditor,brandingText,prepareLogoFile} from "../assets/app-template/public/branding-editor.js";
import {applyTripBranding,themeTokens,BRANDING_PRESETS} from "../assets/app-template/public/trip-branding.js";
import {fictionalLogo,logoObject} from "./fixtures/branding.mjs";
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function makeDom(){const dom=new JSDOM('<!doctype html><html><head><link rel="manifest" href="/manifest.webmanifest"><link rel="icon" href="/icons/icon-192.png"></head><body><img class="hero-title-icon" src="/icons/icon-192.png" alt="" aria-hidden="true"><gmp-place-details-compact data-fictional="untouched"></gmp-place-details-compact></body></html>',{url:"http://fictional-branding.test"});dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event("close"));};return dom;}
for(const language of ["en","zh-Hans","zh-Hant","ja"]){
 const dom=makeDom(),doc=dom.window.document,trip={title:"Fictional coastal trip",branding:{logo:logoObject(),theme:{preset:"sage"}}};let saved,reloads=0,attempts=0;
 const editor=createBrandingEditor({document:doc,trip,language,onSave:async value=>{attempts++;saved=value;},onReload:async()=>reloads++});doc.body.append(editor.dialog);editor.dialog.showModal();
 assert.equal(editor.dialog.getAttribute("aria-labelledby"),doc.querySelector("h2").id);assert.equal(doc.querySelector("h2").textContent,brandingText(language,"title"));
 const preset=doc.querySelector("select"),colors=[...doc.querySelectorAll("input[type=color]")];preset.value="custom";preset.dispatchEvent(new dom.window.Event("change"));assert.ok(!doc.querySelector(".branding-colors").hidden);
 colors[0].value="#ffffff";colors[0].dispatchEvent(new dom.window.Event("input"));doc.querySelector("form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));await tick();assert.equal(attempts,0);assert.equal(doc.querySelector("[role=alert]").textContent,brandingText(language,"colorError"));
 preset.value="ocean";preset.dispatchEvent(new dom.window.Event("change"));doc.querySelector("form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));await tick();assert.equal(saved.theme.preset,"ocean");assert.deepEqual(saved.logo,trip.branding.logo);assert.equal(editor.dialog.open,false);
 const reset=createBrandingEditor({document:doc,trip,language,onSave:async value=>saved=value});doc.body.replaceChildren(reset.dialog);reset.dialog.showModal();[...doc.querySelectorAll("button")].find(b=>b.textContent===brandingText(language,"reset")).click();assert.deepEqual(reset.read(),{logo:null,theme:{preset:"default"}});assert.equal(doc.querySelector(".branding-preview img").getAttribute("src"),null);
 [...doc.querySelectorAll("button")].find(b=>b.textContent===brandingText(language,"cancel")).click();assert.equal(reset.dialog.open,false);
 const errorEditor=createBrandingEditor({document:doc,trip,language,onSave:async()=>{throw {status:409};},onReload:async()=>reloads++});doc.body.replaceChildren(errorEditor.dialog);errorEditor.dialog.showModal();doc.querySelector("form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));await tick();assert.equal(errorEditor.dialog.open,true);assert.deepEqual(errorEditor.read(),trip.branding);assert.equal(doc.querySelector("[role=alert]").textContent,brandingText(language,"conflict"));const reload=[...doc.querySelectorAll("button")].find(b=>b.textContent===brandingText(language,"reload"));assert.ok(!reload.hidden);reload.click();await tick();assert.equal(reloads,1);errorEditor.dispose();dom.window.close();
}
{
 const dom=makeDom(),doc=dom.window.document,manifest=doc.querySelector('[rel=manifest]').outerHTML,icon=doc.querySelector('[rel=icon]').outerHTML;
 const hostile={...logoObject(),alt:'"><script>fictional()</script>'};
 applyTripBranding(doc,{branding:{logo:hostile,theme:{preset:"sage"}}});assert.equal(doc.querySelector(".hero-title-icon").alt,hostile.alt);assert.equal(doc.querySelectorAll("script").length,0);assert.ok(doc.querySelector(".hero-title-icon").src.startsWith("data:image/png;base64,"));assert.equal(doc.documentElement.style.getPropertyValue("--ink"),BRANDING_PRESETS.sage.ink);
 applyTripBranding(doc,{branding:{logo:null,theme:{preset:"ocean"}}});assert.equal(doc.querySelector(".hero-title-icon").getAttribute("src"),"/icons/icon-192.png");assert.equal(doc.querySelector(".hero-title-icon").getAttribute("aria-hidden"),"true");
 applyTripBranding(doc,{});assert.equal(doc.documentElement.style.getPropertyValue("--ink"),"");assert.equal(doc.documentElement.style.getPropertyValue("--paper"),"");assert.ok(!doc.documentElement.dataset.tripBranding);
 applyTripBranding(doc,{theme:{ink:"#123456",accent:"#456789"}});assert.equal(doc.documentElement.style.getPropertyValue("--ink"),"#123456");
 applyTripBranding(doc,{branding:{logo:logoObject()}});assert.equal(doc.querySelector('.hero-title-icon').dataset.tripLogo,"true");assert.ok(!doc.documentElement.dataset.tripBranding);applyTripBranding(doc,{});assert.equal(doc.querySelector('.hero-title-icon').dataset.tripLogo,"false");
 assert.equal(doc.querySelector('[rel=manifest]').outerHTML,manifest);assert.equal(doc.querySelector('[rel=icon]').outerHTML,icon);assert.equal(doc.querySelector("gmp-place-details-compact").outerHTML,'<gmp-place-details-compact data-fictional="untouched"></gmp-place-details-compact>');dom.window.close();
}
{
 const dom=makeDom(),doc=dom.window.document;let release,submitted=0;const promise=new Promise(resolve=>release=resolve);
 const editor=createBrandingEditor({document:doc,trip:{title:"Fictional",branding:{logo:logoObject()}},onSave:async()=>submitted++,prepareFile:()=>promise});doc.body.append(editor.dialog);editor.dialog.showModal();const file=doc.querySelector("input[type=file]");Object.defineProperty(file,"files",{value:[{name:"fictional.png"}]});file.dispatchEvent(new dom.window.Event("change"));
 assert.equal(doc.querySelector('[type=submit]').disabled,true);doc.querySelector("form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));assert.equal(submitted,0);
 [...doc.querySelectorAll("button")].find(b=>b.textContent==="Reset to defaults").click();assert.equal(doc.querySelector('[type=submit]').disabled,false);release(logoObject());await tick();assert.equal(editor.read().logo,null,"late conversion cannot revive a removed logo");editor.dispose();dom.window.close();
}
{
 const dom=makeDom(),doc=dom.window.document;let finish;const pending=new Promise(resolve=>finish=resolve);
 const editor=createBrandingEditor({document:doc,trip:{title:"Fictional saving trip"},onSave:()=>pending});doc.body.append(editor.dialog);editor.dialog.showModal();doc.querySelector("form").dispatchEvent(new dom.window.Event("submit",{cancelable:true}));
 const escape=new dom.window.Event("cancel",{cancelable:true});editor.dialog.dispatchEvent(escape);assert.equal(escape.defaultPrevented,true);assert.equal(doc.querySelector('[type=submit]').disabled,true);assert.ok([...doc.querySelectorAll('button')].filter(b=>!b.hidden).every(b=>b.disabled));finish();await tick();assert.equal(editor.dialog.open,false);dom.window.close();
}
{
 const bytes=fictionalLogo(),file={size:bytes.length,type:"image/png",slice:()=>({arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})};let created=0,revoked=0,draws=0;
 const URL={createObjectURL:()=>{created++;return "blob:fictional";},revokeObjectURL:()=>revoked++};class Image {naturalWidth=512;naturalHeight=256;set src(value){if(value)queueMicrotask(()=>this.onload());}}
 const document={createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){draws++;}}),toDataURL:()=>"data:image/png;base64,"+bytes.toString("base64")})};
 const logo=await prepareLogoFile(file,{document,URL,Image});assert.equal(logo.mimeType,"image/png");assert.equal(created,1);assert.equal(revoked,1);assert.equal(draws,1);
 await assert.rejects(()=>prepareLogoFile({...file,type:"image/svg+xml"},{document,URL,Image}));await assert.rejects(()=>prepareLogoFile({...file,size:9*1024*1024},{document,URL,Image}));assert.equal(created,1);
 class BrokenImage {set src(value){if(value)queueMicrotask(()=>this.onerror());}}
 await assert.rejects(()=>prepareLogoFile(file,{document,URL,Image:BrokenImage}));assert.equal(created,2);assert.equal(revoked,2);
}
console.log("Branding editor DOM/unit tests passed: four languages, labelled native controls, local image conversion and URL cleanup, pending/late-upload cancellation, preview/default/reset, contrast refusal, save and retained conflict drafts, explicit reload, trip/theme/logo isolation, escaped alt text and unchanged global identity/provider component. DOM simulation only; no physical-device claim.");
