# Progress report — Codex B, checkpoint 004

- Date: 2026-10-14.
- Agent: Codex B, existing assignment resumed after owner authorization.
- Status: partial; fictional live trial is running and the checks below passed. Direct browser Cache Storage inspection remains pending before real-data import.
- Approximate active time: 70 minutes.
- Deployed application: `5de23b6`, packaged from the staged published source `1fea6a1`. Documentation-only base: `a39f77d`.

## Scope and current state

The owner authorized initial administrator credential setup and disposable fictional account testing. This resolves checkpoint 003's credential decision. Checked local continuation locations, canonical main, the latest report comment and deployment state before work; no conflicting instructions or duplicate worker/service were found.

Initialized the owner token in private server configuration, with a separate private retrieval file and protected client-side acceptance storage. Existing SSH credentials and unrelated services were preserved. Started the staged Compose release without rebuilding or replacing the reviewed application. The backend remains internal; only the HTTPS proxy publishes web ports.

The app and proxy remain running. One explicitly fictional demo is active; two harness-owned test trips are archived, not deleted. The temporary viewer is revoked and its invitation is consumed. Real travel data was not imported. Destination, credential, runtime-path and raw-receipt details remain outside Git.

Updated `README.md`, `deploy/README.md` and `references/feature-contract.md` with live evidence and limits. Added stdin isolation to the documented backup command. Application/template code is unchanged.

## Live evidence

- Compose configuration and app health passed. Verified HTTPS through the public CDN and directly at the origin with certificate validation enabled; both returned health 200. Origin certificate issuance succeeded and certificate state is mounted persistently for Caddy's configured automatic renewal. A renewal cycle has not yet occurred.
- Actual container inspection showed no published backend port and an internal backend network. External checks could not reach the backend or proxy administration ports. Requests made directly to the running backend rejected anonymous protected routes and an unrelated Host. The proxy has neither the owner credential nor a trip-data mount.
- A harness executed from outside the server against actual HTTPS passed 365 setup assertions with zero failures. It exercised HTTP/MCP creation, reads and related writes, two-trip isolation, stale conflicts, invalid-batch rollback, durable retries and fictional import/export through the official MCP SDK.
- Anonymous list/read/export, account/session, private-media GET/HEAD, attachment and MCP requests were refused. Pending sign-in issued no session. Approved viewers could read/export/media, while mutations, imports, account administration and MCP misuse were refused. Revocation invalidated issued sessions; reapproval required new sign-in. Cookie Secure, HttpOnly and SameSite attributes and Origin checks passed.
- Owner-authenticated requests followed by anonymous requests to the same protected URLs did not expose content. Protected edge responses were no-store, had no positive Age, and were not served as cached hits. The harness noted 30 absent Cloudflare-specific headers; direct origin inspection verified all three no-store headers. Cloudflare's documented consumption of its own header explains the downstream absence; downstream generic cache headers and DYNAMIC status were observed. See the [provider documentation](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/).
- Public shells, served scripts/styles, manifest, service worker, generic offline page and photo manifest were checked for the actual owner token and unique live-test content; neither was found. Generated legacy demo output and Git are absent from the deployed application image. Inspected app/proxy logs and the temporary outage response did not contain the owner secret.

## Browser and restart evidence

Actual Chrome over HTTPS verified owner login/logout and a saved metadata edit to label the demo explicitly fictional. Desktop at 1280×900 and phone emulation at 375×812 loaded the trip, map tiles and date navigation. Phone home/planner views fit in all four languages; keyboard resizing of the planner sheet worked. Viewer home/trip controls were read-only and reminder inputs were disabled.

Revoking the viewer cleared the open trip through polling and returned it to sign-in. Back navigation also returned to sign-in rather than restoring protected content. Screenshots remain private and contain fictional trial content only. The browser tool's read-only DOM scope could not enumerate Cache Storage/local storage; these records were not inspected directly. The actual served service worker was reviewed: its persistent whitelist contains generic offline UI, CSS, icons and manifest only, while protected requests and navigation bypass that cache. This is source and behavioral evidence, not a complete persistent-cache inventory.

Took and validated a live backup, gracefully stopped and started only the app, and verified a changed app process plus healthy public HTTPS afterward. The proxy process remained unchanged. The temporary unavailable response was 502 and no-store. A freshly issued viewer session was valid before the restart and refused afterward. The finish harness passed 60 assertions with zero failures: account credentials and trip IDs, versions/content and original HTTP/MCP retry results survived. Its sole note was the expected owner edit to the demo.

Final live backup and restore into separate storage matched every row in trips, request log, users and invitations. The restored state retained the active demo, archived test trips and revoked viewer. Protected photos were archived separately. Same-server snapshots are recovery evidence, not off-site protection.

## Delegation and corrections

Claude Code authored the generic endpoint harness in a fresh restricted public-only export, with shell, connectors, settings and session reuse disabled. Verified executed model: `claude-opus-5-5`. It received no destination, configuration or credentials and ran no live tests. Codex reviewed the bounded artifact, passed its syntax check, supplied private configuration and ran acceptance. The harness and raw receipts remain outside this checkout.

No application corrections were required. Direct backend probing was changed from fetch to raw HTTP to preserve the intended Host header. The first restart script ended after its interactive container backup consumed subsequent input; no restart occurred in that attempt. Redirecting stdin corrected the operational harness, after which the actual restart and affected checks passed. Browser link activation used keyboard navigation when pointer automation did not navigate; direct URLs and other navigation controls worked.

Documentation link/path checks, `git diff --check` and the framework privacy audit passed. A locale-dependent JSON reader stopped the first outgoing credential check before publication; an explicit UTF-8 reader passed the corrected check. Reviewed actual outgoing text and neutral repository-local author metadata; private destinations, access instructions, credentials and screenshots are absent from the public diff.

## Remaining work and next action

The fictional trial is available through the private access details. Complete direct browser Cache Storage inspection before real-data import; the runtime limitation above prevents claiming that gate complete. Physical-phone installation, full pointer/touch regression, named external AI-client integration, certificate renewal, full-host reboot and off-site backup remain untested. No additional credential/deployment decision is currently needed.

Upgrade using a validated snapshot and retained image; restore into separate storage before switching data mounts. Account state comes from the snapshot, so later revocations must be reapplied when restoring an older snapshot. Follow `deploy/README.md` and `references/self-hosted.md`; private connection and recovery details stay outside public reports.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
