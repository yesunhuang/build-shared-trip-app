import {prepareLogoFile,brandingText} from "./branding-editor.js?v=v-95ab054857fb";
import {COVER_BYTES_MAX,COVER_EDGE_MAX,coverProblems,coverImage,presentationText} from "./trip-presentation.js?v=v-95ab054857fb";
export const prepareCoverFile=(file,options)=>prepareLogoFile(file,{...options,edges:[COVER_EDGE_MAX,768,512,384,256],bytesMax:COVER_BYTES_MAX});
export function createCoverEditor({document:doc,trip,language="en",onSave,onReload,onUnauthorized,prepareFile=prepareCoverFile}){
 const text=key=>presentationText(language,key),common=key=>brandingText(language,key);
 const node=(tag,cls,value)=>{const n=doc.createElement(tag);n.className=cls||"";if(value!==undefined)n.textContent=value;return n;};
 const dialog=node("dialog","branding-editor cover-editor"),form=node("form"),title=node("h2","",text("title"));title.id="trip-cover-title";dialog.setAttribute("aria-labelledby",title.id);form.append(title);dialog.append(form);
 const field=(label,input)=>{const n=node("label","field");n.append(node("span","",text(label)),input);return n;};
 let draft=structuredClone(trip.cover||null),ticket=0,disposed=false,preparing=false,saving=false;
 const file=node("input");file.type="file";file.accept="image/png,image/jpeg,image/webp";file.setAttribute("aria-label",text("upload"));
 const hint=node("p","branding-hint",text("hint"));hint.id="trip-cover-hint";file.setAttribute("aria-describedby",hint.id);
 const alt=node("input");alt.type="text";alt.maxLength=160;alt.value=draft?.alt||String(trip.title||"").slice(0,160);
 const preview=node("div","cover-preview");preview.setAttribute("aria-label",common("preview"));
 const axes={};for(const[key,name]of [["focusX","x"],["focusY","y"]]){const input=node("input");input.type="range";input.min="0";input.max="100";input.step="1";input.value=draft?.[key]??50;axes[key]=input;form.append(field(name,input));input.addEventListener("input",()=>{if(draft)draft[key]=Number(input.value);update();});}
 const remove=node("button","button button--quiet",text("remove"));remove.type="button";
 form.prepend(field("upload",file),hint,field("alt",alt),preview);
 form.prepend(title);
 const status=node("p","branding-status"),error=node("p","branding-error");status.setAttribute("role","status");error.setAttribute("role","alert");
 const actions=node("div","branding-actions"),save=node("button","button",text("save")),cancel=node("button","button button--quiet",common("cancel")),reload=node("button","button button--quiet",text("reload"));save.type="submit";cancel.type=reload.type="button";reload.hidden=true;actions.append(remove,reload,cancel,save);form.append(status,error,actions);
 function read(){return draft?{...draft,alt:alt.value.trim()}:null;}
 function update(){
  preview.replaceChildren();const image=coverImage(doc,read());if(image)preview.append(image);preview.hidden=!image;
  for(const input of [alt,...Object.values(axes)])input.disabled=!draft||saving||preparing;
  alt.required=Boolean(draft);file.disabled=saving;remove.disabled=!draft||saving;save.disabled=saving||preparing;cancel.disabled=saving;
  status.textContent=preparing?common("busy"):"";dialog.setAttribute("aria-busy",String(preparing||saving));
 }
 file.addEventListener("change",async()=>{const chosen=file.files?.[0];if(!chosen)return;const current=++ticket;preparing=true;error.textContent="";update();try{const image=await prepareFile(chosen,{document:doc});if(disposed||current!==ticket)return;draft={...image,alt:alt.value.trim()||text("title"),focusX:50,focusY:50};alt.value=draft.alt;for(const input of Object.values(axes))input.value=50;}catch{if(!disposed&&current===ticket)error.textContent=common("fileError");}finally{if(!disposed&&current===ticket){preparing=false;file.value="";update();}}});
 alt.addEventListener("input",update);
 remove.addEventListener("click",()=>{ticket++;preparing=false;draft=null;file.value="";error.textContent="";update();});
 cancel.addEventListener("click",()=>dialog.close());reload.addEventListener("click",async()=>{reload.disabled=true;try{await onReload?.();}catch{error.textContent=common("failed");}finally{reload.disabled=false;}});
 form.addEventListener("submit",async event=>{event.preventDefault();if(disposed||saving||preparing)return;const value=read();if(coverProblems(value).length){error.textContent=common("fileError");return;}saving=true;error.textContent="";update();try{await onSave(value);if(!disposed)dialog.close();}catch(problem){if(disposed)return;error.textContent=problem.status===409?text("conflict"):common(problem.status===401||problem.status===403?"denied":"failed");reload.hidden=problem.status!==409;if(problem.status===401)onUnauthorized?.();}finally{saving=false;if(!disposed)update();}});
 const dispose=()=>{disposed=true;ticket++;};dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});dialog.addEventListener("close",dispose,{once:true});update();return{dialog,read,dispose};
}
