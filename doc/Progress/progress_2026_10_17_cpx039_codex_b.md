# CP039 — Trip membership and login landing ready for rollout review

Correction: do not roll out this checkpoint's broad content-manager access rule. CP041 supersedes both CP039 and CP040 with membership for every non-administrator, including assistants, and owner-only global access; see the current [membership contract](../../references/trip-membership.md).

- Date: 2026-10-17 UTC
- Agent: Codex B
- Status: complete — authorized implementation, fictional acceptance and migration proposal; production rollout awaits confirmation
- Approximate active time: 55 minutes
- Source commit: `6a946feafae6126a845d091e8ef7a7da3ec38d7f`
- Production remains on the previously accepted source `145531f7b3e00158efec1de3113d5e842763b616`, schema v6

## Implemented behavior

Ordinary approved accounts now read/export only joined trips and their bound private media. They may create a trip and edit/archive/restore their own current creator trip. Joined members remain read-only. The owner retains all-trip administration and can assign/remove members or designate the current creator. Existing content managers retain their existing all-trip content and MCP authority; no credential, grant, scope or identity changes are introduced. Participants are account memberships, independent of itinerary participant groups.

- `server/trip-membership.mjs`, `content-access.mjs`, `app.mjs` and `domain/media.mjs`: shared server enforcement for lists, direct reads, writes, exports, private media, provider reservations and the existing six MCP tools. Ordinary retry records are actor-scoped, and creation retries recheck current access. Removing membership immediately denies subsequent server reads; a focused/polled open page clears private headers, dialogs and content.
- `server/db.mjs`: additive schema v7 stores separate ACL revisions, memberships, digest-only invitations, media bindings and durable join-attempt limits. Existing content versions and IDs are untouched. Legacy creators remain unknown and no account is automatically enrolled. Trusted saved local-photo references seed media bindings; ordinary creators cannot acquire another trip's image by inserting its URL.
- Trip codes are random 256-bit, single-use, expiring and revocable. Defaults are 72 hours, bounded to 1–168 hours. Issuance/retention and account/address redemption limits apply. Raw codes appear once, stay out of URLs/storage/audit/retry records, and clear when hidden or closed. Account revocation, creator transfer or demotion ends outstanding issuer codes. A join retry cannot restore removed membership.
- `assets/app-template/public/trip-members-editor.js`, `trip-members.css`, `hosted-client.js`, `app.js` and `assets/selfhosted/home.js`: four-language Participants dialogs, creator code management, owner assignment and authenticated joining. Conflicts retain drafts and require refresh. Uncertain joins can retry the identical durable request; issuance is never retried automatically.
- Login uses the server's accessible trips and each trip's timezone. Exactly one nonarchived dated trip ending today or later opens directly; zero/multiple eligible trips show the list. Undated drafts do not count and a `next` query cannot override the decision.
- `server/cli/trip-membership-plan.mjs` and [the membership contract](../../references/trip-membership.md): read-only private worksheet generation, explicit rights and security-sensitive rollout/recovery steps. Updated affected contracts and regenerated fictional demo assets.

## Evidence

| Check | Result |
| --- | --- |
| Full `npm test` | Passed: legacy, HTTP/SQLite/official MCP SDK and DOM suites |
| Membership HTTP/SDK tests | Passed: two-user isolation, creator/member/admin paths, direct-ID/media/export/MCP checks, atomic conflicts, audit rollback, code expiry/revocation/limits, durable retries and restart |
| Focused final security checks | Passed: creator-to-member demotion, revoked-account removal, no cross-actor historical replay and no creation-result disclosure after membership removal |
| Upgrade/restore fixtures | v6 → v7 preserved every row in the eleven preexisting tables with no inferred members/creators; isolated snapshot restore preserved all five new tables and enforced access |
| Browser acceptance | 113 checks passed in Chrome at 320, 375, 390 and 1280 px, all four languages; creator/member/administrator controls, authenticated join, assignment/removal, keyboard/focus, 44 px targets, login cases and private-UI clearing |
| Generation/static QA | Fictional demo regenerated; fresh disposable fictional input passed validation, generation and static QA |
| Publication | Actual outgoing text/diff and fictional image pixels reviewed; framework privacy audit with the external denylist and diff checks passed |

Fictional previews: [creator on phone](evidence/cpx039/fictional-creator-phone.png), [member on phone](evidence/cpx039/fictional-member-phone.png), [administrator assignment](evidence/cpx039/fictional-admin-participants.png). Browser evidence is desktop/mobile-touch emulation, not physical Android testing. Provider routes were blocked in browser acceptance; no Google/provider searches or allowance reservations occurred.

Regression fixtures now assign explicit fictional memberships instead of assuming global ordinary-account reads. Final checks corrected creator demotion, retry authorization and stale private-UI clearing while preserving the original editing-control order. The previously established Claude route remained unavailable; Codex completed the work locally without an external-model execution claim.

## Production inspection and confirmation gate

Read-only inspection confirmed the legacy installation has no stored trip memberships or reliable creator metadata. Bounded historical events do not establish ownership. A private worksheet was generated outside the checkout using only account identity/role/status and trip identity/title/version/access metadata. Proposed assignments are empty; no private mapping is published here. No live trip code, membership, role, credential, grant, configuration, trip content or allowance state was changed. No deployment occurred.

The [exact rollout proposal](../../references/trip-membership.md#exact-rollout-proposal--confirmation-required) requires the owner to confirm the rights and an explicit per-trip membership/optional-creator matrix. Unassigned ordinary accounts would lose legacy trip visibility; owner and existing all-trip manager access remain intact. Do not infer assignments from itinerary names or enroll every current account.

After that confirmation: take fresh consistent backups, verify an isolated restore and fresh worksheet state, rehearse an accepted/rollback image retaining v7 validation **and membership/media enforcement**, then perform one app-only rollout and apply only approved assignments with fresh ACL revisions and durable request IDs. Preserve later edits, revocations and allowance usage. Returning to an all-user/all-trip binary or blindly restoring older data is not a compatible rollback.

Pending evidence: production-image upgrade/rollback rehearsal, actual deployed access acceptance, any target-client metadata refresh and physical-device testing. Local SDK discovery does not establish production or external-client acceptance. The smallest next action is owner review of the private assignment worksheet and explicit rollout confirmation, as required by the current assignment.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
