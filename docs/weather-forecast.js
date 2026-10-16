// Open-Meteo forecasts for the trip's daily weather associations.
//
// The forecast state is a trip-scoped controller recomputed from the CURRENT trip on every update:
// plan coordinates, dates, the trip time zone and weather choices change the associations and the
// fetch identity; language, notes and other unrelated edits do not. Forecasts are kept in memory
// only (never localStorage, IndexedDB or the service worker, in any mode). Last-known data for a
// point is kept only while the same point and time zone are still needed.
import {
  FORECAST_HORIZON_DAYS,
  forecastRequestPlan,
  isValidCoordinate,
  pointKey,
  resolveTripWeather
} from "./weather-association.js?v=v-7f36dcbf02d6";

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const WEATHER_REQUEST_TIMEOUT_MS = 10000;

export const DAILY_FIELDS = Object.freeze([
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "uv_index_max",
  "sunrise",
  "sunset"
]);

export const HOURLY_FIELDS = Object.freeze([
  "temperature_2m",
  "precipitation_probability",
  "uv_index"
]);

/** The exact request URL for one bounded batch of points (same endpoint, fields and units as before). */
export function forecastRequestUrl(points, timezone) {
  const params = new URLSearchParams({
    latitude: points.map((point) => point.lat).join(","),
    longitude: points.map((point) => point.lng).join(","),
    daily: DAILY_FIELDS.join(","),
    hourly: HOURLY_FIELDS.join(","),
    timezone: timezone || "UTC",
    temperature_unit: "celsius",
    wind_speed_unit: "kmh",
    precipitation_unit: "mm",
    forecast_days: String(FORECAST_HORIZON_DAYS)
  });
  return `${OPEN_METEO_FORECAST_URL}?${params}`;
}

/** Fetch one batch. Resolves to { [pointKey]: { daily, hourly } } or throws. */
export async function fetchForecastBatch(points, timezone, { fetchImpl = (...args) => globalThis.fetch(...args), signal, timeoutMs = WEATHER_REQUEST_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = setTimer(abort, timeoutMs);
  let response;
  try {
    response = await fetchImpl(forecastRequestUrl(points, timezone), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
  } finally {
    clearTimer(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
  if (!response.ok) throw new Error(`Weather API returned ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(payload.reason || "Weather API error");
  const results = Array.isArray(payload) ? payload : [payload];
  if (results.length !== points.length) throw new Error("Weather location count did not match");
  const out = {};
  results.forEach((result, index) => {
    const position = Number.isInteger(result?.location_id) && points[result.location_id] ? result.location_id : index;
    const point = points[position];
    if (point) out[point.key] = { daily: normalizeDailyForecast(result?.daily), hourly: normalizeHourlyForecast(result?.hourly) };
  });
  return out;
}

/**
 * Trip-scoped forecast controller.
 *   update(trip, { enabled }) -> recompute associations; returns true when new points are needed
 *   refresh({ force })        -> fetch missing or (when forced/stale) all needed points
 *   day(dayId)                -> { mode, entries[] } with forecast lookups
 *   dispose()                 -> stop; late responses are ignored for good
 * Injected fetch and clock make it testable without the provider.
 */
export function createWeatherForecastController({
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  onChange = () => {},
  refreshIntervalMs = WEATHER_REFRESH_INTERVAL_MS,
  timeoutMs = WEATHER_REQUEST_TIMEOUT_MS,
  setTimer = (...args) => setTimeout(...args),
  clearTimer = (...args) => clearTimeout(...args),
  // False once the page has lost its session/trip: the controller then stops for good.
  isActive = () => true
} = {}) {
  let resolved = resolveTripWeather({ days: [] });
  let plan = forecastRequestPlan(resolved, { nowMs: now() });
  let enabled = true;
  let disposed = false;
  let generation = 0;
  let inflight = null;
  let abortController = null;
  // pointKey -> { timezone, daily, hourly, fetchedAt }
  const data = new Map();
  let status = "idle";
  let lastError = null;

  const neededKeys = () => plan.keys;
  const freshFor = (entry) => entry && entry.timezone === plan.timezone && now() - entry.fetchedAt < refreshIntervalMs;
  const hasAll = () => neededKeys().every((key) => data.get(key)?.timezone === plan.timezone);

  function notify() { if (!disposed) onChange(api.snapshot()); }
  function stillActive() {
    if (disposed) return false;
    if (isActive()) return true;
    api.dispose();
    return false;
  }

  function invalidateInflight() {
    generation += 1;
    abortController?.abort();
    abortController = null;
    inflight = null;
  }

  function prune() {
    const needed = new Set(neededKeys());
    for (const [key, entry] of data) if (!needed.has(key) || entry.timezone !== plan.timezone) data.delete(key);
  }

  const api = {
    update(trip, { enabled: nextEnabled = true } = {}) {
      if (!stillActive()) return false;
      resolved = resolveTripWeather(trip);
      const nextPlan = forecastRequestPlan(resolved, { nowMs: now() });
      const enabledChanged = nextEnabled !== enabled;
      enabled = nextEnabled;
      if (!enabled) {
        if (inflight || data.size || enabledChanged) { invalidateInflight(); data.clear(); status = "idle"; }
        plan = nextPlan;
        return false;
      }
      if (nextPlan.identity === plan.identity && !enabledChanged) {
        // Same needed points and time zone: renders, polls, language changes and unrelated edits
        // never start a request (retries after a failure wait for the refresh interval or resume).
        plan = nextPlan;
        return false;
      }
      plan = nextPlan;
      invalidateInflight();
      prune();
      if (!plan.keys.length) status = "idle";
      else if (!hasAll()) status = data.size ? "refreshing" : "loading";
      return !hasAll();
    },

    async refresh({ force = false } = {}) {
      if (!stillActive() || !enabled) return null;
      const keys = neededKeys();
      if (!keys.length) {
        status = "idle";
        return null;
      }
      const due = force ? keys : keys.filter((key) => !freshFor(data.get(key)));
      if (!due.length) return null;
      if (inflight) return inflight.promise;
      const myGeneration = generation;
      const timezone = plan.timezone;
      const batches = plan.batches
        .map((batch) => batch.filter((point) => due.includes(point.key)))
        .filter((batch) => batch.length);
      abortController = new AbortController();
      const signal = abortController.signal;
      status = data.size ? "refreshing" : "loading";
      lastError = null;
      notify();
      const promise = (async () => {
        let failure = null;
        for (const batch of batches) {
          if (myGeneration !== generation || !stillActive()) return;
          try {
            const result = await fetchForecastBatch(batch, timezone, { fetchImpl, signal, timeoutMs, setTimer, clearTimer });
            if (myGeneration !== generation || !stillActive()) return;
            const fetchedAt = now();
            for (const [key, value] of Object.entries(result)) data.set(key, { timezone, ...value, fetchedAt });
          } catch (error) {
            if (myGeneration !== generation || !stillActive()) return;
            failure = error;
          }
        }
        if (myGeneration !== generation || !stillActive()) return;
        inflight = null;
        abortController = null;
        if (failure) {
          lastError = failure;
          status = keys.some((key) => data.has(key)) ? "saved" : "error";
          console.warn("Live weather forecast unavailable", failure);
        } else status = "live";
        notify();
      })();
      inflight = { promise, generation: myGeneration };
      try {
        return await promise;
      } finally {
        if (inflight?.promise === promise) inflight = null;
      }
    },

    day(dayId) {
      const day = resolved.days.get(dayId);
      if (!day) return { dayId, date: "", mode: "auto", source: "auto", entries: [] };
      return day;
    },

    daily(key, date) {
      const entry = data.get(key);
      return entry && entry.timezone === plan.timezone ? entry.daily?.[date] || null : null;
    },

    hourly(key, date) {
      const entry = data.get(key);
      return entry && entry.timezone === plan.timezone ? entry.hourly?.[date] || [] : [];
    },

    snapshot() {
      const times = neededKeys().map((key) => data.get(key)?.fetchedAt).filter(Number.isFinite);
      return {
        status,
        error: lastError,
        hasData: neededKeys().some((key) => data.has(key)),
        neededPoints: neededKeys().length,
        fetchedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
        identity: plan.identity,
        timezone: plan.timezone
      };
    },

    get resolved() { return resolved; },
    get plan() { return plan; },

    dispose() {
      disposed = true;
      invalidateInflight();
      data.clear();
    }
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// Earlier exports, kept for compatibility. They describe the embedded seed only and are no longer
// used by the trip page, which follows the current trip through createWeatherForecastController.

function readSeedTrip() {
  try {
    return JSON.parse(document.getElementById("trip-data")?.textContent || "{}");
  } catch {
    return {};
  }
}

const seedTrip = readSeedTrip();
const SEED_WEATHER = seedTrip.weather && typeof seedTrip.weather === "object" ? seedTrip.weather : {};

export const FORECAST_LOCATIONS = Object.freeze(
  (Array.isArray(SEED_WEATHER.locations) ? SEED_WEATHER.locations : [])
    .filter((location) => location && typeof location === "object" && location.id
      && isValidCoordinate(location.lat, location.lng))
    .map((location) => Object.freeze(location))
);

const KNOWN_LOCATION_IDS = new Set(FORECAST_LOCATIONS.map((location) => location.id));

export const DAY_FORECAST_LOCATIONS = Object.freeze(Object.fromEntries(
  (Array.isArray(seedTrip.days) ? seedTrip.days : []).filter((day) => day && day.id).map((day) => [
    day.id,
    Object.freeze(
      [].concat(SEED_WEATHER.dayLocations?.[day.id]
        || day.weatherLocationIds
        || []).filter((id) => KNOWN_LOCATION_IDS.has(id))
    )
  ])
));

/** Compatibility: fetch the seed's explicit locations, in memory only, keyed by location ID. */
export async function fetchTripForecast({ fetchImpl } = {}) {
  if (!FORECAST_LOCATIONS.length) return { fetchedAt: new Date().toISOString(), locations: {} };
  const points = FORECAST_LOCATIONS.map((location) => ({ key: pointKey(location.lat, location.lng), lat: location.lat, lng: location.lng }));
  const unique = [...new Map(points.map((point) => [point.key, point])).values()];
  const byKey = await fetchForecastBatch(unique, seedTrip.timezone || "UTC", fetchImpl ? { fetchImpl } : {});
  const locations = {};
  FORECAST_LOCATIONS.forEach((location, index) => {
    if (byKey[points[index].key]) locations[location.id] = byKey[points[index].key];
  });
  return { fetchedAt: new Date().toISOString(), locations };
}

/** Compatibility: forecasts are never persisted, so there is never a stored copy. */
export function loadCachedTripForecast() {
  return null;
}

/** Localized name of an explicit weather location (trip-scoped when `locations` is given). */
export function localizeForecastLocation(locationId, language, locations = FORECAST_LOCATIONS) {
  const list = locations instanceof Map ? [...locations.values()] : locations;
  const location = (Array.isArray(list) ? list : []).find((candidate) => candidate?.id === locationId);
  const localizedName = location?.i18n?.[language]?.name;
  if (localizedName) return localizedName;
  if (typeof location?.name === "string" && location.name) return location.name;
  return location?.name?.[language] || location?.name?.en || locationId;
}

export function weatherCodeKey(code) {
  return ({
    0: "weatherClear",
    1: "weatherMainlyClear",
    2: "weatherPartlyCloudy",
    3: "weatherOvercast",
    45: "weatherFog",
    48: "weatherRimeFog",
    51: "weatherLightDrizzle",
    53: "weatherModerateDrizzle",
    55: "weatherDenseDrizzle",
    56: "weatherLightFreezingDrizzle",
    57: "weatherDenseFreezingDrizzle",
    61: "weatherLightRain",
    63: "weatherModerateRain",
    65: "weatherHeavyRain",
    66: "weatherLightFreezingRain",
    67: "weatherHeavyFreezingRain",
    71: "weatherLightSnow",
    73: "weatherModerateSnow",
    75: "weatherHeavySnow",
    77: "weatherSnowGrains",
    80: "weatherLightShowers",
    81: "weatherModerateShowers",
    82: "weatherViolentShowers",
    85: "weatherLightSnowShowers",
    86: "weatherHeavySnowShowers",
    95: "weatherThunderstorm",
    96: "weatherThunderstormLightHail",
    99: "weatherThunderstormHeavyHail"
  })[code] || "weatherUnknown";
}

export function weatherCodeIcon(code) {
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "🌤️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌧️";
}

export function normalizeDailyForecast(daily = {}) {
  const dates = Array.isArray(daily?.time) ? daily.time : [];
  return Object.fromEntries(dates.map((date, index) => [date, {
    weatherCode: numericValue(daily.weather_code?.[index]),
    temperatureMax: numericValue(daily.temperature_2m_max?.[index]),
    temperatureMin: numericValue(daily.temperature_2m_min?.[index]),
    apparentMax: numericValue(daily.apparent_temperature_max?.[index]),
    apparentMin: numericValue(daily.apparent_temperature_min?.[index]),
    precipitationProbability: numericValue(daily.precipitation_probability_max?.[index]),
    precipitationSum: numericValue(daily.precipitation_sum?.[index]),
    windSpeedMax: numericValue(daily.wind_speed_10m_max?.[index]),
    windGustMax: numericValue(daily.wind_gusts_10m_max?.[index]),
    uvIndexMax: numericValue(daily.uv_index_max?.[index]),
    sunrise: daily.sunrise?.[index] || null,
    sunset: daily.sunset?.[index] || null
  }]));
}

export function normalizeHourlyForecast(hourly = {}) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const days = {};
  times.forEach((value, index) => {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (!match) return;
    const point = {
      time: match[2],
      temperature: numericValue(hourly.temperature_2m?.[index]),
      precipitationProbability: numericValue(hourly.precipitation_probability?.[index]),
      uvIndex: numericValue(hourly.uv_index?.[index])
    };
    (days[match[1]] ||= []).push(point);
  });
  return days;
}

function numericValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
