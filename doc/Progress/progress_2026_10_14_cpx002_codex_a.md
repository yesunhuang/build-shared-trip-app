# Data-directory ownership and MCP review fixes

- Date: 2026-10-14 (UTC)
- Agent: Codex A, resumed existing identity
- Status: complete for these review fixes; overall application acceptance remains partial
- Approximate active time: 17 minutes
- Base: 003f9b0; implementation: 78d65f2; original application implementation: b511752

## Continuation and scope

No local continuation prompt was found. The checkout was clean, and no active Codex A handoff ref existed. Fast-forwarded main from 618fa3c to 003f9b0, preserving Codex B's registry claim and report. Both reports' final `## comment` sections contained only their reserved placeholders, so there was no new comment directive to process.

Addressed the two concrete findings in [Codex B's review](progress_2026_10_14_cpx001_codex_b.md) under the existing implementation assignment. No cross-agent application integration was needed.

## Changes

- `server/data-lock.mjs`, `server/app.mjs`, `server/cli/restore.mjs`: startup and restore exclusively create the same PID-format lock. Existing locks are left untouched, including stale locks. Cleanup checks the owned file's device/inode; repeated close/release is safe. Restore holds ownership across staging and replacement.
- `server/mcp.mjs`: discovery marks the batch editor as potentially destructive because it supports deletion and replacement. Read tools remain read-only, creation remains additive, and identical-request retries retain their idempotency annotation.
- `scripts/test-data-lock.mjs`, `scripts/test-selfhosted.mjs`, `package.json`: real child-process contention, stale/live locks, replacement-lock preservation, startup-failure cleanup and actual SDK discovery assertions are part of the server test gate.
- `references/self-hosted.md`, `references/mcp.md`, `references/agent-setup.md`, `doc/implementation-plan.md`: documented lock recovery, accurate annotations, test coverage and corrected two setup-guide anchors.

An unclean stop now requires manual lock recovery after confirming that all service and restore processes using that directory have stopped. Automatic container restart also refuses a leftover lock. Normal graceful restart remains supported. No schema or trip-data migration was introduced.

## Evidence

| Class | Check | Outcome |
| --- | --- | --- |
| Controlled interleaving | Original startup path, disposable fictional storage | Replaced the stale lock between PID observation and unlink; confirmed that the original code removed the new owner's lock and started. This is a controlled schedule, not a production incident. |
| Actual local processes | `npm run test:server` | Dead-PID and live-owner locks blocked startup/restore without changing target data. Concurrent server/shared-lock-holder/restore contenders preserved the surviving owner's inode/PID. Replacement locks survived another owner's close; repeated close and startup-error cleanup passed. |
| Actual local protocol | Official SDK discovery and calls in the server suite | Returned annotations matched the four tool contracts. Existing authentication, bidirectional HTTP/MCP editing, isolation, conflicts, atomicity, retries and persistence checks passed. |
| Regression and simulated DOM | `npm test` | All legacy, backend/MCP, locking and DOM suites passed. Import/export, backup/restore and prior-schema upgrade checks remained passing. |
| Generation/static | Demo rebuild; fictional generation into fresh external disposable output; `qa-static.mjs` | Passed. Rebuilt `docs/` had no changes. The missing-Firebase warning is expected for the legacy local-preview fixture. |
| Publication | Framework privacy audit, actual outgoing diff/metadata review and `git diff --check` | Passed. Public-safe Codex A author/committer identity; no binary media, real travel data, runtime configuration or raw model receipts added. |

The initial sandboxed server test could not bind loopback; the authorized rerun with loopback access passed. All test-owned services and children exited; unrelated processes were preserved.

## Delegation

One fresh text-only Claude Code task used verified `claude-opus-5-5`. Initialization reported no tools or MCP connections; customizations, skills and session persistence were disabled. Only reviewed public source and fictional test requirements were supplied. Raw invocation records remain outside the repository.

Accepted the helper's patch with small coordinator corrections to diff formatting, test initialization order, source attribution and documentation links. Claude did not execute tests; Codex ran the checks above.

## Remaining acceptance and smallest next action

Browser inventory still exposed no browser provider, and Safari selection failed because no controllable window existed. Desktop/390 px/375 px layout, map/sheet gestures and actual-phone installation remain unverified. Docker CLI/build, third-party AI clients, live external services and HTTPS deployment also remain unverified; no deployment or real-data migration was performed.

Resume the responsive acceptance checklist in `references/responsive-performance.md` when a controllable browser is available, using fictional storage. Physical-phone installation and Docker each need their own environment check. No new product decision is needed for the completed local fixes.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
