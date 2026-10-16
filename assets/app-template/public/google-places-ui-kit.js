// Optional Google Places UI Kit integration for the self-hosted trip page.
//
// Inert by default. Importing this module does nothing: no request, no script, no element. The
// trip page creates a loader only when the signed-in session advertises the feature
// (features.googlePlacesUiKit, present only when the operator enabled it with a browser key) and the
// trip itself is opted in, and nothing contacts Google until a plan actually needs a component.
//
// Allowance gate. Every app-controlled action that could make Google count usage first needs a
// one-use permit from the server's monthly allowance (POST /api/trips/<id>/google-places/reservations):
//   - the first SDK bootstrap (script + importLibrary) together with the first component; the
//     browser key itself arrives only inside a granted reservation, so no script can load without one;
//   - every Place Details construction and its place-request assignment;
//   - every new editor search query and every Place ID preview;
//   - every explicit "Try again" and every re-instantiation after eviction, failure or discard.
// A permit is checked synchronously immediately before the SDK bootstrap it may start and again
// immediately before the dispatch it authorizes (same trip, kind and Place ID; unused; inside its
// validity window; page visible and not hidden since the request was sent; caller's state still
// current) and is consumed only by the dispatch. A denial, an expired, replayed, late or
// unverifiable permit, a hidden tab, an opt-out, a sign-out or a changed location starts no Google
// work at all. Nothing is refunded.
//
// Timing fails closed. The validity window is measured from when this page FIRST sent the
// reservation request (a transport retry reuses the idempotency key, so a replayed answer may be
// the permit issued for that first send) on BOTH the monotonic clock (performance.now) and the wall
// clock, and the two elapsed times must agree within CLOCK_TOLERANCE_MS. No monotonic clock, a
// clock that runs backwards, or a provider month that cannot be computed refuses (and blocks further
// reservations until an explicit Try again); a wall clock that ran ahead of the monotonic clock (OS
// sleep with a paused monotonic clock, or a forward jump) makes the permit expired. permit.month must
// be a well-formed YYYY-MM equal to the provider month (America/Los_Angeles) when the request was
// sent, when the answer arrived, at bootstrap and at dispatch, so a late answer, a hidden tab or a
// sleeping laptop that crosses a provider month never reuses the old month's grant.
//
// Google components are NEVER reparented once connected, not even with Element.moveBefore: per the
// HTML standard a custom element without connectedMoveCallback still gets disconnectedCallback and
// connectedCallback on such a move, and this app cannot know what the SDK does then. A component is
// connected exactly once, into the plan's own host. Collapsing the card or choosing another plan only
// hides it inside that same host; re-expanding unhides it (no reservation, no call, no callback). When
// a re-render is about to replace the host, the component is released (removed once, never connected
// again) and the new card offers an explicit "Show Google place details", which reserves afresh.
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
// inside the page and may make their own network requests to Google (which this app cannot see or
// count); nothing they show is copied into trip data, storage, exports, logs or map markers. Saved
// OpenStreetMap places and Commons/manual photos are never hidden or replaced: Google is additive.
// Once the SDK is loaded in a page it cannot be unloaded and its own background work cannot be
// stopped by this app.

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
// Client-side permit handling. The server issues at most 45 s; the client never trusts more than
// PERMIT_MAX_MS and keeps DISPATCH_SAFETY_MS in reserve.
export const PERMIT_MAX_MS = 60000;
export const DISPATCH_SAFETY_MS = 1000;
// Wall-clock and monotonic elapsed time since a request was sent must agree within this tolerance.
export const CLOCK_TOLERANCE_MS = 2000;
// The provider's monthly boundary (Pacific time, including daylight saving time).
export const PROVIDER_TIME_ZONE = "America/Los_Angeles";
export const PERMIT_MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;
// One reservation transport retry (same idempotency key) after a network failure or timeout.
export const RESERVATION_ATTEMPTS = 2;
export const RESERVATION_RETRY_MS = 500;
export const PERMIT_ID_PATTERN = /^gpr_[A-Za-z0-9_-]{24}$/;
const BROWSER_KEY_SHAPE = /^[A-Za-z0-9_-]{30,100}$/;

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
    cancelSearch: "Stop searching",
    limitReached: "This site has reached its Google limit for this month, so nothing more is loaded from Google. Saved photos and details stay as they are.",
    paused: "Google features are paused right now, so nothing is loaded from Google. Saved photos and details stay as they are."
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
    cancelSearch: "停止搜索",
    limitReached: "本站本月的 Google 使用已达上限，因此不会再从 Google 加载内容。已保存的照片和详情保持不变。",
    paused: "Google 功能暂时停用，因此不会从 Google 加载任何内容。已保存的照片和详情保持不变。"
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
    cancelSearch: "停止搜尋",
    limitReached: "本站本月的 Google 使用量已達上限，因此不會再從 Google 載入內容。已儲存的照片與詳情維持不變。",
    paused: "Google 功能暫時停用，因此不會從 Google 載入任何內容。已儲存的照片與詳情維持不變。"
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
    cancelSearch: "検索をやめる",
    limitReached: "このサイトは今月の Google の利用上限に達したため、Google からはこれ以上読み込みません。保存済みの写真と詳細はそのまま表示されます。",
    paused: "Google の機能は現在一時停止中のため、Google からは何も読み込みません。保存済みの写真と詳細はそのまま表示されます。"
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
// In a browser globalThis is the window. Tests inject their own timers and clocks.
const defaultSetTimer = (fn, ms) => globalThis.setTimeout(fn, ms);
const defaultClearTimer = (id) => { if (id !== null && id !== undefined) globalThis.clearTimeout(id); };
// Monotonic clock: performance.now() only. There is deliberately no Date.now() fallback; without a
// monotonic clock the gate refuses (fail closed).
const defaultNow = () => (typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Number.NaN);
const defaultWallNow = () => Date.now();
const defaultVisible = () => globalThis.document?.visibilityState !== "hidden";
// Any visibility or page-lifecycle change (hidden tab, freeze/resume, back/forward cache) voids
// every outstanding permit.
function defaultWatchVisibility(listener) {
  const doc = globalThis.document;
  const win = typeof globalThis.addEventListener === "function" ? globalThis : null;
  if (typeof doc?.addEventListener !== "function") return () => {};
  const docEvents = ["visibilitychange", "freeze", "resume"];
  // pageshow also fires on the first load; only a back/forward-cache restore counts.
  const onPageShow = (event) => { if (event?.persisted) listener(); };
  docEvents.forEach((name) => doc.addEventListener(name, listener));
  win?.addEventListener("pagehide", listener);
  win?.addEventListener("pageshow", onPageShow);
  return () => {
    docEvents.forEach((name) => doc.removeEventListener(name, listener));
    win?.removeEventListener("pagehide", listener);
    win?.removeEventListener("pageshow", onPageShow);
  };
}

let monthFormatter = null;
/**
 * The provider month (YYYY-MM in America/Los_Angeles, daylight saving time included) for a wall
 * clock time in milliseconds, or "" when it cannot be computed (then the gate fails closed).
 */
export function providerMonth(ms) {
  if (!Number.isFinite(ms)) return "";
  try {
    monthFormatter ||= new Intl.DateTimeFormat("en-US", { timeZone: PROVIDER_TIME_ZONE, year: "numeric", month: "2-digit" });
    const parts = monthFormatter.formatToParts(new Date(ms));
    const year = parts.find((part) => part.type === "year")?.value || "";
    const month = parts.find((part) => part.type === "month")?.value || "";
    const value = `${year}-${month}`;
    return PERMIT_MONTH_PATTERN.test(value) ? value : "";
  } catch {
    return "";
  }
}
const defaultSleep = (ms) => new Promise((resolve) => { globalThis.setTimeout(resolve, ms); });
function defaultRequestKey() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return `gres-${cryptoApi.randomUUID()}`;
  if (typeof cryptoApi?.getRandomValues === "function") {
    return `gres-${[...cryptoApi.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `gres-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------------------------
// Allowance gate: one server reservation, then at most one synchronous dispatch per permit.

// Server error codes -> denial reasons. "blocking" reasons stop further reservations from this page
// until an explicit Try again, so a denied site does not keep asking.
const DENIAL_CODES = Object.freeze({
  google_allowance_exhausted: "exhausted",
  google_allowance_unconfigured: "unconfigured",
  google_allowance_unavailable: "unavailable",
  google_allowance_clock_uncertain: "unavailable",
  google_allowance_month_boundary: "boundary",
  google_places_disabled: "disabled",
  google_trip_not_enabled: "notCurrent",
  google_place_not_linked: "notCurrent",
  trip_archived: "notCurrent",
  request_id_conflict: "unverifiable"
});
// "clock": this page's timing cannot be trusted (no monotonic clock, a clock running backwards, no
// provider month, or a device month that disagrees with the server's); it does not fix itself.
const BLOCKING_REASONS = new Set(["exhausted", "unconfigured", "unavailable", "disabled", "clock"]);

/**
 * The reservation context a kind actually carries: a search names nothing; a preview names only its
 * Place ID; saved details name the plan and its Place ID. Anything else is refused before reserving.
 */
export function reservationContext({ kind, planId = "", placeId = "" } = {}) {
  if (kind === "search") return { kind, planId: "", placeId: "" };
  if (kind === "preview") return isGooglePlaceId(placeId) ? { kind, planId: "", placeId } : null;
  if (kind === "details") return isGooglePlaceId(placeId) && typeof planId === "string" && planId.length > 0 && planId.length <= 200 ? { kind, planId, placeId } : null;
  return null;
}

function denialReason(error) {
  if (error?.status === 401) return "signedOut";
  if (error?.status === 403) return "forbidden";
  return DENIAL_CODES[error?.code] || "unavailable";
}

const isTransportFailure = (error) => error?.status === 0 || ((error?.status === 502 || error?.status === 504) && !error?.code);

/**
 * createGoogleAllowanceGate({ tripId, reserve }) where reserve(body) POSTs to the reservation route
 * and resolves to its JSON body or rejects with { status, code }. acquire() asks for one permit;
 * check(grant, expected) is the synchronous pre-bootstrap check (consumes nothing);
 * dispatch(grant, expected, work) re-checks synchronously and runs work() at most once. The gate
 * never refunds: an unused or refused permit is simply dropped.
 *
 * now() is the monotonic clock (performance.now), wallNow() the wall clock (Date.now), monthOf(ms)
 * the provider month; isVisible() and watchVisibility(listener) report the tab's visibility. All
 * are injectable for tests; production uses the real ones and fails closed when they are missing.
 */
export function createGoogleAllowanceGate({
  tripId, reserve, now = defaultNow, wallNow = defaultWallNow, monthOf = providerMonth,
  isVisible = defaultVisible, watchVisibility = defaultWatchVisibility, newRequestKey = defaultRequestKey,
  sleep = defaultSleep, retryDelayMs = RESERVATION_RETRY_MS
}) {
  let generation = 0;
  let visibilityEpoch = 0;
  let disposed = false;
  let blocked = "";
  let lastMono = Number.NEGATIVE_INFINITY;
  const consumed = new Set();
  const stats = { acquisitions: 0, requests: 0, granted: 0, denied: 0, dispatched: 0, refused: 0, preflightRefused: 0, replays: 0, clockRefusals: 0, invalid: 0 };
  const denial = (reason) => ({ granted: false, reason });
  let stopWatching = null;
  try { stopWatching = typeof watchVisibility === "function" ? watchVisibility(() => { visibilityEpoch += 1; }) : null; }
  catch { stopWatching = null; }

  // One reading of both clocks, or null when timing is unavailable or the monotonic clock ran
  // backwards (both make the gate fail closed).
  function reading() {
    let mono;
    let wall;
    try { mono = now(); wall = wallNow(); } catch { return null; }
    if (typeof mono !== "number" || typeof wall !== "number" || !Number.isFinite(mono) || !Number.isFinite(wall)) return null;
    if (mono < lastMono) return null;
    lastMono = mono;
    return { mono, wall };
  }

  // "clock": the wall clock went backwards relative to the monotonic one (or the monotonic one did);
  // "expired": the wall clock ran ahead (sleep with a paused monotonic clock, or a forward jump), so
  // the real elapsed time is unknown and the permit is treated as too old.
  function elapsedProblem(from, to) {
    const mono = to.mono - from.mono;
    const wall = to.wall - from.wall;
    if (mono < 0 || wall < mono - CLOCK_TOLERANCE_MS) return "clock";
    if (wall > mono + CLOCK_TOLERANCE_MS) return "expired";
    return "";
  }

  function block(reason) {
    if (reason === "clock") { stats.clockRefusals += 1; if (!disposed) blocked = "clock"; }
  }

  function verify(response, context) {
    const permit = response?.permit;
    if (response?.granted !== true || !permit || typeof permit !== "object") return null;
    if (typeof permit.id !== "string" || !PERMIT_ID_PATTERN.test(permit.id) || permit.kind !== context.kind || permit.tripId !== tripId) return null;
    if ((context.placeId || null) !== (permit.placeId ?? null)) return null;
    if (typeof permit.month !== "string" || !PERMIT_MONTH_PATTERN.test(permit.month)) return null;
    if (typeof permit.validForMs !== "number" || !Number.isFinite(permit.validForMs) || permit.validForMs <= 0) return null;
    if (typeof response.apiKey !== "string" || !BROWSER_KEY_SHAPE.test(response.apiKey)) return null;
    return permit;
  }

  async function acquire(request = {}) {
    if (disposed) return denial("cancelled");
    // Unsupported context is refused before anything is reserved. A search carries no plan or
    // Place ID, so any it was given is dropped here and never compared later.
    const context = reservationContext(request);
    if (!context) { stats.invalid += 1; return denial("invalid"); }
    if (blocked) { stats.denied += 1; return denial(blocked); }
    // Background tabs reserve nothing.
    if (!isVisible()) return denial("hidden");
    // No trustworthy timing: nothing is reserved at all.
    const sent = reading();
    const sentMonth = sent ? monthOf(sent.wall) : "";
    if (!sent || typeof sentMonth !== "string" || !PERMIT_MONTH_PATTERN.test(sentMonth)) { block("clock"); stats.denied += 1; return denial("clock"); }
    const ticket = generation;
    const epoch = visibilityEpoch;
    const body = { requestId: newRequestKey(), kind: context.kind, ...(context.kind === "details" ? { planId: context.planId, placeId: context.placeId } : context.kind === "preview" ? { placeId: context.placeId } : {}) };
    stats.acquisitions += 1;
    let response = null;
    for (let attempt = 1; ; attempt += 1) {
      stats.requests += 1;
      try { response = await reserve(body); break; }
      catch (error) {
        if (disposed || ticket !== generation) return denial("cancelled");
        // Only the transport is retried, with the same idempotency key: the server answers with the
        // same single permit, never a second one.
        if (attempt < RESERVATION_ATTEMPTS && isTransportFailure(error)) {
          await sleep(retryDelayMs);
          if (disposed || ticket !== generation) return denial("cancelled");
          continue;
        }
        const reason = denialReason(error);
        if (reason === "signedOut") { disposed = true; generation += 1; }
        if (BLOCKING_REASONS.has(reason)) blocked = reason;
        stats.denied += 1;
        return denial(reason);
      }
    }
    if (disposed || ticket !== generation) return denial("cancelled");
    const permit = verify(response, context);
    if (!permit) { stats.denied += 1; return denial("unverifiable"); }
    const received = reading();
    if (!received || elapsedProblem(sent, received) === "clock") { block("clock"); stats.denied += 1; return denial("clock"); }
    const receivedMonth = monthOf(received.wall);
    if (permit.month !== sentMonth || permit.month !== receivedMonth) {
      stats.denied += 1;
      // The month changed while the request was in flight: a late answer is never used. Otherwise
      // this device's clock disagrees with the server's month: do not keep spending reservations.
      if (sentMonth !== receivedMonth) return denial("month");
      block("clock");
      return denial("clock");
    }
    // Hidden (or frozen/resumed) while the request was in flight: the answer is not used.
    if (epoch !== visibilityEpoch || !isVisible()) { stats.denied += 1; return denial("hidden"); }
    if (response.replayed === true) stats.replays += 1;
    stats.granted += 1;
    // Validity is counted from when this page FIRST sent the request (a retry may be answered with
    // the permit issued for that first send), so a slow or retried response shortens the window and
    // never extends it. Both clocks carry their own deadline.
    const validity = Math.min(permit.validForMs, PERMIT_MAX_MS) - DISPATCH_SAFETY_MS;
    return {
      granted: true, apiKey: response.apiKey,
      permit: Object.freeze({
        id: permit.id, kind: context.kind, planId: context.planId, placeId: context.placeId, month: permit.month,
        sentMono: sent.mono, sentWall: sent.wall, deadline: sent.mono + validity, wallDeadline: sent.wall + validity, ticket, epoch
      })
    };
  }

  function problem(grant, expected = {}, full = true) {
    if (disposed) return "cancelled";
    const permit = grant?.granted === true ? grant.permit : null;
    if (!permit || typeof permit !== "object") return "unverifiable";
    if (permit.ticket !== generation) return "cancelled";
    if (consumed.has(permit.id)) return "consumed";
    const wanted = expected.kind === "search" ? "" : (expected.placeId || "");
    if (permit.kind !== expected.kind || permit.placeId !== wanted) return "mismatch";
    // A visibility or lifecycle change since the request was sent voids the permit for good.
    if (permit.epoch !== visibilityEpoch) return "hidden";
    const at = reading();
    if (!at) return "clock";
    const elapsed = elapsedProblem({ mono: permit.sentMono, wall: permit.sentWall }, at);
    if (elapsed) return elapsed;
    if (!(at.mono < permit.deadline) || !(at.wall < permit.wallDeadline)) return "expired";
    const month = monthOf(at.wall);
    if (typeof month !== "string" || !PERMIT_MONTH_PATTERN.test(month)) return "clock";
    if (month !== permit.month) return "month";
    if (!full) return "";
    if (!isVisible()) return "hidden";
    if (typeof expected.isCurrent === "function" && expected.isCurrent() !== true) return "notCurrent";
    return "";
  }

  return {
    acquire,
    /** True while grant could still be dispatched for expected (ignores current visibility and isCurrent). */
    usable(grant, expected) {
      const reason = problem(grant, expected, false);
      block(reason);
      return reason === "";
    },
    /** Synchronous pre-bootstrap check (nothing consumed): "" or the refusal reason. */
    check(grant, expected) {
      const reason = problem(grant, expected, true);
      if (reason) { stats.preflightRefused += 1; block(reason); }
      return reason;
    },
    /** Synchronous check-and-consume. Returns { dispatched, reason }; work() runs only when dispatched. */
    dispatch(grant, expected, work) {
      const reason = problem(grant, expected, true);
      if (reason) { stats.refused += 1; block(reason); return { dispatched: false, reason }; }
      consumed.add(grant.permit.id);
      stats.dispatched += 1;
      work();
      return { dispatched: true, reason: "" };
    },
    /** Explicit Try again: allow one more reservation attempt after a blocking denial. */
    unblock() { if (!disposed) blocked = ""; },
    /** Opt-out or trip change: every outstanding reservation and unused permit becomes void. */
    cancelAll() { generation += 1; },
    /** Sign-out or page teardown: nothing is reserved or dispatched afterwards. */
    dispose() {
      disposed = true;
      generation += 1;
      try { stopWatching?.(); } catch { /* already gone */ }
      stopWatching = null;
    },
    get blocked() { return blocked; },
    get disposed() { return disposed; },
    get stats() { return { ...stats }; }
  };
}

// ---------------------------------------------------------------------------------------------
// Loader: one script and one importLibrary("places") per page, started only with a granted key.

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
 * load(apiKey) needs the key from a granted reservation; without one it rejects and touches
 * nothing. A failed load stays failed (no automatic retries) until reset() from an explicit
 * "Try again". cancel() abandons a load that is still in progress (the trip was opted out): the next
 * step (script, library import) is skipped and its result is ignored; a request the browser has
 * already sent cannot be withdrawn, and code already loaded stays loaded.
 */
export function createGooglePlacesLoader({
  win, language = "en", injectScript = defaultInjectScript, timeoutMs = LIBRARY_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  let pending = null;
  let state = "idle";
  let generation = 0;
  const stats = { scriptLoads: 0, libraryImports: 0, cancelled: 0 };
  const failureListeners = new Set();
  const fail = () => { if (state === "ready" || state === "loading") state = "failed"; failureListeners.forEach((listener) => listener()); };
  if (typeof win.gm_authFailure !== "function") win.gm_authFailure = fail;

  async function run(ticket, apiKey) {
    const current = () => { if (ticket !== generation) throw loaderError("cancelled"); };
    if (typeof win.google?.maps?.importLibrary !== "function") {
      stats.scriptLoads += 1;
      await injectScript(mapsScriptUrl(apiKey, language), { win, timeoutMs, setTimer, clearTimer });
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
    load(apiKey) {
      if (!pending) {
        if (typeof apiKey !== "string" || !BROWSER_KEY_SHAPE.test(apiKey)) return Promise.reject(loaderError("unavailable"));
        state = "loading";
        const ticket = generation;
        pending = run(ticket, apiKey).then((library) => { if (ticket === generation) state = "ready"; return library; }, (error) => {
          if (ticket === generation) state = "failed";
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

// There is deliberately no helper that moves a component. Element.moveBefore is never used: a
// custom element without connectedMoveCallback is disconnected and re-connected by it (HTML
// standard), and whether the SDK defines that callback, or what it does in it, is not ours to
// assume. A component is connected once into its own host and only ever hidden, shown or removed.

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

// Denial reason -> details host state (null: stale, render nothing).
function denialState(reason) {
  if (reason === "cancelled" || reason === "notCurrent") return null;
  if (reason === "exhausted") return "limit";
  if (reason === "disabled") return "disabled";
  // A hidden tab, an answer that crossed a provider month or arrived stale: nothing is reused; the
  // plan offers an explicit control, which reserves afresh.
  if (reason === "hidden" || reason === "month" || reason === "expired") return "inactive";
  if (reason === "invalid") return "error";
  return "paused";
}

// Pre-bootstrap or dispatch refusal of a granted permit -> details host state.
function refusalState(reason) {
  if (reason === "cancelled") return null;
  if (reason === "expired" || reason === "hidden" || reason === "month" || reason === "notCurrent") return "inactive";
  if (reason === "clock") return "paused";
  return "error";
}

// Denial reason -> editor status key (null: stale, report nothing).
function denialStatus(reason, fallback) {
  if (reason === "cancelled" || reason === "notCurrent") return null;
  if (reason === "exhausted") return "limitReached";
  if (reason === "disabled") return "disabled";
  if (reason === "hidden" || reason === "month" || reason === "expired" || reason === "invalid") return fallback;
  return "paused";
}

// Pre-bootstrap or dispatch refusal -> editor status key.
function refusalStatus(reason, fallback) {
  if (reason === "cancelled") return null;
  if (reason === "clock") return "paused";
  return fallback;
}

// ---------------------------------------------------------------------------------------------
// Saved-place details: lazy, one active plan, retained in its own host and deduplicated.

/**
 * show(host, {tripId, planId, placeId, binding}) displays one plan's compact details in host. Only
 * one plan is active at a time. A component is connected exactly once, into the host it was built
 * for, and is never moved: when another plan becomes active or the card is collapsed it is only
 * hidden inside that same host, and showing that same host again unhides it (no reservation, no
 * Google call, no connection callback). Nothing is preloaded. At most maxRetained components are
 * kept; older inactive ones are removed for good. Keys include trip, plan, Place ID and location
 * binding, so a changed association or another trip never reuses an old component.
 * releaseWithin(root) is called before a re-render replaces hosts: their components are removed for
 * good (never re-attached anywhere). restore(host, descriptor) after a re-render never reserves or
 * builds anything; unless the same host still holds the component, the card offers an explicit
 * control, which reserves afresh. isCurrent(descriptor) is the page's own check (trip still opted
 * in, association still current) made right before the SDK bootstrap and right before a dispatch.
 */
export function createPlaceDetailsManager({
  doc, loader, gate, isCurrent = () => true, language = () => "en", maxRetained = MAX_RETAINED_DETAILS,
  timeoutMs = COMPONENT_TIMEOUT_MS, setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  const entries = new Map();
  const hostEntries = new WeakMap();
  const failed = new Set();
  const denied = new Map();
  const grants = new Map();
  const descriptors = new WeakMap();
  const stats = { constructed: 0, placeAssignments: 0, shows: 0, reused: 0, hidden: 0, released: 0, evicted: 0 };
  let activeKey = "";
  let activeHost = null;
  let generation = 0;
  let uses = 0;
  let disposed = false;
  const text = (key) => googleText(typeof language === "function" ? language() : language, key);

  loader.onFailure?.(() => {
    // An authentication failure reported by the SDK: show the unavailable state, never retry.
    for (const entry of [...entries.values()]) { if (entry.state === "loading") settle(entry, "error"); }
  });

  function keyOf({ tripId, planId, placeId, binding }) {
    return JSON.stringify([String(tripId), String(planId), String(placeId), String(binding)]);
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
    mount.hidden = state === "error" || state === "inactive" || state === "limit" || state === "paused";
    action.hidden = true;
    action.onclick = null;
    if (state === "loading") status.textContent = text("detailsLoading");
    else if (state === "error" || state === "paused") {
      status.textContent = text(state === "error" ? "detailsUnavailable" : "paused");
      action.textContent = text("tryAgain");
      action.hidden = false;
      action.onclick = () => retry(host);
    } else if (state === "limit") {
      status.textContent = text("limitReached");
    } else if (state === "inactive") {
      status.textContent = "";
      action.textContent = text("showDetails");
      action.hidden = false;
      action.onclick = () => show(host, descriptors.get(host));
    } else status.textContent = "";
  }

  // Still connected exactly where it was first connected.
  function live(entry) {
    return entry.host.isConnected && entry.mount.parentNode === entry.host && entry.element.parentNode === entry.mount && entry.element.isConnected;
  }

  const isShown = (entry) => activeKey === entry.key && activeHost === entry.host;

  function settle(entry, state) {
    if (entries.get(entry.key) !== entry || entry.state !== "loading") return;
    clearTimer(entry.timer);
    entry.timer = null;
    entry.state = state;
    const shown = isShown(entry);
    if (state === "error") {
      failed.add(entry.key);
      discard(entry);
    }
    if (shown) render(entry.host, state);
  }

  // Removes a component for good: it is disconnected at most once and never connected again (no
  // reference to it is kept).
  function discard(entry) {
    clearTimer(entry.timer);
    entry.timer = null;
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
    if (hostEntries.get(entry.host) === entry) hostEntries.delete(entry.host);
    entry.element.remove();
  }

  // Components whose host left the document (a re-render the page did not announce) are released;
  // they are never re-attached anywhere.
  function sweep() {
    for (const entry of [...entries.values()]) {
      if (!live(entry)) { stats.released += 1; discard(entry); }
    }
  }

  // The active plan stops being active. Its component stays connected in its own host, hidden
  // behind the explicit control; a pending show for it is cancelled.
  function leaveActive() {
    const host = activeHost;
    const key = activeKey;
    activeKey = "";
    activeHost = null;
    generation += 1;
    if (!host?.isConnected) return;
    const entry = hostEntries.get(host);
    const resident = Boolean(entry && entry.key === key);
    const state = host.dataset.googlePlaceState;
    if (resident || state === "loading" || state === "ready") {
      if (resident) stats.hidden += 1;
      render(host, "inactive");
    }
  }

  function evict() {
    const inactive = [...entries.values()].filter((entry) => !isShown(entry)).sort((a, b) => a.lastUsed - b.lastUsed);
    while (entries.size > maxRetained && inactive.length) {
      const entry = inactive.shift();
      stats.evicted += 1;
      discard(entry);
      if (entry.host.isConnected) render(entry.host, "inactive");
    }
  }

  // Runs only inside gate.dispatch: building, assigning and the one and only connection (of the
  // component and its children) are one synchronous step under one consumed permit.
  function construct(key, placeId, host) {
    const element = buildPlaceDetailsElement(doc, placeId);
    stats.constructed += 1;
    stats.placeAssignments += 1;
    const mount = parts(host).mount;
    const entry = { key, placeId, element, host, mount, state: "loading", lastUsed: ++uses, timer: null };
    element.addEventListener("gmp-load", () => settle(entry, "ready"));
    element.addEventListener("gmp-error", () => settle(entry, "error"));
    entry.timer = setTimer(() => settle(entry, "error"), timeoutMs);
    entries.set(key, entry);
    hostEntries.set(host, entry);
    mount.append(element);
    return entry;
  }

  // One outstanding reservation per key: rapid re-expansion while it is pending, or a later
  // expansion while its unused permit is still valid, never reserves twice. A permit that went
  // stale (expired, other month, hidden tab, clock doubt) is never reused.
  async function reservationFor(key, descriptor) {
    const expected = { kind: "details", placeId: descriptor.placeId };
    const held = grants.get(key);
    if (held) {
      const grant = await held;
      if (grant.granted && gate.usable(grant, expected)) return grant;
      if (grants.get(key) === held) grants.delete(key);
      if (!grant.granted && !["cancelled", "hidden", "month", "expired"].includes(grant.reason)) return grant;
    }
    const pending = gate.acquire({ kind: "details", planId: descriptor.planId, placeId: descriptor.placeId });
    grants.set(key, pending);
    const grant = await pending;
    if (!grant.granted && grants.get(key) === pending) grants.delete(key);
    return grant;
  }

  function refused(host, key, reason, wanted) {
    const state = refusalState(reason);
    if (state === "paused") denied.set(key, state);
    if (state && wanted()) render(host, state);
    return false;
  }

  async function show(host, descriptor, { explicit = true } = {}) {
    if (disposed || !host || !descriptor || !isGooglePlaceId(descriptor.placeId) || !descriptor.binding) return false;
    sweep();
    const key = keyOf(descriptor);
    descriptors.set(host, descriptor);
    host.dataset.googlePlaceKey = key;
    // One component per host: a host now used for another key drops its old component.
    const resident = hostEntries.get(host);
    if (resident && resident.key !== key) discard(resident);
    if (activeKey !== key || activeHost !== host) leaveActive();
    activeKey = key;
    activeHost = host;
    const ticket = ++generation;
    stats.shows += 1;
    if (failed.has(key)) { render(host, "error"); return false; }
    if (denied.has(key)) { render(host, denied.get(key)); return false; }
    const existing = entries.get(key);
    if (existing && existing.host === host && live(existing)) {
      // The same host still holds it: unhide. No reservation, no call, no connection callback.
      existing.lastUsed = ++uses;
      stats.reused += 1;
      render(host, existing.state);
      return true;
    }
    // Held by some other host: it is never moved here. Remove it; this host starts afresh.
    if (existing) discard(existing);
    // A re-render restore never reserves or builds: the user decides.
    if (!explicit) { render(host, "inactive"); return false; }
    render(host, "loading");
    const wanted = () => !disposed && ticket === generation && activeKey === key && activeHost === host && host.isConnected;
    const expected = () => ({ kind: "details", placeId: descriptor.placeId, isCurrent: () => wanted() && isCurrent(descriptor) === true });
    const grant = await reservationFor(key, descriptor);
    if (!wanted()) return false;
    if (!grant.granted) {
      const state = denialState(grant.reason);
      if (state === "limit" || state === "paused") denied.set(key, state);
      if (state) render(host, state);
      return false;
    }
    // Checked synchronously before anything may bootstrap the SDK.
    const before = gate.check(grant, expected());
    if (before) return refused(host, key, before, wanted);
    try { await loader.load(grant.apiKey); }
    catch {
      if (wanted()) render(host, "error");
      return false;
    }
    // Collapsed, replaced by another plan, re-rendered or invalidated while loading: build nothing.
    if (!wanted()) return false;
    let entry = null;
    const outcome = gate.dispatch(grant, expected(), () => { entry = construct(key, descriptor.placeId, host); });
    if (grants.get(key)) grants.delete(key);
    // An expired permit (for example after a very slow SDK load), a hidden tab or a new provider
    // month: offer an explicit control. A permit is never reused for a different attempt.
    if (!outcome.dispatched) return refused(host, key, outcome.reason, wanted);
    render(host, entry.state);
    evict();
    return true;
  }

  function retry(host) {
    const descriptor = descriptors.get(host);
    if (!descriptor) return;
    const key = keyOf(descriptor);
    failed.delete(key);
    denied.delete(key);
    gate.unblock?.();
    loader.reset?.();
    show(host, descriptor);
  }

  return {
    show,
    restore: (host, descriptor) => show(host, descriptor, { explicit: false }),
    keyOf,
    isActive: (descriptor) => Boolean(activeKey) && activeKey === keyOf(descriptor),
    /** An open plan that is not the active one: offer an explicit control, build and load nothing. */
    idle(host, descriptor) {
      if (disposed || !host || !descriptor) return;
      sweep();
      const key = keyOf(descriptor);
      descriptors.set(host, descriptor);
      host.dataset.googlePlaceKey = key;
      const resident = hostEntries.get(host);
      if (resident && resident.key !== key) discard(resident);
      render(host, failed.has(key) ? "error" : denied.get(key) || "inactive");
    },
    /** The plan was collapsed: cancel any pending show; its component stays hidden in its host. */
    deactivate(descriptor) {
      if (!descriptor || !activeKey || activeKey !== keyOf(descriptor)) return;
      leaveActive();
    },
    /**
     * A re-render is about to replace every host inside root: their components are removed for good
     * now (never moved into the new cards). The active plan stays remembered, so its restored card
     * gets restore() and an explicit control; a pending show for the old host is cancelled, but its
     * reservation (if still valid) can serve that explicit control.
     */
    releaseWithin(root) {
      if (!root) return;
      const inside = (host) => host === root || (typeof root.contains === "function" && root.contains(host));
      for (const entry of [...entries.values()]) {
        if (inside(entry.host)) { stats.released += 1; discard(entry); }
      }
      if (activeHost && inside(activeHost)) { activeHost = null; generation += 1; }
    },
    /** Drop components, failure/denial marks and pending reservations no longer current. */
    retain(validKeys) {
      const keep = validKeys instanceof Set ? validKeys : new Set(validKeys);
      for (const entry of [...entries.values()]) if (!keep.has(entry.key)) discard(entry);
      for (const key of [...failed]) if (!keep.has(key)) failed.delete(key);
      for (const key of [...denied.keys()]) if (!keep.has(key)) denied.delete(key);
      for (const key of [...grants.keys()]) if (!keep.has(key)) grants.delete(key);
      if (activeKey && !keep.has(activeKey)) { activeKey = ""; activeHost = null; generation += 1; }
    },
    dispose() {
      disposed = true;
      generation += 1;
      for (const entry of [...entries.values()]) discard(entry);
      grants.clear();
      activeKey = "";
      activeHost = null;
    },
    get activeKey() { return activeKey; },
    get retainedCount() { return entries.size; },
    get stats() { return { ...stats }; }
  };
}

// ---------------------------------------------------------------------------------------------
// Editor: official selectable search and Place ID preview. Nothing is selected automatically.

/**
 * One selectable search element per editor session, built only on an explicit search. Every new
 * query needs its own permit; re-searching the text already on screen, or repeating a search that
 * is still being reserved, sends nothing new. onSelect(placeId) runs only when the user picks a
 * result in the official list; there is no first-result or best-match selection. onStatus(key)
 * reports progress. isCurrent() is the editor's own check right before a dispatch.
 */
export function createPlaceSearchSession({
  doc, loader, gate, mount, isCurrent = () => true, onSelect, onStatus, timeoutMs = COMPONENT_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  let element = null;
  let request = null;
  let token = 0;
  let disposed = false;
  let timer = null;
  let waiting = false;
  let inFlight = null;
  const stats = { constructed: 0, queries: 0 };
  const status = (key) => { if (!disposed && key) onStatus?.(key); };
  const settle = (key) => {
    if (!waiting) return;
    waiting = false;
    clearTimer(timer);
    timer = null;
    status(key);
  };

  function build() {
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
  }

  async function run(query, ticket) {
    const wanted = () => !disposed && ticket === token;
    const grant = await gate.acquire({ kind: "search" });
    if (!wanted()) return false;
    if (!grant.granted) { status(denialStatus(grant.reason, "searchFailed")); return false; }
    const expected = { kind: "search", placeId: "", isCurrent: () => wanted() && isCurrent() === true };
    // Checked synchronously before anything may bootstrap the SDK.
    const before = gate.check(grant, expected);
    if (before) { if (wanted()) status(refusalStatus(before, "searchFailed")); return false; }
    try { await loader.load(grant.apiKey); }
    catch {
      if (wanted()) status("searchFailed");
      return false;
    }
    if (!wanted()) return false;
    const outcome = gate.dispatch(grant, expected, () => {
      // Building, connecting and the new text query happen together under this one permit.
      if (!element) { build(); mount.append(element); }
      waiting = true;
      clearTimer(timer);
      timer = setTimer(() => settle("searchFailed"), timeoutMs);
      request.setAttribute("text-query", query);
      stats.queries += 1;
    });
    if (!outcome.dispatched) { if (wanted()) status(refusalStatus(outcome.reason, "searchFailed")); return false; }
    return true;
  }

  function search(query) {
    if (disposed) return Promise.resolve(false);
    if (element && request.getAttribute("text-query") === query && !inFlight) {
      // The same official results are already on screen; no new request is made.
      status("chooseResult");
      return Promise.resolve(true);
    }
    if (inFlight?.query === query) return inFlight.promise;
    const ticket = ++token;
    status("searching");
    const promise = run(query, ticket);
    inFlight = { query, promise };
    promise.finally(() => { if (inFlight?.promise === promise) inFlight = null; }).catch(() => {});
    return promise;
  }

  return {
    search,
    dispose() {
      disposed = true;
      token += 1;
      waiting = false;
      inFlight = null;
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
  doc, loader, gate, mount, isCurrent = () => true, onStatus, timeoutMs = COMPONENT_TIMEOUT_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
}) {
  let element = null;
  let placeId = "";
  let token = 0;
  let disposed = false;
  let timer = null;
  let ready = false;
  let inFlight = null;
  const stats = { constructed: 0 };
  const status = (key) => { if (!disposed && key) onStatus?.(key); };

  function clear() {
    clearTimer(timer);
    timer = null;
    element?.remove();
    element = null;
    placeId = "";
    ready = false;
  }

  async function run(id, ticket) {
    const wanted = () => !disposed && ticket === token;
    const grant = await gate.acquire({ kind: "preview", placeId: id });
    if (!wanted()) return false;
    if (!grant.granted) { status(denialStatus(grant.reason, "detailsUnavailable")); return false; }
    const expected = { kind: "preview", placeId: id, isCurrent: () => wanted() && isCurrent() === true };
    // Checked synchronously before anything may bootstrap the SDK.
    const before = gate.check(grant, expected);
    if (before) { if (wanted()) status(refusalStatus(before, "detailsUnavailable")); return false; }
    try { await loader.load(grant.apiKey); }
    catch {
      if (wanted()) status("detailsUnavailable");
      return false;
    }
    if (!wanted()) return false;
    const finish = (ok) => {
      if (ticket !== token || disposed || ready || !timer) return;
      clearTimer(timer);
      timer = null;
      if (ok) { ready = true; status("previewReady"); }
      else { clear(); status("detailsUnavailable"); }
    };
    const outcome = gate.dispatch(grant, expected, () => {
      placeId = id;
      element = buildPlaceDetailsElement(doc, id);
      stats.constructed += 1;
      element.addEventListener("gmp-load", () => finish(true));
      element.addEventListener("gmp-error", () => finish(false));
      timer = setTimer(() => finish(false), timeoutMs);
      mount.append(element);
    });
    if (!outcome.dispatched) { if (wanted()) status(refusalStatus(outcome.reason, "detailsUnavailable")); return false; }
    return true;
  }

  function preview(id) {
    if (disposed || !isGooglePlaceId(id)) return Promise.resolve(false);
    if (id === placeId && element) { status(ready ? "previewReady" : "previewLoading"); return Promise.resolve(true); }
    if (inFlight?.id === id) return inFlight.promise;
    const ticket = ++token;
    clear();
    status("previewLoading");
    const promise = run(id, ticket);
    inFlight = { id, promise };
    promise.finally(() => { if (inFlight?.promise === promise) inFlight = null; }).catch(() => {});
    return promise;
  }

  return {
    preview,
    dispose() { disposed = true; token += 1; inFlight = null; clear(); },
    get readyPlaceId() { return ready ? placeId : ""; },
    get stats() { return { ...stats }; }
  };
}
