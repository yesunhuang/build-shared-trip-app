// Explicit place and photo matching for the self-hosted plan editor.
//
// Nothing in this module sends a request by itself. The editor calls a lookup
// controller only from an explicit Search or Refresh action, and every response
// is checked against the request generation that produced it so a late answer
// can never change a different (or closed) plan editor.
//
// Saved place:  plan.place = {provider:"openstreetmap", id:"node/123", name, address,
//                lat, lng, sourceUrl, attribution, license:"ODbL-1.0", selectedAt}
//               with lat/lng/address mirrored onto the plan.
// Saved photo:  plan.photo = {provider:"wikimedia-commons", url, sourceUrl, credit,
//                author, license, licenseUrl, selectedAt}
// All provider text is rendered with textContent by the caller, never as HTML.

export const PLACE_PROVIDER = "openstreetmap";
export const PHOTO_PROVIDER = "wikimedia-commons";
export const PLACE_LICENSE = "ODbL-1.0";
export const OSM_COPYRIGHT_URL = "https://www.openstreetmap.org/copyright";
export const DEFAULT_PLACE_ATTRIBUTION = "© OpenStreetMap contributors";
export const MAX_QUERY_LENGTH = 200;
export const MAX_RESULTS = 10;

const OSM_ID = /^(?:node|way|relation)\/[1-9]\d{0,15}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const STRINGS = {
  en: {
    placeSectionTitle: "Find the place",
    placeSectionHint: "Search for a public place name, then choose the right match to put this plan on the map.",
    placePrivacyNote: "Searching sends only the name you type to OpenStreetMap, an outside public map service. Don’t type booking details, people’s names or private notes.",
    placeSearchLabel: "Public place name",
    placeSearchPlaceholder: "For example: Riverside Botanical Garden",
    search: "Search",
    refreshResults: "Refresh results",
    searching: "Searching…",
    typeQueryFirst: "Type a name to search.",
    placeResultsCount: "Places found: {count}. Choose the right one.",
    placeNoResults: "No matching places. Try a shorter or different name.",
    cachedResults: "These are recently saved results. Choose Refresh results to search again.",
    useThisPlace: "Use this place",
    chosen: "Chosen",
    placeSelectedPending: "Place chosen. Save the plan to keep it.",
    savedPlace: "Saved place",
    selectedPlace: "Chosen place",
    currentLocation: "Current location",
    noLocation: "No location yet. This plan stays on the timeline only.",
    clearLocation: "Clear location",
    locationCleared: "The location will be removed when you save.",
    viewOnOpenStreetMap: "View on OpenStreetMap",
    placeDataCredit: "Place data © OpenStreetMap contributors (ODbL)",
    coordinatesLabel: "Coordinates",
    orPasteGoogle: "Or paste a full Google Maps link below.",
    usingGoogleLink: "The Google Maps link below sets this plan’s location.",
    lookupDisabled: "Place and photo search isn’t turned on for this site. You can still paste a full Google Maps link.",
    lookupNetwork: "Couldn’t reach the server. Check your connection and try again.",
    lookupForbidden: "You can no longer edit this trip, so search is unavailable.",
    lookupBusy: "Too many searches right now. Wait a moment and try again.",
    lookupInvalid: "Check the words you typed and try again.",
    lookupFailed: "Search didn’t work. Please try again.",
    photoSectionTitle: "Representative photo",
    photoSectionHint: "Optional. Search Wikimedia Commons and choose a freely licensed photo. It may not show this exact spot.",
    photoPrivacyNote: "Searching sends only the words you type to Wikimedia Commons, an outside public photo library.",
    photoSearchLabel: "Photo search words",
    photoSearchPlaceholder: "For example: botanical garden greenhouse",
    photoResultsCount: "Photos found: {count}. Choose one, or leave the plan without a photo.",
    photoNoResults: "No photos found. Try different words.",
    useThisPhoto: "Use this photo",
    photoSelectedPending: "Photo chosen. Save the plan to keep it.",
    currentPhoto: "Current photo",
    selectedPhoto: "Chosen photo",
    noPhoto: "No photo.",
    removePhoto: "Remove photo",
    photoRemoved: "The photo will be removed when you save.",
    photoBy: "Photo: {author}",
    photoLicense: "License: {license}",
    photoSource: "Source",
    representativePhotoLabel: "Representative photo",
    previewUnavailable: "Preview unavailable",
    locationSourceLabel: "Location"
  },
  "zh-Hans": {
    placeSectionTitle: "查找地点",
    placeSectionHint: "搜索公开的地点名称，然后选择正确的结果，把这项计划放到地图上。",
    placePrivacyNote: "搜索时只会把你输入的名称发送给外部公共地图服务 OpenStreetMap。请不要输入预订信息、人名或私人备注。",
    placeSearchLabel: "公开地点名称",
    placeSearchPlaceholder: "例如：河畔植物园",
    search: "搜索",
    refreshResults: "刷新结果",
    searching: "正在搜索…",
    typeQueryFirst: "请先输入要搜索的名称。",
    placeResultsCount: "找到 {count} 个地点，请选择正确的一个。",
    placeNoResults: "没有找到匹配的地点。请尝试更短或不同的名称。",
    cachedResults: "这些是最近保存的结果。选择“刷新结果”可重新搜索。",
    useThisPlace: "使用此地点",
    chosen: "已选择",
    placeSelectedPending: "已选择地点。保存计划后才会生效。",
    savedPlace: "已保存的地点",
    selectedPlace: "已选择的地点",
    currentLocation: "当前位置",
    noLocation: "尚未设置位置。此计划只显示在时间线上。",
    clearLocation: "清除位置",
    locationCleared: "保存后将移除位置。",
    viewOnOpenStreetMap: "在 OpenStreetMap 上查看",
    placeDataCredit: "地点数据 © OpenStreetMap 贡献者（ODbL）",
    coordinatesLabel: "坐标",
    orPasteGoogle: "也可以在下方粘贴完整的 Google 地图链接。",
    usingGoogleLink: "将使用下方的 Google 地图链接设置此计划的位置。",
    lookupDisabled: "此网站未开启地点和照片搜索。你仍可粘贴完整的 Google 地图链接。",
    lookupNetwork: "无法连接到服务器。请检查网络后重试。",
    lookupForbidden: "你已无法编辑此旅行，因此无法搜索。",
    lookupBusy: "搜索次数过多。请稍等片刻再试。",
    lookupInvalid: "请检查输入的内容后重试。",
    lookupFailed: "搜索未成功。请重试。",
    photoSectionTitle: "代表照片",
    photoSectionHint: "可选。搜索 Wikimedia Commons 并选择一张自由授权的照片。照片不一定是这个确切位置。",
    photoPrivacyNote: "搜索时只会把你输入的词发送给外部公共图库 Wikimedia Commons。",
    photoSearchLabel: "照片搜索词",
    photoSearchPlaceholder: "例如：植物园温室",
    photoResultsCount: "找到 {count} 张照片。可以选择一张，也可以不加照片。",
    photoNoResults: "没有找到照片。请尝试其他词语。",
    useThisPhoto: "使用此照片",
    photoSelectedPending: "已选择照片。保存计划后才会生效。",
    currentPhoto: "当前照片",
    selectedPhoto: "已选择的照片",
    noPhoto: "没有照片。",
    removePhoto: "移除照片",
    photoRemoved: "保存后将移除照片。",
    photoBy: "照片：{author}",
    photoLicense: "许可：{license}",
    photoSource: "来源",
    representativePhotoLabel: "代表照片",
    previewUnavailable: "无法预览",
    locationSourceLabel: "位置"
  },
  "zh-Hant": {
    placeSectionTitle: "尋找地點",
    placeSectionHint: "搜尋公開的地點名稱，再選擇正確的結果，把這項計畫放到地圖上。",
    placePrivacyNote: "搜尋時只會把你輸入的名稱傳送給外部公共地圖服務 OpenStreetMap。請勿輸入訂位資料、人名或私人備註。",
    placeSearchLabel: "公開地點名稱",
    placeSearchPlaceholder: "例如：河畔植物園",
    search: "搜尋",
    refreshResults: "重新整理結果",
    searching: "正在搜尋…",
    typeQueryFirst: "請先輸入要搜尋的名稱。",
    placeResultsCount: "找到 {count} 個地點，請選擇正確的一個。",
    placeNoResults: "找不到相符的地點。請嘗試較短或不同的名稱。",
    cachedResults: "這些是最近儲存的結果。選擇「重新整理結果」可重新搜尋。",
    useThisPlace: "使用此地點",
    chosen: "已選擇",
    placeSelectedPending: "已選擇地點。儲存計畫後才會生效。",
    savedPlace: "已儲存的地點",
    selectedPlace: "已選擇的地點",
    currentLocation: "目前位置",
    noLocation: "尚未設定位置。此計畫只會顯示在時間軸上。",
    clearLocation: "清除位置",
    locationCleared: "儲存後將移除位置。",
    viewOnOpenStreetMap: "在 OpenStreetMap 上查看",
    placeDataCredit: "地點資料 © OpenStreetMap 貢獻者（ODbL）",
    coordinatesLabel: "座標",
    orPasteGoogle: "也可以在下方貼上完整的 Google 地圖連結。",
    usingGoogleLink: "將使用下方的 Google 地圖連結設定此計畫的位置。",
    lookupDisabled: "此網站未開啟地點與照片搜尋。你仍可貼上完整的 Google 地圖連結。",
    lookupNetwork: "無法連線到伺服器。請檢查網路後再試一次。",
    lookupForbidden: "你已無法編輯此旅行，因此無法搜尋。",
    lookupBusy: "搜尋次數過多。請稍候再試。",
    lookupInvalid: "請檢查輸入的內容後再試一次。",
    lookupFailed: "搜尋未成功。請再試一次。",
    photoSectionTitle: "代表照片",
    photoSectionHint: "可選。搜尋 Wikimedia Commons 並選擇一張自由授權的照片。照片不一定是這個確切位置。",
    photoPrivacyNote: "搜尋時只會把你輸入的字詞傳送給外部公共圖庫 Wikimedia Commons。",
    photoSearchLabel: "照片搜尋字詞",
    photoSearchPlaceholder: "例如：植物園溫室",
    photoResultsCount: "找到 {count} 張照片。可以選擇一張，也可以不加照片。",
    photoNoResults: "找不到照片。請嘗試其他字詞。",
    useThisPhoto: "使用此照片",
    photoSelectedPending: "已選擇照片。儲存計畫後才會生效。",
    currentPhoto: "目前照片",
    selectedPhoto: "已選擇的照片",
    noPhoto: "沒有照片。",
    removePhoto: "移除照片",
    photoRemoved: "儲存後將移除照片。",
    photoBy: "照片：{author}",
    photoLicense: "授權：{license}",
    photoSource: "來源",
    representativePhotoLabel: "代表照片",
    previewUnavailable: "無法預覽",
    locationSourceLabel: "位置"
  },
  ja: {
    placeSectionTitle: "場所を探す",
    placeSectionHint: "公開されている場所の名前で検索し、正しい候補を選ぶとこの予定が地図に表示されます。",
    placePrivacyNote: "検索すると、入力した名前だけが外部の公開地図サービス OpenStreetMap に送信されます。予約情報、人の名前、個人的なメモは入力しないでください。",
    placeSearchLabel: "公開されている場所の名前",
    placeSearchPlaceholder: "例：リバーサイド植物園",
    search: "検索",
    refreshResults: "結果を更新",
    searching: "検索しています…",
    typeQueryFirst: "検索する名前を入力してください。",
    placeResultsCount: "{count}件の場所が見つかりました。正しいものを選んでください。",
    placeNoResults: "一致する場所が見つかりません。短い名前や別の名前で試してください。",
    cachedResults: "最近保存された結果です。「結果を更新」を選ぶと再検索します。",
    useThisPlace: "この場所を使う",
    chosen: "選択済み",
    placeSelectedPending: "場所を選びました。予定を保存すると反映されます。",
    savedPlace: "保存済みの場所",
    selectedPlace: "選んだ場所",
    currentLocation: "現在の場所",
    noLocation: "場所はまだありません。この予定は旅程にのみ表示されます。",
    clearLocation: "場所を削除",
    locationCleared: "保存すると場所が削除されます。",
    viewOnOpenStreetMap: "OpenStreetMap で見る",
    placeDataCredit: "場所データ © OpenStreetMap 寄稿者（ODbL）",
    coordinatesLabel: "座標",
    orPasteGoogle: "または、下に Google マップの完全なリンクを貼り付けてください。",
    usingGoogleLink: "下の Google マップのリンクでこの予定の場所を設定します。",
    lookupDisabled: "このサイトでは場所と写真の検索が有効になっていません。Google マップの完全なリンクは引き続き貼り付けられます。",
    lookupNetwork: "サーバーに接続できませんでした。接続を確認してもう一度お試しください。",
    lookupForbidden: "この旅行を編集できなくなったため、検索は利用できません。",
    lookupBusy: "検索が集中しています。少し待ってからもう一度お試しください。",
    lookupInvalid: "入力内容を確認して、もう一度お試しください。",
    lookupFailed: "検索できませんでした。もう一度お試しください。",
    photoSectionTitle: "イメージ写真",
    photoSectionHint: "任意です。Wikimedia Commons で検索し、自由に利用できるライセンスの写真を選んでください。この場所そのものではない場合があります。",
    photoPrivacyNote: "検索すると、入力した言葉だけが外部の公開写真ライブラリ Wikimedia Commons に送信されます。",
    photoSearchLabel: "写真の検索語",
    photoSearchPlaceholder: "例：植物園 温室",
    photoResultsCount: "{count}件の写真が見つかりました。1枚選ぶか、写真なしのままにできます。",
    photoNoResults: "写真が見つかりません。別の言葉で試してください。",
    useThisPhoto: "この写真を使う",
    photoSelectedPending: "写真を選びました。予定を保存すると反映されます。",
    currentPhoto: "現在の写真",
    selectedPhoto: "選んだ写真",
    noPhoto: "写真はありません。",
    removePhoto: "写真を削除",
    photoRemoved: "保存すると写真が削除されます。",
    photoBy: "写真：{author}",
    photoLicense: "ライセンス：{license}",
    photoSource: "出典",
    representativePhotoLabel: "イメージ写真",
    previewUnavailable: "プレビューを表示できません",
    locationSourceLabel: "場所"
  }
};

export const PICKER_LANGUAGES = Object.freeze(Object.keys(STRINGS));
export const PICKER_KEYS = Object.freeze(Object.keys(STRINGS.en));

export function pickerText(language, key, variables = {}) {
  const template = STRINGS[language]?.[key] ?? STRINGS.en[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(variables[name] ?? ""));
}

export function cleanText(value, max = 300) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Only absolute http(s) URLs without credentials are kept.
export function safeHttpUrl(value, { hosts = null } = {}) {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return "";
  let url;
  try { url = new URL(value.trim()); } catch { return ""; }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
  if (hosts && !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return "";
  return url.href;
}

function finiteCoordinate(value, limit) {
  if (typeof value === "string" && !value.trim()) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** A provider place candidate or a saved plan.place, sanitised; null when unusable. */
export function normalizePlaceCandidate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.provider !== PLACE_PROVIDER) return null;
  const id = String(raw.id || "");
  if (!OSM_ID.test(id)) return null;
  const lat = finiteCoordinate(raw.lat, 90);
  const lng = finiteCoordinate(raw.lng, 180);
  if (lat === null || lng === null) return null;
  const name = cleanText(raw.name, 200);
  const address = cleanText(raw.address, 500);
  if (!name && !address) return null;
  return {
    provider: PLACE_PROVIDER,
    id,
    name: name || address,
    address,
    lat,
    lng,
    sourceUrl: safeHttpUrl(raw.sourceUrl, { hosts: ["openstreetmap.org"] }) || `https://www.openstreetmap.org/${id}`,
    attribution: cleanText(raw.attribution, 300) || DEFAULT_PLACE_ATTRIBUTION,
    license: PLACE_LICENSE
  };
}

/** A provider photo candidate or a saved plan.photo, sanitised; null when unusable. */
export function normalizePhotoCandidate(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.provider !== PHOTO_PROVIDER) return null;
  const url = safeHttpUrl(raw.url, { hosts: ["wikimedia.org"] });
  const sourceUrl = safeHttpUrl(raw.sourceUrl, { hosts: ["wikimedia.org"] });
  const license = cleanText(raw.license, 120);
  if (!url || !sourceUrl || !license) return null;
  const author = cleanText(raw.author, 300);
  const credit = cleanText(raw.credit, 500) || [author, license].filter(Boolean).join(" · ");
  const photo = { provider: PHOTO_PROVIDER, url, sourceUrl, credit, author, license };
  const licenseUrl = safeHttpUrl(raw.licenseUrl);
  if (licenseUrl) photo.licenseUrl = licenseUrl;
  const thumbnailUrl = safeHttpUrl(raw.thumbnailUrl, { hosts: ["wikimedia.org"] });
  if (thumbnailUrl) photo.thumbnailUrl = thumbnailUrl;
  const title = cleanText(raw.title, 200);
  if (title) photo.title = title;
  return photo;
}

function selectedAtValue(raw) {
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

/** The exact object stored on plan.place after an explicit choice. */
export function placeForSaving(candidate, now = new Date()) {
  const place = normalizePlaceCandidate(candidate);
  if (!place) return null;
  return { ...place, selectedAt: now.toISOString() };
}

/** The exact object stored on plan.photo after an explicit choice (no preview-only fields). */
export function photoForSaving(candidate, now = new Date()) {
  const photo = normalizePhotoCandidate(candidate);
  if (!photo) return null;
  const saved = {
    provider: photo.provider,
    url: photo.url,
    sourceUrl: photo.sourceUrl,
    credit: photo.credit,
    author: photo.author,
    license: photo.license
  };
  if (photo.licenseUrl) saved.licenseUrl = photo.licenseUrl;
  Object.keys(saved).forEach((key) => { if (saved[key] === "") delete saved[key]; });
  saved.selectedAt = now.toISOString();
  return saved;
}

export function readSavedPlace(value) {
  const place = normalizePlaceCandidate(value);
  if (!place) return null;
  const selectedAt = selectedAtValue(value.selectedAt);
  return selectedAt ? { ...place, selectedAt } : place;
}

export function readSavedPhoto(value) {
  const photo = normalizePhotoCandidate(value);
  if (!photo) return null;
  delete photo.thumbnailUrl;
  const selectedAt = selectedAtValue(value.selectedAt);
  return selectedAt ? { ...photo, selectedAt } : photo;
}

export function formatCoordinate(value) {
  return Number(value).toFixed(5).replace(/\.?0+$/, "");
}

// A user-triggered Google Maps link that opens the saved coordinates. It never
// claims a Google place identifier.
export function coordinateGoogleMapsUrl(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${formatCoordinate(lat)},${formatCoordinate(lng)}`)}`;
}

export function normalizeQuery(value) {
  return cleanText(value, MAX_QUERY_LENGTH);
}

/** Maps a failed lookup to a traveler-facing message key. */
export function lookupErrorKey(error) {
  const status = Number(error?.status);
  const code = String(error?.code || "").toLowerCase();
  if (status === 0 || ["network", "timeout", "lookup_timeout", "lookup_unavailable"].includes(code)) return "lookupNetwork";
  if (status === 403) return "lookupForbidden";
  if (status === 429 || code === "lookup_busy") return "lookupBusy";
  if (status === 501 || /disabled|not_configured|not_enabled/.test(code)) return "lookupDisabled";
  if (status === 400 || status === 422) return "lookupInvalid";
  return "lookupFailed";
}

/**
 * Explicit, generation-guarded lookup state for one kind ("place" or "photo")
 * inside one editor session. request(query, refresh) must return the server
 * payload {results:[], cached:boolean}. onChange(state) re-renders the panel.
 */
export function createLookupController({ request, normalize, onChange }) {
  let generation = 0;
  let disposed = false;
  const state = {
    status: "idle",
    lastQuery: "",
    results: [],
    cached: false,
    errorKey: "",
    errorDetail: "",
    error: null,
    forbidden: false
  };
  const emit = () => { if (!disposed) onChange?.(state); };

  async function run(rawQuery, { refresh = false } = {}) {
    if (disposed || state.status === "loading" || state.forbidden) return false;
    const query = normalizeQuery(rawQuery);
    if (!query) {
      state.status = "error";
      state.errorKey = "typeQueryFirst";
      state.errorDetail = "";
      state.error = null;
      emit();
      return false;
    }
    const ticket = ++generation;
    state.status = "loading";
    state.errorKey = "";
    state.errorDetail = "";
    state.error = null;
    emit();
    try {
      const payload = await request(query, refresh === true);
      if (disposed || ticket !== generation) return false;
      const raw = Array.isArray(payload?.results) ? payload.results : [];
      state.results = raw.map(normalize).filter(Boolean).slice(0, MAX_RESULTS);
      state.cached = payload?.cached === true;
      state.lastQuery = query;
      state.status = "done";
      emit();
      return true;
    } catch (error) {
      if (disposed || ticket !== generation) return false;
      state.status = "error";
      state.error = error;
      state.errorKey = lookupErrorKey(error);
      state.errorDetail = ["lookupDisabled", "lookupInvalid", "lookupFailed"].includes(state.errorKey)
        ? cleanText(error?.message, 200)
        : "";
      if (state.errorKey === "lookupForbidden") state.forbidden = true;
      // Earlier results and the chosen item stay available after a failure.
      if (!state.lastQuery) state.lastQuery = query;
      emit();
      return false;
    }
  }

  return {
    state,
    search: (query) => run(query),
    refresh: () => run(state.lastQuery, { refresh: true }),
    get generation() { return generation; },
    get disposed() { return disposed; },
    dispose() { disposed = true; generation += 1; }
  };
}
