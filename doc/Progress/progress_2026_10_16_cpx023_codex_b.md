# CP023 — Google activation configuration and remaining client steps

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: partial — site configuration and ledger ready; trip opt-in and live SDK acceptance pending
- Approximate active time: 10 minutes
- Running source: `8c2507df626859b83810cbd8feb8999ffff31c04`
- Baseline: [CP022](progress_2026_10_16_cpx022_codex_b.md), `ae969c4a9ee4d799fa7fa57fdda73d66e73ebe28`

## Scope and completed work

Continued the owner's explicit activation instruction after reading current instructions, the repository delegation skill, the Coray Trip skill, CP017–CP022 and the latest non-secret configuration. No continuation prompt, active handoff, duplicate activation or remote divergence was found. This task changed private operational settings only; application source is unchanged. Private work remained with Codex.

The owner reported provider/API/key-restriction readiness and accepted a bounded additional-cost risk after disclosure that application counters are not a provider hard spending cap. Those approvals were reused. No credential, grant, API, billing, terms, restriction, network or security change was made.

Fresh checks corroborated earlier production-off and mocked-only acceptance: the running and private site flags were off, no allowance ledger existed, prior acceptance recorded no real Google work, and no other trip was opted in. Host time synchronization was enabled and synchronized; an independent UTC clock agreed within two seconds. The Pacific billing month remained the approved month.

The separate ledger was initialized once with the explicitly approved baseline. The approved allocation and positive headroom were applied without increasing the usage target. Only those two non-secret settings and the global site flag changed. The owner-entered key stayed in its existing environment reference; it was not extracted, displayed, logged, modified or placed in a new key file. A journal retains the prior non-secret settings, and a digest check verified that all unrelated configuration bytes were preserved.

Quiet Compose validation passed. Only the application was restarted with the same image and release. Runtime configuration reports the site feature enabled; the ledger is valid with no clock fault and zero reservations consumed. No existing count was lowered, restored or reset.

## Preservation and live verification

| Check | Actual result |
| --- | --- |
| Data backup | Fresh stopped-state application snapshot passed integrity/content validation; its off-host copy digest matched |
| Saved data and authorization | All 11 application tables matched exactly after restart and at final acceptance, including IDs, versions, itinerary edits, weather choices, retry records, accounts, invitations, credentials, OAuth and audit metadata. Photo fingerprint matched |
| Configuration boundary | Same image, mounts, internal networks and unpublished application port; unrelated runtime settings preserved. HTTPS proxy and restricted lookup gateway were not restarted |
| Health and source | Public and direct application health passed; ten served assets matched the accepted archive after normal runtime version substitution |
| Privacy | Eleven public no-store boundary checks passed; anonymous private data, account, MCP, photo, Google configuration, reservation and search requests stayed denied |
| Connected client | Coray Trip read succeeded before and after restart; the approved trip remained byte-for-byte unchanged and opted out |
| Existing associations | The shared association validator found **zero valid Google associations** in the approved trip; no plan or association was changed |
| Acceptance budget | **Zero new reservations**. No live SDK, Search, Details, preview or provider call was initiated |

The failure path is prepared to restore only the global off switch and restart only the app while preserving the ledger and other settings. It was not exercised because configuration/health checks passed. Recovery must retain current data, later access/revocation changes and the current ledger; never restore older usage.

## Exact remaining blockers

**Trip opt-in:** the exposed connector's `update_trip.fields` schema omits `googlePlacePhotosEnabled`. Its read tool works, but its current edit schema cannot express the requested one-field write. No full-trip replacement, raw database write or wider mutation was substituted. The approved trip remains off, and every other trip is unchanged. A refreshed existing connector schema or an authorized narrow client route must expose this field; then read a fresh version and send only the requested boolean update.

**Live SDK acceptance:** no existing signed-in production browser session was available. The existing same-origin application route reaches its normal sign-in page. Owner-controlled sign-in is required before the bounded fictional SDK test can proceed. No credentials were entered, session/grant created, restriction broadened or public test endpoint added. The secure sign-in tab is retained for owner continuation.

Required attribution, real component rendering, lazy reuse, live fallback and opted-out-trip request behavior remain unverified against Google. Existing CP020–CP022 fictional/mocked evidence still applies but is not live SDK evidence. No physical-device test was performed. Provider-side key restrictions, enabled APIs and metering remain owner-reported rather than independently verified. No reservation was consumed merely to test access.

Zero existing associations also means that trip opt-in alone cannot produce Google photos; later explicit public-venue linking is a separate content action and was outside this instruction. Private itinerary content was not sent to Google or bulk-matched.

## Publication and next action

Framework privacy audit, whitespace and relative-link checks passed. Actual outgoing text and neutral author metadata were reviewed. Owner budget/configuration values, credentials, trip identifiers, deployment destinations and private operational commands are excluded. The unrelated local ignore-file edit is preserved.

Site configuration is complete. The smallest next steps are an available narrow trip-setting route and owner-controlled browser sign-in, followed by the already authorized bounded fictional SDK acceptance. No renewed key-readiness or cost-risk approval is requested. Preserve the initialized ledger through continuation; do not repeat initialization.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
