# CP041 — Owner-only global access; assistants require trip membership

- Date: 2026-10-17 UTC
- Agent: Codex B
- Status: complete for the authorized correction and private proposal; deployment and live assignments remain pending
- Approximate active time: 12 minutes for this correction, about 95 minutes including CP039/CP040
- Source commit: `04f6b014f872a46f09ae2af4a06fb40f7c976e15`

## Implemented correction

Processed the authoritative follow-up withdrawing CP040's assistant exception. Checked current instructions, continuation state, report comments, main and the active handoff; no unintegrated handoff was present. CP039/CP040 reports now explicitly warn against their withdrawn access rules.

- `server/trip-membership.mjs`, `app.mjs`: removed the assistant configuration, constructor state and all-trip/media bypasses. Only the owner administrator has global access. Every existing or future content manager, including assistants, needs ordinary membership and retains editing within member trips.
- `server/mcp.mjs`, `oauth-http.mjs`, authorization comments and active contracts: aligned discovery and consent with membership-only access. The same six MCP tools, connection identity, audience, scopes and grants remain unchanged. Creator enrollment and ordinary invitation/assignment semantics remain intact.
- `deploy/compose.yaml`, `.env.example`, deployment documentation: removed the obsolete configuration switch entirely.
- `server/cli/trip-membership-plan.mjs`, `apply-trip-membership.mjs`: v3 plans contain explicit finite ordinary assignments only. Removed special principal arguments/metadata; obsolete v2 plans are refused. Existing offline locking, fresh backup, whole-matrix preflight, ACL revisions, shared assignment transactions, durable interrupted retries and payload-free audit remain in use.
- `references/trip-membership.md`, README, SKILL and access/MCP/privacy contracts: updated the exact security-sensitive rollout proposal and compatible rollback requirements. Neither withdrawn checkpoint is a suitable rollback access model.

## Evidence

- Full `npm test`: passed, exit 0, about 205 seconds. Includes actual fictional HTTP/SQLite/official MCP SDK tests for membership, migration, isolation, permissions, conflicts, retries and preservation.
- `scripts/test-trip-manager-scope.mjs`: replaced exception tests with finite existing-trip assignments through ordinary member rows, assigned editing and normal creator membership. A later unassigned trip is denied through HTTP/MCP lists, reads, writes, exports, GET/HEAD media, lookups, reservations and retry replay; it cannot influence login landing. Revocation and attributed legacy retry checks also pass.
- `scripts/test-trip-membership-cli.mjs`: passed, including explicit v2 refusal, approval/lock checks, validated backup, interrupted-prefix recovery, durable replay, stale-version refusal, unchanged trip/account rows and untouched separate allowance fixture. The final focused run passed after the v2 assertion was added.
- Actual Chrome browser automation: 161 checks passed, four languages, widths 320/375/390/1280, mobile/touch emulation. Verified empty unassigned-manager list, assigned-manager editing, creator/member/owner controls, join/assignment, immediate read denial after removal, native keyboard/focus and zero provider searches/reservations. No physical Android claim.
- Fictional demo regeneration, fresh disposable generation, validation and static QA passed. Framework privacy audit with the external private denylist and diff whitespace checks passed; outgoing source/docs were manually reviewed. No new image was published.

## Private proposal and rollout gate

Read-only inspection privately reverified the existing assistant's stable approved content-manager account and confirmed the reviewed existing-trip set was unchanged. A new private v3 proposal explicitly lists ordinary member rows for that finite existing set. It has no identity bypass or future-trip enrollment rule and remains unapplied with rollout approval false. Historical preparation is preserved and marked superseded. No credential values were inspected.

Other account assignments already supplied privately to the coordinator still require the existing private-file handoff into this worksheet; their values were not available here and were not invented. No live access, role, credential, grant, trip, configuration or allowance state was changed. No deployment or live provider request occurred.

Next action: privately complete/reconcile the finite matrix, then obtain the separately required rollout confirmation. Before any approved rollout, verify fresh consistent backup/isolated restore and an image rollback retaining schema-v7 validation with owner-only global access. Preserve later edits, revocations and allowance usage. Live enforcement, production-image rollback rehearsal, target-client metadata and physical-device acceptance are not established by these local checks.

The previously recorded approved Claude route remains unavailable. Codex completed this bounded correction; no Claude execution is claimed.

## comment

Reserved for sanitized continuation instructions from the owner or authorized coordinator.
