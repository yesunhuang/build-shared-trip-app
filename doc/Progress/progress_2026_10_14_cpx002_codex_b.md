# Approved viewers and first-deployment preparation

- Date: 2026-10-14
- Agent: Codex B, resumed existing identity
- Status: partial; implementation and local acceptance complete for this checkpoint, live deployment blocked on missing private destination details
- Approximate active time: 115 minutes
- Base: `8eef833`; implementation: `5de23b6`

## Assignment pickup and current status

Acknowledged the deployment and owner-approved-access directive in `77af520`, the status follow-up in `8eef833`, and the report/comment sanitization requirement in `61a94d1`. Continued the same assignment; no duplicate implementation worker was started. Codex A's earlier fixes were retained, with the ownership mechanism extended for crash recovery.

No local resume prompt or active Codex B handoff was found. Canonical main was fast-forwarded safely, preserving the coordinator's comments and unrelated processes. The existing registry identity was retained and its task label updated.

No VPS connection or live deployment has occurred. Several SSH aliases are configured locally, but the exact authorized alias and application hostname were not supplied in this thread or an identified private deployment configuration. Those two details were requested through the private user session while independent development continued. No live credentials, certificates, server configuration, or real travel data were created or changed.

## Delivered changes

- `server/auth/`, `server/app.mjs`: owner-managed single-use expiring invitations, pending accounts, explicit approval, salted asynchronous scrypt passwords, independently revocable sessions, and server-enforced read-only viewers. Approved viewers read/export all trips; owner-only writes, administration and bearer-authenticated MCP remain separate.
- `server/db.mjs`: schema v3 adds account and invitation tables without resetting trips, IDs, versions or retry records. Prior-schema snapshots, account-preserving backup/restore and restart-invalidated sessions are covered.
- `server/data-lock.mjs`, `scripts/test-data-lock.mjs`: a persistent ownership database holds an OS-released SQLite exclusive transaction. Hard-killed owners can be replaced without deleting the authority file; server and restore remain mutually exclusive. Foreign legacy markers still require verified manual recovery during upgrade. Local filesystem locking and hard links are required; mixed versions are unsupported.
- `assets/selfhosted/`, `assets/app-template/public/`: viewer sign-in/redemption, owner approval/revocation controls, four-language read-only UI, disabled viewer reminder edits and readable hosted header controls. Protected photos default to the external data directory and authenticated no-store delivery; there is no attachment upload system.
- `server/app.mjs`: origin-only cross-origin referrers restore normal map requests without exposing trip paths. The browser subsequently loaded live OpenStreetMap tiles; fictional place links were not treated as verified venues.
- `deploy/`, `.dockerignore`, `.gitignore`: reusable Compose/Caddy templates, private configuration placeholders, an internal backend network, HTTPS/backup/rollback instructions, protected-response CDN headers, and restricted image build inputs. The example env file is explicitly permitted; real env files remain ignored.
- `scripts/test-accounts*.mjs`, `scripts/test-privacy-audit.mjs`, `package.json`, `README.md`, `SKILL.md`, `references/`, `doc/implementation-plan.md`, `docs/`: account/privacy gates, a Windows line-ending test correction, aligned contracts and regenerated fictional demo.

## Evidence

| Class | Check | Observed outcome |
| --- | --- | --- |
| Actual local services/protocol | Final `npm test`, Windows Node 24.21.0 | Legacy, HTTP/SQLite/MCP, ownership, account and DOM suites passed. Authentication, two-trip isolation, conflicts, atomicity, retries, import/export and persistence remained passing. |
| Actual local processes | Hard-kill, contention and restore tests | Immediate restart preserved trip IDs, versions and retry results; one owner survived contention; live-owner restore was refused. Legacy markers were retained. Linux/container supervisor recovery is not yet verified. |
| Actual local access boundary | Account suite | Anonymous, pending and revoked access was rejected; approved viewers could read trips, export JSON and retrieve private photos but could not mutate, import, administer or use MCP. Revocation invalidated issued sessions; reapproval required a fresh sign-in. |
| Actual local persistence | Fictional schema v1/v2 upgrade and account backup/restore | Pre-upgrade snapshots retained; schema v3 migration was idempotent; account/invitation state and trip identities survived. |
| Simulated DOM | Owner and viewer UI suites | Invitation/redemption/approval/revocation, four languages, read-only controls, forced-write rejection, storage handling and open-page clearing passed. |
| Actual browser, emulated widths | Chrome at desktop, 390 px and 375 px | Owner sign-in, invitation creation, pending-user refusal, owner approval, viewer reading, date switching and revocation-to-sign-in observed. Header contrast, disabled reminder controls, all four languages without page overflow, tap-without-sheet-movement and keyboard sheet resizing checked. Live map tiles rendered. These are browser previews, not physical-phone tests. |
| Generation/static | Demo rebuild; fresh external fictional generation; static QA | Passed, with the expected missing-Firebase warning for legacy local preview. |
| Static deployment recipe | Compose `config --quiet` using public placeholders | Passed. Docker CLI was present, but its local daemon was unavailable; no image, container or Caddy runtime was started. |
| Publication | Framework privacy audit, actual outgoing content/metadata review and diff checks | Passed. No new binary media, database, live configuration, private destination, credential or raw model receipt added. |

Chrome performed sequential owner/viewer sign-ins. A second browser tab could not be created under that provider's sidebar restriction, so independent browser-profile acceptance remains pending; independent HTTP sessions were exercised by the integration tests. Screenshots and fictional test storage are outside Git. All test-owned services were stopped after verification; unrelated processes were preserved.

## Delegation and corrections

Claude Code helpers implemented accounts/UI/tests, ownership, deployment templates and documentation in reviewed public exports. Executed model metadata identified `claude-opus-5-5`. Restricted file tools, disabled shell/MCP/customizations and fresh sessions kept operational work with Codex; raw receipts remain private.

Initial client writes were refused. Public drafts were retained, and later calls used explicitly permitted file tools within the same restricted public boundary. Accepted outputs with focused corrections. Codex corrected small test initialization/response-shape issues, line-ending handling, marker-error redaction and build-input filtering; a SQLite journal assertion was returned to Claude and corrected without manual journal deletion. Claude authored tests but did not run them; Codex executed the checks above.

## Exact blocker and next action

Provide the exact authorized SSH host alias and full application hostname, or identify the private configuration file containing both. Keep those values out of public Git. Deployment permission is already present; no repeated deployment approval is needed.

Then verify existing SSH/known-host authentication, inspect the target's OS/services/storage/listeners, build and deploy `5de23b6` or its reviewed successor, obtain renewed origin TLS, and exercise external HTTPS plus owner/viewer/HTTP/MCP negative-access and restart checks with fictional data. Container/Caddy runtime, origin certificates, Cloudflare cache behavior, direct backend isolation on the target, external AI clients, full pointer/touch regression and physical-phone installation remain unverified. No real-data import should precede the live privacy gate.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
