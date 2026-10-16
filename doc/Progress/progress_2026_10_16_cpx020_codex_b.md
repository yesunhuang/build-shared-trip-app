# CP020 — Conservative monthly Google allowance

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — code, fictional acceptance and publication; deployment and activation pending
- Approximate active time: 90 minutes
- Baseline: CP019, `7e3b17f`; accepted source: `ee0ba6773e1e87dd3d2fe77c0b3fed50e2ee855a`

## Changes

Continued CP019 for the newly authorized allowance requirement. Google stays disabled by default. This task made no deployment, provider-account change, real Google request or live itinerary mutation.

`server/google-allowance.mjs` adds a separate SQLite ledger shared across users, tabs and trips. Atomic reservations precede app-controlled Google work. Durable account-scoped idempotency, stored monthly baselines, consistency checks and clock-fault markers survive restarts. Missing, damaged, replaced, unconfigured or uncertain state refuses new work without blocking normal trip use. Uncertain, cancelled, expired and lost-response reservations are never refunded.

`server/cli/google-allowance.mjs` provides operator-only `init`, `status`, `raise` and `reconcile-clock`. There is no browser/MCP reset or refund. Configuration requires an explicit allocation and positive headroom; the allocation cannot exceed the currently verified 10,000 free Query events. There is no default entitlement to that shared allowance.

`server/app.mjs`, `server/auth/policy.mjs` and `server/google-places.mjs` enforce reservations and deliver the browser key only with a grant. Viewers can reserve Details for an existing current association; owners/content managers can also reserve Search and preview. Every request rechecks access, global configuration, trip opt-in and relevant association. Owner bearer, MCP and OAuth tokens cannot reserve. Trip versions are unchanged by reservations.

`assets/app-template/public/{app,hosted-client,google-places-ui-kit}.js` checks one-use, short-lived permits before SDK bootstrap and dispatch, including current context, visibility, provider month and corroborating wall/monotonic clocks. Components remain in their original connected hosts. Collapse/reopen reuses them; a background card rebuild disposes them and offers an explicit Show control. Original Commons/manual photos, no-photo behavior, OSM, per-trip choices and link protections remain intact.

Updated contracts, setup/rollback instructions, deployment templates, regression scripts and generated fictional `docs/`. Public-only Claude helpers supplied implementation/corrections under restricted file tools; executed correction/review model metadata verified Opus. Codex handled acceptance and two small fixes: consistent startup-validation snapshots and waiting for re-enabled home-test controls after saves.

## Counter coverage

| App-controlled action | Accounting |
| --- | --- |
| First SDK bootstrap and first Details/Search/preview | First action's reservation, before bootstrap and again checked before dispatch |
| New Details construction/assignment, Search query or Place ID preview | One fresh unit per potentially billable action |
| Explicit retry or new component after disposal/eviction | Fresh reservation; no automatic retry |
| Retained same-host component shown again | Reuse; no new construction, connection or unit |
| Poll, language change, unrelated edit or background rebuild | No automatic Google work; rebuilt hosts require explicit Show |
| Reservation transport retry | Same durable key and permit; no additional unit, and replayed grants are not dispatched |
| Cancellation, lost response, expiry, interrupted work | Keep the reservation; no refund |

Google documents the reset as the first day of the month at midnight Pacific US time. The implementation uses `America/Los_Angeles`, including DST, with boundary margins. Clock faults persist; startup in an unrecorded later month requires operator reconciliation rather than silently assuming zero. See [Google's billing overview](https://developers.google.com/maps/billing-and-pricing/overview).

## Evidence

| Check | Outcome |
| --- | --- |
| Full `npm test` | Passed, 235 seconds: legacy, server and UI suites |
| New ledger tests | Real local HTTP/SQLite; last-unit races across accounts/trips and worker connections, permissions, durable retries/restarts, monthly/DST boundaries, clock/config changes, missing rows/corruption, discarded responses and trip backup/restore passed |
| New/updated UI tests | Mocked Google and injected clocks: Details/Search/preview, retries, cancellation, late replies, opt-out, hidden/lifecycle changes, denial with zero new work, original-image equality, four languages and no component reconnections passed |
| Chrome desktop, 1280 × 900 | First expansion and repeated collapse/reopen: one grant, construction and connection. Unrelated note save added none; explicit Show after rebuild advanced each to two. A subsequent exhausted request added no Google activity |
| Chrome phone-width, 390 × 844 | Fresh exhausted fixture: one denied reservation, zero mock SDK/component activity across Details/Search/preview, original image loaded, no-photo plan still had no image; no horizontal overflow. Emulation, not a physical phone |
| Link regression | Full simulated mouse/touch/modifier suite passed; native Chrome Enter opened the fictional Maps destination in a new tab with no opener |
| Generation | Fictional demo regenerated; fresh disposable example generation and `qa-static` passed. Expected local-preview warning without Firebase configuration |
| Publication | Framework privacy audit with external denylist and whitespace checks passed; actual outgoing text, neutral author metadata and fictional screenshot pixels reviewed |

Acceptance caught and corrected a clock fault forgotten after restart, missing monthly baseline reconstruction, unreserved native move reconnections, and concurrent startup-validation reads. The first full run also exposed an existing home-test save/readiness race; explicit enabled-control waits fixed it, and the complete rerun passed. No unresolved local failure remains.

Reviewed fictional screenshots: [desktop fallback](../evidence/cp020-desktop-fallback.png), [phone-width fallback](../evidence/cp020-phone-fallback.png). Disposable browser services/tabs were closed and the viewport override reset. The unrelated local ignore-file edit was preserved and excluded.

## Limits, rollback and next action

This counts app-controlled reservations, not Google's actual billing. A visible browser key can bypass the ledger; the loaded SDK can make autonomous requests; other projects share the billing-account allowance; provider metering may differ. A consistently wrong clock or replacement with an older valid ledger cannot be independently detected. No real SDK, attribution rendering, key restrictions, billing console or metering was tested. The published 6,000/minute quota and budget alerts are not verified monthly spending caps. Google remains off pending provider enforcement or the owner's informed acceptance of these limits.

Trip schema remains v6; the independent ledger uses format v2 and needs explicit initialization. Trip restore tests preserve the current ledger. Keep that ledger through rollback, never restore an older copy or reset unknown usage to zero, and disable Google before using a build without the gate. An unrecorded month after downtime or a clock fault needs `reconcile-clock` and restart; counters never decrease.

The smallest next action is owner review of [setup and cost controls](../../references/google-places-ui-kit.md#owner-setup-pending-not-done), followed by a separately authorized rollout. Setup requires Maps JavaScript API plus Places UI Kit, a dedicated website/API-restricted browser key, allocation after other billing-account consumers, safety headroom, trustworthy time and a conservative initial baseline. The 9,000-reservation example applies only to an otherwise unused 10,000-event allowance. Real provider acceptance remains pending; no credential entry or activation was performed.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
