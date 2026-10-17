// User-supplied images are private trip content, never provider content or remote URLs.
export const PLAN_PHOTO_BYTES_MAX=131072,PLAN_PHOTO_EDGE_MAX=1024;
export const PLAN_PHOTO_BASE64_MAX=Math.ceil(PLAN_PHOTO_BYTES_MAX/3)*4;
export function uploadedPhotoProblems(value){
 if(value===undefined||value===null)return [];
 const issues=[],add=(key,message)=>issues.push({path:"uploadedPhoto"+(key?"."+key:""),message});
 if(typeof value!=="object"||Array.isArray(value)){add("","must be a PNG object or null");return issues;}
 for(const key of Object.keys(value))if(!["mimeType","data","alt"].includes(key))add(key,"field is not allowed");
 if(value.mimeType!=="image/png")add("mimeType","must be image/png");
 if(typeof value.data!=="string"||value.data.length>PLAN_PHOTO_BASE64_MAX||value.data.length%4||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.data))add("data","must be bounded canonical base64 PNG without a data URL prefix");
 if(typeof value.alt!=="string"||!value.alt.trim()||value.alt.length>160||/[\u0000-\u001f\u007f]/.test(value.alt))add("alt","must be 1-160 characters without controls");
 return issues;
}
export const uploadedPhotoSource=value=>value&&!uploadedPhotoProblems(value).length?"data:image/png;base64,"+value.data:"";
export const UPLOADED_PHOTO_SCHEMA={description:"User-supplied plan photo, separate from Commons/legacy photo and Google components. Omit to preserve; null removes the upload and reveals the existing saved photo, if any. Embedded in private trip data, exports and backups. No provider requests or public URL.",anyOf:[{type:"object",additionalProperties:false,required:["mimeType","data","alt"],properties:{mimeType:{type:"string",const:"image/png"},data:{type:"string",maxLength:PLAN_PHOTO_BASE64_MAX,description:"Canonical base64, no data URL. Non-animated non-interlaced 8-bit RGB/RGBA PNG, at most 128 KiB and 1024 pixels per edge. Server validates and re-encodes without metadata. Existing whole-trip size limits still apply."},alt:{type:"string",minLength:1,maxLength:160}}},{type:"null"}]};
const keys=["title","upload","alt","clear","hint","pending","busy","invalid","credit"];
const words={
 en:["Your photo","Upload or replace photo","Photo description","Remove uploaded photo","PNG, JPEG or WebP up to 8 MB. Saved as a bounded PNG with this trip, backups and exports. Removing it restores the original saved photo, if any. Save the plan to apply changes.","Photo change ready. Save the plan to keep it.","Preparing photo…","Choose a valid image within the size limits and enter its description.","Your uploaded photo"],
 "zh-Hans":["自己的照片","上传或替换照片","照片说明","移除上传照片","PNG、JPEG 或 WebP，最大 8 MB。转换后的 PNG 随行程、备份和导出保存。移除后会恢复原有照片（若有）。保存计划后生效。","照片更改已就绪，请保存计划。","正在处理照片…","请选择大小合适的有效图片并填写说明。","自己上传的照片"],
 "zh-Hant":["自己的照片","上傳或替換照片","照片說明","移除上傳照片","PNG、JPEG 或 WebP，最大 8 MB。轉換後的 PNG 隨行程、備份及匯出儲存。移除後會恢復原有照片（若有）。儲存計劃後生效。","照片變更已就緒，請儲存計劃。","正在處理照片…","請選擇大小合適的有效圖片並填寫說明。","自己上傳的照片"],
 ja:["自分の写真","写真を追加・変更","写真の説明","アップロード写真を削除","PNG・JPEG・WebP、最大8 MB。変換後のPNGは旅行、バックアップ、書き出しに保存されます。削除すると元の保存写真に戻ります。予定の保存で反映されます。","写真の変更を反映するには予定を保存してください。","写真を処理中…","サイズ内の有効な画像を選び、説明を入力してください。","アップロードした写真"]
};
export const planPhotoText=(language,key)=>(words[language]||words.en)[keys.indexOf(key)]||key;
