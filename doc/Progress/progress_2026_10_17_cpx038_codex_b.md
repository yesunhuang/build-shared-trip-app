# CP038 — Responsive home covers fixed and deployed

- Date: 2026-10-17 UTC
- Agent: Codex B
- Status: complete
- Approximate active time: 20 minutes
- Source and deployed commit: `145531f7b3e00158efec1de3113d5e842763b616`
- Prior deployed source: `530574134a2f079e2b00d3adc149b594338dccf5`

## Verified cause and changes

Resumed the assigned identity, read current instructions/contracts and CP037, fetched main and checked the active handoff, continuation files and comments. No additional directive, unrelated local edit or duplicate rollout was present. The established Claude route remained unavailable; Codex completed this bounded fix locally without sharing private context.

Reproduced the reported shape using fictional artwork and the actual pre-cover shell/worker from public commit `3aadf973410174a8138943059d155eb351e82050`. The controlling worker discarded the stylesheet's build query when matching its cache. New home code consequently received old CSS without cover sizing, leaving the image at its intrinsic width. Fresh-context testing alone had missed this upgrade path.

At a configured 360 px viewport, the failing image was 1024 px wide inside a 328 px card; document width expanded to 1065 px. Both `innerWidth` and scroll width became 1065, concealing overflow in the earlier comparison. The corrected reproduction has a 278 px image inside the same card and a 360 px document. This establishes the defect and a matching reproduction; the original physical phone's cache/network trace was unavailable.

- `assets/app-template/public/trip-presentation.js`: critical width/minimum/maximum bounds travel with each cover image, including when older CSS is still controlling. Saved pixels, alternative text and crop focus remain intact.
- `assets/selfhosted/home.css`: covers use the card's available content width with inset spacing; removed negative-margin expansion and unrestricted maximum width. Cards can shrink and long titles wrap. No overflow clipping was introduced.
- `assets/selfhosted/service-worker.js`: versioned shell resources retain their full URL/cache identity. Protected responses remain excluded.
- `scripts/test-cover-browser.mjs`, `test-hosted-shell-cache.mjs`, `test-cover-editor.mjs`: image/container and configured-viewport assertions, actual old-worker upgrade coverage, independent version keys, warm reuse and critical-sizing checks. Updated `references/responsive-performance.md` and regenerated the fictional demo.

## Validation

| Evidence | Outcome |
| --- | --- |
| Full `npm test` | Passed; legacy, server/HTTP/official MCP SDK and DOM suites, including the new shell-cache regression |
| Fresh generation | Demo regenerated; disposable fictional cover/category input passed validation, generation and static QA |
| Source browser acceptance | 171 checks passed in Chrome, including the actual old controlling-worker upgrade |
| Layout matrix | Home cards and trip headers at 320, 360, 375, 390, 412, landscape 812 and desktop 1280 px; all four languages, long/unbroken titles, 100%/150% CSS text sizing, wide/square/portrait artwork, loading/decoded states and legacy absent covers |
| Assertions | Each image stays inside its container; document width stays within the configured viewport; crop focus and header object-fit retained; no provider search, Google SDK or allowance reservation |
| Linux release image | Shell-cache, cover/category, branding and MCP regression suites passed in isolated containers without external networking |
| Publication | Actual outgoing text/diff and fictional image pixels reviewed; framework privacy audit with the external denylist and diff checks passed |

Public fictional previews: [home card](evidence/cpx038/fictional-home-card.png), [trip header](evidence/cpx038/fictional-header.png). These are Chrome mobile/touch emulation captures, not physical Android evidence.

## Deployment and preservation

Completed one image-only app cutover. A fresh consistent online backup and stopped-state backup passed integrity and exact isolated restores under the accepted and retained prior images. Database/photo copies were transferred off-host and their digests verified. The prior image already retains the same cover/category validators, raster handling and writable keys. An isolated accepted → prior → accepted rehearsal preserved fictional artwork, branding, categories, later version-aware edits and durable retry results. Rollback keeps current data and allowance usage; no older database or allowance snapshot was restored over live state.

The running immutable image/revision and fifteen source-module hashes match the accepted source. Public HTTPS and direct-origin verified TLS health returned 200. Twenty-three served assets, including the changed cover helper, stylesheet and worker, match the committed source. Eleven anonymous/private-route and no-store checks passed. Actual authenticated running-endpoint MCP discovery retained version 1.3.0 and the same six tools; typed presentation fields and read-only trip/HTTP page checks passed. Server/schema code is unchanged, so no connector metadata refresh or new client authorization was required; fresh target-client declarations were not retested for this styling fix.

All eleven live database tables matched the cutover snapshot after read-only acceptance, including every trip/version/content field and persistent account/OAuth/grant state. Photos, Google configuration and the separate allowance ledger's file identity, rows and counts were exact. Only the image tag changed; application environment, mounts, private port and networks were retained. Proxy and provider gateway containers stayed in place, quiet Compose validation passed, and one healthy live data worker remained. No real trip edit, Google request, credential/grant or network/security/billing change occurred.

Post-deployment browser acceptance replayed the captured public HTTPS asset bytes against isolated fictional data; 170 checks across the same phone/desktop matrix passed. Its first harness attempt mixed local and deployed build-query identities and could not boot the trip module; aligning the fixture's remaining local module queries resolved that fixture error without changing production code.

## Limits and next action

Implementation, publication and deployment are complete. Physical Android/Android system font-scaling and the original device session were not tested. Browser evidence covers Chrome mobile/touch emulation and explicit CSS text enlargement; production checks cover served bytes, health, protected reads and preserved state. Existing map/provider availability and real Google rendering were outside this fix. No owner setup or further deployment approval is needed.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
