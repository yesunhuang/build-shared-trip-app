# CP028 — Compact weather refresh

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — implemented, tested, published and deployed
- Approximate active time: 15 minutes
- Source and deployed commit: `7a1b7fd611d5bddb8b51a3d990c0edf22d1da39d`
- Baseline: [CP027](progress_2026_10_16_cpx027_codex_b.md), deployed `7cb3498`

## Changes

Checked current main, the worker handoff, instructions and CP027 comments; no additional comment was pending. Preserved the unrelated ignore-file edit. The previously recorded Claude capacity blocker remains unresolved; Codex handled this small refinement under the documented fallback.

`assets/app-template/public/app.js` replaces the visible Retry weather text with a local inline refresh SVG. It remains a native button with the existing localized accessible name, a localized tooltip in every state, and `aria-busy` while loading. The existing retry handler and throttling remain unchanged.

`styles.css` places the 20-pixel icon in a 44×44-pixel circular target beside the title and timestamp. The header uses one grid row with wrapping status text, visible keyboard focus and a highlighted loading state. Loading and cooldown disable the control. The icon is static, so reduced-motion preferences require no animation exception. `references/weather-association.md` and generated fictional `docs/` were updated.

The forecast controller, association/editor modules and all server files are byte-identical to CP027. Its thirty-second parsing deadline, bounded retries, provider cooldowns, null-safe values, partial forecasts, horizon/error states and manual choices remain intact.

## Evidence

| Check | Actual result |
| --- | --- |
| Full `npm test` | Passed, exit 0, 162 seconds, including weather resilience, server/HTTP/MCP, authorization, conflicts, links and allowance regressions |
| Focused UI simulation | Passed: four-language native icon button/name/tooltip, focus, loading/busy state, repeated activation, disabled loading/cooldown, one recovery request and unchanged stored trips, for viewer/editor and desktop/phone dimensions |
| Generation/privacy | Demo regenerated; fresh disposable fictional generation/static QA and framework privacy with the external denylist passed. Actual outgoing text, diff and screenshot pixels were reviewed |
| Production-image checks | Focused weather, shared server, related-link and map-link suites passed in isolated Linux containers; unchanged controller/security boundaries verified |
| Actual Chrome | Desktop 1280×900 and phone widths 320, 375 and 390, all four languages: no title/status/button overlap or page overflow. Measured SVG 20×20 and button 44×44; header stayed one row, including partial data. Enabled button contrast measured 6.02:1 |
| Native interactions/request counts | Shift-Tab showed visible focus; Enter started one twelve-second mocked refresh. Loading and cooldown clicks added no requests. Language/viewport rerenders added none. Two page loads plus two explicit refreshes produced four mocked batches total; Google, place/photo lookup and trip-write counters stayed zero |

Reviewed fictional previews: [desktop](../evidence/cp028-weather-refresh-desktop.jpg), [phone partial-data state](../evidence/cp028-weather-refresh-phone.jpg). Browser phone widths and mouse clicks are emulation; physical-phone touch and assistive-technology testing remain unverified. Provider responses were mocked throughout this assignment.

## Deployment and preservation

Fresh online and stopped-state backups restored in isolation under the accepted and retained prior images, with all eleven application tables exact. A fictional new/prior/new read/write round trip passed. Photo archives and off-host backup copies passed digest checks. The separate allowance snapshot remains evidence only, never restored over usage.

The image-only cutover preserved every live database row, trip ID/version/content field, weather choice, authentication/access/revocation record, photo and Google setting. The allowance ledger retained its file identity, exact rows and counts. Credentials were unchanged. Seventeen served assets matched the committed archive; public/direct-origin HTTPS health, eleven no-store/anonymous access boundaries and quiet Compose validation passed. The application port stayed private and existing proxy/gateway containers were unchanged. The prior image/configuration and validated backups remain recoverable, with no schema migration required. Rollback must preserve later edits and allowance usage.

Owned fixture containers, tunnel and tabs were removed; viewport overrides were reset. No real trip was edited and no persistent live test trip was created.

## Read-only browser-session inventory

Existing connected browser surfaces contained no open production-app tab. An available signed-in production session could therefore not be verified; stored login state remains unknown and was not read. Inventory created no production tab/session, performed no login or credential inspection, changed no access, made no Google call and saved no association.

The supported next step for pending Google verification is for the owner to open the application in an already connected browser, sign in personally if prompted, and leave that authenticated tab available. Public-venue linking and live component verification remain separate pending work. This weather rollout needs no further decision.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
