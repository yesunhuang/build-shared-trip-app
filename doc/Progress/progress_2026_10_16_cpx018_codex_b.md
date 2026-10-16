# Progress report - Codex B, checkpoint 018

- Date: 2026-10-16 UTC.
- Agent: Codex B.
- Status: complete; per-trip Google choice and native-link amendment accepted.
- Approximate active time: 65 minutes.
- Base: `8811b616ad93d175deceb9ef3b889de0622df262`; initial Google source: `d6e25545d69b1d1ef7abbec75aa6dc392f1d88b7`.
- Accepted source: `dccc3648f28d31e0dbfa5c39aa59e657527fb815`.

## Scope and behavior

Continued from CP017, whose comment contained no further instruction. No pending resume prompt, active handoff or equivalent trip setting was found. This amendment changes code, tests and documentation only. Google activation, keys, billing, accounts, network permissions, deployment and real trip data were untouched.

Added `trip.googlePlacePhotosEnabled`, strictly boolean and default off for both existing and new trips. Old rows read as false without being rewritten; an ordinary later write stores the explicit choice. `server/domain/validate.mjs`, `operations.mjs`, `service.mjs` and `server/mcp.mjs` share validation for HTTP/MCP create, update, replacement and import. Owner and content-manager editors may change it; viewers, anonymous, pending and revoked users cannot. Atomic batches, trip IDs, versions, conflicts and durable retries remain intact. The same six MCP tools remain available.

Create/Edit trip on the home page and Edit trip on the trip page expose a four-language checkbox. It may be saved while Google is globally unavailable, but displaying or matching still requires the global flag, configured key and trip opt-in together. Google stays additive to saved OSM locations and Commons/manual photos. Opt-out retains associations and content, clears shown/pending components and searches, and ignores late events. Older responses cannot reverse a newer opt-out. The existing official standard components, attribution, explicit matching and bounded page-session reuse remain in place. Already-loaded third-party code cannot be unloaded or earlier requests recalled.

Client changes are in `assets/app-template/public/app.js`, `hosted-client.js`, `google-places-ui-kit.js`, `hosted-resources-bootstrap.js`, new `link-activation.js`, styles and service-worker dependencies, plus `assets/selfhosted/home.js` and `home.css`. README, SKILL and affected contracts were updated, and `docs/` was regenerated from fictional input.

## Link diagnosis and fixes

The intermittent card-link failure was reproduced with the original `app.js`: a poll containing an unrelated edit replaced the pressed Maps anchor before pointer release, and the same regression failed its actual `isConnected` assertion. The amended code defers background replacement/reload until native activation completes. It keeps the latest pending update, preserves ordinary card/map/sheet behavior and leaves links to the browser. URL/protocol checks and `noopener noreferrer` remain enforced; unsafe URLs stay text. Google component event paths are recognized without reading their shadow content.

A separate original-code Chrome reproduction found that phone planner Control-click changed the current page and opened no tab. Its launcher now intercepts only an uncancelled plain primary activation. Modifier and non-primary actions retain native behavior. Sign-out, authorization loss and role changes bypass ordinary refresh deferral immediately; queued work cannot restore cleared controls. Resource-page final errors cancel queued reloads.

## Evidence

| Check | Actual outcome |
| --- | --- |
| `scripts/test-google-place-photos-trip.mjs` | Passed with real local HTTP and official MCP SDK calls using fictional data. Covers strict values on every write path, old/new defaults, no rewrite on read, restart, independent trips, permissions/denials, conflicts/retries, atomicity, import/export and unchanged OSM/Commons/manual photos, IDs and associations. Site-off and keyless configurations remain inert. |
| `scripts/test-trip-google-setting-and-links-ui.mjs` | Passed with mocked Google and simulated DOM input. Covers zero work when opted out, lazy/deduplicated loading, opt-out cancellation, late events and older responses, loader reuse, four-language checkbox, Maps/source/licence/recommendation links, mouse/touch/pointer/keyboard/modifier/aux activation, safe protocols and ordinary card/marker/sheet interactions. The original source failed the refresh-race regression; the pre-guard amendment failed the stale-response regression. |
| `scripts/test-home-trip-setting-and-links-ui.mjs` | Passed with jsdom and a local fictional service. Covers default-off/changed-only checkbox writes, trip-link focus/poll races, and immediate clearing on 401, owner demotion or explicit sign-out while a link is held, including after deferred work settles. |
| Full regression and generation | Final `npm test` passed, including legacy, backend, account/OAuth and all UI suites. `node scripts/build-docs-demo.mjs` regenerated the fictional demo. Fresh disposable generation and `qa-static.mjs` passed. |
| Chrome, desktop and phone widths | Checked 1280 x 900, 390 x 844 and 375 x 812. Both trips started off. Enabling A left B off and its version unchanged. A loaded one mocked component only on expansion; a note edit and repeated expansion reused it. Opting A out retained its place, photo and association and made expansion idle again. The setting fit in all four languages without horizontal overflow; the phone dialog scrolls vertically. |
| Native browser navigation | Keyboard Enter and phone-width middle-click opened the Maps action's local test destination in a new tab; the Enter destination confirmed a null opener. The fixed planner Control-click opened a separate planner tab while keeping the overview unchanged; ordinary click entered the planner in place. External fixture hrefs were mapped to a local landing page, so no provider was contacted. Exact Maps URL/protocol behavior is covered by automated tests. |

The isolated browser service recorded one configuration request, one library import, one details construction and one place assignment across the enabled expansion/reopen/note-edit checks. Opted-out pages showed zero Google hosts or mock activity. Final fictional versions were 4 for the edited trip and 1 for the untouched trip; saved IDs, OSM coordinates, photo and Google association matched their fixtures.

Claude implemented the public amendment and a focused correction through a restricted file-only public export; both receipts identify `claude-opus-5-5`. Helpers received no private context and ran no shell, network, connected tools or tests. Codex performed acceptance and publication, added the small monotonic-version guard with a failing-then-passing regression, and cancelled deferred resource reloads on final errors. Acceptance also corrected test request IDs and stale fixture assumptions without removing coverage.

## Limits and next action

Google services were mocked, with Google origins blocked by the browser fixture. Real SDK rendering, attribution, metering, billing and key restrictions remain untested. Phone widths are desktop-browser emulation; touch and refresh-during-press cases use DOM simulation, not a physical phone. No live application deployment or real itinerary edit occurred. Tabs were closed, viewport reset and the fixture endpoint stopped; screenshots and raw receipts stay outside Git.

The amendment is ready for future authorized deployment. Global owner-controlled setup remains necessary before any per-trip opt-in can display Google content. Earlier builds lack the trip gate and can reject the new JSON field; rollback compatibility and disabling Google globally on older builds are documented in `references/self-hosted.md`. No setup action is required for the disabled release.

Actual outgoing code, generated files, report, links and neutral author metadata were reviewed. Framework privacy auditing with the external private denylist and Git whitespace checks passed. The unrelated pre-existing ignore-file edit is excluded from these commits.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
