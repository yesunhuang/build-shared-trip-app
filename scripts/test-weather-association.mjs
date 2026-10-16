// Daily weather association and forecast controller: pure inference, explicit precedence, request
// planning, change building and the in-memory controller with an INJECTED Open-Meteo fetch and an
// injected clock. Fictional coordinates and trips only; no provider is contacted (any real fetch
// fails the test) and no browser storage is ever written.
import assert from "node:assert/strict";
import {
  AUTO_AREA_DIAMETER_KM, MAX_POINTS_PER_REQUEST, MAX_TRIP_FORECAST_POINTS,
  applyDayWeatherChangesLocally, buildDayWeatherChanges, dateInTimeZone, distanceKm, explicitDayChoice,
  forecastRequestPlan, groupDayPoints, isValidCoordinate, parseCoordinateEntry, pointKey, resolveDayWeather,
  resolveTripWeather, savedDayPoints
} from "../assets/app-template/public/weather-association.js";

// Storage spies: the forecast modules must never persist anything, in any mode.
const storageWrites = [];
const spyStorage = (name) => ({
  getItem: () => null, key: () => null, length: 0,
  setItem: (key) => storageWrites.push(`${name}:${key}`), removeItem: () => {}, clear: () => {}
});
globalThis.localStorage = spyStorage("local");
globalThis.sessionStorage = spyStorage("session");
globalThis.indexedDB = { open: () => { storageWrites.push("indexedDB"); throw new Error("not allowed"); } };
const realFetch = globalThis.fetch;
let realFetchAttempts = 0;
globalThis.fetch = () => { realFetchAttempts += 1; return Promise.reject(new Error("No real network in this test.")); };

const {
  createWeatherForecastController, fetchForecastBatch, forecastRequestUrl, loadCachedTripForecast, localizeForecastLocation
} = await import("../assets/app-template/public/weather-forecast.js");

const plan = (id, lat, lng, extra = {}) => ({ id, name: `Fictional ${id}`, lat, lng, ...extra });
const day = (id, date, slots, extra = {}) => ({ id, date, slots, ...extra });

// ---------------------------------------------------------------------------------------------
// 1. Coordinates, keys and distance.
assert.equal(isValidCoordinate(10.5, 20.25), true);
// (0, 0) is a real, valid point (the shared server range accepts latitude 0 / longitude 0).
for (const [lat, lng] of [[0, 0], [-0, 0], [0, 180], [-90, -180], [90, 0]]) {
  assert.equal(isValidCoordinate(lat, lng), true, `valid ${JSON.stringify([lat, lng])}`);
}
for (const [lat, lng] of [["10", 20], [10, "20"], ["0", 0], [0, "0"], [91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 1], [1, Infinity], [0, -Infinity], [null, 1], [undefined, 1], [0, undefined], [0, null]]) {
  assert.equal(isValidCoordinate(lat, lng), false, `invalid ${JSON.stringify([lat, lng])}`);
}
assert.equal(pointKey(0, -0), "0.0000,0.0000", "(0, 0) has a normal point key");
assert.equal(pointKey(10.000001, 20.000004), pointKey(10, 20), "nearly identical points share a key");
assert.equal(pointKey(-0.00001, 5), "0.0000,5.0000", "negative zero is normalized");
assert.ok(Math.abs(distanceKm({ lat: 10, lng: 20 }, { lat: 11, lng: 20 }) - 111.2) < 0.5, "haversine sanity");
assert.equal(AUTO_AREA_DIAMETER_KM, 20, "documented threshold");

// ---------------------------------------------------------------------------------------------
// 2. Inference edge cases.
{
  // Range/type/missing coordinates are ignored; day labels, areas, themes and recommendations too.
  const noisy = day("d-noisy", "2031-05-01", [
    plan("str", "10", 20), plan("range", 95, 20), plan("nan", NaN, 20), plan("missing", undefined, undefined),
    plan("half", 0, undefined), plan("str-zero", "0", "0"), { id: "no-coords", name: "Fictional Cafe" }, null, "not-a-plan"
  ], { label: "Fictional Capital City", area: "Fictional Region", theme: "Fictional City Day",
    recommendations: { seeGo: [{ name: "Fictional idea", lat: 10, lng: 20 }] } });
  assert.deepEqual(savedDayPoints(noisy), [], "nothing usable: no invented point from labels, names or ideas");
  assert.deepEqual(resolveDayWeather({}, noisy).entries, [], "no automatic area without saved plan coordinates");
  assert.equal(resolveDayWeather({}, noisy).mode, "auto");

  // A numeric saved plan at (0, 0) is a real automatic point; its representative is (0, 0).
  const equator = day("d-equator", "2031-05-01", [plan("zero-plan", 0, 0)]);
  const [equatorArea] = resolveDayWeather({}, equator).entries;
  assert.deepEqual([equatorArea.lat, equatorArea.lng, equatorArea.key, equatorArea.representativeSlotId], [0, 0, "0.0000,0.0000", "zero-plan"]);
}

{
  // Acceptance probe: an explicitly saved (0, 0) weather location is a usable manual association.
  const trip = { weather: { locations: [{ id: "zero-point", name: "Fictional explicitly saved equatorial point", lat: 0, lng: 0 }] }, days: [] };
  const resolved = resolveDayWeather(trip, { id: "day-a", date: "2031-05-04", weatherLocationIds: ["zero-point"], slots: [] });
  assert.equal(resolved.mode, "manual");
  assert.deepEqual(resolved.storedIds, ["zero-point"]);
  assert.equal(resolved.entries.length, 1, "explicit (0, 0) retained as a usable association");
  assert.deepEqual([resolved.entries[0].locationId, resolved.entries[0].lat, resolved.entries[0].lng, resolved.entries[0].key], ["zero-point", 0, 0, "0.0000,0.0000"]);
  // Partial, string, non-finite and out-of-range explicit coordinates remain unusable (never fetched),
  // and the day stays manual: it never falls back to automatic.
  for (const bad of [{ lat: 0 }, { lng: 0 }, {}, { lat: "0", lng: "0" }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }]) {
    const partial = { weather: { locations: [{ id: "legacy-partial", name: "Fictional older entry", ...bad }] }, days: [] };
    const result = resolveDayWeather(partial, { id: "day-b", date: "2031-05-04", weatherLocationIds: ["legacy-partial"], slots: [plan("p", 10, 20)] });
    assert.equal(result.mode, "manual", `still manual for ${JSON.stringify(bad)}`);
    assert.deepEqual(result.storedIds, ["legacy-partial"], "the stored ID is kept");
    assert.deepEqual(result.entries, [], `unusable explicit pair is not fetched: ${JSON.stringify(bad)}`);
  }

  // Duplicate hotel point (check-in and check-out) collapses but remembers both plans.
  const hotel = day("d-hotel", "2031-05-01", [plan("hotel-in", 10, 20), plan("museum", 10.03, 20.01), plan("hotel-out", 10, 20)]);
  const points = savedDayPoints(hotel);
  assert.equal(points.length, 2);
  assert.deepEqual(points[0].slotIds, ["hotel-in", "hotel-out"]);
  const hotelEntries = resolveDayWeather({}, hotel).entries;
  assert.equal(hotelEntries.length, 1, "near points form one area");
  assert.equal(hotelEntries[0].memberCount, 2);
  assert.deepEqual(hotelEntries[0].slotIds.sort(), ["hotel-in", "hotel-out", "museum"].sort());

  // Near vs far: a genuinely distant stop keeps its own area (cross-area day).
  const cross = day("d-cross", "2031-05-01", [plan("a", 10, 20), plan("b", 10.05, 20), plan("far", 11, 20)]);
  const crossEntries = resolveDayWeather({}, cross).entries;
  assert.equal(crossEntries.length, 2, "distant stop is kept, not dropped or merged");
  assert.equal(crossEntries[1].representativeSlotId, "far");

  // Chain: 13.3 km steps. Single linkage would merge all three; complete linkage does not.
  const chain = day("d-chain", "2031-05-01", [plan("c0", 10, 20), plan("c1", 10.12, 20), plan("c2", 10.24, 20), plan("c3", 10.36, 20)]);
  const groups = groupDayPoints(savedDayPoints(chain));
  assert.equal(groups.length, 2, "a chain of nearby stops never swallows a distant group");
  for (const group of groups) {
    for (const a of group.members) for (const b of group.members) assert.ok(distanceKm(a, b) <= AUTO_AREA_DIAMETER_KM, "every group fits the diameter");
  }

  // Representative = medoid, an actual saved coordinate (never a computed centre).
  const trio = day("d-trio", "2031-05-01", [plan("west", 10, 20), plan("middle", 10.05, 20), plan("east", 10.1, 20)]);
  const [area] = resolveDayWeather({}, trio).entries;
  assert.equal(area.representativeSlotId, "middle");
  assert.deepEqual([area.lat, area.lng], [10.05, 20], "representative coordinates are the saved ones");
  assert.equal(area.kind, "area");
  // Determinism.
  assert.deepEqual(resolveDayWeather({}, trio), resolveDayWeather({}, structuredClone(trio)));
}

// ---------------------------------------------------------------------------------------------
// 3. Explicit choices and legacy precedence; absence differs from [].
{
  const locations = [{ id: "loc-a", name: "Fictional Harbour", lat: 12, lng: 22, i18n: { ja: { name: "架空の港" } } },
    { id: "loc-nocoords", name: "Fictional Unknown" }, { id: "loc-b", name: "Fictional Hill", lat: 12.5, lng: 22.5 }];
  const slots = [plan("p1", 10, 20)];
  const trip = {
    timezone: "UTC",
    weather: { locations, dayLocations: { "d-legacy-off": [], "d-legacy-null": null, "d-legacy-on": ["loc-b"] } },
    days: [
      day("d-auto", "2031-05-01", slots),
      day("d-off", "2031-05-01", slots, { weatherLocationIds: [] }),
      day("d-manual", "2031-05-01", slots, { weatherLocationIds: ["loc-a"] }),
      day("d-unknown", "2031-05-01", slots, { weatherLocationIds: ["missing-id", "loc-nocoords"] }),
      day("d-legacy-off", "2031-05-01", slots, { weatherLocationIds: ["loc-a"] }),
      day("d-legacy-null", "2031-05-01", slots, { weatherLocationIds: ["loc-a"] }),
      day("d-legacy-on", "2031-05-01", slots),
      day("d-null", "2031-05-01", slots, { weatherLocationIds: null })
    ]
  };
  const result = resolveTripWeather(trip);
  const mode = (id) => result.days.get(id).mode;
  assert.equal(mode("d-auto"), "auto", "absent = automatic");
  assert.equal(mode("d-off"), "off", "[] = explicit off");
  assert.deepEqual(result.days.get("d-off").entries, [], "off: no point even though plans have coordinates");
  assert.equal(mode("d-manual"), "manual");
  assert.deepEqual(result.days.get("d-manual").entries.map((entry) => entry.locationId), ["loc-a"]);
  assert.equal(mode("d-unknown"), "manual", "an unusable explicit choice is NOT replaced by automatic inference");
  assert.deepEqual(result.days.get("d-unknown").entries, []);
  assert.equal(mode("d-legacy-off"), "off", "legacy dayLocations [] wins over the day field (earlier runtime precedence)");
  assert.equal(explicitDayChoice(trip, trip.days[4]).source, "legacy-map");
  assert.deepEqual(result.days.get("d-legacy-null").entries.map((entry) => entry.locationId), ["loc-a"], "a null legacy entry falls back to the day field");
  assert.deepEqual(result.days.get("d-legacy-on").entries.map((entry) => entry.locationId), ["loc-b"]);
  assert.equal(mode("d-null"), "auto", "null is treated as absent");
  assert.equal(localizeForecastLocation("loc-a", "ja", result.locations), "架空の港", "localized names kept");
  assert.equal(localizeForecastLocation("loc-a", "en", result.locations), "Fictional Harbour");
}

// ---------------------------------------------------------------------------------------------
// 4. Request planning: horizon, time zone, dedup across days and aliases, bounded batches, identity.
{
  const now = Date.parse("2031-05-01T12:00:00Z");
  const shared = [plan("x", 10, 20)];
  const trip = {
    timezone: "UTC",
    weather: { locations: [{ id: "alias", name: "Fictional alias", lat: 10.000001, lng: 20.000001 }] },
    days: [
      day("past", "2031-04-30", [plan("past-p", 30, 30)]),
      day("today", "2031-05-01", shared),
      day("again", "2031-05-02", [plan("x2", 10, 20)]),
      day("alias-day", "2031-05-03", [plan("y", 40, 40)], { weatherLocationIds: ["alias"] }),
      day("last", "2031-05-16", [plan("z", 15, 25)]),
      day("beyond", "2031-05-17", [plan("w", 50, 50)]),
      day("off", "2031-05-04", [plan("v", 60, 60)], { weatherLocationIds: [] }),
      day("nodate", "", [plan("u", 61, 61)])
    ]
  };
  const requestPlan = forecastRequestPlan(resolveTripWeather(trip), { nowMs: now });
  assert.equal(requestPlan.today, "2031-05-01");
  assert.equal(requestPlan.lastDate, "2031-05-16", "16-day provider horizon (today + 15)");
  assert.deepEqual(requestPlan.keys, [pointKey(10, 20), pointKey(15, 25)].sort(),
    "repeated coordinates across days and an explicit alias share one point; past, beyond-horizon, off and undated days need none");
  assert.equal(requestPlan.batches.length, 1);
  // Language, notes and labels do not change identity; coordinates, dates and time zone do.
  const cosmetic = structuredClone(trip);
  cosmetic.days[1].notes = "Fictional note"; cosmetic.days[1].label = "Fictional label"; cosmetic.days[1].slots[0].name = "Renamed";
  cosmetic.days[1].i18n = { ja: { label: "架空" } };
  assert.equal(forecastRequestPlan(resolveTripWeather(cosmetic), { nowMs: now }).identity, requestPlan.identity);
  const moved = structuredClone(trip); moved.days[4].slots[0].lat = 15.5;
  assert.notEqual(forecastRequestPlan(resolveTripWeather(moved), { nowMs: now }).identity, requestPlan.identity, "coordinate edit");
  const redated = structuredClone(trip); redated.days[5].date = "2031-05-10";
  assert.ok(forecastRequestPlan(resolveTripWeather(redated), { nowMs: now }).keys.includes(pointKey(50, 50)), "date edit into the window");
  const rezoned = structuredClone(trip); rezoned.timezone = "Pacific/Kiritimati";
  const late = Date.parse("2031-05-01T23:30:00Z");
  assert.equal(dateInTimeZone(late, "Pacific/Kiritimati"), "2031-05-02", "today follows the trip time zone");
  const rezonedPlan = forecastRequestPlan(resolveTripWeather(rezoned), { nowMs: late });
  assert.notEqual(rezonedPlan.identity, requestPlan.identity, "time zone is part of the identity");
  assert.equal(rezonedPlan.today, "2031-05-02");
  assert.equal(rezonedPlan.lastDate, "2031-05-17");
  assert.ok(rezonedPlan.keys.includes(pointKey(50, 50)), "the window moved with the trip's own date");
  assert.equal(dateInTimeZone(now, "Not/AZone"), "2031-05-01", "an unusable zone falls back to UTC");

  // Bounded batches and a trip-wide cap.
  const many = { timezone: "UTC", days: [] };
  for (let index = 0; index < 130; index += 1) many.days.push(day(`m${index}`, "2031-05-02", [plan(`m${index}`, -60 + index * 0.9, 100)]));
  const big = forecastRequestPlan(resolveTripWeather(many), { nowMs: now });
  assert.equal(big.keys.length, MAX_TRIP_FORECAST_POINTS);
  assert.ok(big.batches.every((batch) => batch.length <= MAX_POINTS_PER_REQUEST));
  assert.equal(big.batches.reduce((sum, batch) => sum + batch.length, 0), MAX_TRIP_FORECAST_POINTS);
}

// ---------------------------------------------------------------------------------------------
// 5. Building changes (the same operations the web editor and MCP clients send).
{
  const trip = {
    weather: { locations: [{ id: "loc-a", name: "Fictional Harbour", lat: 12, lng: 22 }, { id: "legacy-nocoords", name: "Fictional" }],
      dayLocations: { "d2": ["loc-a"] } },
    days: [day("d1", "2031-05-01", [plan("p", 10, 20, { i18n: { ja: { name: "架空のホテル" } } })]), day("d2", "2031-05-02", [], { weatherLocationIds: ["loc-a"] })]
  };
  assert.deepEqual(buildDayWeatherChanges(trip, "d1", { mode: "auto" }).changes, [{ type: "upsert_day", day: { id: "d1", weatherLocationIds: null } }]);
  assert.deepEqual(buildDayWeatherChanges(trip, "d1", { mode: "off" }).changes, [{ type: "upsert_day", day: { id: "d1", weatherLocationIds: [] } }]);
  const existing = buildDayWeatherChanges(trip, "d1", { mode: "manual", picks: [{ locationId: "loc-a" }] });
  assert.deepEqual(existing.changes, [{ type: "upsert_day", day: { id: "d1", weatherLocationIds: ["loc-a"] } }], "no weather rewrite when only reusing");
  const pick = { newLocationId: "weather-fictional-1", name: "Fictional Hotel", lat: 10, lng: 20, i18n: { ja: { name: "架空のホテル" }, xx: { name: "ignored" } } };
  const added = buildDayWeatherChanges(trip, "d1", { mode: "manual", picks: [pick, { locationId: "loc-a" }] });
  assert.equal(added.ok, true);
  assert.equal(added.changes[0].type, "update_trip");
  assert.deepEqual(added.changes[0].fields.weather.locations.slice(0, 2), trip.weather.locations, "existing locations kept exactly, including an older coordinate-less one");
  assert.deepEqual(added.changes[0].fields.weather.locations[2], { id: "weather-fictional-1", lat: 10, lng: 20, name: "Fictional Hotel", i18n: { ja: { name: "架空のホテル" } } });
  assert.equal(Object.hasOwn(added.changes[0].fields.weather, "dayLocations"), false, "the server schema has no dayLocations");
  assert.deepEqual(added.changes[1], { type: "upsert_day", day: { id: "d1", weatherLocationIds: ["weather-fictional-1", "loc-a"] } });
  assert.deepEqual(buildDayWeatherChanges(trip, "d1", { mode: "manual", picks: [pick] }), buildDayWeatherChanges(trip, "d1", { mode: "manual", picks: [pick] }), "identical input, identical changes (idempotent retry)");
  const reuse = buildDayWeatherChanges(trip, "d1", { mode: "manual", picks: [{ newLocationId: "weather-x", name: "Same place", lat: 12.000001, lng: 22 }] });
  assert.deepEqual(reuse.changes, [{ type: "upsert_day", day: { id: "d1", weatherLocationIds: ["loc-a"] } }], "same coordinates reuse the stored location");
  for (const [choice, reason] of [
    [{ mode: "manual", picks: [] }, "empty"], [{ mode: "sometimes" }, "mode"], [null, "mode"],
    [{ mode: "manual", picks: [{ locationId: "missing" }] }, "unknown-location"],
    [{ mode: "manual", picks: [{ locationId: "legacy-nocoords" }] }, "unknown-location"],
    [{ mode: "manual", picks: [{ newLocationId: "n1", name: "x", lat: 95, lng: 0 }] }, "coordinates"],
    [{ mode: "manual", picks: [{ newLocationId: "n1", name: "x", lat: "10", lng: 20 }] }, "coordinates"],
    [{ mode: "manual", picks: [{ newLocationId: "bad id", name: "x", lat: 1, lng: 2 }] }, "id"],
    [{ mode: "manual", picks: [{ newLocationId: "loc-a", name: "x", lat: 1, lng: 2 }] }, "id"]
  ]) assert.equal(buildDayWeatherChanges(trip, "d1", choice).reason, reason, `refused: ${reason}`);
  assert.equal(buildDayWeatherChanges(trip, "nope", { mode: "off" }).reason, "missing-day");
  const full = { weather: { locations: Array.from({ length: 60 }, (_, index) => ({ id: `l${index}`, lat: 1 + index * 0.1, lng: 2 })) }, days: [day("d1", "2031-05-01", [])] };
  assert.equal(buildDayWeatherChanges(full, "d1", { mode: "manual", picks: [{ newLocationId: "n61", name: "x", lat: 50, lng: 50 }] }).reason, "limit");

  // Local (non-server) application: legacy entry for that day removed; others untouched.
  const local = structuredClone(trip);
  applyDayWeatherChangesLocally(local, "d2", buildDayWeatherChanges(local, "d2", { mode: "off" }).changes);
  assert.deepEqual(local.days[1].weatherLocationIds, []);
  assert.equal(Object.hasOwn(local.weather.dayLocations, "d2"), false);
  assert.equal(resolveTripWeather(local).days.get("d2").mode, "off");
  assert.equal(Object.hasOwn(local.days[0], "weatherLocationIds"), false, "other day untouched");
  applyDayWeatherChangesLocally(local, "d2", buildDayWeatherChanges(local, "d2", { mode: "auto" }).changes);
  assert.equal(Object.hasOwn(local.days[1], "weatherLocationIds"), false, "back to automatic removes the property");

  // Typed coordinates.
  assert.deepEqual(parseCoordinateEntry(" 35.5 ", "-120.25"), { ok: true, lat: 35.5, lng: -120.25 });
  assert.deepEqual(parseCoordinateEntry("0", "0"), { ok: true, lat: 0, lng: 0 }, "typed (0, 0) is a valid complete pair");
  // The typed form still needs a complete, valid pair.
  for (const [lat, lng, reason] of [["35,5", "1", "format"], ["abc", "1", "format"], ["", "1", "format"], ["0", "", "format"], ["", "", "format"], ["1e2", "1", "format"], ["Infinity", "0", "format"], ["91", "1", "range"], ["0", "181", "range"]]) {
    assert.equal(parseCoordinateEntry(lat, lng).reason, reason, `${lat},${lng}`);
  }
  // A new (0, 0) pick builds a normal location and association.
  const zeroPick = buildDayWeatherChanges(trip, "d1", { mode: "manual", picks: [{ newLocationId: "weather-fictional-zero", name: "Fictional equatorial point", lat: 0, lng: 0 }] });
  assert.equal(zeroPick.ok, true);
  assert.deepEqual(zeroPick.changes[0].fields.weather.locations.at(-1), { id: "weather-fictional-zero", lat: 0, lng: 0, name: "Fictional equatorial point" });
  assert.deepEqual(zeroPick.changes[1], { type: "upsert_day", day: { id: "d1", weatherLocationIds: ["weather-fictional-zero"] } });
  assert.deepEqual(zeroPick.changes[0].fields.weather.locations[1], { id: "legacy-nocoords", name: "Fictional" }, "an older coordinate-less location is carried over unchanged");
}

// ---------------------------------------------------------------------------------------------
// 6. Controller with an injected Open-Meteo and clock.
function fakeOpenMeteo({ dates = ["2031-05-01", "2031-05-02"] } = {}) {
  const log = [];
  const pending = [];
  let mode = "ok";
  const respond = (url) => {
    const params = new URL(url).searchParams;
    const lats = params.get("latitude").split(",").map(Number);
    const body = lats.map((lat, index) => ({
      location_id: lats.length > 1 ? index : undefined,
      daily: { time: dates, weather_code: dates.map(() => 3), temperature_2m_max: dates.map(() => Math.round(lat)), temperature_2m_min: dates.map(() => 1),
        precipitation_probability_max: dates.map(() => 40), precipitation_sum: dates.map(() => 1.5), wind_speed_10m_max: dates.map(() => 12),
        uv_index_max: dates.map(() => 4), sunrise: dates.map((date) => `${date}T05:00`), sunset: dates.map((date) => `${date}T19:00`) },
      hourly: { time: [`${dates[0]}T06:00`, `${dates[0]}T09:00`], temperature_2m: [5, 9], precipitation_probability: [10, 20], uv_index: [0, 2] }
    }));
    return new Response(JSON.stringify(lats.length === 1 ? body[0] : body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const fetchImpl = (url, init) => {
    log.push({ url, init });
    assert.ok(String(url).startsWith("https://api.open-meteo.com/v1/forecast?"), "only the existing Open-Meteo endpoint");
    if (mode === "fail") return Promise.reject(new TypeError("Fictional network failure"));
    if (mode === "http500") return Promise.resolve(new Response("{}", { status: 500 }));
    if (mode === "defer") return new Promise((resolve, reject) => pending.push({ resolve: () => resolve(respond(url)), reject }));
    return Promise.resolve(respond(url));
  };
  return { log, pending, fetchImpl, set mode(value) { mode = value; } };
}
function controllerWith(meteo, clock, extra = {}) {
  return createWeatherForecastController({ fetchImpl: meteo.fetchImpl, now: () => clock.now, setTimer: () => 0, clearTimer: () => {}, ...extra });
}
const baseTrip = () => ({
  timezone: "UTC",
  weather: { locations: [{ id: "loc-a", name: "Fictional Harbour", lat: 12, lng: 22 }] },
  days: [
    day("d1", "2031-05-01", [plan("hotel", 10, 20), plan("museum", 10.02, 20), plan("hotel-2", 10, 20)]),
    day("d2", "2031-05-02", [plan("hotel-again", 10, 20), plan("far", 11, 20)]),
    day("d3", "2031-05-02", [plan("q", 10, 20)], { weatherLocationIds: ["loc-a"] }),
    day("d-off", "2031-05-02", [plan("r", 33, 33)], { weatherLocationIds: [] }),
    day("d-empty", "2031-05-02", [{ id: "s", name: "Fictional placeholder" }])
  ]
});
{
  const clock = { now: Date.parse("2031-05-01T08:00:00Z") };
  const meteo = fakeOpenMeteo();
  let changes = 0;
  const controller = controllerWith(meteo, clock, { onChange: () => { changes += 1; } });
  const trip = baseTrip();
  assert.equal(controller.update(trip), true, "first update needs data");
  await controller.refresh({ force: true });
  assert.equal(meteo.log.length, 1, "one batched request");
  const url = new URL(meteo.log[0].url);
  assert.equal(url.searchParams.get("latitude").split(",").length, 3, "hotel, far stop and explicit location: deduplicated across days");
  assert.equal(url.searchParams.get("forecast_days"), "16");
  assert.equal(url.searchParams.get("timezone"), "UTC");
  assert.equal(url.searchParams.get("daily"), "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,uv_index_max,sunrise,sunset");
  assert.equal(url.searchParams.get("hourly"), "temperature_2m,precipitation_probability,uv_index");
  assert.equal(meteo.log[0].init.cache, "no-store");
  assert.ok(!url.searchParams.get("latitude").includes("33"), "an explicit off day is never requested");
  assert.equal(controller.snapshot().status, "live");
  assert.ok(changes >= 2, "start and finish reported");
  const d1 = controller.day("d1");
  assert.equal(d1.mode, "auto");
  assert.equal(controller.daily(d1.entries[0].key, "2031-05-01").temperatureMax, 10);
  assert.equal(controller.hourly(d1.entries[0].key, "2031-05-01").length, 2);
  assert.equal(controller.day("d3").entries[0].locationId, "loc-a");
  assert.deepEqual(controller.day("d-empty").entries, [], "no saved coordinates: nothing invented");

  // Unchanged or irrelevant renders, polls, language and notes: no request.
  const cosmetic = structuredClone(trip);
  cosmetic.days[0].notes = "Fictional note"; cosmetic.days[0].slots[0].name = "Renamed"; cosmetic.title = "Other";
  assert.equal(controller.update(cosmetic), false);
  assert.equal(controller.update(structuredClone(cosmetic)), false);
  await controller.refresh({ force: false });
  assert.equal(meteo.log.length, 1, "fresh data, no duplicate fetch");
  clock.now += 6 * 60 * 1000;
  await controller.refresh({ force: false });
  assert.equal(meteo.log.length, 2, "stale after the refresh interval");

  // Coordinate edit: only the new point is fetched; the old one's data is dropped.
  const moved = structuredClone(cosmetic);
  moved.days[1].slots[1].lat = 11.5;
  assert.equal(controller.update(moved), true);
  await controller.refresh({ force: false });
  assert.equal(meteo.log.length, 3);
  assert.equal(new URL(meteo.log[2].url).searchParams.get("latitude"), "11.5", "only the new point");
  assert.equal(controller.daily(pointKey(11, 20), "2031-05-01"), null, "no data kept for a point no longer needed");

  // Time zone edit: identity changes, everything is fetched again for the new zone.
  const rezoned = structuredClone(moved);
  rezoned.timezone = "Europe/Lisbon";
  assert.equal(controller.update(rezoned), true);
  assert.equal(controller.daily(controller.day("d1").entries[0].key, "2031-05-01"), null, "data of another time zone is not shown");
  await controller.refresh({ force: false });
  assert.equal(new URL(meteo.log[3].url).searchParams.get("timezone"), "Europe/Lisbon");
  assert.equal(new URL(meteo.log[3].url).searchParams.get("latitude").split(",").length, 3);

  // Failure keeps last-known in-memory data for the same identity only.
  clock.now += 6 * 60 * 1000;
  meteo.mode = "fail";
  await controller.refresh({ force: false });
  assert.equal(controller.snapshot().status, "saved");
  assert.ok(controller.daily(controller.day("d1").entries[0].key, "2031-05-01"), "last-known data for the same points and zone");
  meteo.mode = "http500";
  await controller.refresh({ force: true });
  assert.equal(controller.snapshot().status, "saved");
  controller.dispose();
}
{
  // Stale and late responses: changed trip, removed day, explicit off, session loss, dispose.
  const clock = { now: Date.parse("2031-05-01T08:00:00Z") };
  const scenario = async (label, mutate, extra = {}) => {
    const meteo = fakeOpenMeteo();
    meteo.mode = "defer";
    let active = true;
    const controller = controllerWith(meteo, clock, { isActive: () => active, ...extra });
    const trip = { timezone: "UTC", days: [day("only", "2031-05-01", [plan("p", 10, 20)])] };
    controller.update(trip);
    const request = controller.refresh({ force: true });
    assert.equal(meteo.log.length, 1);
    mutate({ trip, controller, setActive: (value) => { active = value; } });
    meteo.pending.forEach((entry) => entry.resolve());
    await request;
    assert.equal(controller.daily(pointKey(10, 20), "2031-05-01"), null, `${label}: late response ignored`);
    assert.notEqual(controller.snapshot().status, "live", `${label}: never reported as live`);
    return { meteo, controller };
  };
  await scenario("coordinates changed", ({ trip, controller }) => { trip.days[0].slots[0].lat = 10.5; controller.update(trip); });
  await scenario("day removed", ({ trip, controller }) => { trip.days = []; controller.update(trip); });
  await scenario("explicit off", ({ trip, controller }) => { trip.days[0].weatherLocationIds = []; controller.update(trip); });
  await scenario("time zone changed", ({ trip, controller }) => { trip.timezone = "Asia/Tokyo"; controller.update(trip); });
  const lost = await scenario("session lost", ({ setActive }) => setActive(false));
  assert.equal(lost.controller.update({ timezone: "UTC", days: [day("n", "2031-05-01", [plan("n", 20, 20)])] }), false, "no more work after session loss");
  await lost.controller.refresh({ force: true });
  assert.equal(lost.meteo.log.length, 1, "no request after session loss");
  await scenario("disposed", ({ controller }) => controller.dispose());
  await scenario("disabled", ({ trip, controller }) => controller.update(trip, { enabled: false }));

  // A concurrent refresh for the same identity shares the in-flight request.
  const meteo = fakeOpenMeteo();
  meteo.mode = "defer";
  const controller = controllerWith(meteo, clock);
  controller.update({ timezone: "UTC", days: [day("a", "2031-05-01", [plan("p", 10, 20)])] });
  const first = controller.refresh({ force: true });
  const second = controller.refresh({ force: false });
  assert.equal(meteo.log.length, 1, "no duplicate in-flight request");
  meteo.pending.forEach((entry) => entry.resolve());
  await Promise.all([first, second]);
  assert.equal(controller.snapshot().status, "live");
}
{
  // Horizon and empty trips: no automatic request at all.
  const clock = { now: Date.parse("2031-05-01T08:00:00Z") };
  const meteo = fakeOpenMeteo();
  const controller = controllerWith(meteo, clock);
  controller.update({ timezone: "UTC", days: [day("past", "2031-04-01", [plan("a", 10, 20)]), day("future", "2031-06-30", [plan("b", 11, 21)]),
    day("blank", "2031-05-02", [{ id: "c", name: "Fictional" }]), day("off", "2031-05-02", [plan("d", 12, 22)], { weatherLocationIds: [] })] });
  await controller.refresh({ force: true });
  assert.equal(meteo.log.length, 0, "outside the 16-day window, no coordinates or off: no request");
  assert.equal(controller.snapshot().status, "idle");
}
{
  // (0, 0) explicit and automatic points are requested; older partial explicit entries never are.
  const clock = { now: Date.parse("2031-05-01T08:00:00Z") };
  const meteo = fakeOpenMeteo();
  const controller = controllerWith(meteo, clock);
  const legacyOnly = { timezone: "UTC", weather: { locations: [{ id: "legacy-lat", name: "Fictional older entry", lat: 0 }, { id: "legacy-none", name: "Fictional older entry 2" }] },
    days: [day("legacy", "2031-05-02", [plan("p", 10, 20)], { weatherLocationIds: ["legacy-lat", "legacy-none"] })] };
  assert.equal(controller.update(legacyOnly), false, "nothing usable to fetch");
  await controller.refresh({ force: true });
  assert.equal(meteo.log.length, 0, "no provider dispatch from an unusable pair (and no automatic fallback)");
  assert.equal(controller.day("legacy").mode, "manual");
  const zeroTrip = { timezone: "UTC", weather: { locations: [{ id: "zero-point", name: "Fictional equatorial point", lat: 0, lng: 0 }] },
    days: [day("explicit", "2031-05-02", [], { weatherLocationIds: ["zero-point"] }), day("auto-zero", "2031-05-01", [plan("z", 0, 0)])] };
  assert.equal(controller.update(zeroTrip), true);
  await controller.refresh({ force: false });
  assert.equal(meteo.log.length, 1, "explicit and automatic (0, 0) share one point");
  const params = new URL(meteo.log[0].url).searchParams;
  assert.equal(params.get("latitude"), "0");
  assert.equal(params.get("longitude"), "0");
  assert.ok(controller.daily("0.0000,0.0000", "2031-05-02"), "forecast stored for (0, 0)");
  controller.dispose();
}
{
  // Batch helper: bounded size and count mismatch rejected; mismatched location_id falls back to index.
  const points = [{ key: "1.0000,2.0000", lat: 1, lng: 2 }, { key: "3.0000,4.0000", lat: 3, lng: 4 }];
  assert.ok(forecastRequestUrl(points, "UTC").includes("latitude=1%2C3"));
  await assert.rejects(fetchForecastBatch(points, "UTC", { fetchImpl: async () => new Response(JSON.stringify([{}]), { status: 200 }), setTimer: () => 0, clearTimer: () => {} }), /count/);
}

assert.equal(loadCachedTripForecast(), null, "no persistent forecast cache");
assert.deepEqual(storageWrites, [], "nothing was written to browser storage");
assert.equal(realFetchAttempts, 0, "no real provider request");
globalThis.fetch = realFetch;
console.log("Weather association and forecast controller tests passed (pure functions, injected fetch and clock).");
