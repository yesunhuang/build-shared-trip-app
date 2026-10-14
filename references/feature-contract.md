# Feature contract

Preserve these behaviors unless the user explicitly requests a design change. The trip-page UI is shared by two modes:

| | **Self-hosted (default)** | **Legacy generator (opt-in)** |
| --- | --- | --- |
| Apps | One service and one PWA for all trips | One generated static app per trip |
| Data | Server SQLite, authoritative | Embedded seed, plus local preview storage or optional Firebase |
| Access | Owner admin token, plus owner-approved read-only viewer accounts; sign-in for every trip and API | Link-based trust (Firebase) or none (local) |
| Sync | Bounded polling and reconnect | Firestore listener, or none |
| Offline | Generic shell only; protected data stays in page memory | Cached itinerary shell |
| Validation | Draft structure | Complete authoring checks |

## Self-hosted home and trip switching

- `/` shows sign-in when signed out: a viewer username/password form, a separate **Owner sign-in** with the admin token, and a *Have an invitation?* form. That form takes an invitation code, a username, and a password, and creates a pending account. No invitation URL or self-approval exists.
- Signed in as owner, `/` lists trips (archived trips separately or behind a filter) with controls to create, import, edit metadata, archive or restore, export, and open each trip. A *Viewer accounts* section creates single-use invitations, showing each code once, lists pending, approved, and revoked accounts, and approves or revokes them.
- Signed in as an approved viewer, `/` lists the same trips with open and export controls only, plus a read-only note. Create, import, edit, archive, and account controls are absent. The server enforces the same permissions independently of the UI.
- Each trip opens at `/trips/<trip-id>`, which stays the same through renames and upgrades. The trip page has controls for *All trips*, editing the trip, adding a date, exporting, and signing out. For viewers, the editing controls (trip edit, add date, add/edit plan, checklist changes) are absent or disabled.
- An unknown trip ID shows a not-found state, and a signed-out visit shows a sign-in state. It never falls back to another trip or to demo data.
- The manifest `id`, `start_url`, and `scope` are `/` with a generic stable name, so switching trips never needs reinstalling. The service worker caches only generic static assets. It never caches `/api`, `/mcp`, protected trip navigations, or trip payloads.
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
- A map-marker selection opens and scrolls to the corresponding plan.
- On desktop, give the map a substantial sticky column (roughly 44–48% of the workspace) and a viewport-aware height. Keep the timeline readable; do not shrink the map into a thumbnail. Below the desktop breakpoint, preserve the dedicated mobile planner.
- Show checklist items due on the selected itinerary date near the top of that day's content, before the timeline. Checklist dates may be before, during, or after the trip.

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
- What to know.

When a full place URL is supplied, parse and save place name, address, final POI coordinates, feature ID, and original URL, then update the timeline and map. When it is blank, save a timeline-only plan with no marker or Maps action. Preserve legacy coordinates only when editing an older item that already has coordinates but no URL.

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
- Private photos (`/photos/<file>`, stored in `SHARED_TRIP_DATA_DIR/photos`) load only for signed-in owners and approved viewers and are never cached by the service worker.
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
- Every mapped plan marker matches its exact link; a plan without a link has neither a marker nor a generated Maps action.
- All plan photos and credits render; missing photos fail gracefully.
- Tap-only handle interaction does not move the sheet.
- Add/edit close controls remain reachable on iPhone.
- Self-hosted: two independent signed-in browsers, plus an MCP client, see each other's edits. A stale edit is rejected without loss. A signed-out browser cannot open any `/trips/<id>`.
- Self-hosted: stopping and restarting the service keeps trips, IDs, URLs, and viewer accounts. Taking the server offline shows reconnecting or failed states, never false saves. After a hard kill, the next start acquires data-directory ownership without any file being deleted by hand.
- Self-hosted accounts: an unauthenticated, pending, or revoked user cannot retrieve trip lists, trips, exports, or `/photos/*` through any route. An approved viewer can read and export but every write, import, account route, and `/mcp` is refused. Revocation ends open sessions at their next request, and reapproval does not revive them. An invitation code works once and expires.
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
| API, SQLite, auth, conflicts, retries, migrations, backup/restore, import/export | `npm run test:server` (fictional temporary storage) | Specified; see run evidence |
| Viewer accounts, invitations, revocation, negative access, v2→v3 upgrade | `npm run test:server` account tests; `npm run test:ui` account UI simulation | Specified; see run evidence |
| Data-directory ownership: hard kill/restart, contention, restore exclusion, foreign locks | `npm run test:server` ownership tests | Windows and isolated Linux container checks passed; automatic crash recovery is recorded in the [container report](../doc/Progress/progress_2026_10_14_cpx003_codex_b.md). Actual app restart and live snapshot/separate restore with fictional data passed in the [live report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md). |
| MCP protocol round trip | Official SDK client in server tests and `scripts/mcp-smoke.mjs`; private live harness | Local HTTP and actual external HTTPS SDK round trips passed; see the [live report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md). Named external AI-client integration remains unverified. |
| Legacy generator and template | `npm test`, demo rebuild, fresh-folder generation and `qa-static` | Specified; see run evidence |
| Desktop and phone-width UI | Manual or automated browser at the widths in [responsive-performance.md](responsive-performance.md) | Chrome desktop and phone emulation checks are recorded in the [live report](../doc/Progress/progress_2026_10_14_cpx004_codex_b.md); physical-phone installation and full touch regression remain unverified. |
| Physical iPhone install and gestures | Real device | **Not verified** |
| Third-party AI clients and hosted connectors | Real account connection | **Not verified** |
| Docker build, Compose + Caddy template, external HTTPS and MCP | Authorized host, [deploy/README.md](../deploy/README.md) | **Not verified** until run on that host |
| External map tiles and other providers in a browser | Live browser session | **Not verified** until recorded |
