# Daily weather association

Each trip day shows forecasts for zero or more points. This document defines how those points are chosen, stored, edited and fetched. The implementation lives in `assets/app-template/public/weather-association.js` (pure rules), `weather-forecast.js` (in-memory forecast controller), `weather-editor.js` (per-day editor) and the existing shared weather and day validation in `server/domain/validate.mjs`.

## Stored schema

No new fields were added. The existing `day.weatherLocationIds` and `trip.weather.locations` carry every choice:

| `day.weatherLocationIds` | Mode | Stored? |
| --- | --- | --- |
| absent (an `upsert_day` patch with `null` removes it) | automatic | nothing stored; inferred on every render |
| `[]` | no forecast for that day | yes |
| `["id", ...]` | chosen places from `weather.locations` | yes |

- Absence and `[]` are different. Create, import, export, `replace_content`, `upsert_day`, `upsert_plan` and `update_trip` all keep the property's presence or absence exactly as stored.
- A chosen place is an ordinary `weather.locations` entry `{ id, name, lat, lng, i18n? }` with a stable ID. The web editor creates it from a saved plan coordinate (copying the plan's name and its reviewed translated names) or from coordinates typed by an editor. A new pick with the same coordinates as an existing location (to about 11 m) reuses that location.
- The shared server validator retains its existing optional-coordinate schema, type/range checks, IDs and references. Older partial or coordinate-less explicit entries remain editable and importable, with their mappings intact; they are unavailable for fetching and never replaced by inference. The web coordinate-entry form requires a complete valid pair. `(0, 0)` is a valid coordinate, including for older explicit entries.
- Returning a day to automatic, or turning it off, never deletes `weather.locations` entries; an entry still referenced by another day can't be removed (the reference check refuses the write).
- Legacy generator input may carry `weather.dayLocations`. At runtime and on import, an own non-null entry for a day (including `[]`) takes precedence over that day's own field, as before. On import it becomes the day's `weatherLocationIds`, and the original map stays in `content.legacyWeatherDayLocations`.

An explicit choice is never replaced by inference: a chosen list whose IDs are all unusable shows "not available" instead of falling back to automatic areas.

## Automatic areas

Automatic areas come only from valid numeric `lat`/`lng` already saved on that day's plans (`day.slots`). The app never geocodes and never reads names, addresses, labels, day labels, flight text or nearby ideas to infer a point. It doesn't make external lookups or compute a centre point.

1. **Valid coordinates:** both are finite numbers, latitude between -90 and 90, longitude between -180 and 180, including `(0, 0)`. Strings, missing values and out-of-range values are ignored for inference and fetching.
2. **Duplicates:** plans with the same coordinates (rounded to 4 decimals, about 11 m) form one point, such as a hotel at check-in and check-out.
3. **Grouping:** complete linkage with a **20 km diameter**. A point joins an existing group only if it is within 20 km of every member, so a chain of nearby stops can't pull a distant group in. Ties go to the tighter group, then the earlier one. Points that fit no group start a new area, so cross-area stops are kept.
4. **Representative:** the medoid, which is the member's saved coordinate with the smallest total distance to the others (the earliest on ties). It is always an actual saved point.
5. **Labels:** an automatic area is shown as "Area near *plan name*" (or "Area *n*"), in four languages. It is never presented as a verified city. Day labels and areas are display-only.

The 20 km threshold bounds the span of an inferred group. It does not identify a city, administrative boundary or uniform weather conditions.

## Editing (owner and content managers)

The weather dialog has a **Change forecast places** control for editors. It is never rendered for viewers, and the server refuses viewer writes anyway. The editor offers three native radio choices: automatic, chosen places, and no forecast. It lists the current automatic areas, and in chosen-places mode it allows removing a place, adding a saved point, or entering typed coordinates (decimal latitude/longitude, validated locally and by the server).

A save sends one atomic `apply_trip_changes` batch:

- automatic: `[{ "type": "upsert_day", "day": { "id": DAY, "weatherLocationIds": null } }]`
- no forecast: `[{ "type": "upsert_day", "day": { "id": DAY, "weatherLocationIds": [] } }]`
- chosen places: `[{ "type": "update_trip", "fields": { "weather": { "locations": [...existing, ...new] } } }` (only when a new location is added), followed by `{ "type": "upsert_day", "day": { "id": DAY, "weatherLocationIds": [...] } }]`

MCP clients use exactly these operations through `apply_trip_changes`. The batch uses the version from when the form was opened as `expectedVersion`. If the trip changed meanwhile, the form is marked stale. Saving then shows a conflict message and the latest saved choice for review, and nothing is overwritten. After an uncertain failure, pressing Save again sends the identical request with the same `requestId`, and new location IDs are generated once per pick. A 403 locks the form, and a 401 signs the page out. Cancelling or closing the dialog discards the unsaved choice.

## Fetching

- The forecast controller is trip-scoped and recomputed from the current trip on every render. Plan coordinates, dates, the time zone and weather choices change the associations. Language, notes and other unrelated edits don't.
- Only days dated today (in `trip.timezone`) through today + 15 are requested, matching Open-Meteo's 16-day horizon. Days with no points, and "no forecast" days, are never requested.
- Points are deduplicated across days and between explicit locations and automatic areas. They are sent in batches of at most 40, with at most 120 points per trip. The endpoint, fields, units, timezone parameter and attribution are unchanged.
- A request starts only when the set of needed points or the time zone changes, or when data is older than five minutes on resume or reconnect. Renders, polls and language changes reuse the in-memory data.
- When the needed points, time zone or session change, or a day is removed or turned off, in-flight responses are discarded. Late results are ignored after sign-out.
- Sign-out initiation disposes weather work before waiting for the logout response. The weather date labels use the current validated trip timezone, including while a dialog remains open after a remote edit.
- Forecasts are kept **in memory only**, in every mode: no `localStorage`, IndexedDB, Cache Storage or service-worker copy. Last-known data is shown (as "Saved forecast") only for the same point and time zone after a failed refresh.

## Tests

`scripts/test-weather-association.mjs` covers the pure rules and the controller (injected fetch and clock). `scripts/test-weather-server.mjs` covers the domain, real HTTP and the MCP SDK client. `scripts/test-weather-editor-ui.mjs` covers the editor module in four languages and the trip page in jsdom. All three use fictional data and never contact Open-Meteo.

The legacy generator also accepts absent/null automatic mappings and explicit `[]` off mappings alongside manually mapped days; malformed types and unknown manual IDs still fail validation.

Open-Meteo's [forecast API documentation](https://open-meteo.com/en/docs) documents coordinate batches, the timezone parameter and the 16-day forecast window. Provider output and live availability require separate evidence.
