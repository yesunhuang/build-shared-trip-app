# Self-hosted multi-trip service

One Node 24 process serves the home page, every trip, the JSON API, and remote MCP. SQLite data lives outside the checkout. Adding a trip does not require a build, another backend, or Firebase.

## Run locally

~~~bash
npm ci
export SHARED_TRIP_ADMIN_TOKEN='<replace-with-a-random-secret-of-at-least-32-characters>'
export SHARED_TRIP_DATA_DIR="$HOME/.local/share/shared-trip"
npm start
~~~

Generate a secret with a password manager or Node crypto.randomBytes(32).toString('base64url'), and retain it privately for sign-in. Open http://127.0.0.1:4173/, sign in, and create a blank trip or import assets/trip.example.json. Use temporary storage for fictional checks.

| Setting | Default | Meaning |
| --- | --- | --- |
| SHARED_TRIP_ADMIN_TOKEN | Required | Administrator bearer secret, at least 32 characters |
| SHARED_TRIP_DATA_DIR | Required | Writable persistent directory outside the checkout |
| SHARED_TRIP_HOST | 127.0.0.1 | Listen interface |
| SHARED_TRIP_PORT | 4173 | Choose an unused listen port |
| SHARED_TRIP_ORIGIN | Local listen origin | External HTTPS origin behind a proxy; no credentials, path, query, or fragment |

All trips share the manifest identity, start URL, and scope /. Trip pages are /trips/&lt;id&gt;. Every trip URL requires administrator authentication; anonymous sharing and member roles are not implemented.

The browser exchanges the secret for an HttpOnly, SameSite=Strict session cookie. HTTPS origins use Secure cookies. Sessions expire after 12 hours or a service restart. API and MCP clients send Authorization: Bearer &lt;secret&gt;. Same-origin checks protect cookie writes; invalid Origin and Host headers are rejected.

## HTTP interface

Domain responses are JSON with Cache-Control: no-store.

| Method | Path | Input / result |
| --- | --- | --- |
| POST | /api/login | token, same origin; returns session cookie |
| GET | /api/session | Authentication state |
| POST | /api/logout | Revoke session |
| GET | /api/trips | Summaries, including archived trips |
| POST | /api/trips | requestId, trip; returns trip |
| GET | /api/trips/&lt;id&gt; | Full trip and version |
| POST | /api/trips/&lt;id&gt;/changes | requestId, expectedVersion, changes; returns trip and generated IDs |
| POST | /api/import | requestId, data; returns trip and mapping warnings |
| GET | /api/trips/&lt;id&gt;/export | Recoverable versioned JSON |

Every domain route requires authentication. GET /health reports generic health only. Bodies are limited to 2 MB; canonical content is bounded to 31 days, 80 plans per day, 80 reminders, and 100 operations per batch. Optional photos, translations, recommendations, and dates do not block a draft.

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

## Synchronization and connection failures

Trip pages poll every 20 seconds. Errors use bounded retries; Reconnect and online/focus/visibility events resume them. Home lists also refresh. An open page retains authenticated content in memory during brief outages; fresh offline navigation shows a generic connection page.

Protected payloads never enter persistent browser storage or the service-worker cache. Offline writes fail explicitly; there is no offline queue. Editors retain their opening version to reject later conflicting changes. After an uncertain response, reconnect and read before editing again.

Sign-out clears content and revokes the session. During an outage, a non-secret pending-sign-out marker blocks protected reads until revocation or a new explicit sign-in; other pages respond to that marker. When browser storage is unavailable, failed sign-out shows a retry control.

## Import and export

Import accepts structured authoring JSON, a runtime trip object, or a shared-trip-export file. Compatible IDs and localization are retained. Available incoming trip IDs are preserved; importing again creates another trip rather than overwriting. Retrying the same requestId creates nothing twice.

Safe unmapped fields are retained in compatibility content and reported. Legacy transport configuration is inert; import never contacts Firebase. Validation errors reject the whole import. Export restores content, IDs, versions, and archive state into empty storage. Database snapshots also retain retry records.

## Deploy on a small VPS

Deployment is a separate user action. Dockerfile is the deployment recipe; npm start is the local development path.

~~~bash
docker build -t shared-trips .
docker run --name shared-trips --restart unless-stopped \
  --env-file /absolute/private/shared-trips.env \
  -p 127.0.0.1:4173:4173 \
  -v /absolute/private/trip-data:/data \
  shared-trips
~~~

The private env file supplies the admin secret and SHARED_TRIP_ORIGIN=https://trips.example.org. The image listens internally on port 4173 and stores data in /data. Prepare the private mount for container UID 1000; keep backups separate. Choose another host port if needed.

Use the existing HTTPS reverse proxy with a dedicated virtual host, preserve the incoming Host header, and forward to the chosen loopback port. Preserve other services' configuration. No OAuth provider, Firebase account, or live AI call is required for normal use.

Stop/restart with docker stop shared-trips and docker start shared-trips. Replace containers while retaining the data mount and private configuration. Local processes stop cleanly with Ctrl+C/SIGTERM.

## Backup and restore

~~~bash
SHARED_TRIP_DATA_DIR=/absolute/private/trip-data npm run backup -- /absolute/private/backups/trips.sqlite
SHARED_TRIP_DATA_DIR=/absolute/private/restored-data npm run restore -- /absolute/private/backups/trips.sqlite
~~~

Backup uses SQLite's online backup API and validates the snapshot; it can run while the service is active. Targets must not already exist. Copying a live SQLite main file alone is not this method.

Restore requires the target service to be stopped. It validates and migrates a staging replacement, validates that replacement, and snapshots an existing target before swapping it. A server lock blocks restoration over a running service. First restore into separate storage and compare IDs, versions, and content.

Run maintenance commands with Node 24 and private storage access. The container also contains server/cli/backup.mjs and server/cli/restore.mjs; mount a separate backup directory when running them in a maintenance container.

## Upgrades and rollback

Schemas use PRAGMA user_version. Version 1 is the prior prototype layout; version 2 maps days.plans to days.slots, normalizes compatible content, and adds an archive index. Transactional migration retains IDs/versions and takes a pre-migration snapshot. Newer-than-supported schemas are rejected.

Back up before upgrading. Stop the service, replace its image/code while retaining data/configuration, restart, and verify reading/editing. Test fictional prior-version data first. To roll back, stop the new service and restore the pre-upgrade snapshot into separate storage for the old code; never open a newer schema with older code.

## Verification and limits

Run npm test for regression, HTTP/MCP integration, and DOM simulation. The [progress report](../doc/Progress/progress_2026_10_13_cpx001_codex_a.md) records evidence.

The official MCP SDK was tested over local HTTP. DOM simulation does not establish desktop/phone layout, map gestures, live weather/maps, physical installation, or third-party AI account connections. Docker build and a real VPS deployment require their own environment checks.
