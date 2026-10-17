# Feature contract

[Cover artwork and semantic card highlights](trip-cover-and-categories.md) are independent trip/plan presentation. Owners, content managers and current trip creators may upload/replace/clear a cover and choose explicit categories; joined read-only members can only read. Covers appear on home cards and trip headers separately from logos. Missing covers/categories preserve legacy defaults; walking/car travel is never automatically promoted to ticketed transport. Existing booking semantics, maps/provider attribution and allowance controls remain intact. Target-client schema visibility is a separate rollout acceptance gate.

Self-hosted trips support independent [branding](trip-branding.md): an embedded bounded raster logo, accessible light presets/custom colors and explicit reset. The native mobile-friendly editor and typed MCP fields share trip-scoped editor checks and version-aware atomic writes. Creators edit through the web; MCP credentials remain owner/content-manager only. Logo/theme data survive export/import, snapshots and restart; existing trips and the global installed identity remain unchanged. Provider components, checklist semantics, weather, maps and the Google allowance are preserved.

Card address text uses saved Maps/selected-place destinations, with ordinary encoded name/address search fallback; multiple destinations stay individually labelled and only links have an arrow. Plans support up to six ordered editable [related links](plan-related-links.md), preserved through shared version-aware HTTP/MCP/import/export paths. Joined read-only members may open links but cannot edit them.

Preserve these behaviors unless the user explicitly requests a design change. The trip-page UI is shared by two modes:

| | **Self-hosted (default)** | **Legacy generator (opt-in)** |
| --- | --- | --- |
| Apps | One service and one PWA for all trips | One generated static app per trip |
| Data | Server SQLite, authoritative | Embedded seed, plus local preview storage or optional Firebase |
| Access | Owner admin token; approved ordinary accounts read joined trips and edit their own as creator; all content managers, including assistants, edit member trips only. Only the owner administrator has global access. Sign-in for every trip/API; existing MCP-only OAuth authority unchanged | Link-based trust (Firebase) or none (local) |
| Sync | Bounded polling and reconnect | Firestore listener, or none |
| Offline | Generic shell only; protected data stays in page memory | Cached itinerary shell |
| Validation | Draft structure | Complete authoring checks |

## Self-hosted home and trip switching

- `/` shows sign-in when signed out: a generic account username/password form (for viewers and content managers alike), a separate **Owner sign-in** with the admin token, and a *Have an invitation?* form. That form takes an invitation code, a username, and a password, and creates a pending viewer account. No invitation URL or self-approval exists.
- Signed in as owner, `/` lists trips (archived trips separately or behind a filter) with controls to create, import, edit metadata, archive or restore, export, and open each trip. An *Accounts* section creates single-use invitations, showing each code once, lists pending, approved, and revoked accounts with a labelled access-level select (Member or Content manager), and approves or revokes them. A **Save access level** control appears only after the owner changes the select, with a note that saving signs the account out and ends its tokens.
- For each approved content manager, the owner can open **Show assistant access** to list token metadata (label, created, expires, last used, active/expired/revoked), issue a labelled token, and revoke one. The list has loading, empty, and failure (with **Try again**) states. A new secret appears once in a separate box as plain text with explicit **Copy** and **Done, hide token** actions; it never enters browser storage, a URL, an attribute or a status message, is never copied automatically, and is cleared on dismiss, Refresh, reload, sign-out, token revoke, account revoke, or role change. A failed issuance is reported and not retried automatically.
- Signed in as an approved content manager, `/` shows the owner's trip controls (create, import, edit metadata, archive or restore, export, open) plus a short note that account and security settings stay with the owner. The *Accounts* section and every role and token control are absent.
- Signed in as an approved ordinary account, `/` lists joined trips only, with open/export and Participants. It offers Create trip and Join a trip; only the current creator sees that trip's edit/archive/restore and invitation controls. Import and account controls remain absent. The server independently checks every list, direct read, write, export, private image and MCP path. Participants are account memberships, separate from itinerary groups.
- Controls follow server session capabilities (`createTrips`, `editTrips`, `importTrips`, `manageAccounts`) plus the target trip's `access.canEdit`, and fail closed when authority is missing. Trip-content screens use traveler language only; role and token wording stays in the owner's *Accounts* section.
- Each trip opens at `/trips/<trip-id>`, which stays the same through renames and upgrades. The trip page has controls for *All trips*, editing the trip, adding a date, exporting, and signing out. Owners, content managers and current trip creators get the same editing controls. For joined read-only members, the editing controls (trip edit, add date, add/edit plan, checklist changes) are absent or disabled.
- An unknown trip ID shows a not-found state, and a signed-out visit shows a sign-in state. It never falls back to another trip or to demo data.
- The manifest `id`, `start_url`, and `scope` are `/` with a generic stable name, so switching trips never needs reinstalling. The service worker caches only generic static assets. It never caches `/api`, `/mcp`, `/oauth/*`, `/.well-known/oauth-*`, protected trip navigations, or trip payloads.
- The trip page shows honest status labels: saved, saving, failed, conflict (reload required), offline/reconnecting, and signed out. A failed write is never shown as saved. After a 401, for example the next poll after the owner revokes a viewer, the page clears its data and returns to sign-in.

## Header and main page

- Show the literal app name once, on one line when the viewport permits, beside the chosen trip icon.
- Do not translate the app name.
- Combine country and trip dates into one concise line.
- Use localized decorative route/place names, not a redundant explanatory route sentence.
- Keep language selection, sync state, install action, and the separate Payments & apps link compact and stable across languages.
- Use a compact header with no large decorative spacer. Put the plan-change timestamp in the footer on every screen size, not beside the title.
- Stack a compact, full-width checklist row above the full-width weather slider. Align their outer edges, corner treatment, and spacing. A closed checklist must shrink to its summary content; do not stretch it to weather height or add blank filler. Opening it expands naturally. Weather details open in a dialog without reflowing the page or overlapping date navigation.
- Show every itinerary date together in a horizontally scrollable weather summary, independent of the selected itinerary day. Use one equal-height narrow card per date with one aggregate row: wettest-stop icon, maximum high, minimum low, maximum rain chance, and a primary stop label plus `+N` for additional stops. A small timetable icon opens a native dialog or mobile bottom sheet; location chips switch one stop's semantic hourly table at a time, including temperature, precipitation chance, UV, wind, and sunrise/sunset.
- Display plan-change and forecast-fetch timestamps in the viewer's current device time zone. Determine the active trip day in `trip.timezone`.
- Daily weather association ([weather-association.md](weather-association.md)): a day without an explicit choice gets automatic areas from its own saved plan coordinates only, labelled as an area near one of its plans, never as a verified city. Owners, content managers and current trip creators can switch a day between automatic, chosen places (saved points or typed coordinates) and no forecast in the weather dialog; joined read-only members see the result read-only. Explicit choices, including "no forecast", win after plan edits and refreshes. Forecasts stay in memory, are batched and deduplicated, and are fetched only for days inside the 16-day window that have points.
- Keep required external attributions inside the collapsed Sources & photo credits disclosure.

## Itinerary

- Use one heading: “Itinerary.” Omit a second eyebrow or the redundant choose-a-date explanatory sentence.
- Open the current trip date automatically; otherwise open the first day.
- Show one selected day at a time, with large date/day/area controls.
- Place flights and stays in the same chronological timeline as every other POI.
- Order by explicit `sortOrder` when complete, otherwise by period and `sortTime`/time.
- Keep plan details collapsed until selected.
- Keep the map synchronized to the active day and reframe all current markers.
- Opening a timeline item focuses its marker without hiding it behind the mobile sheet.
- A map-marker selection opens and scrolls to the corresponding plan. This two-way selection applies equally to plans located by a Google Maps URL and to plans with a selected OpenStreetMap place.
- For a plan with a selected OpenStreetMap place, the navigation action is built from the saved coordinates, and the source link opens the OSM object page. Never present a generated or coordinate-based link as a verified Google Maps venue.
- On desktop, give the map a substantial sticky column (roughly 44–48% of the workspace) and a viewport-aware height. Keep the timeline readable; do not shrink the map into a thumbnail. Below the desktop breakpoint, preserve the dedicated mobile planner.
- Show checklist items due on the selected itinerary date near the top of that day's content, before the timeline. Checklist dates may be before, during, or after the trip.
- Daily and shared checklists use a scoped sage/moss palette with dark green text, badges, controls and boundaries. Completed items retain checks and strike-through; overdue dates retain a warning color and an exclamation marker. Read-only checkboxes stay natively disabled, with dashed outlines. Ordinary text must meet 4.5:1 contrast and meaningful control/focus boundaries 3:1; global accents, weather, maps and other cards keep their colors.
- Self-hosted, with the optional Google Places UI Kit enabled site-wide **and** the trip's own **Show Google place details and photos in this trip** setting on (`googlePlacePhotosEnabled`, off by default): expanding a plan linked to a Google place first reserves one unit from the server's monthly allowance and then shows Google's standard vertical compact details for that plan only, inside the card. Nothing Google-related loads before a linked plan is expanded. Only one plan is active at a time, and other open linked plans offer **Show Google place details**. The Commons/manual photo, the no-photo fallback, OSM source and map stay unchanged. A Google failure shows a short message with **Try again** and never retries by itself. An allowance denial (limit reached, not configured, unavailable or uncertain) shows a translated status, starts no Google script, library, component or query, and leaves the card's own content byte-for-byte as with Google off. In a trip with the setting off (including every trip saved before the setting existed) the page makes no Google request at all and shows no Google controls. See [google-places-ui-kit.md § Monthly allowance gate](google-places-ui-kit.md#monthly-allowance-gate).
- Links inside plan cards, recommendation cards, credits and map popups are ordinary native links. A click, Enter, Ctrl/Meta/Shift-click, middle-click or long-press acts on the link itself and never toggles or selects the card. A background refresh that arrives while a link is being pressed waits until the browser has activated that link. Location text uses the existing validated map destination where unambiguous; descriptions, reviews and notes support safe HTTP/HTTPS raw URLs and inline Markdown links, with ordinary text escaped. See [card text links](card-text-links.md).

Timeline summary tags have two rows:

1. period chip, then detailed time;
2. type chip, participant chip when not everyone, Booked chip, then any remaining status chips.

Use a light, visually distinct participant color. Do not reuse the period green. Expand an always-together participant group when a member alias is used. Omit the participant chip when all groups attend.

Do not duplicate a restaurant in Food notes when it is already a plan.

## Mobile planner

- The dedicated `?view=plan` page uses the map as the background and a rounded itinerary sheet above it.
- Keep date controls inside the sheet.
- The sheet exposes three snap states: itinerary, balanced, and more map.
- Move the sheet only after a real vertical swipe. A tap or movement below the drag threshold must move it zero pixels.
- Do not show a black focus/active border after touching the handle.
- Keep keyboard Arrow/Page/Home/End resizing for accessibility.
- Do not let timeline scrolling drag the sheet.
- Reframe map markers after every snap, resize, rotation, or day change.
- Keep dialogs and close buttons inside iPhone safe areas.
- Keep native date inputs within the dialog's content width on iPhone. Preserve the operating-system date picker.
- Prevent page-level pinch zoom and canvas drift while leaving map gestures functional.
- Do not add a bottom filler panel. Extend scrollable itinerary content to the visible safe area without moving the map/sheet border.

## Add and edit plan

Show only:

- name;
- part of day;
- time dropdown;
- plan type;
- Booked / not booked;
- optional full Google Maps browser place URL;
- self-hosted, when lookups are enabled: an explicit public-place search and a separate photo search;
- self-hosted, when the optional Google Places UI Kit is enabled: an optional **Google place details** link for a plan with a location;
- What to know.

When a full place URL is supplied, parse and save place name, address, final POI coordinates, feature ID, and original URL, then update the timeline and map. When it is blank and no place has been selected, save a timeline-only plan with no marker or Maps action. Preserve legacy coordinates only when editing an older item that already has coordinates but no URL.

Self-hosted place and photo search applies only when the operator has enabled it, and only for owners, content managers and current trip creators ([place-and-photo-lookups.md](place-and-photo-lookups.md)):

- A place lookup runs only on an explicit **Search** or **Refresh**. There is no autocomplete or search-as-you-type. Candidates show name and address, and the user picks the exact place. Nothing is chosen automatically.
- Photo search is independent of place search. Each candidate shows its credit and license. The chosen photo is labelled as representative until the user confirms it is relevant.
- **Save** stores the selected `place` (with mirrored `lat`/`lng`/`address`) and `photo` snapshots through the normal versioned change. **Cancel** or closing the dialog leaves the trip unchanged.
- Opening the editor, the trip page, reloads, polls and unrelated edits render the saved snapshots and make zero place or photo search calls. There is no background refresh. Remote images and map tiles are still fetched normally. A missing or broken image shows the no-photo state without retrying a lookup.
- Saved OSM attribution and photo credit, source and license are displayed.
- With lookups disabled, or for viewers, no search control is usable. Saved places and photos still render.

The optional Google place link is self-hosted only, off by default, and for owners, content managers and current trip creators only ([google-places-ui-kit.md](google-places-ui-kit.md)):

- It is available only for a plan with a location. Opening the editor sends nothing. Google work happens only while the location is being created or changed, or after an explicit **Find on Google** / **Choose a different Google place**.
- The public-venue box must be ticked before anything is sent, and only the dedicated, initially empty query field is sent. Text with an email address or a long digit run is refused.
- Google's own selectable list is shown, and nothing is linked until the user picks a result; there is no first-result or automatic match. A pasted Google Maps link with a place ID is previewed, then linked with **Use this place**. Every new search text and every preview reserves one allowance unit first; a denial builds and sends nothing.
- **Save** stores only `googlePlaceAssociation` (Place ID, location binding, public-venue flag). Changing the location discards a pending choice and drops the saved link on Save. **Cancel** saves nothing. **Remove Google link** deletes it.
- The Google section appears only in trips whose **Edit trip** setting is on. With it off, the plan editor shows no Google controls; saved links are kept and are still validated against the plan's location.

## Edit trip: Google place details setting (self-hosted)

- **Edit trip** (home page and trip page) and **Create trip** show one accessible checkbox, **Show Google place details and photos in this trip**, with a short hint, in all four languages. It is off for new trips and for trips saved before it existed.
- Only the owner, content managers and current trip creators can change it; joined read-only members never see it, and the server refuses it from joined read-only members, anonymous, pending and revoked users even for a forced request. It is trip content, not an account or security permission.
- It can be saved while the site-wide Google feature is off, but has no effect until the owner also enables that feature with a browser key. It never turns the site feature on.
- Turning it off keeps every saved Google link, OSM place and photo. Open pages see the change on their next poll: Google details and any open Google search are removed, pending Google loading is abandoned, and late results are ignored.

## Recommendations

- Keep Nearby ideas collapsed by default. Hide the section, without placeholder content, when a day has no recommendations.
- Legacy generator builds provide at least five eat, five see/go, and five buy cards for every day. Self-hosted drafts may have none.
- Show a preview photo, short reason, exact Google Maps link, and current rating when available.
- Use three cards per row on wide desktop and two per row on iPhone.
- Keep cards compact and aligned across languages.
- Do not build or request recommendation images until the section is first opened.

## Resources page

- Put detailed payments and useful local iOS apps on the separate page.
- Include only methods and apps relevant to the route.
- Use official sources for facility payment support and direct Apple App Store links.
- Keep the app page traveler-focused; no implementation notes or account explanations.

## Drafts, translations and ordering

- A trip with no dates, plans, photos, weather, recommendations, or translations renders without errors. Empty sections show nothing, or a short neutral prompt for adding content. They never show invented travel facts.
- Editing a plan's name or notes, a day's text, or a reminder's item invalidates the dependent translations. The other three languages then show the new source text instead of the stale translation.
- Changing a plan's time updates `sortTime`/`sortOrder`, so the saved order matches the displayed order after reload, in every language, and for every client.

## Synchronization and install: self-hosted

- The server is authoritative. The browser and MCP use the same service and see the same data.
- Browser edits send versioned, idempotent change batches. A 409 conflict reloads the trip and shows an explicit message. The UI applies a change only after the server confirms it.
- Open pages poll at a bounded interval with backoff. They reconnect after an initial connection failure or after a later disconnect, on the `online` event or a manual retry.
- During a transient network loss, an open page keeps its last trip in memory, clearly marked as not current. Writes are disabled or fail visibly. There is no offline edit queue and no persistent protected cache. Signing out clears page memory.
- The resources page (`/resources.html?tripId=<id>`) authenticates and loads only that trip's resources.
- Private photos (`/photos/<file>`, stored in `SHARED_TRIP_DATA_DIR/photos`) load only for signed-in owners and approved accounts and are never cached by the service worker.
- Install: one app identity. Show the native install prompt where supported and Add to Home Screen guidance on iOS.

## Synchronization and install: legacy generator

- Optional Firebase anonymous authentication with one shared Firestore document; without Firebase, local-only preview storage.
- The first authenticated client may create a missing document. Checklist and itinerary edits synchronize.
- Treat this as link-based trust: anyone who can access the app may be able to edit. It is not private account-based access control.
- Keep the Firebase web config and document path out of prose, but do not mislabel them as secrets.
- Cache the written shell and core assets with a service worker. Online maps, weather, and remote photos may need connectivity.
- The iOS home-screen name may truncate because the operating system controls its font and layout; use a concise `shortName`.

## Regression checklist

- Four languages render without shifting boxes, clipping dates, or translating the brand.
- Every supplied plan link and every recommendation link opens an exact place page.
- Every mapped plan marker matches its exact link or its selected OpenStreetMap place coordinates. A plan with neither a link nor a selected place has neither a marker nor a generated Maps action. An OSM place's navigation action is coordinate-based and is not labelled as a Google venue.
- Self-hosted lookups: off by default; with them disabled, both search endpoints refuse requests and contact no provider. When enabled, only the owner, content managers and current trip creators can search, with same-origin checks; joined read-only members, MCP tokens and OAuth tokens are refused. A search changes no trip or version. Save persists exactly the chosen `place`/`photo` with `expectedVersion`/`requestId`; Cancel persists nothing. Opening, reloading, polling and unrelated edits make zero search calls. Repeats are served from the cache and Refresh bypasses it. Upstream requests are serial, at least 1,100 ms apart, time-limited and size-bounded, never use a client-supplied URL, and follow no redirects. Import and export carry snapshots without lookups. MCP keeps exactly six tools, and `apply_trip_changes` accepts the same objects.
- Self-hosted Google Places UI Kit: off by default. Disabled or keyless means no session flag, no reservation, no Google script, no component and no query, with OSM and Commons unchanged. The browser key comes only inside a granted, no-store allowance reservation for a signed-in browser session, never from `/api/google-places/config` and never for the owner bearer or MCP/OAuth tokens. It is never in static assets, trip data, exports, storage or logs. Only standard compact details and selectable search elements are used, and the app never reads shadow DOM or any place field except the selected ID. Components are built lazily for the expanded plan only, deduplicated across re-renders, polls and unrelated edits, and bounded in memory. `googlePlaceAssociation` stores exactly the Place ID, location binding and public-venue flag. It is refused when malformed or mismatched, and dropped when the location changes or is cleared, through web and MCP. It survives export/import, and IDs, conflicts and retries are unchanged. Viewers can see but not change it. The static generator never loads Google.
- Self-hosted Google allowance: no allowance unless `SHARED_TRIP_GOOGLE_MONTHLY_ALLOWANCE` (at most the verified 10,000 free Query cap) and `SHARED_TRIP_GOOGLE_ALLOWANCE_HEADROOM` (at least 1, smaller than the allowance) are both set and an operator created the ledger with the offline CLI; out-of-bounds values are invalid and disable Google work; at most allowance − headroom reservations per America/Los_Angeles month, shared by all users, tabs and trips, atomic under concurrency, never refunded; a recorded count above the limit simply leaves no capacity. Viewers may reserve only saved, current details; search and preview need an editor; anonymous, pending, revoked, owner-bearer, MCP and OAuth callers are refused. A reservation changes no trip or version. A retried key returns the same single permit with no extra validity; another input is 409. A missing, corrupt or inconsistent ledger (including missing month or baseline records, checked at start-up and in every transaction), invalid configuration, unusable time-zone data, an implausible clock, a clock behind the ledger or a clock jump refuses new Google work while reading and editing keep working; nothing re-creates the ledger, a month or a baseline at zero. Clock faults are recorded in the ledger and survive restarts and other connections until an explicit `reconcile-clock`, which never lowers a count; a process that starts in a month without a record never starts it by itself, while a process running continuously across the reset does. Configuration and key changes never reset counts, and lowering the limit denies at once. Trip backup and restore never touch the ledger. In the page, the SDK bootstrap and every details construction, search query, preview, retry and re-instantiation dispatch only after a synchronous check of their own unused, unexpired, current-month permit on a trustworthy monotonic clock, in a visible tab, with the caller's state still current; components are never reparented: they are hidden and reused in their original, still-connected host, and a background rebuild that removes a host disposes the component without reconnection and offers an explicit control; unrelated renders reserve and build nothing; denials show a translated status with zero Google activity.
- Self-hosted per-trip Google setting: `googlePlacePhotosEnabled` is exactly `true` or `false` (strings, numbers, `null` and objects are refused on update_trip, replace_content, create and import, over HTTP and MCP). Missing means `false`, for new trips and for trips stored earlier; reading never rewrites a stored row, and the next ordinary write stores the explicit value. Trips are independent. Owner, content managers and current trip creators may change it; joined read-only members, anonymous, pending and revoked users cannot. Batches stay atomic, stale `expectedVersion` is 409 and an identical `requestId` retry replays. Google activity needs the site flag, a configured key, the trip setting and a granted allowance reservation together; any one missing means zero scripts, library imports, components and queries for that trip (and, without the first three, zero reservation requests). Turning it off preserves associations, OSM and Commons data and IDs, and stops new Google work on open pages at the next poll.
- Card links: Google Maps, OSM source, photo credit/licence, recommendation and booking/resource links keep their `href`, `target="_blank"` and `rel="noopener noreferrer"`; only http(s) and root-relative URLs become links (`javascript:`, `data:` and similar stay text), Google Maps URL validation is unchanged, and links are never emulated with `window.open`. A press on a link does not start a sheet or card gesture, and polls, focus refreshes and resource-page reloads wait until that press has ended.
- All plan photos and credits render; missing photos fail gracefully.
- Tap-only handle interaction does not move the sheet.
- Add/edit close controls remain reachable on iPhone.
- Self-hosted: two independent signed-in browsers, plus an MCP client, see each other's edits. A stale edit is rejected without loss. A signed-out browser cannot open any `/trips/<id>`.
- Self-hosted: stopping and restarting the service keeps trips, IDs, URLs, and viewer accounts. Taking the server offline shows reconnecting or failed states, never false saves. After a hard kill, the next start acquires data-directory ownership without any file being deleted by hand.
- Self-hosted accounts (schema v7): anonymous/pending/revoked callers retrieve no private content. Ordinary accounts read/export only joined trips and their bound media, may create a trip and edit it as creator, and cannot import or administer accounts. Explicit schema-v8 multiuser OAuth permits their own read-only grants without promotion. Existing and future content managers require membership; only the owner administrator has all-trip access. Assistants require ordinary membership rows and are not automatically enrolled in future trips created by others. Participants are account memberships, independent of itinerary groups. Creator trip codes join one approved account and expire/revoke; they do not enroll accounts. The [membership contract](trip-membership.md) defines revision conflicts, durable retries, bounded abuse controls, migration/rollback and timezone landing. No live permission change occurs before confirmation.
- Self-hosted content managers: approved content managers read/media/export/edit/delete content/archive/restore member trips only through web and existing MCP credentials. Future trips require explicit membership too. Creating/importing enrolls the creating account in its own new trip. Only the owner administrator has all-trip access. Assistants have no special bypass. Account administration, account-enrollment invitations, roles, tokens and audit routes are refused for them. Trip-code management requires current creator or owner authority. Their browser session never authorizes `/mcp`, and their MCP token authorizes nothing but `/mcp`. A role change or revoke ends their sessions and tokens. Upgrading leaves existing accounts as viewers.
- Self-hosted owner deletion (schema v6): only the owner session (same Origin) or admin bearer can `DELETE /api/trips/<id>` with `{requestId, expectedVersion}`, for active or archived trips. Content managers, viewers, pending/revoked accounts, MCP tokens, OAuth tokens and MCP itself cannot delete; MCP keeps exactly six tools. A stale version is 409. An identical retry returns the original `{deleted, tripId, version}`, and a reused request ID with other input is 409. Afterwards reads, edits and stale create/import/change replays return 410 `trip_deleted` without returning content or recreating the trip, and a tombstoned ID is never reused by import. Deletion, tombstone, retry-record redaction and the audit entry commit or roll back together. Other trips, accounts, credentials, grants, photos and existing backups are unchanged. The offline CLI refuses while the service runs and deletes only after a validated new backup.
- Self-hosted OAuth (schema v8): [independent account consent](oauth-multiuser.md) is explicitly enabled with `SHARED_TRIP_OAUTH_MULTIUSER=1`. Approved Members receive `trips:read` (three tools); managers may consent to read or `trips:manage` (six tools). Each operation rechecks current role, grant scope and trip membership. Legacy mode preserves the configured singleton manager and refuses grants when unset. No account is approved or promoted by consent. Existing clients/grants remain valid. PKCE S256, CSRF/state, exact redirect/resource checks, rate limits, single-use codes, independent refresh rotation/replay revocation and the absolute 90-day horizon remain enforced. OAuth authorizes no website/API/media/admin route. Schema-v8 restore and rollback retain scope ceilings and membership enforcement. Admin bearer and content-manager tokens keep working unchanged.
- Legacy Firebase builds only: the first Firestore create and two-client live updates work.
- Weather freshness and plan update timestamps are current.
- Long trips expose every equal-height compact weather date card through horizontal scrolling. Each card has one aggregate day row, and the per-date timetable icon opens a contained, scrollable details dialog on desktop and iPhone without shifting the page. Location chips switch one semantic hourly table at a time while preserving dialog scroll and returning focus to the opener.
- Native date inputs never widen a dialog or extend beyond the iPhone viewport.
- Closed checklist is compact above weather at desktop and phone widths; neither forces the other to grow.
- A warm day/language change retains the Leaflet map and tile layer and does not reload unchanged tiles or full-size source photos.
- A metadata-only synchronization event updates status without rebuilding the page.
- Checklist items can be created before, during, or after the trip, and trip-date items appear in the matching itinerary day.
- No developer-facing sentences, personal booking references, or citations clutter traveler content.

## Verification status

Record each check as one of: **specified** (a test or procedure exists), **run** (executed, with recorded evidence), or **not verified**. This document specifies behavior. It is not evidence that any check passed. Pass/fail results belong in the coordinator's recorded run evidence or a progress report.

| Area | How it is checked | Initial status |
| --- | --- | --- |
| Trip membership, creator/admin assignment, digest-only trip codes, media/HTTP/MCP isolation, scoped retries, v6 upgrade/restore and timezone login landing | `npm run test:membership`; full server/UI regression; `scripts/test-trip-members-browser.mjs` with an existing Playwright module | Local fictional HTTP/SQLite/official MCP SDK, DOM and Chrome mobile/touch checks run. Live rollout/membership mapping requires confirmation; physical Android is not verified. See [membership contract](trip-membership.md). |
| API, SQLite, auth, conflicts, retries, migrations, backup/restore, import/export | `npm run test:server` (fictional temporary storage) | Specified; see run evidence |
| Viewer accounts, invitations, revocation, negative access, v2→v4 upgrade | `npm run test:server` account tests; `npm run test:ui` account UI simulation | Run locally; see [checkpoint 006](../doc/Progress/progress_2026_10_15_cpx006_codex_b.md). |
| Content-manager role, owner role/token controls, one-time token display and clearing | Server suite for the API; `node scripts/test-content-manager-ui.mjs` home-page DOM simulation (jsdom, no layout) | Run locally with real HTTP/MCP and jsdom; Chrome fictional role fixtures cover layout and interactions. See [checkpoint 006](../doc/Progress/progress_2026_10_15_cpx006_codex_b.md). Live credential provisioning remains owner-controlled. |
| Data-directory ownership: hard kill/restart, contention, restore exclusion, foreign locks | `npm run test:server` ownership tests | Windows and isolated Linux container checks passed; automatic crash recovery is recorded in the [container report](../doc/Progress/progress_2026_10_14_cpx003_codex_b.md). Actual app restart and live snapshot/separate restore with fictional data passed in the [live report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md). |
| MCP protocol round trip | Official SDK client in server tests and `scripts/mcp-smoke.mjs`; private live harness | Local HTTP and actual external HTTPS SDK round trips passed with the owner bearer; see the [live report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md). Content-manager tokens, import_trip and export_trip have no live HTTPS evidence. Named external AI-client integration remains unverified. |
| OAuth metadata, registration, consent, token rotation, revocation, grant expiry, v4→v5 upgrade | Server suite (fictional temporary storage) | Local HTTP, official SDK OAuth/automatic refresh, cleanup/replay, migration/restore and Chrome fixture checks passed; see [checkpoint 008](../doc/Progress/progress_2026_10_15_cpx008_codex_b.md). Production-image Linux checks, migration/preservation and live HTTPS discovery also passed; see [checkpoint 009](../doc/Progress/progress_2026_10_15_cpx009_codex_b.md). Actual ChatGPT acceptance remains pending. |
| Owner-only permanent deletion, tombstones, retry redaction, v5→v6 upgrade, offline delete CLI | `node scripts/test-owner-delete.mjs` (in `npm run test:server`); `node scripts/test-owner-delete-ui.mjs` (in `npm run test:ui`) | Backend and DOM checks passed; browser/device layout remains unverified. |
| OAuth with an actual ChatGPT client (owner-configured, account sign-in and consent) | Real client connection to an authorized host | **Not verified**; pending owner-controlled setup. |
| Legacy generator and template | `npm test`, demo rebuild, fresh-folder generation and `qa-static` | Specified; see run evidence |
| Desktop and phone-width UI | Manual or automated browser at the widths in [responsive-performance.md](responsive-performance.md) | Chrome desktop and phone emulation checks are recorded in the [live report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md); physical-phone installation and full touch regression remain unverified. |
| Physical iPhone install and gestures | Real device | **Not verified** |
| Third-party AI clients and hosted connectors | Real account connection | **Not verified** |
| Docker build, Compose + Caddy template, external HTTPS and MCP | Authorized host, [deploy/README.md](../deploy/README.md) | Build, isolated Linux role/MCP tests, migration, app upgrade and anonymous HTTPS checks passed; see [checkpoint 007](../doc/Progress/progress_2026_10_15_cpx007_codex_b.md). Live content-manager authentication remains pending. |
| External map tiles and other providers in a browser | Live browser session | OSM tiles and a Commons image loaded in the local fictional check; other providers are not covered. See [checkpoint 014](../doc/Progress/progress_2026_10_15_cpx014_codex_b.md). |
| Place/photo lookups: opt-in gate, roles, same-origin, cache/Refresh, spacing/timeouts, zero lookups on display, Save/Cancel, `place`/`photo` validation, import/export | `scripts/test-place-lookups.mjs` and `scripts/test-place-picker-ui.mjs`, included in `npm test` | Passed with mocked providers; see [checkpoint 014](../doc/Progress/progress_2026_10_15_cpx014_codex_b.md). |
| Place/photo editor layout and remote image fallback in a browser | Desktop and phone-width browser on fictional data | Local Chrome passed at 1280, 390 and 375 px in four languages. Physical-phone gestures and installation remain unverified. See [checkpoint 014](../doc/Progress/progress_2026_10_15_cpx014_codex_b.md). |
| Google Places UI Kit: configuration gate, protected key delivery, association validation/clearing, MCP, import/export, retries | `scripts/test-google-place-association.mjs`, included in `npm run test:server` | Run: passed in the full regression recorded in [checkpoint 017](../doc/Progress/progress_2026_10_16_cpx017_codex_b.md) (CP017), with no real key or Google request. Amended by the allowance change (key-free configuration route, refused reservation while unconfigured); the amended file is not yet re-run. |
| Google Places UI Kit page behaviour: disabled zero activity, lazy single-plan loading, dedupe counts, retention, stale/cross-trip scoping, failure without retry, public-venue guard, user-only selection, cancel/location-change invalidation, four languages, phone host, static generator | `scripts/test-google-places-ui-kit.mjs` with a mocked Google library, included in `npm run test:ui` | Run: passed at [CP017](../doc/Progress/progress_2026_10_16_cpx017_codex_b.md) together with the mocked-Google local-browser acceptance. The per-trip amendment opts this suite's fixture in and adds loader-cancel checks; that amended version also passed the full regression at [CP018](../doc/Progress/progress_2026_10_16_cpx018_codex_b.md). |
| Per-trip Google setting: strict boolean on every write path, default off for new and stored-earlier trips (read, write, restart, export/import, no rewrite on read), independence, roles (owner/manager allowed; viewer, anonymous, pending, revoked refused), atomicity, conflicts, retries, six MCP tools, saved-but-inert while the site feature or key is off, OSM/Commons/IDs/associations preserved | `scripts/test-google-place-photos-trip.mjs`, included in `npm run test:server` | Passed locally in the full regression; see [checkpoint 018](../doc/Progress/progress_2026_10_16_cpx018_codex_b.md). |
| Per-trip Google setting in the trip page: zero Google activity for old/false/site-off trips, opted-in lazy loading without duplicates, poll opt-out clearing shown/pending work and ignoring late events, cancelled first load, loader reuse after opting in again, Edit trip checkbox (four languages, accessible, sent only when changed, absent for viewers); card-link regression (mouse, Ctrl/Meta/Shift, middle, keyboard, touch; unsafe URLs; summary, marker and sheet handle still work) | `scripts/test-trip-google-setting-and-links-ui.mjs` (jsdom, mocked Google, simulated input), included in `npm run test:ui` | Passed locally in the full regression; see [checkpoint 018](../doc/Progress/progress_2026_10_16_cpx018_codex_b.md). |
| Home page: Create/Edit trip checkbox (four languages, off by default, sent only when changed) and trip-card link regression for a focus/poll reload during a press | `scripts/test-home-trip-setting-and-links-ui.mjs` (jsdom against the local server, simulated input), included in `npm run test:ui` | Passed locally in the full regression; see [checkpoint 018](../doc/Progress/progress_2026_10_16_cpx018_codex_b.md). |
| Card links and the per-trip checkbox in Chrome | Fictional local service, Google mock, local navigation targets; 1280 x 900, 390 x 844 and 375 x 812 | Passed: independent defaults/on/off, retained saved content, lazy reuse, native Enter/middle-click and planner Control-click/new tab. Four-language phone setting fits. Touch and refresh races use DOM simulation; physical touch during a poll remains untested. See [CP018](../doc/Progress/progress_2026_10_16_cpx018_codex_b.md). |
| Google allowance ledger and reservation route: Pacific months/DST, configuration bounds, CLI (including `reconcile-clock`), roles, invalid payloads, shared count, concurrent last unit (HTTP and worker threads), idempotency across restarts, lost responses, month margins, durable clock faults, unconfirmed months, in-process rollovers, missing month/baseline records, configuration/key changes, missing/corrupt/inconsistent ledgers, backup/restore | `scripts/test-google-allowance.mjs`, included in `npm run test:server` | Specified (fictional data, injected clocks). An earlier draft passed locally; the corrected version is **not yet run**. |
| Browser allowance gate: permits before the SDK bootstrap and every details/search/preview dispatch, permit month/binding checks, monotonic clock corroboration, expiry, replay, transport retry, denials with zero Google activity, cancellation, opt-out, sign-out, hidden tabs, no reparenting and no reconnection after a background rebuild | `scripts/test-google-places-allowance-ui.mjs` (jsdom), plus the amended page suites above, included in `npm run test:ui` | Specified; being corrected separately after its first run failed; **not yet passing**. The amended `test-google-places-ui-kit.mjs`, `test-trip-google-setting-and-links-ui.mjs` and `test-google-place-association.mjs` are also not yet re-run. |
| Real Google SDK rendering, attribution, metering, re-request behaviour and billing; key restrictions; browser layout | Owner-configured live browser check ([google-places-ui-kit.md § Owner setup](google-places-ui-kit.md#owner-setup-pending-not-done)) | **Not verified**; pending owner actions. No live Google SDK or billing has been exercised. |
| Live Nominatim and Commons requests | Local opt-in integration and restricted production egress using public research queries | Both returned 200 locally and from the deployed app container. Unrelated egress and direct bypass were denied. See [checkpoint 014](../doc/Progress/progress_2026_10_15_cpx014_codex_b.md) for local cache/restart checks and [checkpoint 016](../doc/Progress/progress_2026_10_15_cpx016_codex_b.md) for deployment, preservation and isolated production-image browser acceptance. |
