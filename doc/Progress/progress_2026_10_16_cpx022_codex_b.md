# CP022 — Allowance, weather and card-link rollout

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — authorized deployment accepted; Google remains off
- Approximate active time: 20 minutes
- Deployed source: `8c2507df626859b83810cbd8feb8999ffff31c04`
- Report baseline: `ef2e95d1b9ca2e52dd68ce3ec7e56c9fa5b88851`
- Prior source retained for rollback: `dccc3648f28d31e0dbfa5c39aa59e657527fb815`

## Scope and current state

Continued the authorized rollout of [CP020](progress_2026_10_16_cpx020_codex_b.md) and [CP021](progress_2026_10_16_cpx021_codex_b.md). Current instructions, deployment workflow, reports and reserved comments were checked. No continuation prompt, active handoff, duplicate rollout or remote divergence was found.

The accepted archive was built and deployed once through the established private Compose route. Application source was unchanged. The conservative allowance guard, automatic daily weather with manual/off/back-to-auto controls, and safe card location/text links are live. Google stays explicitly globally off. No key was configured or read back; no provider API, billing, terms, account, access or network setting was changed. No real trip, weather choice or per-trip Google setting was edited.

Private operational work remained with Codex. This deployment required no new public implementation or Claude invocation. The unrelated local ignore-file edit remains untouched and excluded.

## Backup, preservation and rollback

A fresh online SQLite backup passed integrity/schema validation and restored independently into separate storage under both the prior and accepted images. All 11 application tables matched exactly. Photo backups matched their source fingerprint; database and photo copies were transferred off-host and their digests verified. Prior private configuration and image were retained.

Only the application was gracefully stopped for the final consistent cutover snapshot. That snapshot was independently restored and validated under both images before starting the accepted container. Immediately after startup and again at final acceptance, every application table matched the cutover snapshot exactly: trip IDs, versions, edits, retries, deletion metadata, accounts, invitations, credentials, OAuth and audit records. Photos matched too. No SQL migration or real-trip rewrite occurred; schema remains v6. The final snapshot also has a digest-verified off-host copy.

No live allowance ledger existed before rollout; its absence was checked before, during and after cutover. No ledger, allocation, headroom or baseline was initialized or raised. Existing allowance files were never restored or reset.

A separate fictional upgrade test saved manual/off/back-to-auto weather choices and a later plan note under the accepted image. The prior image validated the resulting snapshot and retained the choices, IDs and version. This establishes compatibility for the tested data, not permission to restore old storage over newer work. For recovery, preserve current storage and any current allowance ledger, use compatible images, and reconcile later itinerary edits and access/revocation changes before reconnecting separately recovered data. Automatic failure recovery was restricted to unchanged data; no rollback was needed.

## Verification

| Check | Actual result |
| --- | --- |
| Production image | Exact Git archive and revision label verified. Isolated Linux runs passed allowance, weather association/controller, weather HTTP/MCP, per-trip Google choice, place/photo, owner deletion, content-manager and OAuth suites. Fictional data only; external providers were mocked or refused |
| Live HTTPS and privacy | Public and direct-origin health passed with TLS verification. Eleven public health/shell/privacy checks passed with no-store responses. Anonymous session, trips, account administration, MCP, photos, Google configuration, reservation and search routes remained denied |
| Exact served build | Ten served assets matched the accepted archive after runtime cache-version substitution, including the three new weather/link modules, forecast controller and allowance client integration |
| Existing deployment | Application port remained unpublished; internal networks, TLS verification, authentication settings, HTTPS proxy and restricted lookup gateway were preserved. Proxy and gateway containers were not replaced |
| Production-image weather fixture | Separate storage and a temporary loopback-only tunnel. Chrome verified two inferred areas, old manual/off mappings, missing-coordinate fallback, saving off/manual/back-to-auto and manual persistence across reload. Four-language simulation coverage remains in CP021 |
| Original photos and Google gate | Fictional trip A was opted in while the global flag stayed off; B stayed off. The original image loaded, no Google SDK/component appeared, and Google and place/photo search counters stayed zero. IDs, saved coordinates, photo and weather library survived unrelated editing |
| Desktop and phone links/maps | Desktop Enter/Ctrl-click and phone-width plain click opened safe local destination tabs with no opener; card location, raw/Markdown and Unicode anchors retained native protections. Native map input selected and expanded the matching card; card selection and OSM markers/tiles/popups remained available |
| Request observation | Final fixture had four mocked weather batches including initial loads/reloads and changed associations. Off, manual reuse and the unrelated note edit added no search/Google work. Fixture versions finished A=5, B=1 |
| Source regression baseline | CP020/CP021 full `npm test`, fictional demo generation, disposable generation/static QA and mocked UI acceptance remain valid. This deployment made no application code changes |
| Publication | Framework privacy audit with external denylist, whitespace, report links, outgoing text, neutral author metadata and screenshot-pixel review passed |

The initial private rollback assertion incorrectly expected the serialized fixture to omit its version; it was corrected to assert the actual preserved version, and compatibility passed. A map check after returning from a new tab needed native browser input; that check passed. Neither required an application change.

Weather responses and navigation targets were mocked in the fixture; no real weather-provider availability or Google behavior was tested. Existing OSM tiles loaded normally. Phone widths around 375–390 px are browser emulation, not physical-device testing. Authenticated production cards were not opened or clicked, and no owner sign-in was performed against production. Live evidence covers health, served source, anonymous boundaries and exact saved-data preservation; UI mutation/activation evidence comes from isolated fictional production-image fixtures.

Reviewed fictional evidence: [weather controls](../evidence/cp022-weather-phone.png), [desktop card links](../evidence/cp022-card-links-desktop.png), [phone card links](../evidence/cp022-card-links-phone.png). Isolated acceptance containers/tunnels and agent-created browser tabs were removed; viewport settings were reset. No persistent live test trip was created.

## Google readiness and owner handoff

Google is explicitly off; allowance and headroom are unconfigured and the ledger is absent. No zero current-month baseline was assumed. Browser-key values were not inspected. Actual key restrictions, enabled APIs, billing, terms acceptance, provider metering and SDK behavior remain unverified.

The existing private key-entry destination, restrictive file mode and exact quiet Compose validation procedure were verified. Installation-specific editor and validation commands are in the separate private owner handoff, outside Git. The owner enters any future key directly in their private editor and keeps the global flag off; no secret enters chat or reports.

Remaining decisions are provider enforcement or informed acceptance of the zero-charge limitation, owner-controlled Maps JavaScript API/Places UI Kit setup and website/API restrictions, an explicit allocation after other shared billing consumers, positive headroom, trustworthy time and a conservative approved baseline before ledger initialization. The app ledger does not guarantee zero charges from direct key use, SDK background activity or other billing-account consumers. See [setup and cost controls](../../references/google-places-ui-kit.md#owner-setup-pending-not-done).

The deployed weather and link fixes can be used now without Google setup. No action is needed for this disabled rollout. Google activation and any real-provider acceptance require the remaining owner decisions and specific authorization.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
