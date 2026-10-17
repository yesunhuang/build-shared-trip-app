# CP043 — Independent account MCP OAuth

- Date: 2026-10-17; agent: Codex B; status: complete; active time: approximately 30 minutes.
- Implemented/deployed source: `ac2e97ad1fdd4283dc36a22e976a02efe3966fc4`. Portable-package correction: `48aba15`.

## Changes

Explicit `SHARED_TRIP_OAUTH_MULTIUSER=1` permits existing approved accounts to consent independently, preserving the original singleton setting, clients and grants. Members receive `trips:read` and three read tools; content managers can receive read or six-tool management, bounded to current member trips. Consent and token responses disclose the actual scope. Website roles, memberships and account administration are unchanged.

`server/auth/oauth-scopes.mjs`, `server/auth/oauth.mjs`, `server/oauth-http.mjs`, `server/auth/policy.mjs`, `server/content-access.mjs`, `server/trip-membership.mjs` and `server/mcp.mjs` enforce role/scope ceilings independently of tool visibility. Read grants cannot write even for a website trip creator. Cross-client or unverifiable used-code replay cannot revoke another grant; correctly bound code replay and refresh reuse still revoke their own family. PKCE, CSRF/state, exact redirects/resources, rate limits, account epochs, expiry and independent revocation remain enforced.

Schema v8 in `server/db.mjs` versions read/manage scope validation without rewriting existing rows. Configuration examples and contracts document legacy mode, independent consent and an auth-compatible rollback.

The retained portable package in `packages/coray-trip/2026-10-17/` is updated to 0.3.0, with a reserved example endpoint and private installation-time replacement instructions. Existing skill/content guidance remains. No installed connection was replaced. `.gitattributes` fixes package text to LF; the ZIP and internal/outer checksums use those same bytes. Read-only installation acceptance no longer requires write-field schemas.

## Evidence

- Full `npm test` passed (214 seconds), including actual HTTP/SQLite/official MCP SDK multi-account tests: legacy grants after v7 upgrade, two-account isolation, read/manage consent, three/six tools, direct/cached write denial, current membership removal, export/API/media boundaries, conflicts, durable retries, replay, refresh, revocation and read-grant restore. All fixtures fictional.
- Actual Chrome consent checks passed at 1280, 390 and 320 px: explicit Allow/Deny, native Enter/focus, role/scope disclosure, no horizontal overflow and touch targets. A sub-44-pixel input was corrected. Phone widths are emulation; physical Android and recipient hosts are untested.
- Fictional demo regeneration, fresh disposable generation/static QA, diff checks and framework privacy with the external private denylist passed.
- Accepted and distinct auth-compatible rollback images passed Linux legacy OAuth, multiuser OAuth and membership suites. Both restored a fresh actual prior-schema snapshot to v8 with every table row preserved; cross-image validation passed. Fresh online and stopped backups and photo archives were digest-verified off host. The rollback retains current auth/scope/ACL validators and never restores older live data or allowance usage.
- Live immutable image/module bytes and 25 served assets match the accepted source. HTTPS health, both-scope metadata/S256/401 discovery and 11 anonymous protected-route boundaries passed. Only the app restarted; its port remains private and existing network controls are unchanged.
- Every table row matched at cutover. Final checks preserved trip content/versions, memberships, accounts/roles, credentials, clients/grants, photos, Google settings and the separate allowance ledger. Only ordinary existing-client authentication activity was allowed in the final comparison; no counter was reset or lowered. Configuration changed only the image tag and multiuser flag.
- Actual existing native MCP `list_trips`, `get_trip` and `export_trip` succeeded after rollout; visible versions and exported content match, editing capability remains and administration is absent. Current-account role/scope/membership decisions were separately checked read-only in the running shared domain. No recipient login, consent, new credential/grant, real trip edit or Google request was performed.
- Independent package QA found the initial ZIP/source line-ending mismatch. After correction, a fresh fetch verified every ZIP entry against the published Git blob and all source/internal/archive SHA-256 values. The example endpoint and scope documentation passed independent review. Recipient import/consent remains separate.

## Remaining work

Each recipient supplies the established server address privately, imports/updates through the supported host flow, signs in personally and consents. Verify actual three-read or six-manager discovery and an authorized read. SDK acceptance does not prove a recipient host honors reduced scopes. Existing manager connections need no replacement consent for this compatible upgrade.

The separately authorized mobile language-label refinement is picked up after this completed OAuth acceptance and will receive its own tested rollout/checkpoint. The known Claude route remains unavailable; no Claude execution is claimed. Actual outgoing report/package content was manually reviewed; no private configuration, identifiers, itinerary or screenshots are included. Historical publication was not rewritten.

## comment

Reserved for sanitized continuation instructions from the owner or authorized coordinator.
