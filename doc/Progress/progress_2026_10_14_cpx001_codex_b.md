# Initial repository review

- Date: 2026-10-14
- Agent: Codex B
- Status: complete for the requested repository review and first report; application acceptance remains partial.
- Approximate active time: 10 minutes.
- Reviewed baseline: `618fa3c`; implementation commit: `b511752`; effective Codex B registry claim: `c25ec5f`.

## Scope and changes

Read `AGENTS.md`, `SKILL.md`, `CLAUDE.md`, the repository-local Claude delegation skill, `initial command.md`, `doc/implementation-plan.md`, the setup/input/feature/responsive/privacy/self-hosting/MCP contracts, and [Codex A's first report](progress_2026_10_13_cpx001_codex_a.md). Its final `## comment` contains only the reserved placeholder; there is no continuation directive there to execute. The current assignment is repository review and reporting.

Inspected the HTTP/static entry points, shared domain service, SQLite schema and snapshots, restore workflow, MCP tool registration, authenticated frontend bootstrap/client, PWA assets, and relevant test assertions. Fetched canonical `main`: the checkout initially matched `618fa3c` and was clean. No remote active handoff existed for Codex B. Existing processes and Codex A's implementation ownership were preserved.

Changed only the Codex B registry row in `AGENTS.md` and added this report. The registry claim was committed separately and published by clean fast-forward. No application or generated demo files changed.

## Current implementation

- `server/app.mjs`, `server/static.mjs`: one Node 24 service serves the home page, stable `/trips/<id>` shells, JSON API, and MCP. Protected data requires administrator authentication; browser sessions are held in memory.
- `server/domain/service.mjs`, `server/mcp.mjs`: HTTP and four remote MCP tools share `TripService`. Edits use expected versions, SQLite transactions, and persisted request fingerprints/results for identical retries. Trip reads and mutations target explicit IDs.
- `server/db.mjs`, `server/cli/`: SQLite schema v2, pre-migration snapshots, validated backup/restore, and external persistence. Legacy JSON import/export is implemented separately from frontend builds.
- `assets/selfhosted/`, `assets/app-template/public/`: one stable PWA identity, shared multilingual trip UI, bounded reconnect/polling, and source-translation/time-ordering rules. Protected payloads remain in page memory; writes require connectivity. The legacy generator and fictional `docs/` demo remain transition tools.

These are source-inspection findings. They do not establish fresh runtime or browser acceptance.

## Evidence from this session

| Class | Check | Outcome |
| --- | --- | --- |
| Git coordination | Fetch, status, worktree/ref inspection, isolated claim diff and commit metadata | Clean starting tree; Codex B claim published as `c25ec5f`; public-safe local author/committer identity |
| Static fixture | `node scripts/validate-trip.mjs assets/trip.example.json --allow-example` | Passed with the expected missing-Firebase warning for legacy local preview |
| Static syntax | `node --check` on eight selected service/frontend modules | Passed; syntax only |
| Documentation/publication | Referenced paths, outgoing diff, `git diff --check`, manual privacy review, `node scripts/audit-privacy.mjs . --mode framework` | Passed |

Node 24 was available through an existing local runtime, although `node` and `npm` were absent from the shell PATH and checkout dependencies were not installed. The standalone checks above used that runtime. `npm test`, demo regeneration, HTTP/MCP calls, browser interactions, and deployment checks were not run for this documentation-only task.

[Codex A's report](progress_2026_10_13_cpx001_codex_a.md), published in `618fa3c`, records passing regression, actual local HTTP/SQLite/MCP, import/export/backup/restore/upgrade, simulated DOM, and fresh generation/static checks. Those are prior recorded results, not checks rerun by Codex B.

## Delegation and follow-up findings

One fresh Claude Code invocation reviewed sanitized public source text. Safe mode, restricted mode, disabled tools/skills/MCP, an explicit system prompt, and disabled session persistence provided a text-only route. Executed model metadata identified `claude-opus-5-5`. Raw invocation records remain outside the checkout. Accepted the architectural summary in condensed form.

Two inspection concerns warrant targeted reproduction before changes:

- `server/mcp.mjs` sets `destructiveHint: false` for all tools, including the tool accepting deletion and full-content replacement operations. Review the annotations against those operations.
- `server/app.mjs` recovers a stale `server.lock` through separate read/check/unlink/create steps. Concurrent starters could remove a newly replaced lock after both observed the old one; add a controlled interleaving check.

Neither concern was reproduced in this session. The helper's separate criticism of retry idempotency was excluded: an identical tool request includes the same `requestId`, which the service replays.

## Remaining acceptance and next action

Desktop/390 px/375 px browser layout and gestures, physical-phone installation, Docker build, third-party AI clients, live maps/weather/photos, HTTPS deployment, and real-data migration remain outside the recorded acceptance evidence. No new product decision blocks this report or local fictional validation. The implemented access model is one administrator with access to every trip; anonymous sharing, per-trip membership, OAuth discovery, and an offline write queue are not implemented.

The smallest useful next action is to prepare Node 24/npm and `npm ci`, then run fictional desktop and phone-width browser acceptance from [the responsive guide](../../references/responsive-performance.md), carrying forward Codex A's pending checks. Reproduce the two source concerns with focused tests before assigning fixes. Real-device installation, Docker, and external-client checks should each receive separate evidence.

## comment

Reserved for continuation instructions from the user or authorized coordinator.

### 2026-10-14 — Manager directive to Codex B: first live deployment

The user has explicitly authorized Codex B to deploy a first usable instance on the already purchased VPS and test it. Codex B runs on the user's Windows computer, where the user has already configured and successfully tested SSH key authentication and a host alias. A new application domain has been purchased; the application hostname's A record is proxied through Cloudflare, and that zone now uses Full (strict). Use the exact SSH target and application hostname supplied through the user's private session/local configuration. Do not publish those values, credentials, private paths, or runtime configuration here.

1. Resume your existing identity, fetch current main and inspect any own active handoff before work. Read Codex A's follow-up report `progress_2026_10_14_cpx002_codex_a.md`: the review findings were fixed in `78d65f2`, with evidence in `77cb01c`. Avoid repeating completed fixes.
2. Verify SSH from your Windows environment using the existing user-approved identity and known-host entry. Inspect the target OS, running services, storage and ports before changes. Install the necessary runtime/container and reverse-proxy components from official sources, configure persistent storage outside the source checkout, and deploy the authenticated web application plus remote MCP endpoint. This directive authorizes the necessary scoped server configuration and HTTPS publication for this trial. Preserve SSH access and unrelated services; do not purchase resources or change other domains.
3. Use an automatically renewed valid origin certificate and a reverse proxy compatible with Cloudflare Full (strict), preserving required Host/origin and MCP behavior. Expose only the intended web entry points; keep the application backend internal. Do not cache authenticated API/MCP responses. Keep admin secrets and TLS private keys outside public source, logs and reports; provide the user a private local retrieval method for access.
4. Address the concrete restart limitation recorded by A: an unclean stop currently leaves a lock that blocks automatic container restart. Implement a small, concurrency-safe recovery/ownership solution suitable for the deployed environment, preserving mutual exclusion between server and restore operations. Do not simply delete every lock at startup or reintroduce the read/check/unlink race. Verify abnormal process termination and automatic recovery with disposable fictional storage, plus contention and data preservation. Do not let this become a speculative infrastructure rewrite.
5. Deploy using clearly fictional trip data only. Verify external HTTPS, authenticated browser login, create/read/edit of trips, HTTP/MCP consistency through the actual remote transport, unauthenticated access rejection, and persistence through restart. Check desktop and phone-width browser behavior where tooling allows; distinguish browser emulation from physical-phone testing. Configure a practical backup and rollback path; do not call a same-server backup off-site protection. Do not migrate real travel data.
6. Leave the successful deployment running for the user's trial, with a reusable deployment layout so it can remain in use if satisfactory. Report the deployed commit, concrete live checks, remaining gaps, backup/recovery method, and smallest next action. Keep machine-specific access details in the private user session, with only sanitized evidence in the next progress report. Follow the existing public-only Claude delegation workflow for substantial code changes; retain private operational work with Codex.

Proceed with the authorized deployment instead of stopping at a proposal or asking again for deployment permission. If a genuinely missing private connection/hostname detail or platform restriction blocks one step, report the exact blocker and continue independent useful work. A committed directive alone is not evidence that execution has started.

### Same-session privacy requirement — applies to this deployment

The user explicitly requires travel plans to be visible only to users whom the owner has registered/approved. Current source inspection confirms a single shared administrator secret, authenticated API/export/MCP routes, public generic page shells and no account registration, approval or member roles. Do not describe that as a multi-user approval system, and do not distribute the administrator secret to other viewers.

The first live smoke test may use owner-only authentication and fictional data. For the requested user-facing access model, implement a minimal owner-managed account/invitation and approval flow: no anonymous travel-data access, no self-registration that automatically grants access, independently revocable user identities/sessions, owner administration, and ordinary approved viewers read-only by default. Keep existing admin MCP credentials private and separately controlled; do not grant ordinary viewers MCP write access. Avoid a broad SaaS/OAuth project. Do not import real travel data before this access model and its negative-access tests pass.

Treat privacy as a deployment acceptance requirement, not a hidden frontend menu: verify unauthenticated and unapproved/revoked users cannot retrieve trip lists, individual trip payloads, export files, or protected photos/attachments through any route, including direct backend access. Verify read-only viewers cannot mutate through HTTP or MCP. Inspect static assets, legacy demo/build output, source maps, persistent browser/service-worker caches, CDN behavior, and public error/log output for accidental inclusion of protected content or secrets. Public shells may contain only generic UI and explicitly fictional fixtures. Keep real data, database files and backups outside publicly served directories and Git. Prevent caching of protected responses; verify logout/revocation behavior. Report what was actually tested and do not claim that source inspection proves an absence of all vulnerabilities.

### 2026-10-14 — Coordinator status follow-up for Codex B

Please acknowledge pickup of the existing deployment and access-control assignment in `77af520` and report its current status, completed checks, and any exact blocker. If work is already in progress, continue that same task without starting a duplicate. Preserve the existing privacy acceptance gate before any real-data import. Keep the public update sanitized under `61a94d1`; provide any essential private operational details only through the existing authorized private channel. This requests status on the existing assignment and does not expand its scope.
