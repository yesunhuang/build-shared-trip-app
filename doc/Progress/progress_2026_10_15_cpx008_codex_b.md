# Progress report — Codex B, checkpoint 008

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: partial; OAuth implementation and local acceptance complete, rollout and owner-controlled client connection pending.
- Approximate active time: 50 minutes.
- Base: `2bde9be`, following checkpoint 007. Its comment section contained no new directive.

## Changes

Added the OAuth server in `server/auth/oauth.mjs` and `server/oauth-http.mjs`, integrated with `server/app.mjs`, the existing content gateway and account policy. Protected-resource metadata, the MCP 401 challenge and authorization-server metadata support discovery. Public-client dynamic registration accepts an exact callback allowlist. Authorization uses dedicated account sign-in, explicit consent, PKCE S256 and issuer identification.

Only the explicitly configured, approved content manager may authorize scope `trips:manage`. OAuth exposes the same six MCP content tools across current and future trips. Owner-only account, invitation, role, credential, security and infrastructure operations remain excluded. Existing owner bearer, manager bearer and browser access remain supported.

Codes are single-use and valid for three minutes. Opaque access tokens last at most 15 minutes. Refresh tokens rotate within an absolute 90-day grant. Only digests are stored. Replay ends the entire affected grant; cleanup retains the necessary replay records while a grant is usable. Revocation, account changes and role changes invalidate access. Audit events contain bounded metadata only.

Schema v5 adds OAuth tables without changing prior records, validates the retained pre-migration snapshot and extends snapshot validation. `assets/selfhosted/home.js`, `home.css` and `assets/app-template/public/hosted-client.js` add owner-only browser-connection listing and revocation in four languages. Deployment templates, service-worker exclusions and the public guides describe the new flow.

## Evidence

- Full `npm test` passed in 73 seconds: legacy/generator checks, existing backend and role tests, 35 OAuth checks, and all UI simulations including `scripts/test-oauth-owner-ui.mjs`.
- `scripts/test-oauth.mjs` exercises actual local HTTP and the official SDK OAuth provider: discovery, registration, S256, exchange, six-tool use and automatic refresh. Denials cover client/redirect/resource/scope errors, code replay, PKCE, expiry, administration and non-MCP routes. It also checks rotation, revocation, account changes, restart persistence, digest-only storage, audit sanitation, v4 upgrade and snapshot restore/tampering.
- The cleanup regression advances a fictional clock beyond 14 days, sweeps and restarts, then confirms old refresh-token and code replay still revoke live grants. The 90-day horizon remains fixed.
- Chrome with fictional accounts completed sign-in and consent, discovered six tools and read two fictional trips through the fixture connector. Denial and owner UI revocation worked; the manager could still sign into the website afterward without administration controls. Desktop and 390/375 px emulation showed no horizontal overflow; the owner panel was checked in all four languages. These are local browser checks, not physical-device or actual ChatGPT-client evidence.
- Rebuilt the fictional `docs/` demo, generated fresh disposable output outside the checkout and passed static QA. Framework privacy auditing passed, including the external private denylist. Screenshots and raw logs remain outside public Git.

The first protocol run hit a stale pooled socket during an intentional same-port restart. The test harness now closes its ordinary HTTP connections; the complete rerun passed. A focused helper correction fixed the refresh-history cleanup defect before acceptance. No production workaround or retry of an uncertain write was introduced.

Five bounded public-only Claude tasks used the verified `claude-opus-5-5` model for backend implementation, documentation, schema-test maintenance, owner UI and the focused correction. Codex integrated the results, made small test/comment corrections, ran acceptance and retained private operations.

## Current state and next action

The existing live service is healthy on its prior image. A consistent preflight snapshot was restored under that image with every existing table row and the photo store matching. No live password was read, no OAuth grant was created by the agent and no real trip data was imported.

Next: publish the reviewed source, run the production-image Linux checks and isolated v4-to-v5 restore/preservation drill, then perform the authorized application-only rollout with a fresh cutover backup. Update the existing private plugin in place after live discovery checks. Stop for the owner to sign in and consent through the actual client; verify its read-only tool result before claiming compatibility. No permission-scope decision is missing.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
