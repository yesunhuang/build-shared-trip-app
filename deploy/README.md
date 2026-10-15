# Docker Compose + Caddy HTTPS template

A reusable template for running the [self-hosted service](../references/self-hosted.md) behind Caddy automatic HTTPS. Compose/image validation, isolated Linux container tests and fictional live HTTPS, HTTP/MCP, account restrictions, restart and backup/restore checks passed. See the [live acceptance report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md) for tested scope and remaining checks. Verify the configuration and acceptance checks on your own host.

| File | Purpose |
| --- | --- |
| compose.yaml | The app (existing Dockerfile, Node 24) runs on an internal network with no host port. Caddy joins the backend and edge networks and publishes only 80/443. |
| Caddyfile | Site from SHARED_TRIP_DOMAIN, reverse proxy, CDN no-store headers, no cache |
| .env.example | Placeholder private env file. Copy it **outside** the checkout. |

Placeholders: `trips.example.org` is fictional. `/PRIVATE/shared-trips/...` stands for private absolute paths of your choosing, outside the checkout and any public web directory.

## Configuration contract

| Variable (private env file) | Used by | Meaning |
| --- | --- | --- |
| SHARED_TRIP_ADMIN_TOKEN | app only | Owner-only bearer secret of 32-512 characters. It is the master credential, including MCP. Content-manager MCP tokens are issued from the home page and stored in the database, not in this file. |
| SHARED_TRIP_ORIGIN | app | `https://<public host>`. The app rejects any other Host or Origin value. |
| SHARED_TRIP_DOMAIN | Caddy only | Same hostname as the origin |
| SHARED_TRIP_DATA_PATH | app `/data` | Data directory owned by UID 1000 on a local filesystem |
| SHARED_TRIP_BACKUP_PATH | app `/backups` | Separate snapshot storage, owned by UID 1000 |
| CADDY_DATA_PATH / CADDY_CONFIG_PATH | Caddy `/data`, `/config` | Certificates, keys, and ACME account data |
| SHARED_TRIP_IMAGE_TAG / CADDY_IMAGE | images | App rollback tag; pinned Caddy image |

The data directory holds `shared-trip.sqlite` (trips, retry log, accounts and roles, invitations, MCP access-token records, audit log), the ownership files described in [section 9](#9-unclean-stops-and-data-directory-ownership), pre-migration snapshots, and the optional private `photos/` store. Compose refuses to start when a variable is missing, and it does not create missing host directories. Neither the app port nor the Caddy admin API is published.

## 1. Inspect the host before installing anything

Preserve existing services, proxies, ports, and SSH access. These checks are read-only:

```bash
cat /etc/os-release; uname -m
sudo ss -ltnup                     # current listeners: anything on 80/443? which port is sshd on?
systemctl list-units --type=service --state=running
docker version; docker compose version   # if Docker already exists, use it; do not reinstall
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}'
df -h; findmnt; free -h            # data must be on a local filesystem (locks + hard links)
timedatectl                        # clock sync matters for certificates
sudo ufw status verbose            # or your firewall's read-only status command
```

- If 80/443 are free and you choose this stack, continue. If they are in use, **do not stop or replace that proxy**. See [Existing proxy](#existing-proxy).
- Install Docker Engine and the Compose plugin only if they are missing. Follow https://docs.docker.com/engine/install/ for your OS.
- Before any firewall change, confirm the SSH listener stays allowed and keep a second authenticated session open. This template does not change SSH. Docker-published ports can bypass host firewall rules such as ufw.

## 2. Private storage and configuration

```bash
sudo install -d -m 0700 /PRIVATE/shared-trips /PRIVATE/shared-trips/config \
  /PRIVATE/shared-trips/caddy-data /PRIVATE/shared-trips/caddy-config
sudo install -d -m 0700 -o 1000 -g 1000 /PRIVATE/shared-trips/data /PRIVATE/shared-trips/backups
sudo cp -n deploy/.env.example /PRIVATE/shared-trips/config/shared-trips.env
sudo chmod 0600 /PRIVATE/shared-trips/config/shared-trips.env
sudoedit /PRIVATE/shared-trips/config/shared-trips.env
```

Generate the admin secret in a password manager, or with `openssl rand -base64 48` in a private terminal. Paste it into the file with the editor. Never pass it as a command argument, `export` it, or echo it. The image runs as UID 1000 (`node`), so the data and backup directories must be writable by that user. Membership in the docker group is root-equivalent and exposes container environments through `docker inspect`, so restrict it.

**Private photos (optional).** The service serves `/photos/<name>` from `<SHARED_TRIP_DATA_DIR>/photos`, which is `/data/photos` in the container. Create the directory with `sudo install -d -m 0700 -o 1000 -g 1000 /PRIVATE/shared-trips/data/photos` and put flat files there. Names must match `[A-Za-z0-9][A-Za-z0-9_-]*` with a `.webp`, `.png`, `.jpg`, or `.jpeg` extension. Subdirectories are not served. Reference a photo in trip content as `/photos/<name>.webp`. Do not add private filenames to the public, generic `photos/manifest.js`.

Define a helper in your shell and run it from the checkout root (these paths are not secrets):

```bash
PRIVATE_ENV=/PRIVATE/shared-trips/config/shared-trips.env
dc() { sudo docker compose --env-file "$PRIVATE_ENV" -f deploy/compose.yaml "$@"; }
dc config --quiet      # validates without printing values; never run plain `config`
```

## 3. DNS, Cloudflare, and certificates

Point the hostname at the server. Caddy automatic HTTPS (https://caddyserver.com/docs/automatic-https) obtains and renews a publicly trusted origin certificate, which is compatible with Cloudflare Full (strict) (https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/). Running Caddy under Compose is described at https://caddyserver.com/docs/running#docker-compose.

The default HTTP-01 challenge needs origin ports 80 and 443 to be reachable through the configured hostname. Edge redirects, firewall rules, or WAF rules that block port 80 or `/.well-known/acme-challenge/` can prevent issuance or renewal. Check `dc logs caddy` after the first start rather than assuming success. DNS-01 requires a custom Caddy build and is outside this template. Certificates persist in CADDY_DATA_PATH, so keep it across upgrades.

Do not add "cache everything" rules for this host. CDN request limits and bot or WAF features can affect MCP clients and sign-in, so verify them.

## 4. Build and start

```bash
dc build app
dc up -d
dc ps                       # app should become healthy; only caddy lists 80/443
dc logs --tail=100 caddy    # certificate issuance status
```

## 5. First trial with fictional data

```bash
curl -sS https://trips.example.org/health                                       # {"status":"ok"}
for p in /api/trips /api/users /photos/example.webp /attachments/example; do
  curl -sS -o /dev/null -w "$p %{http_code}\n" "https://trips.example.org$p"      # 401 each
done
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  --data '{}' https://trips.example.org/mcp                                     # 401
curl -sS -D - -o /dev/null https://trips.example.org/api/trips                  # no-store headers
curl -sS -o /dev/null -w '%{http_code}\n' --resolve trips.example.org:443:127.0.0.1 \
  https://trips.example.org/health   # from the server: origin cert must verify (no -k)
```

Then sign in on the home page with the admin secret (**Owner sign-in**). Import the fictional `assets/trip.example.json`, open its `/trips/<id>` page, edit it, and reload. Connect an MCP client as described in [mcp.md](../references/mcp.md), with the secret stored only in that client's private configuration.

For an authenticated curl check, keep the header in a private 0600 file. Write one line, `Authorization: Bearer <secret>`, with sudoedit, then run `sudo curl -H @/PRIVATE/shared-trips/config/api-auth.header https://trips.example.org/api/trips`. Remove that file afterwards if you no longer need it.

Exercise the account flows with fictional accounts in separate private browser windows (see [section 6](#6-accounts-and-roles)):

- A pending account cannot sign in.
- An approved viewer sees trips read-only and has no create, import, edit, or account controls.
- An approved content manager (for example `sample-editor`) can create, edit, import, archive and restore trips and has no *Accounts* section or token controls.
- `/mcp` rejects every browser session, and a fictional content-manager token works at `/mcp` but is refused at `/api/trips`.
- After you revoke an account or change its role, its next refresh signs it out and its tokens stop working.

Before using real data, revoke the fictional account and archive the fictional trip. Alternatively, switch SHARED_TRIP_DATA_PATH to a new empty directory and keep the trial directory.

## 6. Accounts and roles

1. **Create an invitation.** Signed in as owner, choose **Create invitation** under *Accounts*. The single-use code is shown once and expires after 72 hours. The API also accepts `expiresInHours` from 1 to 168.
2. **Share the code privately.** Send only the invitation code, never the admin secret. There is no invitation URL.
3. **The invitee redeems it.** They open the home page, choose *Have an invitation?*, and enter the code with a username (3-32 lowercase characters) and a password (10-128 characters) that they choose privately. This creates a **pending viewer** account that cannot sign in.
4. **Choose the access level.** Leave it as **Viewer** (read and export every trip), or select **Content manager** and choose **Save access level** (create, edit, delete content in, import, export, archive and restore every trip, current and future). Only the owner can change roles.
5. **Approve the account.** Approval applies the role to **every** trip. There is no per-trip membership.
6. **Revoke or change roles when needed.** Either action immediately invalidates that account's active sessions and MCP tokens. Approving the account again lets it sign in afresh; it does not revive old sessions or tokens.

Neither role can manage accounts, invitations, roles, tokens, security, backups, restores, or this host, and nobody can permanently purge a trip through the app. Viewers cannot write, import, or use MCP. Restarting the service or running a restore signs everyone out, but accounts and MCP access tokens persist in the database.

**Content-manager MCP tokens (owner only).** On the content manager's row choose **Show assistant access**, enter a label, and choose **Issue token**. The secret is shown once, has a fixed 90-day lifetime, and works only at `/mcp`. Copy it with the explicit **Copy** button directly into the AI client's private credential store on a machine you control, then choose **Done, hide token**. Never send it through chat or put it in this checkout, the env file, or a script. A failed issuance is not retried; check the list before issuing again. To renew, issue a replacement, update the client, confirm it connects, then revoke the old token. Owner-only `GET /api/audit` lists metadata about these actions, without secrets or payloads. See [mcp.md](../references/mcp.md#provisioning-a-content-managers-token-owner-only).

## 7. Online backup

```bash
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dc exec -T app node server/cli/backup.mjs "/backups/shared-trip-${stamp}.sqlite" < /dev/null
sudo sha256sum "/PRIVATE/shared-trips/backups/shared-trip-${stamp}.sqlite"
# Private photos are not inside the database; archive them separately if used:
photos="/PRIVATE/shared-trips/backups/photos-${stamp}.tar"
sudo test ! -e "$photos" && sudo tar -C /PRIVATE/shared-trips/data -cf "$photos" photos
```

The CLI uses SQLite's online backup while the service runs and validates the snapshot. The snapshot contains trips, IDs, versions, archive state, the retry log, accounts (with password hashes and roles), invitation digests, MCP access-token records, and the audit log. Treat it as a credential-bearing secret.

The backup command needs no input. Redirecting stdin prevents Compose from consuming later commands when this recipe runs inside a script.

The CLI refuses an existing target, so snapshots are never overwritten. If a name collides, rerun the command. Same-server snapshots are **not** off-site protection. Copy them, encrypted, to separate storage you control. Delete old snapshots only one at a time, after the off-site copy has been verified. This template has no automatic cleanup.

## 8. Restore drill into separate storage

```bash
TAG=local   # the SHARED_TRIP_IMAGE_TAG currently in your env file
drill="/PRIVATE/shared-trips/restore-drill-${stamp}"
sudo install -d -m 0700 -o 1000 -g 1000 "$drill" "$drill/input" "$drill/data"
sudo cp -n "/PRIVATE/shared-trips/backups/shared-trip-${stamp}.sqlite" "$drill/input/snapshot.sqlite"
sudo chown 1000:1000 "$drill/input/snapshot.sqlite"
sudo docker run --rm --network none --read-only --tmpfs /tmp --user 1000:1000 \
  -e SHARED_TRIP_HOST=127.0.0.1 -e SHARED_TRIP_DATA_DIR=/drill/data \
  --mount "type=bind,src=$drill,dst=/drill" \
  "shared-trips:$TAG" node server/cli/restore.mjs /drill/input/snapshot.sqlite
sudo docker run --rm --network none --read-only --user 1000:1000 \
  --mount "type=bind,src=$drill,dst=/drill" "shared-trips:$TAG" node -e '
const { DatabaseSync } = require("node:sqlite");
const { createHash } = require("node:crypto");
const spec = {
  trips: ["SELECT id, version, archived, data FROM trips", (r) => r.id, (r) => [r.version, r.archived, r.data]],
  request_log: ["SELECT scope, request_id, fingerprint, result FROM request_log", (r) => r.scope + ":" + r.request_id, (r) => [r.fingerprint, r.result]],
  users: ["SELECT id, username, status, session_epoch, password_hash FROM users", (r) => r.id, (r) => [r.username, r.status, r.session_epoch, r.password_hash]],
  invitations: ["SELECT id, token_hash, expires_at, used_at, used_by FROM invitations", (r) => r.id, (r) => [r.token_hash, r.expires_at, r.used_at, r.used_by]]
};
const read = (file) => { const db = new DatabaseSync(file, { readOnly: true });
  try { const has = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = ?").all("table").map((r) => r.name));
    return Object.fromEntries(Object.entries(spec).map(([t, [sql, key, value]]) => [t, has.has(t)
      ? new Map(db.prepare(sql).all().map((r) => [key(r), createHash("sha256").update(JSON.stringify(value(r))).digest("hex")])) : null])); }
  finally { db.close(); } };
const [a, b] = process.argv.slice(-2).map(read);
let diff = 0;
for (const t of Object.keys(spec)) {
  if (!a[t]) { console.log(t + ": not in snapshot (older schema)"); continue; }
  let n = 0;
  for (const k of new Set([...a[t].keys(), ...b[t].keys()])) if (a[t].get(k) !== b[t].get(k)) n++;
  console.log(t + ": " + a[t].size + " vs " + b[t].size + "; differing: " + n); diff += n;
}
process.exitCode = diff ? 1 : 0;' /drill/input/snapshot.sqlite /drill/data/shared-trip.sqlite
```

The drill never touches live data or the backup directory, needs no secret, and prints only counts. A snapshot from schema v1 is normalized during restore, so trip differences are then expected; review them. A v2 snapshot gains empty account tables.

**Real recovery:**

1. Stop the app with `dc stop app`.
2. Restore the same way into a **new** directory.
3. If you use private photos, extract the matching photo archive into the new directory.
4. Point SHARED_TRIP_DATA_PATH at the new directory and run `dc up -d app`.
5. Keep the previous directory untouched.
6. Open *Accounts* and revoke again anyone whose access was revoked after the snapshot was taken, reapply later role changes, and revoke again any MCP token revoked after the snapshot.

The restored database has the account state from snapshot time. Accounts revoked later are approved again, later role changes are undone, MCP tokens revoked later become valid again until they expire, and invitations redeemed later become usable again until they expire.

## 9. Unclean stops and data-directory ownership

The app and the restore CLI claim the data directory through `server-ownership.sqlite`. This is a persistent, normally zero-byte SQLite database on which the owner holds an OS-level EXCLUSIVE transaction for its whole lifetime. A tagged `server.lock` marker beside it stops older PID-lock releases from starting.

On a clean stop (SIGTERM within `stop_grace_period`), the owner rolls back, closes the database, and removes its marker. After a kill, OOM, or crash, the OS drops the lock. The next start then takes ownership and, while holding it, atomically replaces the stale marker that it can attribute to this ownership database. `restart: unless-stopped` can therefore restart the app without manual steps. A `server-ownership.sqlite-journal` left behind is removed by SQLite itself.

**Never delete** `server-ownership.sqlite`, its journal, or a current-format marker. Isolated Linux container checks exercised contention and automatic recovery after a hard kill with preserved trip IDs, versions and retry entries. After an unclean stop, check `dc ps` and `dc logs app`; see the [container acceptance report](../doc/Progress/progress_2026_10_14_cpx003_codex_b.md) for the tested scope.

| `dc logs app` says | Meaning | Action |
| --- | --- | --- |
| directory is in use by another running service or restore | A live process holds the lock | Find and stop that process or container. Delete nothing. |
| has a `server.lock` that this release cannot attribute | Legacy PID lock, unknown file, or marker for a different ownership file | Stop every service and restore that uses this directory, on every host and in every container. Verify that none is running, delete **only** that `server.lock`, then start. |

Never run older and newer releases against one data directory. Docker named or bind volumes on local disks are fine. NFS, SMB, and VM shared folders are not supported, because locks and hard links are required.

## 10. Upgrade and rollback

1. Read the [self-hosted guide](../references/self-hosted.md) and the progress reports for the target version, looking for schema, ownership, or configuration changes.
2. Take and validate a backup ([section 7](#7-online-backup)) and copy it off-site.
3. Update the checkout to the reviewed version. Set a new SHARED_TRIP_IMAGE_TAG in the env file; the previous image keeps its old tag.
4. Run `dc stop app` and confirm that no other container or host process uses the data directory. A graceful stop of an older PID-lock release removes its own lock. A leftover legacy lock is handled as in [section 9](#9-unclean-stops-and-data-directory-ownership).
5. Run `dc build app && dc up -d app`, then check `dc ps`, the logs, reading, editing, viewer sign-in and, if used, content-manager sign-in and MCP tokens. Data and configuration mounts are unchanged. If deploy/Caddyfile changed, run `dc up -d --force-recreate caddy`, because a single-file mount otherwise keeps the old file.

**Schema v4** adds account roles, MCP access-token records and the audit log to schema v3's viewer accounts and invitations. The first start on an older database writes `shared-trip.sqlite.before-v4-<time>` into the data directory and migrates in one transaction. Trips, IDs, versions, archive state, retry records and account approval states are preserved. Existing accounts become viewers; promote content managers explicitly afterwards. The pre-migration snapshot is never deleted automatically. Copy it to your backups.

**Rollback:** if no schema migration happened, set the old tag and run `dc up -d --no-build app`. Older code refuses a newer schema. In that case:

1. Stop the app.
2. With the old image, restore the pre-upgrade snapshot into a new directory ([section 8](#8-restore-drill-into-separate-storage)).
3. Point SHARED_TRIP_DATA_PATH at the new directory, set the old tag, and start with `--no-build`.

Keep the upgraded directory for analysis. Edits, accounts, role changes and MCP tokens created after the upgrade are not in that snapshot, so export trips first if needed. After rolling back past the content-manager release, every account is a viewer again and only the admin bearer works at `/mcp`; remove the old tokens from AI clients. Restore into fresh storage and preserve any foreign or legacy ownership marker for diagnosis.

Restoring a snapshot also restores its approval and credential-revocation state. Before reconnecting clients, review credentials that were revoked after the snapshot and revoke them again where needed.

## Existing proxy

If 80/443 are taken, keep the current proxy and add a dedicated virtual host instead of starting Caddy:

- **Dockerized proxy:** run `dc up -d app`, then attach the proxy to the `shared-trips_backend` network (preferably declared as an external network in that proxy's own configuration) and forward to `http://app:4173`.
- **Host proxy:** add a private override outside the checkout and start only the app:

  ```yaml
  # /PRIVATE/shared-trips/config/compose.loopback.yaml
  services:
    app:
      networks: [backend, loopback]
      ports: ["127.0.0.1:4180:4173"]   # choose an unused loopback port
  networks:
    loopback: {}
  ```

  Start it with `sudo docker compose --env-file "$PRIVATE_ENV" -f deploy/compose.yaml -f /PRIVATE/shared-trips/config/compose.loopback.yaml up -d app`. This extra network allows outbound traffic.

The proxy must:

- preserve Host, Origin, Authorization, and Cookie;
- pass POST requests, including 202 responses, without buffering, caching, or short response timeouts;
- add the CDN no-store headers for `/api/*`, `/mcp`, `/trips/*`, `/photos/*`, `/attachments/*`, `/resources.html`, and its own errors;
- serve a publicly trusted certificate for Full (strict).

## Access model

The owner-held admin secret authorizes everything: every trip, writes, import, account, role and token management, the audit log, and MCP (bearer only). Approved accounts sign in with a username and password. Viewers can read and export every trip. Content managers can also create, edit, import, archive and restore every trip, and can use MCP only with an owner-issued, 90-day, `/mcp`-only token; they cannot administer accounts, security or this host. No one can access trip data anonymously.

Generic shells (sign-in page, scripts, styles, the empty photo manifest) and `/health` are public and carry no trip data. Publishing this code or template grants no trip access.

The app sends `Referrer-Policy: strict-origin-when-cross-origin`, so external map tile requests receive only the origin, not private trip paths. Whether map tiles actually load from the OpenStreetMap servers depends on that provider and its usage policy (https://operations.osmfoundation.org/policies/tiles/). Verify maps in a browser rather than assuming.

## Limitations

- First certificate issuance, verified public/origin HTTPS, live Compose health, account and HTTP/MCP privacy paths, protected-response cache headers, app restart and a live snapshot/separate restore passed in one fictional trial. This does not establish every host or CDN configuration; see the [live acceptance report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md), [isolated container report](../doc/Progress/progress_2026_10_14_cpx003_codex_b.md) and [local browser report](../doc/Progress/progress_2026_10_14_cpx002_codex_b.md).
- Renewal is configured through Caddy automatic HTTPS and persistent certificate mounts; a renewal cycle and a full host reboot have not been exercised. Watch the Caddy logs.
- Cloudflare consumes `Cloudflare-CDN-Cache-Control` rather than forwarding it to browsers. Verify that header at the origin and check downstream `Cache-Control`, `CDN-Cache-Control`, cache status and authenticated-then-anonymous behavior. See [Cloudflare's header documentation](https://developers.cloudflare.com/cache/concepts/cdn-cache-control/).
- Rate limits for sign-in (10 failures per minute) and invitations (10 invalid codes per 15 minutes) are keyed by connection address. Behind Caddy, all clients share Caddy's address, so failures by one client briefly block everyone.
- The running app can write to the backup mount, so off-site copies are the real protection.
- Desktop and phone-width Chrome interactions and direct Cache Storage/local-storage inspection passed in the observed trial profile; see the [cache completion report](../doc/Progress/progress_2026_10_14_cpx005_codex_b.md). Physical-phone installation, full pointer/touch regression and named external AI-client integration remain separate checks. Real-data migration requires its own authorization and preservation plan.
- The live trial above predates content managers, MCP access tokens, `import_trip` and `export_trip`. Their behavior over this template's HTTPS, proxy and CDN path has not been exercised; verify them with fictional accounts and tokens before relying on them.
