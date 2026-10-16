// Self-hosted trip page entry. Loads exactly the trip named in /trips/<id>,
// places it in #trip-data, then starts the regular app modules (which read the
// seed synchronously while they initialize).
import {
  LANGUAGE_STORAGE_KEY,
  clearProtectedBrowserState,
  expectTrip,
  hostedApi,
  loginUrl,
  scriptSafeJSON,
  setBootSession,
  setBootTrip,
  toRenderTrip,
  tripIdFromPath
} from "./hosted-client.js?v=v-37500925c97c";

const MAX_AUTOMATIC_ATTEMPTS = 4;
const STRINGS = {
  en: {
    loading: "Opening trip…",
    offline: "This trip can’t be reached right now.",
    offlineHint: "Check your connection. Trips are only shown while connected.",
    retry: "Try again",
    retrying: "Trying again…",
    login: "Sign in to view this trip.",
    loginButton: "Sign in",
    notFound: "This trip isn’t available.",
    notFoundHint: "It may have been removed, or the link is incomplete.",
    allTrips: "All trips",
    loadError: "The trip page could not start.",
    reload: "Reload"
  },
  "zh-Hans": {
    loading: "正在打开行程…",
    offline: "暂时无法连接到这趟行程。",
    offlineHint: "请检查网络连接。行程仅在联网时显示。",
    retry: "重试",
    retrying: "正在重试…",
    login: "请登录后查看这趟行程。",
    loginButton: "登录",
    notFound: "这趟行程不可用。",
    notFoundHint: "它可能已被移除，或链接不完整。",
    allTrips: "全部行程",
    loadError: "行程页面无法启动。",
    reload: "重新加载"
  },
  "zh-Hant": {
    loading: "正在開啟行程…",
    offline: "暫時無法連線到這趟行程。",
    offlineHint: "請檢查網路連線。行程僅在連線時顯示。",
    retry: "重試",
    retrying: "正在重試…",
    login: "請登入後查看這趟行程。",
    loginButton: "登入",
    notFound: "這趟行程無法使用。",
    notFoundHint: "它可能已被移除，或連結不完整。",
    allTrips: "全部行程",
    loadError: "行程頁面無法啟動。",
    reload: "重新載入"
  },
  ja: {
    loading: "旅行を開いています…",
    offline: "現在この旅行に接続できません。",
    offlineHint: "接続を確認してください。旅行は接続中のみ表示されます。",
    retry: "再試行",
    retrying: "再試行しています…",
    login: "この旅行を見るにはサインインしてください。",
    loginButton: "サインイン",
    notFound: "この旅行は利用できません。",
    notFoundHint: "削除されたか、リンクが不完全な可能性があります。",
    allTrips: "すべての旅行",
    loadError: "旅行ページを開始できませんでした。",
    reload: "再読み込み"
  }
};

const language = preferredLanguage();
const text = (key) => STRINGS[language]?.[key] || STRINGS.en[key];
const tripId = tripIdFromPath(location.pathname);
let attempts = 0;
let retryTimer = null;
let loading = false;
let started = false;

document.documentElement.classList.add("hosted-booting");
const overlay = createOverlay();

window.addEventListener("online", () => {
  if (!started && !loading && overlay.dataset.state === "offline") {
    attempts = 0;
    load();
  }
});
window.addEventListener("pageshow", (event) => {
  // Never show a restored copy of protected content from the back/forward cache.
  if (event.persisted) location.reload();
});

if (!tripId) {
  showState("not-found");
} else {
  load();
}

async function load() {
  clearTimeout(retryTimer);
  if (loading || started) return;
  loading = true;
  attempts += 1;
  showState(attempts > 1 ? "retrying" : "loading");
  try {
    // The session role only shapes the UI (owner editor or read-only viewer);
    // the server rejects viewer writes regardless.
    const [payload, session] = await Promise.all([hostedApi.getTrip(tripId), hostedApi.session()]);
    const trip = expectTrip(payload, tripId);
    loading = false;
    setBootSession(session);
    await start(trip);
  } catch (error) {
    loading = false;
    if (error?.status === 401) {
      await clearProtectedBrowserState();
      showState("login");
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
  setBootTrip(trip);
  seed.textContent = scriptSafeJSON(toRenderTrip(trip));
  try {
    await import("./app.js?v=v-37500925c97c");
    overlay.remove();
    document.documentElement.classList.remove("hosted-booting");
  } catch (error) {
    console.error("Trip page failed to start", error);
    seed.textContent = "";
    setBootTrip(null);
    setBootSession(null);
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

function createOverlay() {
  const node = document.createElement("section");
  node.className = "hosted-boot";
  node.setAttribute("role", "status");
  node.setAttribute("aria-live", "polite");
  document.body.prepend(node);
  return node;
}

function showState(state) {
  overlay.dataset.state = state;
  const card = document.createElement("div");
  card.className = "hosted-boot__card";
  const icon = document.createElement("img");
  icon.className = "hosted-boot__icon";
  icon.src = "/icons/icon-192.png";
  icon.alt = "";
  icon.width = 64;
  icon.height = 64;
  const title = document.createElement("p");
  title.className = "hosted-boot__title";
  const hint = document.createElement("p");
  hint.className = "hosted-boot__hint";
  const actions = document.createElement("div");
  actions.className = "hosted-boot__actions";
  card.append(icon, title, hint, actions);

  const allTrips = link(text("allTrips"), "/", "button button--quiet");
  if (state === "loading" || state === "retrying") {
    title.textContent = text(state === "loading" ? "loading" : "retrying");
    card.setAttribute("aria-busy", "true");
  } else if (state === "offline") {
    title.textContent = text("offline");
    hint.textContent = text("offlineHint");
    const retry = button(text("retry"), () => {
      attempts = 0;
      load();
    });
    actions.append(retry, allTrips);
  } else if (state === "login") {
    title.textContent = text("login");
    actions.append(link(text("loginButton"), loginUrl(`${location.pathname}${location.search}`), "button"));
  } else if (state === "not-found") {
    title.textContent = text("notFound");
    hint.textContent = text("notFoundHint");
    actions.append(link(text("allTrips"), "/", "button"));
  } else {
    title.textContent = text("loadError");
    actions.append(button(text("reload"), () => location.reload()), allTrips);
  }
  overlay.replaceChildren(card);
}

function button(label, onClick) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "button";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

function link(label, href, className) {
  const node = document.createElement("a");
  node.className = className;
  node.href = href;
  node.textContent = label;
  return node;
}
