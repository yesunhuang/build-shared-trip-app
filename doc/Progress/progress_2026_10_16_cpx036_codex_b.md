# CP036 — Independent covers and explicit card highlights

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: partial — implementation and local acceptance complete; rollout and fresh target-client gate pending
- Approximate active time: 20 minutes
- Source: `530574134a2f079e2b00d3adc149b594338dccf5`
- Baseline: `d6fe131`, [CP035](progress_2026_10_16_cpx035_codex_b.md)

## Changes

Read current instructions, skill/contracts, main, handoff state and the latest report. CP035's comment section had no new continuation instruction; no resume prompt, active handoff or unrelated local edit was present. The established Claude route remained unavailable; Codex used the documented fallback without a new helper/model claim.

`assets/app-template/public/trip-presentation.js` and `cover-editor.js` add independent trip `cover` artwork. Authenticated home cards and trip headers show saved artwork separately from the small logo. Authorized editors can upload, replace, describe, adjust crop focus and clear it. PNG/JPEG/WebP conversion stays on the device; the shared server validates a bounded RGB/RGBA PNG, strips metadata and re-encodes it. Saved images are at most 1024 pixels per edge and 256 KiB. Missing covers preserve the previous layout. Branding and the installed app identity remain independent.

Plans gain explicit `cardCategory`: neutral, restaurant, hotel or ticketed transport. The plan editor exposes the choice; highlights use distinct backgrounds/borders, local icons and four-language text labels. Walking and car travel are never automatically classified. `planType`, reservations and booked status remain separate.

`server/domain/validate.mjs`, the existing service and `server/mcp.mjs` share validation, authorization, version conflicts, atomic batches and durable request retries. MCP metadata revision 1.3.0 retains six tools, with typed object/null cover fields on create/update and a typed enum on `upsert_plan`. Reads, list summaries, exports/imports, snapshots and restart retain the data. No public asset endpoint or new provider request was introduced. Presentation data cannot be changed by translation patches.

Updated README/contracts and regenerated `docs/`. The [field and rollout contract](../../references/trip-cover-and-categories.md) records image bounds, default/clear behavior, polling payloads, permissions and compatible rollback requirements.

## Evidence

- Full `npm test` passed in 191 seconds, including existing maps/photos, links, weather, branding, accounts/OAuth and allowance regressions. Final `npm run test:presentation` passed after editor/test refinements.
- Real loopback HTTP and official MCP SDK tests: structural six-tool discovery; set/read/clear; owner/content-manager writes; viewer/anonymous denial; invalid images/categories; atomic rejection, stale versions and concurrent writes; durable retry/restart; independent trips; export/import and isolated snapshot restore. No provider was contacted.
- Editor DOM tests: all four languages, accessible native controls, escaped descriptions, focus percentages, clear, retained conflict drafts, cancellation/late conversion and independent logo/header behavior. Semantic palette checks exceed 4.5:1 text and 3:1 meaningful boundaries.
- Actual local headless Chrome: 1280 px desktop and 320/375 px touch emulation, all four languages, native file/Canvas upload, replace/clear/save/reload, crop geometry, home/header/logo separation, keyboard Enter and focus return, 44 px controls, no dialog/card overflow, touch category editing and retained booking status, conflict draft/reload. All external traffic was blocked; no Google request, allowance reservation or place/photo search occurred. Initial harness selector/stale-fixture setup issues were corrected; the final acceptance run passed.
- Fictional demo regeneration, fresh disposable generation/validation/static QA, parsed cover/category retention and framework privacy audit with the external private denylist passed. Outgoing source/docs and the fictional image pixels were manually reviewed before publication.

Fictional browser previews: [home cards](evidence/cpx036/fictional-home.png), [desktop cover/highlights](evidence/cpx036/fictional-desktop.png), [phone editor](evidence/cpx036/fictional-phone-editor.png), [phone planner](evidence/cpx036/fictional-phone-planner.png). Phone captures are desktop-browser emulation. Blank maps and photo fallbacks reflect deliberately blocked external providers; these captures do not establish live provider behavior or physical Android/iOS acceptance.

## Remaining gate and deployment requirements

No production deployment, real content/branding write, provider call, credential/grant change or allowance operation was performed. Local discovery is not claimed as actual target-client field visibility. A post-rollout schema handoff was coordinated privately; the fresh target-client gate remains open for cover create/update object-or-null, the category enum and read visibility through the same installed connection.

The smallest next decision is separate approval to deploy this source. Before cutover: fresh consistent backup and isolated restore, a compatible rollback image retaining the new validators/shared presentation/raster modules and writable keys, preservation checks including authentication and the separate allowance ledger, then exact served-asset and health checks. Old validators reject the new fields on edits/imports; never remove saved content or restore older data/usage to fit an old image. After rollout, use the same App's supported metadata reload and require a fresh target-client schema/read result without changing identity, scopes or grants. Private artwork application is a later authorized content operation.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
