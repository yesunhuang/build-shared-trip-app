# CP042 — Corrected membership rollout and read-only MCP acceptance

- Date: 2026-10-17 UTC
- Agent: Codex B
- Status: complete
- Approximate active time: 12 minutes for rollout; about 112 minutes including implementation and corrections
- Deployed source: `04f6b014f872a46f09ae2af4a06fb40f7c976e15` (CP041)
- Source/report baseline: `1e05da266bdf325e092d7457ffbb295d41fef298`

## Approved cutover

Processed the owner's explicit CP041 deployment and finite-assignment approval. Rechecked instructions, continuation state, main, handoff and report comments. Existing production was healthy on the prior release; no duplicate rollout was present. Privately resolved the requested existing accounts uniquely with approved status and stable IDs, matched the previously verified target, and reconciled the complete existing-trip snapshot, including archived trips. Private values remain outside Git.

The application was stopped normally for the final consistent backup, schema-v7 migration and ordinary assignments through `server/cli/apply-trip-membership.mjs`. Its normal lock, whole-matrix preflight, expected ACL revisions, durable request IDs, shared assignment transactions and payload-free audit were retained. The app started only after the complete approved matrix passed verification. No creator ownership was inferred or assigned, no role changed and no live invitation code was issued. Only the owner administrator has global access; future trips created by others do not automatically include the assistant.

## Backup, rollback and preservation

- Fresh online and maintenance snapshots included content, accounts and authentication/OAuth state. Both restored in isolated, network-disabled accepted and compatible images. Approved finite assignments and accepted → compatible → accepted reads passed on disposable restored storage. Each prior protected table remained intact; only expected access metadata, assignment retry records and audit entries were added.
- A distinct rollback image retains the complete CP041 backend and schema-v7 ACL enforcement with the prior frontend. Its actual fictional HTTP/SQLite/MCP membership, manager-scope and private-CLI suites passed, including later unassigned-trip denial and versioned/retried writes. The previous permissive backend is not an allowed rollback target. Recovery uses the current database and ledger, without restoring older data over later edits or revocations.
- Photo archive contents were verified. Online snapshot, maintenance snapshot and photo archive copies were digest-verified off-host. The separate allowance snapshot is evidence only, never a usage rollback source.
- At cutover, original trip rows/versions, accounts, credentials and OAuth/grants matched exactly. Final checks retained all content, branding, bookings, photos, weather, settings, account roles, grant identity/scope/audience/revocation state and original retry/audit rows. The existing native client performed an ordinary OAuth refresh and last-use updates during acceptance; these were classified separately from deployment mutations. No new account, consent, grant or credential provisioning occurred.
- Existing environment values, mounts, private application port, network membership, proxy and provider gateway were preserved; only the application image tag changed. Google settings and ledger state were exact at cutover. Later live browser detail reservations arrived during acceptance: verified approved membership, retained every prior reservation and baseline, and checked that usage increased only by the added reservations. File identity was preserved and no counter was reset or restored. The acceptance tools made no Google/provider request.

## Acceptance and limits

- Running immutable image, revision label and changed module bytes match CP041. Public HTTPS and origin TLS health returned 200; 25 served assets match the source. Eleven anonymous protected/no-store boundary checks passed. One healthy live application worker remains; quiet Compose validation passed.
- Live read-only shared-domain checks against the approved existing principals verified exact memberships, assigned read/export/edit rights, unrelated read/export/lookup/replay denial, participant metadata and the single eligible-trip landing decision. Actual owner HTTP pages/API reads and official-SDK MCP discovery/reads passed with the existing credential reference. The same six tools remain.
- Existing native MCP connection: actual `list_trips`, `get_trip` and `export_trip` succeeded; participant metadata matches the approved matrix, content-manager editing is retained, assignment/invitation authority is absent and no creator was inferred. The coordinator independently confirmed fresh read-only acceptance through its same connection, with unchanged content versions/archive states and no edit, new login, consent or grant change.
- Live media bindings match saved references. Current routable local files are unbound: actual owner GET/HEAD succeeded, anonymous requests were denied and ordinary-account shared-domain checks denied unbound access. No live trip-bound local image was available to test that positive path; fictional HTTP GET/HEAD membership tests cover it.
- Accepted and rollback Linux suites passed. Reused unchanged-source CP041 evidence: full `npm test`, fresh generation/static QA and 161 Chrome browser checks across four languages and desktop/phone widths. Participant controls and HTTP login/redirect interactions were tested with fictional accounts; real users' password sign-ins and physical Android interactions were not performed. Live landing permission decisions were checked without passwords.

Initial rehearsal setup checks required recognizing the localized target label and explicitly setting loopback binding for an inherited container test environment. Both were resolved before cutover; the accepted application source was unchanged.

The final strict ledger-equality check detected the concurrent browser activity above. A read-only comparison established additive authorized usage; the service and every newer ledger entry were preserved.

Publication review: actual report content was manually sanitized; framework privacy audit with the external private denylist and diff checks passed. No private matrix, identities, itinerary, screenshot, configuration, credential, backup or operational identifier is published. The known Claude route remains unavailable; private deployment and acceptance stayed with Codex.

No implementation decision remains for this rollout. Keep the tested ACL-safe rollback and fresh backups; any later assignment or deployment must reconcile current state rather than replay this completed operation.

## comment

Reserved for sanitized continuation instructions from the owner or authorized coordinator.
