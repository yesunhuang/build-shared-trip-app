# Build Shared Trip App

**A self-hosted, multilingual travel planner for you and a few companions. One small server holds every trip, invited companions you approve can view them or, if you choose, help edit them, and an MCP endpoint lets an AI you configure read and edit the same itineraries.**

Run one Node.js service on your own machine or a small VPS. From the home page you can create or import trips. Each trip opens at a stable `/trips/<trip-id>` link with the desktop map and timeline, the phone swipe-sheet planner, reminders, weather, and four languages. You install the PWA once and switch between trips inside it. No Firebase account and no separate deployment per trip are needed.

**[Agent entry point → SKILL.md](SKILL.md)** · [Self-hosted guide](references/self-hosted.md) · [MCP](references/mcp.md) · [Agent setup](references/agent-setup.md) · [Interface showcase](showcase/README.md)

Public repository: `https://github.com/yesunhuang/build-shared-trip-app.git`. The source code is public. The trips you store on your server are not: they stay in your own data directory behind sign-in. Publishing the code does not authorize hosting or sharing anyone's trips.

## Quick start (self-hosted, local)

Requires **Node.js 24** (built-in `node:sqlite`).

```bash
git clone https://github.com/yesunhuang/build-shared-trip-app.git
cd build-shared-trip-app
npm ci
export SHARED_TRIP_ADMIN_TOKEN='<choose-a-long-random-local-token>'
export SHARED_TRIP_DATA_DIR="$HOME/.local/share/shared-trip-dev"   # must be outside the repo
npm start
```

Open `http://127.0.0.1:4173/` and use **Owner sign-in** with your token. Create a trip, or import the fictional `assets/trip.example.json`. The service listens only on `127.0.0.1:4173` by default; set `SHARED_TRIP_HOST` or `SHARED_TRIP_PORT` to change that. For remote use, put it behind an HTTPS reverse proxy and set `SHARED_TRIP_ORIGIN`. The [self-hosted guide](references/self-hosted.md) covers configuration, accounts and roles, MCP access tokens, OAuth grants, VPS deployment alongside other services, backups, restores, upgrades, and rollback. A [Docker Compose + Caddy template](deploy/README.md) is included; a fictional live trial passed origin/public HTTPS, HTTP/MCP, account restrictions, uncached responses, app restart and backup/restore checks. See the [live acceptance report](doc/Progress/progress_2026_10_14_cpx004_codex_b.md) and [cache acceptance completion](doc/Progress/progress_2026_10_14_cpx005_codex_b.md) for tested scope and remaining checks. Subsequent content-manager work passed [local acceptance](doc/Progress/progress_2026_10_15_cpx006_codex_b.md) and [Linux migration/deployment acceptance](doc/Progress/progress_2026_10_15_cpx007_codex_b.md). OAuth schema v5 passed [local protocol, migration and browser acceptance](doc/Progress/progress_2026_10_15_cpx008_codex_b.md) and [production-image, migration and live HTTPS discovery checks](doc/Progress/progress_2026_10_15_cpx009_codex_b.md). The existing private plugin was updated in place; actual ChatGPT sign-in, consent and its first read-only tool result remain pending.

| What | How |
| --- | --- |
| Storage | One SQLite database in `SHARED_TRIP_DATA_DIR`, kept apart from code, config, and backups. Optional private photos live in `SHARED_TRIP_DATA_DIR/photos`. |
| Access | The owner's private admin token covers everything, including MCP (bearer header), account administration and browser sign-in. It never works for OAuth sign-in. Companions get a single-use invitation code, choose their own username and password, and can sign in once the owner approves them. Accounts start as **viewers**, who can read and export **all** trips but cannot edit, import, manage users, or use MCP. The owner can make an account a **content manager**, who can create, edit, import, export, archive and restore **all** trips, current and future, but cannot manage accounts, tokens, security or the server. Revocation or a role change ends that account's sessions immediately. Every trip link requires sign-in; there is no anonymous sharing or per-trip membership. |
| Editing | Versioned, atomic change batches. A stale edit is rejected with 409. A retry with the same `requestId` is never applied twice. |
| Sync | Open pages poll the server and reconnect after network loss. Writes need a connection. Protected trips are never kept in a persistent offline cache. |
| AI | Remote MCP over Streamable HTTP (protocol `2025-11-25`) with `list_trips`, `get_trip`, `create_trip`, `apply_trip_changes`, `import_trip`, and `export_trip`. It accepts the owner's admin bearer or an owner-issued content-manager token (fixed 90 days, `/mcp` only, shown once, revocable). For clients that cannot send a custom key, such as ChatGPT, the schema v5 release adds OAuth (scope `trips:manage`, `/mcp` only). OAuth is limited to one content manager that the owner names in `SHARED_TRIP_OAUTH_USERNAME`, and it is denied when that is unset. Browser cookies never authorize MCP. The custom-header path was tested with the official SDK. OAuth passed the local suite and fictional Chrome flow; a real ChatGPT sign-in and consent is pending. No named AI client is claimed. See [mcp.md](references/mcp.md). |
| Recovery | Online validated SQLite snapshots that include accounts, tokens and OAuth grant records. Data-directory ownership is an OS-held lock, so a crashed or killed service can restart without manual lock deletion. Windows and isolated Linux container checks passed, including automatic container recovery after a hard kill, contention and fictional-data preservation. |
| Portability | Import legacy trip JSON or exports, with IDs and translations kept. Export any trip as recoverable JSON. |

## The interface

On desktop, an ordered itinerary sits beside a large sticky map. On phones, the same itinerary lives in a swipeable sheet: pull it down to see the map, or up to read the plan.

![Desktop itinerary and large map](showcase/desktop-itinerary.jpg)

<p align="center">
  <img src="showcase/phone-itinerary.jpg" width="250" alt="Phone planner with the itinerary sheet open">
  &nbsp;&nbsp;
  <img src="showcase/phone-map-expanded.jpg" width="250" alt="Phone planner with its sheet lowered to reveal more map">
</p>

These are rendered views of an earlier single-trip implementation. The phone images were captured at **390 × 844 in a responsive browser**, not on a physical iPhone. They are visual references only; their itinerary is not sample data.

**[Full gallery & verification notes](showcase/README.md)**

### In every trip

- **One timeline** for flights, stays, transport, restaurants, and sights, with optional exact Maps links and placeholder plans.
- **Trip context:** to-dos with flexible due dates, an all-dates forecast strip with hourly details, optional nearby ideas, and a payments & apps page.
- **Four languages:** English, Simplified Chinese, Traditional Chinese, and Japanese. When you edit source text, its outdated translations are cleared and the source text is shown until you translate it again.
- **Drafts welcome:** start with only a title, then add dates, plans, and reminders. Photos, translations, and recommendations are optional while you edit.

## Agents

Read [`SKILL.md`](SKILL.md) first. It defines the self-hosted workflow, privacy boundaries, and verification gates. Do not infer a real trip from the screenshots, and do not deploy without the user's approval and a concrete target.

```text
Read SKILL.md and follow build-shared-trip-app for the attached itinerary.
Use the self-hosted service: create or import the trip through the API or MCP.
Keep uncertain details visibly pending; do not invent bookings or place IDs.
Report which checks actually ran; do not deploy without my approval.
```

## Legacy: static generator and fictional demo

The earlier route generated a separate static app for each trip, optionally backed by Firebase. It is kept as an **opt-in transition tool** and to build the fictional demo. It is no longer the default and does not need Firebase. See [SKILL.md § Legacy generator](SKILL.md#legacy-static-generator-opt-in) and the [Firebase guide](references/firebase-deployment.md), which applies only to that legacy route.

[`docs/`](docs/) contains **Tide Lines**, a fictional two-day trip generated from [`assets/trip.example.json`](assets/trip.example.json). It uses local-only browser storage, so its edits do not sync. To preview it:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000/docs/  or  http://127.0.0.1:8000/showcase/
```

No hosted demo is implied. Publishing GitHub Pages is a separate decision.

```bash
node scripts/validate-trip.mjs assets/trip.example.json --allow-example
node scripts/init-trip.mjs assets/trip.example.json /tmp/tide-lines-demo --allow-example
node scripts/qa-static.mjs /tmp/tide-lines-demo
```

## Maintain the framework

```bash
npm test                  # legacy, server, and DOM-simulation suites together
npm run test:server       # self-hosted HTTP, SQLite, MCP, ownership-lock, and account tests
node scripts/test-content-manager-ui.mjs   # content-manager and owner token home-page simulation
node scripts/build-docs-demo.mjs
node scripts/audit-privacy.mjs . --mode framework
```

Rebuild the demo whenever the template or the fictional input changes. Automated tests do not replace desktop and phone browser checks, real-device installation, or connections from third-party AI clients. Report those separately and honestly.

| Location | Purpose |
| --- | --- |
| [`SKILL.md`](SKILL.md) · [`agents/`](agents/) | Agent instructions and discovery metadata |
| [`references/`](references/) | Self-hosting, MCP, setup, input, UI, performance, privacy, and legacy deployment guides |
| `server/` | Self-hosted Node service, SQLite storage, accounts, API, and MCP |
| [`deploy/`](deploy/README.md) | Docker Compose + Caddy HTTPS template and fictional live-trial evidence |
| `assets/selfhosted/` | Home page, manifest, and service worker for the single installed app |
| [`assets/app-template/`](assets/app-template/) | Shared trip-page UI (also used by the legacy generator) |
| [`assets/trip.example.json`](assets/trip.example.json) | Fictional multilingual fixture |
| [`scripts/`](scripts/) | Tests, MCP smoke test, legacy generation, privacy, photo, and cache tools |
| [`docs/`](docs/) · [`showcase/`](showcase/) | Fictional generated demo and approved screenshots |
