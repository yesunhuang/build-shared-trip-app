# Google Places UI Kit (self-hosted, optional, off by default)

The self-hosted trip page can show Google's own standard **Place Details (compact)** component inside an expanded plan card. It does this for a plan that an editor has deliberately linked to a public business or landmark on Google. The OpenStreetMap map, saved OSM places and Commons photos stay exactly as they are. The feature is **off by default**, needs an owner-supplied browser key that this repository never contains, and does nothing in the legacy static generator.

The automated tests use a mocked Google library. Local browser checks use fictional data and a Google mock, with Google network access blocked. Real SDK rendering and billing remain unverified; see [Verification status](#verification-status).

## Contents

- [What is used, and what is not](#what-is-used-and-what-is-not)
- [What is stored](#what-is-stored)
- [Linking a plan: conservative by design](#linking-a-plan-conservative-by-design)
- [Showing a linked plan](#showing-a-linked-plan)
- [Layout and styling limits](#layout-and-styling-limits)
- [Network, privacy and caching](#network-privacy-and-caching)
- [Usage and cost](#usage-and-cost)
- [Configuration](#configuration)
- [Future owner setup (pending, not done)](#future-owner-setup-pending-not-done)
- [Verification status](#verification-status)
- [Sources (read 2026-10-15)](#sources-read-2026-10-15)

## What is used, and what is not

Only **standard** Places UI Kit elements are created, from the Maps JavaScript API library loaded with `google.maps.importLibrary("places")`:

| Element | Where | Markup |
| --- | --- | --- |
| `PlaceDetailsCompactElement` | Expanded plan card, and the editor's Place ID preview | `<gmp-place-details-compact orientation="vertical">` with `<gmp-place-details-place-request place="PLACE_ID">` and `<gmp-place-content-config>` containing `<gmp-place-media>`, `<gmp-place-address>` and `<gmp-place-attribution>` |
| `PlaceSearchElement` | Plan editor only, after an explicit search | `<gmp-place-search selectable>` with `<gmp-place-text-search-request text-query="…" max-result-count="5">` and a content config with address and attribution |

Both are billed under **Places UI Kit Query (Essentials), global SKU 0678-4F72-DA7C**, according to Google's overview as read on 2026-10-15.

Never created or called: `AdvancedPlaceDetails*`, `AdvancedPlaceSearch*` or `AdvancedPlaceList` (Pro), a Google map, the raw Places API, `Place.fetchFields`, the Place Photos API and Autocomplete. The app listens to `gmp-load`, `gmp-error` and, in the editor, `gmp-select`. From a selection it reads only `event.place.id`. It never opens a component's shadow DOM, reads its images, photo bytes, photo URLs or resource names, or reads any other Place field. No advanced photo, review or button options are set.

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

## Linking a plan: conservative by design

The official components expose only a place's ID and a temporary location or viewport to this app. Without raw Places data, which is not used, or reading the component's rendered content, which is not allowed, the app cannot check whether a result's name matches the plan or whether it is truly a public venue. So the app **never links a plan automatically** and never picks the first or "best" search result. It links a place only after an editor's explicit choice. Some plans will deliberately stay unlinked; that is the intended trade-off, not a missing feature.

In **Add/Edit plan**, owners and content managers (never viewers) see an optional **Google place details** section:

1. It is usable only when the plan has a location. Opening the editor sends nothing.
2. Google work happens only when the location is being created or changed in the editor, or when the editor presses **Find on Google** / **Choose a different Google place** to correct a link. A new or changed location opens the form, but still sends nothing by itself.
3. Before anything is sent, the editor must tick *This is a public business or landmark, not a private home or address*. Only the dedicated query field is sent, never the plan name, notes, travelers, private addresses or itinerary. The field starts empty. Text with an email address or a long digit run is refused locally.
4. **Search on Google** shows Google's own selectable list. Nothing is linked until the editor picks a result in that list. Repeating the same text sends nothing new.
5. Alternatively, paste a Google Maps link that names a place ID (`query_place_id=`, `destination_place_id=` or `place_id:`), or the bare ID, and press **Show this place**. The component shows that place; **Use this place** links it after it has loaded. A `/maps/place/…` link carries a feature ID, not a Place ID, and is rejected.
6. **Save** stores the association, bound to the location being saved. If the location changes after a choice, the pending search, preview and choice are discarded. A pending choice that cannot match the final saved location is omitted, and a localized notice asks the editor to select the place again; the other edits still save. **Cancel**, closing the dialog or unticking the public-venue box discards the pending choice; late events from Google's components are ignored. **Remove Google link** deletes it on Save.

MCP clients and agents can store an association through `apply_trip_changes` with the same validation, but there is no Google search tool. Never invent a Place ID or copy one from an unverified source; store only an ID a person chose for that exact public venue.

## Showing a linked plan

- **Lazy.** Opening, reloading or polling a trip makes no Google request and builds no component, whatever the number of linked plans. Expanding a linked plan (or selecting its marker) starts, for the whole page, one same-origin configuration request, one Maps JavaScript script, one `importLibrary("places")` and one component for that plan.
- **One active plan.** Expanding another linked plan parks the previous component hidden but connected, and reuses it if that plan is shown again. An open card whose component is not active offers **Show Google place details** instead of a new request. At most three components are retained; older inactive ones are dropped. No inactive plan is preloaded.
- **Deduplicated.** The library promise, component construction and place-request assignment happen once per trip/plan/Place ID/binding. Repeated expansion, re-renders, language changes, polls and unrelated edits reuse the same element. During a re-render the element is moved with `Element.moveBefore` where the browser supports it, otherwise with an ordinary append. Whether the SDK issues a new request after an ordinary reconnection is SDK behaviour that this app does not control and has not tested.
- **Scoped.** A changed binding, a stale association or another trip never reuses a component. After a poll brings a changed location, the old component is discarded. A re-linked plan waits for an explicit **Show Google place details**.
- **Failure.** On `gmp-error` or no answer within 15 seconds, the card shows *Google place details aren't available right now.* with **Try again**. There is no automatic retry. With the feature disabled or no key, the card simply has no Google section. OSM data, the Commons photo and the no-photo state stay as before. If Google has no photo, the card keeps its Commons photo.
- **No writes.** Viewing never saves anything. Viewers can see a saved link's component but cannot change it.

## Layout and styling limits

- Vertical orientation with natural height: the host is `width: 100%` up to the recommended 300 px, the component never narrower than 160 px, and no fixed height anywhere. The same host sits inside the card body on desktop and in the phone swipe sheet. Horizontal orientation, which hides the thumbnail below 350 px, is not used.
- Only the outer box is styled with supported outer CSS. Google's content, photos and automatic attribution are not altered, extracted, re-hosted or replaced with custom thumbnails or logos.
- The host is a labelled region (*Place details from Google*) with a polite live status line and keyboard-reachable **Try again** and **Show Google place details** buttons. The editor section has a heading, labelled fields, a labelled checkbox, a polite status line, and Enter-to-search that never submits the plan. All copy exists in English, Simplified Chinese, Traditional Chinese and Japanese. The component's own language is taken from the page language when the library first loads.

## Network, privacy and caching

- **Browsers, not the server, contact Google.** The server never calls Google, needs no outbound access (the Compose template's internal-only app network is fine), and caches nothing from Google. Visitors' browsers load the Maps JavaScript API from `maps.googleapis.com`, and the components then make their own requests to Google, including images. Google sees the visitor's IP address, the requested Place ID or search text, and the site origin (the app sends `Referrer-Policy: strict-origin-when-cross-origin`). The app does not promise zero network calls on revisit, and it does not cache photos permanently; any caching is the SDK's and the browser's own behaviour.
- **The key.** The browser key is served only by the protected, no-store `GET /api/google-places/config`, to signed-in browser sessions (owner, content managers, viewers) and the owner bearer. MCP access tokens and OAuth tokens never reach it. It is not in static assets, trip JSON, exports, browser storage, audit entries or logs. `/api/session` carries only the non-secret flag `features.googlePlacesUiKit: true`, and only while the feature is on. A browser key is visible to every signed-in visitor in the script URL by nature, so it must be restricted (see below).
- **Search text.** Editors' queries go to Google from their browser. Never type booking details, travelers' names, private addresses or notes.
- **Service workers.** Neither service worker caches Google responses; the self-hosted worker ignores cross-origin requests.

## Usage and cost

Global pay-as-you-go pricing as read on 2026-10-15 (USD; recheck before relying on it; EEA and volume pricing may differ):

| SKU | Free events per month | Then |
| --- | --- | --- |
| Places UI Kit Query (Essentials), 0678-4F72-DA7C | 10,000, shared by every project on the same billing account | $1.00 per 1,000 events, up to 100,000 |

Usage is per component request or instantiation, not per photo byte. Matching searches and Place ID previews in the editor draw on the **same** SKU and free cap. Monthly cost at the first paid tier is `max(0, total events − 10,000) × $1 ÷ 1,000`.

**Details example.** Suppose all 29 linked plans of a trip are expanded once in one full view, so 29 events per view:

| Full views per month | Detail events | Cost if nothing else uses the cap |
| --- | --- | --- |
| 10 | 290 | $0 |
| 100 | 2,900 | $0 |
| 1,000 | 29,000 | (29,000 − 10,000) × $1 ÷ 1,000 = **$19** |

**Matching, listed separately.** Each explicit search or Place ID preview is roughly one more event; for example, 100 searches and 50 previews in a month are about 150 events. Add matching events, detail events and any other UI Kit usage on the same billing account, then apply the one shared 10,000 cap to the total. For example, 29,000 detail events plus 150 matching events would cost about $19.15.

For a separate initial-linking example, 29 matching searches add 29 Query events: $0 with an otherwise unused allowance, or $0.029 added to 29,000 detail events (combined $19.029, approximately $19.03). Selecting a result uses its exposed ID; an additional Place ID preview is another component request.

Lazy loading avoids up-front component creation. Actual counts depend on cards opened, reloads, retention evictions, explicit retries and SDK reconnections. Google's metering has not been tested. Budgets, alerts and quotas are owner decisions in the Google Cloud console.

## Configuration

| Setting | Default | Meaning |
| --- | --- | --- |
| `SHARED_TRIP_GOOGLE_PLACES_UI_KIT` | Unset (off) | `1` opts in. `0`, empty or unset is off; anything else stops the server at start-up. |
| `SHARED_TRIP_GOOGLE_MAPS_BROWSER_KEY` | Empty | The owner's restricted browser key (30-100 letters, digits, `-` or `_`). The feature stays off without it. It may not equal the admin token. Keep it in the private env file only. |

Off, or on without a key: the session has no feature flag, the configuration route returns `{enabled: false}`, and trip pages fetch no configuration, load no Google script, build no component and send no query. Saved associations remain stored and inert, and import/export keep them. The legacy static generator never enables the feature.

## Future owner setup (pending, not done)

None of these steps has been taken for any deployment. They are owner decisions and actions:

1. Read the current Maps Platform terms, the Places UI Kit policies and pricing linked below, and decide whether to use the feature.
2. In the owner's own Google Cloud project with a billing account, enable the APIs that Google's Places UI Kit setup documentation lists. Consider budgets, alerts and per-day quotas.
3. Create a **browser** API key restricted by website (HTTP referrer) to the exact origin, for example `https://trips.example.org/*`, and by API to only what the UI Kit needs. Never reuse a server key or any other credential.
4. Add `SHARED_TRIP_GOOGLE_PLACES_UI_KIT=1` and the key to the private env file outside the checkout, pass them through the reviewed Compose file, and restart the app.
5. With a fictional trip, check in a real browser at desktop and phone widths: no Google request before a linked plan is expanded, Google's attribution is visible, link/correct/remove behaves as described, and request counts are plausible. Record the evidence separately and do not reuse real trip data for screenshots.

To disable, unset the flag (or the key) and restart. Saved links stay in the trips and reappear only if the feature is enabled again.

## Verification status

| Check | How | Status |
| --- | --- | --- |
| Configuration parsing, protected config route, session flag, key never in trip/static/audit output; association validation, stale clearing, retries, conflicts, MCP, import/export | `scripts/test-google-place-association.mjs` (in `npm run test:server`) | Passed locally with fictional data and external-network refusal |
| Zero Google activity when disabled; lazy single-plan loading; construction/assignment/query counts; reuse across re-renders, polls and edits; bounded retention; stale/cross-trip scoping; failure/timeout without retry; public-venue guard; user-only selection; cancel and location-change invalidation; Place ID preview; four languages; phone host; static generator inert | `scripts/test-google-places-ui-kit.mjs` (in `npm run test:ui`), mocked Google library in jsdom | Passed locally with mocked Google services |
| Real SDK rendering, attribution, events and metering; real key restrictions; billing | Owner-configured live browser check | **Not verified** |
| App layout and editor interaction in Chrome; lazy expansion, explicit selection, note edits, cancellation, reload and localization | Chrome at 1280, 390 and 375 px; fictional data, Google mock, Google origins blocked by fixture CSP | Passed; phone widths are browser emulation. Google's own component layout remains unverified |

The full regression, regenerated fictional demo, fresh generation/static QA and acceptance evidence are recorded in [checkpoint 017](../doc/Progress/progress_2026_10_16_cpx017_codex_b.md).

## Sources (read 2026-10-15)

- [Places UI Kit overview](https://developers.google.com/maps/documentation/javascript/places-ui-kit/overview): standard versus Advanced elements and their SKUs.
- [Places widgets reference](https://developers.google.com/maps/documentation/javascript/reference/places-widget): element, request and content-config markup, `gmp-load`, `gmp-error`, `gmp-select`.
- [Place Details element](https://developers.google.com/maps/documentation/javascript/places-ui-kit/place-details): compact widths and orientation.
- [Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms): section 15 (UI Kit with a non-Google map) and section 14 (raw Places API content).
- [Maps JavaScript API policies](https://developers.google.com/maps/documentation/javascript/policies): Place IDs may be stored; other content may not be scraped or persisted.
- [Pricing](https://developers.google.com/maps/billing-and-pricing/pricing) and [SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details): Query (Essentials) free cap and rate.

Recheck provider terms and pricing before activation.
