# CP021 — Daily weather choices and card text links

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — authorized code, fictional acceptance and publication
- Approximate active time: 60 minutes
- Baseline: CP020, `d8f84c7`; accepted source: `8c2507df626859b83810cbd8feb8999ffff31c04`

## Changes

Continued the authorized CP020 follow-up. The CP020 allowance guard is preserved. No deployment, Google activation, credential entry, billing/API/terms/network change or real itinerary edit was performed.

`assets/app-template/public/weather-association.js` derives automatic areas in memory from valid numeric coordinates already saved on that day's plans. It performs no geocoding or interpretation of names, addresses, flight text or day labels. Repeated coordinates are deduplicated; complete-link grouping has a documented 20 km maximum diameter. Distant groups remain separate. Each representative is an actual saved coordinate, chosen as the medoid, and labels say “Area near” a plan rather than claiming a verified city.

Existing `weather.locations` and `day.weatherLocationIds` represent the choices: absent means automatic, `[]` means explicitly off, and IDs mean manual. Legacy `weather.dayLocations` precedence, explicit empty choices, localized names and older partial-coordinate entries are preserved. `(0, 0)` remains valid. Unusable explicit points remain saved and never silently become automatic. Generator validation now accepts automatic and off days alongside manual days.

`weather-editor.js` and `app.js` add accessible four-language controls to choose saved points, enter coordinates, remove an association, turn a day off or return to automatic. Owners and content managers use the existing atomic HTTP/MCP mutation and shared validation paths, with stable IDs, expected versions and identical retries. Viewers remain read-only. Manual choices win across refreshes and plan edits; returning to automatic retains the saved location library.

`weather-forecast.js` now follows current trip data instead of initialization-only seed state. Coordinate, date, timezone and setting changes recompute associations. Requests are deduplicated across days/aliases and batched at 40 points, with a 120-point trip request bound. The existing 16-day window, provider, attribution and ordinary fallbacks remain. Generation checks, aborts and session disposal reject stale responses. Forecasts stay in memory only, with no persistent forecast caching.

The link root cause was plain-text rendering: the location line and content fields never became anchors, even though the map action already worked. `text-links.js` renders location text with the existing validated map URL where unambiguous, plus bounded HTTP/HTTPS raw URLs and inline Markdown links in descriptions, reviews and notes. Unicode URLs and localized text are preserved. HTML-looking text and unsafe protocols stay literal. Native new-tab anchors retain keyboard/modifier behavior and the existing link-refresh guard; map buttons are unchanged.

Updated contracts, service-worker shell entries, tests and generated fictional `docs/`. Restricted public-only Claude helpers supplied the implementation and corrections; executed Opus metadata was verified. Correction helpers later reported unavailable capacity. No repeated route probing or new capacity was used; Codex completed bounded acceptance fixes and integration.

## Evidence

| Check | Outcome |
| --- | --- |
| Full `npm test` | All legacy, server and UI suites passed, including the unchanged CP020 allowance/Google regressions |
| Weather rules/controller | Injected fetch and clock: automatic/manual/off/back-to-auto, old explicit mappings, distant areas, repeated hotels, missing/invalid/zero coordinates, plan/date/timezone changes, bounded batches, deduplication, stale responses, failure fallback, horizon and no persistent writes passed |
| Weather backend | Real local HTTP, SQLite and MCP SDK client with fictional data: permissions, atomicity, version conflicts, identical retries, independent trips, restart persistence and create/replace/export/import preservation passed |
| Editor simulation | Four languages, focus/input retention, coordinate validation, removal, off/auto, conflict recovery, uncertain retries, role loss, timezone changes and pending sign-out cancellation passed |
| Link simulation | Raw/Markdown/Unicode links, descriptions distinct from reviews, hostile input, unsafe protocols, bounded parsing, mouse/modifier/middle/keyboard/touch events, refresh protection and immediate access-loss clearing passed |
| Chrome desktop | Fictional trip: two automatic areas; manual/off/back-to-auto saves, manual persistence after plan edits and reload, stale edit refusal; native Enter and Ctrl-click opened isolated new tabs while the card remained expanded |
| Chrome phone width | Weather controls and planner checked around 375–390 px; automatic-area preview, save, location-text click, original photo and wrapping passed without horizontal overflow. Browser emulation, not physical-device testing |
| Request observation | Fictional weather provider: one initial batch, no new request for off, unrelated note edits, manual-preserving plan edits or the refused conflict; fresh batches after changed associations and page reload. Google and place/photo search counters remained zero |
| Generation/static QA | Fictional demo regenerated; fresh disposable generation with automatic, off and manual days plus `qa-static` passed. Expected local-preview warning without Firebase configuration |
| Publication | Framework privacy audit with the external denylist and whitespace checks passed; outgoing text/file scope, neutral author metadata and fictional screenshot pixels reviewed |

Acceptance corrected an off-to-automatic preview that incorrectly reported no saved coordinates. It also preserved valid zero/partial coordinates, completed Unicode URL and description coverage, and replaced an existing home-test timing assumption with waits for re-enabled controls. Earlier full runs stopped at that test race; the final complete run passed. Injected network/HTTP failures in weather tests produced expected warnings, not unresolved failures.

Weather responses and external navigation destinations were mocked in the browser fixture; actual Maps href equality was checked separately in tests. Existing OSM tiles loaded normally. No live weather-provider availability, Google SDK/billing, physical touch device or production behavior is claimed. Disposable fixture service/tabs were closed and the viewport override reset. The unrelated ignore-file edit was preserved and excluded.

Reviewed fictional screenshots: [weather controls](../evidence/cp021-weather-phone.png), [desktop card links](../evidence/cp021-card-links-desktop.png), [phone card links](../evidence/cp021-card-links-phone.png).

## Preservation, setup and next action

Trip schema stays v6; this change uses existing optional fields and needs no database migration. Old explicit mappings and location entries round-trip without rewriting reads. IDs, versions, unrelated edits, maps and saved images remain intact. A rollback retains the choices but an older frontend will lack automatic inference and these controls. Preserve the separate CP020 allowance ledger across any future rollback; never roll back or reset its usage to zero.

The existing owner-side private environment destination, registered Compose paths, restrictive file mode and quiet configuration validation were verified read-only. Exact editor/validation commands and the owner-controlled key-entry procedure are recorded outside Git. No secret value or environment-file content was inspected or printed. The current older deployment predates the allowance guard, so it must remain disabled.

Remaining owner setup: resolve provider enforcement or informed acceptance of the zero-charge limitation; independently arrange Maps JavaScript API and Places UI Kit, billing/terms and a website/API-restricted browser key; choose an explicit allowance after other billing-account consumers plus positive headroom; verify trustworthy time and initialize the new ledger with a conservative current-month baseline after a separately authorized rollout. Key restrictions, API/billing status and actual provider metering were not verified. The app ledger cannot guarantee zero charges from direct key use, SDK background work or other shared-account consumers.

The smallest next action is review of this checkpoint and the separate private setup handoff, then explicit deployment authorization if desired. Google stays globally off while the zero-charge limitation remains unresolved. No further code decision blocks this scoped implementation.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
