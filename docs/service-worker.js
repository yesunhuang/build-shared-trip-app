const APP_BASE_URL = new URL("./", self.location.href);
const CACHE_PREFIX = `shared-trip:${APP_BASE_URL.pathname}:`;
const CACHE_NAME = CACHE_PREFIX + "tide-lines-sample-v-95ab054857fb";
const appUrl = (value) => new URL(value.replace(/^\.?\//, ""), APP_BASE_URL).href;
const VERSIONED_RESOURCES_URL = "/resources.html?v=v-95ab054857fb";
const LOCAL_SHELL = [
  "/",
  "/index.html",
  VERSIONED_RESOURCES_URL,
  "/styles.css?v=v-95ab054857fb",
  "/app.js?v=v-95ab054857fb",
  "/hosted-client.js?v=v-95ab054857fb",
  "/photo-assets.js?v=v-95ab054857fb",
  "/photos/manifest.js?v=v-95ab054857fb",
  "/resources.js?v=v-95ab054857fb",
  "/daily-guide.js?v=v-95ab054857fb",
  "/i18n.js?v=v-95ab054857fb",
  "/map-links.js?v=v-95ab054857fb",
  "/link-activation.js?v=v-95ab054857fb",
  "/text-links.js?v=v-95ab054857fb",
  "/google-place-links.js?v=v-95ab054857fb",
  "/google-maps-place-url.js?v=v-95ab054857fb",
  "/place-picker.js?v=v-95ab054857fb",
  "/google-place-association.js?v=v-95ab054857fb",
  "/google-places-ui-kit.js?v=v-95ab054857fb",
  "/reminder-dates.js?v=v-95ab054857fb",
  "/weather-forecast.js?v=v-95ab054857fb",
  "/weather-association.js?v=v-95ab054857fb",
  "/weather-editor.js?v=v-95ab054857fb",
  "/trip-branding.js?v=v-95ab054857fb",
  "/branding-editor.js?v=v-95ab054857fb",
  "/trip-presentation.js?v=v-95ab054857fb",
  "/cover-editor.js?v=v-95ab054857fb",
  "/trip-resources.js?v=v-95ab054857fb",
  "/flight-bookings.js?v=v-95ab054857fb",
  "/translations-zh-hant.js?v=v-95ab054857fb",
  "/translations-zh-hans.js?v=v-95ab054857fb",
  "/translations-ja.js?v=v-95ab054857fb",
  "/firebase-config.js?v=v-95ab054857fb",
  "/manifest.webmanifest?v=v-95ab054857fb",
  "/icons/icon-192.png?v=v-95ab054857fb",
  "/icons/icon-512.png?v=v-95ab054857fb",
  "/icons/apple-touch-icon.png?v=v-95ab054857fb",
  "/icons/icon.svg?v=v-95ab054857fb"
];

const OPTIONAL_CDN_SHELL = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async (cache) => {
        await cache.addAll(LOCAL_SHELL.map(appUrl));
        const resourcesPage = await cache.match(appUrl(VERSIONED_RESOURCES_URL));
        if (resourcesPage) await cache.put(appUrl("resources.html"), resourcesPage.clone());
        await Promise.allSettled(OPTIONAL_CDN_SHELL.map((url) => cache.add(url)));
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isAppShell = url.origin === self.location.origin && url.pathname.startsWith(APP_BASE_URL.pathname);
  const appPath = isAppShell ? url.pathname.slice(APP_BASE_URL.pathname.length) : "";
  const isStaticCdn = ["unpkg.com", "www.gstatic.com"].includes(url.hostname)
    && ["script", "style"].includes(event.request.destination);

  if (!isAppShell && !isStaticCdn) return;

  const networkFirst = event.request.mode === "navigate"
    || (isAppShell && appPath === "firebase-config.js");

  if (networkFirst) {
    event.respondWith(
      fetch(event.request)
        .then(async (response) => {
          if (response && response.ok) {
            const copy = response.clone();
            const cacheKey = event.request.mode === "navigate"
              ? appUrl(appPath || "index.html")
              : event.request;
            await (await caches.open(CACHE_NAME)).put(cacheKey, copy);
          }
          return response;
        })
        .catch(() => caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match(appUrl(appPath || "index.html"))
              .then((page) => page || caches.match(appUrl("index.html")));
          }
          return Promise.reject(new Error("Network and cached configuration are unavailable"));
        }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const versionedAsset = isAppShell && (url.searchParams.has("v")
        || /^photos\/[a-f0-9]+\.webp$/.test(appPath));
      if (cached && (versionedAsset || isStaticCdn)) return cached;
      const network = fetch(event.request)
        .then(async (response) => {
          if (response && (response.ok || response.type === "opaque")) {
            const copy = response.clone();
            await (await caches.open(CACHE_NAME)).put(event.request, copy);
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
