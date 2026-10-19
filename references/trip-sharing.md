# Read-only trip share links

This is the contract for one revocable, anonymous, read-only link per trip (schema v9, `server/trip-sharing.mjs`). People who receive the link can read a simplified itinerary without an account. Every trip starts unshared. A link exists only after an authorized manager creates one for that trip. Publishing this source enables no link. Turning sharing on for a real trip needs the owner's separate authorization.

**Anyone holding the link, including anyone it is forwarded to, can read the shared content.** The link is a bearer capability. Noindex is not access control.

## Link and token

- Format: `<origin>/s/<tripId>#<token>`. The token is 32 bytes from `crypto.randomBytes`, encoded as 43 unpadded base64url characters (256 bits). The server accepts only the canonical encoding.
- The server stores only the SHA-256 digest of the token (`trip_shares.token_hash`). The raw token is never written to the database, request log, audit log, backups or browser storage.
- **Copy once.** The raw token appears only in the response to an explicit create/rotate `POST`. If that response is lost, the token is gone, and the manager has to rotate the link. No read returns it again.
- The token travels in the URL **fragment**, which browsers do not send in requests or `Referer`. The visitor page keeps the token in memory, leaves the fragment in the address bar so a forwarded link still works, and never writes the token or the itinerary to web storage, cookies, Cache Storage or history state.
- `/s/<tripId>` serves the same generic HTML for visitor paths, including malformed links, with no existence check. Unfurlers and crawlers see only neutral title and description metadata, never itinerary data.
- **Unavoidable exposure:** any messaging app, email service or in-app browser (for example WeChat) that carries or opens the link sees the full URL, fragment included. Revoking or rotating the link stops future reads. It cannot recall content that was already viewed, copied or saved.

## Management API

These routes use the existing session cookie or the owner's admin bearer. MCP tokens and OAuth grants are refused, and **no MCP tool reads or manages sharing.** Responses are `Cache-Control: no-store`. Errors use `{ "error": { "code", "message", ... } }`. A missing or inaccessible trip returns the generic 404.

| Method | Path | Body | Success |
| --- | --- | --- | --- |
| GET | `/api/trips/<id>/sharing` | — | `{ sharing }` |
| GET | `/api/trips/<id>/sharing/preview` | — | `{ trip, media, sharing, archived, inclusion }` |
| POST | `/api/trips/<id>/sharing` | `{ expectedShareVersion, expiresAt? }` | `{ sharing, token }` |
| POST | `/api/trips/<id>/sharing/revoke` | `{ expectedShareVersion }` | `{ sharing }` |

- `sharing` is `{ enabled, version, expiresAt, createdAt }`.
  - `enabled` is true only when a digest is stored, the link has not expired and the issuer is still authorized. An **expired link reports `enabled: false`**, with its past `expiresAt` still present.
  - `version` is `0` while no share row exists. Every create, rotate or effective revoke, and every trigger-driven invalidation, increments it in the same transaction.
- `preview.trip` is exactly the guest projection described below. `media` lists descriptors for every image the link would serve: key, kind, `embedded`/`local`/`remote` source and URL. `inclusion` carries fixed codes for included and excluded categories, plus `freeTextAndPhotosAreNotSanitized` and `anyoneWithLinkCanView`.
- **Create/rotate** issues a new token and replaces any current digest. The old token stops matching in the same transaction.
  - `expiresAt` is `null`/omitted (no expiry) or an ISO 8601 date-time with `Z` or an offset. It must be at least 1 minute and at most 2 years in the future.
  - It is refused with `409 trip_archived` while the trip is archived.
  - Creates are limited per actor: 60 per 10 minutes.
- **Revoke** clears the digest, issuer and expiry, records `revoked_reason='revoked'` and increments `version`. If no digest is stored (already off), it changes nothing: `version` stays the same and the audit outcome is `unchanged`. Revoke is allowed while the trip is archived.
- Request bodies:
  - Unknown fields, a missing or negative `expectedShareVersion`, or an invalid `expiresAt` → `422 validation_failed`.
  - A version mismatch → `409 share_conflict` with `currentVersion` and no change.
  - Writes have no request-ID replay, and the client never auto-retries a write.
- Ordinary content, translation and photo edits, and trip `version` bumps, never change the link.
- Audit actions are only `trip.share.create` (covers rotation) and `trip.share.revoke`. Each records the actor, the `http` channel, the trip ID, the resulting share version and the outcome. Never the token or digest.

### Who may manage

- **Owner administrator** (cookie or admin bearer): any trip. Can always revoke.
- **Current creator** of the trip: browser session only, while the account is approved, is still a member and is still the trip's designated creator.
- **Not enough on their own:** content-manager role, membership, MCP/OAuth credentials, or a share link.

Authority is re-checked on every management request and inside the write transaction.

### Issuer permanence (fail closed, no revival)

A link records its issuer: `owner`, or an account ID together with that account's `session_epoch`. On every guest read, an account-issued link is valid only if the account is approved, its epoch is unchanged, it is still the creator and it is still a member.

SQL triggers on schema v9 erase the digest permanently and bump `version` when:

- `trip_shares_account_changed`: the issuer's status leaves `approved` or its `session_epoch` changes (`issuer_inactive`);
- `trip_shares_creator_changed`: the trip's creator changes away from the issuer (`issuer_displaced`);
- `trip_shares_member_removed`: the issuer's membership is removed (`issuer_displaced`).

These triggers fire for every code path, including offline CLIs. Re-approval or reassignment therefore never revives a link, and a new link must be created. Permanence relies on the account epoch plus these triggers. No per-trip creator-access revision is stored. Snapshot validation rejects a v9 database that is missing any of the triggers.

## Guest access

- Page: `GET /s/<tripId>`. Data: `GET`/`HEAD /guest/trips/<tripId>`. Media: `GET`/`HEAD /guest/trips/<tripId>/media/<key>`, where `<key>` is `cover`, `logo` or `plan-<slotId>`. Media URLs carry a content-fingerprint `?h=` query.
- Each data or media request sends `X-Trip-Share: <token>` with `credentials: "omit"`, `cache: "no-store"`, `referrerPolicy: "no-referrer"`, `redirect: "error"` and `mode: "same-origin"`.
- Every request independently checks:
  - a canonical token;
  - a constant-time digest match;
  - not revoked and not expired;
  - the issuer is still valid;
  - the trip exists and is not archived.

  Any failure, including a cross-trip token, an unknown path or an unknown media key, returns the same generic `404 not_found`. Other methods on a guest route return `405` with `Allow: GET, HEAD`.
- No cookie, session or principal is derived from the header. `/guest` is handled before any cookie or bearer is read, and the header never authorizes `/api`, `/mcp`, `/oauth`, `/photos` or `/trips`. Revocation, rotation, expiry, archive, deletion and issuer invalidation therefore take effect on the next data or media request.
- Guest API headers:
  - `Cache-Control: no-store, private, max-age=0`, `CDN-Cache-Control: no-store`, `Pragma: no-cache`;
  - `Referrer-Policy: no-referrer`;
  - `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex`;
  - `Vary: X-Trip-Share`;
  - `Cross-Origin-Resource-Policy: same-origin`;
  - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`.
- `/s/<tripId>` page headers:
  - `no-store, private` caching;
  - `no-referrer`;
  - the same `X-Robots-Tag`;
  - the CSP `GUEST_PAGE_CSP` in `server/static.mjs`. It allows same-origin scripts, styles and connections, and `img-src 'self' blob: https:`, so **remote HTTPS photos are allowed**. It has no third-party scripts, analytics or provider SDKs.

  The page also has `referrer` and `robots` meta tags.

### Bounds and provider use

- Counters are in memory, per process and keyed by client IP (socket address): 3000 guest requests per minute per IP, and 120 invalid attempts per 10 minutes per IP. Each counter table is capped at 10,000 keys (oldest evicted). Over the limit, the response is a generic `429` with `Retry-After` (60 s or 600 s).
- Guest reads never call a place, photo or Google provider and never reserve Google allowance. However, the projection can contain **remote photo URLs that the visitor's browser loads directly** from their host, with `no-referrer` and without the token. That host sees the visitor's IP and user agent.
- Local media files are capped at 10 MiB on the server. The visitor page caps each media response at 12 MiB, trip responses at 8 MiB and total retained image blobs at 48 MiB.

## Projection (explicit allowlist)

`buildGuestProjection` copies each field with a type and length check. It never spreads a record, and absent values are omitted.

```text
{ trip: { id, version, title, timezone, updatedAt,
  days (≤31): [{ id, date, label, area, summary, notes,
    slots (≤80): [{ id, name, period, time, sortTime, sortOrder, planType, cardCategory,
      address, lat, lng, description, notes, googleMapsUrl, mapsUrl,
      photo: { url, alt, credit, sourceUrl, license, licenseUrl }, i18n }], i18n }],
  reminders (≤80): [{ id, item, dueDate, notes, i18n }],
  cover: { url, alt, focusX, focusY },
  branding: { theme: { preset[, ink, accent, background] }, logo: { url, alt } },
  i18n } }
```

- The day `label` comes from the stored `day.label`. A stored `theme` is not projected.
- `i18n` is limited to `en`, `zh-Hans`, `zh-Hant` and `ja`, and to string fields whose source field was projected:
  - trip: `title`;
  - day: `label`, `area`, `summary`, `notes`;
  - slot: `name`, `time`, `address`, `description`, `notes`;
  - reminder: `item`, `notes`.
- **Never included:** bookings and booked status, reviews, related links, participant groups, members and accounts, access and invitations, audit and security state, Google place associations, trip settings, resources and content pages, tips and disclaimer, weather locations, recommendations, compatibility data, and media bound only through excluded fields.
- Photos:
  - A valid uploaded photo overrides everything else.
  - Otherwise the slot's saved `photo` is used. If the slot has none, `photoSourceId` resolves to **another plan's saved photo in the same trip**. It is not looked up in any public manifest.
  - A local `/photos/<file>` is served through the guest media route, and only if it is bound to this trip in `trip_media`.
  - A remote photo must be absolute `http(s)`, without credentials. It cannot be same-origin, a `googleapis.com` host, a loopback host, or have a query key that looks like a secret.
  - No provider search runs.
- Embedded covers, logos and uploaded photos never appear as bytes. They are served through `/guest/.../media/<key>`. A stale, guessed, unbound or other-trip key returns 404.
- **No automatic sanitization.** Free text and photos are shared as written.

## Management dialog (`assets/app-template/public/share-management.js`)

```js
import { installShareManagement } from "/share-management.js?v=__CACHE_VERSION__";
const handle = installShareManagement({ tripId, container, canManage, onUnauthorized, language });
// handle: { button, open(), close(), relabel(), setCanManage(bool), destroy() }
```

- `canManage` should come from `access.canInvite` (owner or current creator). The server is the authority. Nothing is appended or fetched when `canManage` is false.
- Optional injection: `document`, `fetch`, `navigator`, `origin`.
- Requests use `credentials: "same-origin"`, `cache: "no-store"` and `redirect: "error"`, with no share header or bearer.
- Opening the dialog reads metadata and preview in parallel and never writes.
- **Preview:** lists the actual title, day, plan and reminder text, addresses, coordinates, map links and every allowlisted translation, rendered with `textContent`. Images are **listed** (alt text, credit, license, source) but **not loaded**. The dialog tells the manager to review the actual photos in the original itinerary before sharing.
- Status shows Off, On, or Expired (a past `expiresAt`), plus expiry or "No expiry" and the creation time.
  - Optional expiry uses `datetime-local` in the manager's local time. It is converted to an ISO instant and must be at least 1 minute ahead.
- Generate/Replace require ticking the review checkbox. Replace and Turn off also need an inline confirmation (no `window.confirm`). Buttons are disabled while a request is in flight.
- The new link is placed in a readonly input through `.value`.
  - Copy uses `navigator.clipboard.writeText` and falls back to selecting the link for manual copy.
  - Share appears only if `navigator.share` exists.
  - The token is cleared on Hide, close, revoke, a version change or a disabled state.
- Error handling:
  - `409`: re-reads metadata and preview, clears the review tick and shows a conflict message.
  - Network failure, timeout, `5xx`, `408` or `429`: the outcome is treated as uncertain, and the dialog re-reads metadata only.
  - `401`: calls `onUnauthorized` once and removes the launcher.
  - `403`/`404`: clears the dialog and removes the launcher.
  - Late responses after close are discarded, including a token.
- The dialog has four complete string tables and uses a native `<dialog>` with a fallback. Targets are at least 44 px, sizes are in rem, and styles are injected once as `#share-management-styles`, scoped to `.stm-*`.
- Archived trips show a pause explanation and disable Generate/Replace while retaining Revoke.
- `server/static.mjs` serves `/share-management.js` as a guest-safe asset. Do not show the launcher on the visitor page, in MCP or in read-only member views.

## Visitor page (`assets/selfhosted/guest.html`, `guest.js`, `guest.css`)

A simple, four-language (`en`, `zh-Hans`, `zh-Hant`, `ja`) read-only page with no login, install prompt, editing or admin controls.

- **Language:** picked from `navigator.languages` and switchable with a selector. The choice is not persisted.
- **Initial day:** uses today's date in the trip's IANA timezone, falling back to the device zone.
  - During the trip it shows today, or the latest past day inside a gap.
  - Before the trip it shows the first day; after the trip, the last day.
  - Undated drafts show the first day.
  - A phase line explains which case applies.
  - Refreshes keep the reader's chosen day.
- **Content:** shown with `textContent`. Slots are ordered by `sortOrder`, then period, then start time.
- **Map links:** each slot gets a Google Maps link (a stored Google Maps HTTPS URL, otherwise a search URL built from coordinates or address) and an OpenStreetMap link. Both use `target="_blank" rel="noopener noreferrer"`. Copy-address has a manual-select fallback.
- **Images:** guest media is fetched with the header into revocable `blob:` URLs (3 concurrent, 20 s timeout). Remote photos load directly and lazily with `no-referrer`.
- **Refresh and retries:**
  - Data requests time out after 15 s.
  - After a failure the page retries automatically after about 3 s, 10 s and 30 s (with jitter, honoring `Retry-After` up to 120 s). Then it falls back to polling.
  - While visible, it polls every 3 minutes, up to 120 polls.
  - Focus, visibility and restored `pageshow` refresh after a 30 s success gap; `online` can refresh immediately. The always-visible **Check for updates** button refreshes manually with bounded retries, including after the polling limit.
  - Changed successful responses wait until an active native link press completes; the latest response wins. Definitive denial clears immediately. A changed fragment clears data and reloads to bind the correct credential.
  - If a refresh fails after content has loaded, the last loaded content stays on screen with a stale notice.
- **Denial:** `401`/`403`/`404`/`410` clears all content and media, shows "This link is not available" and stops automatic polling. Only "Check again" retries.
- **Share button:** the reader can pass on the full link (fragment included) with `navigator.share`, falling back to the clipboard and then to manual selection.

## Archive, deletion, migration, rollback

- **Archive** suspends guest data and media reads (generic 404) without changing the share row. Managers can still view status and preview, and can revoke. Creating or rotating is refused (`409 trip_archived`).
- **Unarchive** resumes the same link only if it is still valid: not revoked, not expired, issuer still authorized.
- **Permanent deletion** removes the share row by FK cascade in the same transaction. Guest requests then return 404.
- **v9 migration** is additive. It creates an **empty** `trip_shares` table and the three triggers (`IF NOT EXISTS`, idempotent). No existing row is rewritten, and every trip stays unshared. A pre-upgrade snapshot is kept, as for earlier versions. Restart keeps valid links working, because only digests are stored.
- **Backups and restore:** snapshots contain share digests, never raw tokens. Restoring an older snapshot restores the share rows it contained. Portable trip export/import carries no sharing state.
- **Compatible rollback:**
  - A v8 backend **refuses** a v9 database ("requires a newer application"). The old security backend is unsuitable.
  - To roll back the UI, keep the current schema, ACL, OAuth and share backend and the current data and Google ledger, and serve the prior frontend.
  - Never lower `user_version`, drop the table or triggers, or clear digests with ad hoc SQL.
  - To stop a link, revoke it through the API before or during the rollback.

## Deployment notes

- **Service worker:** `assets/selfhosted/service-worker.js` explicitly bypasses `/s`, `/guest`, `/api`, `/mcp`, `/oauth` and `/.well-known/oauth-*`, so guest HTML, payloads and images never enter Cache Storage. The shell list does not include them.
- **Reverse proxy or CDN:** do not cache `/s/*`, `/guest/*` or `/api/*`, and pass the app's `no-store` and `CDN-Cache-Control` headers through unchanged.
  - The Caddy template filters `X-Trip-Share` from the default runtime/error logger; disabling access logs alone does not cover runtime errors. Any additional access/debug logger must apply equivalent filtering. See the official [global logger options](https://caddyserver.com/docs/caddyfile/options#log) and [header filter syntax](https://caddyserver.com/docs/caddyfile/directives/log#filter).
  - Do not add client-side error reporters that would capture `location.href`.
- **Application:** never log the header, token, digest or full guest request. Guest 404s are not audited.
- Deployment instructions in this repository name no concrete hosts, addresses or credentials.

## Acceptance and limits

The final local acceptance passed with fictional fixtures:

- `npm test`: full legacy, HTTP/SQLite/MCP, account/ACL/OAuth and UI regression gate, including the new sharing suites.
- `scripts/test-trip-sharing.mjs`: actual HTTP/SQLite projection, owner/creator authority, issuer invalidation, media and route isolation, lifecycle, restart and v8-to-v9 preservation.
- `scripts/test-share-management-ui.mjs` and `scripts/test-trip-guest-ui.mjs`: four-language DOM simulations, uncertain writes, copy/share fallbacks, latest-content/day preservation, native-press deferral, fragment changes, bounded retries and image memory.
- `scripts/test-trip-sharing-browser.mjs`: actual Chrome, 24 visitor and 12 management cases, widths 320/390/1280, four languages and 100%/200% text. Actual images, timezone selection, network recovery, native map click/Enter, saved edits during a pointer press, copy fallback, optional expiry and rotation/revocation passed. External map navigation was intercepted before contacting the provider.
- `scripts/test-trip-sharing-rollback.mjs`: actual prior frontend with the current security backend, v9 snapshot restore, later edits, revocation and roll-forward preservation.
- Fictional demo rebuild, fresh external generation/static QA, framework privacy audit and outgoing diff review passed. The template was accepted by the existing Caddy binary; an isolated network-disabled runtime fixture retained diagnostic error/debug logs while removing the fictional capability.

This is desktop/phone-width Chrome emulation, not a physical phone or messaging-browser check. Physical Android/iOS and the WeChat in-app browser remain untested. The authorized app/proxy rollout subsequently passed actual Linux image, compatible rollback, isolated restore, origin/public HTTPS, preservation and read-only MCP SDK checks; every existing trip remained unshared. See [Codex A checkpoint 004](../doc/Progress/progress_2026_10_19_cpx004_codex_a.md) for deployment evidence and backup-copy limits, and [checkpoint 003](../doc/Progress/progress_2026_10_19_cpx003_codex_a.md) for implementation acceptance. Never enable a real link solely to produce acceptance evidence.
