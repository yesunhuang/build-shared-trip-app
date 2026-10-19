// Authenticated management UI for one trip's revocable, anonymous, read-only share link.
//
// Contract (see references/trip-sharing.md):
//   GET  /api/trips/<id>/sharing          -> {sharing:{enabled,version,expiresAt,createdAt}}
//   GET  /api/trips/<id>/sharing/preview  -> {trip:{...guest projection with media descriptors}}
//   POST /api/trips/<id>/sharing          {expectedShareVersion, expiresAt:null|ISO} -> {sharing, token}
//   POST /api/trips/<id>/sharing/revoke   {expectedShareVersion} -> {sharing}
//
// Rules this module keeps:
// - Requests use the existing same-origin session cookie only; no share header, no other credential.
// - The raw token exists only in memory while the dialog is open. It is placed in a readonly input
//   through the `value` property (never an attribute), never in storage, history, URLs of this page,
//   titles, console output or analytics. Closing the dialog drops it.
// - Dangerous writes (generate/rotate/revoke) run only after an explicit click; replacing or revoking
//   needs a second explicit confirmation. A write is never retried automatically. After an
//   uncertain outcome the metadata is re-read and shown, and a 409 refreshes the status.
// - Late responses after close, or after authority loss, are ignored.
// - All trip text is rendered with textContent; no images are loaded by the preview.

const LANGUAGES = ["en", "zh-Hans", "zh-Hant", "ja"];

const WORDS = {
  en: {
    archived: 'Sharing is paused while this trip is archived. Restore it before creating or replacing a link.',
    open: "Share read-only link", title: "Read-only share link", close: "Close", before: "Before you share",
    anyone: "Anyone who has this link, including anyone it is forwarded to, can read the shared itinerary without signing in.",
    review: "The text below and the listed images will be shared. Notes, descriptions and photos may contain private details. Review the text here and the actual photos in the itinerary first.",
    excluded: "Never included: structured bookings and confirmations, participant groups, resources, account, member and access details, audit, settings, payment and identity data.",
    once: "The full link is shown only once, right after you generate or replace it. Only a fingerprint is stored, so it cannot be shown again later; replace it to get a new link.",
    messaging: "The messaging app or email service you send it through can also see the link.",
    recall: "Turning sharing off or replacing the link stops future viewing immediately, but cannot recall anything already viewed, copied or saved.",
    stateTitle: "Current status", statusLabel: "Status", enabled: "On: the link works", disabled: "Off: no link works",
    expired: "Expired: the link no longer works", expires: "Expires", noExpiry: "No expiry", created: "Link created",
    previewTitle: "What recipients will see",
    previewHint: "This is the actual text and the list of images the link shares, including every language that has a translation.",
    noContent: "This trip has no shareable content yet.", timezone: "Time zone", undated: "Undated", area: "Area",
    summary: "Summary", notes: "Notes", address: "Address", description: "Details", coordinates: "Coordinates",
    photo: "Photo shared", cover: "Cover image shared", logo: "Logo shared", credit: "Credit", license: "License",
    source: "Source", mapLink: "Map link shared", reminders: "Reminders", due: "Due", translations: "Translations",
    manageTitle: "Create or change the link", setExpiry: "Stop the link at a set time (optional)",
    expiryField: "Link stops working at (your local time)",
    expiryInvalid: "Choose a future date and time for the expiry, or turn the expiry off.",
    reviewed: "I reviewed the text below and the photos in the itinerary and want to share them",
    reviewFirst: "Confirm that you reviewed the shared text and photos first.",
    generate: "Generate link", rotate: "Replace with new link", revoke: "Turn off sharing", refresh: "Refresh",
    confirmRotate: "Replace the current link? The old link stops working immediately; people who have it will need the new one.",
    confirmRevoke: "Turn off sharing? The link stops working immediately for everyone.",
    confirmRotateYes: "Yes, replace link", confirmRevokeYes: "Yes, turn off", cancel: "Cancel",
    linkTitle: "Your new link", linkLabel: "Share link",
    linkOnce: "Copy or share it now. It disappears when you close this window and cannot be shown again.",
    copy: "Copy link", share: "Share…", hide: "Hide link", copied: "Link copied.",
    copyManual: "Automatic copying is not available here. The link is selected; copy it manually.",
    shareUnavailable: "Sharing is not available here. Copy the link instead.", shareTitle: "Trip itinerary",
    loading: "Loading…", createdOk: "New link ready. Copy or share it now.",
    rotatedOk: "Link replaced. The previous link no longer works.", revokedOk: "Sharing is off. The link no longer works.",
    conflict: "Sharing was changed elsewhere. The latest status is shown; review it before trying again.",
    uncertain: "The change could not be confirmed and was not retried. The latest status is shown.",
    uncertainChanged: "The link was changed, but the new link could not be delivered. Replace it again if you need a link to send.",
    uncertainUnknown: "The change could not be confirmed and the status could not be checked. Refresh before trying again.",
    failed: "Sharing details could not be loaded. Check your connection and refresh.",
    lost: "You can no longer manage sharing for this trip."
  },
  "zh-Hans": {
    archived: '此行程已归档，分享暂时关闭。恢复行程后才能生成或更换链接。',
    open: "分享只读链接", title: "只读分享链接", close: "关闭", before: "分享前请了解",
    anyone: "任何拿到此链接的人（包括被转发的人）无需登录即可查看分享的行程。",
    review: "下方文字及清单中的图片会被分享。备注、说明和照片可能含有私人信息，请先检查这里的文字及行程中的实际照片。",
    excluded: "始终不包含：结构化预订和确认信息、参与者分组、资料、账户、成员与权限信息、审计、设置、付款和身份数据。",
    once: "完整链接只在生成或更换后显示一次。系统只保存其指纹，之后无法再次显示；如需新链接请更换。",
    messaging: "你用来发送链接的聊天应用或邮件服务也能看到此链接。",
    recall: "关闭分享或更换链接会立即阻止之后的查看，但无法收回已被查看、复制或保存的内容。",
    stateTitle: "当前状态", statusLabel: "状态", enabled: "已开启：链接可用", disabled: "已关闭：没有可用链接",
    expired: "已过期：链接不再可用", expires: "到期时间", noExpiry: "不过期", created: "链接创建于",
    previewTitle: "收件人会看到的内容", previewHint: "以下是此链接实际分享的文字和图片清单，包括所有已有翻译的语言。",
    noContent: "此行程还没有可分享的内容。", timezone: "时区", undated: "未定日期", area: "区域", summary: "概要",
    notes: "备注", address: "地址", description: "详情", coordinates: "坐标", photo: "会分享照片", cover: "会分享封面图片",
    logo: "会分享标志", credit: "署名", license: "许可", source: "来源", mapLink: "会分享地图链接", reminders: "提醒事项",
    due: "截止", translations: "翻译", manageTitle: "创建或更改链接", setExpiry: "在指定时间停用链接（可选）",
    expiryField: "链接停用时间（你的本地时间）", expiryInvalid: "请选择将来的到期日期和时间，或关闭到期设置。",
    reviewed: "我已检查下方文字及行程中的照片，并同意分享", reviewFirst: "请先确认你已检查要分享的文字和照片。",
    generate: "生成链接", rotate: "更换为新链接", revoke: "关闭分享", refresh: "刷新",
    confirmRotate: "要更换当前链接吗？旧链接会立即失效，持有旧链接的人需要新链接。",
    confirmRevoke: "要关闭分享吗？链接会立即对所有人失效。", confirmRotateYes: "确定更换", confirmRevokeYes: "确定关闭",
    cancel: "取消", linkTitle: "你的新链接", linkLabel: "分享链接",
    linkOnce: "请现在复制或分享。关闭此窗口后链接会消失，无法再次显示。", copy: "复制链接", share: "分享…",
    hide: "隐藏链接", copied: "链接已复制。", copyManual: "此处无法自动复制。链接已选中，请手动复制。",
    shareUnavailable: "此处无法使用分享功能。请改为复制链接。", shareTitle: "旅行行程", loading: "正在加载…",
    createdOk: "新链接已就绪。请现在复制或分享。", rotatedOk: "链接已更换。旧链接已失效。", revokedOk: "分享已关闭。链接已失效。",
    conflict: "分享设置已在别处更改。已显示最新状态，请检查后再试。", uncertain: "无法确认更改，且未自动重试。已显示最新状态。",
    uncertainChanged: "链接已更改，但新链接未能送达。如需发送链接，请再次更换。",
    uncertainUnknown: "无法确认更改，也无法检查状态。请先刷新再重试。", failed: "无法加载分享信息。请检查网络后刷新。",
    lost: "你已无法管理此旅行的分享。"
  },
  "zh-Hant": {
    archived: '此行程已封存，分享暫時關閉。還原行程後才能產生或更換連結。',
    open: "分享唯讀連結", title: "唯讀分享連結", close: "關閉", before: "分享前請了解",
    anyone: "任何取得此連結的人（包括被轉傳的人）無需登入即可檢視分享的行程。",
    review: "下方文字及清單中的圖片會被分享。備註、說明和相片可能含有私人資訊，請先檢查這裡的文字及行程中的實際相片。",
    excluded: "一律不包含：結構化預訂和確認資訊、參與者分組、資料、帳戶、成員與權限資訊、稽核、設定、付款和身分資料。",
    once: "完整連結只在產生或更換後顯示一次。系統只儲存其指紋，之後無法再次顯示；如需新連結請更換。",
    messaging: "你用來傳送連結的通訊應用程式或電子郵件服務也能看到此連結。",
    recall: "關閉分享或更換連結會立即阻止之後的檢視，但無法收回已被檢視、複製或儲存的內容。",
    stateTitle: "目前狀態", statusLabel: "狀態", enabled: "已開啟：連結可用", disabled: "已關閉：沒有可用連結",
    expired: "已過期：連結不再可用", expires: "到期時間", noExpiry: "不會到期", created: "連結建立於",
    previewTitle: "收件人會看到的內容", previewHint: "以下是此連結實際分享的文字和圖片清單，包括所有已有翻譯的語言。",
    noContent: "此行程尚無可分享的內容。", timezone: "時區", undated: "未定日期", area: "區域", summary: "概要",
    notes: "備註", address: "地址", description: "詳情", coordinates: "座標", photo: "會分享相片", cover: "會分享封面圖片",
    logo: "會分享標誌", credit: "署名", license: "授權", source: "來源", mapLink: "會分享地圖連結", reminders: "提醒事項",
    due: "截止", translations: "翻譯", manageTitle: "建立或變更連結", setExpiry: "在指定時間停用連結（選填）",
    expiryField: "連結停用時間（你的當地時間）", expiryInvalid: "請選擇未來的到期日期和時間，或關閉到期設定。",
    reviewed: "我已檢查下方文字及行程中的相片，並同意分享", reviewFirst: "請先確認你已檢查要分享的文字和相片。",
    generate: "產生連結", rotate: "更換為新連結", revoke: "關閉分享", refresh: "重新整理",
    confirmRotate: "要更換目前的連結嗎？舊連結會立即失效，持有舊連結的人需要新連結。",
    confirmRevoke: "要關閉分享嗎？連結會立即對所有人失效。", confirmRotateYes: "確定更換", confirmRevokeYes: "確定關閉",
    cancel: "取消", linkTitle: "你的新連結", linkLabel: "分享連結",
    linkOnce: "請現在複製或分享。關閉此視窗後連結會消失，無法再次顯示。", copy: "複製連結", share: "分享…",
    hide: "隱藏連結", copied: "連結已複製。", copyManual: "此處無法自動複製。連結已選取，請手動複製。",
    shareUnavailable: "此處無法使用分享功能。請改為複製連結。", shareTitle: "旅行行程", loading: "載入中…",
    createdOk: "新連結已就緒。請現在複製或分享。", rotatedOk: "連結已更換。舊連結已失效。", revokedOk: "分享已關閉。連結已失效。",
    conflict: "分享設定已在別處變更。已顯示最新狀態，請檢查後再試。", uncertain: "無法確認變更，且未自動重試。已顯示最新狀態。",
    uncertainChanged: "連結已變更，但新連結未能送達。如需傳送連結，請再次更換。",
    uncertainUnknown: "無法確認變更，也無法檢查狀態。請先重新整理再重試。", failed: "無法載入分享資訊。請檢查網路後重新整理。",
    lost: "你已無法管理此旅行的分享。"
  },
  ja: {
    archived: 'この旅行はアーカイブ中のため共有を一時停止しています。リンクの作成・変更前に旅行を復元してください。',
    open: "閲覧専用リンクを共有", title: "閲覧専用の共有リンク", close: "閉じる", before: "共有する前に",
    anyone: "このリンクを持っている人（転送された人を含む）は、サインインせずに共有された旅程を閲覧できます。",
    review: "下の文章と一覧にある画像が共有されます。メモ・説明・写真には個人情報が含まれることがあります。ここの文章と旅程の実際の写真を先に確認してください。",
    excluded: "含まれないもの：構造化された予約・確認情報、参加者グループ、資料、アカウント・メンバー・アクセス情報、監査、設定、支払い、本人確認のデータ。",
    once: "完全なリンクは、作成または差し替えの直後に一度だけ表示されます。保存されるのは指紋だけなので後から再表示できません。新しいリンクが必要な場合は差し替えてください。",
    messaging: "リンクを送るメッセージアプリやメールサービスにも、リンクは見えます。",
    recall: "共有をオフにしたりリンクを差し替えたりすると今後の閲覧はすぐに止まりますが、すでに閲覧・コピー・保存された内容は取り消せません。",
    stateTitle: "現在の状態", statusLabel: "状態", enabled: "オン：リンクは有効です", disabled: "オフ：有効なリンクはありません",
    expired: "期限切れ：リンクは無効です", expires: "有効期限", noExpiry: "期限なし", created: "リンク作成日時",
    previewTitle: "受け取った人に表示される内容",
    previewHint: "このリンクで実際に共有される文章と画像の一覧です。翻訳があるすべての言語を含みます。",
    noContent: "この旅行には共有できる内容がまだありません。", timezone: "タイムゾーン", undated: "日付未定", area: "エリア",
    summary: "概要", notes: "メモ", address: "住所", description: "詳細", coordinates: "座標", photo: "写真を共有",
    cover: "カバー画像を共有", logo: "ロゴを共有", credit: "クレジット", license: "ライセンス", source: "出典",
    mapLink: "地図リンクを共有", reminders: "リマインダー", due: "期限", translations: "翻訳",
    manageTitle: "リンクの作成・変更", setExpiry: "指定した日時にリンクを停止する（任意）",
    expiryField: "リンクの停止日時（あなたの現地時刻）", expiryInvalid: "未来の日時を選ぶか、有効期限をオフにしてください。",
    reviewed: "下の文章と旅程の写真を確認し、共有に同意します", reviewFirst: "共有する文章と写真を確認したことを先にチェックしてください。",
    generate: "リンクを作成", rotate: "新しいリンクに差し替え", revoke: "共有をオフにする", refresh: "更新",
    confirmRotate: "現在のリンクを差し替えますか？古いリンクはすぐに無効になり、持っている人には新しいリンクが必要です。",
    confirmRevoke: "共有をオフにしますか？リンクはすぐに全員に対して無効になります。",
    confirmRotateYes: "差し替える", confirmRevokeYes: "オフにする", cancel: "キャンセル",
    linkTitle: "新しいリンク", linkLabel: "共有リンク",
    linkOnce: "今すぐコピーまたは共有してください。この画面を閉じると消え、再表示できません。",
    copy: "リンクをコピー", share: "共有…", hide: "リンクを隠す", copied: "リンクをコピーしました。",
    copyManual: "ここでは自動コピーできません。リンクを選択したので、手動でコピーしてください。",
    shareUnavailable: "ここでは共有機能を使えません。リンクをコピーしてください。", shareTitle: "旅行の旅程",
    loading: "読み込み中…", createdOk: "新しいリンクができました。今すぐコピーまたは共有してください。",
    rotatedOk: "リンクを差し替えました。以前のリンクは無効です。", revokedOk: "共有をオフにしました。リンクは無効です。",
    conflict: "共有設定が別の場所で変更されました。最新の状態を表示しています。確認してから再試行してください。",
    uncertain: "変更を確認できず、自動再試行もしていません。最新の状態を表示しています。",
    uncertainChanged: "リンクは変更されましたが、新しいリンクを受け取れませんでした。送るリンクが必要なら、もう一度差し替えてください。",
    uncertainUnknown: "変更を確認できず、状態も確認できません。更新してから再試行してください。",
    failed: "共有情報を読み込めません。接続を確認して更新してください。",
    lost: "この旅行の共有を管理する権限がなくなりました。"
  }
};

export const SHARE_MANAGEMENT_LANGUAGES = Object.freeze([...LANGUAGES]);

export function normalizeShareLanguage(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (LANGUAGES.includes(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.startsWith("zh")) return /hant|-tw|-hk|-mo/.test(lower) ? "zh-Hant" : "zh-Hans";
  if (lower.startsWith("ja")) return "ja";
  return "en";
}

export function shareManagementText(language, key) {
  const lang = normalizeShareLanguage(language);
  return WORDS[lang][key] ?? WORDS.en[key] ?? "";
}

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Translation fields shown in the preview: the same allowlist the guest projection may carry.
const I18N_FIELDS = Object.freeze({
  trip: ["title"],
  day: ["label", "theme", "area", "summary", "notes"],
  slot: ["name", "time", "address", "description", "notes"],
  reminder: ["item", "notes"]
});
const READ_TIMEOUT_MS = 15000;
const WRITE_TIMEOUT_MS = 20000;
const MIN_EXPIRY_LEAD_MS = 60000;
const STYLE_ID = "share-management-styles";

const CSS = `
.stm-launcher,.stm-dialog button{box-sizing:border-box;min-height:44px;min-width:44px;padding:.5rem 1rem;font:inherit;font-size:1rem;line-height:1.3;border-radius:.5rem;border:1px solid #243b53;background:#fff;color:#102a43;cursor:pointer;touch-action:manipulation}
.stm-dialog{box-sizing:border-box;width:min(42rem,calc(100vw - 1rem));max-width:calc(100vw - 1rem);max-height:calc(100vh - 1rem);max-height:calc(100dvh - 1rem);overflow:auto;padding:1rem;border:1px solid #334e68;border-radius:.75rem;background:#fff;color:#102a43;font-size:1rem;line-height:1.5;overflow-wrap:anywhere;word-break:normal}
.stm-dialog [hidden]{display:none!important}
.stm-dialog::backdrop{background:rgba(16,42,67,.6)}
.stm-dialog h2{font-size:1.35rem;margin:0;line-height:1.3}
.stm-dialog h3{font-size:1.1rem;margin:1rem 0 .5rem}
.stm-dialog h4{font-size:1.05rem;margin:.5rem 0}
.stm-dialog h5{font-size:1rem;margin:.25rem 0}
.stm-dialog ul{padding-inline-start:1.25rem;margin:.25rem 0}
.stm-dialog li{margin:.25rem 0}
.stm-dialog button.stm-primary{background:#0b4f8a;border-color:#0b4f8a;color:#fff}
.stm-dialog button.stm-danger{background:#9b1c1c;border-color:#9b1c1c;color:#fff}
.stm-dialog button:disabled{opacity:.6;cursor:not-allowed}
.stm-launcher:focus-visible,.stm-dialog :focus-visible{outline:3px solid #f0b429;outline-offset:2px}
.stm-head{display:flex;flex-wrap:wrap;gap:.5rem;justify-content:space-between;align-items:flex-start}
.stm-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center;margin:.5rem 0}
.stm-check{display:flex;gap:.6rem;align-items:flex-start;min-height:44px;padding:.35rem 0;cursor:pointer}
.stm-check input{flex:none;width:1.5rem;height:1.5rem;margin:.1rem 0 0}
.stm-field{display:grid;grid-template-columns:minmax(0,1fr);min-width:0;gap:.25rem;margin:.25rem 0}
.stm-field input{box-sizing:border-box;width:100%;max-width:100%;min-width:0;min-height:44px;padding:.4rem .6rem;font:inherit;font-size:1rem;border:1px solid #486581;border-radius:.4rem;color:#102a43;background:#fff}
.stm-status{min-height:1.5em;margin:.5rem 0;font-weight:600}
.stm-state dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem .75rem;margin:0}
.stm-state dt{font-weight:600}.stm-state dd{margin:0}
.stm-preview{border:1px solid #bcccdc;border-radius:.5rem;padding:.75rem;background:#f8fafc}
.stm-preview article{border-top:1px solid #d9e2ec;margin-top:.5rem;padding-top:.5rem}
.stm-preview section{margin:.4rem 0 .4rem .5rem;padding-inline-start:.6rem;border-inline-start:3px solid #d9e2ec}
.stm-preview p{margin:.2rem 0;white-space:pre-wrap}
.stm-preview .stm-media{font-style:italic}
.stm-confirm{border:2px solid #9b1c1c;border-radius:.5rem;padding:.75rem;margin:.75rem 0;background:#fff5f5}
.stm-link{border:2px solid #0b4f8a;border-radius:.5rem;padding:.75rem;margin:.75rem 0;background:#f0f7ff}
@media (max-width:380px){.stm-dialog{padding:.75rem}.stm-row button{flex:1 1 100%}.stm-state dl{grid-template-columns:1fr}}
@media (forced-colors:active){.stm-dialog button{border:1px solid ButtonText}}
`;

class ShareRequestError extends Error {
  constructor(status, code) {
    super(code || `status_${status}`);
    this.name = "ShareRequestError";
    this.status = status;
    this.code = code || "";
  }
}

const isText = (value) => typeof value === "string" && value.trim() !== "";

function installStyles(doc) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).append(style);
}

function el(doc, tag, { text, className } = {}) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function line(doc, label, value) {
  if (!isText(value)) return null;
  const p = el(doc, "p");
  if (label) p.append(el(doc, "strong", { text: `${label}: ` }));
  p.append(doc.createTextNode(value));
  return p;
}

function appendAll(parent, nodes) {
  for (const node of nodes) if (node) parent.append(node);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Formats a Date as the value of an <input type="datetime-local"> in the browser's local time. */
export function toLocalDateTimeInput(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Converts a datetime-local value (local wall time) to an ISO instant, or undefined when invalid/past. */
export function localDateTimeToIso(value, now = Date.now()) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) return undefined;
  const date = new Date(value); // ECMAScript parses an offset-less date-time as local time.
  if (Number.isNaN(date.getTime()) || date.getTime() < now + MIN_EXPIRY_LEAD_MS) return undefined;
  return date.toISOString();
}

function formatInstant(iso, lang) {
  const date = new Date(iso);
  if (!isText(iso) || Number.isNaN(date.getTime())) return "";
  try { return date.toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" }); } catch { return date.toISOString(); }
}

function formatDay(value, lang) {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return "";
  const stamp = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  try {
    return new Intl.DateTimeFormat(lang, { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(stamp);
  } catch { return value; }
}

function normalizeSharing(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.enabled !== "boolean" || !Number.isInteger(raw.version) || raw.version < 0) {
    throw new ShareRequestError(0, "malformed");
  }
  return {
    enabled: raw.enabled,
    version: raw.version,
    expiresAt: isText(raw.expiresAt) ? raw.expiresAt : null,
    createdAt: isText(raw.createdAt) ? raw.createdAt : null
  };
}

const inert = () => ({ button: null, open: async () => {}, close() {}, destroy() {}, setCanManage() {}, relabel() {} });

/**
 * Installs the share-management launcher into `container`. Returns a handle.
 * Nothing is appended (and nothing is fetched) when `canManage` is false.
 */
export function installShareManagement(options = {}) {
  const { tripId, container, onUnauthorized = () => {}, language = "en" } = options;
  const doc = options.document || container?.ownerDocument || globalThis.document;
  if (!container || !doc || typeof tripId !== "string" || !tripId.trim()) return inert();
  const win = doc.defaultView || globalThis;
  const fetchImpl = options.fetch || (typeof win.fetch === "function" ? win.fetch.bind(win) : globalThis.fetch?.bind(globalThis));
  const nav = options.navigator || win.navigator;
  const origin = options.origin || win.location?.origin || "";
  const lang = () => normalizeShareLanguage(typeof language === "function" ? language() : language);
  const t = (key) => shareManagementText(lang(), key);
  const base = `/api/trips/${encodeURIComponent(tripId)}/sharing`;

  let destroyed = false;
  let allowed = Boolean(options.canManage);
  let session = null;
  let unauthorizedReported = false;

  installStyles(doc);
  const launcher = el(doc, "button", { className: "stm-launcher", text: t("open") });
  launcher.type = "button";
  launcher.setAttribute("aria-haspopup", "dialog");
  launcher.addEventListener("click", () => { open(); });
  if (allowed) container.append(launcher);

  function relabel() { launcher.textContent = t("open"); }

  function reportUnauthorized(error) {
    if (unauthorizedReported) return;
    unauthorizedReported = true;
    try { onUnauthorized(error); } catch { /* caller errors must not break cleanup */ }
  }

  function revokeLauncher() {
    allowed = false;
    launcher.remove();
  }

  function open() {
    if (destroyed || !allowed) return Promise.resolve();
    relabel();
    if (session) { session.focus(); return session.ready; }
    session = createSession();
    return session.ready;
  }

  function close() { session?.close(); }

  function createSession() {
    const current = lang();
    const tt = (key) => shareManagementText(current, key);
    let closed = false;
    let busy = false;
    let authorityLost = false;
    let archived = false;
    let generation = 0;
    let sharing = null;
    let pendingConfirm = null;
    let linkVersion = null;
    let expiryTouched = false;
    const controllers = new Set();

    const dialog = el(doc, "dialog", { className: "stm-dialog trip-access-dialog" });
    dialog.lang = current;
    const headingId = `stm-title-${Math.random().toString(36).slice(2, 10)}`;
    const head = el(doc, "div", { className: "stm-head" });
    const heading = el(doc, "h2", { text: tt("title") });
    heading.id = headingId;
    heading.tabIndex = -1;
    dialog.setAttribute("aria-labelledby", headingId);
    const closeButton = el(doc, "button", { text: tt("close") });
    closeButton.type = "button";
    closeButton.dataset.shareClose = "true";
    closeButton.addEventListener("click", () => finish());
    head.append(heading, closeButton);

    const status = el(doc, "p", { className: "stm-status" });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    const explain = el(doc, "section", { className: "stm-explain" });
    const explainList = el(doc, "ul");
    for (const key of ["anyone", "review", "excluded", "once", "messaging", "recall"]) {
      const item = el(doc, "li", { text: tt(key) });
      item.dataset.shareExplain = key;
      explainList.append(item);
    }
    explain.append(el(doc, "h3", { text: tt("before") }), explainList);

    const stateSection = el(doc, "section", { className: "stm-state" });
    const stateList = el(doc, "dl");
    stateSection.append(el(doc, "h3", { text: tt("stateTitle") }), stateList);

    const previewSection = el(doc, "section");
    const previewBody = el(doc, "div", { className: "stm-preview" });
    previewBody.dataset.sharePreview = "true";
    previewSection.append(el(doc, "h3", { text: tt("previewTitle") }), el(doc, "p", { text: tt("previewHint") }), previewBody);

    // Management controls.
    const manage = el(doc, "section");
    const expiryToggle = el(doc, "input");
    expiryToggle.type = "checkbox";
    expiryToggle.name = "shareExpiryEnabled";
    const expiryToggleLabel = el(doc, "label", { className: "stm-check" });
    expiryToggleLabel.append(expiryToggle, el(doc, "span", { text: tt("setExpiry") }));
    const expiryInput = el(doc, "input");
    expiryInput.type = "datetime-local";
    expiryInput.name = "shareExpiresAt";
    expiryInput.step = "60";
    const expiryLabel = el(doc, "label", { className: "stm-field" });
    expiryLabel.append(el(doc, "span", { text: tt("expiryField") }), expiryInput);
    expiryLabel.hidden = true;
    expiryToggle.addEventListener("change", () => {
      expiryTouched = true;
      expiryLabel.hidden = !expiryToggle.checked;
      if (expiryToggle.checked && !expiryInput.value) expiryInput.value = toLocalDateTimeInput(new Date(Date.now() + 7 * 864e5));
      expiryInput.min = toLocalDateTimeInput(new Date(Date.now() + MIN_EXPIRY_LEAD_MS));
      updateControls();
    });
    expiryInput.addEventListener("input", () => { expiryTouched = true; });
    const review = el(doc, "input");
    review.type = "checkbox";
    review.name = "shareReviewed";
    const reviewLabel = el(doc, "label", { className: "stm-check" });
    reviewLabel.append(review, el(doc, "span", { text: tt("reviewed") }));

    const actions = el(doc, "div", { className: "stm-row" });
    const primary = el(doc, "button", { className: "stm-primary", text: tt("generate") });
    primary.type = "button";
    primary.dataset.shareAction = "create";
    primary.addEventListener("click", () => requestCreate(false));
    const revokeButton = el(doc, "button", { className: "stm-danger", text: tt("revoke") });
    revokeButton.type = "button";
    revokeButton.dataset.shareAction = "revoke";
    revokeButton.addEventListener("click", () => requestRevoke(false));
    const refreshButton = el(doc, "button", { text: tt("refresh") });
    refreshButton.type = "button";
    refreshButton.dataset.shareAction = "refresh";
    refreshButton.addEventListener("click", () => run(() => readAll({ announce: true })));
    actions.append(primary, revokeButton, refreshButton);
    manage.append(el(doc, "h3", { text: tt("manageTitle") }), expiryToggleLabel, expiryLabel, reviewLabel, actions);

    const confirmBox = el(doc, "div", { className: "stm-confirm" });
    confirmBox.setAttribute("role", "group");
    confirmBox.hidden = true;
    const confirmText = el(doc, "p");
    confirmText.id = `${headingId}-confirm`;
    confirmBox.setAttribute("aria-labelledby", confirmText.id);
    const confirmYes = el(doc, "button", { className: "stm-danger" });
    confirmYes.type = "button";
    confirmYes.dataset.shareAction = "confirm";
    const confirmNo = el(doc, "button", { text: tt("cancel") });
    confirmNo.type = "button";
    confirmNo.dataset.shareAction = "cancel";
    const confirmRow = el(doc, "div", { className: "stm-row" });
    confirmRow.append(confirmYes, confirmNo);
    confirmBox.append(confirmText, confirmRow);
    confirmYes.addEventListener("click", () => {
      const kind = pendingConfirm;
      if (kind === "rotate") requestCreate(true);
      else if (kind === "revoke") requestRevoke(true);
    });
    confirmNo.addEventListener("click", () => { hideConfirm(); primary.focus(); });

    const linkBox = el(doc, "section", { className: "stm-link" });
    linkBox.hidden = true;
    const linkInput = el(doc, "input");
    linkInput.type = "text";
    linkInput.readOnly = true;
    linkInput.name = "shareLink";
    linkInput.autocomplete = "off";
    linkInput.spellcheck = false;
    linkInput.setAttribute("autocapitalize", "none");
    linkInput.setAttribute("inputmode", "url");
    linkInput.addEventListener("focus", () => { try { linkInput.select(); } catch { /* selection unsupported */ } });
    const linkLabel = el(doc, "label", { className: "stm-field" });
    linkLabel.append(el(doc, "span", { text: tt("linkLabel") }), linkInput);
    const copyButton = el(doc, "button", { className: "stm-primary", text: tt("copy") });
    copyButton.type = "button";
    copyButton.dataset.shareAction = "copy";
    copyButton.addEventListener("click", () => copyLink());
    const shareButton = el(doc, "button", { text: tt("share") });
    shareButton.type = "button";
    shareButton.dataset.shareAction = "share";
    shareButton.hidden = typeof nav?.share !== "function";
    shareButton.addEventListener("click", () => shareLink());
    const hideButton = el(doc, "button", { text: tt("hide") });
    hideButton.type = "button";
    hideButton.dataset.shareAction = "hide";
    hideButton.addEventListener("click", () => { clearLink(); primary.focus(); });
    const linkRow = el(doc, "div", { className: "stm-row" });
    linkRow.append(copyButton, shareButton, hideButton);
    linkBox.append(el(doc, "h3", { text: tt("linkTitle") }), el(doc, "p", { text: tt("linkOnce") }), linkLabel, linkRow);

    dialog.append(head, status, explain, stateSection, previewSection, manage, confirmBox, linkBox);
    dialog.addEventListener("close", () => finish());
    // Native modal dialogs close on Escape (firing "close"); the non-modal fallback needs this handler.
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && typeof dialog.showModal !== "function") { event.preventDefault(); finish(); }
    });

    doc.body.append(dialog);
    try {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } catch { dialog.setAttribute("open", ""); }
    try { heading.focus(); } catch { /* focus unsupported */ }

    function say(key) { if (!closed) status.textContent = key ? tt(key) : ""; }

    function stale(gen) { return closed || authorityLost || gen !== generation; }

    function updateControls() {
      if (closed) return;
      const ready = !busy && !authorityLost && sharing !== null;
      primary.textContent = sharing?.enabled ? tt("rotate") : tt("generate");
      primary.disabled = !ready || archived;
      revokeButton.hidden = !sharing?.enabled;
      revokeButton.disabled = !ready;
      refreshButton.disabled = busy || authorityLost;
      expiryToggle.disabled = !ready;
      expiryInput.disabled = !ready || !expiryToggle.checked;
      review.disabled = !ready;
      confirmYes.disabled = !ready;
      confirmNo.disabled = busy;
      manage.hidden = authorityLost;
    }

    function clearLink() {
      linkInput.value = "";
      linkBox.hidden = true;
      linkVersion = null;
    }

    function showLink(token, version) {
      linkInput.value = `${origin}/s/${encodeURIComponent(tripId)}#${token}`;
      linkVersion = version;
      linkBox.hidden = false;
      try { linkInput.focus(); } catch { /* focus unsupported */ }
    }

    function hideConfirm() {
      pendingConfirm = null;
      confirmBox.hidden = true;
      confirmText.textContent = "";
    }

    function showConfirm(kind) {
      pendingConfirm = kind;
      confirmText.textContent = tt(kind === "rotate" ? "confirmRotate" : "confirmRevoke");
      confirmYes.textContent = tt(kind === "rotate" ? "confirmRotateYes" : "confirmRevokeYes");
      confirmBox.hidden = false;
      updateControls();
      try { confirmNo.focus(); } catch { /* focus unsupported */ }
    }

    async function request(path, { method = "GET", body } = {}) {
      if (closed) throw new ShareRequestError(0, "closed");
      if (typeof fetchImpl !== "function") throw new ShareRequestError(0, "network");
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), method === "GET" ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS);
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      try {
        let response;
        try {
          response = await fetchImpl(path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "same-origin",
            signal: controller.signal
          });
        } catch {
          throw new ShareRequestError(0, controller.signal.aborted ? "timeout" : "network");
        }
        let text = "";
        try { text = await response.text(); } catch { throw new ShareRequestError(0, "network"); }
        let payload = null;
        if (text) { try { payload = JSON.parse(text); } catch { payload = null; } }
        if (!response.ok) {
          const info = payload?.error && typeof payload.error === "object" ? payload.error : payload;
          throw new ShareRequestError(response.status, String(info?.code || "").slice(0, 80));
        }
        return payload;
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
      }
    }

    function applySharing(raw) {
      sharing = normalizeSharing(raw);
      if (linkVersion !== null && linkVersion !== sharing.version) clearLink();
      if (!sharing.enabled) clearLink();
      renderState();
      if (!expiryTouched) {
        const future = sharing.enabled && sharing.expiresAt && Date.parse(sharing.expiresAt) > Date.now() + MIN_EXPIRY_LEAD_MS;
        expiryToggle.checked = Boolean(future);
        expiryLabel.hidden = !future;
        expiryInput.value = future ? toLocalDateTimeInput(new Date(sharing.expiresAt)) : "";
      }
      updateControls();
    }

    function renderState() {
      stateList.replaceChildren();
      const add = (label, value) => { stateList.append(el(doc, "dt", { text: label }), el(doc, "dd", { text: value })); };
      if (!sharing) return;
      const expired = sharing.expiresAt && Date.parse(sharing.expiresAt) <= Date.now();
      add(tt("statusLabel"), tt(expired ? "expired" : !sharing.enabled ? "disabled" : "enabled"));
      stateSection.dataset.shareEnabled = String(sharing.enabled && !expired);
      if (sharing.enabled) {
        add(tt("expires"), sharing.expiresAt ? formatInstant(sharing.expiresAt, current) : tt("noExpiry"));
        if (sharing.createdAt) add(tt("created"), formatInstant(sharing.createdAt, current));
      }
    }

    function translationsBlock(i18n, fields) {
      if (!i18n || typeof i18n !== "object" || Array.isArray(i18n)) return null;
      const lines = [];
      for (const locale of LANGUAGES) {
        const entry = i18n[locale];
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        for (const field of fields) {
          const value = Object.prototype.hasOwnProperty.call(entry, field) ? entry[field] : undefined;
          if (isText(value)) lines.push(line(doc, `${locale} · ${field}`, value));
        }
      }
      if (!lines.length) return null;
      const block = el(doc, "section");
      block.append(el(doc, "h5", { text: tt("translations") }));
      appendAll(block, lines);
      return block;
    }

    function mediaLine(key, media) {
      if (!media || typeof media !== "object" || !isText(media.url)) return null;
      const p = el(doc, "p", { className: "stm-media" });
      const parts = [tt(key)];
      if (isText(media.alt)) parts.push(media.alt);
      if (isText(media.credit)) parts.push(`${tt("credit")}: ${media.credit}`);
      if (isText(media.license)) parts.push(`${tt("license")}: ${media.license}`);
      if (isText(media.sourceUrl)) parts.push(`${tt("source")}: ${media.sourceUrl}`);
      p.textContent = parts.join(" · ");
      return p;
    }

    function renderPreview(payload) {
      archived = payload?.archived === true;
      previewBody.replaceChildren();
      if(archived)previewBody.append(el(doc,"p",{text:tt("archived")}));
      const trip = payload?.trip && typeof payload.trip === "object" ? payload.trip : null;
      if (!trip) { previewBody.append(el(doc, "p", { text: tt("noContent") })); return; }
      appendAll(previewBody, [
        isText(trip.title) ? el(doc, "h4", { text: trip.title }) : null,
        line(doc, tt("timezone"), trip.timezone),
        mediaLine("cover", trip.cover),
        mediaLine("logo", trip.branding?.logo),
        translationsBlock(trip.i18n, I18N_FIELDS.trip)
      ]);
      const days = Array.isArray(trip.days) ? trip.days : [];
      const reminders = Array.isArray(trip.reminders) ? trip.reminders : [];
      for (const day of days) {
        if (!day || typeof day !== "object") continue;
        const article = el(doc, "article");
        const when = formatDay(day.date, current) || tt("undated");
        article.append(el(doc, "h5", { text: isText(day.label) ? `${when} · ${day.label}` : when }));
        appendAll(article, [line(doc, tt("area"), day.area), line(doc, tt("summary"), day.summary), line(doc, tt("notes"), day.notes), translationsBlock(day.i18n, I18N_FIELDS.day)]);
        for (const slot of Array.isArray(day.slots) ? day.slots : []) {
          if (!slot || typeof slot !== "object") continue;
          const section = el(doc, "section");
          const when = isText(slot.time) ? slot.time : isText(slot.period) ? slot.period : "";
          const title = [when, isText(slot.name) ? slot.name : ""].filter(Boolean).join(" · ");
          if (title) section.append(el(doc, "h5", { text: title }));
          const coords = Number.isFinite(slot.lat) && Number.isFinite(slot.lng) ? `${slot.lat}, ${slot.lng}` : "";
          const map = isText(slot.googleMapsUrl) ? slot.googleMapsUrl : isText(slot.mapsUrl) ? slot.mapsUrl : "";
          appendAll(section, [
            line(doc, tt("address"), slot.address),
            line(doc, tt("coordinates"), coords),
            line(doc, tt("description"), slot.description),
            line(doc, tt("notes"), slot.notes),
            line(doc, tt("mapLink"), map),
            mediaLine("photo", slot.photo),
            translationsBlock(slot.i18n, I18N_FIELDS.slot)
          ]);
          if (section.childNodes.length) article.append(section);
        }
        previewBody.append(article);
      }
      if (reminders.length) {
        const article = el(doc, "article");
        article.append(el(doc, "h5", { text: tt("reminders") }));
        for (const reminder of reminders) {
          if (!reminder || typeof reminder !== "object") continue;
          const section = el(doc, "section");
          appendAll(section, [
            isText(reminder.item) ? el(doc, "p", { text: reminder.item }) : null,
            line(doc, tt("due"), formatDay(reminder.dueDate, current) || reminder.dueDate),
            line(doc, tt("notes"), reminder.notes),
            translationsBlock(reminder.i18n, I18N_FIELDS.reminder)
          ]);
          if (section.childNodes.length) article.append(section);
        }
        previewBody.append(article);
      }
      if (!isText(trip.title) && !days.length && !reminders.length) previewBody.append(el(doc, "p", { text: tt("noContent") }));
    }

    function loseAuthority() {
      authorityLost = true;
      generation++;
      for (const controller of controllers) controller.abort();
      sharing = null;
      hideConfirm();
      clearLink();
      stateList.replaceChildren();
      previewBody.replaceChildren();
      review.checked = false;
      say("lost");
      revokeLauncher();
      updateControls();
    }

    // Returns true when the error was an authority/session outcome that has been handled.
    function handleAuthority(error) {
      if (closed) return true;
      if (error?.status === 401) { reportUnauthorized(error); revokeLauncher(); finish(); return true; }
      if (error?.status === 403 || error?.status === 404) { loseAuthority(); return true; }
      return false;
    }

    async function readMetadata() {
      const payload = await request(base);
      return payload?.sharing;
    }

    async function readAll({ announce = false } = {}) {
      const gen = ++generation;
      if (announce) say("loading");
      const [meta, preview] = await Promise.all([readMetadata(), request(`${base}/preview`)]);
      if (stale(gen)) return;
      applySharing(meta);
      renderPreview(preview);
      if (announce) say("");
    }

    async function run(task, fallbackKey = "failed") {
      if (busy || closed || authorityLost) return;
      busy = true;
      updateControls();
      try {
        await task();
      } catch (error) {
        if (!handleAuthority(error)) {
          if (error?.code === "malformed") sharing = null;
          say(fallbackKey);
        }
      } finally {
        busy = false;
        updateControls();
      }
    }

    async function rereadAfterUncertain(expected, kind) {
      try {
        const meta = normalizeSharing(await readMetadata());
        if (closed || authorityLost) return;
        applySharing(meta);
        if (kind === "revoke" && !meta.enabled) say("revokedOk");
        else if (kind === "create" && meta.version !== expected) say("uncertainChanged");
        else say("uncertain");
      } catch (error) {
        if (handleAuthority(error)) return;
        sharing = null;
        renderState();
        say("uncertainUnknown");
      }
    }

    async function afterConflict() {
      // Content or sharing changed elsewhere: require a fresh review of the re-read preview.
      review.checked = false;
      try {
        await readAll();
        if (!closed && !authorityLost) say("conflict");
      } catch (error) {
        if (handleAuthority(error)) return;
        sharing = null;
        renderState();
        say("uncertainUnknown");
      }
    }

    function requestCreate(confirmed) {
      if (busy || closed || authorityLost || !sharing) return;
      const expiresAt = expiryToggle.checked ? localDateTimeToIso(expiryInput.value) : null;
      if (expiresAt === undefined) { hideConfirm(); say("expiryInvalid"); try { expiryInput.focus(); } catch { /* */ } return; }
      if (!review.checked) { hideConfirm(); say("reviewFirst"); try { review.focus(); } catch { /* */ } return; }
      const replacing = sharing.enabled;
      if (replacing && !(confirmed && pendingConfirm === "rotate")) { showConfirm("rotate"); return; }
      hideConfirm();
      const expected = sharing.version;
      run(async () => {
        clearLink();
        say("");
        let payload;
        try {
          payload = await request(base, { method: "POST", body: { expectedShareVersion: expected, expiresAt } });
          if (!payload || typeof payload !== "object" || !SHARE_TOKEN_PATTERN.test(String(payload.token || ""))) throw new ShareRequestError(0, "malformed");
          normalizeSharing(payload.sharing);
        } catch (error) {
          if (closed) return;
          if (error?.status === 409) { await afterConflict(); return; }
          if (error?.status === 0 || error?.status >= 500 || error?.status === 408 || error?.status === 429) {
            await rereadAfterUncertain(expected, "create");
            return;
          }
          throw error;
        }
        if (closed || authorityLost) return; // a late success after close is discarded with its token
        review.checked = false;
        expiryTouched = false;
        applySharing(payload.sharing);
        showLink(payload.token, payload.sharing.version);
        say(replacing ? "rotatedOk" : "createdOk");
      });
    }

    function requestRevoke(confirmed) {
      if (busy || closed || authorityLost || !sharing?.enabled) return;
      if (!(confirmed && pendingConfirm === "revoke")) { showConfirm("revoke"); return; }
      hideConfirm();
      const expected = sharing.version;
      run(async () => {
        clearLink();
        say("");
        let payload;
        try {
          payload = await request(`${base}/revoke`, { method: "POST", body: { expectedShareVersion: expected } });
          normalizeSharing(payload?.sharing);
        } catch (error) {
          if (closed) return;
          if (error?.status === 409) { await afterConflict(); return; }
          if (error?.status === 0 || error?.status >= 500 || error?.status === 408 || error?.status === 429) {
            await rereadAfterUncertain(expected, "revoke");
            return;
          }
          throw error;
        }
        if (closed || authorityLost) return;
        review.checked = false;
        expiryTouched = false;
        applySharing(payload.sharing);
        say("revokedOk");
        try { primary.focus(); } catch { /* */ }
      });
    }

    function selectLink() {
      try { linkInput.focus(); linkInput.select(); linkInput.setSelectionRange(0, linkInput.value.length); } catch { /* selection unsupported */ }
    }

    async function copyLink() {
      const value = linkInput.value;
      if (closed || !value) return;
      const clipboard = nav?.clipboard;
      if (clipboard && typeof clipboard.writeText === "function" && win.isSecureContext !== false) {
        try {
          await clipboard.writeText(value);
          if (!closed && linkInput.value === value) say("copied");
          return;
        } catch { /* fall through to manual selection */ }
      }
      if (closed || linkInput.value !== value) return;
      selectLink();
      say("copyManual");
    }

    async function shareLink() {
      const value = linkInput.value;
      if (closed || !value || typeof nav?.share !== "function") return;
      try {
        await nav.share({ title: tt("shareTitle"), url: value });
      } catch (error) {
        if (closed || linkInput.value !== value || error?.name === "AbortError") return;
        selectLink();
        say("shareUnavailable");
      }
    }

    function finish() {
      if (closed) return;
      closed = true;
      generation++;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      linkInput.value = "";
      linkBox.hidden = true;
      sharing = null;
      try { if (dialog.open && typeof dialog.close === "function") dialog.close(); } catch { /* already closed */ }
      dialog.remove();
      if (session && session.dialog === dialog) session = null;
      if (launcher.isConnected) { try { launcher.focus(); } catch { /* */ } }
    }

    updateControls();
    const ready = run(() => readAll({ announce: true }));
    return {
      dialog,
      ready,
      close: finish,
      focus() { try { heading.focus(); } catch { /* */ } }
    };
  }

  return {
    button: launcher,
    open,
    close,
    relabel,
    setCanManage(value) {
      if (destroyed) return;
      allowed = Boolean(value);
      if (allowed) { if (!launcher.isConnected) container.append(launcher); relabel(); }
      else { close(); launcher.remove(); }
    },
    destroy() {
      destroyed = true;
      close();
      launcher.remove();
    }
  };
}
