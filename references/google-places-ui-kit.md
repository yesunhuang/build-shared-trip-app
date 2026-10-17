# Google Places UI Kit (self-hosted, optional, off by default)

The self-hosted trip page can show Google's own standard **Place Details (compact)** component inside an expanded plan card. It does this for a plan that an editor has deliberately linked to a public business or landmark on Google. The OpenStreetMap map, saved OSM places and Commons/manual photos stay exactly as they are. The feature is **off by default**, needs an owner-supplied browser key that this repository never contains, and does nothing in the legacy static generator.

New Google work needs **all four** of these:

1. the site flag `SHARED_TRIP_GOOGLE_PLACES_UI_KIT=1` with a browser key;
2. the trip's **Show Google place details and photos in this trip** setting (`googlePlacePhotosEnabled`, off by default; see [Per-trip setting](#per-trip-setting));
3. an explicitly configured monthly allowance and headroom; and
4. a granted reservation from the server's allowance ledger for that exact action (see [Monthly allowance gate](#monthly-allowance-gate)).

There is no default allowance and no automatic entitlement. If any gate is missing, denied, unavailable or uncertain, the page starts no new app-controlled Google work, including the first SDK load. Available controls show a translated status. An SDK already loaded in the page may continue its own background work; see the limitations below.

**Keep Google globally disabled** until the provider enforces a cap you rely on, or until the owner has read the [limitations](#what-the-allowance-cannot-guarantee) below and accepts them. The app's ledger is a conservative self-limit, not a guarantee of zero charges.

The automated tests use a mocked Google library. Local browser checks use fictional data and a Google mock, with Google network access blocked. Real SDK rendering, metering and billing remain unverified; see [Verification status](#verification-status).

## Contents

- [What is used, and what is not](#what-is-used-and-what-is-not)
- [What is stored](#what-is-stored)
- [Per-trip setting](#per-trip-setting)
- [Monthly allowance gate](#monthly-allowance-gate)
- [What the allowance cannot guarantee](#what-the-allowance-cannot-guarantee)
- [Linking a plan: conservative by design](#linking-a-plan-conservative-by-design)
- [Showing a linked plan](#showing-a-linked-plan)
- [Layout and styling limits](#layout-and-styling-limits)
- [Network, privacy and caching](#network-privacy-and-caching)
- [Usage and cost](#usage-and-cost)
- [Configuration](#configuration)
- [Owner setup (pending, not done)](#owner-setup-pending-not-done)
- [Rollback and recovery](#rollback-and-recovery)
- [Verification status](#verification-status)
- [Sources](#sources)

## What is used, and what is not

Only **standard** Places UI Kit elements are created, from the Maps JavaScript API library loaded with `google.maps.importLibrary("places")`:

| Element | Where | Markup |
| --- | --- | --- |
| `PlaceDetailsCompactElement` | Expanded plan card, and the editor's Place ID preview | `<gmp-place-details-compact orientation="vertical">` with `<gmp-place-details-place-request place="PLACE_ID">` and `<gmp-place-content-config>` containing `<gmp-place-media>`, `<gmp-place-address>` and `<gmp-place-attribution>` |
| `PlaceSearchElement` | Plan editor only, after an explicit search | `<gmp-place-search selectable>` with `<gmp-place-text-search-request text-query="…" max-result-count="5">` and a content config with address and attribution |

Google's [SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details) list **Places UI Kit Query (Essentials), SKU 0678-4F72-DA7C**, as billed per standard Details or Search request, and the [UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview) describes usage per component instantiation. The app therefore treats every component construction and every new request assignment as one potentially billable event.

Never created or called: `AdvancedPlaceDetails*`, `AdvancedPlaceSearch*` or `AdvancedPlaceList` (Pro), a Google map, the raw Places API, `Place.fetchFields`, the Place Photos API and Autocomplete. The app listens to `gmp-load`, `gmp-error` and, in the editor, `gmp-select`. From a selection it reads only `event.place.id`. It never opens a component's shadow DOM, reads its images, photo bytes, photo URLs or resource names, or reads any other Place field. It never extracts or caches Google photos. No advanced photo, review or button options are set.

**Separate from OpenStreetMap.** The map remains the existing Leaflet/OpenStreetMap map. Google's component appears only inside the card, with Google's own attribution. Nothing from Google is put on the map, into markers, into `plan.place` or `plan.photo`, or into any saved field. The Maps Service Specific Terms permit the Places UI Kit with a non-Google map (section 15, as summarized on 2026-10-15). Raw Places API content, which section 14 forbids combining with a non-Google map, is not used.

## What is stored

One optional, strictly validated plan field, separate from `place` and `photo`:

```json
{
  "googlePlaceAssociation": {
    "placeId": "FAKE_place_id_for_docs_0001",
    "locationBinding": "v1:<64 hex digits>",
    "publicVenueConfirmed": true
  }
}
```

The values above are placeholders. The rules are in [input-schema.md § Google place association](input-schema.md#google-place-association-self-hosted-optional). In short:

- **Exactly three keys.** Any other key is refused, including Google names, addresses, locations, ratings, photos or photo references, and the whole write fails. Google's policies allow Place IDs to be kept indefinitely; other Google content may not be scraped or persisted.
- **Bound to the plan's own location.** `locationBinding` is a SHA-256 fingerprint of the plan's non-Google location inputs only: the selected OpenStreetMap place (ID, coordinates, address), otherwise the user-authored full Google Maps link (`googleMapsUrl` or its well-formed legacy `mapsUrl` alias), otherwise saved legacy coordinates and address. Normalizing the alias on Save keeps the binding. Names, notes, times, order, photos and translations are excluded. Browser and server compute it with the same shared module (`assets/app-template/public/google-place-association.js`).
- **Enforced in the shared mutation path.** Every write runs through the same validation: web replace_content and upsert_plan, MCP `apply_trip_changes`, create and import. An association carried over unchanged survives unrelated edits. When the location changes or is cleared, it is removed automatically. A new or changed association that does not match the plan's current location, or sits on a plan without a location, refuses the whole batch. IDs, versions, conflicts and durable `requestId` retries are unchanged.
- **Portable.** The field travels with SQLite backups, exports and imports like other plan content. It contains only the Place ID. No schema migration is needed; older trips without the field are unaffected.

The allowance ledger is **not** trip content; see [Monthly allowance gate](#monthly-allowance-gate).

## Per-trip setting

`trip.googlePlacePhotosEnabled` is one strictly validated trip-level boolean ([input-schema.md § Per-trip Google setting](input-schema.md#per-trip-google-setting-self-hosted-optional)):

- **Default off.** New trips start with `false`. Trips stored before the field existed have no such key; they read as `false` (API, MCP `get_trip`, export) and the stored row is not rewritten by reading. The next ordinary write stores the explicit value. There is no bulk rewrite and no SQL migration.
- **Who can change it.** The owner, content managers and current trip creators, in **Edit trip** on the home page or the trip page (and **Create trip**), or through existing owner/content-manager MCP `update_trip`, `create_trip`, `import_trip` and `replace_content`. Ordinary creators use web editing; they gain no MCP or import authority. All paths use the same validation: only `true` or `false`; strings, numbers, `null` and objects are refused and the batch is not applied. Joined read-only members can read the value but the server refuses any change from them, from anonymous visitors and from pending or revoked accounts. It is trip content, not an account or security permission, and MCP still has exactly six tools and no Google search tool.
- **Independent of the site switch and the allowance.** It can be saved while the site feature is off, no key is configured or no allowance exists; it then does nothing. It never turns the site feature on and never grants any allowance.
- **Rolling back the app.** A build from before this setting does not know the field, so its validation would refuse a snapshot restore or import that contains it. Before going back to such a build, remove `googlePlacePhotosEnabled` from exports, or stay on this build. See also [Rollback and recovery](#rollback-and-recovery).
- **Opting out keeps data.** Turning it off keeps every `googlePlaceAssociation`, OSM `place`, Commons/manual `photo`, attribution and ID unchanged. Turning it on again shows the same saved links.
- **Inert trips.** In a trip with the setting off, the page sends no reservation, injects no Google script, imports no library, builds no component, sends no query and shows no Google section or editor controls, even when the site feature is on. The server also refuses reservations for such a trip. Unrelated edits keep saved associations, which are still validated against each plan's location.
- **Turned off while a page is open.** Open pages see the change on their next poll. They then void outstanding reservations and unused permits, discard shown and retained (hidden) components, close any open Google search or preview in the plan editor, abandon a library load that is still in progress before its next step, and ignore late Google events and late grants. Nothing pending is saved. Between a grant and the next poll, a permit (at most 45 seconds) could still be used for the one action it was granted for; the server re-checks the opt-in on every reservation and replay.
- **Zero initial work versus already-loaded code.** A page that opens an opted-out trip does no Google work at all. If the same page had already loaded the Maps JavaScript library earlier (because the trip was on until a poll turned it off), that third-party code stays loaded until the page is closed or reloaded; the app cannot unload it or stop work the SDK does on its own, and does not claim to. It is simply not used again for this trip, and a request the browser had already sent cannot be withdrawn. If the trip is turned on again in the same page, the already-loaded library is reused, but every new component still needs a new reservation.

## Monthly allowance gate

A server-authoritative, durable, atomic count of reservations per Google billing month, shared by every user, browser tab and trip of the server.

**Billing month.** Google's [billing overview](https://developers.google.com/maps/billing-and-pricing/overview) states that monthly free usage resets on the first day of each month at midnight Pacific time and is aggregated across all projects on the same billing account. The ledger therefore uses `America/Los_Angeles` with daylight saving (PDT months start at 07:00 UTC, PST months at 08:00 UTC), never UTC or the server's local month. The server checks its time-zone data against known instants at start-up and refuses to grant anything if it is unusable.

**Limit.** At most `SHARED_TRIP_GOOGLE_MONTHLY_ALLOWANCE − SHARED_TRIP_GOOGLE_ALLOWANCE_HEADROOM` reservations are granted per Pacific month. The gate is meant to stop **below** the free monthly Query (Essentials) cap, never to authorize paid usage, so the allowance may be at most **10,000** (the free cap verified from Google's pricing on 2026-10-15; recheck it) and the headroom must be **at least 1** and smaller than the allowance. Larger allowances and a zero headroom are refused as invalid configuration, which disables Google work. For example, 10,000 allocated with 1,000 headroom allows at most 9,000 reservations, and that is only appropriate if the owner really allocated that share to this app **and** nothing else on the same billing account uses Places UI Kit Query (Essentials). It is never an automatic entitlement: both values must be set explicitly, there is no default, and 9,000 is only an example. A recorded count may be higher than the limit (a high baseline or raise); that month then simply has no capacity left.

**Storage.** `<data dir>/google-allowance.sqlite`, a separate private SQLite file (mode 0600, rollback-journal mode, ledger format version 2). It holds format metadata, a ledger ID, the newest recorded server time, the initial month, the latest month record and the number of month records, a durable clock-fault marker, one row per Pacific month (`used`, plus a `baseline` for usage counted outside the app) and one row per reservation (permit ID, account reference, idempotency key, input fingerprint, kind, trip ID, month, issue and expiry times). It contains no Place IDs in clear text, no search text, no key and no trip content. The trip database, its schema (v6), backups, restores and rollbacks are unchanged; restoring a trip snapshot never touches the ledger. Version 1 files came only from an unreleased draft and are refused.

**Creation is explicit.** The server never creates, resets or repairs the ledger. An operator creates it once, offline, with the CLI below, naming the current Pacific month and a conservative baseline. A missing, unreadable, corrupt, inconsistent (monthly totals that do not match the reservation rows, missing metadata, wrong version or basis, a newest-time marker older than a reservation) or replaced ledger refuses every reservation. So does a ledger with **missing month or baseline records**: at start-up and inside every reservation transaction, before any new month could be created, the server checks that the initial month record, the latest month record and the recorded number of month records are all present. An emptied or partly deleted months table is never mistaken for a fresh month and never re-created at zero, and neither `raise` nor `reconcile-clock` repairs it. A new Pacific month starts at zero only through a legitimate in-process rollover (see [Time and clocks](#monthly-allowance-gate)), inside an existing, valid ledger.

**Reservation route.** `POST /api/trips/<id>/google-places/reservations` with `{ requestId, kind, planId?, placeId? }`:

| `kind` | Who | Body | Server checks |
| --- | --- | --- | --- |
| `details` | Approved joined member, content manager or owner, in a browser session | `planId`, `placeId` | The trip is accessible; the plan exists and its saved association is current and names that Place ID |
| `search` | Current trip creator, content manager or owner, in a browser session | nothing else (the search text never goes to this server) | Trip not archived |
| `preview` | Current trip creator, content manager or owner, in a browser session | `placeId` | Trip not archived |

For every kind: the site feature is on, the trip exists and is opted in, and the allowance grants a unit. Anonymous visitors (401), pending accounts (cannot sign in), revoked sessions (401), the owner bearer (403), MCP access tokens and OAuth tokens (401, they work only at `/mcp`) and cross-origin requests (403) are refused. A reservation never writes trip content and never changes a trip version. It is not an account or security capability, and there is no route, MCP tool or browser control that grants, raises, resets or refunds allowance.

A granted answer is `{ granted: true, replayed, permit: { id, kind, tripId, placeId, month, validForMs }, apiKey, libraries }`; the browser key is delivered **only** here. Denials are error codes: `google_places_disabled` (503), `google_trip_not_enabled` / `google_place_not_linked` / `trip_archived` (409), `google_allowance_unconfigured`, `google_allowance_unavailable`, `google_allowance_clock_uncertain`, `google_allowance_month_boundary` (503) and `google_allowance_exhausted` (429).

**Atomic, durable and idempotent.** Each reservation is one SQLite `BEGIN IMMEDIATE` transaction that re-validates the month row against its reservation rows, compares with the limit, inserts the reservation and increments the count. Concurrent requests (and separate processes on the same file) serialize, so the last unit is granted exactly once. The idempotency key is scoped to the account and stored durably: repeating the same key with the same input, also after a restart, returns the **same** permit with its **remaining** validity and never counts again; the same key with different input is a 409. A replay never extends a permit, never moves it into another month, and re-checks the trip opt-in and association.

**Never refunded.** A permit that is never used, expires, is refused by the page, or whose response was lost still counts. Uncertain work is always counted as done.

**Time and clocks.**

- A permit lasts at most 45 seconds and always ends 2 minutes before the next Pacific month. New reservations are refused within 2 minutes of either side of a month boundary, so moderate clock skew between this server and Google cannot move an event into the other month.
- The wall clock must be plausible (2025-2100, whole milliseconds), must not be earlier than the newest time already recorded in the ledger (1 s tolerance), and must not fall in an earlier Pacific month than the ledger's latest month record, including across restarts.
- While the process runs, the wall clock must advance with the monotonic clock (30 s tolerance; a monotonic clock running backwards or unavailable also counts). A stepped clock or a suspended host is a clock fault.
- **Clock faults are durable.** An implausible, backward or jumping clock is written into the ledger itself (fault kind and detection time; the faulty time never becomes the newest recorded time). From then on every connection, every restart and every later process refuses reservations with `google_allowance_clock_uncertain`, even after the clock looks right again. Only an explicit `reconcile-clock` by the operator clears it (see the CLI below), and that never lowers a count or credits anything back. Restart the app after reconciling.
- **A new month needs continuity.** A process starts a new Pacific month at zero only if it started inside the ledger's latest recorded month and its wall clock has advanced with its monotonic clock ever since (a legitimate in-process rollover). A process that starts in a later month without a record (downtime across the monthly reset looks exactly like a clock that jumped forward while the app was stopped) writes nothing and pauses Google work (`month_unconfirmed` in the start-up log, `google_allowance_clock_uncertain` to browsers) until the operator confirms the month with `reconcile-clock --month <current month> --baseline <n>` and restarts the app. This also applies to an ordinary restart early in a month in which nothing was reserved before the restart.
- A clock that is **consistently** wrong (for example no time synchronization, set wrong before the ledger was created) cannot be detected without an external time source; see [limitations](#what-the-allowance-cannot-guarantee). Keep time synchronization on.

**Configuration changes.** Counts are stored per month, independent of the configuration and the key. Raising the allowance (within the 10,000 bound) continues from the stored count; lowering it below the count denies further work at once; changing or removing the key, unsetting the allowance or a malformed or out-of-bounds value never resets anything. Malformed, half-set or out-of-bounds allowance values do not stop the app; they only disable Google work and are reported at start-up.

**Browser side.** Every app-controlled, potentially billable action reserves first and dispatches only after a synchronous check of its permit:

| Action | Reservations |
| --- | --- |
| First SDK bootstrap (script and `importLibrary`) | Covered by the reservation of the first component; there is no script without a granted key, and the bootstrap starts only after the same permit checks as a dispatch |
| Expanding a linked plan without a retained component (including the first one in a page) | 1 |
| Explicit **Show Google place details** when no live component is retained, or **Try again** after failure | 1 |
| Re-instantiation after eviction (more than three retained), failure, disposal after a background rebuild, or opt-in again | 1, and only after an explicit control |
| Each new editor search text (the first one also builds the search element) | 1 |
| Each Place ID preview | 1 |
| Collapsing and re-expanding a plan, or **Show Google place details** while its component is retained (hidden) in its own, still-connected host | 0 |
| Re-rendering, polling, changing language or an unrelated edit | 0 (never an automatic reservation or construction) |
| Repeating the search text already on screen, or the same Place ID preview, or a request that is still being reserved | 0 |
| A transport retry of the reservation request (network failure, timeout, proxy 502/504) | 0 additional units (same idempotency key, same single permit; a replayed permit is not dispatched) |

Immediately before the SDK bootstrap and before every dispatch, the page checks, synchronously: the permit is well formed and for this trip, kind and (for details and preview) Place ID, for a well-formed month that is still current, has not been used, and is within its validity window measured on the page's monotonic clock from when the request was **sent** (capped at 60 s, minus 1 s); the page's elapsed wall-clock and monotonic time agree; the tab is visible; and the caller's state is current (still opted in, same association and location, editor still open, public-venue box still ticked). Then it consumes the permit and builds or assigns synchronously. If monotonic timing is unavailable or untrustworthy, or the clocks disagree (for example after sleep and resume), the permit is treated as expired and nothing starts; the page never falls back to the wall clock alone. A late, cancelled, replayed, consumed, expired, old-month, malformed or unverifiable permit starts nothing, and uncertain work is never refunded. A slow SDK load or a background tab that outlives a permit never dispatches with it; the plan offers an explicit control, which reserves again. Background tabs reserve nothing. Search reservations carry no plan or Place ID, and their permits are checked without one.

**Moves and re-connections: components are never reparented.** Per the [HTML Standard](https://html.spec.whatwg.org/multipage/custom-elements.html#preserving-custom-element-state-when-moved), a custom element without a `connectedMoveCallback` still receives `disconnectedCallback` and `connectedCallback` when it is moved, even with `Element.moveBefore`. A local Chrome check of an earlier draft, with native `Element.moveBefore` and a mock component without that callback, recorded three connection callbacks for a single reservation after a collapse and re-expand. Any such re-connection could make the SDK request again without a reservation, so the app never moves a Google component (or its host) to another parent, whatever callbacks it has:

- A component stays in the host it was built in. Collapsing its plan or selecting another card **hides** it in that same, still-connected host, and re-expanding shows it again there, with no reservation and no new request from the app. At most three are retained; older ones are dropped and need a new reservation, through an explicit control, to come back.
- If a background rebuild (poll, re-render, language change, unrelated edit) has to remove a host from the document, its component is **disposed without ever being reconnected**, and the card offers **Show Google place details**. Only that explicit control reserves again; nothing is reserved or built automatically on an unrelated render.
- Limitation: reuse is therefore only possible while the original host survives; a rebuild that replaces the card costs a reservation the next time the person asks for the details. What the SDK does while a component stays connected (photos, refreshes, its own retries) is outside the app's control.

**Denied, unconfigured, unavailable or uncertain.** The Google area shows an accessible, translated status (*This site has reached its Google limit for this month…* or *Google features are paused right now…*, in all four languages), with **Try again** where retrying can help. After one such denial, the page sends no further reservations until an explicit **Try again**. No script, library, component or query is started. The plan's Commons photo, manually chosen photo, or original no-photo fallback, its OSM place, attribution and every other part of the card are byte-for-byte what they are with Google off; Google content is only ever additive, inside its own area. When the site feature is off, there is no Google area at all.

**Operator CLI** (offline; never contacts Google; prints no secrets):

```bash
# Read-only summary (exit code 2 when the ledger is missing or unusable)
SHARED_TRIP_DATA_DIR=<data dir> node server/cli/google-allowance.mjs status
# Create the ledger once. --month must be the current Pacific month on this clock; --baseline is
# a conservative count of Query (Essentials) events this app may already have used this month.
SHARED_TRIP_DATA_DIR=<data dir> node server/cli/google-allowance.mjs init --month YYYY-MM --baseline <n>
# Add usage seen elsewhere (for example in the provider console). Counts can never be lowered.
SHARED_TRIP_DATA_DIR=<data dir> node server/cli/google-allowance.mjs raise --month YYYY-MM --add <n>
# After a recorded clock fault, or a start in a month the ledger has no record of: confirm a
# trustworthy clock, the current month and a conservative count of this month's usage so far.
SHARED_TRIP_DATA_DIR=<data dir> node server/cli/google-allowance.mjs reconcile-clock --month YYYY-MM --baseline <n>
```

`init` refuses if any file already exists at the ledger path, writes to a temporary file, validates it and links it into place without overwriting. Restart the app after `init`; it opens the ledger only at start-up. Run the CLI as the app's user (UID 1000 in the Compose template) so ownership and mode stay correct. `raise` and `status` are safe while the app runs. `raise` applies only to the ledger's latest month record and never clears a clock fault. There is no command to lower or reset a count.

`reconcile-clock` is the only way to clear a recorded clock fault or to confirm a month after a start without continuity. Before running it, check the host's time synchronization (for example `timedatectl`) and compare with an independent clock. It refuses unless `--month` is the current Pacific month on this clock, the clock is not behind the ledger's newest recorded time, and the ledger's latest month record is not later than this month; it also refuses a ledger with missing month records. For a month already recorded, the ledger keeps the **higher** of its own count and `--baseline`; for a newer month it creates that month's record with `--baseline` (the console's Query (Essentials) count for this month so far, rounded up, plus anything not yet visible there; never assume 0 after unknown downtime). It then clears the fault. Restart the app afterwards; a running process stays paused. `status` shows any recorded fault, the latest month record and the newest recorded time.

## Offline operator trip setting

An authorized host operator can change only the per-trip boolean without handling an owner
credential or replacing a trip. Stop the application first, then use the existing private data
directory and a new backup filename outside the checkout:

```sh
SHARED_TRIP_DATA_DIR=<existing-private-data-directory> npm run set-trip-google-photos -- \
  <trip-id> <expected-version> <true-or-false> <stable-request-id> <new-private-backup-file>
```

Pass literal `true` or `false`. The command takes the normal data-directory ownership lock and
refuses a running service or another maintenance task. It requires the current schema and writes
a validated backup before reading the trip again and invoking the same `ContentGateway` and
`TripService.applyTripChanges` as HTTP/MCP. The operation contains exactly one `update_trip` field.
Version conflicts, durable identical retries and payload-free actor/channel `operator` audit use
the existing transaction. A preservation check inside that transaction rolls back if validation
would alter unrelated trip content. Refusals can append the ordinary audit metadata; a replay
never rewrites the trip. Read the current state after a replay rather than assuming a historical
result is still current. Resume the application afterward and verify the result.

Only `SHARED_TRIP_DATA_DIR` is read; no credential is needed. It never contacts Google, changes the
site configuration, initializes/opens the allowance ledger, links a venue or changes another trip.
It adds no public endpoint. Do not restore the backup over later edits, revocations or usage.

Fictional CLI/SQLite coverage is in `scripts/test-trip-google-operator.mjs`, included in `npm test`.

## What the allowance cannot guarantee

The ledger counts what **this app's code** asks for. It cannot guarantee zero charges:

- **The browser key can be used without the app.** Anyone who can see the key (every signed-in visitor, by nature of a browser key) can load the SDK from an allowed referrer, and a referrer restriction is not a cryptographic control. Restrict the key by website and API; the ledger cannot see such use.
- **The SDK can make its own requests.** Components may fetch photos and data, retry or refresh while they stay connected, without the app asking. The app never reparents or reconnects a component, but it cannot see what the SDK does on its own. Once the SDK is loaded in a page it cannot be unloaded and its own work cannot be stopped.
- **Other consumers share the cap.** The free monthly usage is aggregated across every project on the same billing account. Use from other apps, sites or environments is invisible here; subtract it when choosing the allowance.
- **An old ledger undercounts.** Putting back an older copy of `google-allowance.sqlite`, editing it consistently (the month-record checks catch lost rows, not deliberate edits), or initializing a new one with too low a baseline lowers the count; the app cannot detect a consistent older copy. Never restore it from a backup.
- **Clocks.** In-process jumps, backward and implausible clocks are detected and recorded, and a start in an unrecorded month waits for the operator. A clock that is consistently wrong from the start, or that jumped forward while the app was stopped but stayed inside the latest recorded month, cannot be told apart from a correct one without an external time source.
- **Budgets and quotas are not monthly caps.** [Budget alerts](https://developers.google.com/maps/billing-and-pricing/manage-costs) notify; they do not cap usage or spending. The documented UI Kit Query quota of [6,000 requests per minute per project](https://developers.google.com/maps/documentation/javascript/usage-and-billing) is a rate limit, not a monthly financial cap. Neither is a verified monthly spending limit.
- **It over-counts on purpose.** Unused, expired, refused and lost permits count. The ledger's number is an upper bound of what the app asked for, not Google's metering.

## Linking a plan: conservative by design

The official components expose only a place's ID and a temporary location or viewport to this app. Without raw Places data, which is not used, or reading the component's rendered content, which is not allowed, the app cannot check whether a result's name matches the plan or whether it is truly a public venue. So the app **never links a plan automatically** and never picks the first or "best" search result. It links a place only after an editor's explicit choice. Some plans will deliberately stay unlinked; that is the intended trade-off, not a missing feature.

In **Add/Edit plan** of an opted-in trip, owners, content managers and current trip creators (never joined read-only members) see an optional **Google place details** section:

1. It is usable only when the plan has a location. Opening the editor sends nothing.
2. Google work happens only when the location is being created or changed in the editor, or when the editor presses **Find on Google** / **Choose a different Google place** to correct a link. A new or changed location opens the form, but still sends nothing by itself.
3. Before anything is sent, the editor must tick *This is a public business or landmark, not a private home or address*. Only the dedicated query field is sent, and only to Google, never to this server; never the plan name, notes, travelers, private addresses or itinerary. The field starts empty. Text with an email address or a long digit run is refused locally.
4. **Search on Google** reserves one unit, then shows Google's own selectable list. Nothing is linked until the editor picks a result in that list. Repeating the same text sends and reserves nothing new; every different text reserves again.
5. Alternatively, paste a Google Maps link that names a place ID (`query_place_id=`, `destination_place_id=` or `place_id:`), or the bare ID, and press **Show this place**. That reserves one unit and the component shows that place; **Use this place** links it after it has loaded. A `/maps/place/…` link carries a feature ID, not a Place ID, and is rejected.
6. **Save** stores the association, bound to the location being saved. If the location changes after a choice, the pending search, preview and choice are discarded. A pending choice that cannot match the final saved location is omitted, and a localized notice asks the editor to select the place again; the other edits still save. **Cancel**, closing the dialog or unticking the public-venue box discards the pending choice; late events from Google's components and late grants are ignored. **Remove Google link** deletes it on Save.

When the allowance denies a search or preview, the editor shows the same translated status and builds nothing. MCP clients and agents can store an association through `apply_trip_changes` with the same validation, but there is no Google search tool and no reservation through MCP. Never invent a Place ID or copy one from an unverified source; store only an ID a person chose for that exact public venue.

## Showing a linked plan

- **Opted-in trips only.** Everything below applies only while the trip's setting is on; otherwise there is no Google section in any card.
- **Lazy.** Opening, reloading or polling a trip makes no reservation, no Google request and builds no component, whatever the number of linked plans. Expanding a linked plan (or selecting its marker) reserves one unit, then (for the whole page) loads one Maps JavaScript script and one `importLibrary("places")`, and builds one component for that plan.
- **One active plan.** Expanding another linked plan hides the previous component in its own, still-connected host (it is never moved), and shows it again there if that plan is expanded again. An open card whose component is not active offers **Show Google place details** instead of a new request. At most three components are retained; older inactive ones are dropped and need a new reservation, through an explicit control, to come back. No inactive plan is preloaded.
- **Deduplicated.** The library promise, component construction and place-request assignment happen once per trip/plan/Place ID/binding while retained. Repeated expansion while a reservation is pending shares it, and an unused, still-valid permit is reused by the next expansion of the same plan. Collapse and re-expansion reuse the same element in its original host. A re-render, language change, poll or unrelated edit never reserves or builds anything; if it has to remove a host, the component is disposed without reconnection and the card offers an explicit control (see [Moves and re-connections](#monthly-allowance-gate)).
- **Scoped.** A changed binding, a stale association or another trip never reuses a component or a permit. After a poll brings a changed location, the old component is discarded. A re-linked plan waits for an explicit **Show Google place details**.
- **Failure.** On `gmp-error` or no answer within 15 seconds, the card shows *Google place details aren't available right now.* with **Try again**, which reserves again. There is no automatic retry. Allowance denials show their own status (see above). With the feature disabled or no key, the card simply has no Google section. OSM data, the Commons/manual photo and the no-photo state stay as before. If Google has no photo, the card keeps its own photo.
- **No writes.** Viewing never saves anything. Viewers can see a saved link's component but cannot change it.

## Layout and styling limits

- Vertical orientation with natural height: the host is `width: 100%` up to the recommended 300 px, the component never narrower than 160 px, and no fixed height anywhere. The same host sits inside the card body on desktop and in the phone swipe sheet. Horizontal orientation, which hides the thumbnail below 350 px, is not used.
- Only the outer box is styled with supported outer CSS. Google's content, photos and automatic attribution are not altered, extracted, re-hosted or replaced with custom thumbnails or logos.
- The host is a labelled region (*Place details from Google*) with a polite live status line and keyboard-reachable **Try again** and **Show Google place details** buttons. The editor section has a heading, labelled fields, a labelled checkbox, a polite status line, and Enter-to-search that never submits the plan. All copy, including the allowance statuses, exists in English, Simplified Chinese, Traditional Chinese and Japanese. The component's own language is taken from the page language when the library first loads.

## Network, privacy and caching

- **Browsers, not the server, contact Google.** The server never calls Google, needs no outbound access (the Compose template's internal-only app network is fine), and caches nothing from Google. Visitors' browsers load the Maps JavaScript API from `maps.googleapis.com`, and the components then make their own requests to Google, including images. Google sees the visitor's IP address, the requested Place ID or search text, and the site origin (the app sends `Referrer-Policy: strict-origin-when-cross-origin`). The app does not promise zero network calls on revisit, and it does not cache photos permanently; any caching is the SDK's and the browser's own behaviour.
- **The key.** The browser key is delivered only inside a granted, no-store reservation response, to signed-in browser sessions (owner, content managers, viewers). `GET /api/google-places/config` reports only `{enabled, libraries, keyDelivery: "reservation"}` and never the key. MCP access tokens and OAuth tokens never reach either route. The key is not in static assets, trip JSON, exports, browser storage, the ledger, audit entries or logs. `/api/session` carries only the non-secret flag `features.googlePlacesUiKit: true`, and only while the feature is on. A browser key is visible to every visitor who receives it in the script URL by nature, so it must be restricted (see below).
- **Reservations.** A reservation body carries an idempotency key, the kind and, for details and preview, the plan ID and Place ID. Search text is never sent to this server. Reservations are not audited as trip changes; the ledger keeps the account reference, kind, trip ID, a digest of the input and times.
- **Search text.** Editors' queries go to Google from their browser. Never type booking details, travelers' names, private addresses or notes.
- **Service workers.** Neither service worker caches Google responses or reservation responses; the self-hosted worker ignores cross-origin requests and never caches `/api/*`.

## Usage and cost

Global pay-as-you-go pricing as read on 2026-10-15 (USD; recheck before relying on it; EEA and volume pricing may differ):

| SKU | Free events per month | Then |
| --- | --- | --- |
| Places UI Kit Query (Essentials), 0678-4F72-DA7C | 10,000, shared by every project on the same billing account, resetting at midnight Pacific time on the first of the month | $1.00 per 1,000 events, up to 100,000 |

Usage is per standard Details/Search request or component instantiation, not per photo byte. Matching searches and Place ID previews in the editor draw on the **same** SKU and free cap. Monthly cost at the first paid tier is `max(0, total events − 10,000) × $1 ÷ 1,000`.

**Details example.** Suppose all 29 linked plans of a trip are expanded once in one full view, so 29 events per view:

| Full views per month | Detail events | Cost if nothing else uses the cap |
| --- | --- | --- |
| 10 | 290 | $0 |
| 100 | 2,900 | $0 |
| 1,000 | 29,000 | (29,000 − 10,000) × $1 ÷ 1,000 = **$19** |

With the allowance gate configured at, for example, 10,000 allocated and 1,000 headroom, the app itself stops at 9,000 reservations in a month, so the 1,000-view example would be cut off after about 310 full views; the remaining plans show the limit status and their own photos. That does not cover the [limitations](#what-the-allowance-cannot-guarantee) above.

**Matching, listed separately.** Each explicit search or Place ID preview is one reservation and roughly one more event; for example, 100 searches and 50 previews in a month are about 150 events. Add matching events, detail events and any other UI Kit usage on the same billing account, then apply the one shared 10,000 cap to the total. For example, 29,000 detail events plus 150 matching events would cost about $19.15 without the gate.

For a separate initial-linking example, 29 matching searches add 29 Query events: $0 with an otherwise unused allowance, or $0.029 added to 29,000 detail events (combined $19.029, approximately $19.03). Selecting a result uses its exposed ID; an additional Place ID preview is another component request.

Actual counts depend on cards opened, reloads, retention evictions, explicit retries, explicit re-shows after a background rebuild disposed a component, and the SDK's own requests. Google's metering has not been tested. Budget alerts notify but do not cap; the 6,000-per-minute quota is a rate limit, not a monthly cap.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `SHARED_TRIP_GOOGLE_PLACES_UI_KIT` | Unset (off) | `1` opts in. `0`, empty or unset is off; anything else stops the server at start-up. |
| `SHARED_TRIP_GOOGLE_MAPS_BROWSER_KEY` | Empty | The owner's restricted browser key (30-100 letters, digits, `-` or `_`). The feature stays off without it. It may not equal the admin token. Keep it in the private env file only. |
| `SHARED_TRIP_GOOGLE_MONTHLY_ALLOWANCE` | Unset (no allowance) | Whole number, at most 10,000 (the verified free Query cap): the Query (Essentials) events per Pacific month that the owner has allocated to this app. Set it together with the headroom, or neither. Larger values are invalid; this setting never authorizes paid usage. |
| `SHARED_TRIP_GOOGLE_ALLOWANCE_HEADROOM` | Unset | Whole number, at least 1 and smaller than the allowance, kept unused as a safety margin. |
| `<data dir>/google-allowance.sqlite` | Absent | The ledger, created only by `server/cli/google-allowance.mjs init`; clock faults are cleared only by its `reconcile-clock`. |

Off, or on without a key: the session has no feature flag, the configuration route returns `{enabled: false}`, reservations are refused, and trip pages reserve nothing, load no Google script, build no component and send no query. Saved associations remain stored and inert, and import/export keep them. The legacy static generator never enables the feature.

On with a key but without a valid allowance and ledger: the session advertises the feature, but every reservation is refused, and linked plans show the paused status with their own content unchanged. Each trip still decides for itself with its **Edit trip** setting (off by default).

## Owner setup (pending, not done)

None of these steps has been taken for any deployment. They are owner decisions and actions, and nothing in this repository performs them:

1. **Decide.** Read the current Maps Platform terms, Places UI Kit policies, pricing and the [limitations](#what-the-allowance-cannot-guarantee) above, and decide whether to accept them. Keep `SHARED_TRIP_GOOGLE_PLACES_UI_KIT=0` until then.
2. **Project and APIs.** In the owner's own Google Cloud project with a billing account, enable both the **Maps JavaScript API** (which loads the library) and **Places UI Kit**, as Google's [Places UI Kit setup](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started) describes. Enable nothing else for this key.
3. **Browser key.** Create a dedicated **browser** API key. Under application restrictions choose *Websites* and add only the exact origin, for example `https://trips.example.org/*`. Under API restrictions allow only the Maps JavaScript API and Places UI Kit. Never reuse a server key or any other credential.
4. **Cost controls.** Create budget alerts for the billing account (they notify; they do not cap). Review the Places UI Kit quotas in the console and lower them where the console allows; record which provider controls you actually verified. Check which other projects and apps on the same billing account use Places UI Kit Query (Essentials).
5. **Choose the allowance.** Allowance = the share of the monthly free Query (Essentials) events you allocate to this app after subtracting every other consumer on the billing account; at most 10,000, and less whenever anything else on the billing account uses the SKU. Headroom = a margin of at least 1 for SDK requests the app cannot see and for metering differences (for example 10-20 %). 10,000 with 1,000 headroom (9,000 reservations) fits only a billing account on which nothing else uses Places UI Kit Query (Essentials). There is no default and no automatic entitlement; write down your reasoning.
6. **Check the clock.** Make sure the host keeps time synchronized (for example `timedatectl` reports a synchronized clock) and compare it with an independent clock. The ledger relies on it; see [Time and clocks](#monthly-allowance-gate).
7. **Initialize the ledger** (fictional example values; your private paths and tag from the env file):

   ```bash
   # The current Pacific month and a conservative baseline: this app's Query (Essentials) usage so
   # far this month according to the console, rounded up (0 only if you know it is 0).
   dc exec -T app node server/cli/google-allowance.mjs init --month 2031-05 --baseline 120 < /dev/null
   dc exec -T app node server/cli/google-allowance.mjs status < /dev/null
   ```

8. **Configure.** With `sudoedit`, set `SHARED_TRIP_GOOGLE_MONTHLY_ALLOWANCE`, `SHARED_TRIP_GOOGLE_ALLOWANCE_HEADROOM`, the key and, only when ready, `SHARED_TRIP_GOOGLE_PLACES_UI_KIT=1` in the private env file. Run `dc config --quiet`, then `dc up -d app`, and check `dc logs app` for an allowance warning.
9. **Per trip.** Turn on **Show Google place details and photos in this trip** only for the trips that should use it.
10. **Fictional live verification.** With a fictional trip in a separate fictional deployment or a short owner-supervised window, check in a real browser at desktop and phone widths: no reservation or Google request in an opted-out trip or before a linked plan is expanded; one reservation per expansion, search and preview (compare `status` before and after); after setting a tiny allowance (for example 2 with headroom 1, then a restart), the second expansion shows the limit status with no request to `maps.googleapis.com` in the browser's network panel and the card's own photo intact; Google's attribution is visible; link/correct/remove behaves as described. Also check that collapsing and re-expanding a plan sends no reservation and no new component request, and that a component whose card was rebuilt in the background is not shown again until **Show Google place details** is pressed. Compare the ledger with the console's Query (Essentials) count after the console has caught up. Record the evidence privately and do not reuse real trip data for screenshots.
11. **Ongoing.** If the console shows more usage than the ledger, use `raise` to add the difference; never lower anything. If the start-up log or `status` reports a clock fault or an unconfirmed month (for example after downtime across the first of a month), fix time synchronization, run `reconcile-clock` with the current month and a conservative baseline, then restart the app.

To disable for the whole site, set `SHARED_TRIP_GOOGLE_PLACES_UI_KIT=0` (or clear the key) and restart. To disable for one trip, turn its setting off. Saved links stay in the trips and reappear only when everything is enabled again.

## Rollback and recovery

- **Before rolling back to a build without the allowance gate** (any build whose `/api/google-places/config` still returns a key), set `SHARED_TRIP_GOOGLE_PLACES_UI_KIT=0` first. Such builds would let pages load Google without any reservation.
- **Keep the current ledger.** Rollbacks and restores must preserve the current `google-allowance.sqlite` and its high-water count. Never restore an older copy, delete it to "reset" it, or edit it; that undercounts. A trip snapshot restore (`server/cli/restore.mjs`) does not touch it.
- **Moving to a new data directory** (for example after a [restore into separate storage](../deploy/README.md#8-restore-drill-into-separate-storage)): with the app stopped, copy the **current** ledger file into the new directory, or run `init` there with a baseline at least as high as the last known count (`status`) plus anything since. Without a ledger the new directory simply has Google disabled.
- **Failures.** A missing, corrupt or inconsistent ledger (including missing month or baseline records), a recorded clock fault, an unconfirmed month, unusable time-zone data or a malformed or out-of-bounds allowance disables new Google work only; reading, editing, OpenStreetMap and Commons keep working. Investigate with `status`, keep the problem file for inspection, and do not re-create a ledger at zero for the current month.
- **Clock recovery.** For a recorded clock fault or an unconfirmed month: fix time synchronization, then run `reconcile-clock --month <current Pacific month> --baseline <conservative count for this month so far>` and restart the app. If it refuses because the clock is behind the ledger's newest recorded time or the ledger records a later month, the ledger was written with a clock that was wrong in the future; counts are never moved back. Either keep Google off until the clock passes that time, or, as an informed owner decision, move the file aside (keep it), and `init` a new ledger whose baseline is at least the old ledger's counts for the current month and every later recorded month added together, and never below the console's count for this month.

## Verification status

| Check | How | Status |
| --- | --- | --- |
| Configuration parsing, protected key-free config route, session flag, key never in trip/static/audit output; association validation, stale clearing, retries, conflicts, MCP, import/export | `scripts/test-google-place-association.mjs` (in `npm run test:server`) | Passed locally in CP020 against the changed routes |
| Allowance ledger: Pacific months versus UTC/local, DST, configuration bounds (at most 10,000, positive headroom, high baselines), CLI including `reconcile-clock`, permissions, invalid payloads, shared count across users/tabs/trips, last-unit races over HTTP and worker threads, idempotency across restarts, non-refunded lost responses, month boundaries, durable clock faults across restarts and connections, unconfirmed months, in-process rollovers, missing month/baseline records, configuration and key changes, missing/corrupt/inconsistent/tampered ledgers, trip backup/restore | `scripts/test-google-allowance.mjs` (in `npm run test:server`) | Passed locally in CP020: real local HTTP and SQLite, injected clocks and fictional data; no provider calls |
| Browser gate: single-use permits before the SDK bootstrap and every details/search/preview dispatch, permit month and binding checks, monotonic/wall-clock corroboration, expiry, replay, transport retry, denials with zero Google activity and translated status, cancellation, opt-out, sign-out, hidden tabs, no reparenting of components and no reconnection after a background rebuild | `scripts/test-google-places-allowance-ui.mjs` (in `npm run test:ui`), jsdom | Passed locally in CP020 with mocked Google and injected clocks |
| Trip page: zero Google activity when disabled or denied, byte-for-byte Commons/manual/no-photo cards, late grants after opt-out or collapse, lost-response retry, replayed permit, lazy single-plan loading, same-host reuse on collapse/re-expand, disposal with an explicit control after a background rebuild, bounded retention, editor guards, four languages, phone host, static generator inert | `scripts/test-google-places-ui-kit.mjs` and `scripts/test-trip-google-setting-and-links-ui.mjs` (in `npm run test:ui`), mocked Google | Passed locally in CP020; simulated input and layout contracts, not a real SDK check |
| Desktop and phone-width rendering, same-host reuse, unrelated note edit, explicit re-show, exhausted details/search/preview, original image and no-photo fallback, native keyboard link/new-tab isolation | Chrome, local HTTP server and ledger; fictional trips; mocked components; 1280 × 900 and 390 × 844 | Passed in CP020. Fresh exhaustion: zero mock SDK/component activity and original image loaded. Phone width is browser emulation, not a physical device |
| Real SDK rendering, attribution, events, metering and re-request behaviour while connected; real key restrictions; billing | Owner-configured live browser check | **Not verified** |
| Per-trip setting on the server and in the page | `scripts/test-google-place-photos-trip.mjs`, `scripts/test-home-trip-setting-and-links-ui.mjs` | Passed in CP018; unchanged by this change |

[Checkpoint 017](../doc/Progress/progress_2026_10_16_cpx017_codex_b.md) records the initial integration. [Checkpoint 018](../doc/Progress/progress_2026_10_16_cpx018_codex_b.md) records the per-trip amendment, full regression, fresh generation/static QA and mocked-Google browser acceptance.

## Sources

Read 2026-10-15 unless noted; the allowance facts were verified for this change from Google's public documentation:

- [Billing and pricing overview](https://developers.google.com/maps/billing-and-pricing/overview): monthly free usage resets on the first day of the month at midnight Pacific time and is aggregated across all projects on the same billing account.
- [SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details): Places UI Kit Query (Essentials), 0678-4F72-DA7C, per standard Details or Search request.
- [Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview): standard versus Advanced elements, their SKUs, and usage per component instantiation.
- [Maps JavaScript API usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing): the 6,000 Query requests per minute per project quota (a rate limit).
- [Manage costs](https://developers.google.com/maps/billing-and-pricing/manage-costs): budget alerts do not cap usage or spending.
- [Places UI Kit setup](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started): billing-linked project, Places UI Kit and a browser key, with Maps JavaScript library loading.
- [Places widgets reference](https://developers.google.com/maps/documentation/javascript/reference/places-widget): element, request and content-config markup, `gmp-load`, `gmp-error`, `gmp-select`.
- [Place Details element](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details): compact widths and orientation.
- [Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms): section 15 (UI Kit with a non-Google map) and section 14 (raw Places API content).
- [Maps JavaScript API policies](https://developers.google.com/maps/documentation/javascript/policies): Place IDs may be stored; other content may not be scraped or persisted.
- [Pricing](https://developers.google.com/maps/billing-and-pricing/pricing): Query (Essentials) free cap and rate.
- [HTML Standard, preserving custom element state when moved](https://html.spec.whatwg.org/multipage/custom-elements.html#preserving-custom-element-state-when-moved): without `connectedMoveCallback`, a moved custom element still receives disconnect and connect callbacks.

Recheck provider terms and pricing before activation.
