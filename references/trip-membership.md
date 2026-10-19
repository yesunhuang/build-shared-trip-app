# Trip membership and login landing (schema v7)

The approved finite membership rollout completed in [CP042](../doc/Progress/progress_2026_10_17_cpx042_codex_b.md), including live enforcement, preservation and compatible rollback checks. The procedure below applies to a new installation or a separately authorized later reassignment; it is not an outstanding task for that completed rollout. Publication alone does not deploy changes.

## Rights

| Principal | Trips and content | Membership administration |
| --- | --- | --- |
| Owner/administrator | All trips, existing administration and owner-only permanent deletion | Assign/remove approved accounts, designate the current creator, issue/revoke trip codes |
| Content manager (existing or future) | Read/media/edit/export/archive/restore **member trips only**. Creating/importing enrolls the account in its new trip. Existing MCP credentials use the same boundary | No account/security administration. Can issue trip codes only when the current creator |
| Ordinary approved account (stored role `viewer`, labelled Member) | Read/export joined trips and their bound private media. May create a trip and then edit/archive/restore that trip as its creator. No import, account/security administration or permanent deletion. Schema-v8 opt-in OAuth permits read-only MCP, never editing authority | Redeem a trip code; creators issue/revoke codes for their own trips |
| Pending/revoked/anonymous | No authenticated trip content or private media; a separately enabled [visitor link](trip-sharing.md) grants only its explicit read-only projection | No joining or management |

The creator is a current, trip-specific responsibility, not a global account role. Removing creator responsibility ends invitation authority; an ordinary account becomes read-only, while a content manager retains editing only while still a member. Removing membership ends access. Outstanding codes from a displaced creator are revoked. Account revocation or role changes revoke issued trip codes and credentials; reapproval never revives them. Memberships persist unless separately removed. The owner can remove an inactive account without reapproving it. No existing or future content-manager role implies all-trip access. Schema-v8 opt-in multiuser OAuth preserves existing grants and the membership boundary, allowing independent read/manage consent without changing roles or assignments.

Only the owner administrator has global access. Assistant accounts follow exactly the same membership checks as every other content manager. An owner-approved migration may assign a finite reviewed set of existing trips to an assistant through ordinary member rows. This never enrolls that account in a later trip created by someone else. Creating one's own trip still enrolls its creator normally. There is no account, role, username, OAuth setting or private configuration that exempts an assistant from membership.

Participants are approved account members shown through **Participants** on the home card and trip header. They are independent of `participantGroups` and traveler names in itinerary content. Owner administration does not automatically claim that person is traveling. New trips enroll their creating account atomically. Legacy ownership stays unknown; neither itinerary names nor bounded audit history establishes membership.

## Shared enforcement and persistence

`ContentGateway` and `TripMembership` enforce lists, direct reads, writes, exports, HTTP/MCP results, lookups and Google reservations. The HTTP route allowlist only admits a request to this shared check. An inaccessible trip is a generic 404 on reads. MCP owner/manager edit credentials retain six tools; schema-v8 read OAuth grants expose only list/read/export for member trips; no tool administers memberships or creates credentials. `get_trip` additionally returns read-only `members` and `access` beside `trip` and `planLocationBindings`.

ACL metadata has a separate positive revision (`access.version`). Assignment, code issuance and revocation require `expectedAccessVersion`; conflicts return 409 `membership_conflict`. Content retains its existing trip version, stable IDs and validators. Assignments and joins use durable request IDs; a join retry never restores removed membership. All non-owner create/import/content-write retry namespaces include the account. Every replay rechecks current access; creation/import retries cannot return a former member's content. A legacy global retry is reused only when accepted audit metadata proves its original actor and current authorization permits it. Another actor or missing attribution returns 409 without replaying or executing it. Bounded audit retention therefore can leave an old retry uncertain; reconcile saved state before choosing a new request ID. Owner retries remain compatible. Accepted changes and retries are audited transactionally without payloads or raw codes.

Private local images are bound to trips in `trip_media`. Every non-administrator, including assistant content managers, can fetch a file only through current membership of a bound trip. Unreferenced files remain owner-only. Inserting a guessed URL cannot grant access: a non-owner can add only an image already readable to that principal, including during create/import. Saved root-relative references (and configured same-origin absolute references) seed bindings during migration. Covers/logos remain embedded trip content. No file is removed or provider queried. Database backups contain access metadata and invitation digests; portable exports contain content only. Imports create a new member/creator trip and never import access grants.

## Trip codes

Account-enrollment invitations remain a separate owner-only flow. A trip join code is for an already authenticated, approved account and never creates, approves or promotes an account.

- Random 256-bit code, 43 base64url characters, SHA-256 digest only in SQLite. The raw value is returned/displayed once, never in URLs, audit, retry records or browser storage. Hide/close/refresh/sign-out clears the display; late responses cannot revive it.
- Single use; default 72 hours, configurable 1–168 hours. Used, revoked, expired, archived-trip and inactive/displaced-issuer cases refuse joining. Codes do not bypass account status or current ownership. Revocation does not remove an already joined member; the owner removes that membership separately.
- At most 20 open codes per trip, 20 issued per issuer per hour, and 200 retained rows per trip (closed/expired history is pruned first). Listing includes all retained active codes before history.
- Join attempts: 20 per connection address per 15 minutes, plus a durable 20 per account per 15 minutes across restarts, including invalid and retried requests. Addresses behind the existing reverse proxy share its limit; untrusted forwarded headers are not accepted as identity. Storage is bounded by the account limit. Invalid codes use one generic refusal; code values never enter errors.
- Issuance uses its expected ACL revision instead of persisting a recoverable raw-code response. A lost response is uncertain: refresh code metadata, revoke the unwanted code, then explicitly create another. Do not automatically retry issuance. Joining can manually retry the identical request ID/payload after an uncertain response; it never creates a second membership.

HTTP operations, all protected/no-store:

| Method/path | Input | Authority |
| --- | --- | --- |
| `GET /api/trips/<id>` | none | Accessible trip; returns `trip`, `members`, `access` |
| `POST /api/trips/<id>/members` | `userId`, `role` (`member`, `creator`, `remove`), `expectedAccessVersion`, `requestId` | Owner only |
| `GET /api/trips/<id>/invitations` | none | Owner or current creator; metadata only |
| `POST /api/trips/<id>/invitations` | `expectedAccessVersion`, optional `expiresInHours` | Owner or current creator |
| `POST /api/trips/<id>/invitations/<code-id>/revoke` | `expectedAccessVersion` | Owner or current creator |
| `POST /api/join-trip` | `code`, `requestId` | Approved account cookie, same origin |

## Login landing

The server returns `landingPath` at successful sign-in. It considers only accessible, nonarchived trips with a valid saved day range whose end date is today or later **in that trip's timezone**. There is no arbitrary future cutoff. Undated drafts and past/archived trips do not count. Exactly one eligible trip opens that trip; zero or multiple show the accessible list. The old `next` query no longer overrides this decision. Responses never point outside the app, and a membership removed before navigation is checked again on the actual trip read.

<a id="exact-rollout-proposal--confirmation-required"></a>

## Procedure for a new membership rollout

1. Produce a private, read-only worksheet with `node server/cli/trip-membership-plan.mjs --database <outside-checkout/shared-trip.sqlite> --out <outside-checkout/new-private-plan.json>`. The CLI cannot apply changes or overwrite a plan. It refuses repository-contained paths, follows existing real paths/junctions when checking that boundary, reads only access-relevant public account columns and trip identity/title/version, and never reads credential or OAuth tables. Its fingerprint covers those access-relevant fields, not a complete backup. Keep the worksheet and actual user/trip mapping outside public Git.
2. Transfer the owner's approved finite per-trip matrix through a private file, including content managers and optional creator choices. The v3 worksheet records reviewed account roles/statuses and explicit `{userId,role}` changes, with `rolloutApproved:false`. A requested existing-assistant assignment must enumerate only the reviewed existing trip IDs, through ordinary member rows; later trips are never selected automatically. Keep other owner-approved assignments separate from inferred traveler names. This changes no roles/grants or live access. Confirm the private matrix and rollout; no private values belong in Git or relay messages. Prior v2 plans are refused.
3. Before rollout, take fresh consistent database/photos backups, validate integrity and an isolated restore, and compare fresh trip versions, public account state and access metadata with the reviewed worksheet. Preserve authentication/OAuth state, configuration and the separate Google ledger/current usage. Reconcile changed identities or content versions instead of applying a stale worksheet.
4. Build accepted and compatible rollback images retaining **schema-v7 validation and membership enforcement for every non-administrator, with owner-only global access**. Rehearse upgrade and later edits. Neither CP039 nor CP040's withdrawn access rules are compatible rollback targets. Never restore older allowance usage or historical data over later edits/revocations.
5. After explicit approval only, perform one app-only rollout through the established route. Migration creates unknown legacy creators, empty memberships and trusted photo bindings without changing content. Apply only the finite private approved assignments through owner HTTP operations or the offline command below. Both use shared transactions, ACL revisions, durable requests and audit. Until assigned, non-administrators see no legacy trips; owner access remains intact. No assistant access configuration, credential, role, grant, provider, network or billing change is needed.
6. Verify the immutable image and served assets; actual owner, ordinary-member, nonmember and existing-manager reads; direct-ID/media/export/MCP denials; removal/revocation; participant UI and timezone landing; exact content/versions/photos/authentication/configuration/ledger preservation. Do not issue a live trip code as acceptance without separate permission. Actual target-client metadata is a separate check if its read descriptions need refreshing; do not recreate connections or request grants.

### Private offline application path

After rollout approval and the schema-v7 upgrade, stop the app normally and run `SHARED_TRIP_DATA_DIR=<private-data-directory> node server/cli/apply-trip-membership.mjs <approved-private-v3-plan.json> <new-private-backup.sqlite>` using the existing operator route. The reviewed file must explicitly set `rolloutApproved:true`; each `trips[].proposedChanges` contains only `{userId,role}` with `member`, `creator` or `remove`. Keep its account snapshot, trip versions and `accessVersion` fresh. At most one creator choice per trip is accepted. Do not paste private contents into chat or Git.

The command refuses a running service, stale trips/roles/statuses/ACL state, malformed assignments, obsolete plan versions, public-checkout paths and an existing backup filename. It validates a fresh backup before mutation, preflights the entire finite matrix, then calls the shared assignment operation. Each operation is atomic; a later failure preserves completed operations and supports identical durable restart/retry with a new backup. It never extracts credentials, changes roles/grants, issues codes or touches the Google ledger. Restore compatibility must be checked separately before rollout.

Completed rollout: CP042 applied and verified the approved finite matrix. Preserve current memberships, roles, credentials and grants. Any later assignment uses fresh reviewed state and applicable authorization; do not replay the completed worksheet. An already approved private matrix should be delivered as a private file rather than requested again in a public/relay conversation.
