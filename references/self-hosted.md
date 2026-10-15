# Self-hosted multi-trip service

One Node 24 process serves the home page, every trip, the JSON API, and remote MCP. SQLite data lives outside the checkout. Adding a trip does not require a build, another backend, or Firebase.

## Run locally

~~~bash
npm ci
export SHARED_TRIP_ADMIN_TOKEN='<replace-with-a-random-secret-of-at-least-32-characters>'
export SHARED_TRIP_DATA_DIR="$HOME/.local/share/shared-trip"
npm start
~~~

Generate a secret with a password manager or Node crypto.randomBytes(32).toString('base64url'), and keep it privately for sign-in. Open http://127.0.0.1:4173/, choose **Owner sign-in**, and create a blank trip or import assets/trip.example.json. Use temporary storage for fictional checks.

| Setting | Default | Meaning |
| --- | --- | --- |
| SHARED_TRIP_ADMIN_TOKEN | Required | Owner administrator bearer secret, 32-512 ASCII characters |
| SHARED_TRIP_DATA_DIR | Required | Writable persistent directory outside the checkout, on a local filesystem |
| SHARED_TRIP_HOST | 127.0.0.1 | Listen interface; a non-loopback value requires SHARED_TRIP_ORIGIN |
| SHARED_TRIP_PORT | 4173 | Choose an unused listen port |
| SHARED_TRIP_ORIGIN | Local listen origin | External HTTPS origin behind a proxy; no credentials, path, query, or fragment |

All trips share the manifest identity, start URL, and scope /. Trip pages are /trips/&lt;id&gt;. Every trip URL requires an owner or approved-account sign-in. Anonymous sharing, per-trip membership, self-registration that grants access, and OAuth are not implemented.

## Accounts and access

Every account has one role, `viewer` or `content-manager`. The owner is not an account: it signs in separately with the admin secret.

| Principal | How it authenticates | May do |
| --- | --- | --- |
| Owner | `Authorization: Bearer <admin secret>`, or browser **Owner sign-in** with that secret | Everything: trip content plus invitations, approve/revoke, role changes, access tokens, audit. MCP accepts the admin secret **only** as a bearer header, not an owner cookie. |
| Approved content manager | Browser username/password sign-in; for MCP, a separate owner-issued access token | Owner-like trip content work on **every** trip, current and future: read (including protected photos), export, create, edit, delete content, import, archive and restore. No account, invitation, role, token, security, or infrastructure administration. |
| Approved viewer | Browser username/password sign-in | Read and export **every** trip and its protected photos; sign out. No writes, import, account management, or MCP. |
| Pending or revoked account | Cannot sign in (403 access_denied) | Nothing |

Nobody can permanently purge a trip through the web or MCP; archiving is the removal path. Database restore, backups, secrets, the proxy and the host stay with the owner and whoever operates the server.

Onboarding is owner-controlled:

1. The owner creates an invitation (home page *Accounts* → **Create invitation**, or `POST /api/invitations`). The random single-use code is shown once, is stored only as a SHA-256 digest, and expires after 72 hours by default (1-168 hours allowed). It is unrelated to the admin secret.
2. The owner shares **only the invitation code**, privately. Never share the admin secret. Invitations are typed into a form; there is no invitation URL.
3. The invitee opens the home page, chooses *Have an invitation?*, and enters the code with a username and a password that they choose privately. This creates a **pending viewer** account and consumes the code. The owner never needs to know the password.
4. Optionally, the owner selects **Content manager** as the account's access level and saves it (`POST /api/users/<id>/role`). Invitations always start as viewers; only the owner can change a role.
5. The owner approves the account. Approval grants the role's access to **all** trips, current and future.
6. The owner can revoke an account or change its role at any time. Both immediately invalidate every active session of that account and every MCP access token issued for it. Reapproving a revoked account allows new sign-ins but never revives older sessions or tokens.

### MCP access tokens for content managers

A content manager's browser identity (username, password, role) persists until the owner changes or revokes it. MCP access is separate and expiring:

- Only the owner can list, issue, or revoke tokens, from the content manager's row on the home page (**Show assistant access**) or through the API below. Tokens can be issued only for approved content managers, never for viewers, and a content manager cannot issue one for themselves.
- Each token has a label, a fixed 90-day lifetime, and works **only** at `/mcp` as `Authorization: Bearer <token>`. It is not a browser sign-in and is refused by every `/api/*` route.
- The secret is returned exactly once. The home page shows it in a one-time box as plain text with explicit **Copy** and **Done, hide token** buttons. It is kept only in page memory, never in browser storage or a URL, is never copied automatically, and disappears on dismiss, Refresh, reload, sign-out, a revoke of that token or account, or a role change. A failed issuance is reported and never retried automatically; check the token list before issuing again.
- The owner configures the AI client: paste the secret only into a private, owner-controlled credential store. Never send it through chat or commit it.
- **Renew** before expiry: issue a replacement, update the client's private configuration, confirm it works, then revoke the old token. Revoke first instead if a token may have leaked. Nothing renews automatically.

Owner actions on accounts and tokens are recorded in an owner-only audit log (`GET /api/audit`). Entries are metadata only, never passwords, invitation codes, token secrets or trip payloads. The home page does not display the audit log.

Usernames are 3-32 characters of lowercase letters, digits, `.`, `_` or `-`, starting with a letter or digit (input is trimmed and lowercased). Passwords are 10-128 characters, hashed with Node's built-in scrypt (`scrypt$N$r$p$salt$key`). Limits: 500 accounts, 50 unused unexpired invitations, 10 sessions per viewer.

Browser sessions are HttpOnly, SameSite=Strict cookies (`Secure` on HTTPS origins), held only in process memory. They expire after 12 hours, on sign-out, or when the service restarts or a restore runs; accounts themselves persist in SQLite. Every protected request re-reads the account, so approval state and role apply immediately. Same-origin checks protect cookie writes, sign-in, and invitation redemption; invalid Origin and Host headers are rejected. A presented but wrong bearer header never falls back to a cookie.

Sign-in failures are limited to 10 per minute and invalid invitation codes to 10 per 15 minutes, keyed by connection address; behind a reverse proxy all clients share the proxy's address. Concurrent password hashing is bounded; excess attempts return 429.

## HTTP interface

Domain responses are JSON with Cache-Control: no-store. Errors use `{ "error": { "code", "message" } }`.

| Method | Path | Who | Input / result |
| --- | --- | --- | --- |
| POST | /api/login | public, same origin | `{token}` (owner) or `{username, password}` (account); returns `{authenticated, role[, username]}` and a session cookie |
| POST | /api/accept-invite | public, same origin | `{invitation, username, password}`; 201 `{account: {username, status: "pending"}}` (role `viewer`) |
| GET | /api/session | signed in | `{authenticated, role[, username], capabilities: {readTrips, exportTrips, editTrips, importTrips, manageAccounts, mcp}}`; `role` is `owner`, `viewer`, or `content-manager` |
| POST | /api/logout | signed in | Revokes this session |
| GET | /api/trips | owner, manager, viewer | Summaries, including archived trips |
| GET | /api/trips/&lt;id&gt; | owner, manager, viewer | Full trip and version |
| GET | /api/trips/&lt;id&gt;/export | owner, manager, viewer | Recoverable versioned JSON |
| POST | /api/trips | owner, manager | requestId, trip; returns trip |
| POST | /api/trips/&lt;id&gt;/changes | owner, manager | requestId, expectedVersion, changes; returns trip and generated IDs |
| POST | /api/import | owner, manager | requestId, data; returns trip and mapping warnings |
| POST | /api/invitations | owner | Optional `{expiresInHours}`; 201 `{invitation: {id, token, expiresAt}}` (token shown once) |
| GET | /api/users | owner | `{accounts: [{id, username, status, role, createdAt, updatedAt}], invitations: [{id, createdAt, expiresAt}]}` (unused, unexpired only) |
| POST | /api/users/&lt;id&gt;/approve | owner | `{account}` |
| POST | /api/users/&lt;id&gt;/revoke | owner | `{account}`; ends that account's sessions and MCP tokens |
| POST | /api/users/&lt;id&gt;/role | owner | `{role: "viewer" \| "content-manager"}`; returns `{account}`; ends that account's sessions and MCP tokens |
| GET | /api/users/&lt;id&gt;/mcp-tokens | owner | `{tokens: [{id, label, createdAt, expiresAt, revokedAt, lastUsedAt}]}`; never secrets |
| POST | /api/users/&lt;id&gt;/mcp-tokens | owner | `{label}` for an approved content manager; returns `{token: {id, label, createdAt, expiresAt}, secret}` once; fixed 90-day lifetime |
| POST | /api/users/&lt;id&gt;/mcp-tokens/&lt;tokenId&gt;/revoke | owner | Returns `{token}` metadata |
| GET | /api/audit | owner | Optional `?limit=`; `{events: [...]}` metadata only, no secrets or payloads |
| GET, HEAD | /photos/&lt;name&gt; | owner, manager, viewer | Private photo file (see [Private photos](#private-photos)) |
| POST | /mcp | owner admin bearer, or content-manager access token | See [mcp.md](mcp.md). Cookies are refused. |

Error codes: 401 `unauthorized` (missing or invalid credentials); 403 `forbidden` (role not permitted), `forbidden_origin`, `forbidden_host`, `access_denied` (pending or revoked account signing in), `invitation_invalid` (invalid, used, or expired code); 404 `account_not_found`; 409 `username_unavailable`, `too_many_invitations`, `too_many_accounts`; 422 `validation_failed`; 429 `rate_limited`. A route not listed for a role is refused for that role; account, invitation, role, token, and audit routes are owner-only.

GET /health reports generic health only. Bodies are limited to 2 MB (8 KB for sign-in, invitation, and redemption); canonical content is bounded to 31 days, 80 plans per day, 80 reminders, and 100 operations per batch. Optional photos, translations, recommendations, and dates do not block a draft.

| Change type | Fields |
| --- | --- |
| update_trip | fields containing writable metadata |
| upsert_day | day, with an existing id or no id for creation |
| delete_day | dayId |
| upsert_plan | dayId, plan; existing IDs can move between dates |
| delete_plan | dayId, planId |
| upsert_reminder | reminder; omit id for creation |
| delete_reminder | reminderId |
| archive_trip | archived boolean |
| replace_content | Full snapshot with matching id and version |

See [input-schema.md](input-schema.md) for content fields. Upserts merge existing values; null removes optional fields. IDs never change. Archived trips remain readable/exportable and must be restored before editing.

HTTP and MCP call the same TripService and validators. A batch commits completely or rolls back. Stale versions return 409/version_conflict. Repeating an identical requestId and payload returns its original result, including after a restart; changed payloads return 409/request_id_conflict. Source edits invalidate unchanged dependent translations. Time edits reconcile sort metadata and actual ordering.

## Private photos

The self-hosted photo store is `<SHARED_TRIP_DATA_DIR>/photos`, outside the source tree and every public directory. Put approved images there as flat files named `[A-Za-z0-9][A-Za-z0-9_-]*` with a `.webp`, `.png`, `.jpg`, or `.jpeg` extension, and reference them from trip content with root-relative URLs such as `/photos/harbor-walk.webp`.

`GET`/`HEAD /photos/<name>` requires an owner, approved content-manager, or approved-viewer session and returns the file with `Cache-Control: no-store`. Anything else (subdirectories, other types, files resolving outside the store, missing files) returns a generic 404 after the access check. Every role can only read photos over HTTP. There is no upload or attachment store: `/attachments/*` always returns 404 after the access check. Database snapshots do not include photos; back the directory up separately.

`/photos/manifest.js` is the public, generic, empty-by-default module used by the shared template. Never put private filenames or mappings into it. The legacy generator and the fictional `docs/` demo keep their existing generated photo assets unchanged.

Responses send `Referrer-Policy: strict-origin-when-cross-origin`, so third-party requests such as map tiles receive only the site origin, never private trip paths. OpenStreetMap tile use is subject to https://operations.osmfoundation.org/policies/tiles/; tile availability is not guaranteed by this service.

## Synchronization and connection failures

Trip pages poll every 20 seconds. Errors use bounded retries; Reconnect and online/focus/visibility events resume them. Home lists also refresh. An open page retains authenticated content in memory during brief outages; fresh offline navigation shows a generic connection page. A revoked account's next refresh, or the next refresh after its role changes, returns 401, which clears the page.

Protected payloads never enter persistent browser storage or the service-worker cache. Offline writes fail explicitly; there is no offline queue. Editors retain their opening version to reject later conflicting changes. After an uncertain response, reconnect and read before editing again.

Sign-out clears content and revokes the session. During an outage, a non-secret pending-sign-out marker blocks protected reads until revocation or a new explicit sign-in; other pages respond to that marker. When browser storage is unavailable, failed sign-out shows a retry control. Passwords and invitation codes stay in form fields and are cleared after submission. A newly issued MCP token secret exists only in the owner's open page until dismissed (see [MCP access tokens](#mcp-access-tokens-for-content-managers)).

## Import and export

Import accepts structured authoring JSON, a runtime trip object, or a shared-trip-export file. Compatible IDs and localization are retained. Available incoming trip IDs are preserved; importing again creates another trip rather than overwriting. Retrying the same requestId creates nothing twice. The owner and approved content managers can import; every approved role can export. The same import and export are also available as the MCP tools `import_trip` and `export_trip`, sharing validation and storage with HTTP.

Safe unmapped fields are retained in compatibility content and reported. Legacy transport configuration is inert; import never contacts Firebase. Validation errors reject the whole import. Export restores content, IDs, versions, and archive state into empty storage. Database snapshots also retain retry records and account state.

## Deploy on a small VPS

Deployment is a separate user action. The [Docker Compose + Caddy template](../deploy/README.md) is the reusable recipe: the app has no host port on an internal network, Caddy publishes only 80/443 with automatic HTTPS, and protected paths get CDN no-store headers. npm start is the local development path.

To use an existing HTTPS reverse proxy instead:

~~~bash
docker build -t shared-trips .
docker run --name shared-trips --restart unless-stopped \
  --env-file /absolute/private/shared-trips.env \
  -p 127.0.0.1:4173:4173 \
  -v /absolute/private/trip-data:/data \
  shared-trips
~~~

The private env file supplies the admin secret and SHARED_TRIP_ORIGIN=https://trips.example.org. The image listens internally on port 4173 and stores data (and private photos in /data/photos) in /data. Prepare the private mount for container UID 1000 on local storage; keep backups separate. Choose another host port if needed.

Add a dedicated virtual host that preserves Host, Origin, Authorization, and Cookie headers, passes MCP POST/202 responses without buffering, adds no-store CDN headers for `/api/*`, `/mcp`, `/trips/*`, `/photos/*`, `/attachments/*`, and `/resources.html`, and forwards to the chosen loopback port. Preserve other services' configuration. No OAuth provider, Firebase account, or live AI call is required for normal use.

Stop/restart with docker stop shared-trips and docker start shared-trips. Replace containers while retaining the data mount and private configuration. SIGINT/SIGTERM close cleanly. After a crash, SIGKILL, OOM kill, or power loss the OS releases [data-directory ownership](#data-directory-ownership), so a restart policy can start the service again without deleting files.

## Backup and restore

~~~bash
SHARED_TRIP_DATA_DIR=/absolute/private/trip-data npm run backup -- /absolute/private/backups/trips-<timestamp>.sqlite
SHARED_TRIP_DATA_DIR=/absolute/private/restored-data npm run restore -- /absolute/private/backups/trips-<timestamp>.sqlite
~~~

Backup uses SQLite's online backup API and validates the snapshot; it can run while the service is active and does not take ownership. Targets must not already exist, so snapshots are never overwritten. Copying a live SQLite main file alone is not this method. A snapshot contains trips, IDs, versions, archive state, retry records, accounts (password hashes, status and role), invitation digests, MCP access-token records, and the audit log: store it as a secret. Photos are not included. Same-server snapshots are not off-site protection.

Restore takes data-directory ownership before writing anything and holds it for the whole operation: it validates and migrates a staging replacement, validates it again, snapshots an existing target (`shared-trip.sqlite.before-restore-<time>`), and swaps it in. If a running service or another restore owns the directory, restore exits without touching the target. First restore into separate storage and compare IDs, versions, content, and accounts.

Restoring signs everyone out. The account state is the snapshot's: accounts revoked after the snapshot become approved again, role changes made after it are undone, MCP tokens revoked after it become valid again until they expire, and invitations redeemed after it become usable again until they expire. Review *Accounts* and each content manager's tokens immediately after a restore, and revoke or change roles again as needed.

Run maintenance commands with Node 24 and private storage access. The container also contains server/cli/backup.mjs and server/cli/restore.mjs; mount a separate backup directory when running them in a maintenance container.

### Data-directory ownership

The service and restore claim a data directory through two files:

- `server-ownership.sqlite`: the authority. A persistent, normally zero-byte SQLite database, separate from `shared-trip.sqlite`. The owner opens it in rollback-journal mode and keeps a `BEGIN EXCLUSIVE` transaction open for its lifetime without writing. That is an OS-held byte-range lock, which the OS releases when the process exits for any reason. While an owner holds it, `server-ownership.sqlite-journal` also exists; after a hard kill it may remain and is cleaned up by SQLite on the next acquisition. Never delete or edit either file.
- `server.lock`: a compatibility marker whose first line is the owner's PID (so older PID-lock releases refuse to start) and whose second line tags it as a `shared-trip-ownership-v1` marker for this ownership database. It is created, replaced, or removed only while the SQLite lock is held; it is never treated as ownership.

Behavior:

- A second service or restore fails immediately ("in use by another running service or restore") and changes nothing.
- A clean shutdown or completed restore removes its own marker and releases the lock.
- After an abnormal exit, the next process acquires the lock and atomically replaces the stale marker it can attribute to this ownership database. No PID liveness check and no file deletion are involved.
- A foreign marker, an empty or unknown `server.lock`, or a legacy PID-only lock is refused and left unchanged.

Recovering a refused foreign or legacy lock:

1. Stop every service and restore that uses this data directory, including other containers and any other host sharing the storage. Confirm with docker ps (or your process list) that none is running.
2. Delete **only** that specific `server.lock`. Never delete `server-ownership.sqlite` or its journal.
3. Start the service (or rerun restore) and verify reading and editing.

Never run older and newer releases against one data directory. Upgrading from a PID-lock release: stop it and every restore first; a graceful stop removes its lock. Rolling back to such a release: stop every newer process first; a marker left by a crashed newer process is refused by older releases and must be removed manually as above after verification.

Use local storage. SQLite locking and hard links are required; network filesystems and some VM/container shared folders do not provide them reliably and are not supported. On Windows, the OS may take a moment to release a killed process's lock under heavy load, so an immediate restart can be refused once and should be retried.

## Upgrades and rollback

Schemas use PRAGMA user_version:

- v1: the prior prototype layout.
- v2: maps days.plans to days.slots, normalizes compatible content, and adds an archive index.
- v3: adds the `users` and `invitations` tables. Trip rows, IDs, versions, archive state, and retry records are untouched.
- The content-manager release adds the account role, MCP access-token records, and the audit log in a further schema version. Existing accounts migrate as `viewer`, so nobody gains write access by upgrading; the owner promotes accounts explicitly afterwards. Trips and existing accounts are otherwise untouched. The exact schema number is recorded with that release's server change.

Before migrating an older database, the service writes a snapshot named for the target schema, such as `shared-trip.sqlite.before-v3-<time>`, beside it with VACUUM INTO and never deletes it automatically. The migration runs in one transaction. Newer-than-supported schemas are rejected ("Database requires a newer application").

Back up before upgrading. Stop the service and any restore, replace its image/code while retaining data/configuration, restart, and verify reading, editing, viewer sign-in and, if used, content-manager sign-in and MCP. Test fictional prior-version data first. To roll back across a schema change, stop the new service and restore the pre-upgrade snapshot into separate storage for the old code; never open a newer schema with older code. Accounts, role changes and MCP tokens created after the upgrade are not in that snapshot; an older release has no content-manager role, so its accounts are viewers again and every issued MCP access token stops working (only the admin bearer remains).

## Verification and limits

Run npm test for regression, HTTP/MCP integration, account and ownership checks, and DOM simulation. The [implementation plan](../doc/implementation-plan.md) and progress reports record which checks actually ran.

The official MCP SDK was tested over local HTTP. `scripts/test-content-manager-ui.mjs` is a DOM simulation of the content-manager home page and the owner's role and token controls; consult the progress reports for whether it has been run. The existing live HTTPS trial predates content managers and MCP access tokens, so those have no live evidence. DOM simulation does not establish desktop/phone layout, map gestures, live weather/maps, physical installation, or third-party AI account connections. Crash recovery of the ownership lock under Linux and in containers, Docker builds, and a real VPS deployment require their own environment checks.
