const APP_BASE_URL = new URL("./", self.location.href);
const CACHE_PREFIX = `shared-trip:${APP_BASE_URL.pathname}:`;
const CACHE_NAME = CACHE_PREFIX + "tide-lines-sample-v-e9767c7cc0cf";
const appUrl = (value) => new URL(value.replace(/^\.?\//, ""), APP_BASE_URL).href;
const VERSIONED_RESOURCES_URL = "/resources.html?v=v-e9767c7cc0cf";
const LOCAL_SHELL = [
  "/",
  "/index.html",
  VERSIONED_RESOURCES_URL,
  "/styles.css?v=v-e9767c7cc0cf",
  "/app.js?v=v-e9767c7cc0cf",
  "/hosted-client.js?v=v-e9767c7cc0cf",
  "/photo-assets.js?v=v-e9767c7cc0cf",
  "/photos/manifest.js?v=v-e9767c7cc0cf",
  "/resources.js?v=v-e9767c7cc0cf",
  "/daily-guide.js?v=v-e9767c7cc0cf",
  "/i18n.js?v=v-e9767c7cc0cf",
  "/map-links.js?v=v-e9767c7cc0cf",
  "/link-activation.js?v=v-e9767c7cc0cf",
  "/text-links.js?v=v-e9767c7cc0cf",
  "/google-place-links.js?v=v-e9767c7cc0cf",
  "/google-maps-place-url.js?v=v-e9767c7cc0cf",
  "/place-picker.js?v=v-e9767c7cc0cf",
  "/google-place-association.js?v=v-e9767c7cc0cf",
  "/google-places-ui-kit.js?v=v-e9767c7cc0cf",
  "/reminder-dates.js?v=v-e9767c7cc0cf",
  "/weather-forecast.js?v=v-e9767c7cc0cf",
  "/weather-association.js?v=v-e9767c7cc0cf",
  "/weather-editor.js?v=v-e9767c7cc0cf",
  "/trip-branding.js?v=v-e9767c7cc0cf",
  "/branding-editor.js?v=v-e9767c7cc0cf",
  "/trip-presentation.js?v=v-e9767c7cc0cf",
  "/cover-editor.js?v=v-e9767c7cc0cf",
  "/trip-resources.js?v=v-e9767c7cc0cf",
  "/flight-bookings.js?v=v-e9767c7cc0cf",
  "/translations-zh-hant.js?v=v-e9767c7cc0cf",
  "/translations-zh-hans.js?v=v-e9767c7cc0cf",
  "/translations-ja.js?v=v-e9767c7cc0cf",
  "/firebase-config.js?v=v-e9767c7cc0cf",
  "/manifest.webmanifest?v=v-e9767c7cc0cf",
  "/icons/icon-192.png?v=v-e9767c7cc0cf",
  "/icons/icon-512.png?v=v-e9767c7cc0cf",
  "/icons/apple-touch-icon.png?v=v-e9767c7cc0cf",
  "/icons/icon.svg?v=v-e9767c7cc0cf"
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
