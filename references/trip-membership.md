# Trip membership and login landing (schema v7)

This is implemented source, with local fictional acceptance. Existing installations require a separately confirmed migration/rollout before this changes live permissions. Publication does not deploy it.

## Rights

| Principal | Trips and content | Membership administration |
| --- | --- | --- |
| Owner/administrator | All trips, existing administration and owner-only permanent deletion | Assign/remove approved accounts, designate the current creator, issue/revoke trip codes |
| Existing content manager | All current/future trips and existing content editing/import/export rights | No account/security administration. Can issue trip codes only when the current creator |
| Ordinary approved account (stored role `viewer`, labelled Member) | Read/export joined trips and their bound private media. May create a trip and then edit/archive/restore that trip as its creator. No import, account/security administration, permanent deletion or new MCP authority | Redeem a trip code; creators issue/revoke codes for their own trips |
| Pending/revoked/anonymous | No trip content or private media | No joining or management |

The creator is a current, trip-specific responsibility, not a new global account role. Owner designation of another creator keeps the previous creator as a read-only member; assigning the current creator to Member retains read access and ends creator responsibility, while removing that account ends both. Outstanding codes from a displaced creator are revoked. Account revocation or role changes also revoke that account's issued trip codes; later approval never revives them or older credentials. Memberships are retained across account role/status changes, so remove a membership separately when it should end permanently. The owner can remove an inactive account through the same membership operation without reapproving it. Existing content-manager credentials retain their existing all-trip authority without new tokens, grants, scopes or OAuth identities.

Participants are approved account members shown through **Participants** on the home card and trip header. They are independent of `participantGroups` and traveler names in itinerary content. Owner/global-manager authority does not automatically claim that person is traveling. New trips enroll their creating account atomically. Legacy ownership stays unknown; neither itinerary names nor bounded audit history establishes membership.

## Shared enforcement and persistence

`ContentGateway` and `TripMembership` enforce lists, direct reads, writes, exports, HTTP/MCP results, lookups and Google reservations. The HTTP route allowlist only admits a request to this shared check. An inaccessible trip is a generic 404 on reads. Existing MCP authentication still permits only owner/content-manager bearer credentials and the same six content tools; no tool administers memberships or creates credentials. `get_trip` additionally returns read-only `members` and `access` beside `trip` and `planLocationBindings`.

ACL metadata has a separate positive revision (`access.version`). Assignment, code issuance and revocation require `expectedAccessVersion`; conflicts return 409 `membership_conflict`. Content retains its existing trip version, stable IDs and validators. Assignments and joins use durable request IDs; a join retry never restores removed membership. Ordinary create and content-write retry namespaces include the account, preventing another actor's historical result from being replayed. Owner/manager legacy retries stay compatible. All accepted changes and retries are audited transactionally without payloads or raw codes.

Private local images are bound to trips in `trip_media`. Ordinary accounts can fetch a file only through a current membership of a trip bound to it. A creator cannot grant themselves another file by inserting its URL into their own trip; new local bindings require existing privileged authority. Existing saved root-relative photo references (and same-origin absolute references when an origin is configured) seed the bindings during migration. Unreferenced files remain owner/manager-only. Covers/logos remain embedded, bounded trip content. No file is removed or provider queried. Database backups contain memberships/bindings/invitation digests; portable trip exports contain content only. Imports create a new trip/creator and never carry access grants from an untrusted document.

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

## Exact rollout proposal — confirmation required

1. Produce a private, read-only worksheet with `node server/cli/trip-membership-plan.mjs --database <outside-checkout/shared-trip.sqlite> --out <outside-checkout/new-private-plan.json>`. The CLI cannot apply changes or overwrite a plan. It refuses repository-contained paths, follows existing real paths/junctions when checking that boundary, reads only access-relevant public account columns and trip identity/title/version, and never reads credential or OAuth tables. Its fingerprint covers those access-relevant fields, not a complete backup. Keep the worksheet and actual user/trip mapping outside public Git.
2. The owner reviews an explicit per-trip account matrix and optional creator choices. Default proposed changes are empty. No blanket enrollment, inferred travelers, automatic creator attribution, status/role change or new assistant grant is proposed. Confirm the rights and landing rules above. Existing owner and global content-manager authority remains intact.
3. Before rollout, take fresh consistent database/photos backups, validate integrity and an isolated restore, and compare fresh trip versions, public account state and access metadata with the reviewed worksheet. Preserve authentication/OAuth state, configuration and the separate Google ledger/current usage. Reconcile changed identities or content versions instead of applying a stale worksheet.
4. Build the accepted image and a compatible rollback image retaining **schema-v7 validation and membership/media enforcement**. Rehearse both against an isolated upgrade and later edits. An old all-user/all-trip binary or restoring an old v6 database is not an acceptable rollback: it can revive broad access and later revoked grants. Never restore older allowance usage or overwrite later trip edits.
5. Perform one app-only rollout through the established route. The additive schema migration creates unknown legacy creators, empty memberships and bindings from existing saved photo references, without rewriting trip content. Apply only the approved assignments through the shared owner operation, each with its fresh ACL revision and durable request ID. Until assigned, ordinary accounts see no legacy trips; the owner is never locked out. Stop and reconcile a conflict, preserving assignments already applied. No network/security, credential, account-role, billing or provider activation change is part of this rollout.
6. Verify the immutable image and served assets; actual owner, ordinary-member, nonmember and existing-manager reads; direct-ID/media/export/MCP denials; removal/revocation; participant UI and timezone landing; exact content/versions/photos/authentication/configuration/ledger preservation. Do not issue a live trip code as acceptance without separate permission. Actual target-client metadata is a separate check if its read descriptions need refreshing; do not recreate connections or request grants.

Current gate: implementation/local tests are permitted; deployment and the exact existing-account assignment matrix require owner confirmation. No production access or code is changed by these instructions.
