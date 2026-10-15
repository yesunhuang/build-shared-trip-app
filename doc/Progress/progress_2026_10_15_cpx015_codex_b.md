# Progress report - Codex B, checkpoint 015

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: blocked; deployment and lookup activation await an authorized outbound route.
- Approximate active time: 6 minutes.
- Accepted implementation: `8e93bb5da64c54587e995ed7103a061fb48668dd`; inspected main: `e92aed6cf0b7fa18eade3ab14217a887994d8c14`.
- Existing deployed source remains `3abd569e27f3c11c69802fab7defe1cbdf1176dc`.

## Scope and coordination

Received the approval to deploy and enable checkpoint 014, subject to preserving current network permissions, credentials, accounts and trip content. Read current instructions, provider documentation and checkpoints 013–014. Neither report contained a new continuation comment. No pending local resume prompt, active worker handoff or competing deployment lock was found. Main was current; accepted runtime/build inputs were unchanged from the implementation commit. Unrelated local edits were preserved.

## Live preflight and preservation

The existing application is healthy and has not already received the map/photo release. Its only network is an internal Docker bridge; no outbound proxy is configured. Direct HTTPS attempts from inside that running container to Nominatim and Commons both failed at DNS resolution (`EAI_AGAIN`). An external-facing network attached to the proxy does not provide an approved route for the application. No network, firewall, proxy, environment, image or access setting was changed.

Created a fresh consistent database snapshot with the established backup CLI and validated its integrity. Restored it into separate private storage using the retained production image, with networking disabled. Every application table matched exactly, including trip content and versions, deletion metadata, retry records, users, invitations, credential records, OAuth records and audit records. Schema remained v6. The separate photo copy matched the original. The live database still matched the snapshot at the preservation check; the same healthy application container remained running throughout. Backup and restore locations are retained in private operational evidence.

Normal public HTTPS and direct origin HTTPS, both with certificate verification, returned 200 for health and home, and 401 for anonymous session, trip-list and MCP reads. Public responses retained `no-store`. An initial Python probe from the server received edge 403 responses; normal public Node requests and direct origin checks subsequently passed. Edge controls were preserved.

## Provider review and acceptance limits

Rechecked the [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [Wikimedia User-Agent policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy), [API etiquette](https://www.mediawiki.org/wiki/API:Etiquette) and [Commons reuse requirements](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia). The accepted implementation provides explicit editor searches, application-wide serialization and spacing, caching, bounded requests and saved attribution. No autocomplete, bulk enrichment or confidential queries are permitted. The existing public application website is available as the identifying website; no personal email or invented contact was selected, and no User-Agent setting was written while activation was blocked.

This checkpoint contains actual live connectivity, HTTPS, backup and isolated restore checks. Provider attempts used only a public-landmark query and public service metadata; no itinerary-derived query was sent. Lookup requests did not reach the providers, and no new browser interaction or deployed role acceptance is claimed. Checkpoint 014 remains the evidence for successful real-provider local requests, mocked-provider authorization and request-count checks, and desktop/phone-width browser interactions. Those checks do not establish deployed feature behavior. The feature was neither enabled nor deployed, no persistent live test trip was created, and no trip content was edited.

## Smallest next action

Provide an already permitted application outbound HTTPS route, or separately authorize a reviewed route to Nominatim and Wikimedia Commons while preserving the private application port and existing access controls. The current assignment explicitly excludes network-permission changes, so cutover stopped before any service restart. After that dependency is resolved, reuse the accepted source, take a fresh cutover backup, deploy once, then complete live lookup, role and desktop/phone-width acceptance without persistent test trips or real-content edits. Deployment approval itself is already recorded; only the missing network authority is needed.

The existing image, validated snapshot and separate restore remain available. No rollback was needed. Only this sanitized report is added to Git; no new application build or regression suite was required for this report-only checkpoint. Outgoing content and public-safe author metadata were reviewed; framework privacy auditing with the external private denylist and whitespace checks passed.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
