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
| SHARED_TRIP_ORIGIN | Local listen origin | External HTTPS origin behind a proxy; no credentials, path, query, or fragment. It is also the OAuth issuer. |
| SHARED_TRIP_OAUTH_USERNAME | Unset (OAuth denied) | Username of the one approved content manager who may approve OAuth grants for MCP clients that cannot send custom headers (schema v5 release). See [mcp.md § OAuth](mcp.md#oauth-for-clients-without-custom-headers). |
| SHARED_TRIP_LOOKUPS_ENABLED | Unset (off) | `1` enables explicit public place (OpenStreetMap/Nominatim) and photo (Wikimedia Commons) search in the plan editor. See [Place and photo lookups](#place-and-photo-lookups-opt-in). |
| SHARED_TRIP_LOOKUP_USER_AGENT | None | Required when lookups are enabled: application name and version plus the owner's contact email or URL |
| SHARED_TRIP_NOMINATIM_URL | `https://nominatim.openstreetmap.org/search` when enabled | Optional HTTPS Nominatim-compatible search endpoint |

All trips share the manifest identity, start URL, and scope /. Trip pages are /trips/&lt;id&gt;. Every trip URL requires an owner or approved-account sign-in. Anonymous sharing, per-trip membership, and self-registration that grants access are not implemented. OAuth exists only as the scoped MCP path for one configured content manager; it is not a general sign-in or account-enrollment method.

## Accounts and access

Every account has one role, `viewer` or `content-manager`. The owner is not an account: it signs in separately with the admin secret.

| Principal | How it authenticates | May do |
| --- | --- | --- |
| Owner | `Authorization: Bearer <admin secret>`, or browser **Owner sign-in** with that secret | Everything: trip content, permanent trip deletion (HTTP only), invitations, approve/revoke, role changes, access tokens, audit. MCP accepts the admin secret **only** as a bearer header, not an owner cookie. |
| Approved content manager | Browser username/password sign-in; for MCP, a separate owner-issued access token, or an OAuth grant if this account is the one named by `SHARED_TRIP_OAUTH_USERNAME` | Owner-like trip content work on **every** trip, current and future: read (including protected photos), export, create, edit, delete content, import, archive and restore. No account, invitation, role, token, OAuth-grant, security, or infrastructure administration. |
| Approved viewer | Browser username/password sign-in | Read and export **every** trip and its protected photos; sign out. No writes, import, account management, or MCP. |
| Pending or revoked account | Cannot sign in (403 access_denied) | Nothing |

Only the owner can permanently delete a trip (schema v6): with the owner browser session or the admin bearer through `DELETE /api/trips/<id>`, or as a host operator with the [offline CLI](#offline-trip-deletion-host-operator). Content managers, viewers, MCP access tokens, and OAuth grants cannot delete trips. No MCP tool or change operation deletes a trip, even with the admin secret. For everyone else, archiving is still the way to remove a trip. Database restore, backups, secrets, the proxy and the host stay with the owner and whoever operates the server.

### Permanent trip deletion

`DELETE /api/trips/<id>` takes `{requestId, expectedVersion}`. The trip ID comes only from the path. Active and archived trips can be deleted. One transaction does all of the following, or nothing:

- removes the trip row;
- writes a content-free tombstone (stable trip ID, deleted version, deletion time);
- rewrites every retry record that could return the trip's content (its change results, and the create or import result that produced it) to minimal deletion metadata, keeping the request ID and fingerprint;
- stores the deletion's own minimal result;
- appends a payload-free `trip.delete` audit event. If the audit write fails, the whole deletion rolls back.

Results and errors:

- Success returns 200 `{deleted: true, tripId, version}`, where `version` is the deleted version.
- A stale `expectedVersion` returns 409 `version_conflict` with `currentVersion`.
- Repeating the identical request returns the same success, including after a restart.
- Reusing the request ID with a different trip or version returns 409 `request_id_conflict`.
- Afterwards, reads, exports, edits and new deletions of that ID return 410 `trip_deleted`.
- Replaying an earlier create, import or change request for the trip also returns 410 `trip_deleted`, so stale retries cannot return deleted content or recreate the trip.
- An import whose preferred ID is tombstoned gets a fresh ID with the usual collision warning.

Owner-session deletions need the same Origin as other cookie writes. Non-owner sessions get 403. MCP access tokens and OAuth tokens keep their wrong-route 401.

What deletion does **not** remove:

- Earlier database snapshots, pre-migration and pre-restore copies, exports, and copies held by people who exported the trip. They still contain the trip until you destroy them yourself. Restoring such a snapshot brings the trip back.
- Photos in `<SHARED_TRIP_DATA_DIR>/photos`. That store is shared between trips and is never cleaned up automatically. Delete unreferenced files by hand if you need to.
- Audit metadata (trip ID, request ID, version, actor, time).

SQLite runs with `secure_delete` on, so freed pages in the database file are overwritten. Fragments can still remain in the write-ahead log until SQLite checkpoints it, and in filesystem or storage copies. Treat the data directory as private even after deleting a trip.

Onboarding is owner-controlled:

1. The owner creates an invitation (home page *Accounts* → **Create invitation**, or `POST /api/invitations`). The random single-use code is shown once, is stored only as a SHA-256 digest, and expires after 72 hours by default (1-168 hours allowed). It is unrelated to the admin secret.
2. The owner shares **only the invitation code**, privately. Never share the admin secret. Invitations are typed into a form; there is no invitation URL.
3. The invitee opens the home page, chooses *Have an invitation?*, and enters the code with a username and a password that they choose privately. This creates a **pending viewer** account and consumes the code. The owner never needs to know the password.
4. Optionally, the owner selects **Content manager** as the account's access level and saves it (`POST /api/users/<id>/role`). Invitations always start as viewers; only the owner can change a role.
5. The owner approves the account. Approval grants the role's access to **all** trips, current and future.
6. The owner can revoke an account or change its role at any time. Both immediately invalidate every active session of that account, every MCP access token issued for it, and every OAuth grant it approved. Reapproving a revoked account allows new sign-ins but never revives older sessions, tokens, or grants.

### MCP access tokens for content managers

A content manager's browser identity (username, password, role) persists until the owner changes or revokes it. MCP access is separate and expiring:

- Only the owner can list, issue, or revoke tokens, from the content manager's row on the home page (**Show assistant access**) or through the API below. Tokens can be issued only for approved content managers, never for viewers, and a content manager cannot issue one for themselves.
- Each token has a label, a fixed 90-day lifetime, and works **only** at `/mcp` as `Authorization: Bearer <token>`. It is not a browser sign-in and is refused by every `/api/*` route.
- The secret is returned exactly once. The home page shows it in a one-time box as plain text with explicit **Copy** and **Done, hide token** buttons. It is kept only in page memory, never in browser storage or a URL, is never copied automatically, and disappears on dismiss, Refresh, reload, sign-out, a revoke of that token or account, or a role change. A failed issuance is reported and never retried automatically; check the token list before issuing again.
- The owner configures the AI client: paste the secret only into a private, owner-controlled credential store. Never send it through chat or commit it.
- **Renew** before expiry: issue a replacement, update the client's private configuration, confirm it works, then revoke the old token. Revoke first instead if a token may have leaked. Nothing renews automatically.

### OAuth grants (schema v5 release)

For MCP clients that cannot accept a custom header, such as ChatGPT, the account named by `SHARED_TRIP_OAUTH_USERNAME` can approve an OAuth grant. It must be an approved content manager. To approve, the account holder signs in explicitly at `/oauth/authorize` and consents; denial is equally explicit. The grant carries the same content-manager rights over the six MCP tools, works only at `/mcp`, and lasts at most 90 days from consent, with no extension by refresh. The owner lists and revokes grants through `GET /api/users/<id>/oauth-grants` and `POST /api/users/<id>/oauth-grants/<grantId>/revoke`. Both return metadata only. If the variable is unset, no grant can be approved. Endpoints, metadata, and connection steps are in [mcp.md § OAuth](mcp.md#oauth-for-clients-without-custom-headers).

The owner can also list and revoke OAuth grants in **Accounts → Show assistant access → Browser connections (OAuth)**. Grant revocation leaves the account's web access and separate credentials intact.

Owner actions on accounts, tokens, OAuth grants and trip deletions are recorded in an owner-only audit log (`GET /api/audit`), as are content writes. Entries are metadata only, never passwords, invitation codes, token secrets or trip payloads. Channel `operator` (actor `operator`) marks offline host-operator CLI actions. The home page does not display the audit log.

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
| POST | /api/trips/&lt;id&gt;/places/search | owner, manager (same origin) | Only when lookups are enabled. `{query, refresh?}`; returns `{results, cached}`. Changes nothing. See [Place and photo lookups](#place-and-photo-lookups-opt-in) |
| POST | /api/trips/&lt;id&gt;/photos/search | owner, manager (same origin) | Only when lookups are enabled. `{query, refresh?}`; returns `{results, cached}`. Changes nothing |
| DELETE | /api/trips/&lt;id&gt; | owner (session or admin bearer) | `{requestId, expectedVersion}`; permanent; returns `{deleted: true, tripId, version}`. See [Permanent trip deletion](#permanent-trip-deletion) |
| POST | /api/invitations | owner | Optional `{expiresInHours}`; 201 `{invitation: {id, token, expiresAt}}` (token shown once) |
| GET | /api/users | owner | `{accounts: [{id, username, status, role, createdAt, updatedAt}], invitations: [{id, createdAt, expiresAt}]}` (unused, unexpired only) |
| POST | /api/users/&lt;id&gt;/approve | owner | `{account}` |
| POST | /api/users/&lt;id&gt;/revoke | owner | `{account}`; ends that account's sessions and MCP tokens |
| POST | /api/users/&lt;id&gt;/role | owner | `{role: "viewer" \| "content-manager"}`; returns `{account}`; ends that account's sessions and MCP tokens |
| GET | /api/users/&lt;id&gt;/mcp-tokens | owner | `{tokens: [{id, label, createdAt, expiresAt, revokedAt, lastUsedAt}]}`; never secrets |
| POST | /api/users/&lt;id&gt;/mcp-tokens | owner | `{label}` for an approved content manager; returns `{token: {id, label, createdAt, expiresAt}, secret}` once; fixed 90-day lifetime |
| POST | /api/users/&lt;id&gt;/mcp-tokens/&lt;tokenId&gt;/revoke | owner | Returns `{token}` metadata |
| GET | /api/users/&lt;id&gt;/oauth-grants | owner | OAuth grant metadata; never token values |
| POST | /api/users/&lt;id&gt;/oauth-grants/&lt;grantId&gt;/revoke | owner | Revokes the grant and its tokens; returns metadata |
| GET | /.well-known/oauth-protected-resource[/mcp], /.well-known/oauth-authorization-server | public | OAuth metadata; see [mcp.md § OAuth](mcp.md#oauth-for-clients-without-custom-headers) |
| POST, GET | /oauth/register, /oauth/authorize, /oauth/token, /oauth/revoke | public client / eligible account | OAuth flow for the configured content manager only |
| GET | /api/audit | owner | Optional `?limit=`; `{events: [...]}` metadata only, no secrets or payloads |
| GET, HEAD | /photos/&lt;name&gt; | owner, manager, viewer | Private photo file (see [Private photos](#private-photos)) |
| POST | /mcp | owner admin bearer, content-manager access token, or OAuth access token | See [mcp.md](mcp.md). Cookies are refused. |

Error codes: 401 `unauthorized` (missing or invalid credentials); 403 `forbidden` (role not permitted), `forbidden_origin`, `forbidden_host`, `access_denied` (pending or revoked account signing in), `invitation_invalid` (invalid, used, or expired code); 404 `account_not_found`, `trip_not_found`; 409 `username_unavailable`, `too_many_invitations`, `too_many_accounts`, `version_conflict`, `request_id_conflict`; 410 `trip_deleted` (permanently deleted trip, or a stale retry of a request for it); 422 `validation_failed`; 429 `rate_limited`. A route not listed for a role is refused for that role; account, invitation, role, token, audit, and trip-deletion routes are owner-only.

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

See [input-schema.md](input-schema.md) for content fields, including the selected OpenStreetMap `place` and Commons `photo` objects. Upserts merge existing values; null removes optional fields. IDs never change. Archived trips remain readable/exportable and must be restored before editing.

HTTP and MCP call the same TripService and validators. A batch commits completely or rolls back. Stale versions return 409/version_conflict. Repeating an identical requestId and payload returns its original result, including after a restart; changed payloads return 409/request_id_conflict. Source edits invalidate unchanged dependent translations. Time edits reconcile sort metadata and actual ordering.

## Private photos

The self-hosted photo store is `<SHARED_TRIP_DATA_DIR>/photos`, outside the source tree and every public directory. Put approved images there as flat files named `[A-Za-z0-9][A-Za-z0-9_-]*` with a `.webp`, `.png`, `.jpg`, or `.jpeg` extension, and reference them from trip content with root-relative URLs such as `/photos/harbor-walk.webp`.

`GET`/`HEAD /photos/<name>` requires an owner, approved content-manager, or approved-viewer session and returns the file with `Cache-Control: no-store`. Anything else (subdirectories, other types, files resolving outside the store, missing files) returns a generic 404 after the access check. Every role can only read photos over HTTP. There is no upload or attachment store: `/attachments/*` always returns 404 after the access check. Database snapshots do not include photos; back the directory up separately. Photos can be referenced by several trips, so deleting a trip never deletes photo files.

`/photos/manifest.js` is the public, generic, empty-by-default module used by the shared template. Never put private filenames or mappings into it. The legacy generator and the fictional `docs/` demo keep their existing generated photo assets unchanged.

Responses send `Referrer-Policy: strict-origin-when-cross-origin`, so third-party requests such as map tiles receive only the site origin, never private trip paths. OpenStreetMap tile use is subject to https://operations.osmfoundation.org/policies/tiles/; tile availability is not guaranteed by this service.

A Commons photo chosen in the editor is a remote image with saved attribution. It is not copied into this store, and there is no upload or mirroring API for it.

## Place and photo lookups (opt-in)

Off by default. With `SHARED_TRIP_LOOKUPS_ENABLED=1` and a valid `SHARED_TRIP_LOOKUP_USER_AGENT`, owners and content managers can press **Search** in the plan editor to look up a public place through Nominatim, choose the exact candidate, separately search Wikimedia Commons for a representative photo, and save both as snapshots in the plan. The full contract and the provider review are in [place-and-photo-lookups.md](place-and-photo-lookups.md). The main points are:

- **Explicit only.** No autocomplete, no background refresh, no bulk or periodic lookups. **Cancel** changes nothing. **Save** uses the existing versioned content-change path with `expectedVersion` and `requestId`.
- **No lookups on display.** Opening the editor or a trip page, reloading, polling and unrelated edits render the saved snapshots and make no place or photo search calls. Displaying saved remote images and map tiles still makes normal browser requests to those hosts.
- **Who.** Owner and content managers only, with the usual same-origin checks. Viewers cannot search or spend upstream requests. No role gains any new privilege.
- **Outbound.** The server contacts only the configured Nominatim endpoint and the Commons API. It sends one request at a time, at least 1,100 ms apart, with timeouts and size limits, never to a client-supplied URL, and it does not follow redirects. Query text goes to the provider, so do not search for confidential material.
- **Cache.** Successful results are cached privately, with bounded size, under `SHARED_TRIP_DATA_DIR`. **Refresh** bypasses the cache. The cache is non-essential and can be discarded; saved snapshots in SQLite are the trip content.
- **Costs and terms.** The default public endpoints need no API key, billing or account, but they come with no SLA and their usage policies apply. Review them before enabling, and choose an endpoint whose terms allow retaining results. Enabling the feature creates no credentials.
- **Google.** The new search does not use Google. Full Google Maps place URLs keep working as before.

## Synchronization and connection failures

Trip pages poll every 20 seconds. Errors use bounded retries; Reconnect and online/focus/visibility events resume them. Home lists also refresh. An open page retains authenticated content in memory during brief outages; fresh offline navigation shows a generic connection page. A revoked account's next refresh, or the next refresh after its role changes, returns 401, which clears the page.

Protected payloads never enter persistent browser storage or the service-worker cache. The service worker must also never cache `/oauth/*` or `/.well-known/oauth-*` responses. Offline writes fail explicitly; there is no offline queue. Editors retain their opening version to reject later conflicting changes. After an uncertain response, reconnect and read before editing again.

Sign-out clears content and revokes the session. During an outage, a non-secret pending-sign-out marker blocks protected reads until revocation or a new explicit sign-in; other pages respond to that marker. When browser storage is unavailable, failed sign-out shows a retry control. Passwords and invitation codes stay in form fields and are cleared after submission. A newly issued MCP token secret exists only in the owner's open page until dismissed (see [MCP access tokens](#mcp-access-tokens-for-content-managers)). OAuth tokens are delivered only to the registered client and are never shown in the app.

## Import and export

Import accepts structured authoring JSON, a runtime trip object, or a shared-trip-export file. Compatible IDs and localization are retained. Available incoming trip IDs are preserved; importing again creates another trip rather than overwriting. Retrying the same requestId creates nothing twice. The owner and approved content managers can import; every approved role can export. The same import and export are also available as the MCP tools `import_trip` and `export_trip`, sharing validation and storage with HTTP.

Safe unmapped fields are retained in compatibility content and reported. Legacy transport configuration is inert; import never contacts Firebase. Selected `place` and `photo` snapshots travel with import and export unchanged. Neither operation performs a place or photo lookup. Validation errors reject the whole import. Export restores content, IDs, versions, and archive state into empty storage. Database snapshots also retain retry records and account state.

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

The private env file supplies the admin secret and SHARED_TRIP_ORIGIN=https://trips.example.org, and, only when you want OAuth, SHARED_TRIP_OAUTH_USERNAME=&lt;approved-content-manager-username&gt;. Add the lookup settings only after reviewing [place-and-photo-lookups.md](place-and-photo-lookups.md). Lookups also need outbound HTTPS from the container. The image listens internally on port 4173 and stores data (and private photos in /data/photos) in /data. Prepare the private mount for container UID 1000 on local storage; keep backups separate. Choose another host port if needed.

Add a dedicated virtual host that preserves Host, Origin, Authorization, and Cookie headers, passes MCP POST/202 responses without buffering, adds no-store CDN headers for `/api/*`, `/mcp`, `/oauth/*`, `/.well-known/oauth-*`, `/trips/*`, `/photos/*`, `/attachments/*`, and `/resources.html`, and forwards to the chosen loopback port. Do not rewrite or redirect the OAuth paths, because the issuer and resource must match the origin exactly. Preserve other services' configuration. The OAuth server is built in, so no external OAuth provider is needed. Normal use needs no Firebase account and no live AI call.

Stop/restart with docker stop shared-trips and docker start shared-trips. Replace containers while retaining the data mount and private configuration. SIGINT/SIGTERM close cleanly. After a crash, SIGKILL, OOM kill, or power loss the OS releases [data-directory ownership](#data-directory-ownership), so a restart policy can start the service again without deleting files.

## Backup and restore

~~~bash
SHARED_TRIP_DATA_DIR=/absolute/private/trip-data npm run backup -- /absolute/private/backups/trips-<timestamp>.sqlite
SHARED_TRIP_DATA_DIR=/absolute/private/restored-data npm run restore -- /absolute/private/backups/trips-<timestamp>.sqlite
~~~

Backup uses SQLite's online backup API and validates the snapshot; it can run while the service is active and does not take ownership. Targets must not already exist, so snapshots are never overwritten. Copying a live SQLite main file alone is not this method. A snapshot contains trips, IDs, versions, archive state, retry records, deletion tombstones (schema v6), accounts (password hashes, status and role), invitation digests, MCP access-token records, OAuth client registrations and grant records with token digests (schema v5), and the audit log: store it as a secret. Photos are not included. Same-server snapshots are not off-site protection. A snapshot taken before a trip was deleted still contains that trip.

Restore takes data-directory ownership before writing anything and holds it for the whole operation: it validates and migrates a staging replacement, validates it again, snapshots an existing target (`shared-trip.sqlite.before-restore-<time>`), and swaps it in. If a running service or another restore owns the directory, restore exits without touching the target. First restore into separate storage and compare IDs, versions, content, and accounts.

Restoring signs everyone out. The account state is the snapshot's: accounts revoked after the snapshot become approved again, role changes made after it are undone, MCP tokens revoked after it become valid again until they expire, and invitations redeemed after it become usable again until they expire. OAuth grants also return to their state at snapshot time. A grant revoked after the snapshot can work again until its absolute expiry. A client whose refresh token rotated after the snapshot has to reconnect and consent again. Immediately after a restore, review *Accounts*, each content manager's tokens, and the OAuth grants, then revoke or change roles again as needed.

Run maintenance commands with Node 24 and private storage access. The container also contains server/cli/backup.mjs, server/cli/restore.mjs and server/cli/delete-trip.mjs; mount a separate backup directory when running them in a maintenance container.

### Offline trip deletion (host operator)

An authorized host operator can delete a trip without handling the owner's admin secret:

~~~bash
SHARED_TRIP_DATA_DIR=/absolute/private/trip-data npm run delete-trip -- <trip-id> <expected-version> <request-id> /absolute/private/backups/before-delete-<timestamp>.sqlite
~~~

The command reads only `SHARED_TRIP_DATA_DIR` and never the admin secret or any other credential setting, and it generates no credentials. It runs these steps in order:

1. Takes [data-directory ownership](#data-directory-ownership). It refuses, changing nothing, while the service, a restore or another maintenance command uses the directory, so stop the service first.
2. Writes the new private snapshot to the given file, which must not exist and must be outside the checkout, and validates it. Nothing is deleted unless this succeeds.
3. Applies any pending schema migration, with its own validated snapshot.
4. Deletes through the same gateway and domain logic as `DELETE /api/trips/<id>`: the same exact version check, tombstone, retry-record redaction and audit rollback.

The audit event uses actor and channel `operator`. Running it again with the same trip, version and request ID (and another new backup file), after an interruption or restart, reports the earlier deletion without changing anything. The web endpoint replays the same request ID too. Output is one fixed message without trip content, paths or environment values. Read the trip's current version from the app or an export before running it. Keep or destroy the backup deliberately, because it still contains the trip.

### Data-directory ownership

The service, restore and the offline delete-trip command claim a data directory through two files:

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
- v4: the content-manager release adds the account role, MCP access-token records, and the audit log. Existing accounts migrate as `viewer`, so nobody gains write access by upgrading; the owner promotes accounts explicitly afterwards. Trips and existing accounts are otherwise untouched.
- v5: the OAuth release adds OAuth client, grant, and token-digest tables. It only adds to the schema. Trips, accounts, roles, content-manager tokens, and the audit log are untouched, and OAuth stays denied until `SHARED_TRIP_OAUTH_USERNAME` is set.
- v6: the owner-deletion release adds the empty `trip_tombstones` table only (trip ID, deleted version, deletion time). Every existing trip, retry record, account, credential, OAuth grant and audit row is untouched. The audit log gains the `trip.delete` action and the `operator` channel.

The place and photo lookup feature adds only optional JSON fields to trip content (`plan.place` and the extended Commons `plan.photo`). No schema migration is planned for it. A release that predates these fields may reject edits or imports of trips that contain them, so export affected trips before rolling back across it.

Before migrating an older database, the service writes a snapshot named for the target schema, such as `shared-trip.sqlite.before-v3-<time>`, beside it with VACUUM INTO and never deletes it automatically. The migration runs in one transaction. Newer-than-supported schemas are rejected ("Database requires a newer application").

Back up before upgrading. Stop the service and any restore, replace its image/code while retaining data/configuration, restart, and verify reading, editing, viewer sign-in and, if used, content-manager sign-in, MCP tokens, and OAuth metadata and grants. Test fictional prior-version data first. To roll back across a schema change, stop the new service and restore the pre-upgrade snapshot into separate storage for the old code; never open a newer schema with older code. Accounts, role changes and MCP tokens created after the upgrade are not in that snapshot; an older release has no content-manager role, so its accounts are viewers again and every issued MCP access token stops working (only the admin bearer remains).

Rolling back from v5 to v4: keep the upgraded v5 directory untouched. It preserves trip writes and OAuth grants made after the upgrade, for analysis or a later roll-forward. Export any trip edited since the upgrade. Then restore the `before-v5` snapshot into separate storage, run the old image against that storage, and import the exports there if needed. The v4 release has no OAuth, so OAuth clients stop working while the other credentials keep working. If you roll forward to the kept v5 directory, its grants still apply until their absolute expiry.

Rolling back from v6 to v5 works the same way with the `before-v6` snapshot. That snapshot predates every deletion made after the upgrade, so trips deleted since then reappear in the v5 storage. Delete them again after rolling forward, or remove them from the rollback copy before use. The v5 release cannot read tombstones and has no deletion route.

## Verification and limits

Run npm test for regression, HTTP/MCP integration, account and ownership checks, and DOM simulation. The [implementation plan](../doc/implementation-plan.md) and progress reports record which checks actually ran.

The full suite includes content-manager and owner-control DOM simulations, plus local HTTP and official SDK OAuth/automatic-refresh tests. Fictional Chrome sign-in, consent, denial and owner revocation passed at desktop and phone widths. Production-image Linux tests, migration/restore and live HTTPS discovery/privacy checks also passed; see [checkpoint 008](../doc/Progress/progress_2026_10_15_cpx008_codex_b.md) and [checkpoint 009](../doc/Progress/progress_2026_10_15_cpx009_codex_b.md). Actual ChatGPT sign-in, consent and its first read-only tool result remain pending. Browser emulation does not establish physical installation, device gestures or third-party account connectivity. Earlier reports record separate ownership-lock crash recovery and deployment checks.

Place and photo lookup acceptance is recorded in [checkpoint 014](../doc/Progress/progress_2026_10_15_cpx014_codex_b.md): the full suite, local browser checks and separate public-provider requests passed. Automated suites use stubbed providers; production egress and deployment remain unverified for this feature.
