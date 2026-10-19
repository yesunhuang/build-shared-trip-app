# CP003 — Revocable read-only itinerary links

- Date: 2026-10-19 UTC. Agent: Codex A.
- Status: complete for implementation and fictional acceptance; production rollout remains pending.
- Approximate active time: 50 minutes.
- Source: `727b7aa`; assignment baseline: `349b2e9`.

Processed the 2026-10-19 comment in CP002. Checked continuation state, main and the own handoff before implementation. Preserved CP041–CP045 membership, OAuth, media and recovery behavior. Corrected the stale membership-rollout documentation using completed CP042 evidence, retaining its safeguards for later rollouts.

## Implementation

- `server/trip-sharing.mjs`, `db.mjs`, `app.mjs`, `auth/policy.mjs`, `audit.mjs`: schema v9 adds an empty share table and issuer-invalidation triggers without rewriting previous rows. One optional link per trip, 256-bit randomness, digest-only storage, independent share revision and explicit create/rotate/revoke. Only the owner or the current approved creator with trip membership manages it. Account revocation/epoch changes, creator displacement and membership removal permanently invalidate affected links. Archive suspends reads; restore resumes only a still-valid link.
- `/s/<id>` serves a generic four-language reader. `/guest/*` rechecks a header capability for every content/image read and never creates a cookie or account/MCP principal. The explicit projection excludes structured bookings, account/member/access metadata, administrative state and unbound media. Uploaded photos, cover/logo and allowed bound local photos use protected image reads. Free text/photos require sharer review; already viewed content cannot be recalled.
- `assets/selfhosted/guest.*`: timezone-aware day selection, chronological cards, labelled dates/maps, selectable addresses, large text, bounded reconnect/manual refresh and honest stale/closed-link states. Saved updates preserve the chosen day and wait for native link activation; changed fragments clear state and reload. Image and response memory are bounded. No Google components, searches or allowance reservations are started.
- `assets/app-template/public/share-management.js`, `app.js`, `hosted-client.js`: integrated owner/creator controls with actual text/image-list preview, optional expiry, explicit confirmations, copy/share fallback and once-only link display. Lost responses are reconciled through metadata, never automatically retried. Fresh authority loss clears controls.
- `deploy/Caddyfile`, service worker and contracts: guest cache exclusions, no-referrer/noindex/no-store and capability-header filtering in runtime/error logs. The fictional demo was regenerated. `references/trip-sharing.md` defines the exact API, projection, lifecycle and compatible rollback.

## Evidence

| Check | Result |
| --- | --- |
| Baseline and final `npm test` | Passed. Full legacy, actual HTTP/SQLite/official MCP SDK, ACL/OAuth, media, recovery and DOM gates, including the new sharing suites. |
| `test-trip-sharing.mjs` | Valid reads/media, redaction, cross-trip/guessed/unbound denial, all write/admin/MCP boundaries, owner/creator authority, conflicts, expiry/rotation/revoke, issuer no-revival, archive/deletion, restart, snapshot validation and row-preserving v8→v9 migration passed. |
| Visitor and management DOM suites | Four languages, uncertain writes, bounded retries/memory, fingerprinted media, copy/share fallback, timezone boundaries, native-press deferral, changed fragments and late-response cleanup passed. |
| `test-trip-sharing-browser.mjs` | Actual Chrome: 24 visitor and 12 owner-flow cases at 320/390/1280 px, four languages and 100%/200% text. Actual images, optional expiry, latest-content/day preservation, poor-network recovery, copy fallback, rotation/revoke and native map click/Enter passed. A saved edit during a held pointer press preserved native activation. External map navigation was intercepted before provider contact. |
| `test-trip-sharing-rollback.mjs` | Actual isolated prior frontend/current security backend, v9 snapshot restore, later edits, rotation, image checks, later revocation and roll-forward preservation passed. This was a local source-level rehearsal, not an application-container or live rollout. |
| Caddy | Existing binary accepted the public template. A disposable network-disabled, read-only container forced upstream errors/debug requests; diagnostic logs remained and the fictional capability was absent. No running-service reload or configuration change. |
| Generation and publication | Demo rebuild, fresh external fictional generation/static QA, mandatory framework audit, staged-export private-identifier audit and diff checks passed. Actual outgoing content, public-safe Git identity and the three PNGs were reviewed. Ignored local material was preserved outside publication. |

Integration caught and corrected fingerprint-query rejection and hidden expiry-field/grid overflow. Test setup corrections covered helper argument order, valid dated fixtures, network auto-recovery timing and the existing mobile overview entry point. Final checks passed after correction.

Fictional previews: [phone](previews/cpa003-visitor-phone.png), [desktop](previews/cpa003-visitor-desktop.png), [320 px at 200% text](previews/cpa003-visitor-large-text.png). No displayed link, credential, account identity or live trip appears in them.

## Delegation

Applied the repository [Claude delegation skill](../../.agents/skills/codex-use-claude/SKILL.md). Three cohesive implementation tasks and focused corrections used verified `claude-opus-5-5`, confined file tools, reviewed public source and fictional fixtures; no MCP connections or private context. Helpers authored code/tests/contracts but did not execute checks. Codex integrated, made small routing/layout/test corrections, ran acceptance and handled the private operator-side validation. Accepted work and model execution were verified; raw invocation records are not published.

## Release handoff and limits

The source is ready for the app and proxy rollout. This session performed no production deployment, live content/access change, account provisioning or real share enablement. Physical Android/iOS and WeChat in-app-browser behavior remain untested; Chrome phone/touch emulation does not establish those results.

Smallest next decision: authorize deploying `727b7aa` with the proxy cache/logging update through the established private route, leaving every existing trip unshared. The earlier app-only rollouts do not establish authorization for this new app/proxy cutover.

On an authorized rollout:

1. Reconcile current content/authentication/ACL/configuration and the separate allowance ledger; retain every newer edit, revocation and usage entry. Take fresh consistent database/photos backups and validate an isolated restore.
2. Build and test accepted and compatible rollback images. Rollback retains the current v9 schema/ACL/OAuth/share backend with prior UI and current data/ledger. An older v8 backend refuses v9; do not lower the schema or restore historical state over later changes.
3. Validate and apply proxy header redaction/cache exclusions before the app can issue links. Upgrade the app normally; migration adds no enabled share. Preserve existing credentials, OAuth identities/scopes, mounts, ports and provider controls.
4. Verify image/asset identity, health, protected HTTP/MCP/media boundaries, empty sharing state for existing trips and preservation of prior rows/ledger. Use fictional isolated storage for positive sharing checks; never enable a real link merely for acceptance.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
