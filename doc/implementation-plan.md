# Self-hosted multi-trip implementation

Status: implementation delivered; local automated checks pass. Browser layout, physical installation, external AI clients, Docker build and VPS deployment require separate evidence. See the progress report for exact acceptance outcomes.

## Module boundaries

- `server/app.mjs`, `server/index.mjs`: one Node 24 HTTP process, administrator bearer authentication, in-memory browser sessions, origin/host checks, bounded JSON requests and static routing.
- `server/domain/`: shared draft validators, operations, dependent translation/time rules, legacy import mapping and `TripService`. HTTP and remote MCP use the same instance and transactions.
- `server/db.mjs`, `server/cli/`: SQLite WAL persistence, versioned schema, pre-migration snapshots, consistent backup and validated restore.
- `server/data-lock.mjs`: exclusive ownership shared by startup and restore; existing locks require manual recovery after all owners stop, and cleanup checks file identity.
- `server/mcp.mjs`: official SDK 1.32.1, stateless Streamable HTTP with JSON responses; tested protocol 2025-11-25 and four domain tools. Discovery marks batch editing as potentially destructive and identical-request retries as idempotent.
- `assets/selfhosted/`: authenticated home/list/create/metadata/archive/import/export flow, stable manifest and generic offline worker.
- `assets/app-template/public/`: existing map/timeline/phone planner with authenticated bootstrap and version-aware edits. The legacy generator remains available.

## Data and mutation contracts

Trip IDs and nested item IDs are stable. Canonical trips include title, timezone, country, optional date range/route, days with slots, reminders, localized/optional content, version and archive state. Empty drafts are valid. Server-owned metadata is independent of frontend build hashes.

SQLite schema v1 stores JSON trip rows and scoped durable retry records. Schema v2 normalizes prior `days.plans` to `days.slots` and adds the archive-list index. Migrations back up first, validate, run transactionally, and preserve IDs and versions. Unsupported newer schemas are refused.

Every write uses a requestId; mutations also use expectedVersion. Related changes commit together. Identical retries return the original result; stale versions and changed reuse of request IDs fail explicitly. Imports retain compatible content/IDs, preserve unmapped safe fields with warnings, and never overwrite an existing trip. Exports and database snapshots can restore into separate storage.

## Implementation stages

1. Shared data, authentication, two-trip isolation and restart persistence: implemented and exercised over HTTP.
2. Existing travel UI, daily edits, metadata/date management, polling, reconnect and one PWA identity: implemented; editor paths exercised in DOM simulation. Desktop/phone visual and gesture acceptance remains unverified because browser control was unavailable.
3. Remote MCP: initialization, discovery and real SDK tool calls exercised, with editing observed in both HTTP/MCP directions.
4. Delivery: import/export, backup/restore, fictional prior-schema upgrade, locked dependencies, container recipe and contracts implemented. Live deployment and Docker build were not performed.

## Commands

- `npm ci`; set private `SHARED_TRIP_ADMIN_TOKEN` and external `SHARED_TRIP_DATA_DIR`; `npm start`.
- `npm test`: legacy regression, actual HTTP/SQLite/MCP tests, process-contention locking checks and DOM simulation.
- `node scripts/build-docs-demo.mjs`; generate a fictional example into fresh disposable output, then `node scripts/qa-static.mjs OUTPUT`.
- `npm run backup -- NEW_SNAPSHOT`; `npm run restore -- SNAPSHOT` with the target service stopped.
- `node scripts/mcp-smoke.mjs http://127.0.0.1:4173/mcp` against explicitly disposable fictional storage.

## Constraints and delegation

There is one administrator role, authenticated links, in-memory sessions, polling and online-only writes. Protected data is memory-only in open pages and is excluded from persistent browser caches. Pending sign-out gates protected reads during a connection outage. External maps/weather/photos remain optional network services.

Public-only Claude Code helpers used verified `claude-opus-5-5` with confined file tools and no command/connector tools. They produced partial validators, UI helpers and documentation before authorized capacity became unavailable. Codex retained those outputs with material completion, corrected their integration, and ran the checks. No private travel data, account details or raw model receipts were published.

A follow-up text-only `claude-opus-5-5` task supplied the lock/MCP corrections and regression tests. Codex corrected a test initialization order, integrated the patch, and ran the required checks; see the [follow-up report](Progress/progress_2026_10_14_cpx002_codex_a.md).
