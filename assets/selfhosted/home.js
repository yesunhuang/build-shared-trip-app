import { hostedApi, newRequestId, downloadJSON, exportFilename, safeNextPath, LANGUAGE_STORAGE_KEY, logoutAndLeave, finishPendingLogout, signoutPending, sessionCanEdit, sessionCanManageAccounts } from "/hosted-client.js?v=__CACHE_VERSION__";
// Sign-in values, passwords and invitation codes stay in form fields only: they are cleared after
// each submission and never written to browser storage. Role-based controls follow /api/session;
// the server enforces the same permissions independently.
const words = {
  en: ["Sign in","Admin token","Your trips","Create trip","Show archived","Import JSON","Refresh","Sign out","Edit","Archive","Restore","Export","Title","Time zone","Country","Route","Save","Cancel","No trips yet.","Changes could not be saved. Refresh and try again.",
    "Sign in","Username","Password","Owner sign-in","Have an invitation?","Invitation code","Request access","Access requested. You can sign in after the owner approves your account.","Read-only access: you can view and export trips.","Viewer accounts","Create invitation","Share this single-use code privately. It is shown only once and expires {time}.","Approve","Revoke","Pending approval","Approved","Revoked","No viewer accounts yet.","Unused invitations: {count}"],
  "zh-Hans": ["登录","管理令牌","我的旅行","创建旅行","显示已归档","导入 JSON","刷新","退出","编辑","归档","恢复","导出","标题","时区","国家/地区","路线","保存","取消","还没有旅行。","更改未能保存，请刷新后重试。",
    "登录","用户名","密码","所有者登录","有邀请码？","邀请码","申请访问","已提交申请。所有者批准你的账户后即可登录。","只读访问：你可以查看和导出旅行。","访客账户","创建邀请","请私下分享此一次性邀请码。它只显示一次，将于 {time} 过期。","批准","撤销","待批准","已批准","已撤销","还没有访客账户。","未使用的邀请：{count}"],
  "zh-Hant": ["登入","管理權杖","我的旅行","建立旅行","顯示已封存","匯入 JSON","重新整理","登出","編輯","封存","還原","匯出","標題","時區","國家/地區","路線","儲存","取消","尚無旅行。","變更無法儲存，請重新整理後重試。",
    "登入","使用者名稱","密碼","擁有者登入","有邀請碼？","邀請碼","申請存取","已送出申請。擁有者核准你的帳戶後即可登入。","唯讀存取：你可以檢視和匯出旅行。","訪客帳戶","建立邀請","請私下分享此一次性邀請碼。它只會顯示一次，將於 {time} 到期。","核准","撤銷","待核准","已核准","已撤銷","尚無訪客帳戶。","未使用的邀請：{count}"],
  ja: ["サインイン","管理トークン","旅行一覧","旅行を作成","アーカイブを表示","JSON をインポート","更新","サインアウト","編集","アーカイブ","復元","エクスポート","タイトル","タイムゾーン","国・地域","ルート","保存","キャンセル","旅行はまだありません。","変更を保存できませんでした。更新して再試行してください。",
    "サインイン","ユーザー名","パスワード","オーナーのサインイン","招待コードをお持ちですか？","招待コード","アクセスを申請","申請しました。オーナーがアカウントを承認するとサインインできます。","閲覧のみ：旅行の表示とエクスポートができます。","閲覧者アカウント","招待を作成","この1回限りのコードは個別に共有してください。表示は一度だけで、{time} に期限切れになります。","承認","取り消す","承認待ち","承認済み","取り消し済み","閲覧者アカウントはまだありません。","未使用の招待：{count}"]
};
const keys = ["signin","token","yourTrips","create","archived","import","retry","logout","edit","archive","restore","export","title","timezone","country","route","save","cancel","empty","failed",
  "viewerSignin","username","pw","ownerSignin","haveInvite","inviteCode","requestAccess","requested","readOnly","accounts","createInvite","inviteCreated","approve","revoke","pending","approved","revoked","noAccounts","inviteCount"];
let language = "en";
try { language = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "en"; } catch {}
let summaries = []; let loggedIn = false; let busy = false; let pollTimer; let failures = 0;
let session = null; let directory = { accounts: [], invitations: [] }; let inviteNotice = null;
const byId = (id) => document.getElementById(id);
const text = (key, values = {}) => ((words[language] || words.en)[keys.indexOf(key)] || key).replace(/\{(\w+)\}/g, (all, name) => String(values[name] ?? all));
function render() {
  document.documentElement.lang = language; byId("language").value = language;
  document.querySelectorAll("[data-text]").forEach((node) => {node.textContent=text(node.dataset.text);});
  const canEdit = loggedIn && sessionCanEdit(session); const canManage = loggedIn && sessionCanManageAccounts(session);
  byId("logout").textContent=text("logout"); byId("logout").hidden=!loggedIn;
  byId("login").hidden=loggedIn; byId("trips").hidden=!loggedIn;
  byId("create").hidden=!canEdit; byId("import-control").hidden=!canEdit; byId("import").disabled=!canEdit;
  byId("read-only-note").hidden=!loggedIn||canEdit;
  byId("list").replaceChildren();
  renderAccounts(canManage);
  if (!loggedIn) return;
  const visible = summaries.filter((trip) => byId("archived").checked || !trip.archived);
  if (!visible.length) byId("list").textContent=text("empty");
  for (const trip of visible) {
    const card=document.createElement("article");card.className="trip-card";
    const heading=document.createElement("h2");const link=document.createElement("a");
    link.href="/trips/"+encodeURIComponent(trip.id);link.textContent=trip.title;heading.append(link);
    const dates=document.createElement("p"); dates.textContent=[trip.dateRange?.start,trip.dateRange?.end,trip.archived?text("archive"):""].filter(Boolean).join(" · ");
    const actions=document.createElement("div");actions.className="card-actions";
    if (canEdit) actions.append(button(text("edit"),async()=>{const {trip:full}=await hostedApi.getTrip(trip.id);edit(full);}),
      button(text(trip.archived?"restore":"archive"),async()=>{await hostedApi.applyChanges(trip.id,trip.version,[{type:"archive_trip",archived:!trip.archived}]);await load();}));
    actions.append(button(text("export"),async()=>downloadJSON(await hostedApi.exportTrip(trip.id),exportFilename(trip))));
    card.append(heading,dates,actions);byId("list").append(card);
  }
}
function renderAccounts(canManage) {
  byId("accounts").hidden=!canManage;
  const output=byId("invite-output");
  if (!canManage) { output.replaceChildren(); output.hidden=true; byId("account-list").replaceChildren(); byId("invite-count").textContent=""; return; }
  output.hidden=!inviteNotice; output.replaceChildren();
  if (inviteNotice) {
    const message=document.createElement("span");message.textContent=text("inviteCreated",{time:new Date(inviteNotice.expiresAt).toLocaleString(language)});
    const code=document.createElement("code");code.textContent=inviteNotice.token;
    output.append(message,code);
  }
  byId("invite-count").textContent=text("inviteCount",{count:directory.invitations.length});
  const list=byId("account-list");list.replaceChildren();
  if (!directory.accounts.length) { const empty=document.createElement("li");empty.textContent=text("noAccounts");list.append(empty); }
  for (const account of directory.accounts) {
    const row=document.createElement("li");row.className="account-row";row.dataset.accountId=account.id;row.dataset.status=account.status;
    const name=document.createElement("strong");name.textContent=account.username;
    const state=document.createElement("span");state.className="account-status";state.textContent=text(account.status);
    const actions=document.createElement("div");actions.className="card-actions";
    if (account.status!=="approved") actions.append(button(text("approve"),async()=>{await hostedApi.approveAccount(account.id);await refreshAccounts();}));
    if (account.status!=="revoked") actions.append(button(text("revoke"),async()=>{await hostedApi.revokeAccount(account.id);await refreshAccounts();}));
    row.append(name,state,actions);list.append(row);
  }
}
async function refreshAccounts() { directory=await hostedApi.listAccounts(); render(); }
function status(message,error=false) {byId("status").textContent=message;byId("status").dataset.error=String(error);}
function button(label,action) {
  const node=document.createElement("button");node.type="button";node.textContent=label;
  node.addEventListener("click",()=>run(action));return node;
}
// Clears everything protected that is visible or held in page memory (trips, accounts, invitation code).
function signedOut() {loggedIn=false;session=null;summaries=[];directory={accounts:[],invitations:[]};inviteNotice=null;render();}
async function run(action) {
  if(busy)return;busy=true;document.querySelectorAll("button").forEach((b)=>b.disabled=true);
  try {const message=await action();status(typeof message==="string"?message:"");} catch(error) {if(error.status===401)signedOut();status(error.isConflict?text("failed"):error.message,true);}
  finally {busy=false;document.querySelectorAll("button").forEach((b)=>b.disabled=false);}
}
function edit(trip) {
  if (!sessionCanEdit(session)) return;
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
    // Re-checked on every refresh: a revoked viewer's next poll returns 401 and clears the page.
    session=await hostedApi.session();loggedIn=true;
    summaries=(await hostedApi.listTrips()).trips;
    directory=sessionCanManageAccounts(session)?await hostedApi.listAccounts():{accounts:[],invitations:[]};
    failures=0;status("");render();
    pollTimer=setTimeout(load,20000);
  } catch(error) {
    if(error.status===401||signoutPending())signedOut();
    status(error.status===401?"":error.message,error.status!==401);
    if(error.status!==401&&++failures<5)pollTimer=setTimeout(load,Math.min(30000,2000*2**failures));
  }
}
async function afterSignIn() {
  const next=safeNextPath(new URLSearchParams(location.search).get("next"));if(next)location.replace(next);else await load();
}
byId("language").addEventListener("change",()=>{language=byId("language").value;try{localStorage.setItem(LANGUAGE_STORAGE_KEY,language);}catch{}render();});
byId("archived").addEventListener("change",render);
byId("create").addEventListener("click",()=>edit());
byId("retry").addEventListener("click",load);
byId("logout").addEventListener("click",logoutAndLeave);
byId("login-form").addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
  const field=event.target.elements.token;try {await hostedApi.login(field.value);} finally {field.value="";}
  await afterSignIn();
});});
byId("viewer-login-form").addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
  const form=event.target;const name=form.elements.username.value;const secret=form.elements.password.value;
  form.elements.password.value="";
  try {await hostedApi.loginViewer(name,secret);} finally {form.reset();}
  await afterSignIn();
});});
byId("invite-form").addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
  const form=event.target;const code=form.elements.invitation.value.trim();const name=form.elements.username.value;const secret=form.elements.password.value;
  form.elements.password.value="";
  await hostedApi.acceptInvitation(code,name,secret);
  form.reset();byId("invite-panel").open=false;
  return text("requested");
});});
byId("create-invite").addEventListener("click",()=>run(async()=>{
  if(!sessionCanManageAccounts(session))return;
  inviteNotice=(await hostedApi.createInvitation()).invitation;await refreshAccounts();
}));
byId("import").addEventListener("change",()=>run(async()=>{
  if(!sessionCanEdit(session))return;
  const file=byId("import").files[0];if(!file)return;if(file.size>2_000_000)throw new Error("File is too large.");
  const result=await hostedApi.importTrip(JSON.parse(await file.text()));byId("import").value="";await load();
  return result.warnings?.join(" ")||"";
}));
window.addEventListener("online",load);window.addEventListener("focus",()=>{if(!busy)load();});
window.addEventListener("pageshow",(event)=>{if(event.persisted)location.reload();});
if("serviceWorker" in navigator)navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
render();load();
