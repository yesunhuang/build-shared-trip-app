# CP044 — Mobile language label clipping

- Date: 2026-10-17; agent: Codex B; status: complete; active time: approximately 10 minutes (session total approximately 40 minutes).
- Source/deployed commit: `d851f9d85f71d6a94fd322229703266829653ab3`.

## Cause and change

The authorized follow-up was picked up after CP043 OAuth acceptance. Actual Chrome with the prior stylesheet and fictional content reproduces the Traditional Chinese label losing its final character. The planner select retained native `appearance: auto` inside a narrow fixed wrapper while reserving a separate right-padding gutter. Native arrow space reduced the usable selected-text area despite visible space beside the arrow.

`assets/app-template/public/styles.css` now reserves one gutter, uses a local decorative CSS chevron and explicit native-select appearance styling, and provides a wider bounded wrapper and minimum 44 px target. Focus remains visible, Back stays separate, and native select semantics, option labels, language handlers and preference persistence are unchanged. There is no new JavaScript or network dependency. Fictional `docs/` assets were regenerated; `references/responsive-performance.md` documents the browser regression.

Fictional selector crops, manually inspected for publication:

| Prior CSS | Fixed | Fixed at 200% text |
| --- | --- | --- |
| ![Prior fictional selector with clipped label](previews/cp044-language-before.png) | ![Fixed fictional selector](previews/cp044-language-after.png) | ![Fixed fictional selector with enlarged text](previews/cp044-language-200.png) |

## Validation and deployment

- Full `npm test` passed (199 seconds). Fresh fictional demo regeneration, disposable generation/static QA, diff checks and framework privacy with the external private denylist passed.
- `scripts/test-language-selector-browser.mjs`: actual Chrome, 84 combinations across four languages, 320/360/375/390/412 px, landscape 812 and desktop 1280, and 100/150/200% text. Selected labels fit their measured text area; bounds, Back separation, chevron, focus and minimum targets passed. Native keyboard selection, phone touch tap/Escape and reload persistence passed. Stored fictional trip content stayed exact; zero Google requests, provider searches or reservations occurred.
- After rollout, the same 84 checks passed with the actual served stylesheet in the isolated fictional service. This is desktop/mobile/touch emulation; physical Android and its system picker remain untested. No private screenshot or live trip was rendered for acceptance.
- Fresh consistent online and stopped content/auth snapshots restored through both accepted and prior v8 images with every table row preserved. Photo archives and off-host backup digests were verified. Rollback retains the current auth/ACL/scope backend and current data/usage; no historical live data was restored.
- Backend files match the previously accepted OAuth release byte-for-byte. Accepted Linux legacy/multiuser OAuth and membership suites passed. The app-only rollout changed the image tag; all environment values, OAuth mode/identity/grants and network controls stayed exact.
- Running immutable image/module bytes, 25 served assets, HTTPS health, both-scope OAuth discovery and 11 anonymous protected-route checks passed. Only one app worker owns live storage.
- Actual existing native MCP list/get/export passed with unchanged visible trip versions/archive states and matching exported content. Current role/membership/scope boundaries and media boundaries passed separate read-only checks. Final preservation confirmed content, versions, memberships, accounts/roles, credentials, clients/grants, photos, weather choices, Google flags and the allowance ledger. Only ordinary existing-client authentication metadata activity was allowed; no allowance reset or real trip mutation occurred.

No deployment decision remains. CP043 independent-account OAuth remains enabled; each recipient must personally complete supported installation/connection consent and read-only acceptance. The corrected portable package and exact Git/ZIP checksums remain intact. Physical-device confirmation is the remaining UI evidence limit. The known unavailable Claude route was not retried or claimed as executed.

Actual report text, outgoing diff and the three generic fictional image crops were reviewed before publication. No private itinerary, screenshot, account, credential or operational identifier is included.

## comment

Reserved for sanitized continuation instructions from the owner or authorized coordinator.
