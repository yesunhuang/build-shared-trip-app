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

### 2026-10-19 — Codex A: simple, revocable read-only trip links

Implement this assignment; do not stop at another proposal. The primary goal is an effortless mobile reading experience for recipients unfamiliar with apps: receive a link in a messaging app, tap once, and understand the day's itinerary. The owner explicitly accepts the privacy tradeoff that anyone holding or receiving a forwarded link can read its deliberately shared content.

**Baseline and scope**

- Resume Codex A's existing identity, inspect current main and any newly present own handoff, and build on the latest integrated implementation. This report's old acceptance gaps are historical: read Codex B's subsequent reports, especially CP041–CP045, before changing permissions, OAuth, media, or recovery. Preserve B's completed work and unrelated changes.
- Deliver implementation, fictional end-to-end acceptance, updated contracts, and a sanitized progress report with a concrete release/rollout handoff. Reuse applicable existing rollout authority and the established private operator route; do not assume that this comment authorizes enabling sharing on any real trip, provisioning accounts, or expanding paid usage. Keep all existing trips private by default.
- Follow repository setup, delegation, publication and active-time rules. Correct the stale membership-document rollout status using the completed CP042 evidence while updating related contracts.

**Recipient experience — the main acceptance criterion**

- Open directly to a lightweight read-only itinerary, without registration, login, verification codes, installation prompts, onboarding, or a separate guest-password step.
- During the trip, select today in the trip's timezone. Before departure show the first day; after the trip keep past days accessible. Handle undated drafts sensibly. Use clearly labelled date/day controls and show the selected date and weekday; do not rely on hidden gestures.
- Present events chronologically, with readable large text, strong contrast, generous touch targets and text labels. Emphasize times, places, meeting instructions and important notes when those fields exist; never invent missing arrangements.
- Reuse existing trip content and useful photos/maps in a simplified visitor view. Do not require maintaining a second itinerary. Hide editing, account, membership and administration controls.
- Addresses remain readable/copyable and offer a labelled map link with a web fallback. Opening an external map must not disclose the share credential.
- The same link shows updated saved content. Refresh on sensible lifecycle events without disrupting reading or unexpectedly jumping the selected day. Use bounded retries and a clear retry button on failure; distinguish stale/loading/error states. Do not promise offline access or durable guest caching.
- Provide friendly localized invalid/expired/revoked-link wording rather than raw HTTP codes, for example: “这个分享链接已关闭，请联系发给你的人获取新链接。” Preserve existing language support and large-font layouts.

**Share lifecycle and access boundary**

- Sharing is opt-in per trip. Only the owner administrator or that trip's current creator may enable, manage, rotate or revoke it; ordinary members and content-manager status alone do not grant sharing authority.
- Start with one active link per trip, default no expiry with an optional expiry time. Provide a simple copy/share workflow, explain that anyone with the link can view, and allow explicit immediate revocation or rotation. Ordinary content edits must not rotate the link.
- Use a cryptographically random capability with at least 256 bits of entropy, stored as a digest rather than raw plaintext. Design the copy/retrieval lifecycle consistently with that storage choice and document it honestly. Link previews/prefetches must not consume a one-time credential or mutate sharing.
- Enforce an explicitly scoped server-side visitor projection for exactly one trip and its allowed media. A share capability must not become an account session, MCP credential, global trip-list permission, invitation, export of the full private record, or write permission. Existing authenticated web/MCP ACLs and scopes stay intact.
- Exclude account/member metadata, audit/security state, and structured booking confirmations, identity/payment fields or other private administrative data from guest responses, not just the UI. Define the projection from the actual schema, and give the sharer an accurate preview/explanation of what is included. Free-text notes/photos may themselves contain private content: do not claim automatic sanitization.
- Cover embedded uploads, cover/logo and bound local media without exposing unrelated or unbound files. Recheck capabilities on subsequent reads. Revocation/rotation/expiry/deletion must deny future content and image requests and invalidate derived guest sessions; fail closed for inactive issuers or lost creator authority. Document archive behavior. Already viewed/copied content cannot be recalled.
- Keep capabilities out of application/proxy logs, analytics, referrers, third-party requests and public artifacts. Use generic unfurl metadata, appropriate no-referrer/noindex headers, no-store responses and service-worker/CDN cache exclusions. Explain unavoidable exposure to the messaging service receiving the link; noindex is not access control.
- Avoid anonymous visitors creating unbounded provider charges or Google allowance reservations. Preserve existing budget controls; essential itinerary reading must work without paid third-party components. Use bounded abuse controls without adding routine recipient friction.

**Evidence and delivery**

- Exercise real local HTTP/SQLite paths with fictional fixtures: valid anonymous reads/media, invalid tokens, cross-trip and guessed-media denial, all writes/admin/MCP denied, redacted response payloads, authority checks, expiry/rotation/revocation including derived sessions, and migration/restart/compatible rollback behavior. Check cache and referrer behavior as well as UI visibility.
- Verify narrow phone widths, enlarged text, date/timezone boundaries, latest-content loading, poor-network recovery, map fallback, copy/share fallback and all supported languages. Target messaging in-app browsers, especially WeChat. Distinguish actual physical/in-app-browser checks from emulation; unavailable hardware must be reported honestly, not fabricated or used to block otherwise useful implementation.
- Run required repository gates. Publish only fictional screenshots and sanitized reports/comments. Include changed paths, public commit IDs, exact checks/limits and the smallest remaining acceptance action. Do not enable a real share link simply to manufacture evidence.
