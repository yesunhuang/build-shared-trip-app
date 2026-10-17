import {prepareLogoFile} from "./branding-editor.js?v=v-1b17bacdae34";
import {PLAN_PHOTO_BYTES_MAX,PLAN_PHOTO_EDGE_MAX,uploadedPhotoProblems,uploadedPhotoSource,planPhotoText} from "./plan-photo.js?v=v-1b17bacdae34";
export const preparePlanPhotoFile=(file,options)=>prepareLogoFile(file,{...options,edges:[PLAN_PHOTO_EDGE_MAX,768,512,384,256,192,128],bytesMax:PLAN_PHOTO_BYTES_MAX});
// A draft-only fieldset inside the ordinary version-aware plan editor. No API or provider calls.
export function createPlanPhotoFields({doc,plan,language="en",onBusy=()=>{},prepareFile=preparePlanPhotoFile}){
 const text=key=>planPhotoText(language,key),node=(tag,value)=>{const n=doc.createElement(tag);if(value)n.textContent=value;return n;};
 const root=node("fieldset");root.className="plan-photo-editor";root.append(node("legend",text("title")));
 const field=(label,control)=>{const n=node("label");n.className="field";n.append(node("span",text(label)),control);return n;};
 const file=node("input");file.type="file";file.accept="image/png,image/jpeg,image/webp";file.dataset.planPhotoUpload="";
 const alt=node("input");alt.type="text";alt.maxLength=160;alt.value=plan?.uploadedPhoto?.alt||String(plan?.name||"").slice(0,160);alt.dataset.planPhotoAlt="";
 const hint=node("p",text("hint"));hint.className="form-hint";
 const preview=node("img");preview.className="plan-photo-preview";preview.decoding="async";
 const clear=node("button",text("clear"));clear.type="button";clear.className="button button--quiet";clear.dataset.planPhotoClear="";
 const status=node("p"),error=node("p");status.setAttribute("role","status");error.setAttribute("role","alert");error.className="branding-error";
 root.append(field("upload",file),hint,field("alt",alt),preview,clear,status,error);
 let draft=structuredClone(plan?.uploadedPhoto||null),dirty=false,busy=false,disposed=false,ticket=0;
 const read=()=>draft?{...draft,alt:alt.value.trim()}:null;
 function update(){const source=uploadedPhotoSource(read());preview.hidden=!source;if(source){if(preview.getAttribute("src")!==source)preview.src=source;preview.alt=alt.value;}else{preview.removeAttribute("src");preview.alt="";}alt.disabled=!draft||busy;alt.required=Boolean(draft);clear.disabled=!draft&&!busy;root.setAttribute("aria-busy",String(busy));status.textContent=busy?text("busy"):dirty?text("pending"):"";onBusy(busy);}
 function reset(){ticket++;busy=false;draft=null;dirty=true;file.value="";error.textContent="";update();}
 file.addEventListener("change",async()=>{const chosen=file.files?.[0];if(!chosen)return;const own=++ticket;busy=true;error.textContent="";update();try{const photo=await prepareFile(chosen,{document:doc});if(disposed||own!==ticket)return;draft={...photo,alt:alt.value.trim()||String(plan?.name||text("title")).slice(0,160)};alt.value=draft.alt;dirty=true;}catch{if(!disposed&&own===ticket)error.textContent=text("invalid");}finally{if(!disposed&&own===ticket){busy=false;file.value="";update();}}});
 clear.addEventListener("click",reset);alt.addEventListener("input",()=>{dirty=true;update();});update();
 return {root,read,get dirty(){return dirty;},get busy(){return busy;},reset,validate(){const valid=!busy&&!uploadedPhotoProblems(read()).length;if(!valid)error.textContent=text(busy?"busy":"invalid");return valid;},dispose(){disposed=true;ticket++;busy=false;preview.removeAttribute("src");onBusy(false);}};
}
