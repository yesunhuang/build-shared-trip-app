import {BRANDING_PRESETS,LOGO_BYTES_MAX,LOGO_EDGE_MAX,brandingProblems,themeColors,themeTokens,logoSource} from "./trip-branding.js?v=v-4b1b12ffbd8e";
const keys=["open","title","logo","upload","hint","alt","remove","theme","default","sage","ocean","plum","custom","legacy","ink","accent","background","preview","reset","save","cancel","reload","busy","fileError","colorError","conflict","denied","failed","defaultLogo"];
const copy={
 en:["Branding","Trip branding","Trip logo","Choose image","PNG, JPEG or WebP up to 8 MB. A small PNG is saved with this trip, its backups and exports.","Logo description","Remove logo","Color theme","Default","Sage","Ocean","Plum","Custom colors","Existing theme","Text / header","Accent","Light page background","Preview","Reset to defaults","Save branding","Cancel","Reload saved branding","Preparing image…","Choose a supported image within the size limits.","Use a light page background and dark text with at least 4.5:1 contrast. Accent shades are adjusted for readability.","This trip changed. Your draft is kept. Reload saved branding before editing again.","An authorized editor connection is required.","Could not save. Your draft is kept; retry the same edit after reconnecting.","Default logo"],
 "zh-Hans":["品牌外观","行程品牌外观","行程标志","选择图片","PNG、JPEG 或 WebP，最大 8 MB。缩小的 PNG 会随行程、备份和导出保存。","标志说明","移除标志","颜色主题","默认","鼠尾草绿","海洋蓝","梅紫","自定义颜色","现有主题","文字／页眉","强调色","浅色页面背景","预览","恢复默认","保存外观","取消","重新载入已保存外观","正在处理图片…","请选择大小合适的支持格式图片。","请使用浅色背景和深色文字，对比度至少 4.5:1。强调色会调整以便阅读。","行程已更改。草稿已保留；请重新载入后编辑。","需要有编辑权限的连接。","保存失败，草稿已保留。恢复连接后可重试相同编辑。","默认标志"],
 "zh-Hant":["品牌外觀","行程品牌外觀","行程標誌","選擇圖片","PNG、JPEG 或 WebP，最大 8 MB。縮小的 PNG 會隨行程、備份和匯出儲存。","標誌說明","移除標誌","顏色主題","預設","鼠尾草綠","海洋藍","梅紫","自訂顏色","現有主題","文字／頁首","強調色","淺色頁面背景","預覽","恢復預設","儲存外觀","取消","重新載入已儲存外觀","正在處理圖片…","請選擇大小合適的支援格式圖片。","請使用淺色背景和深色文字，對比度至少 4.5:1。強調色會調整以便閱讀。","行程已變更。草稿已保留；請重新載入後編輯。","需要有編輯權限的連線。","儲存失敗，草稿已保留。恢復連線後可重試相同編輯。","預設標誌"],
 ja:["デザイン","旅行のデザイン","旅行のロゴ","画像を選択","PNG・JPEG・WebP、最大8 MB。縮小したPNGは旅行データ、バックアップ、書き出しに含まれます。","ロゴの説明","ロゴを削除","配色","標準","セージ","オーシャン","プラム","色を指定","現在の配色","文字・ヘッダー","アクセント","明るいページ背景","プレビュー","標準に戻す","デザインを保存","キャンセル","保存済みのデザインを再読込","画像を処理中…","対応形式とサイズの画像を選択してください。","背景は明るく、文字は暗くし、コントラストを4.5:1以上にしてください。アクセントの濃さは読みやすく調整されます。","旅行が変更されました。下書きは保持しています。再読込してから編集してください。","編集権限のある接続が必要です。","保存できませんでした。下書きは保持しています。再接続後に同じ編集を再試行できます。","標準のロゴ"]
};
export function brandingText(language,key){const index=keys.indexOf(key);return (copy[language]||copy.en)[index]||copy.en[index]||key;}
export async function prepareLogoFile(file,{document:doc,URL:urls=doc.defaultView.URL,Image:ImageType=doc.defaultView.Image,edges=[LOGO_EDGE_MAX,192,128,96,64],bytesMax=LOGO_BYTES_MAX}={}) {
  if(!file||file.size>8*1024*1024||file.size<12||!["image/png","image/jpeg","image/webp"].includes(file.type))throw Error("file");
  const bytes=new Uint8Array(await file.slice(0,32).arrayBuffer());
  const png=[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255,webp=String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP";
  if(!(file.type==="image/png"&&png||file.type==="image/jpeg"&&jpeg||file.type==="image/webp"&&webp))throw Error("file");
  if(png){const view=new DataView(bytes.buffer);const width=view.getUint32(16),height=view.getUint32(20);if(!width||!height||width>4096||height>4096||width*height>16000000)throw Error("file");}
  const url=urls.createObjectURL(file);
  try{
    const image=await new Promise((resolve,reject)=>{const value=new ImageType();const timer=setTimeout(()=>{value.src="";reject(Error("file"));},15000);value.onload=()=>{clearTimeout(timer);resolve(value);};value.onerror=()=>{clearTimeout(timer);reject(Error("file"));};value.src=url;});
    const width=image.naturalWidth,height=image.naturalHeight;if(!width||!height||width>4096||height>4096||width*height>16000000)throw Error("file");
    for(const edge of edges){
      const scale=Math.min(1,edge/width,edge/height),canvas=doc.createElement("canvas");canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
      const ctx=canvas.getContext("2d");if(!ctx)throw Error("canvas");ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const source=canvas.toDataURL("image/png");canvas.width=0;canvas.height=0;
      const data=source.split(",")[1];if(source.startsWith("data:image/png;base64,")&&data&&Math.floor(data.length*3/4)<=bytesMax)return {mimeType:"image/png",data,alt:"Trip logo"};
    }
    throw Error("file");
  }finally{urls.revokeObjectURL(url);}
}
export function createBrandingEditor({document:doc,trip,language="en",onSave,onReload,onUnauthorized,prepareFile=prepareLogoFile}) {
  const text=key=>brandingText(language,key),node=(tag,cls,value)=>{const el=doc.createElement(tag);el.className=cls||"";if(value!==undefined)el.textContent=value;return el;};
  const dialog=node("dialog","branding-editor"),form=node("form"),title=node("h2","",text("title"));title.id="trip-branding-title";dialog.setAttribute("aria-labelledby",title.id);form.append(title);dialog.append(form);
  let draft=structuredClone(trip.branding||{}),disposed=false,uploadTicket=0,preparing=false,saving=false;
  const field=(label,control)=>{const wrap=node("label","field");wrap.append(node("span","",text(label)),control);return wrap;};
  const logoField=node("fieldset");logoField.append(node("legend","",text("logo")));
  const file=node("input");file.type="file";file.accept="image/png,image/jpeg,image/webp";file.setAttribute("aria-label",text("upload"));
  const hint=node("p","branding-hint",text("hint"));hint.id="branding-upload-hint";file.setAttribute("aria-describedby",hint.id);
  const alt=node("input");alt.type="text";alt.maxLength=160;alt.value=draft.logo?.alt||String(trip.title||"").slice(0,150);
  const remove=node("button","button button--quiet",text("remove"));remove.type="button";
  logoField.append(file,hint,field("alt",alt),remove);form.append(logoField);
  const themeField=node("fieldset");themeField.append(node("legend","",text("theme")));
  const preset=node("select");const inherited=!draft.theme&&trip.theme&&Object.keys(trip.theme).length;
  const names=[...(inherited?["legacy"]:[]),...Object.keys(BRANDING_PRESETS),"custom"];
  for(const name of names){const option=node("option","",text(name));option.value=name;preset.append(option);}
  preset.value=draft.theme?.preset||(inherited?"legacy":"default");themeField.append(field("theme",preset));
  const custom=node("div","branding-colors"),inputs={};const initial=themeColors(draft)||BRANDING_PRESETS.default;
  for(const name of ["ink","accent","background"]){const input=node("input");input.type="color";input.value=initial[name];inputs[name]=input;custom.append(field(name,input));}
  const colorHint=node("p","branding-hint",text("colorError"));custom.append(colorHint);themeField.append(custom);form.append(themeField);
  const preview=node("section","branding-preview");preview.setAttribute("aria-label",text("preview"));const previewImage=node("img"),previewDefault=node("span","",text("defaultLogo")),previewTitle=node("strong","",trip.title);preview.append(previewImage,previewDefault,previewTitle);form.append(preview);
  const status=node("p","branding-status");status.setAttribute("role","status");const error=node("p","branding-error");error.setAttribute("role","alert");form.append(status,error);
  const actions=node("div","branding-actions"),reset=node("button","button button--quiet",text("reset")),cancel=node("button","button button--quiet",text("cancel")),save=node("button","button",text("save")),reload=node("button","button button--quiet",text("reload"));
  reset.type=cancel.type=reload.type="button";save.type="submit";reload.hidden=true;actions.append(reset,reload,cancel,save);form.append(actions);
  function read(){const value=structuredClone(draft);if(value.logo)value.logo.alt=alt.value.trim();return value;}
  function update(){
    custom.hidden=preset.value!=="custom";const source=logoSource(draft.logo);previewImage.hidden=!source;previewDefault.hidden=Boolean(source);if(source){previewImage.src=source;previewImage.alt=alt.value;}else{previewImage.removeAttribute("src");previewImage.alt="";}
    const colors=themeColors(draft)||BRANDING_PRESETS.default;preview.style.backgroundColor=colors.background;preview.style.color=colors.ink;preview.style.borderColor=themeTokens(draft)?.accent||BRANDING_PRESETS.default.ink;
    alt.disabled=!draft.logo||preparing||saving;alt.required=Boolean(draft.logo);remove.disabled=!draft.logo||saving;file.disabled=saving;save.disabled=preparing||saving;reset.disabled=saving;cancel.disabled=saving;preset.disabled=saving;for(const input of Object.values(inputs))input.disabled=saving;
    status.textContent=preparing?text("busy"):"";dialog.setAttribute("aria-busy",String(preparing||saving));
  }
  preset.addEventListener("change",()=>{if(preset.value==="legacy")delete draft.theme;else {draft.theme=preset.value==="custom"?{preset:"custom",...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))}:{preset:preset.value};if(BRANDING_PRESETS[preset.value])for(const[k,input]of Object.entries(inputs))input.value=BRANDING_PRESETS[preset.value][k];}error.textContent="";update();});
  for(const input of Object.values(inputs))input.addEventListener("input",()=>{draft.theme={preset:"custom",...Object.fromEntries(Object.entries(inputs).map(([k,v])=>[k,v.value]))};update();});
  alt.addEventListener("input",update);
  remove.addEventListener("click",()=>{uploadTicket++;preparing=false;draft.logo=null;file.value="";update();});
  reset.addEventListener("click",()=>{uploadTicket++;preparing=false;draft={logo:null,theme:{preset:"default"}};preset.value="default";error.textContent="";file.value="";update();});
  file.addEventListener("change",async()=>{
    const chosen=file.files?.[0];if(!chosen)return;const ticket=++uploadTicket;preparing=true;error.textContent="";update();
    try{const logo=await prepareFile(chosen,{document:doc});if(disposed||ticket!==uploadTicket)return;logo.alt=alt.value.trim()||String(trip.title||"").slice(0,150)||text("logo");draft.logo=logo;alt.value=logo.alt;}
    catch{if(!disposed&&ticket===uploadTicket)error.textContent=text("fileError");}
    finally{if(!disposed&&ticket===uploadTicket){preparing=false;file.value="";update();}}
  });
  cancel.addEventListener("click",()=>dialog.close());reload.addEventListener("click",async()=>{reload.disabled=true;try{await onReload?.();}catch{error.textContent=text("failed");}finally{reload.disabled=false;}});
  form.addEventListener("submit",async event=>{
    event.preventDefault();if(preparing||saving||disposed)return;const value=read();if(brandingProblems(value).length){error.textContent=text("colorError");return;}
    saving=true;error.textContent="";update();
    try{await onSave(value);if(!disposed)dialog.close();}
    catch(problem){if(disposed)return;const code=problem.status;error.textContent=text(code===409?"conflict":code===401||code===403?"denied":"failed");reload.hidden=code!==409;if(code===401)onUnauthorized?.();}
    finally{saving=false;if(!disposed)update();}
  });
  function dispose(){disposed=true;uploadTicket++;}
  dialog.addEventListener("cancel",event=>{if(saving)event.preventDefault();});
  dialog.addEventListener("close",dispose,{once:true});update();return {dialog,read,dispose};
}
