# CP040 — Corrected manager membership boundary; private rollout handoff pending

Superseded by CP041: do not deploy this checkpoint. The assistant global-access mechanism below was withdrawn completely; only the owner administrator has global access. Current code and the membership contract require ordinary membership for every assistant and other non-administrator. Historical test evidence below describes CP040 only.

- Date: 2026-10-17 UTC
- Agent: Codex B
- Status: partial — implementation and fictional acceptance complete; approved assignment values await private coordinator handoff; no rollout
- Approximate active time: 22 minutes for this correction, about 80 minutes including CP039
- Source commit: `336b5eb17d614e6cd4b1e4df818f75cfadb7e056`

## Corrected access model

Processed the owner's CP039 correction after reading current instructions/contracts, checking continuation files/comments, fetching main and inspecting the active handoff. CP039's role-wide manager bypass was too broad. Its report now points to this correction; it must not be used for rollout or compatible rollback.

Every non-administrator requires trip membership, including existing and future content managers. Managers keep editing/export/archive/restore capability within member trips; creating or importing enrolls the creating account in its own new trip. Ordinary joined members remain read-only, with editing/invitation rights on their creator trips. The owner remains the all-trip administrator.

- `server/trip-membership.mjs`, `content-access.mjs`, `app.mjs`: enforce the same boundary for filtered lists, direct reads, writes, exports, bound media, HTTP/MCP, lookups, Google reservations and login landing. Guessing a photo URL cannot grant access. Unbound local images remain owner-only; the assistant exception reads bound images only.
- Historical implementation, withdrawn by CP041: an optional private configuration switch selected one approved stable content-manager principal for global content access. CP041 removes this switch and all associated bypasses; this paragraph records prior evidence only and is not a rollout instruction.
- All non-owner create/import/edit retry namespaces are actor-scoped. Replays reauthorize current access. A legacy global retry requires accepted audit metadata matching its original actor, trip and result version; other actors or unavailable attribution get a conflict without execution. Older attribution can expire with bounded audit retention, requiring reconciliation before a new request. Owner retries remain compatible.
- `server/mcp.mjs`, `oauth-http.mjs`, `assets/selfhosted/home.js`: corrected discovery, consent and four-language role descriptions. The same six MCP tools, audience, scopes, connection identities and grants remain unchanged.
- [Membership contract and rollout proposal](../../references/trip-membership.md): updated rights, private exception review, recovery restrictions and application path. Aligned README, SKILL, deployment, access, MCP and privacy contracts.

## Private migration/application preparation

Read-only inspection privately matched the requested existing assistant to its current stable approved content-manager account. Prepared private account/trip inventory and v2 exception/membership worksheets outside Git. No account identity, trip identifier, assignment value or operational path is published here. The exception is proposed, not configured or activated.

The owner-approved legacy assignments remain with the coordinator; this session has not received their private values. Proposed changes therefore remain empty rather than inferred. A precise applied matrix cannot be claimed until that private file handoff arrives. The handoff instructions identify the existing private destination and supported application procedure; values must stay out of relay/public messages.

`server/cli/trip-membership-plan.mjs` now prepares v2 worksheets with explicit approval flags false and a verified single-principal exception proposal. New `server/cli/apply-trip-membership.mjs` is an offline operator path for the later approved matrix. It requires an explicitly approved private file, normal data-store ownership, current schema, a new validated backup, fresh trip/ACL versions and unchanged reviewed account roles/statuses. It preflights the entire matrix, calls the shared assignment transaction and writes payload-free operator audit. Interrupted prefixes and identical retries are durable. It never configures the exception, changes roles/credentials/grants, issues codes, edits trip content or touches the separate Google ledger.

## Validation

| Evidence | Outcome |
| --- | --- |
| Full `npm test` | Passed: legacy, server/HTTP/SQLite/official SDK and DOM suites |
| New manager-scope suite | Actual HTTP/MCP denial for unassigned existing/new managers and future trips; authorized member editing; exports, GET/HEAD media, lookup/reservation denial; create/import/edit retry authorization; attributed legacy retries and missing-proof conflicts; removal and zero/one landing |
| Exception suite | Explicit stable-ID configuration works for the same principal; username configuration fails, renaming preserves identity, a replacement account name gains nothing, revocation denies HTTP/MCP, and a non-manager role cannot use the exception |
| Private CLI fixtures | Approval/lock refusal, verified exception proposal without activation, validated backup, interrupted-prefix recovery, exact replay, stale-version refusal, unchanged trip/account rows and untouched external allowance |
| Browser acceptance | 161 checks passed in Chrome at 320, 375, 390 and 1280 px, four languages; unassigned manager empty list, member-manager editing, creator/member/admin controls, keyboard/focus and touch-sized layout, no private UI after removal |
| Generation/static QA | Fictional demo regenerated; fresh disposable fictional input passed validation, generation and static QA |
| Publication | Actual outgoing diff/text and fictional screenshot pixels reviewed; framework privacy audit with external denylist and diff checks passed |

The [fictional member-manager phone preview](evidence/cpx040/fictional-member-manager-phone.png) shows editing controls with participant administration absent. Browser evidence is desktop/mobile-touch emulation, not physical Android. Browser provider routes were blocked; searches/reservations were zero. No live Google requests occurred.

Former global-access test fixtures were replaced with explicit fictional memberships and denial-before-assignment checks. Initial privacy findings concerned explicit fictional password-hash field syntax in new fixtures; fixture setup now follows the existing pattern and the scanner is unchanged. Final checks passed. The established Claude route remained unavailable; Codex completed the correction locally without claiming external-model execution.

## Current state and next action

Production access and application configuration remain unchanged. No deployment, live membership/code, exception activation, role, credential, scope, grant or itinerary mutation occurred. No provider, billing or network/security change was made. The live inventory was read-only; writing private review files did not apply them.

Next: receive the already-approved assignment values through the private v2 file route, reconcile fresh identities/versions, then obtain the required corrected rollout/exception-activation confirmation. Do not ask for those values again in public or infer missing entries. The rollout must include fresh backup and isolated restore, an image rehearsal, and a rollback retaining the **corrected non-administrator membership enforcement and single-principal configuration**. CP039's broad-manager code and older all-user/all-trip binaries are unsuitable. Keep later data, revocations and allowance usage; never restore historical state over them.

Production-image/rollback rehearsal, deployed access acceptance, target-client metadata visibility and physical-device evidence remain future gates. Local authenticated SDK discovery does not establish production or target-client acceptance. No live permission step is authorized by this checkpoint.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
