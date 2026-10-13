import { hostedApi, newRequestId, downloadJSON, exportFilename, safeNextPath, LANGUAGE_STORAGE_KEY, logoutAndLeave, finishPendingLogout, signoutPending } from "/hosted-client.js?v=__CACHE_VERSION__";
const words = {
  en: ["Sign in","Admin token","Your trips","Create trip","Show archived","Import JSON","Refresh","Sign out","Edit","Archive","Restore","Export","Title","Time zone","Country","Route","Save","Cancel","No trips yet.","Changes could not be saved. Refresh and try again."],
  "zh-Hans": ["登录","管理令牌","我的旅行","创建旅行","显示已归档","导入 JSON","刷新","退出","编辑","归档","恢复","导出","标题","时区","国家/地区","路线","保存","取消","还没有旅行。","更改未能保存，请刷新后重试。"],
  "zh-Hant": ["登入","管理權杖","我的旅行","建立旅行","顯示已封存","匯入 JSON","重新整理","登出","編輯","封存","還原","匯出","標題","時區","國家/地區","路線","儲存","取消","尚無旅行。","變更無法儲存，請重新整理後重試。"],
  ja: ["サインイン","管理トークン","旅行一覧","旅行を作成","アーカイブを表示","JSON をインポート","更新","サインアウト","編集","アーカイブ","復元","エクスポート","タイトル","タイムゾーン","国・地域","ルート","保存","キャンセル","旅行はまだありません。","変更を保存できませんでした。更新して再試行してください。"]
};
const keys = ["signin","token","yourTrips","create","archived","import","retry","logout","edit","archive","restore","export","title","timezone","country","route","save","cancel","empty","failed"];
let language = "en";
try { language = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "en"; } catch {}
let summaries = []; let loggedIn = false; let busy = false; let pollTimer; let failures = 0;
const byId = (id) => document.getElementById(id);
const text = (key) => (words[language] || words.en)[keys.indexOf(key)] || key;
function render() {
  document.documentElement.lang = language; byId("language").value = language;
  document.querySelectorAll("[data-text]").forEach((node) => {node.textContent=text(node.dataset.text);});
  byId("logout").textContent=text("logout"); byId("logout").hidden=!loggedIn;
  byId("login").hidden=loggedIn; byId("trips").hidden=!loggedIn;
  byId("list").replaceChildren();
  if (!loggedIn) return;
  const visible = summaries.filter((trip) => byId("archived").checked || !trip.archived);
  if (!visible.length) byId("list").textContent=text("empty");
  for (const trip of visible) {
    const card=document.createElement("article");card.className="trip-card";
    const heading=document.createElement("h2");const link=document.createElement("a");
    link.href="/trips/"+encodeURIComponent(trip.id);link.textContent=trip.title;heading.append(link);
    const dates=document.createElement("p"); dates.textContent=[trip.dateRange?.start,trip.dateRange?.end,trip.archived?text("archive"):""].filter(Boolean).join(" · ");
    const actions=document.createElement("div");actions.className="card-actions";
    actions.append(button(text("edit"),async()=>{const {trip:full}=await hostedApi.getTrip(trip.id);edit(full);}),
      button(text(trip.archived?"restore":"archive"),async()=>{await hostedApi.applyChanges(trip.id,trip.version,[{type:"archive_trip",archived:!trip.archived}]);await load();}),
      button(text("export"),async()=>downloadJSON(await hostedApi.exportTrip(trip.id),exportFilename(trip))));
    card.append(heading,dates,actions);byId("list").append(card);
  }
}
function status(message,error=false) {byId("status").textContent=message;byId("status").dataset.error=String(error);}
function button(label,action) {
  const node=document.createElement("button");node.type="button";node.textContent=label;
  node.addEventListener("click",()=>run(action));return node;
}
async function run(action) {
  if(busy)return;busy=true;document.querySelectorAll("button").forEach((b)=>b.disabled=true);
  try {const message=await action();status(typeof message==="string"?message:"");} catch(error) {if(error.status===401){loggedIn=false;summaries=[];render();}status(error.isConflict?text("failed"):error.message,true);}
  finally {busy=false;document.querySelectorAll("button").forEach((b)=>b.disabled=false);}
}
function edit(trip) {
  const dialog=document.createElement("dialog");const form=document.createElement("form");
  const heading=document.createElement("h2");heading.textContent=text(trip?"edit":"create");form.append(heading);
  for(const [key,value] of Object.entries({title:trip?.title||"",timezone:trip?.timezone||"UTC",country:trip?.country||"",route:trip?.route||""})){
    const label=document.createElement("label");label.textContent=text(key);const input=document.createElement("input");input.name=key;input.value=value;input.required=["title","timezone"].includes(key);input.maxLength=key==="title"?200:300;label.append(input);form.append(label);
  }
  const actions=document.createElement("div");actions.className="actions";const save=document.createElement("button");save.textContent=text("save");
  actions.append(button(text("cancel"),()=>dialog.close()),save);form.append(actions);dialog.append(form);document.body.append(dialog);
  const requestId=newRequestId(trip?"metadata":"create");
  form.addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
    const fields=Object.fromEntries(new FormData(form));
    if(trip)await hostedApi.applyChanges(trip.id,trip.version,[{type:"update_trip",fields}],requestId);
    else await hostedApi.createTrip(fields,requestId);
    dialog.close();await load();
  });});
  dialog.addEventListener("close",()=>dialog.remove());dialog.showModal();
}
async function load() {
  clearTimeout(pollTimer);
  try {
    await finishPendingLogout();
    await hostedApi.session();loggedIn=true;
    summaries=(await hostedApi.listTrips()).trips;failures=0;status("");render();
    pollTimer=setTimeout(load,20000);
  } catch(error) {
    if(error.status===401||signoutPending()){loggedIn=false;summaries=[];render();}
    status(error.status===401?"":error.message,error.status!==401);
    if(error.status!==401&&++failures<5)pollTimer=setTimeout(load,Math.min(30000,2000*2**failures));
  }
}
byId("language").addEventListener("change",()=>{language=byId("language").value;try{localStorage.setItem(LANGUAGE_STORAGE_KEY,language);}catch{}render();});
byId("archived").addEventListener("change",render);
byId("create").addEventListener("click",()=>edit());
byId("retry").addEventListener("click",load);
byId("logout").addEventListener("click",logoutAndLeave);
byId("login-form").addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
  const field=event.target.elements.token;try {await hostedApi.login(field.value);} finally {field.value="";}
  const next=safeNextPath(new URLSearchParams(location.search).get("next"));if(next)location.replace(next);else await load();
});});
byId("import").addEventListener("change",()=>run(async()=>{
  const file=byId("import").files[0];if(!file)return;if(file.size>2_000_000)throw new Error("File is too large.");
  const result=await hostedApi.importTrip(JSON.parse(await file.text()));byId("import").value="";await load();
  return result.warnings?.join(" ")||"";
}));
window.addEventListener("online",load);window.addEventListener("focus",()=>{if(!busy)load();});
window.addEventListener("pageshow",(event)=>{if(event.persisted)location.reload();});
if("serviceWorker" in navigator)navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
render();load();
