# Progress report — Codex B, checkpoint 003

- Date: 2026-10-14.
- Agent: Codex B, resumed existing assignment.
- Status: partial; release staged and isolated container acceptance passed. Live startup awaits an owner credential decision.
- Approximate active time: 20 minutes.
- Application commit: `5de23b6`; archived source and staged image: `1fea6a1`.

## Scope and reconciliation

Received the private deployment destination for the existing assignment. No local continuation prompt or new progress-report comment was present. Fetched canonical main, verified a clean checkout and no active Codex B handoff, and retained the already completed application work. The prior report's missing-destination blocker is resolved.

Verified existing SSH key authentication with strict known-host checking. Read-only inspection found no running application, proxy, container runtime or deployment configuration in the inspected locations. The target has a local ext4 filesystem, synchronized clock, available storage and free web ports. An existing interactive SSH session and unrelated services were preserved. Earlier relay requests were not replayed.

## Changes and current state

- Installed Docker Engine from its official Ubuntu package repository, without adding users to the Docker group or changing SSH, firewall, CDN settings or existing authentication material.
- Staged the exact published source, verified its archive digest, built the app image and pinned the fetched Caddy image by digest in private configuration outside source. Prepared separate private data, backup and certificate directories.
- Used an exclusive deployment lock for each provisioning or acceptance operation. No second implementation worker or live application instance was started.
- Private configuration has mode 0600 and intentionally contains no live owner token. The app, proxy and public application endpoint have not been started. Intended live storage is empty; fictional acceptance data and snapshots are separate. Docker remains available for the next step; all owned acceptance containers were stopped and removed.
- Updated `README.md`, `deploy/README.md` and `references/feature-contract.md` to distinguish completed container checks from pending live HTTPS acceptance. Application and template code are unchanged.

Private server operations required the destination context and stayed with Codex. No new Claude invocation was needed; the previously accepted Claude implementation remains the application under test. Private scripts, runtime values and raw receipts remain outside public Git.

## Evidence

- Actual target runtime: Docker Engine 29.9.0, Compose 5.6.0, app Node 24.21.0 and Caddy 2.11.7. Image build and `caddy validate` passed; validation issued a formatting warning only. Compose configuration validation passed with public placeholders.
- `npm run test:server` passed inside an isolated Linux container with no network access, no published ports, the image's non-root user, read-only root filesystem and dropped capabilities. Existing tests exercised real HTTP/MCP reads and writes, trip isolation, atomic batches, conflicts/retries, SQLite migrations, accounts, approvals/revocations, read-only enforcement, protected media, snapshots and ownership contention.
- A separate disposable container with fictional data and automatic restart enabled accepted a create and edit. A competing container using the same data was refused. After an externally delivered hard kill of the verified owned process, Docker restarted it without manual lock cleanup. The trip ID, version and durable retry response survived; official MCP SDK discovery and reading agreed with HTTP after recovery.
- The container backup CLI created and validated a snapshot. Restore into separate disposable storage succeeded; a subsequent SQLite check matched the trip ID/version and both durable request entries. Graceful cleanup removed the ownership marker and left no acceptance service running.
- External HTTPS certificate verification succeeded at the CDN edge, while `/health` returned 521 with no origin listener. This is not application HTTPS or origin-certificate acceptance.

Two acceptance harness settings needed correction: tests inherited the image's non-loopback binding, and a read-only snapshot mount prevented SQLite from creating WAL companion files. Re-running the affected checks with the intended loopback test binding and writable disposable mount passed. No application fix or live-data change was required.

Documentation link/path checks, `git diff --check` and `node scripts/audit-privacy.mjs . --mode framework` passed. Reviewed outgoing text and repository-local author metadata; destination details and private operational material are absent.

## Pending decision and smallest next action

The current operational restriction preserves credentials and access grants. No existing live owner credential was found or initialized. Actual private Compose validation confirms that startup is refused without the owner token.

The owner must clarify whether initial owner-token provisioning and disposable fictional viewer-account approval/revocation are allowed for this trial, or identify existing private credential configuration and the permitted account-test scope. Deployment authorization itself is already present.

After that decision, reuse the staged release and private configuration, start the authenticated app/proxy, obtain and verify automatically renewed origin TLS, and complete external HTTP/MCP, anonymous/pending/revoked/viewer privacy, cache, browser and live restart acceptance using fictional data. Do not import real trip data before those live gates pass. Physical-phone installation, external AI-client compatibility and off-site backup remain separate checks.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
