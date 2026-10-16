# CP031 — MCP discovery and binding rollout

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: partial — deployment complete; host metadata refresh and target-client write schema pending
- Approximate active time: 15 minutes
- Source and deployed commit: `c532f4644433266f9b23e0cd465eb4bc0349499f`
- Baseline: [CP030](progress_2026_10_16_cpx030_codex_b.md); prior deployed source `34bdc631fe800bcb0c6b123a93f22f8f697f66ca`

## Scope and preflight

Completed the authorized image-only rollout of CP030. Read current instructions and continuation comments, fetched main and checked the worker handoff. No local continuation prompt, additional report comment, unintegrated handoff or duplicate deployment was present. The prior application was healthy with one live data worker. The unrelated ignore-file edit is preserved.

No application code changed during this rollout. The source archive came from the exact approved commit. All server files except the accepted `server/mcp.mjs` change, frontend assets, authentication/storage modules, lockfile and deployment templates matched the prior release. Private operations remained with Codex; no helper or external model received operational context.

## Backup, rollback and preservation

Fresh online and stopped-state SQLite snapshots passed integrity validation and isolated restore under both the approved and retained prior images, with all eleven application tables exact. A fictional new/prior/new read-write round trip preserved the Google association, related links, weather choice, trip flag and later edit; read-only binding metadata was never persisted. Photo archives and off-host online/cutover/photo copies passed digest checks.

The app-only cutover changed the image tag, retaining the existing environment values, mounts, private port and network membership. The existing proxy and provider gateway containers remained in place. The running immutable image ID, source label and actual running MCP module bytes matched the approved release. The prior immutable image and compatible configuration remain recoverable. No database migration or data restore was performed; rollback must retain later edits and current allowance usage.

All eleven database tables were exact immediately after cutover. After the existing connector's read, every trip ID, version and content field, account, client registration, grant identity/audience/scope/expiry/revocation field and other non-usage table remained unchanged. The connector automatically performed its normal OAuth refresh: one refresh audit event, token rotation, expired-token cleanup and usage timestamps were verified against existing behavior. That current state was preserved; no old authentication snapshot was restored and no new grant or manual credential provisioning was performed.

Photos, weather choices, Google site/trip settings and configuration were preserved. The separate allowance ledger retained its file identity, rows and counts; its consistent snapshot is evidence only and was never restored. No real-trip write, Google call, association change, quota reset, permission, billing or network change occurred. Secrets were consumed only through existing mechanisms, without output, export or configuration changes.

## Acceptance evidence

| Surface | Actual result |
| --- | --- |
| Approved source tests | Reused CP030's full `npm test` result: passed, 162 seconds, plus generation/static QA and privacy checks. No source changed afterward |
| New production image, isolated Linux | Actual SDK discovery/set/read/clear regression plus association, per-trip setting and related-links suites passed with fictional SQLite/HTTP fixtures, no external network. Shared validation, authorization denial, conflicts, atomicity, durable retries, location invalidation and audit remain covered |
| Running production MCP endpoint | Official SDK initialization and actual `tools/list` over the existing authenticated loopback route passed. Metadata version 1.1.0; exactly six existing content tools; structural association fields and explicit null-clear, nullable `place`, bounded `relatedLinks`, and boolean trip setting on update/create all verified |
| Running production reads | Actual `get_trip` responses returned bindings for current stable day/plan IDs, matching the shared helper, with null for locationless plans and metadata outside stored trip content |
| Existing installed connector | Authenticated `list_trips` and `get_trip` succeeded through the existing connection. The returned binding metadata was visible and referenced valid plans. No website sign-in or new grant was required; no content write was attempted |
| HTTPS and assets | Public HTTPS and direct-origin TLS health passed. Eleven no-store/anonymous boundary checks passed, and seventeen served assets matched the approved source archive. Quiet Compose validation passed |

The endpoint discovery above is live production loopback evidence, not an isolated-image substitute. The connector read separately exercises the existing external connection. Raw public-proxy `tools/list` is not exposed by the available connector tools and was not independently captured. Neither server discovery nor a successful read establishes client write-argument visibility.

The first live probe received `forbidden_host` because its fetch adapter did not preserve the required Host header. Using a bounded local HTTP adapter with the existing accepted Host resolved the probe; no application policy or network setting changed. Initial failures did not authorize a write. No UI changed, so no new browser-layout, phone or physical-device acceptance is claimed.

## Remaining client acceptance

This conversation's generated `apply_trip_changes` schema still omits `googlePlaceAssociation`, `place`, `relatedLinks` and `googlePlacePhotosEnabled`. The available connector and plugin-management tools expose no metadata-refresh operation. The supported host settings control has not been exercised here; absence from this tool surface does not prove that the control is absent in the host UI.

The next step is the [supported metadata refresh](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) on the **same installed connection**, followed by a new conversation with that same plugin selected and confirmation of the four argument fields. Preserve its identity, endpoint, audience, scopes and grants. No disconnect, replacement connection, permission request, full-trip replacement or reauthentication workaround was attempted. If the host lacks Refresh or demands changed authorization, report that precise host blocker while retaining the current connection.

The rollout and server/read acceptance are complete. Target-client write-field visibility remains a separate gate; no production association write is authorized by this checkpoint.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
