# CP034 — Per-trip branding rollout

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — deployment and server acceptance; private branding application remains separate
- Approximate active time: 10 minutes
- Deployed source: `3aadf973410174a8138943059d155eb351e82050`
- Report baseline: `f0ba212`, [CP033](progress_2026_10_16_cpx033_codex_b.md)
- Prior deployed source: `c532f4644433266f9b23e0cd465eb4bc0349499f`

## Scope and rollout

Read current instructions and report comments, fetched main and checked the active handoff. No additional actionable comment, handoff or duplicate deployment was present. The prior service was healthy with one live data worker. Private operations remained with Codex; no helper received production context.

Built from the exact approved source archive and completed one app-only image cutover through the established route. The running immutable image, revision label and seven changed source-module hashes matched the approved release. Existing environment values, mounts, private application port and network membership were retained; the proxy and provider gateway containers stayed in place. Quiet Compose validation passed. No application source changed during deployment.

## Backup and compatible rollback

Fresh online and stopped-state SQLite snapshots passed integrity validation and isolated restore under the prior, approved and compatible rollback images. All eleven application tables matched exactly. Photo archive contents and off-host online/cutover/photo copies passed digest checks. The separate allowance snapshot is evidence only and was never restored.

The retained compatible rollback image uses the prior presentation with these approved modules retained: `server/domain/validate.mjs`, `server/domain/branding.mjs`, `server/mcp.mjs` and `assets/app-template/public/trip-branding.js`. Thus an interface rollback preserves branding validation and typed MCP support after branded writes.

An actual isolated approved → compatible → approved store round trip retained a fictional embedded logo, theme, later version-aware content edits and durable replay. The compatible image also passed the HTTP/official SDK branding regression. These fixture containers had no external network. Both the prior immutable image and compatible rollback image remain available; after any branded write, use the compatible image. Rollback retains current data, authentication state and allowance usage rather than restoring an older snapshot over later changes.

## Live acceptance and preservation

| Check | Verified result |
| --- | --- |
| Production image, isolated Linux | Branding and MCP discovery suites passed using fictional SQLite/HTTP/SDK fixtures; compatible-image branding suite also passed |
| HTTPS | Public HTTPS and direct-origin TLS health returned 200 with verification enabled |
| Access/cache boundaries | Eleven anonymous/private-route and no-store checks passed |
| Served assets | Nineteen responses, including both new branding modules, matched the approved source |
| Actual running MCP endpoint | Official SDK initialization and `tools/list` through the existing authenticated production loopback route returned version 1.2.0 and the same six tools; typed branding/logo/theme, root/logo null-clear and create/update fields passed structural checks |
| Actual trip reads | Authenticated HTTP trip reads/pages and MCP reads passed; existing read-only location bindings matched the shared helper |
| Persistent state | All eleven live tables were exact immediately after cutover and again after read-only acceptance: trip IDs, versions/content, retry/audit records, accounts, OAuth clients/tokens/grants, audience/scopes and revocation state |
| Other state | Photos, weather choices, Google site/trip settings and configuration were unchanged; the allowance ledger retained file identity, rows and counts; one live data worker remained |

Reused CP033's full `npm test`, fresh generation/static QA and Chrome desktop/phone evidence; no runtime source changed afterward. This checkpoint adds actual production-image, restore/rollback and live-service checks. It does not claim new production browser interaction or physical-device testing. Browser sessions retain the service's existing in-memory lifetime and may require ordinary sign-in after restart; persistent account and OAuth state remained exact. No login was performed for a user.

No live branding or other trip content was changed, and no Google/provider request, new credential/grant, permission, billing, service or network change occurred. Existing credentials were consumed through the established environment mechanism without disclosure or provisioning.

## Handoff

Deployment is complete. The designated content editor can now apply the already-approved private artwork and palette; that application was deliberately left to its separate assignment.

Server discovery is live evidence, not proof of a target client's generated write schema. Raw public-proxy `tools/list` and the target conversation's branding argument visibility were not independently captured. If necessary, refresh metadata for the same installed connection and verify `branding` on create/update before writing; preserve its identity and authorization. No replacement connection, grant or reauthentication workaround was attempted. There is no deployment blocker.

The outgoing report, source references and diff were manually reviewed; the framework privacy audit with the external denylist passed. Private receipts, backups and operational instructions remain outside the repository.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
