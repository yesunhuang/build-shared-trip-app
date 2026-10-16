# CP024 — Audited operator trip opt-in

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — authorized maintenance entry and one-trip flag update verified
- Approximate active time: 15 minutes; continuation of CP023
- Maintenance code: `86f1291f11ea6a75c157da74ac14bb3b27b2f787`
- Running application source remains `8c2507df626859b83810cbd8feb8999ffff31c04`
- Baseline: [CP023](progress_2026_10_16_cpx023_codex_b.md), `18101627c4651e59d37eed38e5dc4cbed05d1337`

## Changes and authorization

Continued the owner's explicit instruction to resolve CP023's client-schema limitation through existing server authority. The missing connector field was not an authorization denial. Current instructions, the repository delegation skill, reports, continuation locations, main and active handoff were checked. No duplicate operation or new report comment was found. The unrelated ignore-file edit remains untouched.

No existing maintenance entry exposed this one-field operation. Added `server/cli/set-trip-google-photos.mjs`, following the established offline deletion command's ownership/backup/audit pattern. The command accepts an explicit trip ID, expected version, literal boolean, stable request ID and new backup filename. It reads only `SHARED_TRIP_DATA_DIR`; it needs no owner credential and adds no network endpoint.

The command refuses active service/maintenance ownership, existing or in-checkout backups, malformed arguments, missing databases and a schema needing a separate upgrade. Under the normal exclusive data-directory lock it creates a validated backup, reads the trip again and sends exactly one `update_trip` field through `ContentGateway` and `TripService.applyTripChanges`. Shared version validation, durable idempotency, ordinary transactions and payload-free actor/channel `operator` audit remain authoritative.

A guard inside the shared transaction compares the resulting trip with the fresh read, allowing only the requested flag and ordinary version/timestamp metadata. If validation would alter unrelated content, it throws before commit and rolls back the setting, retry record and accepted audit. Refusals can append the ordinary refusal audit. Replays never rewrite trip content.

Added `scripts/test-trip-google-operator.mjs`, package commands and the [operator guide](../../references/google-places-ui-kit.md#offline-operator-trip-setting). Claude capacity was unavailable in the established route; no repeated probe or new capacity was used. Codex performed this bounded implementation, tests and private operation.

## Verified live operation

The approved trip was **off → on**, using a fresh read and expected version. The version advanced exactly once. Its prior stored field was absent and correctly read as false through the existing legacy default.

Only the application was briefly stopped. The tested command ran as the normal application user in the current production image, with its public code mounted read-only and outbound networking disabled. No credential or live configuration was passed to the maintenance process. The application then restarted in the same existing container and image.

Independent post-operation checks compared the validated backup with current storage:

- The only target-trip field differences were `googlePlacePhotosEnabled`, `version` and `updatedAt`. Plans, associations, weather choices, photos, stable IDs and all other content matched.
- Every other trip and unrelated application-table row matched exactly, including account, credential, access/revocation and OAuth state.
- One ordinary durable request record and one accepted operator audit were added. Existing retry/audit records were preserved.
- The allowance ledger retained the same file identity and exact table contents through maintenance and restart. No initialization, reset, raise, reconciliation or count reduction occurred.
- Photo fingerprint and the complete private site-configuration digest matched. Proxy/gateway containers and network/access settings were unchanged.

A fresh connected-client read independently confirmed the enabled flag, one version increment and only the same three projected field differences. The recoverable pre-change backup has a digest-verified off-host copy. No old data was restored over later work.

## Test and acceptance evidence

| Check | Result |
| --- | --- |
| Full `npm test` | Passed in 188 seconds: legacy, backend, allowance, weather, access/OAuth and DOM suites, including the new operator command |
| Final operator tests | Passed locally and inside the current production image with fictional data: ownership refusal, strict arguments, mandatory/new backup, legacy absent/default-off field, true/false, conflicts, durable replay, operator audit, audit rollback, unrelated-normalization rollback, schema refusal and other-trip/photo/ledger preservation |
| Credential boundary | Test preload refused every application environment read except the data directory; command passed without credentials or other site configuration |
| Production-image isolation | Test container had no production data mount and no network. The live maintenance container used only authorized data/backup mounts and the read-only command |
| Live health/privacy/source | Healthy application; public HTTPS and eleven no-store/anonymous-boundary checks passed. Ten served assets matched the unchanged application archive |
| Final ledger/associations | Valid ledger, no clock fault, zero usage and zero new reservations. Existing valid Google association count remains zero |
| Publication | Framework privacy audit with external denylist, whitespace, relative links, actual outgoing text and neutral author metadata reviewed |

The first local test preload needed a Windows file URL; the corrected test passed. An initial private preflight assumed the legacy field was explicitly stored, and a container metadata probe assumed every service had a healthcheck. Both harness assumptions were corrected before any live mutation. Final legacy/default-off coverage was added and passed in focused local and Linux runs after the full regression run. No application defect was hidden or bypassed.

Frontend/template code did not change, so no new demo generation or browser-layout claim is made; CP021/CP022 generation/static and fictional browser evidence remain the relevant baseline. This task performed no public-venue linking, bulk matching, credential/grant change, real Google request or live SDK acceptance. Nothing private was sent to a provider.

## Remaining work

The approved trip is now opted in. Its zero existing associations means Google photos still require a separately authorized explicit linking step. Real SDK rendering, attribution, reuse and fallback acceptance also remain pending through an authorized same-origin browser route with owner-controlled authentication. These were outside this instruction; prior mocked tests do not establish live provider behavior.

The current allowance and site settings remain as approved in CP023. The app counter is not a provider hard spending cap. Future recovery must preserve the current ledger and later trip/access changes. The operator command must not be rerun as a new request merely to repeat this completed operation; inspect current state first.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
