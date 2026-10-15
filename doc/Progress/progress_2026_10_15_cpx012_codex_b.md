# Progress report - Codex B, checkpoint 012

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: partial; owner-only trip deletion and local validation complete, live rollout and requested cleanup pending.
- Approximate active time: 28 minutes.
- Base: `4b9aece`.

## Changes

Continued checkpoint 011; its comment section contained no new directive. The new assignment authorizes permanent whole-trip deletion for the owner, with no such permission for other accounts. Retained the existing worker lineage, synchronized main, and preserved unrelated local edits.

Added owner-only `DELETE /api/trips/:id`, using the existing cookie/bearer authentication, same-origin protection, `ContentGateway` and `TripService`. The request requires `requestId` and the displayed `expectedVersion`. Owner trip cards now show Delete for active and archived trips in all four languages. The confirmation names the selected trip, explains permanent removal, supports cancellation, and rechecks the owner session before sending. Content-manager, viewer and signed-out interfaces have no delete control. Uncertain outcomes require an explicit status check or identical retry; conflicts never silently advance the version and delete newer edits.

Schema v6 adds content-free `trip_tombstones`. Deletion, cached-write-result redaction and payload-free audit commit atomically. Old create/import/change retries cannot return deleted content or resurrect a trip; identical delete retries remain safe. Deleted stable IDs are unavailable to imports, which receive a fresh ID. Other trips, account state, grants, shared photos and existing private backups are preserved. This is application deletion, not a claim that older backups, exports or all storage remnants are erased.

Added `server/cli/delete-trip.mjs` for an authorized host operator: it refuses while the service owns the data directory, requires a new validated backup, and invokes the same deletion logic without reading owner credentials. Its audit actor/channel is explicitly `operator`. No deletion MCP tool or operation was added; the existing six content tools and content-manager scope are unchanged.

Updated `server/`, `assets/selfhosted/home.js` and `home.css`, added backend/UI deletion tests, registered them in `package.json`, and aligned README, SKILL and affected reference/deployment contracts with owner-only deletion.

## Validation

Delegated separate backend and UI tasks to verified `claude-opus-5-5` in restricted public exports with non-overlapping write ownership. Kept live data and deployment operations with Codex. Accepted the backend unchanged and the UI with one small integration adjustment: treat the backend's 410 tombstone response as an already-removed trip, with a DOM regression case.

- The 19 new backend checks passed: owner cookie/bearer, direct role-denial attempts, OAuth/MCP wrong-route refusal, unchanged six-tool set, origin checks, validation, stale versions, duplicate/conflicting requests, cached-result redaction, atomic audit-failure rollback, unrelated-data preservation, restart persistence, schema-v5 upgrade and rollback snapshots, and offline CLI lock/backup behavior.
- `npm test` passed in about 79 seconds, including existing server/OAuth/UI checks and the new deletion tests.
- Regenerated the fictional demo, generated fresh disposable output outside the checkout, and passed static QA.
- DOM tests passed for owner-only active/archived controls, cancellation, focus handling, four languages, uncertain retries, concurrent removal, session changes and no trip data in browser storage. Phone rules were checked statically. No browser was available through the configured controller, so desktop/phone browser rendering and physical-device checks remain unverified.
- Framework privacy auditing with the external private denylist and diff whitespace checks passed. Reviewed actual outgoing code, documentation, tests and public commit metadata before publication.

## Next action

Private preflight already verified the selected cleanup target and validated a consistent snapshot plus an exact prior-image restore, including the photo store. No live deletion has occurred. Build the reviewed release, run the permission/deletion/OAuth checks in the Linux image, verify an isolated upgrade preserves every existing table, then take a fresh cutover backup and perform only the authorized cleanup through the shared owner deletion logic. Record actual rollout evidence in the next checkpoint. No new owner decision is required.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
