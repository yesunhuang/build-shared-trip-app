# Public place and photo lookups (self-hosted, opt-in)

The self-hosted plan editor can look up a public place in OpenStreetMap (through a Nominatim search endpoint) and, separately, a representative photo on Wikimedia Commons. The user chooses the exact result, and saving stores that choice in the trip as a snapshot. The feature is **off by default**. Nothing on this page applies to the legacy static generator, whose contract is unchanged.

This page states the contract and the provider review. It is not evidence that any check passed. Test results belong in the coordinator's run evidence or a progress report (see [feature-contract.md § Verification status](feature-contract.md#verification-status)).

## Contents

- [What it does and does not do](#what-it-does-and-does-not-do)
- [Enabling lookups (operator)](#enabling-lookups-operator)
- [HTTP endpoints](#http-endpoints)
- [Editor flow](#editor-flow)
- [Stored data and licensing](#stored-data-and-licensing)
- [Cache, limits and outbound requests](#cache-limits-and-outbound-requests)
- [Provider evaluation (checked 2026-10-15)](#provider-evaluation-checked-2026-10-15)

## What it does and does not do

- **Explicit only.** A lookup runs only when an owner, content manager or current trip creator presses **Search** or **Refresh** in the plan editor. There is no autocomplete, search-as-you-type, background refresh, bulk geocoding or periodic job.
- **Stored snapshots afterwards.** Opening the editor, opening or reloading a trip page, sync polls, and edits that do not touch the place or photo all render the stored selection. None of them calls the place or photo search API.
- **Remote content is still remote.** The zero-lookup rule covers the search APIs only. Displaying a saved Commons image and loading map tiles are still ordinary browser requests to those hosts. Each provider sees the visitor's IP address and the requested image or tile. A missing or broken image falls back to the no-photo state and does not trigger a new lookup.
- **No Google lookups.** The new search does not call Google APIs and does not scrape Google content. The existing full Google Maps place URL field keeps working as before. The separate, optional [Google Places UI Kit](google-places-ui-kit.md) feature does not change this. It adds only a browser-side Google component and a stored Place ID link, never Google data in `place` or `photo`.
- **No new credentials or accounts.** The default public endpoints need no API key, billing account or provider sign-in. The feature generates no credentials and changes no live configuration.
- **No new upload or mirroring.** Photo bytes stay on Commons. The server does not download, store or proxy them. The private photo store and its rules are unchanged.
- **No privilege change.** Viewers cannot search. The account, role, token and OAuth model is unchanged.

## Enabling lookups (operator)

Before enabling, the operator reviews the provider policies summarized [below](#provider-evaluation-checked-2026-10-15). In particular:

- the public Nominatim service is donated, limited capacity with no service-level agreement, and its policy can change;
- every query string is sent to the provider together with the identifying User-Agent, so trip editors must not type confidential material (booking codes, names, private addresses) into the search box;
- the configured endpoint's own terms must allow the results to be retained in trips.

| Setting | Default | Meaning |
| --- | --- | --- |
| `SHARED_TRIP_LOOKUPS_ENABLED` | Unset (off) | Set to `1` to enable place and photo search. Any other value leaves it off. |
| `SHARED_TRIP_LOOKUP_USER_AGENT` | None | Required when enabled. Identifies the application and its version and includes a contact email address or URL supplied by the owner, for example `<app-name>/<version> (+<owner-contact-url-or-email>)`. Keep the real value in the private env file. |
| `SHARED_TRIP_NOMINATIM_URL` | `https://nominatim.openstreetmap.org/search` when enabled | Optional HTTPS search endpoint of a Nominatim-compatible provider. Use it to move to another provider or your own instance without code changes. |

The Wikimedia Commons endpoint is not configurable.

With lookups off, the editor shows no search controls, or reports them as unavailable, and both search endpoints refuse requests without contacting any provider. Saved places and photos still render, and agents can still save them through `apply_trip_changes`.

## HTTP endpoints

| Method | Path | Who | Input / result |
| --- | --- | --- | --- |
| POST | `/api/trips/<id>/places/search` | owner, content manager, current trip creator (same origin for cookie sessions) | `{query, refresh?}` → `{results, cached}` |
| POST | `/api/trips/<id>/photos/search` | owner, content manager, current trip creator (same origin for cookie sessions) | `{query, refresh?}` → `{results, cached}` |

- `query` is the user's explicit text. `refresh: true` bypasses the cache for that query. `cached` reports whether the results came from the cache.
- Viewers, pending or revoked accounts, MCP tokens and OAuth tokens are refused, so they cannot trigger or spend upstream requests. Cookie requests need the configured Origin, like other cookie writes.
- A search never changes the trip or its version and needs no `expectedVersion` or `requestId`.
- The client cannot supply an outbound URL. The server builds the request from its configuration and does not follow redirects.
- Saving a chosen result uses the existing versioned content-change endpoint, `POST /api/trips/<id>/changes`, with `expectedVersion` and `requestId`. The editor saves a replacement snapshot; MCP can also use `upsert_plan`. Conflict, atomicity and idempotent-retry rules are unchanged.

## Editor flow

1. In **Add/Edit plan**, type a public place query and press **Search**. Candidates appear for the user to compare by name and address.
2. Choose the exact place. The choice is staged in the form, not saved.
3. Optionally search photos separately, using any query, and choose one. Each candidate shows its credit and license. A Commons search result is a **representative** photo, not proof that it shows that exact place, until the user confirms it is relevant.
4. **Save** sends the plan with the chosen place and photo snapshots. **Cancel** or closing the dialog changes nothing.
5. **Refresh** repeats a search past the cache. It still never changes a saved plan unless the user chooses a result and saves.

Map and card selection stay linked both ways: choosing a plan focuses its marker, and choosing a marker opens its plan. For a plan with a saved OpenStreetMap place, the navigation action is built from the saved coordinates, and the source link opens the OpenStreetMap object page. A coordinate-based link is never presented as a verified Google Maps venue.

## Stored data and licensing

The field shapes are in [input-schema.md § Selected OpenStreetMap place](input-schema.md#selected-openstreetmap-place-self-hosted) and [§ Maps and photos](input-schema.md#maps-and-photos). In short:

- `plan.place`: `{provider: "openstreetmap", id: "node/…" | "way/…" | "relation/…", name, address, lat, lng, sourceUrl, attribution, license: "ODbL-1.0", selectedAt}`, with `plan.lat`, `plan.lng` and `plan.address` mirrored consistently;
- `plan.photo` from Commons: `{provider: "wikimedia-commons", url, sourceUrl, credit, author, license, licenseUrl, selectedAt}`.

Saved snapshots are primary trip content. They live in SQLite and travel with database backups, exports and imports. Import and export never perform lookups. These are additive JSON fields; no SQLite schema migration is required.

New Commons selections carry `selectedAt` and receive strict snapshot validation. Older photo objects without that selection marker keep their previous validation, even when they have a provider label; unrelated edits do not rewrite their metadata.

Attribution is saved with the data and displayed. OpenStreetMap data is © OpenStreetMap contributors under the ODbL, which includes share-alike obligations for databases derived from OSM. That licence covers the OSM-derived place data. It does not apply to the trip's own original text, such as notes and plan names written by its editors. Do not describe private itinerary text as ODbL-licensed. Each Commons photo keeps its own author, source page and licence.

## Cache, limits and outbound requests

- Successful query results are cached privately under `SHARED_TRIP_DATA_DIR`, bounded to 500 entries and 8 MiB of UTF-8 data with oldest-first eviction. Ordinary repeats use the cache; **Refresh** bypasses it. Failures are not treated as results.
- The cache is non-essential. It can be discarded without losing trip content, and it is not needed to restore a trip. Treat it as private: its results may reveal searched locations, even though query keys are digests rather than stored query text.
- All upstream requests, places and photos together, are made one at a time, at least 1,100 ms apart, with timeouts and bounded response sizes.
- Photo search requests at most 5 results and a 640-pixel thumbnail width; the provider may round up to a supported size bucket. It strips HTML from Commons metadata and excludes files whose licence is unknown, unsupported, non-commercial (NC) or no-derivatives (ND).
- Both official image hosts are recognized: `thumb.wikimedia.org` for thumbnails and the older `upload.wikimedia.org` URLs. Only the known API tracking parameters are removed before saving a canonical URL. Wikimedia [announced the thumbnail-host migration](https://meta.wikimedia.org/wiki/Tech/News/2026/36) in 2026.
- Outbound requests go only to the configured Nominatim endpoint and the Commons API, never to a client-supplied URL, and redirects are not followed.

In the Docker Compose template, the app container sits on an internal network with no outbound access. Lookups cannot reach a provider there unless the operator deliberately provides egress. See [deploy/README.md § Place and photo lookups](../deploy/README.md#place-and-photo-lookups-optional).

## Provider evaluation (checked 2026-10-15)

These are summaries of primary sources as read on 2026-10-15, not legal advice. Terms and prices change, so recheck them before relying on this.

**Google Maps Platform pricing** ([pricing](https://developers.google.com/maps/billing-and-pricing/pricing), [Places usage and billing](https://developers.google.com/maps/documentation/places/web-service/usage-and-billing)). Billing is required. Pricing is per SKU, and the requested fields decide the SKU. Global pay-as-you-go, first paid tier, USD:

| SKU | Free per month | Then per 1,000 |
| --- | --- | --- |
| Places Text Search Pro | 5,000 | $32 |
| Place Details Pro | 5,000 | $17 |
| Place Details Essentials | 10,000 | $5 |
| Place Details Photos | 1,000 | $7 |

ID-only search and details calls are free without limit, but they do not return the name, address, coordinates or photo the trip needs to store. Monthly cost per SKU at the first paid tier is `max(0, monthly calls − free cap) × rate ÷ 1000`. The older generic $200 monthly credit is not how this is calculated. For example, 6,000 Text Search Pro calls cost (6,000 − 5,000) × 32 ÷ 1,000 = $32. Around 100 new locations a month, typical search and photo calls stay within the free caps, but the retention terms below still rule Google out. EEA, India and volume pricing differ. No Google calls were made for this evaluation.

**Google terms and policies** ([Maps Service Specific Terms](https://cloud.google.com/maps-platform/terms/maps-service-terms), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies), [Place Photos](https://developers.google.com/maps/documentation/places/web-service/place-photos)). Section 14.2 prohibits using Places content with a non-Google map, and this app uses an OpenStreetMap-based map. Section 14.3 limits cached latitude and longitude to 30 days. Place IDs may be kept indefinitely, but other content may not. Photo names cannot be cached and they expire. Lasting trip snapshots are therefore incompatible, so the new search does not use Google or scrape Google content. The existing parser for user-supplied full Google Maps place URLs stays as a transition path. The optional Places UI Kit, which section 15 permits with a non-Google map, is reviewed separately in [google-places-ui-kit.md](google-places-ui-kit.md). It stores only Place IDs and never feeds these snapshots.

**Nominatim usage policy** ([OSMF policy](https://operations.osmfoundation.org/policies/nominatim/)). The public service runs on donated, limited capacity, with no SLA, and its policy may change. The rules are:

- at most 1 request per second in total;
- a valid identifying User-Agent or Referer;
- visible attribution;
- cache repeated queries;
- no autocomplete, bulk, systematic or grid queries, and no scraping of details;
- keep the endpoint switchable;
- send no personal or confidential data.

This feature is a deliberately small, explicit lookup inside private trip editing. It is not a general geocoding service. The developer and operator review the policy before enabling.

**OpenStreetMap copyright** ([copyright and licence](https://www.openstreetmap.org/copyright)). OSM data is under the ODbL. Credit "OpenStreetMap contributors" with a link to the licence, and apply share-alike where it applies. Keeping the data is permitted, subject to the licence. API and tile use are governed separately.

**Wikimedia Commons and MediaWiki** ([Reusing content outside Wikimedia](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia), [API:Imageinfo](https://www.mediawiki.org/wiki/API:Imageinfo), [API:Etiquette](https://www.mediawiki.org/wiki/API:Etiquette)). Licences are set per file. Keep the author, source and licence, and check the file page for any additional rights. Use bounded, unmodified thumbnails. A Commons search result does not prove it shows the exact place. `imageinfo` with `extmetadata` provides the licence and author fields (HTML stripped here), with at most 5 results and `iiurlwidth=640`. API etiquette asks for an identifying User-Agent, `maxlag` and low concurrency.

**Cost note.** Commons and the OSMF services have no per-request bill. Hosting, bandwidth and storage costs and usage limits still apply, and no contract guarantees that they stay free.
