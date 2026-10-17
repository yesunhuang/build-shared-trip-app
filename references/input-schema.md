# Input schema

Schema-v7 [account membership](trip-membership.md) is separate access metadata. Read-only `members`/`access` returned beside a trip are not writable content fields and never belong in `participantGroups`, content imports or exports. All content fields below require the target trip's current editing authority (owner, global content manager or its creator).

Optional trip `cover` and plan `cardCategory` are documented in the [cover and category contract](trip-cover-and-categories.md). Cover is an independent bounded PNG object or null; category is an explicit enum with neutral default. They share canonical HTTP/MCP and authoring-envelope validation, backup/export support and version-aware edits.

Plans also support the optional ordered [related-links collection](plan-related-links.md): at most six stable `{id,label,url}` entries, shared HTTP/MCP validation, native card anchors and authorized-editor controls. Missing means unchanged on a plan patch; `[]` clears it.

This file describes trip content in two forms:

- the **self-hosted canonical trip**, which the server stores, the browser and MCP edit, and import/export carries; and
- the **legacy authoring envelope** read by `validate-trip.mjs` and `init-trip.mjs`. The service can import it.

The two forms share field shapes for days, plans, reminders, localization, maps, photos, weather, and resources. They differ in how strictly they are validated.

## Contents

- [Self-hosted canonical trip](#self-hosted-canonical-trip)
- [Draft validation](#draft-validation)
- [Import mapping](#import-mapping)
- [Authoring envelope](#authoring-envelope) (legacy)
- [Trip and localization](#trip-and-localization)
- [Reminders](#reminders)
- [Days and plans](#days-and-plans)
- [Maps and photos](#maps-and-photos)
  - [Selected OpenStreetMap place (self-hosted)](#selected-openstreetmap-place-self-hosted)
  - [Selected Commons photo (self-hosted)](#selected-commons-photo-self-hosted)
  - [Google place association (self-hosted, optional)](#google-place-association-self-hosted-optional)
  - [Per-trip Google setting (self-hosted, optional)](#per-trip-google-setting-self-hosted-optional)
- [Recommendations](#recommendations)
- [Weather](#weather)
- [Resources](#resources)
- [Synchronization](#synchronization) (legacy)
- [Legacy generator authoring checks](#legacy-generator-authoring-checks)

## Self-hosted canonical trip

The server owns `id`, `version`, and `updatedAt`. Clients never choose a new trip's `id`, and they cannot change it later.

```json
{
  "id": "server-assigned",
  "version": 3,
  "archived": false,
  "updatedAt": "2030-05-01T12:00:00.000Z",
  "title": "Coastal trip",
  "timezone": "Europe/Lisbon",
  "country": "Portugal",
  "dateRange": { "start": "2030-06-01", "end": "2030-06-09" },
  "route": "Lisbon · Sintra · Porto",
  "days": [
    { "id": "day-2030-06-01", "date": "2030-06-01", "label": "Arrive", "area": "Lisbon", "slots": [] }
  ],
  "reminders": [],
  "participantGroups": [],
  "tips": [],
  "i18n": {},
  "googlePlacePhotosEnabled": false
}
```

- `days[].slots` holds plans, using the [plan shape](#days-and-plans) below. A self-hosted plan may also carry a [selected OpenStreetMap `place`](#selected-openstreetmap-place-self-hosted), a [selected Commons `photo`](#selected-commons-photo-self-hosted) and an optional [`googlePlaceAssociation`](#google-place-association-self-hosted-optional). Reminders, participant groups, and `i18n` patches use the same shapes as the legacy input.
- Optional compatibility content, such as `resources`, `weather`, recommendations, and day-level `i18n`, is kept when present. It never needs to be invented.
- Responses also include the read-only aliases `slug` (= `id`), `startDate`, `endDate`, and `routeDecoration` (= `route`) for the shared template. Treat them as read-only; edit `dateRange` and `route` through canonical fields; the ID cannot change.
- `googlePlacePhotosEnabled` is the optional [per-trip Google setting](#per-trip-google-setting-self-hosted-optional): exactly `true` or `false`, `false` when absent.
- Other optional top-level fields: `shortName`, `metaDescription`, legacy `theme` (`ink`/`accent`/`background` hex colors), `branding` ([bounded embedded logo and accessible light theme](trip-branding.md)), `disclaimer`, and `content`. Plans, days, reminders, and groups may carry a `compat` object. Import preserves unmapped nested fields in `compat.unmapped` and unmapped root fields in `content.importExtras`, with warnings.

To change a trip, send operations (`update_trip`, `upsert_day`, `upsert_plan`, `upsert_reminder`, the matching `delete_*` operations, `archive_trip`, and `replace_content`) with `expectedVersion` and `requestId`. See [self-hosted.md](self-hosted.md#http-interface).

## Draft validation

Saving a trip on the service checks the **structure** only. A new trip can start as `{ "title": "…" }`, and the following are all optional while you edit:

- dates and days, which may be added later, up to 31 days per trip (`dateRange` start/end may be empty strings until dates are known);
- plan times, Maps URLs, selected places, photos, and booking details;
- `zh-Hans`, `zh-Hant`, and `ja` translations, which fall back to the source text;
- recommendations (no minimum count), weather locations, and resources.

The server still rejects a whole batch, with nothing saved, if it contains any of the following:

- unknown fields or fields that are not allowed;
- wrong types or oversized strings and arrays (for example, more than 80 plans per day, 80 reminders, or 100 operations per batch);
- impossible calendar dates, or time zones that are not IANA zones;
- field names that look like booking codes or identity secrets (the same rule the generator applies);
- duplicate or missing nested IDs;
- references to a day or plan that does not exist;
- `javascript:`, `data:`, or other dangerous URL schemes;
- prototype-pollution keys (`__proto__`, `constructor`, `prototype`).

Editing a source field removes the `i18n` values that depend on it, unless the same request also updates those translations. Editing a plan's time recomputes or clears stale `sortTime`/`sortOrder`.

## Import mapping

`POST /api/import` and the home-page import control accept either this file's legacy authoring envelope or a self-hosted export.

- `trip.*` content, `days[].plans`, reminders, participant groups, localizations, resources, and weather are mapped to the canonical trip. Nested IDs are kept.
- `app.name`, `app.shortName`, `app.metaDescription`, and `app.theme` map to corresponding trip content. The original authoring envelope is retained in `content.authoringEnvelope`; icons and `sync.*` are inert and do not select a backend.
- Every field that is not mapped is listed in the response `warnings`.
- An available incoming trip ID is preserved. A duplicate import creates a different trip ID and reports that choice; an identical requestId retry returns the original result. Existing trips are never overwritten.
- Imports use draft validation, not the stricter legacy checks.

## Authoring envelope

*Legacy generator input.* The self-hosted service can import it. Use JSON with this top-level shape:

```json
{
  "schemaVersion": 1,
  "app": {
    "name": "Literal app title",
    "shortName": "Short iOS label",
    "metaDescription": "English description",
    "theme": {
      "ink": "#17362f",
      "accent": "#db7549",
      "background": "#f3ede3"
    }
  },
  "sync": {
    "firebaseConfig": null,
    "documentPath": "trips/unguessable-document-id",
    "firestoreRegion": "nam5"
  },
  "trip": {}
}
```

`assets/trip.example.json` is a deliberately fictional, incomplete-count sample. It validates only with `--allow-example`. A production input must not set `sampleData` and must meet all recommendation counts.

Optional custom icons are paths relative to the input JSON:

```json
{
  "app": {
    "icons": {
      "icon192": "brand/icon-192.png",
      "icon512": "brand/icon-512.png",
      "appleTouch": "brand/apple-touch-icon.png",
      "svg": "brand/icon.svg"
    }
  }
}
```

## Trip and localization

Required trip fields for legacy generator input (the service needs only a title):

```json
{
  "slug": "coastal-trip-2030",
  "country": "Portugal",
  "timezone": "Europe/Lisbon",
  "startDate": "2030-06-01",
  "endDate": "2030-06-09",
  "routeDecoration": "Lisbon · Sintra · Porto",
  "participantGroups": [],
  "reminders": [],
  "weather": { "locations": [] },
  "days": [],
  "resources": {},
  "i18n": {}
}
```

English is the base value. Add `i18n` patches on each traveler-facing object:

```json
{
  "area": "Old Town",
  "theme": "Arrival",
  "summary": "Settle in and walk to dinner.",
  "i18n": {
    "zh-Hans": {
      "area": "老城",
      "theme": "抵达",
      "summary": "安顿后步行前往晚餐。"
    },
    "zh-Hant": {
      "area": "老城",
      "theme": "抵達",
      "summary": "安頓後步行前往晚餐。"
    },
    "ja": {
      "area": "旧市街",
      "theme": "到着",
      "summary": "落ち着いたら夕食へ歩く。"
    }
  }
}
```

Do not put `title` in a locale patch. The app name is a literal brand. When a source value changes, remove its now-stale patches; the self-hosted server does this automatically. Do not localize IDs, dates, time zones, plan types, coordinates, URLs, sort fields, or participant group IDs.

Participant groups describe people who always move together:

```json
{
  "id": "team-a",
  "label": "AA · BB",
  "members": ["AA", "BB"],
  "alwaysTogether": true
}
```

## Reminders

Checklist items use an explicit due date. The date may be before, during, or after the trip; there is no departure-date ceiling. When `dueDate` matches an itinerary day, the app also shows that item near the top of the matching day's itinerary.

```json
{
  "id": "todo-confirm-late-checkout",
  "item": "Confirm late checkout",
  "dueDate": "2030-06-04",
  "done": false,
  "i18n": {
    "zh-Hans": { "item": "确认延迟退房" },
    "zh-Hant": { "item": "確認延遲退房" },
    "ja": { "item": "レイトチェックアウトを確認する" }
  }
}
```

## Days and plans

Days must be chronological, unique, inside the trip range, and no more than 31:

```json
{
  "id": "day-2030-06-01",
  "date": "2030-06-01",
  "area": "Lisbon",
  "theme": "Arrive by the river",
  "summary": "...",
  "weatherLocationIds": ["lisbon"],
  "plans": [],
  "recommendations": {
    "eat": [],
    "seeGo": [],
    "buy": []
  },
  "i18n": {}
}
```

Every plan is an itinerary item. `googleMapsUrl` is optional so a locationless placeholder can remain timeline-only. On the self-hosted service, a plan can be located by a selected OpenStreetMap [`place`](#selected-openstreetmap-place-self-hosted) instead:

```json
{
  "id": "hotel-check-in",
  "name": "Check in · Example Hotel",
  "period": "noon",
  "time": "From 15:00",
  "sortTime": "15:00",
  "sortOrder": 3,
  "planType": "stay",
  "booked": true,
  "participantGroupIds": ["team-a"],
  "review": "Leave luggage before exploring.",
  "googleMapsUrl": "https://www.google.com/maps/place/.../@.../data=...!3d...!4d...",
  "photo": {
    "url": "https://.../photo.jpg",
    "sourceUrl": "https://.../source-page",
    "credit": "Creator · license"
  },
  "booking": {
    "area": "Old Town",
    "detail": "Public traveler-useful details only"
  },
  "i18n": {}
}
```

Allowed `period`: `morning`, `noon`, `evening`.

Allowed `planType`: `flight`, `stay`, `restaurant`, `transport`, `car`, `sight`, `activity`, `event`, `shopping`, `other`.

Use `sortTime` for chronological placement when `time` is descriptive. If using `sortOrder`, put it on every plan in the day. The generator converts `plans` to runtime `slots` and derives map metadata when a place URL is present. A plan without `googleMapsUrl` gets no marker or Maps action. On the self-hosted service, a plan with neither `googleMapsUrl` nor a selected `place` likewise stays timeline-only. Legacy coordinates already stored on an older item are preserved as before.

Flights may add:

```json
{
  "booking": {
    "route": "SFO → NRT",
    "service": "Airline AB123",
    "schedule": "17:15–20:00 +1",
    "detail": "Terminal and public check-in guidance",
    "baggage": "Public allowance summary",
    "links": [
      { "label": "Flight status", "url": "https://official.example/status" }
    ]
  }
}
```

Never add a booking code or confirmation reference.

## Maps and photos

A plan that should appear on the map needs a verified location source:

- **Legacy generator input:** a full Google Maps place URL, as below. This requirement is unchanged.
- **Self-hosted service:** either a full Google Maps place URL, as below, or a [selected OpenStreetMap place](#selected-openstreetmap-place-self-hosted). Send one location source per plan. Do not construct either one from a guess.

A full Google Maps place URL is the browser address-bar URL for the exact place. It must:

- use HTTPS on a Google Maps host;
- contain `/maps/place/`;
- contain the place's final `!3d<latitude>!4d<longitude>` pair;
- resolve to the review/address/photo place page, not a search result or bare coordinate.

Share links such as `maps.app.goo.gl/...` are intentionally rejected. The generator uses the final `!3d`/`!4d` coordinates even when the earlier `@lat,lng` viewport differs. Omit the field entirely for a timeline-only placeholder; if a non-empty URL is supplied, it must still meet every rule above. Recommendation `mapsUrl` values remain required.

Legacy generator input requires `photo.url`, `photo.sourceUrl`, and `photo.credit` on every plan and recommendation. Self-hosted drafts may omit photos. When a photo is present, it needs all three fields. Use an image you are licensed to reuse. Prefer official tourism media, Wikimedia Commons, or a user-supplied image. Record the creator and license. Do not scrape Google Maps, Tabelog, or commercial review photos.

On the self-hosted service, a private photo can be referenced by a root-relative URL such as `"url": "/photos/harbor-walk.webp"`. The file lives in `SHARED_TRIP_DATA_DIR/photos` (flat names using `A-Z a-z 0-9 _ -`, with a `.webp`, `.png`, `.jpg`, or `.jpeg` extension). It is served only to signed-in owners and approved viewers. It still needs `sourceUrl` and `credit`. There is no upload API: the owner places the file on the server. Do not add private filenames to the public, generic `photos/manifest.js`.

Keep the original photo/source/credit fields in the authoring JSON. The runtime selects bounded remote thumbnails; `scripts/optimize-photos.mjs` can additionally build local WebP previews and a URL-to-asset manifest after generation. See [responsive-performance.md](responsive-performance.md) for budgets, cache invalidation, and testing.

### Selected OpenStreetMap place (self-hosted)

A self-hosted plan can store the exact public place that a user chose from an explicit place search in the editor ([place-and-photo-lookups.md](place-and-photo-lookups.md)). The shape is strict:

```json
{
  "place": {
    "provider": "openstreetmap",
    "id": "node/123",
    "name": "Example Harbour Pier",
    "address": "1 Example Quay, Example Town",
    "lat": 38.7001,
    "lng": -9.1402,
    "sourceUrl": "https://www.openstreetmap.org/node/123",
    "attribution": "© OpenStreetMap contributors",
    "license": "ODbL-1.0",
    "selectedAt": "2030-05-01T12:00:00.000Z"
  }
}
```

The values above are fictional. The rules are:

- `provider` is exactly `openstreetmap` and `license` exactly `ODbL-1.0`. Other keys are rejected.
- `id` is the OSM object type and number: `node/<n>`, `way/<n>`, or `relation/<n>`.
- `lat`/`lng` are the selected coordinates. `selectedAt` is an ISO 8601 timestamp of the user's choice.
- The plan's own `lat`, `lng` and `address` mirror the place and must be consistent with it. The marker and the navigation action come from these coordinates.
- `sourceUrl` points to the OSM object page, and `attribution` is kept and displayed.
- Saving needs no lookup. The editor, `POST /api/trips/<id>/changes` (`upsert_plan`) and MCP `apply_trip_changes` accept the same object under the usual `expectedVersion` and `requestId` rules. `null` removes it, as for other optional fields.
- Never invent an OSM ID or coordinates. Save a place only after it has been chosen from a real search result or confirmed on its OSM object page.

A navigation link built from these coordinates is a coordinate link, not a verified Google Maps venue, and must never be labelled as one. The existing full Google Maps URL support, with its parsed fields (`googleMapsPlaceName`, `googleMapsFeatureId`, `address`, `lat`, `lng`), is unchanged.

### Selected Commons photo (self-hosted)

A photo chosen from the editor's Commons search is stored with its full attribution:

```json
{
  "photo": {
    "provider": "wikimedia-commons",
    "url": "https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/640px-Example.jpg",
    "sourceUrl": "https://commons.wikimedia.org/wiki/File:Example.jpg",
    "credit": "Example Author, CC BY-SA 4.0",
    "author": "Example Author",
    "license": "CC BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "selectedAt": "2030-05-01T12:00:00.000Z"
  }
}
```

- `url` is the provider's thumbnail, requested at 640 px wide; Commons may round up to a supported size. The image itself is not copied to the server. The example above is fictional.
- `sourceUrl`, `credit`, `author`, `license` and `licenseUrl` stay saved and are displayed. Files with an unknown, unsupported, non-commercial or no-derivatives licence are not offered.
- The photo is representative. A Commons search result does not prove that it shows the exact place until the user confirms that it is relevant.
- If the image fails to load, the plan falls back to its no-photo state. No new lookup is made.
- New managed Commons snapshots include `selectedAt` and use strict validation. Existing photo objects without that selection marker, including provider labels and private `/photos/<name>` files, retain their previous validation and metadata.

Both objects are additive trip content. They are stored in SQLite, included in backups and exports, and kept by import, which never performs a lookup.

### Google place association (self-hosted, optional)

A plan can be linked to a public venue on Google so that, when the operator has enabled the optional [Google Places UI Kit](google-places-ui-kit.md), its expanded card shows Google's standard compact place details. The field is separate from `place` and `photo`, and it stores no Google content:

```json
{
  "googlePlaceAssociation": {
    "placeId": "FAKE_place_id_for_docs_0001",
    "locationBinding": "v1:<64 lower-case hex digits>",
    "publicVenueConfirmed": true
  }
}
```

The values above are placeholders. The rules are:

- Exactly these three keys. Anything else is rejected, including Google names, addresses, coordinates, ratings, photos, photo names and attribution text. The whole batch fails, and nothing is saved.
- `placeId` is a Google Place ID: 8-256 letters, digits, `-` or `_`. It must come from an editor's explicit choice in Google's own selectable search, or from a Google Maps link or ID that a person supplied for that exact venue. Never invent one; a `/maps/place/` link's `!1s…` feature ID is not a Place ID.
- `publicVenueConfirmed` must be `true`: the person confirmed that it is a public business or landmark, not a private home.
- `locationBinding` is `v1:` plus the SHA-256 of this plan's own location inputs. Those are the selected OSM `place` ID, coordinates (7 decimals) and address; otherwise the full `googleMapsUrl` or a well-formed full place URL in its legacy `mapsUrl` alias; otherwise legacy `lat`/`lng` and `address`. Normalizing the alias on Save keeps the same binding. Names, notes, times, ordering, photos and translations are not part of it. Compute it with `locationBindingForPlan` in `assets/app-template/public/google-place-association.js`, the same function the server uses.
- The binding must match the plan's saved location after the server derives it, so a plan without a location cannot have an association. In the same request, an association can be sent together with a new location it is bound to.
- An association carried over unchanged is kept through unrelated edits (including moving the plan to another day). When the location changes or is cleared, the server removes it automatically, through web or MCP. `null` removes it explicitly.
- Create and import validate every association against its plan, so a tampered or stale import is refused. Export, import and backups carry the field unchanged. It is additive JSON and needs no schema migration.

The field has no effect while the feature is disabled, or while the trip's own [`googlePlacePhotosEnabled`](#per-trip-google-setting-self-hosted-optional) is off. It never changes the map, markers, `place`, `photo` or any other plan field.

### Per-trip Google setting (self-hosted, optional)

```json
{ "googlePlacePhotosEnabled": true }
```

A trip-level choice whether this trip's opened plans may show Google place details and photos for their saved `googlePlaceAssociation` ([google-places-ui-kit.md § Per-trip setting](google-places-ui-kit.md#per-trip-setting)).

- Exactly `true` or `false`. Strings such as `"true"`, numbers, `null`, arrays and objects are refused on `update_trip`, `replace_content`, create and import, over HTTP and MCP alike, and the whole batch is not applied. In `update_trip`, `null` does not remove it; send `false`.
- Absent means `false`. New trips start with `false`. Trips stored before the field existed are read as `false` (reads, `get_trip`, export) without rewriting the stored row; the next ordinary write stores the explicit value. Exports carry it and imports keep it; an import without it is `false`. No schema migration is involved.
- The owner, content managers and current trip creators may change it (it is trip content, like `title`). Ordinary creators use the web; existing MCP/import authority stays owner/content-manager only; joined read-only members, anonymous, pending and revoked users cannot.
- It has an effect only when the operator has also enabled the site-wide feature with a browser key. It can be saved while that is off, and it never enables it.
- Changing it never changes plans, `place`, `photo`, `googlePlaceAssociation`, IDs or any other field.

## Recommendations

Recommendations are optional for self-hosted drafts. When you add them, use this shape. **Legacy generator input** requires each day to have at least:

- five `eat` places;
- five `seeGo` places;
- five `buy` places.

Each item requires a unique name, short description, exact `mapsUrl`, credited photo, and all three translation patches. Do not repeat an itinerary plan or another recommendation on the same day.

Optional current ratings:

```json
{
  "googleRating": 4.6,
  "tabelogRating": 3.72,
  "tabelogUrl": "https://tabelog.com/...",
  "reviewCount": 840,
  "ratingCheckedAt": "2030-05-01"
}
```

Use `mapsUrl` as the source for a Google rating. Use a direct Tabelog page when showing a Tabelog rating. Omit unavailable ratings instead of estimating them.

## Weather

Define each forecast point once:

```json
{
  "weather": {
    "locations": [
      {
        "id": "lisbon",
        "name": "Lisbon",
        "lat": 38.7223,
        "lng": -9.1393,
        "i18n": {
          "zh-Hans": { "name": "里斯本" },
          "zh-Hant": { "name": "里斯本" },
          "ja": { "name": "リスボン" }
        }
      }
    ]
  }
}
```

Reference IDs from each day. The UI shows all itinerary dates together in a horizontal forecast slider and keeps hourly/UV/wind/sunrise/sunset details expandable for each date/stop. Open-Meteo supplies up to 16 forecast days, so distant dates remain visible with unavailable states until they enter the forecast window.

Each day's `weatherLocationIds` distinguishes absence from an empty list ([weather-association.md](weather-association.md)):

| Stored value | Meaning |
| --- | --- |
| property absent (or `null` in an `upsert_day` patch, which removes it) | Automatic: areas are inferred in the browser, in memory only, from valid numeric `lat`/`lng` already saved on that day's plans. Nothing is stored. |
| `[]` | Explicit "no forecast" for that day. |
| `["id", ...]` | Manual choice of `weather.locations` entries. |

A manually chosen place in the web editor is an ordinary `weather.locations` entry with a stable ID, a name and complete coordinates, copied from a saved plan point or typed by an editor. The shared optional-coordinate schema remains compatible with older partial explicit entries; these remain stored and mapped but unavailable for fetching, without automatic replacement. `(0, 0)` is valid. The server never geocodes. Legacy generator input may keep `weather.dayLocations`; on import, an entry it has for a day (including `[]`) becomes that day's `weatherLocationIds`, matching the earlier runtime precedence. Absent/null mappings select automatic mode and `[]` selects off, also in generator validation.

## Resources

`resources` contains complete `en`, `zh-Hans`, `zh-Hant`, and `ja` objects. Each has:

```json
{
  "payment": {
    "summary": "...",
    "facilities": [
      {
        "icon": "🚆",
        "title": "Regional rail",
        "summary": "Accepted methods",
        "details": "Traveler-useful caveats",
        "sources": [{ "label": "Official guide", "url": "https://..." }]
      }
    ]
  },
  "apps": {
    "summary": "...",
    "walletNote": "...",
    "items": [
      {
        "icon": "🚆",
        "category": "Transit",
        "name": "Official app",
        "description": "Why this trip needs it",
        "url": "https://apps.apple.com/..."
      }
    ]
  }
}
```

Use direct Apple App Store links. Do not recommend Maps, Weather, or Translate when the phone already provides the needed function.

## Synchronization

*Legacy generator only.* The self-hosted service ignores `sync` and synchronizes through its own server. Firebase is optional even for the generator: with `firebaseConfig: null`, the generated app uses local-only preview storage.

`firebaseConfig` is the public Firebase web-app configuration, not a service account. Only these keys are allowed: `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`, and optional `measurementId`.

Set `sync.firestoreRegion` to the location selected when creating the project's default Firestore database. The generator's fallback is `nam5`; it does not discover an existing database's region. See [firebase-deployment.md](firebase-deployment.md) before configuring or deploying a backend.

Use an unguessable two-segment `documentPath`. Preserve it when regenerating the same trip. A missing path is generated randomly and written into the generated `trip-input.json` build record.

## Legacy generator authoring checks

These complete-content checks apply only to the legacy generator. They are separate from the service's [draft validation](#draft-validation), and their tests and requirements are unchanged. Run:

```bash
node scripts/validate-trip.mjs trip.json
```

Validation rejects incomplete translations, invalid non-empty Maps links, missing photos, duplicate ideas, unsafe secrets, invalid participant references, incomplete resources, oversized synchronized data, and stale structural mistakes before they become UI or Firebase failures. A missing plan `googleMapsUrl` is valid; recommendation map links are still mandatory. The self-hosted place and photo lookups do not change these checks. A selected OpenStreetMap `place` is self-hosted content and is not a location source for generator input. A `googlePlaceAssociation` is self-hosted content too. Generated static apps never load Google components.
