import { hostedApi, newRequestId, downloadJSON, exportFilename, safeNextPath, LANGUAGE_STORAGE_KEY, logoutAndLeave, finishPendingLogout, signoutPending, sessionCanEdit, sessionCanImport, sessionCanManageAccounts, ACCOUNT_ROLES } from "/hosted-client.js?v=__CACHE_VERSION__";
// Sign-in values, passwords and invitation codes stay in form fields only: they are cleared after
// each submission and never written to browser storage. Role-based controls follow /api/session;
// the server enforces the same permissions independently.
// A newly issued assistant access-token secret is held only in page memory (tokenNotice) and shown
// as plain text until the owner dismisses it. It is never put in storage, a URL, an attribute or
// a status message, never copied without an explicit click, and it is cleared on sign-out,
// Refresh, page reload, and when that account is revoked, changes role or the token is revoked.
const words = {
  en: ["Sign in","Admin token","Your trips","Create trip","Show archived","Import JSON","Refresh","Sign out","Edit","Archive","Restore","Export","Title","Time zone","Country","Route","Save","Cancel","No trips yet.","Changes could not be saved. Refresh and try again.",
    "Sign in","Username","Password","Owner sign-in","Have an invitation?","Invitation code","Request access","Access requested. You can sign in after the owner approves your account.","Read-only access: you can view and export trips.","Accounts","Create invitation","Share this single-use code privately. It is shown only once and expires {time}.","Approve","Revoke","Pending approval","Approved","Revoked","No accounts yet.","Unused invitations: {count}"],
  "zh-Hans": ["登录","管理令牌","我的旅行","创建旅行","显示已归档","导入 JSON","刷新","退出","编辑","归档","恢复","导出","标题","时区","国家/地区","路线","保存","取消","还没有旅行。","更改未能保存，请刷新后重试。",
    "登录","用户名","密码","所有者登录","有邀请码？","邀请码","申请访问","已提交申请。所有者批准你的账户后即可登录。","只读访问：你可以查看和导出旅行。","账户","创建邀请","请私下分享此一次性邀请码。它只显示一次，将于 {time} 过期。","批准","撤销","待批准","已批准","已撤销","还没有账户。","未使用的邀请：{count}"],
  "zh-Hant": ["登入","管理權杖","我的旅行","建立旅行","顯示已封存","匯入 JSON","重新整理","登出","編輯","封存","還原","匯出","標題","時區","國家/地區","路線","儲存","取消","尚無旅行。","變更無法儲存，請重新整理後重試。",
    "登入","使用者名稱","密碼","擁有者登入","有邀請碼？","邀請碼","申請存取","已送出申請。擁有者核准你的帳戶後即可登入。","唯讀存取：你可以檢視和匯出旅行。","帳戶","建立邀請","請私下分享此一次性邀請碼。它只會顯示一次，將於 {time} 到期。","核准","撤銷","待核准","已核准","已撤銷","尚無帳戶。","未使用的邀請：{count}"],
  ja: ["サインイン","管理トークン","旅行一覧","旅行を作成","アーカイブを表示","JSON をインポート","更新","サインアウト","編集","アーカイブ","復元","エクスポート","タイトル","タイムゾーン","国・地域","ルート","保存","キャンセル","旅行はまだありません。","変更を保存できませんでした。更新して再試行してください。",
    "サインイン","ユーザー名","パスワード","オーナーのサインイン","招待コードをお持ちですか？","招待コード","アクセスを申請","申請しました。オーナーがアカウントを承認するとサインインできます。","閲覧のみ：旅行の表示とエクスポートができます。","アカウント","招待を作成","この1回限りのコードは個別に共有してください。表示は一度だけで、{time} に期限切れになります。","承認","取り消す","承認待ち","承認済み","取り消し済み","アカウントはまだありません。","未使用の招待：{count}"]
};
const keys = ["signin","token","yourTrips","create","archived","import","retry","logout","edit","archive","restore","export","title","timezone","country","route","save","cancel","empty","failed",
  "accountSignin","username","pw","ownerSignin","haveInvite","inviteCode","requestAccess","requested","readOnly","accounts","createInvite","inviteCreated","approve","revoke","pending","approved","revoked","noAccounts","inviteCount"];
// Content-manager roles and owner-only assistant access controls.
const more = {
  en: {
    managerNote: "Content manager access: you can create, edit, import, export, archive and restore every trip. Account and security settings stay with the owner.",
    accountsNote: "Invited people start as pending viewers. Choose an access level, then approve. Content managers can edit every trip, including trips added later, but cannot manage accounts or security.",
    accessLevel: "Access level", accessLevelFor: "Access level for {name}",
    "role-viewer": "Viewer (view and export)", "role-content-manager": "Content manager (edit all trips)",
    saveRole: "Save access level", saveRoleFor: "Save access level for {name}",
    roleHint: "Saving signs this account out everywhere and ends its assistant access tokens.",
    roleSaved: "Access level saved.",
    tokens: "Assistant access tokens", showTokens: "Show assistant access", hideTokens: "Hide assistant access",
    tokensFor: "Assistant access tokens for {name}",
    tokensNote: "A token lets an AI assistant edit trips as this account through the MCP connection. It works only there, expires after 90 days and is shown once. To renew, issue a replacement, update the assistant's private settings, then revoke the old token.",
    tokensLoading: "Loading tokens…", tokensFailed: "Tokens could not be loaded.", tryAgain: "Try again", noTokens: "No access tokens yet.",
    tokenLabel: "Token name", issueToken: "Issue token", labelRequired: "Enter a token name.",
    issueFailed: "The token was not issued. It was not retried automatically; check the list before trying again.",
    tokenIssued: "Token issued. It is shown once above.",
    "token-active": "Active", "token-expired": "Expired", "token-revoked": "Revoked",
    createdAt: "Created {time}", expiresAt: "Expires {time}", lastUsed: "Last used {time}", neverUsed: "Not used yet",
    revokeToken: "Revoke token {label}", tokenRevokedNote: "Token revoked.",
    tokenOnceTitle: "New assistant access token",
    tokenOnce: "Token “{label}” for {name}. Copy it now into a private, owner-controlled settings store; it will not be shown again and expires {time}. Never paste it into a chat or a repository.",
    copy: "Copy", copied: "Copied. Store it privately, then choose Done.", copyUnavailable: "Copy is not available here. Select the token and copy it manually.",
    dismiss: "Done, hide token"
  },
  "zh-Hans": {
    managerNote: "内容管理者权限：你可以创建、编辑、导入、导出、归档和恢复所有旅行。账户和安全设置仍由所有者管理。",
    accountsNote: "受邀者最初是待批准的访客。请选择访问级别，然后批准。内容管理者可以编辑所有旅行（包括以后添加的旅行），但不能管理账户或安全设置。",
    accessLevel: "访问级别", accessLevelFor: "{name} 的访问级别",
    "role-viewer": "访客（查看和导出）", "role-content-manager": "内容管理者（编辑所有旅行）",
    saveRole: "保存访问级别", saveRoleFor: "保存 {name} 的访问级别",
    roleHint: "保存后，此账户会在所有设备上退出，其助手访问令牌也会失效。",
    roleSaved: "访问级别已保存。",
    tokens: "助手访问令牌", showTokens: "显示助手访问", hideTokens: "隐藏助手访问",
    tokensFor: "{name} 的助手访问令牌",
    tokensNote: "令牌允许 AI 助手通过 MCP 连接以此账户编辑旅行。它只能用于该连接，90 天后过期，并且只显示一次。续期时，请签发新令牌，更新助手的私密设置，然后撤销旧令牌。",
    tokensLoading: "正在加载令牌…", tokensFailed: "无法加载令牌。", tryAgain: "重试", noTokens: "还没有访问令牌。",
    tokenLabel: "令牌名称", issueToken: "签发令牌", labelRequired: "请输入令牌名称。",
    issueFailed: "令牌未能签发，系统没有自动重试。请先检查列表再重试。",
    tokenIssued: "令牌已签发，仅在上方显示一次。",
    "token-active": "有效", "token-expired": "已过期", "token-revoked": "已撤销",
    createdAt: "创建于 {time}", expiresAt: "到期：{time}", lastUsed: "上次使用：{time}", neverUsed: "尚未使用",
    revokeToken: "撤销令牌 {label}", tokenRevokedNote: "令牌已撤销。",
    tokenOnceTitle: "新的助手访问令牌",
    tokenOnce: "{name} 的令牌“{label}”。请立即复制到由所有者控制的私密设置中；它不会再次显示，将于 {time} 过期。切勿粘贴到聊天或代码仓库中。",
    copy: "复制", copied: "已复制。请私密保存，然后选择“完成”。", copyUnavailable: "此处无法复制。请选中令牌后手动复制。",
    dismiss: "完成，隐藏令牌"
  },
  "zh-Hant": {
    managerNote: "內容管理者權限：你可以建立、編輯、匯入、匯出、封存和還原所有旅行。帳戶和安全設定仍由擁有者管理。",
    accountsNote: "受邀者一開始是待核准的訪客。請選擇存取層級，然後核准。內容管理者可以編輯所有旅行（包括日後新增的旅行），但無法管理帳戶或安全設定。",
    accessLevel: "存取層級", accessLevelFor: "{name} 的存取層級",
    "role-viewer": "訪客（檢視和匯出）", "role-content-manager": "內容管理者（編輯所有旅行）",
    saveRole: "儲存存取層級", saveRoleFor: "儲存 {name} 的存取層級",
    roleHint: "儲存後，此帳戶會在所有裝置上登出，其助理存取權杖也會失效。",
    roleSaved: "存取層級已儲存。",
    tokens: "助理存取權杖", showTokens: "顯示助理存取", hideTokens: "隱藏助理存取",
    tokensFor: "{name} 的助理存取權杖",
    tokensNote: "權杖讓 AI 助理透過 MCP 連線以此帳戶編輯旅行。它只能用於該連線，90 天後到期，而且只會顯示一次。續期時，請簽發新權杖，更新助理的私密設定，然後撤銷舊權杖。",
    tokensLoading: "正在載入權杖…", tokensFailed: "無法載入權杖。", tryAgain: "重試", noTokens: "尚無存取權杖。",
    tokenLabel: "權杖名稱", issueToken: "簽發權杖", labelRequired: "請輸入權杖名稱。",
    issueFailed: "權杖未能簽發，系統沒有自動重試。請先檢查清單再重試。",
    tokenIssued: "權杖已簽發，只會在上方顯示一次。",
    "token-active": "有效", "token-expired": "已過期", "token-revoked": "已撤銷",
    createdAt: "建立於 {time}", expiresAt: "到期：{time}", lastUsed: "上次使用：{time}", neverUsed: "尚未使用",
    revokeToken: "撤銷權杖 {label}", tokenRevokedNote: "權杖已撤銷。",
    tokenOnceTitle: "新的助理存取權杖",
    tokenOnce: "{name} 的權杖「{label}」。請立即複製到由擁有者控制的私密設定中；它不會再次顯示，將於 {time} 到期。切勿貼到聊天或程式碼儲存庫中。",
    copy: "複製", copied: "已複製。請私密保存，然後選擇「完成」。", copyUnavailable: "此處無法複製。請選取權杖後手動複製。",
    dismiss: "完成，隱藏權杖"
  },
  ja: {
    managerNote: "コンテンツ管理者：すべての旅行の作成・編集・インポート・エクスポート・アーカイブ・復元ができます。アカウントとセキュリティの設定はオーナーが管理します。",
    accountsNote: "招待された人は承認待ちの閲覧者として始まります。アクセスレベルを選んでから承認してください。コンテンツ管理者は後から追加される旅行を含むすべての旅行を編集できますが、アカウントやセキュリティは管理できません。",
    accessLevel: "アクセスレベル", accessLevelFor: "{name} のアクセスレベル",
    "role-viewer": "閲覧者（表示とエクスポート）", "role-content-manager": "コンテンツ管理者（すべての旅行を編集）",
    saveRole: "アクセスレベルを保存", saveRoleFor: "{name} のアクセスレベルを保存",
    roleHint: "保存すると、このアカウントはすべての端末でサインアウトされ、アシスタント用アクセストークンも無効になります。",
    roleSaved: "アクセスレベルを保存しました。",
    tokens: "アシスタント用アクセストークン", showTokens: "アシスタント用アクセスを表示", hideTokens: "アシスタント用アクセスを隠す",
    tokensFor: "{name} のアシスタント用アクセストークン",
    tokensNote: "トークンを使うと、AI アシスタントが MCP 接続を通じてこのアカウントとして旅行を編集できます。この接続でのみ有効で、90 日後に期限切れになり、表示は一度だけです。更新するには、新しいトークンを発行してアシスタントの非公開設定を更新し、古いトークンを取り消してください。",
    tokensLoading: "トークンを読み込み中…", tokensFailed: "トークンを読み込めませんでした。", tryAgain: "再試行", noTokens: "アクセストークンはまだありません。",
    tokenLabel: "トークン名", issueToken: "トークンを発行", labelRequired: "トークン名を入力してください。",
    issueFailed: "トークンを発行できませんでした。自動では再試行していません。一覧を確認してから再度お試しください。",
    tokenIssued: "トークンを発行しました。上に一度だけ表示されます。",
    "token-active": "有効", "token-expired": "期限切れ", "token-revoked": "取り消し済み",
    createdAt: "作成：{time}", expiresAt: "期限：{time}", lastUsed: "最終使用：{time}", neverUsed: "未使用",
    revokeToken: "トークン「{label}」を取り消す", tokenRevokedNote: "トークンを取り消しました。",
    tokenOnceTitle: "新しいアシスタント用アクセストークン",
    tokenOnce: "{name} のトークン「{label}」。今すぐオーナーが管理する非公開の設定保存先にコピーしてください。再表示されず、{time} に期限切れになります。チャットやリポジトリには絶対に貼り付けないでください。",
    copy: "コピー", copied: "コピーしました。非公開で保存してから「完了」を選んでください。", copyUnavailable: "ここではコピーできません。トークンを選択して手動でコピーしてください。",
    dismiss: "完了（トークンを隠す）"
  }
};
const LABEL_MAX = 60;
let language = "en";
try { language = localStorage.getItem(LANGUAGE_STORAGE_KEY) || "en"; } catch {}
let summaries = []; let loggedIn = false; let busy = false; let pollTimer; let failures = 0;
let session = null; let directory = { accounts: [], invitations: [] }; let inviteNotice = null;
// Owner-only, page-memory state. tokenNotice is the only place a token secret ever exists.
let tokenNotice = null; const roleDrafts = new Map(); const tokenPanels = new Map(); const labelDrafts = new Map(); let accountsKey = "";
const byId = (id) => document.getElementById(id);
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (all, name) => String(values[name] ?? all));
const text = (key, values = {}) => fill((more[language] || more.en)[key] ?? more.en[key] ?? (words[language] || words.en)[keys.indexOf(key)] ?? key, values);
const when = (value) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "" : date.toLocaleString(language); };
const roleOf = (account) => ACCOUNT_ROLES.includes(account?.role) ? account.role : "viewer";
const isApprovedManager = (account) => account?.status === "approved" && account?.role === "content-manager";
function render() {
  document.documentElement.lang = language; byId("language").value = language;
  document.querySelectorAll("[data-text]").forEach((node) => {node.textContent=text(node.dataset.text);});
  const canEdit = loggedIn && sessionCanEdit(session); const canImport = loggedIn && sessionCanImport(session); const canManage = loggedIn && sessionCanManageAccounts(session);
  byId("logout").textContent=text("logout"); byId("logout").hidden=!loggedIn;
  byId("login").hidden=loggedIn; byId("trips").hidden=!loggedIn;
  byId("create").hidden=!canEdit; byId("import-control").hidden=!canImport; byId("import").disabled=!canImport;
  byId("read-only-note").hidden=!loggedIn||canEdit;
  byId("manager-note").hidden=!canEdit||canManage;
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
function renderTokenNotice(canManage) {
  const show = Boolean(canManage && tokenNotice);
  byId("token-output").hidden = !show;
  byId("token-message").textContent = show ? text("tokenOnce", { label: tokenNotice.label, name: tokenNotice.username, time: when(tokenNotice.expiresAt) }) : "";
  // Plain text only: the secret is never parsed as HTML or placed in an attribute.
  byId("token-secret").textContent = show ? tokenNotice.secret : "";
  if (!show) byId("token-copy-status").textContent = "";
}
function renderAccounts(canManage) {
  byId("accounts").hidden=!canManage;
  renderTokenNotice(canManage);
  const output=byId("invite-output");
  if (!canManage) { output.replaceChildren(); output.hidden=true; byId("account-list").replaceChildren(); byId("invite-count").textContent=""; accountsKey=""; return; }
  output.hidden=!inviteNotice; output.replaceChildren();
  if (inviteNotice) {
    const message=document.createElement("span");message.textContent=text("inviteCreated",{time:new Date(inviteNotice.expiresAt).toLocaleString(language)});
    const code=document.createElement("code");code.textContent=inviteNotice.token;
    output.append(message,code);
  }
  byId("invite-count").textContent=text("inviteCount",{count:directory.invitations.length});
  // Rebuild the list only when something visible changed, so background refreshes do not
  // interrupt typing or move keyboard focus.
  const key=JSON.stringify([language,directory.accounts,[...roleDrafts],[...tokenPanels]]);
  if (key===accountsKey) return;
  accountsKey=key;
  const focused=document.activeElement?.dataset?.focusKey;
  const list=byId("account-list");list.replaceChildren();
  if (!directory.accounts.length) { const empty=document.createElement("li");empty.textContent=text("noAccounts");list.append(empty); }
  for (const account of directory.accounts) list.append(accountRow(account));
  if (focused) focusByKey(focused);
}
function focusByKey(value) {
  [...byId("account-list").querySelectorAll("[data-focus-key]")].find((node) => node.dataset.focusKey === value)?.focus();
}
function accountRow(account) {
  const role=roleOf(account); const draft=roleDrafts.get(account.id);
  const row=document.createElement("li");row.className="account-row";row.dataset.accountId=account.id;row.dataset.status=account.status;row.dataset.role=role;
  const name=document.createElement("strong");name.textContent=account.username;
  const state=document.createElement("span");state.className="account-status";state.textContent=text(account.status);
  const level=document.createElement("label");level.className="role-control";
  const levelText=document.createElement("span");levelText.textContent=text("accessLevel");
  const select=document.createElement("select");select.name="role";select.setAttribute("aria-label",text("accessLevelFor",{name:account.username}));select.dataset.focusKey="role:"+account.id;
  for (const value of ACCOUNT_ROLES) { const option=document.createElement("option");option.value=value;option.textContent=text("role-"+value);select.append(option); }
  select.value=draft||role;
  select.addEventListener("change",()=>{ if (select.value===role) roleDrafts.delete(account.id); else roleDrafts.set(account.id,select.value); render(); });
  level.append(levelText,select);
  const actions=document.createElement("div");actions.className="card-actions";
  if (account.status!=="approved") actions.append(button(text("approve"),async()=>{await hostedApi.approveAccount(account.id);await refreshAccounts();}));
  if (account.status!=="revoked") actions.append(button(text("revoke"),async()=>{await hostedApi.revokeAccount(account.id);forgetAccountSecrets(account.id);await refreshAccounts();}));
  row.append(name,state,level,actions);
  if (draft && draft!==role) {
    // The apply control exists only while an unsaved choice is pending.
    const pending=document.createElement("div");pending.className="role-pending";
    const hint=document.createElement("p");hint.className="note";hint.textContent=text("roleHint");
    const save=button(text("saveRole"),async()=>{
      if(!sessionCanManageAccounts(session))return;
      await hostedApi.setAccountRole(account.id,draft);
      roleDrafts.delete(account.id);forgetAccountSecrets(account.id);await refreshAccounts();
      focusByKey("role:"+account.id);
      return text("roleSaved");
    });
    save.setAttribute("aria-label",text("saveRoleFor",{name:account.username}));save.dataset.focusKey="save-role:"+account.id;
    pending.append(hint,save);row.append(pending);
  }
  if (isApprovedManager(account)) row.append(tokenSection(account));
  return row;
}
function tokenSection(account) {
  const panel=tokenPanels.get(account.id); const open=Boolean(panel);
  const wrap=document.createElement("div");wrap.className="token-section";
  const regionId="tokens-"+account.id;
  const toggle=button(text(open?"hideTokens":"showTokens"),async()=>{
    if (tokenPanels.has(account.id)) { tokenPanels.delete(account.id); render(); return; }
    tokenPanels.set(account.id,{status:"loading",tokens:null}); render(); await loadTokens(account.id);
  });
  toggle.className="token-toggle";toggle.setAttribute("aria-expanded",String(open));toggle.setAttribute("aria-controls",regionId);toggle.dataset.focusKey="tokens:"+account.id;
  wrap.append(toggle);
  if (!open) return wrap;
  const region=document.createElement("section");region.className="token-panel";region.id=regionId;region.setAttribute("aria-label",text("tokensFor",{name:account.username}));
  const heading=document.createElement("h3");heading.textContent=text("tokens");
  const note=document.createElement("p");note.className="note";note.textContent=text("tokensNote");
  region.append(heading,note);
  if (panel.status==="loading") { const loading=document.createElement("p");loading.className="note";loading.setAttribute("role","status");loading.textContent=text("tokensLoading");region.append(loading); }
  if (panel.status==="failed") {
    const failed=document.createElement("p");failed.className="token-error";failed.setAttribute("role","alert");failed.textContent=text("tokensFailed");
    const retry=button(text("tryAgain"),()=>loadTokens(account.id));retry.dataset.focusKey="tokens-retry:"+account.id;
    region.append(failed,retry);
  }
  if (Array.isArray(panel.tokens)) {
    const list=document.createElement("ul");list.className="token-list";
    if (!panel.tokens.length) { const empty=document.createElement("li");empty.className="note";empty.textContent=text("noTokens");list.append(empty); }
    for (const token of panel.tokens) list.append(tokenRow(account,token));
    region.append(list);
  }
  const form=document.createElement("form");form.className="token-issue-form";
  const label=document.createElement("label");const labelText=document.createElement("span");labelText.textContent=text("tokenLabel");
  const input=document.createElement("input");input.name="label";input.type="text";input.required=true;input.maxLength=LABEL_MAX;input.autocomplete="off";input.spellcheck=false;
  input.value=labelDrafts.get(account.id)||"";input.dataset.focusKey="token-label:"+account.id;
  input.addEventListener("input",()=>labelDrafts.set(account.id,input.value));
  label.append(labelText,input);
  const issue=document.createElement("button");issue.type="submit";issue.textContent=text("issueToken");issue.dataset.focusKey="token-issue:"+account.id;
  form.append(label,issue);
  form.addEventListener("submit",(event)=>{event.preventDefault();run(()=>issueToken(account,input.value));});
  region.append(form);wrap.append(region);
  return wrap;
}
function tokenRow(account,token) {
  const state=token.revokedAt?"revoked":Date.parse(token.expiresAt)<=Date.now()?"expired":"active";
  const item=document.createElement("li");item.className="token-row";item.dataset.tokenId=token.id;item.dataset.state=state;
  const name=document.createElement("strong");name.textContent=token.label;
  const badge=document.createElement("span");badge.className="token-state";badge.textContent=text("token-"+state);
  const details=document.createElement("span");details.className="token-dates";
  details.textContent=[text("createdAt",{time:when(token.createdAt)}),text("expiresAt",{time:when(token.expiresAt)}),token.lastUsedAt?text("lastUsed",{time:when(token.lastUsedAt)}):text("neverUsed")].join(" · ");
  item.append(name,badge,details);
  if (state==="active") {
    const revoke=button(text("revoke"),async()=>{
      if(!sessionCanManageAccounts(session))return;
      await hostedApi.revokeMcpToken(account.id,token.id);
      if (tokenNotice?.tokenId===token.id) tokenNotice=null;
      await loadTokens(account.id);
      return text("tokenRevokedNote");
    });
    revoke.setAttribute("aria-label",text("revokeToken",{label:token.label}));revoke.dataset.focusKey="token-revoke:"+token.id;
    item.append(revoke);
  }
  return item;
}
// Single attempt by design: any failure is reported and the owner decides whether to try again.
async function issueToken(account,rawLabel) {
  if(!sessionCanManageAccounts(session))return;
  const label=String(rawLabel||"").trim().slice(0,LABEL_MAX);
  if(!label)throw new Error(text("labelRequired"));
  let result;
  try { result=await hostedApi.issueMcpToken(account.id,label); }
  catch(error) {
    if(error.status===401)throw error;
    // A lost response may still have created a token: re-read the list (never re-issue).
    if(tokenPanels.has(account.id))await loadTokens(account.id);
    throw new Error(text("issueFailed"));
  }
  if(typeof result?.secret!=="string"||!result.secret){ if(tokenPanels.has(account.id))await loadTokens(account.id); throw new Error(text("issueFailed")); }
  tokenNotice={accountId:account.id,tokenId:result.token?.id,username:account.username,label:result.token?.label||label,expiresAt:result.token?.expiresAt,secret:result.secret};
  result=null;labelDrafts.delete(account.id);
  render();byId("token-output").focus();
  if(tokenPanels.has(account.id))await loadTokens(account.id);
  return text("tokenIssued");
}
async function loadTokens(accountId) {
  const panel=tokenPanels.get(accountId); if(!panel)return;
  if(!panel.tokens){panel.status="loading";render();}
  try {
    const {tokens}=await hostedApi.listMcpTokens(accountId);
    if(tokenPanels.get(accountId)!==panel)return;
    panel.tokens=Array.isArray(tokens)?tokens:[];panel.status="ready";
  } catch(error) {
    if(error.status===401){signedOut();return;}
    if(tokenPanels.get(accountId)===panel)panel.status="failed";
  }
  render();
}
function forgetAccountSecrets(accountId) {
  if(tokenNotice?.accountId===accountId)tokenNotice=null;
  tokenPanels.delete(accountId);labelDrafts.delete(accountId);
}
// Drops owner-only state for accounts that are no longer approved content managers
// (for example after a revoke or role change made elsewhere).
function reconcileAccountState() {
  const byAccount=new Map(directory.accounts.map((account)=>[account.id,account]));
  for(const id of [...tokenPanels.keys()])if(!isApprovedManager(byAccount.get(id)))forgetAccountSecrets(id);
  for(const [id,draft] of [...roleDrafts])if(!byAccount.has(id)||roleOf(byAccount.get(id))===draft)roleDrafts.delete(id);
  if(tokenNotice&&!isApprovedManager(byAccount.get(tokenNotice.accountId)))tokenNotice=null;
}
async function refreshAccounts() { directory=await hostedApi.listAccounts(); reconcileAccountState(); render(); }
function status(message,error=false) {byId("status").textContent=message;byId("status").dataset.error=String(error);}
function button(label,action) {
  const node=document.createElement("button");node.type="button";node.textContent=label;
  node.addEventListener("click",()=>run(action));return node;
}
// Clears everything protected that is visible or held in page memory (trips, accounts,
// invitation code, token secret, unsaved owner choices).
function clearOwnerState() {tokenNotice=null;inviteNotice=null;roleDrafts.clear();tokenPanels.clear();labelDrafts.clear();accountsKey="";}
function signedOut() {loggedIn=false;session=null;summaries=[];directory={accounts:[],invitations:[]};clearOwnerState();render();}
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
    // Re-checked on every refresh: a revoked account's next poll returns 401 and clears the page.
    session=await hostedApi.session();loggedIn=true;
    summaries=(await hostedApi.listTrips()).trips;
    if(sessionCanManageAccounts(session)){directory=await hostedApi.listAccounts();reconcileAccountState();}
    else{directory={accounts:[],invitations:[]};clearOwnerState();}
    failures=0;status("");render();
    for(const id of [...tokenPanels.keys()])await loadTokens(id);
    if(!loggedIn)return;
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
function selectSecret() {
  try { const selection=window.getSelection(); selection?.removeAllRanges(); selection?.selectAllChildren(byId("token-secret")); } catch {}
}
byId("language").addEventListener("change",()=>{language=byId("language").value;try{localStorage.setItem(LANGUAGE_STORAGE_KEY,language);}catch{}render();});
byId("archived").addEventListener("change",render);
byId("create").addEventListener("click",()=>edit());
// An explicit Refresh also discards a displayed token secret.
byId("retry").addEventListener("click",()=>{tokenNotice=null;render();load();});
byId("logout").addEventListener("click",()=>{clearOwnerState();renderTokenNotice(false);logoutAndLeave();});
// Copying happens only on this explicit click; nothing is copied or sent automatically.
byId("token-copy").addEventListener("click",async()=>{
  const secret=tokenNotice?.secret;if(!secret)return;
  const note=byId("token-copy-status");
  try { if(!navigator.clipboard?.writeText)throw new Error("unavailable"); await navigator.clipboard.writeText(secret); note.textContent=text("copied"); }
  catch { note.textContent=text("copyUnavailable"); selectSecret(); }
});
byId("token-dismiss").addEventListener("click",()=>{
  const accountId=tokenNotice?.accountId;tokenNotice=null;
  try{window.getSelection()?.removeAllRanges();}catch{}
  render();
  if(accountId)focusByKey("tokens:"+accountId);
});
byId("login-form").addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
  const field=event.target.elements.token;try {await hostedApi.login(field.value);} finally {field.value="";}
  await afterSignIn();
});});
byId("viewer-login-form").addEventListener("submit",(event)=>{event.preventDefault();run(async()=>{
  const form=event.target;const name=form.elements.username.value;const secret=form.elements.password.value;
  form.elements.password.value="";
  try {await hostedApi.loginAccount(name,secret);} finally {form.reset();}
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
  if(!sessionCanImport(session))return;
  const file=byId("import").files[0];if(!file)return;if(file.size>2_000_000)throw new Error("File is too large.");
  const result=await hostedApi.importTrip(JSON.parse(await file.text()));byId("import").value="";await load();
  return result.warnings?.join(" ")||"";
}));
window.addEventListener("online",load);window.addEventListener("focus",()=>{if(!busy)load();});
window.addEventListener("pageshow",(event)=>{if(event.persisted)location.reload();});
if("serviceWorker" in navigator)navigator.serviceWorker.register("/service-worker.js").catch(()=>{});
render();load();
