# Progress report - Codex B, checkpoint 016

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: complete; accepted map/photo release deployed and lookups enabled.
- Approximate active time: 25 minutes.
- Deployed source: `8e93bb5da64c54587e995ed7103a061fb48668dd`.
- Retained previous source: `3abd569e27f3c11c69802fab7defe1cbdf1176dc`.

## Scope and restricted route

Continued checkpoint 015 after explicit authorization for its missing restricted egress. Its comment contained no further instruction. Main was current at `d8fa7dc76ae9a5bca63f5f1477707e947e425f9c`; no pending resume prompt, active handoff or competing deployment was found. The accepted application implementation was reused unchanged. Private operational configuration and preservation checks stayed with Codex; no helper received live context.

The app remains attached only to internal networks, with no published port. A separate private gateway accepts CONNECT only for `nominatim.openstreetmap.org:443` and `commons.wikimedia.org:443`. It requires a matching TLS ClientHello name, rejects plaintext tunneling and non-public resolved addresses, and resolves only those fixed names through the existing host/Docker resolver. It passes encrypted traffic without terminating TLS. Node's environment-proxy support routes the app's requests through it; unrelated destinations and direct bypass remain denied. The gateway has no application data or credential mounts, no public port, a read-only filesystem and dropped capabilities. No unrelated network/firewall permissions or original HTTPS proxy configuration were changed.

Enabled the existing lookup flag and identifying User-Agent using the approved existing application website. No personal email, invented contact, API key, account, grant or billing setup was introduced. The accepted search limits, cache, attribution and redirect refusal remain in place. Provider policies reviewed for checkpoint 015 still apply: explicit moderate use, cached results and no confidential queries. [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/), [Wikimedia identification](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy), [Node proxy support](https://nodejs.org/en/learn/http/enterprise-network-configuration).

## Backup, cutover and preservation

Built the accepted source archive with its commit recorded in the image. Took and validated an online snapshot, restored it separately under both retained and accepted images, and compared all 11 application tables exactly. Copied the photo store separately and verified its fingerprint. Transferred database and media backups over encrypted SSH to private off-host storage and verified their digests.

Stopped only the application for the single cutover. Took another consistent snapshot of the stopped state, validated it, and repeated both image restore drills against that exact snapshot before starting the accepted image. Schema remained v6. All trip rows and versions, item data, retry records, deletion metadata, users, invitations, credential records, OAuth records and audit records matched exactly after startup and again after acceptance checks. Photos also matched. Configuration changes were limited to the image, lookup settings and restricted proxy route; unrelated private environment entries were preserved. The original HTTPS proxy stayed running.

The retained image, prior private configuration, validated snapshots and separate restores provide rollback. No rollback was needed, and no real trip content was edited, enriched or imported.

## Acceptance evidence

| Check | Actual outcome |
| --- | --- |
| Production image, isolated automated tests | Lookup, owner deletion, content-manager and OAuth suites passed on Linux. These exercise real HTTP/MCP with fictional accounts and data; lookup provider responses are mocked for the denial, cache, failure and timing matrix. |
| Restricted route, before and after cutover | Actual requests from an internal-only test container and then from the production app container returned 200 from both providers with normal TLS verification. Unrelated hosts, literal IP targets, wrong ports, plaintext HTTP, mismatched TLS names and non-TLS tunnels were denied. Raw direct TCP bypass and unrelated external DNS from the app were denied. |
| Production HTTPS and source | Public and direct-origin health returned 200 with certificate verification. Public home returned 200. Anonymous session, trip-list, MCP, photo and both lookup-route probes returned 401 with `no-store`. Image revision matched the deployed commit, and served picker bytes matched the accepted release archive. |
| Browser with real providers | Chrome used the production image in a separate fictional data directory through the same restricted gateway, reached by a private test tunnel. Explicit search returned one place and five photo candidates. Choosing and saving stored coordinates, address and complete photo attribution. A real thumbnail and OSM tiles loaded; navigation used the saved coordinates. |
| Desktop and phone widths | Checked 1280 x 900, 390 x 844 and 375 x 812. Map-to-card and card-to-map selection worked. The phone editor/candidate content fit without horizontal overflow; saved previews, cached results, Cancel and keyboard sheet resizing worked. Phone widths are browser emulation. |
| Zero automatic searches | Initial viewing, editor opening and typing made zero search/provider calls. Two explicit searches made two provider calls. Reloads, ordinary viewing and an unrelated fictional note edit added zero. Two later explicit repeated searches used the cache: final totals were four search requests, two provider calls. Cancel left the fictional trip at version 3 with saved selections intact. |

A first asset comparison used Git blob line endings instead of the release archive; comparison against the actual archived build input then matched exactly. No application correction was required. Checkpoint 014 retains the full local regression, fresh generation/static QA, four-language checks and cache-across-restart evidence for the unchanged source.

Authenticated browser mutations were confined to the isolated fictional service. No owner password or production credential was entered, no live account was created, and live owner/viewer sign-in was not repeated. Physical-device gestures and installation were not tested. The fixture service and private test tunnel were removed, the browser tab was closed and its viewport reset. Private fictional screenshots remain outside Git.

## Current state and next action

The accepted application and restricted gateway are healthy; lookups are enabled. Editors can refresh the app, open a plan and explicitly search/select a public place or photo. Ordinary use renders saved data. There is no remaining owner setup action for this release. Provider availability remains external; search errors leave saved trip content intact. Prior rollback resources are retained.

Only this sanitized acceptance report and verification-status links are added to public Git. Outgoing content, links and neutral author metadata were reviewed; framework privacy auditing with the external private denylist and whitespace checks passed.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
