# CP037 — Covers and card highlights deployed

- Date: 2026-10-17 UTC
- Agent: Codex B
- Status: complete — rollout, compatible rollback and fresh target-client acceptance passed
- Approximate active time: 15 minutes
- Deployed source: `530574134a2f079e2b00d3adc149b594338dccf5`
- Report baseline: `3fe3dcd`, [CP036](progress_2026_10_16_cpx036_codex_b.md)
- Prior deployed source: `3aadf973410174a8138943059d155eb351e82050`

## Rollout and recovery

Read current instructions, applicable skills/contracts and report comments; fetched main and checked the active handoff and continuation state. No additional report directive, resume prompt, unrelated local edit or duplicate rollout was present. Private operations remained with Codex; no helper received production context.

Built the exact approved archive and a compatible rollback image. Authentication, storage code, dependencies, installed identity and deployment boundaries were checked against the prior release. Only the authorized application modules changed. Completed one app-only cutover; the immutable image/revision and fourteen source-module hashes match the accepted release. Existing environment values, mounts, private port and network membership were retained; proxy and provider gateway containers stayed in place. Quiet Compose validation passed.

Fresh online and stopped-state SQLite snapshots passed integrity checks and isolated restore under the prior, accepted and compatible images. All eleven tables matched. Photo archive contents and off-host online/cutover/photo copies passed digest checks. The separate allowance snapshot was evidence only and was never restored over current usage.

The compatible image keeps the prior presentation with accepted `server/domain/validate.mjs`, `branding.mjs`, `service.mjs`, `server/mcp.mjs`, and shared `trip-branding.js`/`trip-presentation.js` modules. It retains cover/category validation, raster sanitization, writable keys and typed MCP fields. An actual isolated accepted → compatible → accepted round trip preserved fictional cover bytes/focus, categories, branding, photos, weather choices, booking semantics, later version-aware edits and durable replay. The compatible image also passed the HTTP/official SDK presentation and branding suites. Fixture containers had no external network. Retain current data and allowance usage when rolling back; never restore an old snapshot over later writes.

## Live service evidence

| Check | Verified outcome |
| --- | --- |
| Approved Linux image | Cover/category, branding and MCP discovery regression suites passed with fictional data |
| HTTPS | Public HTTPS and direct-origin TLS health returned 200 with certificate verification enabled |
| Access/cache boundaries | Eleven anonymous/private-route and no-store checks passed |
| Served assets | Twenty-two responses, including cover/presentation modules and home styling, matched the approved source |
| Actual running MCP endpoint | Official SDK through the existing authenticated production-loopback route returned 1.3.0 and the same six tools; typed cover object/null, category enum, branding and existing optional fields passed structural checks |
| Protected reads | Authenticated HTTP trip/page and MCP reads passed; current location bindings matched the shared helper |
| Pre-client persistent state | All eleven tables, including trip IDs/versions/content and authentication/OAuth records, were exact after cutover and read-only acceptance |
| Other state | Photos, configuration and allowance file identity/rows/counts were exact; one healthy live data worker remained |

No real trip write, provider call, credential provisioning, permission, billing or network change was performed by Codex. Existing credentials were consumed only through the established environment mechanism. Browser sessions retain their existing in-memory restart lifetime; persistent accounts and OAuth authorization were preserved. No sign-in was performed for a user.

## Same-App refresh and actual client gate

Used the already-connected browser and the same registered App's **Reload tools** control once. Its registered `get_trip` description now includes independent cover artwork and card-category highlights. App/connection identity, linked account, OAuth method and package versions were retained; no sign-in, consent, replacement connection or grant change was needed. This follows the [official metadata refresh workflow](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata).

The designated assistant independently verified a fresh native client on the same integration:

- `create_trip.trip.cover` and `update_trip.fields.cover`: optional object or null, required `alt`/`data` strings and `mimeType: image/png`, optional numeric `focusX`/`focusY`.
- `upsert_plan.cardCategory`: neutral, restaurant, hotel or ticketed transport.
- Existing branding, Google association, selected place, related links and trip Google boolean remain available.
- Updated read-tool description and one successful native read-only list call; no verification write.

Generated client declarations do not expose the numeric bounds, so client-layer inspection cannot independently verify those bounds. Actual running `tools/list`, shared validation and the regression tests verify focus 0–100 and the documented PNG limits. The native field/read gate passed; local discovery alone was not used to claim client readiness.

After that gate, the assistant separately completed the already-approved private cover/category application through the same native MCP connection in one atomic write, with fresh read-back confirming cover pixels, alternative text/focus and selected categories. Independent server reconciliation found one matching durable result and accepted MCP audit event, one version increment, and changes confined to cover, selected category values and ordinary version/timestamp metadata. All unrelated trip/plan fields, other trips, branding, photos, weather, booking details, Google associations/settings and allowance file/rows/counts were exact. Accounts, roles, client registrations, grant identity/audience/scopes/horizon and revocation state remained unchanged; normal OAuth refresh/usage metadata was preserved. Codex did not replay or perform that content write.

## Limits and handoff

Reused CP036's full regression, fresh generation/static QA and four-language desktop/320/375 px Chrome evidence; no runtime source changed during rollout. This checkpoint adds isolated production-image, restore/rollback, live-service, registered metadata and actual native-client evidence. It does not add physical Android/iOS testing, live map/provider behavior or Google usage verification. Private artwork was not copied into public Git or coordination messages. The browser proof and operational receipts remain private.

Deployment, integration acceptance and the separately authorized application are complete. No owner setup or new approval is required for these changes. The outgoing report/diff and referenced paths were manually reviewed; the framework privacy audit with the external denylist passed before publication.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
