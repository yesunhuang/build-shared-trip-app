import {hostedApi,newRequestId} from "./hosted-client.js?v=v-1b17bacdae34";
const words={
 en:{open:"Participants",title:"Trip participants",empty:"No participants assigned.",creator:"Creator",refresh:"Refresh",close:"Close",invite:"Create join code",hours:"Code expires in",day:"24 hours",three:"3 days",week:"7 days",once:"Share this code privately. It is shown once and joins one approved account.",hide:"Hide code",revoke:"Revoke code",codes:"Join codes",used:"Used",revoked:"Revoked",expired:"Expired",active:"Available",account:"Approved account",role:"Trip access",member:"Member (read and export)",ownerRole:"Creator (edit and invite)",remove:"Remove access",assign:"Save access",choose:"Choose an account",failed:"Could not confirm the change. Refresh before trying again.",conflict:"Participants changed. Refresh before retrying.",unavailable:"This trip is no longer available.",join:"Join a trip",code:"Trip invitation code",submit:"Join trip",retry:"Retry joining",cancel:"Cancel",invalid:"Enter a valid trip code.",joinFailed:"The invitation could not be used. Ask its creator for a new code.",uncertain:"Joining could not be confirmed. Retry the same request or cancel.",joined:"Trip joined.",openTrip:"Open trip"},
 "zh-Hans":{open:"参与者",title:"旅行参与者",empty:"尚未分配参与者。",creator:"创建者",refresh:"刷新",close:"关闭",invite:"创建加入码",hours:"加入码有效期",day:"24 小时",three:"3 天",week:"7 天",once:"请私下分享此码。它仅显示一次，可供一个已获批准的账户加入。",hide:"隐藏加入码",revoke:"撤销加入码",codes:"加入码",used:"已使用",revoked:"已撤销",expired:"已过期",active:"可使用",account:"已批准的账户",role:"旅行权限",member:"成员（查看和导出）",ownerRole:"创建者（编辑和邀请）",remove:"移除权限",assign:"保存权限",choose:"选择账户",failed:"无法确认更改。请先刷新再重试。",conflict:"参与者已更改。请刷新后重试。",unavailable:"此旅行已不可用。",join:"加入旅行",code:"旅行邀请码",submit:"加入旅行",retry:"重试加入",cancel:"取消",invalid:"请输入有效的旅行邀请码。",joinFailed:"无法使用此邀请码。请向创建者索取新码。",uncertain:"无法确认是否加入。请重试相同请求或取消。",joined:"已加入旅行。",openTrip:"打开旅行"},
 "zh-Hant":{open:"參與者",title:"旅行參與者",empty:"尚未分配參與者。",creator:"建立者",refresh:"重新整理",close:"關閉",invite:"建立加入碼",hours:"加入碼有效期",day:"24 小時",three:"3 天",week:"7 天",once:"請私下分享此碼。它只顯示一次，可供一個已獲批准的帳戶加入。",hide:"隱藏加入碼",revoke:"撤銷加入碼",codes:"加入碼",used:"已使用",revoked:"已撤銷",expired:"已過期",active:"可使用",account:"已批准的帳戶",role:"旅行權限",member:"成員（檢視及匯出）",ownerRole:"建立者（編輯及邀請）",remove:"移除權限",assign:"儲存權限",choose:"選擇帳戶",failed:"無法確認變更。請先重新整理再重試。",conflict:"參與者已變更。請重新整理後重試。",unavailable:"此旅行已無法使用。",join:"加入旅行",code:"旅行邀請碼",submit:"加入旅行",retry:"重試加入",cancel:"取消",invalid:"請輸入有效的旅行邀請碼。",joinFailed:"無法使用此邀請碼。請向建立者索取新碼。",uncertain:"無法確認是否加入。請重試相同請求或取消。",joined:"已加入旅行。",openTrip:"開啟旅行"},
 ja:{open:"参加者",title:"旅行の参加者",empty:"参加者は未設定です。",creator:"作成者",refresh:"更新",close:"閉じる",invite:"参加コードを作成",hours:"コードの有効期間",day:"24 時間",three:"3 日",week:"7 日",once:"コードは非公開で共有してください。一度だけ表示され、承認済みの1アカウントが参加できます。",hide:"コードを隠す",revoke:"コードを無効化",codes:"参加コード",used:"使用済み",revoked:"無効",expired:"期限切れ",active:"使用可能",account:"承認済みアカウント",role:"旅行へのアクセス",member:"メンバー（閲覧・書き出し）",ownerRole:"作成者（編集・招待）",remove:"アクセスを削除",assign:"アクセスを保存",choose:"アカウントを選択",failed:"変更を確認できません。更新してから再試行してください。",conflict:"参加者が変更されました。更新してください。",unavailable:"この旅行にはアクセスできません。",join:"旅行に参加",code:"旅行の招待コード",submit:"参加する",retry:"参加を再試行",cancel:"キャンセル",invalid:"有効な旅行コードを入力してください。",joinFailed:"この招待は使えません。作成者に新しいコードを依頼してください。",uncertain:"参加を確認できません。同じリクエストを再試行するかキャンセルしてください。",joined:"参加しました。",openTrip:"旅行を開く"}
};
export const membershipText=(language,key)=>words[language]?.[key]??words.en[key];
const node=(doc,tag,text)=>{const n=doc.createElement(tag);if(text)n.textContent=text;return n;};
const button=(doc,text,work)=>{const b=node(doc,"button",text);b.type="button";b.addEventListener("click",work);return b;};
const label=(doc,text,input)=>{const n=node(doc,"label",text);n.append(input);return n;};

export function createTripParticipantsDialog({document:doc,tripId,language="en",api=hostedApi,onAccessLost=()=>{}}){
 const t=key=>membershipText(language,key),dialog=node(doc,"dialog"),heading=node(doc,"h2",t("title")),status=node(doc,"p"),body=node(doc,"div"),secret=node(doc,"section"),output=node(doc,"code");
 dialog.className="trip-access-dialog";dialog.dataset.tripId=tripId;heading.id="trip-access-title";dialog.setAttribute("aria-labelledby",heading.id);status.setAttribute("role","status");secret.hidden=true;output.className="trip-join-secret";
 let current,busy=false,closed=false,epoch=0;
 function clear(){output.textContent="";secret.hidden=true;}
 const hide=button(doc,t("hide"),clear);secret.append(node(doc,"p",t("once")),output,hide);
 const controls=node(doc,"div");controls.className="actions";
 const close=button(doc,t("close"),()=>dialog.close());close.dataset.accessClose="true";
 controls.append(button(doc,t("refresh"),()=>{clear();load();}),close);dialog.append(heading,status,body,secret,controls);
 async function run(work){if(busy||closed)return;busy=true;dialog.querySelectorAll("button:not([data-access-close]),input,select").forEach(n=>n.disabled=true);status.textContent="";
  try{await work();}catch(e){if(closed)return;status.textContent=t(e.status===409?"conflict":e.status===401||e.status===404?"unavailable":"failed");if(e.status===401||e.status===404){clear();body.replaceChildren();onAccessLost(e);}}
  finally{busy=false;if(!closed)dialog.querySelectorAll("button,input,select").forEach(n=>n.disabled=false);}
 }
 async function refresh(){
  const generation=++epoch,payload=await api.getTrip(tripId);if(closed||generation!==epoch)return;current=payload;clear();body.replaceChildren();
  const list=node(doc,"ul");for(const user of payload.members||[])list.append(node(doc,"li",user.username+(user.creator?" · "+t("creator"):"")));body.append(list);if(!list.children.length)body.append(node(doc,"p",t("empty")));
  if(payload.access?.canAssign){
   const directory=await api.listAccounts();if(closed||generation!==epoch)return;
   const form=node(doc,"form"),select=node(doc,"select"),role=node(doc,"select");select.required=true;select.name="account";role.name="role";
   const placeholder=node(doc,"option",t("choose"));placeholder.value="";select.append(placeholder);
   for(const account of directory.accounts.filter(a=>a.status==="approved")){const option=node(doc,"option",account.username);option.value=account.id;select.append(option);}
   for(const key of ["member","ownerRole","remove"]){const option=node(doc,"option",t(key));option.value=key==="ownerRole"?"creator":key;role.append(option);}
   const save=node(doc,"button",t("assign"));form.append(label(doc,t("account"),select),label(doc,t("role"),role),save);
   form.addEventListener("submit",e=>{e.preventDefault();if(!select.value)return;const input={userId:select.value,role:role.value,expectedAccessVersion:current.access.version,requestId:newRequestId("membership")};run(async()=>{await api.assignTripMember(tripId,input);await refresh();});});body.append(form);
  }
  if(payload.access?.canInvite){
   const select=node(doc,"select");for(const [value,key] of [[24,"day"],[72,"three"],[168,"week"]]){const option=node(doc,"option",t(key));option.value=value;select.append(option);}select.value="72";body.append(label(doc,t("hours"),select));
   body.append(button(doc,t("invite"),()=>run(async()=>{clear();const response=await api.createTripInvitation(tripId,{expectedAccessVersion:current.access.version,expiresInHours:Number(select.value)});await refresh();if(closed)return;output.textContent=response.invitation.token;secret.hidden=false;hide.focus();})));
   const response=await api.tripInvitations(tripId);if(closed||generation!==epoch)return;const codes=node(doc,"ul");
   for(const invitation of response.invitations){const item=node(doc,"li"),key=invitation.revokedAt?"revoked":invitation.usedAt?"used":Date.parse(invitation.expiresAt)<=Date.now()?"expired":"active";item.append(node(doc,"span",t(key)+" · "+new Date(invitation.expiresAt).toLocaleString(language)));if(key==="active")item.append(button(doc,t("revoke"),()=>run(async()=>{clear();await api.revokeTripInvitation(tripId,invitation.id,{expectedAccessVersion:current.access.version});await refresh();})));codes.append(item);}body.append(node(doc,"h3",t("codes")),codes);
  }
 }
 function load(){return run(refresh);}
 dialog.addEventListener("close",()=>{closed=true;epoch++;clear();dialog.remove();});
 return {dialog,load};
}

export function createJoinTripControl({document:doc,language="en",api=hostedApi,onJoined=()=>{},onAccessLost=()=>{}}){
 const t=key=>membershipText(language,key),section=node(doc,"details"),form=node(doc,"form"),input=node(doc,"input"),status=node(doc,"p"),submit=node(doc,"button",t("submit"));
 section.className="trip-join";input.name="tripCode";input.type="text";input.minLength=43;input.maxLength=43;input.required=true;input.autocomplete="off";input.spellcheck=false;input.setAttribute("autocapitalize","none");status.setAttribute("role","status");
 let pending=null,busy=false,epoch=0;
 function clear(){epoch++;pending=null;input.value="";input.required=true;submit.textContent=t("submit");status.textContent="";}
 const cancel=button(doc,t("cancel"),()=>{clear();section.open=false;});form.append(label(doc,t("code"),input),submit,cancel,status);section.append(node(doc,"summary",t("join")),form);
 section.addEventListener("toggle",()=>{if(!section.open)clear();});
 input.addEventListener("input",()=>{pending=null;input.required=true;submit.textContent=t("submit");});
 form.addEventListener("submit",async e=>{e.preventDefault();if(busy)return;
  if(!pending){const code=input.value.trim();if(!/^[A-Za-z0-9_-]{43}$/.test(code)){status.textContent=t("invalid");return;}pending={code,requestId:newRequestId("join")};}
  input.value="";input.required=false;const generation=epoch;busy=true;submit.disabled=true;input.disabled=true;
  try{await api.joinTrip(pending);if(generation!==epoch)return;clear();status.textContent=t("joined");await onJoined();}
  catch(error){if(generation!==epoch)return;if(error.status===401){clear();onAccessLost(error);}else if(error.status===0){status.textContent=t("uncertain");submit.textContent=t("retry");}else{clear();status.textContent=t("joinFailed");}}
  finally{busy=false;submit.disabled=false;input.disabled=false;}
 });
 return {element:section,clear};
}
