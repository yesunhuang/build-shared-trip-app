# CP025 — Clickable card addresses and editable related links

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — implemented, tested, published and deployed
- Approximate active time: 45 minutes
- Deployed source: `06f27f3c44c524927287f929679bf59a4e0555ab`
- Main implementation: `ff39ec8e5903ea5f21004f28661838fe67241a8c`; final locationless-plan correction: `06f27f3c44c524927287f929679bf59a4e0555ab`
- Baseline: [CP024](progress_2026_10_16_cpx024_codex_b.md), `15c4cd71f0ea6ca0b802f56779c51a644bd76959`

## Behavior and changes

Continued the authorized card-address/related-links assignment from current main. The continuation locations, active handoff and latest report comment had no additional instructions or equivalent unfinished work. The unrelated ignore-file edit was preserved. The previously established Claude capacity blocker remained; Codex performed this implementation and the private deployment, with no claim of helper execution.

The address rendering path disabled search fallback and required exactly one destination. Its metadata styling also drew an arrow on plain text. In `assets/app-template/public/app.js`, address/place-name text now opens a saved validated Maps destination or selected-place coordinates first, then an encoded ordinary Maps name/address search through the existing helper. Multiple saved destinations remain separately labelled anchors. Explicitly omitted locations stay plain, and a plan title alone creates no location row or unrelated search. An explicit saved place name can supply a name-only search. Only actual location anchors have an arrow. Existing map buttons retain their prior destination rules. No Places request or Place ID is needed for navigation.

Added `assets/app-template/public/related-links.js`: up to six ordered per-plan `{id,label,url}` entries, stable unique IDs within a plan, labels up to 80 characters and absolute HTTP/HTTPS URLs up to 2048 characters. Client and shared domain validation reject unsafe schemes, userinfo, malformed URLs/percent escapes, controls, invisible formatting and oversized/duplicate entries. Labels render as escaped text. Native external anchors keep new-tab opener/referrer protection and the existing refresh-during-press guard.

The four-language plan editor provides Add, Edit, Remove and Move up/down controls, accessible labels, focus retention and ordering/removal announcements inside the scrolling dialog. Owners and content managers can save; viewers remain read-only. Shared validation in `server/domain/validate.mjs`, MCP discovery in `server/mcp.mjs`, and legacy generation preserve ordered entries through atomic version-aware edits, durable retries, polls, reloads, import/export and restart. Translation patches cannot replace structural links. Existing trips need no schema migration or rewrite.

Updated template styles/HTML, schema and link guides, README, fictional demo and regression suites. See [related-links contract](../../references/plan-related-links.md).

## Verification

| Evidence | Actual result |
| --- | --- |
| Final `npm test` | Passed, exit 0, 158 seconds: legacy, backend/access/OAuth/allowance/weather and DOM suites, including related links and the locationless-plan regression |
| Shared write paths | Fictional real HTTP, SQLite and official MCP SDK: ordered IDs, edit/remove, import/export/restart, isolation, manager acceptance, viewer/anonymous denial, unsafe inputs, stale versions, atomic failure and durable replay passed |
| DOM regression | Desktop/phone simulations passed: address fallback, separate destinations, omissions, arrow states, escaped labels, editor ordering/persistence/conflict drafts, mouse/modifier/middle/keyboard/touch through refresh, and immediate authority-loss clearing |
| Generation/static QA | Demo regenerated; fresh disposable fictional output with related links generated, retained the entries and passed static QA; privacy audit with the external denylist passed |
| Production-image Linux | Seven isolated backend suites passed on the main implementation. Final-image related-link and map-destination suites passed; backend/shared-link module bytes were confirmed unchanged. No production storage mount or provider calls |
| Chrome production-image fixture | Main implementation: actual 1280×900, 390×844 and 375×812 viewports, six-link bound, reorder/edit/save/remove, URL refusal, reload persistence, scrolling/reachable Save and four-language controls without overflow. Final image: desktop locationless omission, encoded address search/Enter/new-tab isolation, related-link save and phone reload/editor at 375×812 rechecked; original photo/weather and zero-provider counts preserved |
| Native browser navigation | Address-search Enter, related-link Control-click and phone-width click opened local mock destinations in isolated new tabs. The stored address search was correctly encoded. These checks made no Google navigation or SDK request |

The initial legacy regression caught a name fallback that broadened generic map-action behavior; it is now explicit for location text only. Review moved the editor into the existing scrolling content. A final omission review then found generic plan titles could acquire a location row: the follow-up correction and regression preserve locationless plans while accepting explicit place names. Final full regression and generation include these corrections. A rollback harness initially expected the already-updated prior image to reject related links; a fresh fictional fixture corrected that expectation and verified successful preservation through its writes.

Reviewed fictional screenshots: [desktop card links](../evidence/cp025-related-links-desktop.jpg), [phone editor](../evidence/cp025-related-links-phone.jpg). Phone-width browser input is emulation; touch/refresh races are synthetic DOM evidence. Physical Android tapping, long-press/context menus and a real-device poll during a press remain unverified.

## Deployment and preservation

A fresh online backup and a second stopped-state backup were validated before cutover. Each restored in isolation under the prior, accepted and compatibility rollback images, with all eleven application tables matching exactly. The photo archive matched its source fingerprint. Database/photo copies retained off-host passed digest verification. A separate consistent allowance snapshot was retained as evidence, never restored over live usage.

Only the application image tag changed. After restart, all live table rows matched the stopped-state snapshot exactly: trip IDs, versions, content, related state, photos, weather choices, Google trip choices, accounts and authentication/access/revocation records were preserved. The allowance ledger retained its file identity, exact rows and counts. Existing Google configuration and credentials were unchanged; no allowance initialization/reset, real plan edit, venue association or Google usage occurred.

The application is healthy on the exact source above. Twelve served assets matched the committed archive. Public HTTPS, direct-origin HTTPS health and eleven no-store/anonymous-private-boundary checks passed. The application port remains private; proxy/gateway containers and network/access settings were unchanged. Quiet Compose validation passed.

The original pre-feature image reads trips with the new field but refuses writes carrying it. A retained compatibility image combines that interface with the new shared validator. Both that image and the immediately preceding accepted image passed fictional future-data writes and return-to-new-image checks, preserving links, photos, weather choices and later note edits. Use a compatible image if later related-link edits exist; never blindly restore an old database or ledger over later work. Fresh backup/restore, preservation and HTTPS/source checks were repeated for the final correction; each image cutover was verified independently.

The isolated acceptance container, owned tunnel and agent-created fixture tabs were removed, and temporary viewport overrides were reset. No persistent live test trip was created.

## Remaining work

The authorized implementation and rollout are complete. Editors can add their own links through Edit plan; this rollout changed no real plan. Physical-device acceptance remains as described above. Live Google SDK/linking verification remains separate from this change, with current configuration and usage preserved. No new owner decision is required for this rollout.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
