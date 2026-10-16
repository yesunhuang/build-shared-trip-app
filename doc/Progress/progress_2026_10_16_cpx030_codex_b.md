# CP030 — Usable MCP place-association discovery

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — implementation and tests; not deployed
- Approximate active time: 20 minutes
- Source commit: `c532f4644433266f9b23e0cd465eb4bc0349499f`
- Baseline: [CP029](progress_2026_10_16_cpx029_codex_b.md), deployed `34bdc631fe800bcb0c6b123a93f22f8f697f66ca`

## Diagnosis

Read current instructions, CP029 and comments, fetched main and checked the active handoff. No additional report comment or unintegrated worker handoff was present. The unrelated ignore-file edit is preserved. The previously recorded Claude capacity blocker remains unresolved; Codex completed this bounded fallback without claiming helper execution.

| Evidence surface | Observed result |
| --- | --- |
| Existing source and deployed image | Already include `googlePlaceAssociation`, `place`, `relatedLinks` and `googlePlacePhotosEnabled`. This is not a missing shared-domain mutation capability |
| Actual deployed-image discovery | Official SDK Streamable HTTP initialization and `tools/list` returned six tools and MCP version 1.0.0. All four fields were advertised, but lacked structural types. The module matched the labeled source after accounting for CRLF line endings |
| Probe boundary | Discovery used the deployed immutable image's actual MCP handler through isolated loopback HTTP with an empty gateway, no production data/configuration mounts and no external network. It was not an authenticated trace of the public MCP endpoint |
| Existing connected client | Its exposed generated argument schema omits all four fields and has older tool descriptions. The available evidence establishes a server/client schema mismatch; it cannot establish whether host caching or schema conversion caused it |
| Actual authenticated connection | A read-only `list_trips` succeeded through the existing installed connector without browser sign-in. No production content write was attempted. Raw endpoint `tools/list` and metadata refresh are not exposed through this connector's available tools |

## Changes

`server/mcp.mjs` now publishes structural JSON Schema for the association's three required fields and explicit null-clear, nullable selected place, bounded ordered related links and the trip boolean. Discovery metadata is version 1.1.0. Metadata overlays retain permissive Zod values so the existing shared domain remains the runtime validation authority, including normal `validation_failed` results.

`get_trip` adds read-only `planLocationBindings` alongside `trip`: stable day/plan IDs and the current shared-helper binding, or null for a locationless plan. Saved associations remain inside their existing plan fields. This derived metadata is not stored, exported or added to HTTP trip responses. A client can read a fresh version and binding, then use the existing narrow `upsert_plan` to set or null-clear an explicitly authorized, person-confirmed public-venue association. No browser session or provider lookup is needed.

The same six content tools, content-manager authorization, shared mutation service, transactions, expected versions, request idempotency and payload-free audit remain in use. No administrative/search endpoint, OAuth scope or permission was added. `references/mcp.md` documents the workflow and refresh procedure; `package.json` includes the new regression in the full server suite.

## Verification

- `scripts/test-mcp-place-discovery.mjs` passed using the official SDK, real local HTTP and disposable SQLite. It checks actual wire discovery; fictional content-manager set/read/clear; browser-cookie/anonymous/invalid/revoked denial; viewer write refusal; malformed IDs, forbidden Google content, wrong/locationless bindings and invalid field rejection; atomic rollback, stale versions, durable retries across restart and later edits, location-change invalidation, trip isolation, unrelated-field preservation and payload-free audit.
- Full `npm test` passed, exit 0, 162 seconds, including HTTP/MCP, OAuth, persistence, conflict, allowance and DOM regressions. Test identities and credentials exist only in disposable fictional fixtures. No external provider was contacted by the new test.
- Demo regeneration, fresh disposable fictional generation, static QA and framework privacy with the external denylist passed. Generated demo content remained unchanged. Actual outgoing source/docs/test diff and public-safe Git metadata were reviewed; `git diff --check` passed.
- An initial fixture omitted a required date and was corrected. The first full run then stopped at the privacy scanner's explicit password-field rule in the fictional fixture; the fixture now follows the existing shorthand convention. The scanner was unchanged, and the complete rerun passed.

No UI was changed. Existing DOM checks are simulations, not new browser, physical-device or live Google acceptance. No production deployment, trip mutation, credential/configuration access, grant change or Google request occurred. No allowance ledger was initialized or altered.

## Deployment readiness and client refresh

The code is ready for a separately authorized rollout. Production remains on the CP029 source and metadata 1.0.0; the new structural schema and read-only binding metadata are not live. There is no persistence migration. Existing saved content remains compatible with the prior release; rollback removes only the new discovery/read metadata and must preserve later data and allowance usage.

The [supported custom-connection refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) uses the same installed connection's **Refresh** control, verifies its metadata, then starts a new conversation with that same plugin selected. Preserve connection identity, endpoint, audience, scopes and grants; do not disconnect, recreate it or use full-trip replacement as a workaround. Published-plugin tool updates have their separate review flow.

The precise remaining client blocker is that this session has no exposed metadata-refresh operation or target-host refresh result. An existing connection owner/administrator must perform its supported metadata refresh and confirm that the target conversation exposes the four fields. A refresh of today's deployed metadata might recover existing fields, but cannot provide the new binding response before rollout. Actual post-refresh client write visibility remains unverified. A website sign-in or newly issued credential is not required merely because these are content writes; stop and report if the host unexpectedly requires changed authorization.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
