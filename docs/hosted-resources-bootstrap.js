// Self-hosted resources page entry: /resources.html?tripId=<id>.
// Loads the authenticated trip, fills #trip-data, then starts resources.js.
import {
  LANGUAGE_STORAGE_KEY,
  createTripPoller,
  clearProtectedBrowserState,
  expectTrip,
  hostedApi,
  loginUrl,
  redirectToLogin,
  scriptSafeJSON,
  toRenderTrip,
  tripIdFromQuery,
  tripPath
} from "./hosted-client.js?v=v-3a14a0772b6d";
import { createLinkActivationGuard } from "./link-activation.js?v=v-3a14a0772b6d";

const MAX_AUTOMATIC_ATTEMPTS = 4;
// A newer trip version reloads the page; never while a press on a resource or booking link is in
// progress, so the browser can open that link first (see link-activation.js).
const linkGuard = createLinkActivationGuard({ root: document });
const STRINGS = {
  en: { loading: "Loading…", offline: "This page can’t be reached right now.", retry: "Try again", notFound: "This trip isn’t available.", allTrips: "All trips", loadError: "This page could not start.", reload: "Reload" },
  "zh-Hans": { loading: "正在加载…", offline: "暂时无法打开此页面。", retry: "重试", notFound: "这趟行程不可用。", allTrips: "全部行程", loadError: "此页面无法启动。", reload: "重新加载" },
  "zh-Hant": { loading: "正在載入…", offline: "暫時無法開啟此頁面。", retry: "重試", notFound: "這趟行程無法使用。", allTrips: "全部行程", loadError: "此頁面無法啟動。", reload: "重新載入" },
  ja: { loading: "読み込み中…", offline: "現在このページに接続できません。", retry: "再試行", notFound: "この旅行は利用できません。", allTrips: "すべての旅行", loadError: "このページを開始できませんでした。", reload: "再読み込み" }
};

const language = preferredLanguage();
const text = (key) => STRINGS[language]?.[key] || STRINGS.en[key];
const tripId = tripIdFromQuery(location.search);
let attempts = 0;
let retryTimer = null;
let loading = false;
let started = false;

document.documentElement.classList.add("hosted-booting");
const overlay = document.createElement("section");
overlay.className = "hosted-boot";
overlay.setAttribute("role", "status");
overlay.setAttribute("aria-live", "polite");
document.body.prepend(overlay);

window.addEventListener("online", () => {
  if (!started && !loading && overlay.dataset.state === "offline") {
    attempts = 0;
    load();
  }
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});

if (!tripId) showState("not-found");
else load();

async function load() {
  clearTimeout(retryTimer);
  if (loading || started) return;
  loading = true;
  attempts += 1;
  showState("loading");
  try {
    const trip = expectTrip(await hostedApi.getTrip(tripId), tripId);
    loading = false;
    await start(trip);
  } catch (error) {
    loading = false;
    if (error?.status === 401) {
      await clearProtectedBrowserState();
      location.replace(loginUrl(`${location.pathname}${location.search}`));
      return;
    }
    if (error?.status === 404 || error?.status === 403 || error?.code === "trip_mismatch") {
      await clearProtectedBrowserState();
      showState("not-found");
      return;
    }
    showState("offline");
    if (attempts < MAX_AUTOMATIC_ATTEMPTS && navigator.onLine !== false) {
      retryTimer = setTimeout(load, Math.min(15000, 1500 * (2 ** (attempts - 1))));
    }
  }
}

async function start(trip) {
  started = true;
  const seed = document.getElementById("trip-data");
  if (!seed) {
    showState("load-error");
    return;
  }
  seed.textContent = scriptSafeJSON(toRenderTrip(trip));
  const backHref = tripPath(tripId);
  document.querySelectorAll(".back-link").forEach((node) => { node.href = backHref; });
  try {
    await import("./resources.js?v=v-3a14a0772b6d");
    overlay.remove();
    document.documentElement.classList.remove("hosted-booting");
    const poller = createTripPoller({
      load: () => hostedApi.getTrip(tripId),
      onData: (payload) => { if (expectTrip(payload, tripId).version !== trip.version) linkGuard.whenIdle("reload", () => location.reload()); },
      onError: (error, { final }) => {
        if (!final) return;
        poller.stop();
        linkGuard.cancel("reload");
        document.querySelector("main")?.replaceChildren();
        if (error.status === 401) redirectToLogin();
        else {
          seed.textContent = "";
          document.body.prepend(overlay);
          document.documentElement.classList.add("hosted-booting");
          showState("not-found");
        }
      }
    });
    poller.start();
  } catch (error) {
    console.error("Resources page failed to start", error);
    seed.textContent = "";
    showState("load-error");
  }
}

function preferredLanguage() {
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (saved && STRINGS[saved]) return saved;
  } catch {
    // Fall back to the browser language.
  }
  const browser = String(navigator.language || "en").toLowerCase();
  if (/^zh(?:-|$)/.test(browser)) return /(?:hant|tw|hk|mo)/.test(browser) ? "zh-Hant" : "zh-Hans";
  if (browser.startsWith("ja")) return "ja";
  return "en";
}

function showState(state) {
  overlay.dataset.state = state;
  const card = document.createElement("div");
  card.className = "hosted-boot__card";
  const title = document.createElement("p");
  title.className = "hosted-boot__title";
  const actions = document.createElement("div");
  actions.className = "hosted-boot__actions";
  card.append(title, actions);
  const allTrips = document.createElement("a");
  allTrips.className = "button button--quiet";
  allTrips.href = "/";
  allTrips.textContent = text("allTrips");
  if (state === "loading") {
    title.textContent = text("loading");
  } else if (state === "offline") {
    title.textContent = text("offline");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "button";
    retry.textContent = text("retry");
    retry.addEventListener("click", () => {
      attempts = 0;
      load();
    });
    actions.append(retry, allTrips);
  } else if (state === "not-found") {
    title.textContent = text("notFound");
    allTrips.className = "button";
    actions.append(allTrips);
  } else {
    title.textContent = text("loadError");
    const reload = document.createElement("button");
    reload.type = "button";
    reload.className = "button";
    reload.textContent = text("reload");
    reload.addEventListener("click", () => location.reload());
    actions.append(reload, allTrips);
  }
  overlay.replaceChildren(card);
}
