# CP026 — Clear address rows and compact card links

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — implemented, tested, published and deployed
- Approximate active time: 40 minutes
- Source and deployed commit: `b83bdc0ecb87b9a0581607f6620fbf7872bbccd2`
- Main implementation: `82dc16c2d39360fe7971ce57df7be016e047ccbd`; final separator correction: `b83bdc0ecb87b9a0581607f6620fbf7872bbccd2`
- Baseline: [CP025](progress_2026_10_16_cpx025_codex_b.md), `e0d6e900c2fc92c3857b7a72d660a14b6ef53a42`

## Changes

Completed the new presentation refinement after CP025. Main and the worker handoff were checked; the previous report had no additional actionable comment. The unrelated ignore-file edit was preserved. The established Claude capacity blocker remained, so Codex used the documented fallback without claiming helper execution.

`assets/app-template/public/app.js` now gives the address a distinct local map-icon row. It retains CP025's validated Maps destinations, selected-place coordinates, encoded name/address fallback, explicit omissions and separate multiple destinations. Identical destination actions are consolidated, including the former duplicate footer action; their explicit labels remain visible. Missing locations do not acquire an invented destination or misleading affordance.

New `assets/app-template/public/card-link-presentation.js` projects saved related links and safe raw/Markdown destinations from review, description and notes into a compact wrapping group of labelled icon anchors. Saved links retain their order, followed by prose destinations in field/text order. Exact validated hrefs share one action, retaining distinct explicit labels. Query order, fragments and encoded paths are not rewritten. Raw links without labels use their actual serialized hostname.

The projection never writes content. Clearly trailing link-only runs at sentence/line boundaries leave the paragraph; meaningful inline labels remain prose words. Punctuation inside a link label is not mistaken for a sentence boundary. Unsafe, escaped and malformed constructs stay literal. `text-links.js` reuses the bounded parser through optional strict/source-information modes; other card types keep their existing inline behavior.

Template styles provide visible focus, wrapping labels and targets at least 44 pixels high. Icons are decorative inline SVGs alongside visible text, with no favicon or metadata requests. Native navigation, safe new-tab protection, refresh-during-press handling, four-language UI and the existing six-link editor remain. README, link contracts and generated fictional `docs/` were updated.

## Evidence

| Check | Actual result |
| --- | --- |
| Final `npm test` | Passed, exit 0, 171 seconds: legacy, server and UI suites, including shared HTTP/MCP validation, roles, conflicts, durable retries, import/export, persistence, weather and allowance regressions |
| Projection and DOM regressions | Passed: mixed prose, trailing runs, raw hostname labels, exact-destination deduplication, explicit aliases, malformed/hostile input, bounds, omitted/multiple locations, editor save/poll/reopen, stable IDs, stale drafts, localization and synthetic mouse/modifier/middle/keyboard/touch activation through refresh and authority loss |
| Generation/privacy | Demo regenerated; fresh disposable fictional output retained links and passed static QA. Framework privacy with the external denylist and outgoing diff review passed |
| Production image | Focused related-link and map-destination suites passed in isolated Linux containers. All server files and existing provider/security/mutation modules were confirmed unchanged |
| Actual Chrome fixture | Main image: 1280×900, 375×812 and 390×844 viewports, distinct address row, wrapping links, long labels, visible focus, no horizontal overflow, four-language headings, save/reload and original photo passed. Final image: desktop and 390×844 layout plus the separator-only regression rechecked |
| Native browser navigation | Main image: address Enter, related-link Control-click, middle-click and phone-width mouse click opened local mock destinations in isolated new tabs. Final image: address Enter and new-tab isolation rechecked. Recorded original Maps hrefs were verified; navigation targets were substituted locally, with no Google destination visited |
| Fixture preservation | Stored Markdown/prose remained verbatim after the fictional link edit; existing link IDs, independent trip, photo, weather and trip choice remained intact. Google and place/photo search counters stayed zero |

An existing picker assertion still targeted the former footer anchor and was updated to check the address row. The isolated browser fixture initially failed shared validation because its selected-place address and plan address differed; that fixture was corrected before acceptance or cutover. Final review also caught a pipe separator being treated as meaningful prose: the correction removes separator-only paragraphs while retaining meaningful symbols. Full regression, generation and desktop/phone browser checks were repeated for the final source.

Reviewed fictional previews: [desktop](../evidence/cp026-card-desktop.jpg), [phone width](../evidence/cp026-card-phone.jpg). Phone widths and synthetic touch events are emulation. Physical Android tapping, long-press/context menus and a real-device poll during a press remain unverified. No live Google SDK, provider navigation or billing behavior is claimed.

## Deployment and preservation

Fresh online and stopped-state backups restored in isolation under the new and retained prior images, with all eleven application tables matching exactly. A fictional new/prior/new read/write round trip preserved links and later edits. Photo archives and off-host database/photo copies passed digest checks. A consistent separate allowance snapshot was retained as evidence only, never restored over usage. These checks were repeated for the final correction.

Only the application image tag changed. After cutover, all live database rows matched the stopped-state snapshot exactly, preserving trip IDs, versions, every content field, weather choices, Google trip flags and authentication/access/revocation records. Photos matched their fingerprint. The allowance ledger retained its file identity, exact rows and counts; credentials and application settings were unchanged. No real trip edit, venue association, Google or place/photo search request, allowance reset or network/security/billing change occurred.

The exact source above is healthy. Thirteen served assets matched the committed archive; public and direct-origin HTTPS health, eleven no-store/anonymous access-boundary checks and quiet Compose validation passed. The application port stayed private and existing proxy/gateway containers were unchanged. The prior image/configuration and validated backups remain recoverable; rollback needs no schema migration. Never restore an older database or allowance ledger over later activity.

Owned acceptance containers, tunnel and fixture tabs were removed; temporary viewport overrides were reset. No persistent live test trip was created. The authorized rollout is complete; physical-device acceptance is the remaining optional check.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
