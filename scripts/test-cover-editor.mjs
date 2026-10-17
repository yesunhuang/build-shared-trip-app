import assert from "node:assert/strict";import {JSDOM} from "jsdom";
import {createCoverEditor,prepareCoverFile} from "../assets/app-template/public/cover-editor.js";
import {applyTripCover,categoryBadge,coverImage,coverProblems,presentationText} from "../assets/app-template/public/trip-presentation.js";
import {brandingText} from "../assets/app-template/public/branding-editor.js";
import {fictionalLogo} from "./fixtures/branding.mjs";
import {localizeTrip} from "../assets/app-template/public/i18n.js";
const cover={mimeType:"image/png",data:fictionalLogo().toString("base64"),alt:"Fictional cover",focusX:25,focusY:70};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
{
 const document=new JSDOM("<!doctype html><body>").window.document;
 for(const className of ["trip-card-cover","trip-cover"]){
  const image=coverImage(document,cover,className);
  assert.equal(image.style.width,"100%","critical cover sizing does not depend on upgraded CSS");
  assert.equal(image.style.maxWidth,"100%");assert.equal(Number.parseFloat(image.style.minWidth),0);
  assert.equal(image.style.objectPosition,"25% 70%","saved crop focus unchanged");
 }
 document.defaultView.close();
}
assert.deepEqual(localizeTrip({cover,days:[{slots:[{cardCategory:"neutral",i18n:{ja:{cardCategory:"hotel"}}}]}],i18n:{ja:{cover:null}}},"ja"),{cover,days:[{slots:[{cardCategory:"neutral"}]}]},"legacy translation patches cannot change artwork or classification");
function dom(){const d=new JSDOM('<!doctype html><html><body><div class="hero"><img class="hero-title-icon" src="/fictional-logo.png"><h1>Fictional trip</h1></div></body></html>',{url:"http://fictional-cover.test"});d.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new d.window.Event("close"));};return d;}
for(const language of ["en","zh-Hans","zh-Hant","ja"]){
 const d=dom(),doc=d.window.document;let saved;
 const editor=createCoverEditor({document:doc,trip:{title:"Fictional journey",cover},language,onSave:async value=>{saved=value;}});doc.body.append(editor.dialog);editor.dialog.open=true;
 assert.equal(editor.dialog.querySelector("h2").textContent,presentationText(language,"title"));assert.equal(editor.dialog.querySelectorAll("h2").length,1);
 const ranges=editor.dialog.querySelectorAll('input[type=range]');assert.equal(ranges.length,2);ranges[0].value=80;ranges[0].dispatchEvent(new d.window.Event("input"));
 assert.equal(editor.dialog.querySelector(".trip-cover").style.objectPosition,"80% 70%");
 editor.dialog.querySelector('input[type=text]').value='Fictional <img onerror="bad()">';editor.dialog.querySelector('input[type=text]').dispatchEvent(new d.window.Event("input"));assert.equal(doc.querySelectorAll("script").length,0);
 editor.dialog.querySelector("form").dispatchEvent(new d.window.Event("submit",{cancelable:true}));await tick();assert.equal(saved.focusX,80);assert.equal(saved.alt,'Fictional <img onerror="bad()">');assert.equal(editor.dialog.open,false);
 const clear=createCoverEditor({document:doc,trip:{cover},language,onSave:async value=>saved=value});doc.body.append(clear.dialog);clear.dialog.open=true;[...clear.dialog.querySelectorAll("button")].find(n=>n.textContent===presentationText(language,"remove")).click();assert.equal(clear.read(),null);assert.ok(clear.dialog.querySelector(".cover-preview").hidden);clear.dialog.querySelector("form").dispatchEvent(new d.window.Event("submit",{cancelable:true}));await tick();assert.equal(saved,null);
 const conflict=createCoverEditor({document:doc,trip:{cover},language,onSave:async()=>{throw {status:409};}});doc.body.append(conflict.dialog);conflict.dialog.open=true;conflict.dialog.querySelector("form").dispatchEvent(new d.window.Event("submit",{cancelable:true}));await tick();assert.deepEqual(conflict.read(),cover);assert.equal(conflict.dialog.open,true);assert.equal(conflict.dialog.querySelector('[role=alert]').textContent,presentationText(language,"conflict"));
 for(const category of ["restaurant","hotel","ticketed-transport"]){const badge=categoryBadge(doc,category,language);assert.ok(badge.querySelector('svg[aria-hidden=true]'));assert.equal(badge.textContent,presentationText(language,category));}assert.equal(categoryBadge(doc,"car",language),null);
 applyTripCover(doc,{cover});assert.equal(doc.querySelectorAll(".hero > .trip-cover").length,1);applyTripCover(doc,{cover});assert.equal(doc.querySelectorAll(".hero > .trip-cover").length,1);assert.equal(doc.querySelector('.hero-title-icon').getAttribute("src"),"/fictional-logo.png");applyTripCover(doc,{});assert.equal(doc.querySelectorAll(".hero > .trip-cover").length,0);d.window.close();
}
{
 const d=dom(),doc=d.window.document;let finish,saved=0;const pending=new Promise(resolve=>finish=resolve);const editor=createCoverEditor({document:doc,trip:{cover},prepareFile:()=>pending,onSave:async()=>saved++});doc.body.append(editor.dialog);editor.dialog.open=true;
 const file=editor.dialog.querySelector('input[type=file]');Object.defineProperty(file,"files",{value:[{name:"fictional.png"}]});file.dispatchEvent(new d.window.Event("change"));assert.equal(editor.dialog.querySelector('[type=submit]').disabled,true);editor.dialog.querySelector('form').dispatchEvent(new d.window.Event("submit",{cancelable:true}));assert.equal(saved,0);
 [...editor.dialog.querySelectorAll("button")].find(n=>n.textContent==="Remove cover").click();finish(cover);await tick();assert.equal(editor.read(),null,"late conversion cannot revive a cleared cover");d.window.close();
}
{
 const bytes=fictionalLogo({width:768,height:320});const file={size:bytes.length,type:"image/png",slice:()=>({arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)})};let width,revoked=0;
 const document={createElement:()=>{const canvas={width:0,height:0,getContext:()=>({drawImage(){width=canvas.width;}}),toDataURL:()=>"data:image/png;base64,"+bytes.toString("base64")};return canvas;}};
 class Image{naturalWidth=1600;naturalHeight=900;set src(value){if(value)queueMicrotask(()=>this.onload());}}
 const result=await prepareCoverFile(file,{document,Image,URL:{createObjectURL:()=>"blob:fictional",revokeObjectURL:()=>revoked++}});assert.equal(width,1024);assert.equal(revoked,1);assert.equal(coverProblems(result).length,0);
}
console.log("Cover editor DOM tests passed: four languages, labelled controls, focus percentages, clear, conflict draft, escaped alt, one header cover distinct from logo, semantic icon/text labels, bounded conversion and late upload cancellation. DOM simulation only.");
