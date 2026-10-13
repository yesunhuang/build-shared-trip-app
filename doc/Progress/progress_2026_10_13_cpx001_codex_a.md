# Self-hosted multi-trip and remote MCP implementation

- Date: 2026-10-13 (UTC)
- Agent: Codex A
- Status: partial acceptance; implementation and local automated validation complete
- Approximate active time: 55 minutes
- Assignment: initial command.md, executed through all four implementation stages. There was no prior progress-report comment to acknowledge.
- Commits: c8aaf16 (effective registry claim); b511752 (implementation). The report is published in a following commit.

## Delivered scope

- One authenticated Node 24 service, SQLite persistence outside the checkout, stable trip/item IDs, list/create/read/metadata/archive flows and independent trip pages: server/, assets/selfhosted/.
- Shared HTTP/MCP TripService, validation, atomic batches, version conflicts, durable idempotency and trip isolation: server/domain/, server/mcp.mjs.
- Official remote Streamable HTTP MCP with four tools and an actual SDK smoke client: scripts/mcp-smoke.mjs, references/mcp.md.
- Existing map/timeline/reminders/four-language/phone-sheet source retained and connected through authenticated bootstraps, polling, bounded retries and online-only writes: assets/app-template/public/. Source-text editing invalidates stale translations; time edits reconcile ordering.
- One stable PWA identity. Protected data is memory-only and excluded from persistent browser caches; pending sign-out blocks protected reads during outages.
- Legacy JSON import, compatibility preservation with warnings, recoverable export, consistent SQLite backup, validated restore and transactional prior-schema migration: server/domain/legacy.mjs, server/db.mjs, server/cli/.
- Locked dependencies, Dockerfile, updated README/SKILL/contracts, implementation plan and regenerated fictional demo: package.json, package-lock.json, references/, doc/implementation-plan.md, docs/.

## Validation evidence

| Class | Check | Observed outcome |
| --- | --- | --- |
| Local service | npm run test:server | Actual HTTP and SQLite reads/writes; two-trip isolation, empty drafts, stale edits, atomic rollback, same-request retries including after restart, source translation invalidation and time ordering passed |
| Local protocol | Official SDK Client and StreamableHTTPClientTransport | Initialization/discovery and real create/read/edit calls passed; MCP day/plan/reminder batches, invalid-batch rollback, and HTTP/MCP edits in both directions passed; tested revision 2025-11-25 |
| Local service | Auth tests | Unauthenticated requests, hostile origins, cookie write protection, logout revocation and restart-invalidated sessions passed |
| Local persistence | Import/export/backup/restore/upgrade tests | Fictional legacy JSON and unmapped fields retained; duplicate import does not overwrite; exports restore IDs/content/version/archive state; online snapshot restores into separate storage; active-target restore is blocked; schema-v1 fixture upgrades with pre-migration backup and stable IDs |
| Simulated DOM | npm run test:ui | Home list/create/edit/archive/restore/import warnings and four languages passed. Trip bootstrap recovers from first failure; date/plan/reminder edits, independent update observation, translated source/time editing, stale open forms, failed offline writes, reconnect and pending-sign-out isolation passed |
| Regression | npm test | Legacy generator/parser/map/cache/privacy suites, server suite and both DOM suites passed |
| Entry point | npm start with disposable fictional storage | Health and authenticated trip creation passed; clean stop released the data lock |
| Protocol recipe | node scripts/mcp-smoke.mjs against a disposable service | Initialization, discovery, fictional creation, day/reminder mutation and readback passed |
| Generation/static | node scripts/build-docs-demo.mjs; fresh external fictional generation and qa-static.mjs | Demo regenerated; fresh generation and static QA passed without Firebase configuration |
| Publication | audit-privacy.mjs framework mode, outgoing diff/metadata review and diff --check | Passed; no new/changed binary media, real trip records, runtime configuration, credentials, databases or raw model receipts in the publication |

## Delegation and corrections

Three fresh Claude Code helpers worked against reviewed public files in a disposable workspace, with restricted Read/Edit/Write/Glob/Grep tools, no shell/connector access and no resumed session. Executed model: claude-opus-5-5.

They produced partial domain validators/operations, frontend helpers and documentation before authorized capacity became unavailable. Codex accepted those outputs with material completion, implemented the remaining backend/home/editor integration, corrected the JSON serializer and export alias preservation, and executed the checks. Raw receipts and installation-specific information remain outside the repository.

Early DOM runs exposed missing simulated inline/scroll APIs and a test form-control lookup issue; the harness was corrected. The final checks above passed. No further model route, account or paid capacity was acquired.

## Remaining acceptance and operating limits

- Browser control was unavailable: the in-app browser was absent and Safari had no controllable window. No desktop/phone screenshots, visual layout checks, real map gestures, physical-device or PWA installation claims are made.
- Docker CLI/build, public HTTPS/VPS deployment, third-party AI clients, live weather/maps/photos and live Firebase were not verified. No deployment or real-trip migration was performed.
- One administrator role; no anonymous sharing, per-trip membership, OAuth discovery or offline write queue. Browser sessions are in memory and restart requires sign-in.
- All test services started for this assignment were stopped after validation; unrelated processes were preserved. Test data and private invocation records remain outside public Git.

## Smallest useful next action

Use a controllable browser and fictional data to run references/responsive-performance.md at desktop and 390/375 px phone widths, including sheet tap/swipe, map/date selection, native dialogs, resources and logout across tabs. Then verify installation on an actual phone and the Docker recipe in an available container environment. These are validation tasks; no new product decision blocks local use.

For local use now: follow references/self-hosted.md, set the private admin token and external data directory, then run npm ci and npm start. Connect a header-capable MCP client using references/mcp.md. A real VPS/account connection needs its own target and authorization.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
