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
} from "./weather-association.js?v=v-a658691789ff";

export const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
export const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
// Covers headers AND the response body. Slow public requests can exceed ten seconds.
export const WEATHER_REQUEST_TIMEOUT_MS = 30000;
export const WEATHER_MAX_ATTEMPTS = 3;
export const WEATHER_RETRY_DELAYS_MS = Object.freeze([1500, 4000]);
export const WEATHER_MANUAL_COOLDOWN_MS = 5000;
const MAX_RETRY_WAIT_MS = 15000;

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

export class WeatherRequestError extends Error {
  constructor(code, { status = null, retryAfterMs = 0 } = {}) {
    super(code === "invalid_response" ? "Invalid weather response or location count" : `Weather request: ${code}`);
    this.name = "WeatherRequestError"; this.code = code; this.status = status; this.retryAfterMs = retryAfterMs;
    this.retryable = ["timeout", "network", "empty_response", "rate_limit"].includes(code) || code === "http" && (status === 408 || status >= 500);
  }
}

function retryAfter(response, nowMs) {
  const value = response.headers?.get?.("retry-after");
  if (!value) return 0;
  const delay = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) * 1000 : Date.parse(value) - nowMs;
  // Very long/invalid numeric waits must not overflow browser timers or trigger early retries.
  if (Number.isNaN(delay)) return 0;
  return Math.max(0, delay);
}

/** Partial batches keep only unambiguously identified, usable locations. Missing rows are errors. */
export function parseForecastPayload(points, payload) {
  if (!payload || typeof payload !== "object" || payload.error) throw new WeatherRequestError("invalid_response");
  const results = Array.isArray(payload) ? payload : [payload];
  if (!results.length) throw new WeatherRequestError("empty_response");
  const out = {}, failures = new Map(), seen = new Set(), duplicates = new Set();
  for (let index = 0; index < Math.min(results.length, points.length + 1); index += 1) {
    const result = results[index];
    if (!result || typeof result !== "object" || Array.isArray(result)) continue;
    const hasId = Object.hasOwn(result, "location_id") && result.location_id !== undefined;
    const position = hasId ? result.location_id : results.length === points.length ? index : -1;
    if (!Number.isInteger(position) || !points[position]) continue;
    const key = points[position].key;
    if (seen.has(key)) { duplicates.add(key); delete out[key]; continue; }
    seen.add(key);
    const daily = normalizeDailyForecast(result.daily), hourly = normalizeHourlyForecast(result.hourly);
    if (Object.values(daily).some(hasDailyMeasurements) || Object.values(hourly).flat().some(hasHourlyMeasurements)) out[key] = { daily, hourly };
    else failures.set(key, new WeatherRequestError(Array.isArray(result.daily?.time) || Array.isArray(result.hourly?.time) ? "empty_response" : "invalid_response"));
  }
  for (const point of points) if (duplicates.has(point.key) || !out[point.key] && !failures.has(point.key)) failures.set(point.key, new WeatherRequestError("invalid_response"));
  if (!Object.keys(out).length) throw failures.values().next().value || new WeatherRequestError("invalid_response");
  // Non-enumerable metadata preserves the existing point-map API and compatibility exports.
  Object.defineProperty(out, "failures", { value: failures });
  return out;
}

/** A single bounded request, including JSON parsing; caller cancellation remains active throughout. */
export async function fetchForecastBatch(points, timezone, { fetchImpl = (...args) => globalThis.fetch(...args), signal, timeoutMs = WEATHER_REQUEST_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout, now = () => Date.now(), isOnline = () => globalThis.navigator?.onLine !== false } = {}) {
  if (signal?.aborted) throw new WeatherRequestError("cancelled");
  if (!isOnline()) throw new WeatherRequestError("offline");
  const controller = new AbortController();
  let rejectAbort;
  const aborted = new Promise((resolve, reject) => { rejectAbort = reject; });
  const stop = (code) => { const error = new WeatherRequestError(code); controller.abort(error); rejectAbort(error); };
  const abort = () => stop("cancelled");
  signal?.addEventListener?.("abort", abort, { once: true });
  const timeout = setTimer(() => stop("timeout"), timeoutMs);
  try {
    const response = await Promise.race([fetchImpl(forecastRequestUrl(points, timezone), {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal
    }), aborted]);
    if (!response.ok) {
      const error = new WeatherRequestError(response.status === 429 ? "rate_limit" : "http", { status: response.status, retryAfterMs: retryAfter(response, now()) });
      controller.abort(error); // do not leave an unused error body downloading after headers
      throw error;
    }
    let payload;
    try { payload = await Promise.race([response.json(), aborted]); }
    catch (error) { if (controller.signal.aborted) throw controller.signal.reason; throw new WeatherRequestError("invalid_response"); }
    return parseForecastPayload(points, payload);
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof WeatherRequestError) throw error;
    throw new WeatherRequestError(isOnline() ? "network" : "offline");
  } finally {
    clearTimer(timeout);
    signal?.removeEventListener?.("abort", abort);
  }
}

function waitForRetry(ms, signal, setTimer, clearTimer) {
  if (signal.aborted) return Promise.reject(new WeatherRequestError("cancelled"));
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimer(timer); signal.removeEventListener("abort", abort); reject(new WeatherRequestError("cancelled")); };
    const timer = setTimer(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
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
  maxAttempts = WEATHER_MAX_ATTEMPTS,
  retryDelaysMs = WEATHER_RETRY_DELAYS_MS,
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
  const attemptLimit = Math.max(1, Math.min(3, Math.floor(maxAttempts) || 1));
  let tripIdentity = "";
  const errors = new Map();
  let automaticRetryAt = 0, manualRetryAt = 0, providerRetryAt = 0, retryAt = 0, retrying = false, cooldownTimer = null;

  const neededKeys = () => plan.keys;
  const freshFor = (entry) => entry && entry.timezone === plan.timezone && entry.requestDay === plan.today && now() - entry.fetchedAt >= 0 && now() - entry.fetchedAt < refreshIntervalMs;
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
    retrying = false; retryAt = 0;
    if (cooldownTimer !== null) clearTimer(cooldownTimer);
    cooldownTimer = null;
  }

  function notifyWhenRetryReady() {
    if (cooldownTimer !== null) clearTimer(cooldownTimer);
    const delay = Math.max(manualRetryAt, providerRetryAt) - now();
    cooldownTimer = delay > 0 && delay <= 2147483647 ? setTimer(() => { cooldownTimer = null; notify(); }, Math.ceil(delay)) : null;
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
      const nextTripIdentity = String(trip?.id || trip?.slug || "");
      const tripChanged = nextTripIdentity !== tripIdentity;
      const enabledChanged = nextEnabled !== enabled;
      enabled = nextEnabled;
      if (!enabled) {
        if (inflight || data.size || enabledChanged) { invalidateInflight(); data.clear(); status = "idle"; }
        errors.clear(); lastError = null;
        plan = nextPlan;
        return false;
      }
      if (nextPlan.identity === plan.identity && !enabledChanged && !tripChanged) {
        // Same needed points and time zone: renders, polls, language changes and unrelated edits
        // never start a request (retries after a failure wait for the refresh interval or resume).
        plan = nextPlan;
        return false;
      }
      plan = nextPlan;
      tripIdentity = nextTripIdentity;
      invalidateInflight();
      if (tripChanged) data.clear();
      errors.clear(); lastError = null; automaticRetryAt = 0; manualRetryAt = 0;
      prune();
      if (!plan.keys.length) status = "idle";
      else if (!hasAll()) status = data.size ? "refreshing" : "loading";
      return neededKeys().some((key) => !freshFor(data.get(key)));
    },

    async refresh({ force = false } = {}) {
      if (!stillActive() || !enabled) return null;
      const keys = neededKeys();
      if (!keys.length) {
        status = "idle";
        return null;
      }
      if (inflight) return inflight.promise;
      if (now() < providerRetryAt) {
        lastError = new WeatherRequestError("rate_limit", { retryAfterMs: providerRetryAt - now() });
        for (const key of keys) errors.set(key, lastError);
        status = data.size ? "saved" : "error";
        notifyWhenRetryReady(); notify(); return null;
      }
      if (now() < (force ? manualRetryAt : automaticRetryAt)) { notifyWhenRetryReady(); return null; }
      const due = force ? keys : keys.filter((key) => !freshFor(data.get(key)));
      if (!due.length) return null;
      const myGeneration = generation;
      const timezone = plan.timezone;
      const requestDay = plan.today;
      const batches = plan.batches
        .map((batch) => batch.filter((point) => due.includes(point.key)))
        .filter((batch) => batch.length);
      abortController = new AbortController();
      const signal = abortController.signal;
      status = data.size ? "refreshing" : "loading";
      lastError = null;
      retrying = false; retryAt = 0;
      notify();
      const promise = (async () => {
        for (const batch of batches) {
          if (myGeneration !== generation || !stillActive()) return;
          let pending = batch;
          for (let attempt = 0; pending.length && attempt < attemptLimit; attempt += 1) {
            let failure = null;
            try {
              const result = await fetchForecastBatch(pending, timezone, { fetchImpl, signal, timeoutMs, setTimer, clearTimer, now });
              if (myGeneration !== generation || !stillActive()) return;
              const fetchedAt = now();
              for (const [key, value] of Object.entries(result)) { data.set(key, { timezone, ...value, fetchedAt, requestDay }); errors.delete(key); }
              for (const [key, error] of result.failures) errors.set(key, error);
              pending = pending.filter((point) => result.failures.has(point.key));
              failure = pending.length ? result.failures.values().next().value : null;
              notify();
            } catch (error) {
              if (myGeneration !== generation || !stillActive()) return;
              if (error.code === "cancelled") return;
              failure = error;
              for (const point of pending) errors.set(point.key, error);
            }
            if (!failure) break;
            lastError = failure;
            providerRetryAt = Math.max(providerRetryAt, now() + (failure.retryAfterMs || 0));
            const delay = Math.ceil(Math.max(retryDelaysMs[attempt] || 4000, failure.retryAfterMs || 0));
            if (!failure.retryable || attempt + 1 >= attemptLimit || delay > MAX_RETRY_WAIT_MS) break;
            retrying = true; retryAt = now() + delay; notify();
            try { await waitForRetry(delay, signal, setTimer, clearTimer); } catch { return; }
            retrying = false; retryAt = 0;
            if (myGeneration !== generation || !stillActive()) return;
          }
          if (now() < providerRetryAt) break; // never send another batch ahead of Retry-After
        }
        if (myGeneration !== generation || !stillActive()) return;
        inflight = null;
        abortController = null;
        if (errors.size) {
          lastError = errors.values().next().value;
          status = keys.some((key) => data.has(key)) ? "saved" : "error";
          automaticRetryAt = Math.max(now() + refreshIntervalMs, providerRetryAt);
          manualRetryAt = Math.max(now() + WEATHER_MANUAL_COOLDOWN_MS, providerRetryAt);
          notifyWhenRetryReady();
        } else { status = "live"; lastError = null; automaticRetryAt = 0; manualRetryAt = now() + WEATHER_MANUAL_COOLDOWN_MS; notifyWhenRetryReady(); }
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
      const daily = entry && entry.timezone === plan.timezone ? entry.daily?.[date] || null : null;
      return hasDailyMeasurements(daily) ? daily : null;
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
        retrying,
        retryAt: retryAt || Math.max(manualRetryAt, providerRetryAt) || null,
        canRetry: !inflight && now() >= Math.max(manualRetryAt, providerRetryAt),
        fetchedAt: times.length ? new Date(Math.min(...times)).toISOString() : null,
        identity: plan.identity,
        timezone: plan.timezone
      };
    },

    dayStatus(dayId) {
      const day = resolved.days.get(dayId);
      if (!day || !day.entries.length) return day?.mode === "off" ? "off" : "no_location";
      if (!validForecastDate(day.date)) return "missing";
      if (day.date < plan.today) return "past";
      if (day.date > plan.lastDate) return "horizon";
      const available = day.entries.filter((entry) => api.daily(entry.key, day.date));
      if (available.length) {
        if (available.length !== day.entries.length || available.some((entry) => {
          const daily = api.daily(entry.key, day.date);
          return [daily.weatherCode, daily.temperatureMax, daily.temperatureMin, daily.precipitationProbability].some((value) => !Number.isFinite(value));
        })) return "partial";
        return day.entries.some((entry) => errors.has(entry.key)) ? "saved" : "live";
      }
      if (inflight || status === "loading" || status === "refreshing") return "loading";
      return day.entries.some((entry) => errors.has(entry.key)) ? "error" : "missing";
    },

    dayError(dayId) { return resolved.days.get(dayId)?.entries.map((entry) => errors.get(entry.key)).find(Boolean) || null; },

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
  if (!Number.isFinite(code)) return "☁";
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "🌤️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "🌨️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code) ? "🌧️" : "☁";
}

function validForecastDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validForecastTimestamp(value) {
  const match = typeof value === "string" && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::[0-5]\d)?$/.exec(value);
  return Boolean(match && validForecastDate(match[1]) && Number(match[2]) < 24 && Number(match[3]) < 60);
}

export function hasDailyMeasurements(daily) {
  return Boolean(daily && (Object.values(daily).some((value) => typeof value === "number" && Number.isFinite(value)) || daily.sunrise || daily.sunset));
}
function hasHourlyMeasurements(point) {
  return [point.temperature, point.precipitationProbability, point.uvIndex].some(Number.isFinite);
}

export function normalizeDailyForecast(daily = {}) {
  const dates = Array.isArray(daily?.time) ? daily.time : [];
  return Object.fromEntries(dates.slice(0, 32).map((date, index) => [date, {
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
    sunrise: validForecastTimestamp(daily.sunrise?.[index]) ? daily.sunrise[index] : null,
    sunset: validForecastTimestamp(daily.sunset?.[index]) ? daily.sunset[index] : null
  }]).filter(([date]) => validForecastDate(date)));
}

export function normalizeHourlyForecast(hourly = {}) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const days = {};
  times.slice(0, 800).forEach((value, index) => {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    if (!match || !validForecastTimestamp(value)) return;
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
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
