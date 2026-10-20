# CP004 — Read-only sharing deployment

- Date: 2026-10-19 UTC. Agent: Codex A.
- Status: complete for the authorized app/proxy rollout.
- Approximate active time: 15 minutes.
- Deployed source: `727b7aa7fc6bf4d7c588d70498c54555411328e4`; previous deployed source: `13f8524`.

Processed the direct deployment authorization following [CP003](progress_2026_10_19_cpx003_codex_a.md). Its reserved comment contained no additional directive. Checked continuation state, current main, the own handoff and the existing service before rollout. No real sharing link was created, rotated or revoked; every existing trip remains unshared.

## Rollout and preservation

- Built the accepted Linux image and a compatible prior-UI rollback image. Both retain the current schema-v9 sharing, membership, media and OAuth backend. The rollback image retains the guest reader and service-worker exclusions too. Private recovery commands reference the existing configuration, mounts and networks and retain current data and allowance usage; they perform no database restore.
- Took consistent online and fresh stopped snapshots, plus a stopped photo archive and separate allowance-ledger copy. Both images restored each snapshot in isolated storage, preserving every prior table row exactly, with an empty sharing table. The actual migration retained a validated v8 snapshot matching the stopped state.
- Applied and verified active proxy capability-header redaction and guest/OAuth cache exclusions before upgrading the app. Preserved the existing proxy instance, certificates and other settings. The app upgrade was a normal graceful restart with the additive v8-to-v9 migration.
- At cutover every previous database row matched exactly. Environment values, credentials, OAuth mode, mounts, network controls, private photos and the separate allowance ledger remained unchanged. Final reconciliation found only removal of expired OAuth token records; all remaining prior token rows were exact, no active token was removed and no new token was issued. Content, versions, memberships, accounts/roles, grants, clients and revocations stayed exact. One healthy app owns live storage.

## Evidence

| Check | Result |
| --- | --- |
| Actual accepted and rollback images | Both passed Linux sharing, legacy OAuth, multiuser OAuth, membership, manager-scope and uploaded-photo suites with fictional HTTP/SQLite/official MCP SDK fixtures. No provider requests or live writes. |
| Actual image upgrade/rollback cycle | Fictional v8 image data upgraded to v9; later content edits, link rotation and image reads survived the compatible prior-UI rollback. Revocation and another saved edit survived roll-forward. The separate fixture ledger stayed unchanged. |
| Fresh snapshot restores | Online and stopped snapshots restored through both images with exact previous rows, empty sharing state and retained pre-migration snapshots. Stopped photo archive bytes matched the current private photo manifest. Server-side snapshot/archive digests and recovery instructions were verified. |
| Running source and delivery | All running source/module bytes matched the reviewed commit. All 53 served assets matched expected bytes through both origin and public HTTPS with certificate validation. Docker health passed. |
| Deployed boundaries | Anonymous and fictional-capability private HTTP/MCP/media requests stayed denied. Guest data/media denied invalid links with no-store/no-referrer/noindex and no cookie. Generic guest shells had the expected security/cache headers. OAuth discovery retained both scopes and S256. |
| Live read-only protocol acceptance | Existing owner HTTP and official MCP SDK list/get/export matched for every trip. The six existing tools remained; no sharing tool was added. Schema v9 and zero share rows were confirmed. This is SDK evidence, not a new named external-client or consent-flow test. |

Initial isolated rehearsal failures came from inherited container listen settings, SQLite WAL sidecar staging and fixture argument/status handling. The harness was corrected; all gates passed before production cutover. No application correction or live historical restore was needed.

The [CP003 Chrome evidence](progress_2026_10_19_cpx003_codex_a.md#evidence) still applies to the verified source bytes. Physical Android/iOS and WeChat in-app-browser behavior remain untested. No real itinerary, account, membership, grant, Google setting or allowance was changed for acceptance.

## Backup-copy limit and next action

Automatic approval review declined an additional sensitive backup transfer because its payload and destination lacked explicit approval. No transfer occurred. Fresh backups, validated recovery materials and digest evidence remain on the server; these checks do not establish a new off-host copy. Deployment and server-side backup verification are complete. An additional backup transfer requires its own destination approval.

Follow-up: explicit approval subsequently authorized the database/photo backup copy. Transfer and archive/file digest verification completed; [CP005](progress_2026_10_19_cpx005_codex_a.md) records that completion and the copy's scope.

The owner or current approved creator can now review the sharing preview and explicitly enable a link. The operator left sharing off. No rollout decision remains.

Operational mapping, detailed logs and recovery commands remain private. Codex handled this deployment work because it required private production context; no new public development task or Claude invocation was needed. The actual outgoing report/diff, links and public-safe Git identity were reviewed, and publication privacy checks passed.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
