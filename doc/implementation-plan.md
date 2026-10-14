# Self-hosted multi-trip implementation

Status: implementation delivered, including owner-approved viewer accounts and crash-recoverable data-directory ownership. Local automated service checks pass. New browser/jsdom acceptance and the final full regression are still pending. Browser layout, physical installation, external AI clients, Docker build, and VPS deployment require separate evidence. See the progress reports for exact acceptance outcomes.

## Module boundaries

- `server/app.mjs`, `server/index.mjs`: one Node 24 HTTP process. Covers owner bearer and owner-session authentication, viewer sign-in, invitation redemption, in-memory browser sessions, origin/host checks, bounded JSON requests, protected private media, and static routing.
- `server/auth/`:
  - `accounts.mjs`: durable viewer accounts and single-use invitations, stored as digests only.
  - `passwords.mjs`: bounded scrypt hashing.
  - `sessions.mjs`: in-memory sessions and per-address attempt limits.
  - `policy.mjs`: role capabilities and an explicit read-only viewer allowlist.
- `server/domain/`: shared draft validators, operations, dependent translation/time rules, legacy import mapping, and `TripService`. HTTP and remote MCP use the same instance and transactions.
- `server/db.mjs`, `server/cli/`: SQLite WAL persistence, versioned schema, pre-migration snapshots, consistent backup, and validated restore, including account state.
- `server/data-lock.mjs`: exclusive ownership shared by startup and restore. The authority is an OS-held SQLite EXCLUSIVE transaction on a separate persistent `server-ownership.sqlite`. A tagged `server.lock` marker keeps older PID-lock releases out. No authority file is ever deleted. A new owner replaces only an attributable stale marker, and only while holding the lock. Foreign or legacy locks are refused.
- `server/mcp.mjs`: official SDK 1.32.1, stateless Streamable HTTP with JSON responses, tested protocol 2025-11-25, and four domain tools. Discovery marks batch editing as potentially destructive and identical-request retries as idempotent. Only the owner bearer token is accepted.
- `assets/selfhosted/`: authenticated home page with list, create, metadata, archive, import, and export flows. Owner, viewer, and invitation sign-in forms; role-aware controls; owner account administration; stable manifest; and a generic offline worker.
- `assets/app-template/public/`: the existing map/timeline/phone planner with authenticated bootstrap, version-aware edits, and a read-only mode for viewers. The legacy generator and its fictional demo assets remain available unchanged.
- `deploy/`: Docker Compose + Caddy HTTPS template. It has been drafted but not executed.

## Data and mutation contracts

Trip IDs and nested item IDs are stable. A canonical trip includes:

- title, timezone, and country;
- optional date range and route;
- days with slots;
- reminders;
- localized and optional content;
- version and archive state.

Empty drafts are valid. Server-owned metadata is independent of frontend build hashes.

SQLite schemas:

- **v1:** JSON trip rows and scoped durable retry records.
- **v2:** normalizes prior `days.plans` to `days.slots` and adds the archive-list index.
- **v3:** adds `users`, with status pending, approved, or revoked and a session epoch, and `invitations`, with a token digest, expiry, and use. Trip rows, IDs, versions, and retry records are untouched.

Migrations write a `before-v<N>` snapshot first, then run transactionally and preserve IDs and versions. Unsupported newer schemas are refused. Snapshot validation also checks account rows.

Every write uses a requestId; mutations also use expectedVersion. Related changes commit together. Identical retries return the original result. Stale versions and changed reuse of request IDs fail explicitly. Imports retain compatible content and IDs, preserve unmapped safe fields with warnings, and never overwrite an existing trip. Exports and database snapshots can restore into separate storage.

Access contract:

- The owner (admin bearer token or owner browser session) may do everything. MCP requires the bearer token.
- Approved viewers may read and export all trips and protected photos. They cannot write, import, manage accounts, or use MCP.
- Invitations are single-use, expiring codes entered in a form. Redemption creates a pending account that only the owner can approve.
- Revocation increments the session epoch, so active sessions fail immediately and reapproval does not revive them.
- Sessions stay in memory, expire after 12 hours, and end on restart.

Private media is served from the `photos` directory under the data directory. The handler accepts only authenticated GET/HEAD requests for flat image files, sent with `no-store`. `/attachments/*` returns 404 after the access check, because no attachment store exists. Pages send `Referrer-Policy: strict-origin-when-cross-origin`, so third-party map requests see only the origin.

## Implementation stages

1. Shared data, authentication, two-trip isolation, and restart persistence: implemented and exercised over HTTP.
2. Existing travel UI, daily edits, metadata/date management, polling, reconnect, and one PWA identity: implemented. Editor paths were exercised in DOM simulation. Desktop/phone visual and gesture acceptance remains unverified.
3. Remote MCP: initialization, discovery, and real SDK tool calls exercised, with editing observed in both HTTP/MCP directions.
4. Delivery: implemented import/export, backup/restore, fictional prior-schema upgrade, locked dependencies, container recipe, and contracts. Live deployment and Docker build were not performed.
5. Viewer accounts:
   - implemented: invitations, pending/approve/revoke, read-only viewer UI, and schema v3;
   - exercised with actual local service checks: HTTP negative access, revocation, and backup/restore/restart.
6. Crash-recoverable ownership: implemented, and exercised on Windows only.
7. Compose + Caddy deployment template: drafted, not run.

## Recorded local evidence

These checks were reported by the coordinator for this export. The documentation task itself ran nothing.

- Baseline `npm test` ran after a one-line CRLF portability fix.
- These account checks passed against the local service:
  - HTTP negative access;
  - invitation and password hashing;
  - revocation and logout;
  - generic-source inspection;
  - account backup/restore/restart;
  - rate limits;
  - fictional v2→v3 upgrade.
- Ownership tests passed on Windows with Node 24.21.0:
  - hard kill and restart;
  - contention;
  - retry-log and ID preservation;
  - graceful cleanup;
  - foreign-lock refusal;
  - restore exclusion.
- A baseline browser pass at desktop and 390 px found two issues that are being corrected:
  - header contrast;
  - blocked external OSM tiles under the previous `same-origin` referrer policy.

Pending or not performed:

- new jsdom/browser acceptance and the final full regression;
- crash recovery under Linux and in containers;
- Docker build;
- any VPS connection;
- DNS/TLS publication;
- external HTTPS/MCP;
- physical-phone installation;
- real-data migration, which is not authorized.

## Commands

- `npm ci`; set a private `SHARED_TRIP_ADMIN_TOKEN` and an external `SHARED_TRIP_DATA_DIR`; `npm start`.
- `npm test`: legacy regression, actual HTTP/SQLite/MCP tests, ownership-lock process checks, account tests, and DOM simulation.
- `node scripts/build-docs-demo.mjs`; generate a fictional example into fresh disposable output, then `node scripts/qa-static.mjs OUTPUT`.
- `npm run backup -- NEW_SNAPSHOT`; `npm run restore -- SNAPSHOT` (restore refuses while a service owns the directory).
- `node scripts/mcp-smoke.mjs http://127.0.0.1:4173/mcp` against explicitly disposable fictional storage.

## Constraints and delegation

Roles are an owner and read-only approved viewers with access to all trips. Other constraints:

- in-memory sessions;
- polling;
- online-only writes.

The following are not implemented:

- anonymous sharing;
- per-trip membership;
- self-registration that grants access;
- OAuth;
- offline write queue;
- attachment upload.

Protected data is held only in memory in open pages and is excluded from persistent browser caches. Pending sign-out gates protected reads during a connection outage. External maps, weather, and photos remain optional network services whose availability is not guaranteed.

Data-directory ownership has these requirements:

- local filesystem locking and hard links;
- no network filesystems;
- never running mixed older and newer releases against one data directory.

Public-only Claude Code helpers used verified `claude-opus-5-5` with confined file tools and no command or connector tools. They produced partial validators, UI helpers, and documentation before authorized capacity became unavailable. Codex kept those outputs, completed them substantially, corrected their integration, and ran the checks. No private travel data, account details, or raw model receipts were published.

A follow-up text-only `claude-opus-5-5` task supplied the earlier lock/MCP corrections and regression tests. Codex corrected a test initialization order, integrated the patch, and ran the required checks; see the [follow-up report](Progress/progress_2026_10_14_cpx002_codex_a.md). The documentation and deployment-template alignment for accounts and ownership was drafted by a public-only Claude file-tool task that executed no commands; the coordinator records verification.
