// User-authored presentation, independent of logos, bookings and provider content.
export const COVER_BYTES_MAX=262144, COVER_EDGE_MAX=1024;
export const COVER_BASE64_MAX=Math.ceil(COVER_BYTES_MAX/3)*4;
export const CARD_CATEGORIES=Object.freeze(["neutral","restaurant","hotel","ticketed-transport"]);
const copy={
 en:["Cover artwork","Trip cover artwork","Choose cover image","Cover description","Horizontal focus","Vertical focus","Remove cover","Save cover","PNG, JPEG or WebP up to 8 MB. Converted on this device to a PNG up to 1024 pixels and 256 KiB, then saved with the trip, backups and exports.","Card highlight","Neutral","Restaurant","Hotel","Ticketed transport","Highlights do not change the plan type, reservations or booking status."],
 "zh-Hans":["封面图片","行程封面图片","选择封面图片","封面说明","水平焦点","垂直焦点","移除封面","保存封面","PNG、JPEG 或 WebP，最大 8 MB。本地转换为不超过 1024 像素、256 KiB 的 PNG，随备份和导出保存。","卡片分类","中性","餐厅","酒店","需票交通","分类不会更改行程类型、预订或预订状态。"],
 "zh-Hant":["封面圖片","行程封面圖片","選擇封面圖片","封面說明","水平焦點","垂直焦點","移除封面","儲存封面","PNG、JPEG 或 WebP，最大 8 MB。本機轉換為不超過 1024 像素、256 KiB 的 PNG，隨備份和匯出儲存。","卡片分類","中性","餐廳","飯店","需票交通","分類不會變更行程類型、預訂或預訂狀態。"],
 ja:["カバー画像","旅行のカバー画像","カバー画像を選択","カバーの説明","横の表示位置","縦の表示位置","カバーを削除","カバーを保存","PNG・JPEG・WebP、最大8 MB。端末内で1024ピクセル・256 KiB以下のPNGに変換し、バックアップと書き出しに含めます。","カードの分類","標準","レストラン","ホテル","乗車券が必要な交通","分類は予定の種類・予約・予約状況を変更しません。"]
};
const keys=["open","title","upload","alt","x","y","remove","save","hint","category","neutral","restaurant","hotel","ticketed-transport","categoryHint"];
const recovery={en:["Reload saved cover","This trip changed. Your cover draft is kept. Reload the saved cover before editing again."],"zh-Hans":["重新载入已保存封面","行程已更改。封面草稿已保留；请重新载入后编辑。"],"zh-Hant":["重新載入已儲存封面","行程已變更。封面草稿已保留；請重新載入後編輯。"],ja:["保存済みのカバーを再読込","旅行が変更されました。カバーの下書きは保持しています。再読込してから編集してください。"]};
export function presentationText(language,key){if(key==="reload"||key==="conflict")return(recovery[language]||recovery.en)[key==="reload"?0:1];return (copy[language]||copy.en)[keys.indexOf(key)]||key;}
export function cardCategory(value){return CARD_CATEGORIES.includes(value)?value:"neutral";}
export function coverProblems(value){
 const issues=[];if(value===undefined||value===null)return issues;
 if(typeof value!=="object"||Array.isArray(value))return [{path:"cover",message:"must be a PNG object or null"}];
 const add=(key,message)=>issues.push({path:"cover."+key,message});
 for(const key of Object.keys(value))if(!["mimeType","data","alt","focusX","focusY"].includes(key))add(key,"field is not allowed");
 if(value.mimeType!=="image/png")add("mimeType","must be image/png");
 if(typeof value.data!=="string"||value.data.length>COVER_BASE64_MAX||value.data.length%4||!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.data))add("data","must be bounded base64 PNG data without a data URL prefix");
 if(typeof value.alt!=="string"||!value.alt.trim()||value.alt.length>160||/[\u0000-\u001f\u007f]/.test(value.alt))add("alt","must be 1-160 characters without controls");
 for(const key of ["focusX","focusY"])if(value[key]!==undefined&&(typeof value[key]!=="number"||!Number.isFinite(value[key])||value[key]<0||value[key]>100))add(key,"must be a number between 0 and 100");
 return issues;
}
export function coverSource(cover){return cover&&!coverProblems(cover).length?"data:image/png;base64,"+cover.data:"";}
export function coverImage(doc,cover,className="trip-cover"){
 const source=coverSource(cover);if(!source)return null;
 const image=doc.createElement("img");image.className=className;image.src=source;image.alt=cover.alt;image.decoding="async";
 // Critical sizing travels with the image: an older controlling worker can serve pre-cover CSS
 // during an upgrade. Never let a private artwork's intrinsic width determine the page width.
 image.style.width="100%";image.style.maxWidth="100%";image.style.minWidth="0";
 image.style.objectPosition=`${cover.focusX??50}% ${cover.focusY??50}%`;return image;
}
export function applyTripCover(doc,trip){
 const host=doc.querySelector(".hero");if(!host)return;
 const existing=host.querySelector(".trip-cover");const image=coverImage(doc,trip?.cover);
 if(image){if(existing)existing.replaceWith(image);else host.prepend(image);}else existing?.remove();
}
const paths={restaurant:'M5 3v7m3-7v7M2 3v5a3 3 0 0 0 6 0M5 11v10M17 3c-3 3-3 8 0 8h3M20 3v18',hotel:'M3 18v3m18-3v3M3 18h18v-7H3v7Zm2-7V5h14v6M6 11V8h5v3m2 0V8h5v3',"ticketed-transport":'M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4V6Zm12 0v2m0 3v2m0 3v2'};
export function categoryBadge(doc,value,language){
 const category=cardCategory(value);if(category==="neutral")return null;
 const badge=doc.createElement("span");badge.className="card-category-badge";
 const svg=doc.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");svg.setAttribute("focusable","false");
 const path=doc.createElementNS(svg.namespaceURI,"path");path.setAttribute("d",paths[category]);svg.append(path);
 badge.append(svg,doc.createTextNode(presentationText(language,category)));return badge;
}
export const COVER_SCHEMA={description:"Independent per-trip cover artwork, separate from branding.logo. Omit to preserve, send null to clear. Embedded PNG is carried in private backups and exports. No URL or provider content. Optional focus percentages control responsive cropping.",anyOf:[{type:"object",additionalProperties:false,required:["mimeType","data","alt"],properties:{mimeType:{type:"string",const:"image/png"},data:{type:"string",maxLength:COVER_BASE64_MAX,description:"Canonical base64 of a non-animated non-interlaced 8-bit RGB/RGBA PNG, at most 256 KiB and 1024 pixels per edge. No data URL, remote URL or SVG. Server validates and removes metadata."},alt:{type:"string",minLength:1,maxLength:160},focusX:{type:"number",minimum:0,maximum:100,default:50},focusY:{type:"number",minimum:0,maximum:100,default:50}}},{type:"null"}]};
export const CARD_CATEGORY_SCHEMA={type:"string",enum:[...CARD_CATEGORIES],description:"Explicit visual category, default neutral. restaurant, hotel or ticketed-transport (such as a flight or train) add icon, label and color. Never infer ticketed transport from walking/car travel. Does not change planType, booking or booked."};
