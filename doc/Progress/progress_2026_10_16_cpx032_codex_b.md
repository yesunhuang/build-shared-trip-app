# CP032 — Missing itinerary marker correction

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — scoped data correction; browser visual check unavailable
- Approximate active time: 15 minutes
- Running source unchanged: `c532f4644433266f9b23e0cd465eb4bc0349499f`
- Baseline: [CP031](progress_2026_10_16_cpx031_codex_b.md)

## Diagnosis

Checked current instructions, main, handoff and report comments. No additional prompt, actionable comment or worker handoff was present. The previously unrelated ignore edit is now committed separately; no local edit was overwritten.

The affected plan had an address, a valid Google association and a full legacy Maps alias, but no finite saved coordinates. Location display was not deliberately omitted. `assets/app-template/public/app.js` filters map points by finite `lat`/`lng` and `mapLocationOmitted`; `index.html` creates markers only for those retained points. `hosted-client.js` preserves the canonical saved values without geocoding.

The association helper recognizes a valid legacy `mapsUrl` for its location binding. In `server/domain/validate.mjs`, coordinate derivation on an explicit write is tied to parsed canonical `googleMapsUrl`; the legacy alias alone does not populate the coordinate fields. Thus a valid association and working address link can coexist with a missing marker. Ordinary views intentionally perform no place lookup, and a Google association supplies no coordinates to the OSM map.

The currently exposed connector returned `Unknown tool` for its read operation. This was not evidence of an account denial or expired credential. The correction used the existing authorized server HTTP content route and shared domain service; no connection, account, role or grant was changed.

## Correction and preservation

One explicit public-venue query used the existing Nominatim integration, identifying application contact, cache and rate limits. The unique candidate's venue/street/city matched the venue's own public address. Its coordinates were independently checked against the primary OSM node API. No itinerary text, dates or private addresses were sent. Provider review followed the [current Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/): explicit limited requests, identification, caching and attribution; no background or bulk geocoding was added. Exact venue and source evidence remain private.

A fresh consistent backup passed integrity checking, isolated restore of all eleven application tables and an isolated shared-domain dry run. The backup's off-host copy passed its digest check. The real operation re-read the current trip and used one narrow `upsert_plan` with a fresh expected version, stable IDs and a durable request ID. It changed only latitude and longitude, plus normal version/timestamp metadata. No full-trip replacement or raw database write was used.

Independent read-only reconciliation verified exactly one accepted durable request and payload-free audit event, with one version increment. The initial post-write checker returned an uncertain status; the operation was not replayed. A separate comparison against the saved preimage and backup proved the intended result. The accurate address, Maps links, Google association and its binding, every other content field and every other trip remained exact.

Accounts, OAuth and credential records, configuration, photos, weather choices and Google site/trip settings remained unchanged. The allowance ledger retained its file identity, rows and counts. No Google request, new access, billing change, application restart or deployment occurred.

## Verification and remaining gap

The production image's actual read projection, `renderMap` and `initTravelMap` functions were executed against the before/after data in a VM with a Leaflet stub. At desktop and phone dimensions, the target marker was absent before, created afterward at the saved coordinates, and the map instance was reused. This is render-logic simulation, not browser or physical-device evidence.

The browser inventory exposed no connected browser surface. Therefore an actual on-screen production marker and live tile rendering could not be checked here. The smallest remaining check is to view the affected day in an existing signed-in connected browser without opening Google components. No login, new session or computer attachment was created to force that check.

`references/mcp.md` now explains the separate association and marker-coordinate requirements. No runtime code changed; full application tests and generation were not repeated for this documentation-only publication. Referenced paths, diff checks and the framework privacy audit with the external denylist passed; outgoing content was manually reviewed.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
