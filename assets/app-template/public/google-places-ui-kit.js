// Optional Google Places UI Kit integration for the self-hosted trip page.
//
// Inert by default. Importing this module does nothing: no request, no script, no element. The
// trip page creates a loader only when the signed-in session advertises the feature
// (features.googlePlacesUiKit, present only when the operator enabled it with a browser key),
// and the loader contacts nothing until a plan actually needs a Google component.
//
// Only STANDARD components are created (Places UI Kit "Query (Essentials)" usage):
//   <gmp-place-details-compact orientation="vertical">
//     <gmp-place-details-place-request place="PLACE_ID"></gmp-place-details-place-request>
//     <gmp-place-content-config>
//       <gmp-place-media></gmp-place-media><gmp-place-address></gmp-place-address>
//       <gmp-place-attribution></gmp-place-attribution>
//     </gmp-place-content-config>
//   </gmp-place-details-compact>
//   <gmp-place-search selectable>
//     <gmp-place-text-search-request text-query="USER_PUBLIC_VENUE_QUERY" max-result-count="5">
//     </gmp-place-text-search-request>
//     <gmp-place-content-config>…address, attribution…</gmp-place-content-config>
//   </gmp-place-search>
// Never: Advanced* elements, a Google map, the raw Places API, Place.fetchFields, Place Photos or
// Autocomplete. This code never opens a component's shadow DOM, never reads its images, and from a
// selection event reads only place.id. The components render Google's own content and attribution
// inside the page and may make their own network requests to Google; nothing they show is copied
// into trip data, storage, exports, logs or map markers.

import { isGooglePlaceId } from "./google-place-association.js?v=__CACHE_VERSION__";

export const MAPS_JS_URL = "https://maps.googleapis.com/maps/api/js";
export const READY_CALLBACK = "__sharedTripGooglePlacesReady";
export const STANDARD_ELEMENTS = Object.freeze({
  details: "gmp-place-details-compact",
  detailsRequest: "gmp-place-details-place-request",
  contentConfig: "gmp-place-content-config",
  media: "gmp-place-media",
  address: "gmp-place-address",
  attribution: "gmp-place-attribution",
  search: "gmp-place-search",
  textSearchRequest: "gmp-place-text-search-request"
});
export const STANDARD_TAGS = Object.freeze(new Set(Object.values(STANDARD_ELEMENTS)));
export const LIBRARY_TIMEOUT_MS = 15000;
export const COMPONENT_TIMEOUT_MS = 15000;
export const MAX_RETAINED_DETAILS = 3;
export const SEARCH_RESULT_LIMIT = 5;
export const VENUE_QUERY_MIN = 2;
export const VENUE_QUERY_MAX = 120;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

// ---------------------------------------------------------------------------------------------
// Traveler-facing copy (four languages)

const STRINGS = {
  en: {
    sectionTitle: "Google place details",
    sectionHint: "Optional. Link this plan to a public business or landmark on Google. When someone opens the plan, Google shows its details and photos here.",
    linked: "Linked to a Google place.",
    notLinked: "Not linked to a Google place.",
    needsLocation: "Add a location first. Only a plan with a location can be linked to a Google place.",
    staleLink: "The location changed, so the earlier Google link will be removed when you save.",
    removedPending: "The Google link will be removed when you save.",
    chosenPending: "Google place chosen. Save the plan to keep it.",
    findOnGoogle: "Find on Google",
    chooseDifferent: "Choose a different Google place",
    removeLink: "Remove Google link",
    queryLabel: "Public business or landmark name",
    queryPlaceholder: "For example: Riverside Botanical Garden",
    privacyNote: "Only the words you type here are sent to Google. Don’t type booking details, people’s names, home addresses or private notes.",
    publicVenueLabel: "This is a public business or landmark, not a private home or address.",
    needPublicVenue: "Tick the box to confirm that this is a public business or landmark.",
    searchGoogle: "Search on Google",
    searching: "Searching Google…",
    chooseResult: "Choose the exact place in the Google list. Nothing is linked until you pick one.",
    searchFailed: "Google search isn’t available right now. Please try again later.",
    queryTooShort: "Type the name of a public business or landmark.",
    queryTooLong: "Use a shorter name (up to 120 characters).",
    queryPrivate: "Search for a public name only, without email addresses or long numbers.",
    placeIdLabel: "Or paste a Google Maps link with a place ID",
    placeIdPlaceholder: "https://www.google.com/maps/search/?api=1&query=…&query_place_id=…",
    showPlace: "Show this place",
    placeIdInvalid: "That link doesn’t include a Google place ID.",
    previewLoading: "Loading the Google place…",
    previewReady: "Check that this is the right place, then choose Use this place.",
    usePlace: "Use this place",
    detailsRegion: "Place details from Google",
    detailsLoading: "Loading Google place details…",
    detailsUnavailable: "Google place details aren’t available right now.",
    tryAgain: "Try again",
    showDetails: "Show Google place details",
    cancelSearch: "Stop searching"
  },
  "zh-Hans": {
    sectionTitle: "Google 地点详情",
    sectionHint: "可选。把这项计划关联到 Google 上的公开商家或地标。有人打开这项计划时，这里会显示 Google 提供的详情和照片。",
    linked: "已关联 Google 地点。",
    notLinked: "尚未关联 Google 地点。",
    needsLocation: "请先添加位置。只有设置了位置的计划才能关联 Google 地点。",
    staleLink: "位置已更改，保存后将移除之前的 Google 关联。",
    removedPending: "保存后将移除 Google 关联。",
    chosenPending: "已选择 Google 地点。保存计划后才会生效。",
    findOnGoogle: "在 Google 上查找",
    chooseDifferent: "选择其他 Google 地点",
    removeLink: "移除 Google 关联",
    queryLabel: "公开商家或地标名称",
    queryPlaceholder: "例如：河畔植物园",
    privacyNote: "只有你在这里输入的文字会发送给 Google。请不要输入预订信息、人名、住址或私人备注。",
    publicVenueLabel: "这是公开的商家或地标，不是私人住宅或地址。",
    needPublicVenue: "请勾选此项，确认这是公开的商家或地标。",
    searchGoogle: "在 Google 上搜索",
    searching: "正在搜索 Google…",
    chooseResult: "请在 Google 列表中选择确切的地点。选择之前不会建立任何关联。",
    searchFailed: "Google 搜索暂时不可用。请稍后再试。",
    queryTooShort: "请输入公开商家或地标的名称。",
    queryTooLong: "请使用较短的名称（最多 120 个字符）。",
    queryPrivate: "只搜索公开名称，不要包含电子邮件地址或长串数字。",
    placeIdLabel: "也可以粘贴包含地点 ID 的 Google 地图链接",
    placeIdPlaceholder: "https://www.google.com/maps/search/?api=1&query=…&query_place_id=…",
    showPlace: "显示此地点",
    placeIdInvalid: "该链接不包含 Google 地点 ID。",
    previewLoading: "正在加载 Google 地点…",
    previewReady: "请确认这是正确的地点，然后选择“使用此地点”。",
    usePlace: "使用此地点",
    detailsRegion: "来自 Google 的地点详情",
    detailsLoading: "正在加载 Google 地点详情…",
    detailsUnavailable: "暂时无法显示 Google 地点详情。",
    tryAgain: "重试",
    showDetails: "显示 Google 地点详情",
    cancelSearch: "停止搜索"
  },
  "zh-Hant": {
    sectionTitle: "Google 地點詳情",
    sectionHint: "可選。把這項計畫連結到 Google 上的公開商家或地標。有人開啟這項計畫時，這裡會顯示 Google 提供的詳情與照片。",
    linked: "已連結 Google 地點。",
    notLinked: "尚未連結 Google 地點。",
    needsLocation: "請先新增位置。只有設定了位置的計畫才能連結 Google 地點。",
    staleLink: "位置已變更，儲存後將移除先前的 Google 連結。",
    removedPending: "儲存後將移除 Google 連結。",
    chosenPending: "已選擇 Google 地點。儲存計畫後才會生效。",
    findOnGoogle: "在 Google 上尋找",
    chooseDifferent: "選擇其他 Google 地點",
    removeLink: "移除 Google 連結",
    queryLabel: "公開商家或地標名稱",
    queryPlaceholder: "例如：河畔植物園",
    privacyNote: "只有你在這裡輸入的文字會傳送給 Google。請勿輸入訂位資料、人名、住址或私人備註。",
    publicVenueLabel: "這是公開的商家或地標，不是私人住宅或地址。",
    needPublicVenue: "請勾選此項，確認這是公開的商家或地標。",
    searchGoogle: "在 Google 上搜尋",
    searching: "正在搜尋 Google…",
    chooseResult: "請在 Google 清單中選擇確切的地點。選擇之前不會建立任何連結。",
    searchFailed: "Google 搜尋暫時無法使用。請稍後再試。",
    queryTooShort: "請輸入公開商家或地標的名稱。",
    queryTooLong: "請使用較短的名稱（最多 120 個字元）。",
    queryPrivate: "只搜尋公開名稱，不要包含電子郵件地址或長串數字。",
    placeIdLabel: "也可以貼上含有地點 ID 的 Google 地圖連結",
    placeIdPlaceholder: "https://www.google.com/maps/search/?api=1&query=…&query_place_id=…",
    showPlace: "顯示此地點",
    placeIdInvalid: "此連結不含 Google 地點 ID。",
    previewLoading: "正在載入 Google 地點…",
    previewReady: "請確認這是正確的地點，再選擇「使用此地點」。",
    usePlace: "使用此地點",
    detailsRegion: "來自 Google 的地點詳情",
    detailsLoading: "正在載入 Google 地點詳情…",
    detailsUnavailable: "暫時無法顯示 Google 地點詳情。",
    tryAgain: "重試",
    showDetails: "顯示 Google 地點詳情",
    cancelSearch: "停止搜尋"
  },
  ja: {
    sectionTitle: "Google の場所の詳細",
    sectionHint: "任意です。この予定を Google 上の公開されている店舗やランドマークにリンクします。予定を開くと、Google の詳細と写真がここに表示されます。",
    linked: "Google の場所にリンク済みです。",
    notLinked: "Google の場所にはリンクしていません。",
    needsLocation: "先に場所を追加してください。場所がある予定だけを Google の場所にリンクできます。",
    staleLink: "場所が変わったため、保存すると以前の Google のリンクは削除されます。",
    removedPending: "保存すると Google のリンクが削除されます。",
    chosenPending: "Google の場所を選びました。予定を保存すると反映されます。",
    findOnGoogle: "Google で探す",
    chooseDifferent: "別の Google の場所を選ぶ",
    removeLink: "Google のリンクを削除",
    queryLabel: "公開されている店舗やランドマークの名前",
    queryPlaceholder: "例：リバーサイド植物園",
    privacyNote: "ここに入力した言葉だけが Google に送信されます。予約情報、人の名前、自宅の住所、個人的なメモは入力しないでください。",
    publicVenueLabel: "これは公開されている店舗やランドマークで、個人の自宅や住所ではありません。",
    needPublicVenue: "公開されている店舗やランドマークであることを確認するため、チェックを入れてください。",
    searchGoogle: "Google で検索",
    searching: "Google で検索しています…",
    chooseResult: "Google の一覧から正確な場所を選んでください。選ぶまでリンクはされません。",
    searchFailed: "現在 Google 検索を利用できません。しばらくしてからもう一度お試しください。",
    queryTooShort: "公開されている店舗やランドマークの名前を入力してください。",
    queryTooLong: "短い名前にしてください（120文字まで）。",
    queryPrivate: "メールアドレスや長い数字を含めず、公開されている名前だけで検索してください。",
    placeIdLabel: "または、場所 ID を含む Google マップのリンクを貼り付けてください",
    placeIdPlaceholder: "https://www.google.com/maps/search/?api=1&query=…&query_place_id=…",
    showPlace: "この場所を表示",
    placeIdInvalid: "このリンクには Google の場所 ID が含まれていません。",
    previewLoading: "Google の場所を読み込んでいます…",
    previewReady: "正しい場所か確認してから、「この場所を使う」を選んでください。",
    usePlace: "この場所を使う",
    detailsRegion: "Google による場所の詳細",
    detailsLoading: "Google の場所の詳細を読み込んでいます…",
    detailsUnavailable: "現在 Google の場所の詳細を表示できません。",
    tryAgain: "再試行",
    showDetails: "Google の場所の詳細を表示",
    cancelSearch: "検索をやめる"
  }
};

export const GOOGLE_TEXT_LANGUAGES = Object.freeze(Object.keys(STRINGS));
export const GOOGLE_TEXT_KEYS = Object.freeze(Object.keys(STRINGS.en));

export function googleText(language, key) {
  return STRINGS[language]?.[key] ?? STRINGS.en[key] ?? key;
}

/** UI language -> Maps JavaScript API language parameter. */
export function sdkLanguage(language) {
  return { en: "en", "zh-Hans": "zh-CN", "zh-Hant": "zh-TW", ja: "ja" }[language] || "en";
}

/** The script URL for a deliberately configured, owner-restricted browser key. */
export function mapsScriptUrl(apiKey, language = "en") {
  const url = new URL(MAPS_JS_URL);
  url.search = new URLSearchParams({
    key: apiKey, v: "weekly", loading: "async", libraries: "places", language: sdkLanguage(language), callback: READY_CALLBACK
  }).toString();
  return url.href;
}

/**
 * A user-typed public venue query, or an error key. Only this dedicated field is ever sent to
 * Google; plan names, notes, travelers and addresses are never used to fill it.
 */
export function checkVenueQuery(value) {
  const query = String(value ?? "").normalize("NFC").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (query.length < VENUE_QUERY_MIN) return { ok: false, errorKey: "queryTooShort" };
  if (query.length > VENUE_QUERY_MAX) return { ok: false, errorKey: "queryTooLong" };
  if (query.includes("@") || /\d{8,}/.test(query.replace(/[\s().+-]/g, ""))) return { ok: false, errorKey: "queryPrivate" };
  return { ok: true, query };
}

/** From a gmp-select event, only place.id is read. Everything else on the place is ignored. */
export function selectedPlaceId(event) {
  const place = event?.place;
  const id = place && typeof place === "object" ? place.id : undefined;
  return isGooglePlaceId(id) ? id : "";
}

const loaderError = (code) => Object.assign(new Error(`Google Places UI Kit ${code}`), { code });
// In a browser globalThis is the window. Tests inject their own timers.
const defaultSetTimer = (fn, ms) => globalThis.setTimeout(fn, ms);
const defaultClearTimer = (id) => { if (id !== null && id !== undefined) globalThis.clearTimeout(id); };

// ---------------------------------------------------------------------------------------------
// Loader: one configuration request, one script, one importLibrary("places") per page.

function defaultInjectScript(src, { win, timeoutMs, setTimer, clearTimer }) {
  return new Promise((resolve, reject) => {
    const doc = win.document;
    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      try { delete win[READY_CALLBACK]; } catch { win[READY_CALLBACK] = undefined; }
      if (error) reject(error);
      else resolve();
    };
    win[READY_CALLBACK] = () => finish();
    const script = doc.createElement("script");
    script.async = true;
    script.src = src;
    script.addEventListener("error", () => finish(loaderError("unavailable")), { once: true });
    timer = setTimer(() => finish(loaderError("timeout")), timeoutMs);
    doc.head.append(script);
  });
}

/**
 * fetchConfig() must resolve to the protected /api/google-places/config body. A failed load stays
 * failed (no automatic retries) until reset() is called from an explicit "Try again". "disabled"
 * is permanent for the page. cancel() abandons a load that is still in progress (the trip was opted
 * out): the next step (script, library import) is skipped and its result is ignored; a request the
 * browser has already sent cannot be withdrawn, and code already loaded stays loaded.
 */
export function createGooglePlacesLoader({
  win, fetchConfig, language = "en", injectScript = defaultInjectScript, timeoutMs = LIBRARY_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  let pending = null;
  let state = "idle";
  let generation = 0;
  const stats = { configRequests: 0, scriptLoads: 0, libraryImports: 0, cancelled: 0 };
  const failureListeners = new Set();
  const fail = () => { if (state === "ready" || state === "loading") state = "failed"; failureListeners.forEach((listener) => listener()); };
  if (typeof win.gm_authFailure !== "function") win.gm_authFailure = fail;

  async function run(ticket) {
    const current = () => { if (ticket !== generation) throw loaderError("cancelled"); };
    stats.configRequests += 1;
    let config;
    try { config = await fetchConfig(); } catch { current(); throw loaderError("unavailable"); }
    current();
    if (config?.enabled !== true || typeof config.apiKey !== "string" || !config.apiKey) throw loaderError("disabled");
    if (typeof win.google?.maps?.importLibrary !== "function") {
      stats.scriptLoads += 1;
      await injectScript(mapsScriptUrl(config.apiKey, language), { win, timeoutMs, setTimer, clearTimer });
      current();
    }
    if (typeof win.google?.maps?.importLibrary !== "function") throw loaderError("unavailable");
    stats.libraryImports += 1;
    const library = await win.google.maps.importLibrary("places");
    current();
    if (!library || typeof library !== "object") throw loaderError("unavailable");
    return library;
  }

  return {
    load() {
      if (!pending) {
        state = "loading";
        const ticket = generation;
        pending = run(ticket).then((library) => { if (ticket === generation) state = "ready"; return library; }, (error) => {
          if (ticket === generation) state = error?.code === "disabled" ? "disabled" : "failed";
          throw error?.code ? error : loaderError("unavailable");
        });
        pending.catch(() => {});
      }
      return pending;
    },
    /** Explicit retry only; never called automatically. */
    reset() {
      if (state !== "failed") return false;
      pending = null;
      state = "idle";
      return true;
    },
    /** Abandon an in-progress load (late results are ignored). A finished load is kept. */
    cancel() {
      if (state !== "loading") return false;
      generation += 1;
      stats.cancelled += 1;
      pending = null;
      state = "idle";
      return true;
    },
    onFailure(listener) { failureListeners.add(listener); return () => failureListeners.delete(listener); },
    get state() { return state; },
    get stats() { return { ...stats }; }
  };
}

// ---------------------------------------------------------------------------------------------
// Component construction

/** A standard compact Place Details element for exactly one Place ID. */
export function buildPlaceDetailsElement(doc, placeId) {
  const element = doc.createElement(STANDARD_ELEMENTS.details);
  element.setAttribute("orientation", "vertical");
  element.classList.add("google-place__details");
  const request = doc.createElement(STANDARD_ELEMENTS.detailsRequest);
  const config = doc.createElement(STANDARD_ELEMENTS.contentConfig);
  config.append(
    doc.createElement(STANDARD_ELEMENTS.media),
    doc.createElement(STANDARD_ELEMENTS.address),
    doc.createElement(STANDARD_ELEMENTS.attribution)
  );
  element.append(request, config);
  // The single place-request assignment for this element.
  request.setAttribute("place", placeId);
  return element;
}

// Moves a retained component without disconnecting it where the browser supports atomic moves
// (Element.moveBefore); otherwise an ordinary append. Whether the SDK re-requests after an ordinary
// re-connection is SDK behaviour that this app does not control.
function moveNode(parent, node) {
  if (node.parentNode === parent) return false;
  if (typeof parent.moveBefore === "function" && node.isConnected && parent.isConnected) {
    try { parent.moveBefore(node, null); return true; } catch { /* fall back */ }
  }
  parent.append(node);
  return true;
}

/** Accessible, responsive host for a plan's Google details (no fixed height). */
export function createGooglePlaceHost(doc, language) {
  const host = doc.createElement("section");
  host.className = "google-place";
  host.setAttribute("aria-label", googleText(language, "detailsRegion"));
  const mount = doc.createElement("div");
  mount.className = "google-place__mount";
  const status = doc.createElement("p");
  status.className = "google-place__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const action = doc.createElement("button");
  action.type = "button";
  action.className = "button button--quiet button--small google-place__action";
  action.hidden = true;
  host.append(mount, status, action);
  return host;
}

// ---------------------------------------------------------------------------------------------
// Saved-place details: lazy, one active plan, retained and deduplicated.

/**
 * show(host, {tripId, planId, placeId, binding}) displays one plan's compact details in host. Only
 * one plan is active at a time; the previously active component is parked (hidden, still connected)
 * and reused if that plan is shown again. Nothing is preloaded. At most maxRetained components are
 * kept; older inactive ones are dropped. Keys include trip, plan, Place ID and location binding,
 * so a changed association or another trip never reuses an old component.
 */
export function createPlaceDetailsManager({
  doc, loader, language = () => "en", maxRetained = MAX_RETAINED_DETAILS, timeoutMs = COMPONENT_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  const entries = new Map();
  const failed = new Set();
  const descriptors = new WeakMap();
  const stats = { constructed: 0, placeAssignments: 0, shows: 0, moves: 0 };
  let activeKey = "";
  let generation = 0;
  let uses = 0;
  let parking = null;
  let disposed = false;
  const text = (key) => googleText(typeof language === "function" ? language() : language, key);

  loader.onFailure?.(() => {
    // An authentication failure reported by the SDK: show the unavailable state, never retry.
    for (const entry of [...entries.values()]) { if (entry.state === "loading") settle(entry, "error"); }
  });

  function keyOf({ tripId, planId, placeId, binding }) {
    return JSON.stringify([String(tripId), String(planId), String(placeId), String(binding)]);
  }

  function parkingLot() {
    if (!parking || !parking.isConnected) {
      parking = doc.createElement("div");
      parking.className = "google-place-parking";
      parking.hidden = true;
      parking.setAttribute("aria-hidden", "true");
      doc.body.append(parking);
    }
    return parking;
  }

  function parts(host) {
    return {
      mount: host.querySelector(".google-place__mount"),
      status: host.querySelector(".google-place__status"),
      action: host.querySelector(".google-place__action")
    };
  }

  function render(host, state) {
    if (!host?.isConnected) return;
    const { status, action, mount } = parts(host);
    host.hidden = state === "disabled";
    host.dataset.googlePlaceState = state;
    mount.hidden = state === "error" || state === "inactive";
    action.hidden = true;
    action.onclick = null;
    if (state === "loading") status.textContent = text("detailsLoading");
    else if (state === "error") {
      status.textContent = text("detailsUnavailable");
      action.textContent = text("tryAgain");
      action.hidden = false;
      action.onclick = () => retry(host);
    } else if (state === "inactive") {
      status.textContent = "";
      action.textContent = text("showDetails");
      action.hidden = false;
      action.onclick = () => show(host, descriptors.get(host));
    } else status.textContent = "";
  }

  function settle(entry, state) {
    if (entries.get(entry.key) !== entry || entry.state !== "loading") return;
    clearTimer(entry.timer);
    entry.timer = null;
    entry.state = state;
    if (state === "error") {
      failed.add(entry.key);
      discard(entry);
    }
    if (activeKey === entry.key) render(entry.host, state);
  }

  function discard(entry) {
    clearTimer(entry.timer);
    entry.element.remove();
    entries.delete(entry.key);
  }

  function park(key) {
    const entry = entries.get(key);
    if (!entry) return;
    const previousHost = entry.host;
    if (moveNode(parkingLot(), entry.element)) stats.moves += 1;
    entry.host = null;
    if (previousHost?.isConnected && previousHost !== null) render(previousHost, "inactive");
  }

  function evict() {
    const inactive = [...entries.values()].filter((entry) => entry.key !== activeKey).sort((a, b) => a.lastUsed - b.lastUsed);
    while (entries.size > maxRetained && inactive.length) discard(inactive.shift());
  }

  function construct(key, placeId) {
    const element = buildPlaceDetailsElement(doc, placeId);
    stats.constructed += 1;
    stats.placeAssignments += 1;
    const entry = { key, placeId, element, state: "loading", lastUsed: ++uses, host: null, timer: null };
    element.addEventListener("gmp-load", () => settle(entry, "ready"));
    element.addEventListener("gmp-error", () => settle(entry, "error"));
    entry.timer = setTimer(() => settle(entry, "error"), timeoutMs);
    entries.set(key, entry);
    return entry;
  }

  function attach(host, entry) {
    if (moveNode(parts(host).mount, entry.element)) stats.moves += 1;
    entry.host = host;
    entry.lastUsed = ++uses;
  }

  async function show(host, descriptor) {
    if (disposed || !host || !descriptor || !isGooglePlaceId(descriptor.placeId) || !descriptor.binding) return false;
    const key = keyOf(descriptor);
    descriptors.set(host, descriptor);
    host.dataset.googlePlaceKey = key;
    if (activeKey && activeKey !== key) park(activeKey);
    activeKey = key;
    const ticket = ++generation;
    stats.shows += 1;
    if (failed.has(key)) { render(host, "error"); return false; }
    const existing = entries.get(key);
    if (existing) {
      attach(host, existing);
      render(host, existing.state);
      return true;
    }
    render(host, "loading");
    try { await loader.load(); }
    catch (error) {
      if (ticket === generation && activeKey === key) render(host, error?.code === "disabled" ? "disabled" : "error");
      return false;
    }
    // Collapsed, replaced by another plan, re-rendered or invalidated while loading: build nothing.
    if (disposed || ticket !== generation || activeKey !== key || !host.isConnected) return false;
    const entry = entries.get(key) || construct(key, descriptor.placeId);
    attach(host, entry);
    render(host, entry.state);
    evict();
    return true;
  }

  function retry(host) {
    const descriptor = descriptors.get(host);
    if (!descriptor) return;
    failed.delete(keyOf(descriptor));
    loader.reset?.();
    show(host, descriptor);
  }

  return {
    show,
    keyOf,
    isActive: (descriptor) => Boolean(activeKey) && activeKey === keyOf(descriptor),
    /** An open plan that is not the active one: offer an explicit control, build and load nothing. */
    idle(host, descriptor) {
      if (disposed || !host || !descriptor) return;
      descriptors.set(host, descriptor);
      host.dataset.googlePlaceKey = keyOf(descriptor);
      render(host, failed.has(keyOf(descriptor)) ? "error" : "inactive");
    },
    /** The plan was collapsed: cancel any pending load and park its component. */
    deactivate(descriptor) {
      const key = keyOf(descriptor);
      if (activeKey !== key) return;
      generation += 1;
      park(key);
      activeKey = "";
    },
    /** Before the itinerary is rebuilt: park the active component but remember which plan it was. */
    suspend() {
      if (activeKey) {
        const entry = entries.get(activeKey);
        if (entry && moveNode(parkingLot(), entry.element)) stats.moves += 1;
        if (entry) entry.host = null;
      }
    },
    /** Drop components and failure marks whose association is no longer current. */
    retain(validKeys) {
      const keep = validKeys instanceof Set ? validKeys : new Set(validKeys);
      for (const entry of [...entries.values()]) if (!keep.has(entry.key)) discard(entry);
      for (const key of [...failed]) if (!keep.has(key)) failed.delete(key);
      if (activeKey && !keep.has(activeKey)) { activeKey = ""; generation += 1; }
    },
    dispose() {
      disposed = true;
      generation += 1;
      for (const entry of [...entries.values()]) discard(entry);
      parking?.remove();
      activeKey = "";
    },
    get activeKey() { return activeKey; },
    get retainedCount() { return entries.size; },
    get stats() { return { ...stats }; }
  };
}

// ---------------------------------------------------------------------------------------------
// Editor: official selectable search and Place ID preview. Nothing is selected automatically.

/**
 * One selectable search element per editor session, built only on an explicit search. Re-searching
 * the same text sends nothing new. onSelect(placeId) runs only when the user picks a result in the
 * official list; there is no first-result or best-match selection. onStatus(key) reports progress.
 */
export function createPlaceSearchSession({
  doc, loader, mount, onSelect, onStatus, timeoutMs = COMPONENT_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  let element = null;
  let request = null;
  let token = 0;
  let disposed = false;
  let timer = null;
  let waiting = false;
  const stats = { constructed: 0, queries: 0 };
  const status = (key) => { if (!disposed) onStatus?.(key); };
  const settle = (key) => {
    if (!waiting) return;
    waiting = false;
    clearTimer(timer);
    timer = null;
    status(key);
  };

  async function search(query) {
    if (disposed) return false;
    const ticket = ++token;
    status("searching");
    try { await loader.load(); }
    catch (error) {
      if (!disposed && ticket === token) status(error?.code === "disabled" ? "disabled" : "searchFailed");
      return false;
    }
    if (disposed || ticket !== token) return false;
    if (!element) {
      element = doc.createElement(STANDARD_ELEMENTS.search);
      element.setAttribute("selectable", "");
      element.classList.add("google-match__search");
      request = doc.createElement(STANDARD_ELEMENTS.textSearchRequest);
      request.setAttribute("max-result-count", String(SEARCH_RESULT_LIMIT));
      const config = doc.createElement(STANDARD_ELEMENTS.contentConfig);
      config.append(doc.createElement(STANDARD_ELEMENTS.address), doc.createElement(STANDARD_ELEMENTS.attribution));
      element.append(request, config);
      element.addEventListener("gmp-load", () => settle("chooseResult"));
      element.addEventListener("gmp-error", () => settle("searchFailed"));
      element.addEventListener("gmp-select", (event) => {
        if (disposed) return;
        const placeId = selectedPlaceId(event);
        if (placeId) onSelect?.(placeId);
      });
      stats.constructed += 1;
      mount.append(element);
    }
    if (request.getAttribute("text-query") === query) {
      // The same official results are already on screen; no new request is made.
      status("chooseResult");
      return true;
    }
    waiting = true;
    clearTimer(timer);
    timer = setTimer(() => settle("searchFailed"), timeoutMs);
    request.setAttribute("text-query", query);
    stats.queries += 1;
    return true;
  }

  return {
    search,
    dispose() {
      disposed = true;
      token += 1;
      waiting = false;
      clearTimer(timer);
      element?.remove();
      element = null;
      request = null;
    },
    get active() { return Boolean(element); },
    get stats() { return { ...stats }; }
  };
}

/** Shows one compact details element for a user-supplied Place ID so the user can check it. */
export function createPlacePreviewSession({
  doc, loader, mount, onStatus, timeoutMs = COMPONENT_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  let element = null;
  let placeId = "";
  let token = 0;
  let disposed = false;
  let timer = null;
  let ready = false;
  const stats = { constructed: 0 };
  const status = (key) => { if (!disposed) onStatus?.(key); };

  function clear() {
    clearTimer(timer);
    timer = null;
    element?.remove();
    element = null;
    placeId = "";
    ready = false;
  }

  async function preview(id) {
    if (disposed || !isGooglePlaceId(id)) return false;
    if (id === placeId && element) { status(ready ? "previewReady" : "previewLoading"); return true; }
    const ticket = ++token;
    clear();
    status("previewLoading");
    try { await loader.load(); }
    catch (error) {
      if (!disposed && ticket === token) status(error?.code === "disabled" ? "disabled" : "detailsUnavailable");
      return false;
    }
    if (disposed || ticket !== token) return false;
    placeId = id;
    element = buildPlaceDetailsElement(doc, id);
    stats.constructed += 1;
    const finish = (ok) => {
      if (ticket !== token || disposed || ready || !timer) return;
      clearTimer(timer);
      timer = null;
      if (ok) { ready = true; status("previewReady"); }
      else { clear(); status("detailsUnavailable"); }
    };
    element.addEventListener("gmp-load", () => finish(true));
    element.addEventListener("gmp-error", () => finish(false));
    timer = setTimer(() => finish(false), timeoutMs);
    mount.append(element);
    return true;
  }

  return {
    preview,
    dispose() { disposed = true; token += 1; clear(); },
    get readyPlaceId() { return ready ? placeId : ""; },
    get stats() { return { ...stats }; }
  };
}
