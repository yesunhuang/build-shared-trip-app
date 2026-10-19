// Anonymous read-only itinerary page for /s/<tripId>#<token>.
// Standalone module: no framework, library, provider SDK, analytics, cookies or browser storage.
// The share token lives only in this module's memory. It is read from the URL fragment (which the
// browser never sends to the server, proxies or referrers), and sent only in the X-Trip-Share header
// to same-origin /guest/trips/<id> endpoints with credentials omitted. The fragment is left in the
// address bar so that a copied/forwarded link keeps working; the page never rewrites it. If the
// fragment changes on an open page (a new/rotated link pasted into an existing tab), all content,
// media and requests for the old link are dropped and the page reloads for the new link.

export const GUEST_LOCALES = Object.freeze(["en", "zh-Hans", "zh-Hant", "ja"]);
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const TRIP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const PLAN_TYPES = Object.freeze(["flight", "stay", "restaurant", "transport", "car", "sight", "activity", "event", "shopping", "other"]);
export const CARD_CATEGORIES = Object.freeze(["restaurant", "hotel", "ticketed-transport"]);
const PERIODS = Object.freeze(["morning", "noon", "evening"]);
const DENIED_STATUSES = new Set([401, 403, 404, 410]);
const MEDIA_TYPES = /^image\/(png|jpeg|webp|gif|avif)(\s*;|$)/i;
// Guest media URL tail after "/guest/trips/<id>/media/": exactly the server's media keys
// (server/trip-sharing.mjs GUEST_MEDIA_ROUTE: cover | logo | plan-<id>) followed by the optional
// content fingerprint buildGuestProjection appends ("?h=" + 16 lowercase hex). Any other query,
// duplicated/extra parameter, fragment, encoding, slash, backslash or whitespace is rejected.
const MEDIA_KEY_TAIL = /^(cover|logo|plan-[A-Za-z0-9][A-Za-z0-9._-]{0,99})(\?h=[0-9a-f]{16})?$/;

// Explicit allowlists of translatable source-text fields; nothing else is read from i18n patches.
export const I18N_FIELDS = Object.freeze({
  trip: Object.freeze(["title"]),
  day: Object.freeze(["label", "area", "summary", "notes"]),
  slot: Object.freeze(["name", "time", "address", "description", "notes"]),
  reminder: Object.freeze(["item", "notes"])
});

export const DEFAULT_CONFIG = Object.freeze({
  requestTimeoutMs: 15000,
  mediaTimeoutMs: 20000,
  retryDelaysMs: Object.freeze([3000, 10000, 30000]), // bounded automatic retries per failure streak
  maxRetryAfterMs: 120000,
  pollMs: 180000,         // background check while visible
  maxPolls: 120,          // ~6 hours of open page; lifecycle events and the button still refresh
  lifecycleGapMs: 30000,  // focus/visibility refreshes are throttled to this gap after a success
  mediaConcurrency: 3,
  maxMediaPerView: 60,
  maxBlobEntries: 80,
  maxMediaBytes: 12 * 1024 * 1024,
  maxBlobBytes: 48 * 1024 * 1024, // total in-memory media budget (non-visible blobs are evicted first)
  // Trip JSON read cap (UTF-8 bytes); larger bodies are treated as a transient failure, never a denial.
  // The server accepts a canonical trip of up to 1,500,000 JSON *characters* (UTF-16 code units,
  // server/domain/validate.mjs LIMITS.tripJsonChars). In UTF-8 one code unit takes at most 3 bytes
  // (BMP CJK/kana text; astral characters are 2 units -> 4 bytes), so multilingual canonical text alone
  // can reach ~4.5 MB (> 4 MiB). The guest projection is an allowlisted subset of that text with
  // embedded image bytes replaced by short /guest media URLs; 8 MiB leaves ~3.8 MB of headroom for
  // the projection's own additions (media URLs, focus defaults, the {"trip":...} wrapper).
  maxTripBytes: 8 * 1024 * 1024,
  // Native-link activation guard: a changed refresh that lands while a link is being pressed/activated
  // is held (latest only) until the press ends, so the browser's own activation reaches the original <a>.
  linkSettleMs: 60,       // after click/cancel/lost focus, let the default action run first
  linkReleaseMs: 400,     // after pointerup/touchend/keyup, wait this long for the click
  linkMaxHoldMs: 10000    // safety valve: never hold an update longer than this
});

export const TRANSLATIONS = Object.freeze({
  en: {
    sharedItinerary: "Shared itinerary", language: "Language", loading: "Loading the itinerary…",
    deniedTitle: "This link is not available",
    deniedBody: "This shared link has been closed or has expired. Please contact the person who sent it to you for a new link.",
    checkAgain: "Check again", errorTitle: "The itinerary could not be loaded",
    errorBody: "Please check your internet connection and try again.", retry: "Try again",
    staleBody: "Could not check for updates. You are seeing the last version loaded on this page.",
    chooseDay: "Choose a day", previousDay: "Previous day", nextDay: "Next day",
    noPlans: "No plans have been added for this day.", reminders: "Reminders",
    shareTitle: "Share this itinerary",
    shareNote: "Anyone who has this link can view this itinerary. Only forward it to people you trust.",
    shareLink: "Share or copy link", shareFallback: "Press and hold the link below to copy it.",
    readOnlyNote: "Read-only view. Changes made by the organizer appear while this page is open.",
    dayN: "Day {n}", today: "Today", dateNotSet: "Date not set",
    phaseBefore: "The trip starts on {date}. Showing the first day.",
    phaseDuring: "Today is {date}.",
    phaseAfter: "This trip has ended. Showing the last day; earlier days are still available.",
    phaseUndated: "Dates have not been set yet.",
    period_morning: "Morning", period_noon: "Afternoon", period_evening: "Evening",
    type_flight: "Flight", type_stay: "Stay", type_restaurant: "Meal", type_transport: "Transport", type_car: "Car",
    type_sight: "Sightseeing", type_activity: "Activity", type_event: "Event", type_shopping: "Shopping", type_other: "Other",
    "cat_restaurant": "Restaurant", "cat_hotel": "Hotel", "cat_ticketed-transport": "Ticketed transport",
    importantNote: "Important", dayNotes: "Notes for this day", address: "Address",
    copyAddress: "Copy address", addressCopied: "Address copied.",
    copyManual: "The address is selected. Press and hold it to copy.",
    openMap: "Google Maps", openOsm: "OpenStreetMap", mapLabel: "Open {place} in {service} (opens in a new tab)",
    photoBy: "Photo: {credit}", photoLicense: "License", photoSource: "Source", due: "Due {date}",
    checkUpdates: "Check for updates",
    statusChecking: "Checking for updates…", statusUpdated: "Updated at {time}",
    statusChecked: "Up to date (checked at {time})",
    statusRetrying: "Could not refresh at {time}. Trying again soon.", statusFailed: "Could not refresh at {time}.",
    linkCopied: "Link copied.", linkShared: "Link shared.", shareManual: "Copy the link below."
  },
  "zh-Hans": {
    sharedItinerary: "共享行程", language: "语言", loading: "正在加载行程…",
    deniedTitle: "这个链接无法打开",
    deniedBody: "这个分享链接已关闭，请联系发给你的人获取新链接。",
    checkAgain: "再检查一次", errorTitle: "暂时无法加载行程", errorBody: "请检查网络连接后重试。", retry: "重试",
    staleBody: "暂时无法检查更新，当前显示的是此页面上次加载的内容。",
    chooseDay: "选择日期", previousDay: "前一天", nextDay: "后一天",
    noPlans: "这一天还没有安排。", reminders: "提醒事项",
    shareTitle: "分享此行程", shareNote: "任何拿到此链接的人都可以查看此行程。请只转发给信任的人。",
    shareLink: "分享或复制链接", shareFallback: "长按下面的链接即可复制。",
    readOnlyNote: "只读页面。页面打开期间，组织者的修改会自动显示。",
    dayN: "第{n}天", today: "今天", dateNotSet: "日期未定",
    phaseBefore: "行程将于{date}开始，先显示第一天。", phaseDuring: "今天是{date}。",
    phaseAfter: "行程已结束，显示最后一天；之前的日期仍可查看。", phaseUndated: "日期尚未确定。",
    period_morning: "上午", period_noon: "下午", period_evening: "晚上",
    type_flight: "航班", type_stay: "住宿", type_restaurant: "用餐", type_transport: "交通", type_car: "用车",
    type_sight: "景点", type_activity: "体验", type_event: "活动", type_shopping: "购物", type_other: "其他",
    "cat_restaurant": "餐厅", "cat_hotel": "酒店", "cat_ticketed-transport": "需凭票交通",
    importantNote: "重要提示", dayNotes: "当天备注", address: "地址",
    copyAddress: "复制地址", addressCopied: "地址已复制。", copyManual: "已选中地址，长按即可复制。",
    openMap: "谷歌地图", openOsm: "OpenStreetMap", mapLabel: "在{service}中打开{place}（新标签页）",
    photoBy: "照片：{credit}", photoLicense: "许可", photoSource: "来源", due: "截止 {date}",
    checkUpdates: "检查更新",
    statusChecking: "正在检查更新…", statusUpdated: "已于{time}更新", statusChecked: "已是最新（{time}检查）",
    statusRetrying: "{time}更新失败，稍后自动重试。", statusFailed: "{time}更新失败。",
    linkCopied: "链接已复制。", linkShared: "链接已分享。", shareManual: "请复制下面的链接。"
  },
  "zh-Hant": {
    sharedItinerary: "共享行程", language: "語言", loading: "正在載入行程…",
    deniedTitle: "這個連結無法開啟",
    deniedBody: "這個分享連結已關閉，請聯絡傳給你的人取得新連結。",
    checkAgain: "再檢查一次", errorTitle: "暫時無法載入行程", errorBody: "請檢查網路連線後重試。", retry: "重試",
    staleBody: "暫時無法檢查更新，目前顯示的是此頁面上次載入的內容。",
    chooseDay: "選擇日期", previousDay: "前一天", nextDay: "後一天",
    noPlans: "這一天還沒有安排。", reminders: "提醒事項",
    shareTitle: "分享此行程", shareNote: "任何取得此連結的人都可以檢視此行程。請只轉傳給信任的人。",
    shareLink: "分享或複製連結", shareFallback: "長按下方連結即可複製。",
    readOnlyNote: "唯讀頁面。頁面開啟期間，主辦人的修改會自動顯示。",
    dayN: "第{n}天", today: "今天", dateNotSet: "日期未定",
    phaseBefore: "行程將於{date}開始，先顯示第一天。", phaseDuring: "今天是{date}。",
    phaseAfter: "行程已結束，顯示最後一天；之前的日期仍可檢視。", phaseUndated: "日期尚未確定。",
    period_morning: "上午", period_noon: "下午", period_evening: "晚上",
    type_flight: "航班", type_stay: "住宿", type_restaurant: "用餐", type_transport: "交通", type_car: "用車",
    type_sight: "景點", type_activity: "體驗", type_event: "活動", type_shopping: "購物", type_other: "其他",
    "cat_restaurant": "餐廳", "cat_hotel": "飯店", "cat_ticketed-transport": "需憑票交通",
    importantNote: "重要提示", dayNotes: "當天備註", address: "地址",
    copyAddress: "複製地址", addressCopied: "地址已複製。", copyManual: "已選取地址，長按即可複製。",
    openMap: "Google 地圖", openOsm: "OpenStreetMap", mapLabel: "在{service}中開啟{place}（新分頁）",
    photoBy: "照片：{credit}", photoLicense: "授權", photoSource: "來源", due: "截止 {date}",
    checkUpdates: "檢查更新",
    statusChecking: "正在檢查更新…", statusUpdated: "已於{time}更新", statusChecked: "已是最新（{time}檢查）",
    statusRetrying: "{time}更新失敗，稍後自動重試。", statusFailed: "{time}更新失敗。",
    linkCopied: "連結已複製。", linkShared: "連結已分享。", shareManual: "請複製下方連結。"
  },
  ja: {
    sharedItinerary: "共有された旅程", language: "言語", loading: "旅程を読み込んでいます…",
    deniedTitle: "このリンクは利用できません",
    deniedBody: "この共有リンクは無効になりました。送ってくれた人に新しいリンクを依頼してください。",
    checkAgain: "もう一度確認", errorTitle: "旅程を読み込めませんでした",
    errorBody: "インターネット接続を確認して、もう一度お試しください。", retry: "再試行",
    staleBody: "更新を確認できませんでした。このページで最後に読み込んだ内容を表示しています。",
    chooseDay: "日付を選ぶ", previousDay: "前の日", nextDay: "次の日",
    noPlans: "この日の予定はまだありません。", reminders: "リマインダー",
    shareTitle: "この旅程を共有",
    shareNote: "このリンクを持っている人は誰でもこの旅程を見ることができます。信頼できる人にだけ転送してください。",
    shareLink: "リンクを共有またはコピー", shareFallback: "下のリンクを長押ししてコピーしてください。",
    readOnlyNote: "閲覧専用ページです。ページを開いている間、主催者の変更が反映されます。",
    dayN: "{n}日目", today: "今日", dateNotSet: "日付未定",
    phaseBefore: "旅行は{date}に始まります。1日目を表示しています。", phaseDuring: "今日は{date}です。",
    phaseAfter: "旅行は終了しました。最終日を表示しています。前の日もご覧いただけます。",
    phaseUndated: "日付はまだ決まっていません。",
    period_morning: "午前", period_noon: "午後", period_evening: "夜",
    type_flight: "フライト", type_stay: "宿泊", type_restaurant: "食事", type_transport: "移動", type_car: "車",
    type_sight: "観光", type_activity: "体験", type_event: "イベント", type_shopping: "買い物", type_other: "その他",
    "cat_restaurant": "レストラン", "cat_hotel": "ホテル", "cat_ticketed-transport": "乗車券が必要な交通",
    importantNote: "重要", dayNotes: "この日のメモ", address: "住所",
    copyAddress: "住所をコピー", addressCopied: "住所をコピーしました。",
    copyManual: "住所を選択しました。長押ししてコピーしてください。",
    openMap: "Google マップ", openOsm: "OpenStreetMap", mapLabel: "{place}を{service}で開く（新しいタブ）",
    photoBy: "写真：{credit}", photoLicense: "ライセンス", photoSource: "出典", due: "期限 {date}",
    checkUpdates: "更新を確認",
    statusChecking: "更新を確認しています…", statusUpdated: "{time}に更新しました",
    statusChecked: "最新です（{time}に確認）",
    statusRetrying: "{time}に更新できませんでした。まもなく再試行します。", statusFailed: "{time}に更新できませんでした。",
    linkCopied: "リンクをコピーしました。", linkShared: "リンクを共有しました。", shareManual: "下のリンクをコピーしてください。"
  }
});

// ---------------------------------------------------------------- pure helpers (exported for tests)

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value.trim() : "");

export function translate(locale, key, vars = {}) {
  const table = TRANSLATIONS[locale] || TRANSLATIONS.en;
  const template = Object.hasOwn(table, key) ? table[key] : (Object.hasOwn(TRANSLATIONS.en, key) ? TRANSLATIONS.en[key] : key);
  return template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(vars, name) ? String(vars[name]) : match));
}

export function pickLocale(languages = []) {
  for (const raw of languages) {
    const tag = String(raw || "").toLowerCase();
    if (/^zh-(hant|tw|hk|mo)/.test(tag)) return "zh-Hant";
    if (tag.startsWith("zh")) return "zh-Hans";
    if (tag.startsWith("ja")) return "ja";
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

/** Reads only explicitly allowlisted translatable fields; never arbitrary nested i18n objects. */
export function localized(record, field, locale, kind) {
  if (!isObject(record)) return "";
  const base = text(record[field]);
  const allowed = I18N_FIELDS[kind];
  if (!allowed || !allowed.includes(field) || !isObject(record.i18n) || !Object.hasOwn(record.i18n, locale)) return base;
  const patch = record.i18n[locale];
  if (!isObject(patch) || !Object.hasOwn(patch, field)) return base;
  return text(patch[field]) || base;
}

export function parseShareLocation(location) {
  const match = String(location?.pathname || "").match(/^\/s\/([^/]+)\/?$/);
  let tripId = "";
  if (match) { try { tripId = decodeURIComponent(match[1]); } catch { tripId = ""; } }
  const token = String(location?.hash || "").replace(/^#/, "");
  return {
    tripId: TRIP_ID_PATTERN.test(tripId) ? tripId : "",
    token: TOKEN_PATTERN.test(token) ? token : ""
  };
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isIsoDate(value) {
  const match = typeof value === "string" && value.match(ISO_DATE);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
}

/** Calendar date (YYYY-MM-DD) at `now` in the trip's IANA timezone; falls back to the device zone. */
export function todayInZone(timeZone, now = new Date()) {
  const format = (zone) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const get = (type) => parts.find((part) => part.type === type)?.value;
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  if (typeof timeZone === "string" && timeZone) { try { return format(timeZone); } catch { /* invalid zone */ } }
  return format(undefined);
}

/**
 * Initial day: today (trip timezone) during travel; first day before departure; last past day
 * after the trip; latest past day inside a gap; first day for undated drafts.
 */
export function chooseInitialDay(days, today) {
  if (!Array.isArray(days) || !days.length) return { index: -1, phase: "empty" };
  const dated = days.map((day, index) => ({ index, date: day?.date })).filter((entry) => isIsoDate(entry.date));
  if (!dated.length) return { index: 0, phase: "undated" };
  const first = dated.reduce((a, b) => (b.date < a.date ? b : a));
  const last = dated.reduce((a, b) => (b.date >= a.date ? b : a));
  if (today < first.date) return { index: first.index, phase: "before" };
  if (today > last.date) return { index: last.index, phase: "after" };
  const exact = dated.find((entry) => entry.date === today);
  if (exact) return { index: exact.index, phase: "during" };
  const past = dated.filter((entry) => entry.date <= today).reduce((a, b) => (b.date >= a.date ? b : a));
  return { index: past.index, phase: "during" };
}

export function slotStartMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number(match[1]); const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : Number.POSITIVE_INFINITY;
}

const finiteOrder = (value) => (value === "" || value === null || value === undefined ? NaN : Number(value));
/** Same rule as the authenticated timeline: sortOrder, then period, then start time; stable otherwise. */
export function orderSlots(slots) {
  if (!Array.isArray(slots)) return [];
  const periodRank = (slot) => ({ morning: 0, noon: 1, evening: 2 })[slot?.period] ?? 3;
  return slots.filter(isObject).map((slot, index) => ({ slot, index })).sort((a, b) => {
    const firstOrder = finiteOrder(a.slot.sortOrder); const secondOrder = finiteOrder(b.slot.sortOrder);
    if (Number.isFinite(firstOrder) && Number.isFinite(secondOrder) && firstOrder !== secondOrder) return firstOrder - secondOrder;
    const period = periodRank(a.slot) - periodRank(b.slot);
    if (period) return period;
    const first = slotStartMinutes(a.slot.sortTime || a.slot.time); const second = slotStartMinutes(b.slot.sortTime || b.slot.time);
    if (first !== second) return first < second ? -1 : 1;
    return a.index - b.index;
  }).map((entry) => entry.slot);
}

function httpUrl(value, { httpsOnly = false } = {}) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try { url = new URL(value.trim()); } catch { return null; }
  if (!(url.protocol === "https:" || (!httpsOnly && url.protocol === "http:")) || url.username || url.password) return null;
  return url;
}

function isGoogleMapsUrl(url) {
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl") return url.pathname.startsWith("/maps");
  if (/^maps\.google\.[a-z.]+$/.test(host)) return true;
  return /^(www\.)?google\.[a-z.]+$/.test(host) && (url.pathname === "/maps" || url.pathname.startsWith("/maps/"));
}

const validCoordinate = (lat, lng) => typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
  && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Labelled external map links (no API, no key, no request until tapped). Never carries the share token. */
export function mapLinks({ name = "", address = "", lat, lng, googleMapsUrl, mapsUrl } = {}) {
  const query = [name, address].map(text).filter((value, index, values) => value && values.indexOf(value) === index).join(", ");
  const coords = validCoordinate(lat, lng) ? `${Number(lat.toFixed(6))},${Number(lng.toFixed(6))}` : "";
  const stored = [googleMapsUrl, mapsUrl].map((value) => httpUrl(value, { httpsOnly: true })).find((url) => url && isGoogleMapsUrl(url));
  let google = "";
  if (stored) google = stored.href;
  else if (coords) google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coords)}`;
  else if (text(address)) google = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  let osm = "";
  if (coords) { const [la, ln] = coords.split(","); osm = `https://www.openstreetmap.org/?mlat=${la}&mlon=${ln}#map=17/${la}/${ln}`; }
  else if (text(address)) osm = `https://www.openstreetmap.org/search?query=${encodeURIComponent(query)}`;
  return { google, osm };
}

function readableHex(value) { return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : ""; }
function luminance(hex) {
  const channel = (index) => { const v = parseInt(hex.slice(index, index + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a, b) { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
const THEME_PRESETS = Object.freeze({
  default: { ink: "#17362f", accent: "#db7549", background: "#f4efe6" },
  sage: { ink: "#183d2c", accent: "#39734f", background: "#eff6ee" },
  ocean: { ink: "#173b50", accent: "#286582", background: "#edf5fa" },
  plum: { ink: "#482d50", accent: "#7e467d", background: "#f8f0f7" }
});
/** Only light themes whose ink keeps >= 7:1 against white cards and >= 4.5:1 against the page. */
export function resolveTheme(theme) {
  if (!isObject(theme)) return THEME_PRESETS.default;
  let colors = null;
  if (typeof theme.preset === "string" && theme.preset !== "custom" && Object.hasOwn(THEME_PRESETS, theme.preset)) colors = THEME_PRESETS[theme.preset];
  else if (theme.preset === "custom") {
    const ink = readableHex(theme.ink); const accent = readableHex(theme.accent); const background = readableHex(theme.background);
    if (ink && accent && background) colors = { ink, accent, background };
  }
  if (!colors || luminance(colors.background) < 0.8 || contrast(colors.ink, "#ffffff") < 7 || contrast(colors.ink, colors.background) < 4.5) return THEME_PRESETS.default;
  return colors;
}

// ---------------------------------------------------------------- page controller

export function startGuestPage(options = {}) {
  const win = options.window || globalThis.window;
  const doc = win.document;
  const fetchImpl = options.fetch || win.fetch.bind(win);
  const now = options.now || (() => new Date());
  const setTimer = options.setTimeout || win.setTimeout.bind(win);
  const clearTimer = options.clearTimeout || win.clearTimeout.bind(win);
  const config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
  const AbortCtl = win.AbortController || globalThis.AbortController;
  const URLApi = win.URL;
  const nav = win.navigator || {};
  const byId = (id) => doc.getElementById(id);
  // Explicit link change (new fragment on the same page): a full reload so no old content, media or
  // capability survives under the new link. Injectable for tests only.
  const reloadPage = options.reload || (() => win.location.reload());
  const BlobCtor = globalThis.Blob || win.Blob;

  // Credential lives only here. Never written to storage, DOM, logs or any non-guest URL.
  const { tripId, token } = parseShareLocation(win.location);
  const tripPath = tripId ? `/guest/trips/${encodeURIComponent(tripId)}` : "";
  const mediaPrefix = tripPath + "/media/";

  let locale = GUEST_LOCALES.includes(options.locale) ? options.locale : pickLocale(nav.languages || [nav.language]);
  let closed = false;
  let denied = false;
  let trip = null;
  let fingerprint = "";
  let selectedIndex = -1;
  let selectedDayId = null;
  let inFlight = null;          // { seq, controller }
  let requestSeq = 0;
  let failures = 0;
  let lastSuccessAt = 0;
  let lastAttemptAt = 0;
  let retryTimer = null;
  let pollTimer = null;
  let polls = 0;
  let statusState = { key: "", time: null };
  let blobUse = 0;
  let contentGen = 0;           // bumps on every rendered content change, denial and close
  const blobs = new Map();      // mediaUrl -> { objectUrl, gen, used }
  const pendingMedia = new Map(); // mediaUrl -> { gen, controller }
  const mediaQueue = [];
  let activeMedia = 0;
  const timers = new Set();
  const listeners = [];
  // Link activation guard state. Only the latest changed successful payload is held (bounded memory).
  let pressActive = false;
  let pressLink = null;
  let pressEndTimer = null;
  let pressHoldTimer = null;
  let pendingUpdate = null;     // { data, next } awaiting the end of a link press

  const t = (key, vars) => translate(locale, key, vars);
  const el = (tag, className, content) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined && content !== null) node.textContent = content;
    return node;
  };
  const later = (fn, ms) => {
    const id = setTimer(() => { timers.delete(id); if (!closed) fn(); }, ms);
    timers.add(id); return id;
  };
  const cancel = (id) => { if (id !== null && id !== undefined) { clearTimer(id); timers.delete(id); } return null; };
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); listeners.push([target, type, fn, opts]); };
  const intlLocale = () => locale;

  function formatDate(iso, style) {
    if (!isIsoDate(iso)) return "";
    const [y, m, d] = iso.split("-").map(Number);
    const options = style === "long"
      ? { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }
      : { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" };
    try { return new Intl.DateTimeFormat(intlLocale(), options).format(new Date(Date.UTC(y, m - 1, d))); } catch { return iso; }
  }
  function formatClock(date) {
    try { return new Intl.DateTimeFormat(intlLocale(), { hour: "numeric", minute: "2-digit" }).format(date); } catch { return date.toISOString().slice(11, 16); }
  }

  // ------------------------------------------------------------ static text and visible states
  function applyStaticText() {
    doc.documentElement.lang = locale;
    for (const node of doc.querySelectorAll("[data-text]")) node.textContent = t(node.dataset.text);
    const select = byId("language"); if (select) select.value = locale;
    doc.title = trip && !denied ? (localized(trip, "title", locale, "trip") || t("sharedItinerary")) : t("sharedItinerary");
    renderStatus();
  }

  function showOnly(which) {
    byId("loading").hidden = which !== "loading";
    byId("denied").hidden = which !== "denied";
    byId("error").hidden = which !== "error";
    byId("trip").hidden = which !== "trip";
  }

  function setStatus(key, time = null) { statusState = { key, time }; renderStatus(); }
  function renderStatus() {
    const node = byId("refresh-status"); if (!node) return;
    const { key, time } = statusState;
    node.textContent = key ? t(key, { time: time ? formatClock(time) : "" }) : "";
    node.dataset.state = key === "statusRetrying" || key === "statusFailed" ? "error" : key === "statusChecking" ? "loading" : key ? "ok" : "";
  }

  function setBusy(busy) {
    for (const id of ["retry", "stale-retry", "denied-retry"]) { const button = byId(id); if (button) button.disabled = busy; }
    // Never disabled (keeps keyboard focus); repeated presses while busy are deduplicated in manualRefresh().
    byId("check-updates")?.setAttribute("aria-busy", String(busy));
  }

  // ------------------------------------------------------------ media (header-authenticated blobs)
  // Same-origin relative path of THIS trip only (cross-trip, absolute and cross-origin URLs fail the
  // prefix check). The token is never part of it: it travels only in the X-Trip-Share header.
  function isGuestMediaUrl(value) {
    return typeof value === "string" && tripPath !== "" && value.length <= 512 && value.startsWith(mediaPrefix)
      && MEDIA_KEY_TAIL.test(value.slice(mediaPrefix.length));
  }
  function remotePhotoUrl(value) {
    const url = httpUrl(value);
    if (!url) return "";
    // Same-origin absolute URLs would carry the visitor's own cookies to protected routes: never render them.
    if (url.origin === win.location.origin) return "";
    return url.href;
  }

  /** Configures an <img>: guest media is fetched to a blob URL; remote HTTP(S) photos load directly without referrer or token. */
  function bindImage(img, source) {
    img.removeAttribute("src");
    delete img.dataset.mediaUrl;
    img.referrerPolicy = "no-referrer";
    img.setAttribute("referrerpolicy", "no-referrer");
    img.decoding = "async";
    if (isGuestMediaUrl(source)) {
      img.dataset.mediaUrl = source;
      const existing = blobs.get(source);
      if (existing) { img.src = existing.objectUrl; existing.used = ++blobUse; }
      // Recheck after saved content changes: the endpoint serves current authorized bytes.
      if (!existing || existing.gen !== contentGen) queueMedia(source);
      return true;
    }
    const remote = remotePhotoUrl(source);
    if (remote) { img.loading = "lazy"; img.setAttribute("loading", "lazy"); img.src = remote; return true; }
    return false;
  }

  function imagesFor(url) { return [...doc.querySelectorAll("img[data-media-url]")].filter((img) => img.dataset.mediaUrl === url); }

  function queueMedia(url) {
    const pending = pendingMedia.get(url);
    if (pending && pending.gen === contentGen) return;
    if (pending) { pending.controller?.abort(); pendingMedia.delete(url); }
    if (pendingMedia.size + activeMedia >= config.maxMediaPerView * 2) return;
    pendingMedia.set(url, { gen: contentGen, controller: null });
    mediaQueue.push(url);
    pumpMedia();
  }

  function pumpMedia() {
    while (!closed && activeMedia < config.mediaConcurrency && mediaQueue.length) {
      const url = mediaQueue.shift();
      const entry = pendingMedia.get(url);
      if (!entry || entry.gen !== contentGen) { if (entry) pendingMedia.delete(url); continue; }
      activeMedia += 1;
      fetchMedia(url, entry).finally(() => { activeMedia -= 1; if (pendingMedia.get(url) === entry) pendingMedia.delete(url); pumpMedia(); });
    }
  }

  async function fetchMedia(url, entry) {
    const gen = entry.gen;
    const controller = new AbortCtl(); entry.controller = controller;
    const timeout = later(() => controller.abort(), config.mediaTimeoutMs);
    let blob = null; let deniedMedia = false;
    try {
      const response = await fetchImpl(url, {
        method: "GET", headers: { "X-Trip-Share": token, Accept: "image/*" }, credentials: "omit",
        cache: "no-store", referrerPolicy: "no-referrer", redirect: "error", mode: "same-origin", signal: controller.signal
      });
      if (closed || gen !== contentGen) return;
      const type = response.headers.get("content-type") || "";
      const length = Number(response.headers.get("content-length") || 0);
      if (response.status === 200 && MEDIA_TYPES.test(type) && length <= config.maxMediaBytes) {
        const candidate = await readCappedBlob(response, config.maxMediaBytes, type);
        if (candidate && candidate.size > 0 && candidate.size <= config.maxMediaBytes) blob = candidate;
      } else if (DENIED_STATUSES.has(response.status)) deniedMedia = true;
    } catch { /* network/timeout: keep any previous image */ } finally { cancel(timeout); }
    if (closed || gen !== contentGen) return; // late result after close/denial/replacement is dropped
    if (blob && typeof URLApi?.createObjectURL === "function") {
      const objectUrl = URLApi.createObjectURL(blob);
      const previous = blobs.get(url);
      blobs.set(url, { objectUrl, gen, used: ++blobUse, size: blob.size });
      for (const img of imagesFor(url)) { img.src = objectUrl; img.closest("[data-media-holder]")?.removeAttribute("hidden"); }
      if (previous && previous.objectUrl !== objectUrl) URLApi.revokeObjectURL?.(previous.objectUrl);
      trimBlobs();
    } else if (deniedMedia) {
      const previous = blobs.get(url);
      if (previous) { blobs.delete(url); URLApi?.revokeObjectURL?.(previous.objectUrl); }
      for (const img of imagesFor(url)) { img.removeAttribute("src"); const holder = img.closest("[data-media-holder]"); if (holder) holder.hidden = true; }
    }
  }

  const blobBytes = () => { let total = 0; for (const entry of blobs.values()) total += entry.size || 0; return total; };
  const overBudget = () => blobs.size > config.maxBlobEntries || blobBytes() > config.maxBlobBytes;

  /** Evicts least-recently-used blobs that no rendered image shows, by entry count and total bytes. */
  function trimBlobs() {
    if (!overBudget()) return;
    const visible = new Set([...doc.querySelectorAll("img[data-media-url]")].map((img) => img.dataset.mediaUrl));
    const candidates = [...blobs].filter(([url]) => !visible.has(url)).sort((a, b) => a[1].used - b[1].used);
    while (overBudget() && candidates.length) {
      const [url, entry] = candidates.shift(); blobs.delete(url); URLApi?.revokeObjectURL?.(entry.objectUrl);
    }
  }

  /** Reads a body without ever holding more than `max` bytes (a missing/false content-length cannot bypass the cap). */
  async function readCappedBytes(response, max) {
    const reader = response.body && typeof response.body.getReader === "function" ? response.body.getReader() : null;
    if (!reader) return null;
    const chunks = []; let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value?.byteLength || 0;
      if (size > max) { try { await reader.cancel(); } catch { /* already closed */ } return { overflow: true }; }
      if (value) chunks.push(value);
    }
    return { chunks, size };
  }
  async function readCappedBlob(response, max, type) {
    const read = await readCappedBytes(response, max);
    if (read?.overflow) return null;
    if (read && typeof BlobCtor === "function") return new BlobCtor(read.chunks, { type });
    const blob = await response.blob();
    return blob.size <= max ? blob : null;
  }
  async function readCappedJson(response, max) {
    const declared = Number(response.headers?.get?.("content-length") || 0);
    if (declared > max) return null;
    const read = await readCappedBytes(response, max);
    if (read?.overflow) return null;
    let body;
    if (read && typeof globalThis.TextDecoder === "function") {
      const bytes = new Uint8Array(read.size); let offset = 0;
      for (const chunk of read.chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      body = new globalThis.TextDecoder().decode(bytes);
    } else body = await response.text();
    if (body.length > max) return null;
    try { return JSON.parse(body); } catch { return null; }
  }

  /** Revokes blobs no longer referenced by the current allowed projection. */
  function pruneBlobs(referenced) {
    for (const [url, entry] of [...blobs]) if (!referenced.has(url)) { blobs.delete(url); URLApi?.revokeObjectURL?.(entry.objectUrl); }
  }

  function dropAllMedia() {
    contentGen += 1;
    for (const entry of pendingMedia.values()) entry.controller?.abort();
    pendingMedia.clear(); mediaQueue.length = 0;
    for (const img of doc.querySelectorAll("img")) { if (img.dataset.mediaUrl || img.src) img.removeAttribute("src"); delete img.dataset.mediaUrl; }
    for (const entry of blobs.values()) URLApi?.revokeObjectURL?.(entry.objectUrl);
    blobs.clear();
  }

  function referencedMedia(data) {
    const urls = new Set();
    const add = (value) => { if (isGuestMediaUrl(value)) urls.add(value); };
    add(data?.cover?.url); add(data?.branding?.logo?.url);
    for (const day of Array.isArray(data?.days) ? data.days : []) for (const slot of Array.isArray(day?.slots) ? day.slots : []) add(slot?.photo?.url);
    return urls;
  }

  // ------------------------------------------------------------ rendering
  const days = () => (Array.isArray(trip?.days) ? trip.days.filter(isObject) : []);
  const dayName = (day, index) => localized(day, "label", locale, "day") || t("dayN", { n: index + 1 });

  function applyTheme() {
    const colors = resolveTheme(trip?.branding?.theme);
    const style = doc.documentElement.style;
    style.setProperty("--g-ink", colors.ink); style.setProperty("--g-bg", colors.background);
    // Accent only decorates borders; keep a dark readable stripe if the accent is too light.
    style.setProperty("--g-accent", contrast(colors.accent, "#ffffff") >= 3 ? colors.accent : colors.ink);
  }

  function renderTrip({ preserveScroll = true } = {}) {
    const scrollY = preserveScroll ? (win.scrollY || win.pageYOffset || 0) : 0;
    const focusKey = doc.activeElement?.dataset?.focusKey || "";
    applyTheme();
    const title = localized(trip, "title", locale, "trip");
    byId("trip-title").textContent = title || t("sharedItinerary");
    doc.title = title || t("sharedItinerary");

    const logo = byId("logo");
    const logoInfo = isObject(trip.branding?.logo) ? trip.branding.logo : null;
    logo.alt = text(logoInfo?.alt);
    logo.hidden = !(logoInfo && bindImage(logo, logoInfo.url));
    if (logo.hidden) { logo.removeAttribute("src"); delete logo.dataset.mediaUrl; }

    const cover = byId("cover"); const coverImg = byId("cover-img");
    const coverInfo = isObject(trip.cover) ? trip.cover : null;
    coverImg.alt = text(coverInfo?.alt);
    cover.setAttribute("data-media-holder", "");
    if (coverInfo && bindImage(coverImg, coverInfo.url)) {
      const focus = (value) => (typeof value === "number" && value >= 0 && value <= 100 ? value : 50);
      coverImg.style.setProperty("object-position", `${focus(coverInfo.focusX)}% ${focus(coverInfo.focusY)}%`);
      cover.hidden = false;
    } else { cover.hidden = true; coverImg.removeAttribute("src"); delete coverImg.dataset.mediaUrl; }

    const list = days();
    if (selectedDayId !== null) {
      const kept = list.findIndex((day) => day.id === selectedDayId);
      if (kept >= 0) selectedIndex = kept; // never jump the reader's chosen day on refresh
      else selectedIndex = Math.min(Math.max(selectedIndex, 0), list.length - 1);
    }
    if (selectedIndex < 0 || selectedIndex >= list.length) selectedIndex = chooseInitialDay(list, todayInZone(trip.timezone, now())).index;
    selectedDayId = list[selectedIndex]?.id ?? null;

    renderPhase(); renderDayNav(); renderDay(); renderReminders();
    pruneBlobs(referencedMedia(trip));

    if (focusKey) { const target = [...doc.querySelectorAll("[data-focus-key]")].find((node) => node.dataset.focusKey === focusKey); target?.focus?.({ preventScroll: true }); }
    if (preserveScroll && scrollY > 0 && Math.abs((win.scrollY || 0) - scrollY) > 1 && typeof win.scrollTo === "function") { try { win.scrollTo(0, scrollY); } catch { /* not supported */ } }
  }

  function renderPhase() {
    const list = days();
    const today = todayInZone(trip.timezone, now());
    const { phase } = chooseInitialDay(list, today);
    const firstDated = list.map((day) => day.date).filter(isIsoDate).sort()[0];
    const message = phase === "before" ? t("phaseBefore", { date: formatDate(firstDated, "long") })
      : phase === "during" ? t("phaseDuring", { date: formatDate(today, "long") })
        : phase === "after" ? t("phaseAfter") : phase === "undated" ? t("phaseUndated") : "";
    const node = byId("trip-phase"); node.textContent = message; node.dataset.phase = phase; node.hidden = !message;
  }

  function renderDayNav() {
    const list = days();
    const today = todayInZone(trip.timezone, now());
    const ul = byId("day-list"); ul.replaceChildren();
    list.forEach((day, index) => {
      const li = el("li");
      const button = el("button", "g-day-button");
      button.type = "button"; button.dataset.dayIndex = String(index); button.dataset.focusKey = "day:" + String(day.id ?? index);
      button.setAttribute("aria-pressed", String(index === selectedIndex));
      button.append(el("span", "g-day-label", dayName(day, index)));
      button.append(el("span", "g-day-when", isIsoDate(day.date) ? formatDate(day.date, "short") : t("dateNotSet")));
      if (day.date === today) { button.setAttribute("aria-current", "date"); button.append(el("span", "g-badge", t("today"))); }
      li.append(button); ul.append(li);
    });
    byId("day-nav").hidden = list.length < 2;
    byId("prev-day").disabled = selectedIndex <= 0;
    byId("next-day").disabled = selectedIndex >= list.length - 1;
  }

  function renderDay() {
    const list = days(); const day = list[selectedIndex];
    const heading = byId("day-heading"); const dateLine = byId("day-date"); const info = byId("day-info"); const slotsNode = byId("slots");
    info.replaceChildren(); slotsNode.replaceChildren();
    if (!day) { heading.textContent = ""; dateLine.textContent = ""; byId("no-slots").hidden = false; return; }
    heading.textContent = dayName(day, selectedIndex);
    const today = todayInZone(trip.timezone, now());
    dateLine.textContent = isIsoDate(day.date) ? formatDate(day.date, "long") + (day.date === today ? " · " + t("today") : "") : t("dateNotSet");
    const area = localized(day, "area", locale, "day");
    const summary = localized(day, "summary", locale, "day");
    const notes = localized(day, "notes", locale, "day");
    if (area) info.append(el("p", "g-day-area", area));
    if (summary) info.append(el("p", "g-day-summary", summary));
    if (notes) { const box = el("div", "g-important"); box.append(el("strong", "", t("dayNotes")), el("span", "", notes)); info.append(box); }
    const ordered = orderSlots(day.slots);
    ordered.forEach((slot) => slotsNode.append(renderSlot(slot)));
    byId("no-slots").hidden = ordered.length > 0;
  }

  function renderSlot(slot) {
    const li = el("li", "g-slot");
    if (typeof slot.id === "string") li.dataset.slotId = slot.id;
    if (CARD_CATEGORIES.includes(slot.cardCategory)) li.dataset.category = slot.cardCategory;
    const time = localized(slot, "time", locale, "slot");
    const period = PERIODS.includes(slot.period) ? t("period_" + slot.period) : "";
    if (time || period) li.append(el("p", "g-slot-time", time || period));
    const labels = [];
    if (PLAN_TYPES.includes(slot.planType)) labels.push(t("type_" + slot.planType));
    if (CARD_CATEGORIES.includes(slot.cardCategory)) labels.push(t("cat_" + slot.cardCategory));
    if (time && period) labels.push(period);
    if (labels.length) li.append(el("p", "g-slot-type", labels.join(" · ")));
    const name = localized(slot, "name", locale, "slot");
    if (name) li.append(el("h3", "g-slot-name", name));

    const photo = isObject(slot.photo) ? slot.photo : null;
    if (photo) {
      const figure = el("figure", "g-photo"); figure.setAttribute("data-media-holder", "");
      const img = el("img"); img.alt = text(photo.alt); img.width = 640; img.height = 360;
      if (bindImage(img, photo.url)) {
        figure.append(img);
        const caption = el("figcaption");
        const credit = text(photo.credit);
        if (credit) caption.append(el("span", "", t("photoBy", { credit })));
        const license = text(photo.license); const licenseUrl = httpUrl(photo.licenseUrl);
        if (license || licenseUrl) { if (caption.childNodes.length) caption.append(" · "); caption.append(licenseUrl ? externalLink(licenseUrl.href, license || t("photoLicense")) : el("span", "", license)); }
        const sourceUrl = httpUrl(photo.sourceUrl);
        if (sourceUrl) { if (caption.childNodes.length) caption.append(" · "); caption.append(externalLink(sourceUrl.href, t("photoSource"))); }
        if (caption.childNodes.length) figure.append(caption);
        li.append(figure);
      }
    }
    const description = localized(slot, "description", locale, "slot");
    if (description) li.append(el("p", "g-slot-description", description));
    const notes = localized(slot, "notes", locale, "slot");
    if (notes) { const box = el("div", "g-important"); box.append(el("strong", "", t("importantNote")), el("span", "", notes)); li.append(box); }

    const address = localized(slot, "address", locale, "slot");
    const links = mapLinks({ name, address, lat: slot.lat, lng: slot.lng, googleMapsUrl: slot.googleMapsUrl, mapsUrl: slot.mapsUrl });
    if (address || links.google || links.osm) {
      const place = el("div", "g-place");
      const key = String(slot.id ?? name);
      let addressNode = null;
      if (address) {
        addressNode = el("p", "g-address");
        addressNode.append(el("span", "g-visually-hidden", t("address") + ": "), el("span", "g-address-text", address));
        place.append(addressNode);
      }
      const actions = el("div", "g-place-actions");
      const status = el("p", "g-note"); status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
      if (address) {
        const copy = el("button", "g-button g-secondary", t("copyAddress"));
        copy.type = "button"; copy.dataset.focusKey = "copy:" + key;
        copy.addEventListener("click", () => copyText(address, addressNode.querySelector(".g-address-text"), status, "addressCopied", "copyManual"));
        actions.append(copy);
      }
      const placeLabel = name || address;
      if (links.google) { const a = externalLink(links.google, t("openMap"), "g-button g-secondary g-link-button"); a.setAttribute("aria-label", t("mapLabel", { place: placeLabel, service: t("openMap") })); a.dataset.focusKey = "gmap:" + key; actions.append(a); }
      if (links.osm) { const a = externalLink(links.osm, t("openOsm"), "g-button g-secondary g-link-button"); a.setAttribute("aria-label", t("mapLabel", { place: placeLabel, service: t("openOsm") })); a.dataset.focusKey = "osm:" + key; actions.append(a); }
      place.append(actions, status);
      li.append(place);
    }
    return li;
  }

  function externalLink(href, label, className = "") {
    const a = el("a", className, label);
    a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer"; a.referrerPolicy = "no-referrer"; a.setAttribute("referrerpolicy", "no-referrer");
    return a;
  }

  function renderReminders() {
    const reminders = (Array.isArray(trip.reminders) ? trip.reminders : []).filter(isObject)
      .map((reminder, index) => ({ reminder, index }))
      .sort((a, b) => {
        const x = isIsoDate(a.reminder.dueDate) ? a.reminder.dueDate : "9999"; const y = isIsoDate(b.reminder.dueDate) ? b.reminder.dueDate : "9999";
        return x < y ? -1 : x > y ? 1 : a.index - b.index;
      });
    const ul = byId("reminder-list"); ul.replaceChildren();
    for (const { reminder } of reminders) {
      const item = localized(reminder, "item", locale, "reminder");
      if (!item) continue;
      const li = el("li", "g-reminder");
      li.append(el("p", "g-reminder-item", item));
      if (isIsoDate(reminder.dueDate)) li.append(el("p", "g-due", t("due", { date: formatDate(reminder.dueDate, "short") })));
      const notes = localized(reminder, "notes", locale, "reminder");
      if (notes) li.append(el("p", "g-reminder-notes", notes));
      ul.append(li);
    }
    byId("reminders").hidden = ul.children.length === 0;
  }

  function selectDay(index, { focusHeading = false } = {}) {
    const list = days();
    if (index < 0 || index >= list.length || index === selectedIndex && !focusHeading) return;
    selectedIndex = index; selectedDayId = list[index].id ?? null;
    for (const button of byId("day-list").querySelectorAll("button[data-day-index]")) button.setAttribute("aria-pressed", String(Number(button.dataset.dayIndex) === index));
    byId("prev-day").disabled = index <= 0; byId("next-day").disabled = index >= list.length - 1;
    renderDay();
    if (focusHeading) byId("day-heading").focus?.();
  }

  function clearTripDom() {
    pendingUpdate = null; // a held payload must never revive content after denial or a link change
    dropAllMedia();
    trip = null; fingerprint = ""; selectedIndex = -1; selectedDayId = null;
    for (const id of ["day-list", "day-info", "slots", "reminder-list"]) byId(id).replaceChildren();
    for (const id of ["trip-title", "trip-phase", "day-heading", "day-date"]) byId(id).textContent = "";
    byId("cover").hidden = true; byId("logo").hidden = true; byId("logo").alt = ""; byId("cover-img").alt = "";
    byId("stale").hidden = true; byId("share-fallback").hidden = true; byId("share-url").value = ""; byId("share-status").textContent = "";
    doc.title = t("sharedItinerary");
  }

  // ------------------------------------------------------------ copy / share (explicit clicks only)
  function selectContents(node) {
    try {
      if (node && "select" in node && typeof node.select === "function") { node.focus?.(); node.select(); return; }
      const selection = win.getSelection?.(); if (!selection || !node) return;
      const range = doc.createRange(); range.selectNodeContents(node); selection.removeAllRanges(); selection.addRange(range);
    } catch { /* selection unsupported: text remains natively selectable */ }
  }

  async function writeClipboard(value) {
    const clipboard = nav.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    try {
      let timer = null;
      const timeout = new Promise((resolve) => { timer = later(() => resolve(false), 3000); });
      const ok = await Promise.race([clipboard.writeText(value).then(() => true, () => false), timeout]);
      cancel(timer); return ok;
    } catch { return false; }
  }

  async function copyText(value, sourceNode, statusNode, okKey, manualKey) {
    const gen = contentGen;
    const ok = await writeClipboard(value);
    if (closed || gen !== contentGen || !statusNode.isConnected) return;
    if (ok) statusNode.textContent = t(okKey);
    else { selectContents(sourceNode); statusNode.textContent = t(manualKey); }
  }

  async function shareLink() {
    const status = byId("share-status");
    if (linkChanged()) { handleLinkChange(); return; } // never forward a new link from the old link's page state
    const url = win.location.href; // includes the fragment so the recipient's forwarded link works
    status.textContent = "";
    if (typeof nav.share === "function") {
      try { await nav.share({ title: t("sharedItinerary"), url }); if (!closed && !denied) status.textContent = t("linkShared"); return; }
      catch (error) { if (closed || denied) return; if (error?.name === "AbortError") return; }
    }
    const ok = await writeClipboard(url);
    if (closed || denied) return;
    if (ok) { status.textContent = t("linkCopied"); return; }
    const fallback = byId("share-fallback"); const input = byId("share-url");
    input.value = url; fallback.hidden = false; selectContents(input);
    status.textContent = t("shareManual");
  }

  // ------------------------------------------------------------ loading, refresh, retry
  function validTrip(body) {
    const data = isObject(body) ? body.trip : null;
    return isObject(data) && data.id === tripId ? data : null;
  }

  // ------------------------------------------------------------ explicit link change (new fragment)
  /** True when the address bar no longer holds the link this page was started with. */
  function linkChanged() {
    const current = parseShareLocation(win.location);
    return current.token !== token || current.tripId !== tripId;
  }

  /** Clears all content, media and requests for the old link, then reloads for the new one. */
  function handleLinkChange() {
    if (closed) return;
    pendingUpdate = null;
    clearTripDom();
    showOnly("loading"); setStatus("");
    close();
    try { reloadPage(); } catch { /* reload unavailable: the page stays empty, never showing old content */ }
  }

  // ------------------------------------------------------------ native link activation guard
  // Never handles a link itself: it does not cancel or stop events, open windows or rewrite href.
  // It only notices that a press/activation started on an <a href> and holds a *changed successful*
  // payload until that press ends, so the browser's own activation reaches the original anchor.
  function linkFromEvent(event) {
    let node = event?.target || null;
    if (node && node.nodeType === 3) node = node.parentNode;
    const link = node && typeof node.closest === "function" ? node.closest("a[href]") : null;
    return link && byId("trip")?.contains(link) ? link : null;
  }
  function pressBegin(link) {
    pressActive = true; pressLink = link;
    pressEndTimer = cancel(pressEndTimer);
    pressHoldTimer = cancel(pressHoldTimer);
    pressHoldTimer = later(pressEnd, config.linkMaxHoldMs);
  }
  function pressFinishSoon(ms) {
    if (!pressActive) return;
    pressEndTimer = cancel(pressEndTimer);
    pressEndTimer = later(pressEnd, ms);
  }
  function pressEnd() {
    pressEndTimer = cancel(pressEndTimer); pressHoldTimer = cancel(pressHoldTimer);
    pressActive = false; pressLink = null;
    applyPending();
  }
  function applyPending() {
    const update = pendingUpdate; pendingUpdate = null;
    if (!update || closed || denied || !trip) return; // denial/close already cleared; never revive
    if (linkChanged()) { handleLinkChange(); return; }
    commit(update.data, update.next);
  }

  async function load(reason) {
    if (closed) return;
    if (linkChanged()) { handleLinkChange(); return; } // never send the old capability under a new link
    if (denied && reason !== "manual") return;      // a closed link is not polled again automatically
    if (inFlight) return;                            // one request at a time
    retryTimer = cancel(retryTimer);
    const seq = ++requestSeq;
    const controller = new AbortCtl();
    inFlight = { seq, controller };
    lastAttemptAt = Date.now();
    setBusy(true);
    if (trip) setStatus("statusChecking");
    else if (reason === "manual") { showOnly("loading"); setStatus(""); }
    const timeout = later(() => controller.abort(), config.requestTimeoutMs);
    let result;
    try {
      const response = await fetchImpl(tripPath, {
        method: "GET", headers: { "X-Trip-Share": token, Accept: "application/json" }, credentials: "omit",
        cache: "no-store", referrerPolicy: "no-referrer", redirect: "error", mode: "same-origin", signal: controller.signal
      });
      if (response.status === 200) {
        const data = validTrip(await readCappedJson(response, config.maxTripBytes));
        result = data ? { kind: "ok", data } : { kind: "transient" };
      } else if (DENIED_STATUSES.has(response.status)) result = { kind: "denied" };
      else {
        const header = Number(response.headers?.get?.("retry-after"));
        result = { kind: "transient", retryAfterMs: Number.isFinite(header) && header > 0 ? Math.min(header * 1000, config.maxRetryAfterMs) : 0 };
      }
    } catch { result = { kind: "transient" }; } finally { cancel(timeout); }
    if (closed || !inFlight || inFlight.seq !== seq) return; // late result after close
    inFlight = null;
    setBusy(false);
    if (linkChanged()) { handleLinkChange(); return; } // result belongs to the old link: discard it
    if (result.kind === "ok") accept(result.data);
    else if (result.kind === "denied") deny();
    else fail(result.retryAfterMs || 0);
  }

  function accept(data) {
    denied = false; failures = 0; lastSuccessAt = Date.now();
    const next = JSON.stringify(data);
    byId("stale").hidden = true;
    if (next === fingerprint && trip) { pendingUpdate = null; setStatus("statusChecked", now()); schedulePoll(); return; }
    if (trip && pressActive) {
      // A link is being pressed/activated: keep the current anchors until the press ends (latest payload wins).
      pendingUpdate = { data, next };
      schedulePoll();
      return;
    }
    commit(data, next);
    schedulePoll();
  }

  function commit(data, next) {
    pendingUpdate = null;
    const first = !trip;
    trip = data; fingerprint = next; contentGen += 1;
    renderTrip({ preserveScroll: !first }); // keeps the chosen day, scroll position and focused control
    showOnly("trip");
    setStatus("statusUpdated", now());
  }

  function deny() {
    // Definitive denial (revoked, rotated, expired, invalid, archived or deleted): hide everything now,
    // even during a link press; any held payload is dropped and can never be applied later.
    pendingUpdate = null;
    denied = true; failures = 0;
    retryTimer = cancel(retryTimer); pollTimer = cancel(pollTimer);
    clearTripDom();
    showOnly("denied"); setStatus("");
    byId("denied-title").focus?.();
  }

  function fail(retryAfterMs) {
    failures += 1;
    const willRetry = failures <= config.retryDelaysMs.length;
    if (trip) { byId("stale").hidden = false; showOnly("trip"); }
    else { showOnly("error"); }
    setStatus(willRetry ? "statusRetrying" : "statusFailed", now());
    if (willRetry) {
      const base = config.retryDelaysMs[failures - 1];
      const jitter = Math.floor(Math.random() * Math.min(1000, base / 4));
      retryTimer = later(() => { retryTimer = null; load("retry"); }, Math.max(base + jitter, retryAfterMs));
    } else schedulePoll();
  }

  function schedulePoll() {
    pollTimer = cancel(pollTimer);
    if (closed || denied || polls >= config.maxPolls) return;
    pollTimer = later(() => {
      pollTimer = null;
      if (doc.visibilityState === "hidden") { schedulePoll(); return; } // no request while hidden
      polls += 1; load("poll");
    }, config.pollMs);
  }

  function lifecycleRefresh(reason) {
    if (closed || denied || inFlight) return;
    if (reason !== "online" && failures === 0 && trip && Date.now() - lastSuccessAt < config.lifecycleGapMs) return;
    if (reason === "online") failures = 0; // the network came back: allow a fresh bounded retry streak
    load(reason);
  }

  /**
   * Explicit "Check for updates": one request at a time (presses while a request is in flight are
   * deduplicated), a fresh bounded retry streak, and the reader's day/scroll are preserved.
   */
  function manualRefresh() {
    if (closed || inFlight) return;
    failures = 0;
    load("manual");
  }

  // ------------------------------------------------------------ wiring
  function close() {
    if (closed) return;
    closed = true;
    pendingUpdate = null; pressActive = false; pressLink = null;
    inFlight?.controller.abort(); inFlight = null;
    for (const id of [...timers]) cancel(id);
    for (const [target, type, fn, opts] of listeners) target.removeEventListener(type, fn, opts);
    listeners.length = 0;
    dropAllMedia();
  }

  listen(byId("language"), "change", (event) => {
    const value = event.target.value;
    if (!GUEST_LOCALES.includes(value) || value === locale) return;
    locale = value; applyStaticText();
    if (trip && !denied) renderTrip({ preserveScroll: true });
  });
  listen(byId("day-list"), "click", (event) => {
    const button = event.target.closest?.("button[data-day-index]");
    if (button) selectDay(Number(button.dataset.dayIndex), { focusHeading: true });
  });
  listen(byId("prev-day"), "click", () => selectDay(selectedIndex - 1));
  listen(byId("next-day"), "click", () => selectDay(selectedIndex + 1));
  for (const id of ["retry", "stale-retry", "denied-retry"]) listen(byId(id), "click", () => { failures = 0; load("manual"); });
  listen(byId("check-updates"), "click", () => manualRefresh());
  listen(byId("share-button"), "click", () => { shareLink(); });

  // Link activation guard: passive capture listeners that only observe; the browser handles the link.
  const observe = { capture: true, passive: true };
  const onPress = (event) => { const link = linkFromEvent(event); if (link) pressBegin(link); };
  const onActivated = () => pressFinishSoon(config.linkSettleMs);
  const onRelease = () => pressFinishSoon(config.linkReleaseMs);
  for (const type of ["pointerdown", "mousedown", "touchstart"]) listen(doc, type, onPress, observe);
  for (const type of ["click", "auxclick", "contextmenu", "dragstart", "pointercancel", "touchcancel"]) listen(doc, type, onActivated, observe);
  for (const type of ["pointerup", "mouseup", "touchend"]) listen(doc, type, onRelease, observe);
  listen(doc, "keydown", (event) => { if (event.key === "Enter") { const link = linkFromEvent(event); if (link) pressBegin(link); } }, observe);
  listen(doc, "keyup", (event) => { if (event.key === "Enter") onRelease(); }, observe);
  // Lost focus (focus moved away from the pressed link, or the window lost focus) ends the press.
  listen(doc, "focusout", (event) => { if (pressActive && (!pressLink || event.target === pressLink)) onActivated(); }, observe);
  listen(win, "blur", onActivated);

  // A new fragment on the same /s/<id> page is an explicit link change: clear and reload.
  listen(win, "hashchange", () => { if (linkChanged()) handleLinkChange(); });
  listen(win, "focus", () => lifecycleRefresh("focus"));
  listen(win, "online", () => lifecycleRefresh("online"));
  listen(win, "pageshow", (event) => { if (event.persisted) lifecycleRefresh("pageshow"); });
  listen(doc, "visibilitychange", () => { if (doc.visibilityState !== "hidden") lifecycleRefresh("visible"); });

  applyStaticText();
  if (!tripId || !token) { denied = true; showOnly("denied"); }
  else { showOnly("loading"); load("initial"); }

  return {
    close,
    refresh: () => manualRefresh(),
    get state() {
      return {
        closed, denied, failures, polls, locale, selectedIndex, selectedDayId, hasTrip: Boolean(trip), inFlight: Boolean(inFlight),
        blobCount: blobs.size, blobBytes: blobBytes(), timerCount: timers.size, pressActive, pendingUpdate: Boolean(pendingUpdate)
      };
    }
  };
}

if (typeof document !== "undefined" && typeof window !== "undefined" && !globalThis.SHARED_TRIP_GUEST_NO_AUTOSTART && document.getElementById("day-list")) {
  startGuestPage({ window });
}
