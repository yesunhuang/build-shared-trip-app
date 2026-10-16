import assert from "node:assert/strict";
import { createWeatherForecastController, fetchForecastBatch, normalizeDailyForecast, normalizeHourlyForecast, parseForecastPayload, WEATHER_REQUEST_TIMEOUT_MS, weatherCodeIcon } from "../assets/app-template/public/weather-forecast.js";
import { pointKey } from "../assets/app-template/public/weather-association.js";

const flush = async () => { for (let n = 0; n < 30; n += 1) await Promise.resolve(); };
class Clock {
  time = Date.parse("2031-05-01T08:00:00Z"); next = 0; timers = new Map();
  now = () => this.time;
  setTimer = (fn, ms) => { const id = ++this.next; this.timers.set(id, { fn, at: this.time + ms }); return id; };
  clearTimer = (id) => this.timers.delete(id);
  async tick(ms) {
    const end = this.time + ms; await flush();
    for (;;) { const entry = [...this.timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; this.time = entry[1].at; this.timers.delete(entry[0]); entry[1].fn(); await flush(); }
    this.time = end; await flush();
  }
  options = () => ({ now: this.now, setTimer: this.setTimer, clearTimer: this.clearTimer });
}
const points = [{ key: pointKey(10, 20), lat: 10, lng: 20 }, { key: pointKey(11, 21), lat: 11, lng: 21 }];
const row = (id = 0, max = 24) => ({ location_id: id, daily: { time: ["2031-05-01", "2031-05-02"], weather_code: [3, null], temperature_2m_max: [max, null], temperature_2m_min: [12, 7], precipitation_probability_max: [40, null] }, hourly: { time: ["2031-05-01T09:00"], temperature_2m: [20], precipitation_probability: [null], uv_index: [0] } });
const response = (body = row(), status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const trip = (id = "fictional-a", two = false) => ({ id, timezone: "UTC", days: [
  { id: "day", date: "2031-05-01", slots: points.slice(0, two ? 2 : 1).map((p, i) => ({ id: `plan-${i}`, name: "Fictional point", lat: p.lat, lng: p.lng })) },
  { id: "partial", date: "2031-05-02", slots: [{ id: "p2", lat: 10, lng: 20 }] },
  { id: "horizon", date: "2031-05-17", slots: [{ id: "future", lat: 12, lng: 22 }] },
  { id: "past", date: "2031-04-30", slots: [{ id: "past-plan", lat: 13, lng: 23 }] },
  { id: "off", date: "2031-05-01", weatherLocationIds: [], slots: [] }
] });

assert.equal(WEATHER_REQUEST_TIMEOUT_MS, 30000);
{
  const clock = new Clock(); let signal;
  const request = fetchForecastBatch(points.slice(0, 1), "UTC", { ...clock.options(), fetchImpl: async (url, init) => {
    signal = init.signal; await new Promise((resolve) => clock.setTimer(resolve, 18000)); return response();
  } });
  await clock.tick(18000); assert.ok((await request)[points[0].key]); assert.equal(signal.aborted, false, "slow headers inside the full deadline succeed");
}
{
  const clock = new Clock(); let releaseBody, signal;
  const request = fetchForecastBatch(points.slice(0, 1), "UTC", { ...clock.options(), fetchImpl: async (url, init) => { signal = init.signal; return { ok: true, json: () => new Promise((resolve) => { releaseBody = resolve; }) }; } });
  const rejected = assert.rejects(request, (e) => e.code === "timeout");
  await flush(); assert.equal(clock.timers.size, 1, "deadline remains after headers");
  await clock.tick(30000); await rejected; assert.equal(signal.aborted, true); releaseBody(row()); await flush(); assert.equal(clock.timers.size, 0);
}
{
  const clock = new Clock(), parent = new AbortController(); let signal, release;
  const request = fetchForecastBatch(points.slice(0, 1), "UTC", { ...clock.options(), signal: parent.signal, fetchImpl: async (url, init) => { signal = init.signal; return { ok: true, json: () => new Promise((resolve) => { release = resolve; }) }; } });
  const rejected = assert.rejects(request, (e) => e.code === "cancelled"); await flush(); parent.abort(); await rejected;
  assert.equal(signal.aborted, true, "caller cancellation still reaches body parsing"); release(row()); await flush(); assert.equal(clock.timers.size, 0);
  await assert.rejects(fetchForecastBatch(points, "UTC", { signal: parent.signal, fetchImpl: () => assert.fail("pre-aborted requests must not dispatch") }), (e) => e.code === "cancelled");
}
{
  const clock = new Clock(); const request = fetchForecastBatch(points.slice(0, 1), "UTC", { ...clock.options(), fetchImpl: async () => ({ ok: true, json: () => new Promise((resolve) => clock.setTimer(() => resolve(row()), 22000)) }) });
  await clock.tick(22000); assert.ok((await request)[points[0].key], "slow body within deadline succeeds"); assert.equal(clock.timers.size, 0);
}
for (const [body, status, code] of [[{}, 200, "invalid_response"], [[], 200, "empty_response"], [null, 200, "invalid_response"], [{ error: true }, 200, "invalid_response"], [{}, 400, "http"], [{}, 503, "http"], [{}, 429, "rate_limit"]]) {
  await assert.rejects(fetchForecastBatch(points, "UTC", { fetchImpl: async () => response(body, status, { "Retry-After": "60" }) }), (e) => e.code === code && (status === 200 || e.status === status));
}
await assert.rejects(fetchForecastBatch(points, "UTC", { fetchImpl: async () => new Response("{not JSON") }), (e) => e.code === "invalid_response");
await assert.rejects(fetchForecastBatch(points, "UTC", { isOnline: () => false, fetchImpl: () => assert.fail("offline must not dispatch") }), (e) => e.code === "offline");
await assert.rejects(fetchForecastBatch(points, "UTC", { fetchImpl: async () => { throw new TypeError("fictional blocked fetch"); } }), (e) => e.code === "network", "browser fetch cannot distinguish CORS from other network failures");
{
  const daily = normalizeDailyForecast({ time: ["2031-05-01", "2031-02-30"], weather_code: [null], temperature_2m_max: [null], temperature_2m_min: [0], precipitation_probability_max: ["0"], wind_speed_10m_max: [Infinity] });
  assert.deepEqual(Object.keys(daily), ["2031-05-01"]); assert.equal(daily["2031-05-01"].temperatureMax, null); assert.equal(daily["2031-05-01"].temperatureMin, 0); assert.equal(daily["2031-05-01"].weatherCode, null); assert.equal(daily["2031-05-01"].precipitationProbability, null); assert.equal(daily["2031-05-01"].windSpeedMax, null);
  const hourly = normalizeHourlyForecast({ time: ["2031-05-01T09:00", "2031-05-01T25:00"], temperature_2m: [null], precipitation_probability: [0], uv_index: [""] });
  assert.deepEqual(hourly["2031-05-01"], [{ time: "09:00", temperature: null, precipitationProbability: 0, uvIndex: null }]); assert.equal(weatherCodeIcon(null), "☁"); assert.equal(weatherCodeIcon(0), "☀️");
  const partial = parseForecastPayload(points, [row(0)]); assert.ok(partial[points[0].key]); assert.equal(partial.failures.size, 1);
  assert.throws(() => parseForecastPayload(points.slice(0, 1), { daily: { time: ["2031-05-01"], weather_code: [null], temperature_2m_max: [null] } }), (e) => e.code === "empty_response", "all-null values are missing data, never fabricated zeroes");
  const reordered = parseForecastPayload(points, [row(1, 31), row(0, 24)]); assert.equal(reordered[points[1].key].daily["2031-05-01"].temperatureMax, 31);
  const duplicates = parseForecastPayload(points, [row(0), row(0), row(1)]); assert.equal(duplicates[points[0].key], undefined); assert.ok(duplicates[points[1].key]);
}
{
  const clock = new Clock(); let calls = 0;
  const controller = createWeatherForecastController({ ...clock.options(), fetchImpl: async () => { calls++; if (calls < 3) return response({}, 503); return response(); } });
  controller.update(trip()); const request = controller.refresh({ force: true }); await flush(); assert.equal(calls, 1); assert.equal(controller.snapshot().retrying, true);
  const concurrent = controller.refresh(); await clock.tick(1499); assert.equal(calls, 1); await clock.tick(1); assert.equal(calls, 2); await clock.tick(4000); await Promise.all([request, concurrent]); assert.equal(calls, 3); assert.equal(controller.snapshot().status, "live");
  assert.equal(controller.dayStatus("horizon"), "horizon"); assert.equal(controller.dayStatus("past"), "past"); assert.equal(controller.dayStatus("off"), "off"); assert.equal(controller.dayStatus("partial"), "partial");
  await controller.refresh({ force: true }); assert.equal(calls, 3, "successful requests also have a manual cooldown"); await clock.tick(5000); await controller.refresh({ force: true }); assert.equal(calls, 4);
  controller.dispose();
}
{
  const clock = new Clock(); let calls = 0, fail = true;
  const controller = createWeatherForecastController({ ...clock.options(), fetchImpl: async () => { calls++; if (fail) throw new TypeError("fictional offline route"); return response(); } });
  controller.update(trip()); const request = controller.refresh(); await clock.tick(5500); await request; assert.equal(calls, 3); assert.equal(controller.snapshot().error.code, "network"); assert.equal(controller.dayStatus("horizon"), "horizon", "failure does not mask later dates");
  for (let i = 0; i < 20; i++) { controller.update(trip()); await controller.refresh(); await controller.refresh({ force: true }); }
  assert.equal(calls, 3, "renders, resume and repeated manual attempts cannot storm during cooldown");
  fail = false; await clock.tick(5000); await controller.refresh({ force: true }); assert.equal(calls, 4); assert.equal(controller.snapshot().error, null); controller.dispose();
}
{
  const clock = new Clock(); let calls = 0;
  const controller = createWeatherForecastController({ ...clock.options(), fetchImpl: async () => { calls++; return response({}, 429, { "Retry-After": "60" }); } });
  controller.update(trip()); await controller.refresh(); assert.equal(calls, 1, "long Retry-After ends this bounded retry cycle");
  controller.update(trip("fictional-b")); await controller.refresh(); assert.equal(controller.snapshot().status, "error", "a changed trip waiting for a provider cooldown is not stuck in loading");
  await clock.tick(59000); await controller.refresh({ force: true }); assert.equal(calls, 1); await clock.tick(1000); assert.equal(controller.snapshot().canRetry, true); await controller.refresh({ force: true }); assert.equal(calls, 2); controller.dispose();
}
{
  const clock = new Clock(); let mode = "partial", calls = 0;
  const controller = createWeatherForecastController({ ...clock.options(), maxAttempts: 1, fetchImpl: async () => { calls++; return mode === "partial" ? response([row(0)]) : mode === "ok" ? response([row(0, 26), row(1, 28)]) : response({}, 503); } });
  controller.update(trip("fictional-a", true)); await controller.refresh(); assert.equal(controller.snapshot().status, "saved"); assert.equal(controller.dayStatus("day"), "partial"); assert.equal(controller.daily(points[0].key, "2031-05-01").temperatureMax, 24); assert.equal(controller.daily(points[1].key, "2031-05-01"), null);
  mode = "ok"; await clock.tick(5000); await controller.refresh({ force: true }); mode = "fail"; await clock.tick(5000); await controller.refresh({ force: true }); assert.equal(controller.snapshot().status, "saved"); assert.equal(controller.daily(points[1].key, "2031-05-01").temperatureMax, 28, "a failed refresh keeps usable same-point data");
  controller.update(trip("fictional-b", true)); assert.equal(controller.daily(points[0].key, "2031-05-01"), null, "another trip never inherits memory forecasts"); controller.dispose();
}
{
  const clock = new Clock(); let resolveOld, calls = 0;
  const controller = createWeatherForecastController({ ...clock.options(), fetchImpl: async () => { calls++; return calls === 1 ? { ok: true, json: () => new Promise((resolve) => { resolveOld = resolve; }) } : response(row(0, 32)); } });
  controller.update(trip()); const old = controller.refresh(); await flush(); controller.update(trip("fictional-b")); await controller.refresh(); resolveOld(row(0, 99)); await old; assert.equal(controller.daily(points[0].key, "2031-05-01").temperatureMax, 32, "late body cannot overwrite a newer trip response"); controller.dispose();
}
{
  const clock = new Clock(); let calls = 0;
  const controller = createWeatherForecastController({ ...clock.options(), fetchImpl: async () => { calls++; return response({}, 503); } });
  controller.update(trip()); const request = controller.refresh(); await flush(); assert.equal(controller.snapshot().retrying, true); controller.dispose(); await request; await clock.tick(10000); assert.equal(calls, 1, "disposal cancels retry delay and future dispatches");
}
{
  const clock = new Clock(); clock.time = Date.parse("2031-05-02T00:30:00Z"); let calls = 0;
  const controller = createWeatherForecastController({ ...clock.options(), fetchImpl: async () => { calls++; return response(); } });
  const localTrip = trip(); localTrip.timezone = "America/Los_Angeles";
  controller.update(localTrip); await controller.refresh(); assert.equal(controller.plan.today, "2031-05-01"); assert.equal(controller.dayStatus("day"), "live");
  const oldIdentity = controller.plan.identity; await clock.tick(7 * 60 * 60 * 1000); assert.equal(controller.update(localTrip), true); assert.notEqual(controller.plan.identity, oldIdentity, "trip-local midnight invalidates the provider window even for unchanged coordinates"); await controller.refresh(); assert.equal(calls, 2); assert.equal(controller.dayStatus("day"), "past"); controller.dispose();
}
console.log("Weather resilience tests passed: bounded slow headers/body and parsing cancellation, HTTP/rate-limit/network/offline/invalid/empty categories, null measurements, partial/reordered/ambiguous locations, bounded backoff and manual retry cooldowns, preserved usable data, no rerender storms, stale bodies, trip isolation, local midnight and independent horizon/off states. Injected clocks/fetch only.");
