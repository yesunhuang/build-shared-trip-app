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
