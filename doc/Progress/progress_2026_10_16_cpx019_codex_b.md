# Progress report - Codex B, checkpoint 019

- Date: 2026-10-16 UTC.
- Agent: Codex B.
- Status: complete; authorized CP018 deployment accepted with Google globally disabled.
- Approximate active time: 30 minutes.
- Accepted and deployed source: `dccc3648f28d31e0dbfa5c39aa59e657527fb815`.
- Report baseline: `7715453cd74afddab8dc014a97dd74d78c23c548`.
- Previous live source retained for rollback: `8e93bb5da64c54587e995ed7103a061fb48668dd`.

## Scope and current state

Continued the authorized CP018 rollout after reading current instructions, the repository delegation skill, deployment contracts and CP018. Its comment had no further instruction. No pending resume prompt, active handoff or equivalent deployment was found. Fetch confirmed the expected main lineage. The existing healthy application was upgraded once through its established private Compose route; the HTTPS proxy and restricted OSM/Commons gateway were preserved.

The per-trip setting and hyperlink fixes are deployed. Google remains explicitly disabled globally, and no browser key is configured. No real trip preference or itinerary was edited, no account or credential was created or changed, and no Google service was activated or called. Existing lookup configuration, authentication, origin, data mounts, internal networks and unpublished application port were preserved. Private operations stayed with Codex; this checkpoint required no new public implementation or Claude invocation.

## Backup, preservation and rollback

A fresh online SQLite backup passed integrity/schema validation and restored into separate storage under both the previous and accepted images. All 11 application tables matched exactly. Database and photo backups were copied off-host and their digests verified. The prior private configuration and image remain available.

After gracefully stopping only the application, a second consistent snapshot was created and independently restored under both images before cutover. Every database table matched the stopped-state snapshot after startup and again at final acceptance: trips, IDs, versions, user edits, retry records, deletion metadata, accounts, invitations, credential records, OAuth records and audit metadata. The photo-store fingerprint also matched. Schema remains v6; no migration or real-trip field rewrite occurred. The final cutover snapshot has a verified off-host copy.

Rollback compatibility was tested rather than inferred from the unchanged SQL version. Every current stored trip lacks the new field, so the retained pre-upgrade snapshot works with the prior image. An isolated fictional ordinary edit under CP018 stored `googlePlacePhotosEnabled: false`; the prior image then rejected that snapshot as expected. **After post-upgrade writes, do not point the old image at upgraded data or blindly restore the old snapshot.** Preserve current storage, prefer a compatible forward repair, or restore the validated pre-upgrade snapshot separately and reconcile later content and access/revocation changes before reconnecting users. Automatic failure recovery was limited to an unchanged database. Private rollback instructions and evidence are retained outside Git.

## Verification

| Check | Actual evidence |
| --- | --- |
| Production image | Built from the exact accepted Git archive with its revision label. Isolated Linux container runs passed `test-google-place-photos-trip.mjs`, `test-place-lookups.mjs`, `test-owner-delete.mjs`, `test-content-manager.mjs` and `test-oauth.mjs`. These exercise HTTP/MCP settings, roles/denials, conflicts/retries, defaults, preservation and authentication using fictional data; external providers are mocked or refused. |
| Live service | Healthy accepted image; verified public and direct-origin HTTPS health with TLS verification. Nine public health/shell/privacy checks passed with no-store responses; anonymous session, trips, MCP, photos, Google configuration and both search routes remained denied. Six served application assets matched the accepted archive after the server's documented build-version substitution. |
| Fictional browser fixture | Same production image in separate storage, reached through a temporary loopback-only tunnel. Chrome at 1280 x 900 and 390 x 844 verified default off, persistence of A's opt-in while B stayed off, and global-off precedence. Final versions were A=3 and B=1. Saved item IDs, OSM location, manual photo and Google association survived the unrelated note edit. |
| Native links and map/card behavior | Desktop keyboard Enter and phone-width plain click on the Maps card action opened separate local destination tabs. Target and `noopener noreferrer` attributes remained present. Phone planner Control-click opened a planner tab while preserving the overview. A marker selected and expanded its matching card. External fixture card hrefs were redirected to a local landing page, so no itinerary or query was sent to a provider. |
| Zero lookup work | Across fixture viewing, opt-in while globally off, reloads, repeated expansion and an unrelated note edit: zero Google configuration requests, zero Google script/component elements, and zero place/photo search requests. OSM map markers and attribution continued rendering. This is instrumented fictional-service evidence, not a production-wide traffic measurement. |

The initial fixture start failed because the private harness decoded the attribution text incorrectly; UTF-8 handling was corrected. The initial raw asset comparison also needed the server's runtime cache-version substitution. Corrected checks passed without changing accepted source. CP018's full `npm test`, demo regeneration, disposable generation/static QA and broader mocked-Google UI acceptance remain the source-level regression baseline; this deployment did not modify application code or regenerate it again.

The temporary fictional containers, tunnel and agent-created browser tabs were removed; viewport settings were reset. No persistent production test trip was created. Authenticated private production cards were not clicked: no signed-in application browser session was available, and no owner credentials were entered. Live evidence establishes the served source and privacy boundary; native activation was exercised in the isolated production-image fixture. Phone widths are browser emulation, not physical-device testing. Real Google SDK rendering, attribution and billing remain untested.

## Google readiness and remaining owner setup

| Read-only item | Status |
| --- | --- |
| Global activation and key presence | Global flag is explicitly off. Key absent from existing private deployment configuration and running container. Values were not printed. |
| Key restrictions, enabled APIs, billing | Unknown in Google Cloud; no authenticated console or project evidence was available. No console sign-in, credential provisioning, API enablement or billing change was attempted. |
| Required setup | Official [UI Kit setup](https://developers.google.com/maps/documentation/javascript/places-ui-kit/get-started) requires a billing-linked project, Places UI Kit enabled and a browser key, with Maps JavaScript library loading. Before any activation, the owner must verify the required services and restrict that key to the exact website and required APIs. |
| Terms | Current [service-specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms) section 15 permits UI Kit with a non-Google map and preserves attribution/content restrictions. [EEA terms](https://cloud.google.com/terms/maps-platform/eea/maps-service-terms) have separate UI Kit provisions. Billing region and owner acceptance are unknown; no agreement was accepted. |
| Quotas and cost controls | Actual project quotas, budget alerts and shared billing usage are unknown. The documented UI Kit Query default is 6,000 requests/minute/project, which is not a small-spend ceiling. Before activation, the owner should choose a spending limit, verify supported quota controls, restrict the key, monitor the Query SKU across the billing account, and set alerts; alerts alone do not cap spending. See [usage limits](https://developers.google.com/maps/documentation/javascript/usage-and-billing) and [cost controls](https://developers.google.com/maps/billing-and-pricing/manage-costs). Nothing was configured. |

The standard compact details/search components still target Query Essentials SKU `0678-4F72-DA7C`. Current [pricing](https://developers.google.com/maps/billing-and-pricing/pricing) retains 10,000 monthly events at no charge and then USD 1 per 1,000 in the first paid tier. The fictional 29-component example remains USD 0 / 0 / 19 at 10 / 100 / 1,000 monthly full views, before matching and other shared billing-account usage. Matching contributes to the same cap; 29 searches add 29 events, approximately USD 0.029 when above that cap. These are estimates, not observed charges.

No action is required to use this disabled rollout. A separately authorized owner-controlled Google setup and fictional live-SDK acceptance remain necessary before global activation. Editors may later opt individual trips in using fresh versions; that preference cannot bypass the global gate. Public artifacts include no operational destination, credentials or private itinerary content. The outgoing report and neutral author metadata were manually reviewed, and framework privacy/whitespace checks passed before publication. The pre-existing unrelated ignore-file edit remains excluded.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
