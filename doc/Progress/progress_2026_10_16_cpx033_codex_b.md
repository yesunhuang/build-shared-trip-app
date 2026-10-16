# CP033 — Per-trip logo and color theme

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — implementation and local acceptance; not deployed
- Approximate active time: 30 minutes
- Source: `3aadf973410174a8138943059d155eb351e82050`
- Baseline: `6ab560d`, [CP032](progress_2026_10_16_cpx032_codex_b.md)

## Changes

Read the current instructions, reports and comments; fetched main and checked the active handoff. No additional actionable comment or handoff was present. Preserved the separately committed ignore changes. The previously recorded Claude capacity blocker was not re-probed without new availability evidence; this assignment used the documented Codex fallback. No Claude execution is claimed.

`assets/app-template/public/branding-editor.js` adds a native four-language editor with local image upload/conversion, alternative text, preview, Default/Sage/Ocean/Plum presets, custom light colors, remove, reset, save and cancel. Controls have at least 44-pixel touch height; the phone dialog scrolls with wrapping actions. Conflicts retain the draft and offer explicit reload. Closing restores focus to the current Branding button, including after saving rebuilds the toolbar.

`trip-branding.js` applies independently saved presentation to the trip and resources pages. Missing branding preserves legacy/default presentation without rewriting old trips. Switching trips clears owned style/logo state. The installed application identity stays shared. Existing checklist semantics, maps, provider attribution/components, photos, weather and Google gates are retained.

`server/domain/branding.mjs` and shared validation accept only a bounded embedded PNG logo and a validated theme. The editor converts PNG/JPEG/WebP locally; the server independently checks PNG structure, CRCs, bounded inflation, dimensions and filters, rejects animation/SVG/remote URLs, and removes metadata. Saved logos are at most 256 pixels per edge and 64 KiB. Custom themes use light backgrounds and validated dark ink; derived text/accent shades meet 4.5:1 and meaningful theme borders meet 3:1 against supported surfaces.

Branding is optional trip JSON, included in existing database snapshots and JSON export/import. No SQLite migration or external asset service is introduced. Owner and content managers use ordinary atomic version-aware `update_trip` writes and durable request IDs; viewers cannot change it. Root `null` clears branding; the editor's reset explicitly selects the default theme and icon. Setting the object replaces it rather than merging nested fields. [The contract](../../references/trip-branding.md) documents these semantics and image preparation.

`server/mcp.mjs` exposes the typed logo/theme field in the existing create/update tools and returns it through reads/exports, with metadata revision 1.2.0. The same six tools, authorization and shared validation remain in use.

## Evidence

- Full `npm test`: passed; final run approximately 178 seconds. Existing map/link, weather, checklist, authentication, OAuth and Google allowance regressions passed with their documented fictional/mocked boundaries.
- `npm run test:branding`: passed after final adjustments. Real local HTTP, SQLite and official MCP SDK discovery/set/read/reset/clear exercised manager writes, anonymous/viewer denial, invalid uploads/colors, atomic failure, stale edits, concurrent version races, trip isolation, durable retry/restart, embedded-logo export/import and an integrity-checked isolated database restore. Audit metadata excludes logo payloads.
- Actual headless Chrome 155: desktop 1280×900 and touch-enabled phone emulation 375×812, all four languages. Verified native PNG upload and Canvas conversion, HTTP save/reload, independent trips, resources-page branding, presets/custom colors, contrast refusal, reset, keyboard Enter/focus return, touch actions, 44-pixel buttons and no dialog horizontal overflow. External requests were blocked; no live Google/provider acceptance or physical-device testing is claimed.
- Regenerated `docs/` with `node scripts/build-docs-demo.mjs`; validation, generation and static QA passed against fresh disposable fictional output outside the checkout.
- Framework privacy audit with the external denylist and diff checks passed. Reviewed outgoing text and both fictional preview images manually: [desktop](../evidence/cp033-branding-desktop.png), [phone](../evidence/cp033-branding-phone.png).

## Readiness and limits

Implementation is ready for a separately authorized rollout. No production deployment, real-trip branding/content mutation, credential/access change or Google request occurred. Server SDK evidence is local; deployed schema and actual target-client field visibility remain separate acceptance gates.

Rollback needs care after the first branded write: earlier validators reject the new field. Before rollout, validate a rollback image retaining the new validator, plus a fresh consistent backup/isolated restore. Never strip branding or restore older data over subsequent edits or allowance usage to fit an older image. Dark themes are outside this editor's supported palette.

The next step is production-deployment approval and that compatibility rehearsal. After rollout, refresh metadata for the same installed MCP connection and verify its actual branding fields before configuration. User artwork and palettes remain private, outside this repository.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
