# Progress report - Codex B, checkpoint 017

- Date: 2026-10-16 UTC.
- Agent: Codex B.
- Status: complete; code, tests and documentation accepted, disabled by default.
- Approximate active time: 60 minutes.
- Base: `7a1772db47526376564d5bca065871c20f021263`.
- Accepted source: `d6e25545d69b1d1ef7abbec75aa6dc392f1d88b7`.

## Scope and implementation

Continued from checkpoint 016, whose comment contained no further instruction. No pending resume prompt, active handoff or equivalent Google integration was found. This assignment covers source, tests and documentation only; the deployed service and its existing OSM/Commons setup were left unchanged.

Added the disabled-by-default Google Places UI Kit in `assets/app-template/public/google-places-ui-kit.js`, integrated with the shared plan editor and expanded cards in `app.js`. It uses standard vertical `PlaceDetailsCompactElement` with media, address and attribution, plus standard `PlaceSearchElement` for explicit matching. Both use **Places UI Kit Query (Essentials), SKU 0678-4F72-DA7C**. No Advanced/Pro component, raw Places API, Google map or separate photo API is used.

Editors confirm a public venue and choose a result in Google's official component, or preview a user-supplied Place ID. Nothing is selected automatically. A saved association then loads automatically on expansion or marker selection for that plan only. The page deduplicates library loading, component construction and request assignment; it retains up to three components. Reloads, evictions, retries and SDK reconnections can add requests and charges.

The shared `google-place-association.js` stores only the permitted Place ID, a fingerprint of the plan's own location and the editor's public-venue confirmation. Google names, addresses, coordinates, ratings, photos, URLs and resource names are excluded. `server/domain/validate.mjs` enforces the same shape and location binding for HTTP, MCP, create and import. Unrelated edits retain the association; changed locations clear stale links. Stable IDs, atomic batches, conflicts and durable retries remain in the existing mutation path. No database migration is required.

`server/google-places.mjs` and the protected no-store configuration route keep the browser key out of trip data, static assets and audit output. Missing flag or key leaves the feature inert. Compose examples remain off, with no key. README, SKILL and affected contracts describe the behavior; [the integration guide](../../references/google-places-ui-kit.md) records setup, component styling limits, provider terms, networking and costs.

## Provider and cost review

Official documentation and terms were reviewed on 2026-10-15. Section 15 permits UI Kit with non-Google maps; Google renders its content and attribution separately from the OSM map. The app neither extracts nor persists Google photos. Vertical compact layout supports narrow cards; the app styles the outer host and leaves provider content intact. Sources are linked in the integration guide.

Assuming 29 detail events per full view, global USD pricing, no other billing-account usage and the shared 10,000-event monthly allowance available:

| Monthly full views | Detail events | Estimated detail cost |
| --- | --- | --- |
| 10 | 290 | $0 |
| 100 | 2,900 | $0 |
| 1,000 | 29,000 | $19 |

Matching searches and Place ID previews use the same Query SKU and allowance. Separately, 29 matching searches cost $0 with an unused allowance, or add $0.029 when combined with 29,000 detail events. Actual Google metering and project billing remain untested.

## Evidence

| Check | Outcome |
| --- | --- |
| Focused HTTP/MCP suite | Passed with fictional data and external-network refusal: configuration, protected endpoint, role denials, strict storage, location changes, atomic refusal, conflicts/retries and import/export. |
| Mocked UI suite | Passed: disabled/no-key fallback, lazy loading and request counts, duplicate renders, retention, cross-trip isolation, ambiguity, no-photo/failure/timeout, cancellation, public-venue guard, four languages and phone-sheet host. |
| Chrome, fictional isolated service | Passed at 1280 x 900, 390 x 844 and 375 x 812. Explicit mocked selection saved the association; marker selection expanded its card. Reopen, unrelated note edit and language changes retained one component/assignment. Reload was idle until expansion. Editor and page had no horizontal overflow. Phone widths are emulation. |
| Google network and data | Browser fixture blocked Google origins and supplied a local component mock. Initial page/editor opening made no Google activity; one explicit search plus repeated identical search produced one query. Real SDK rendering, photos, key restrictions and billable counts remain untested. |
| Required regression and generation | Final `npm test` passed, including legacy, HTTP/MCP, account/OAuth and UI suites. `node scripts/build-docs-demo.mjs` regenerated the fictional demo. Fresh disposable generation from the fictional example and `qa-static.mjs` passed. |

Claude implemented the public feature and tests using the verified `claude-opus-5-5` model through a restricted file-only public export. It received no private deployment context and could not run shell, network or connected tools. Codex handled research, acceptance and publication. A focused helper correction preserves legacy map-link normalization and adds a localized notice for a discarded pending association; both passed regression. Two test-harness errors were corrected: a negative import fixture reused its current location, and a URL assertion omitted the request log's method prefix. The final run passed with strict negative-location and exact request checks.

The fictional browser tab was closed, viewport reset and fixture endpoint stopped. Screenshots and raw receipts remain outside Git. No real key or billable call, activation, billing setup, account/grant change, network expansion, live import or deployment occurred.

The actual outgoing source, generated output, report, links and neutral author metadata were reviewed. Framework privacy auditing with the external private denylist and Git whitespace checks passed. The pre-existing unrelated ignore-file edit remains outside these commits.

## Current state and next action

The source is ready for future activation. The owner would review current terms/pricing, enable the required APIs in their own billing project and configure an appropriately restricted browser key privately. A separate authorized deployment and live fictional acceptance would then verify the real SDK, attribution, request behavior and billing. OSM/Commons remains available without Google setup. No owner action is required for the disabled release.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
