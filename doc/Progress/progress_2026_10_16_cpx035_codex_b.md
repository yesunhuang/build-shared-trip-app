# CP035 — Existing MCP branding integration repaired

- Date: 2026-10-16 UTC
- Agent: Codex B
- Status: complete — registered metadata corrected; fresh target-client read/write confirmed
- Approximate active time: 15 minutes
- Running source unchanged: `3aadf973410174a8138943059d155eb351e82050`
- Baseline: `5b68534`, [CP034](progress_2026_10_16_cpx034_codex_b.md)

## Verified cause and correction

Checked current instructions, main, handoff and report comments; no additional actionable continuation or unrelated local edit was present. Private integration work remained with Codex.

The origin's CP033 contract exposed branding, but the existing registered App's imported discovery record still showed the pre-branding `get_trip` description. Before correction, the designated target assistant and a fresh worker exposed earlier optional fields but omitted branding on create/update. The target assistant confirmed that the same connection had not been refreshed since CP034. This established a stale registered discovery contract; caching was not assumed from source inspection alone.

Inspected both existing package inventories and their App bindings. Neither contained an embedded API/tool schema, and both pointed to the same registered App. Wrapper version 0.2.1 and App-backed package version 1.0.0 were manifest versions, independent of the server's MCP metadata revision. A package version bump would not repair the owning App record.

Used **Reload tools** in that same App's supported management page through an already-connected browser. The App/connection, linked account and OAuth method were retained; no sign-in, new consent or replacement connection was created. Afterward its registered `get_trip` description explicitly included branding. Read-back inspection found both packages' identities, releases and inspected files unchanged. No runtime source change, plugin upload, deployment or application restart was needed.

`references/mcp.md` now documents the App-bound metadata ownership, the supported management control, branding fields to check and fresh target-client acceptance. The [official OpenAI refresh procedure](https://developers.openai.com/plugins/deploy/connect-chatgpt#refresh-metadata) likewise calls for refreshing the existing custom connection and testing a fresh conversation after metadata changes.

## Target-client acceptance

After reload, the designated assistant independently reported a fresh worker on the same integration exposing:

- `create_trip.trip.branding` and `update_trip.fields.branding`: optional object or null.
- Nullable PNG logo with `alt`, base64 `data` and `mimeType`, including the documented image bounds.
- Default/Sage/Ocean/Plum presets and custom ink/accent/background fields, plus reset semantics.
- Existing trip Google boolean, Google association, selected place and related-link fields retained.

The updated read-tool description was visible, and an existing `list_trips` call succeeded. The assistant then separately completed its already-approved private artwork/palette application through that same native MCP integration, with one atomic branding-only write and fresh read-back. It confirmed pixels, alternative text and theme; no artwork, trip identifier or itinerary content was relayed for this diagnostic.

Independent read-only server reconciliation found one matching durable result and accepted MCP audit event, one version increment, and changes limited to branding plus ordinary version/timestamp metadata. Every other field and trip was exact against the rollout baseline. Codex performed no branding write or backend fallback. This is target-client read/write evidence, beyond local SDK discovery.

## Preservation and diagnostic limits

Photos, environment configuration and the separate Google allowance ledger's identity, rows and counts were exact against the task preimage. Accounts, roles, client registrations and grant identity/audience/scope/expiry/revocation were unchanged. Normal existing OAuth refresh/usage metadata and the separately approved branding write were preserved. The same application container/image remained healthy. No new credential provisioning, permissions, network/security settings, provider request or cost was introduced.

An independent authenticated public-endpoint raw `tools/list` capture was refused at the edge with HTTP 403 / browser-signature error 1010, before application discovery. That client's raw public response could not be compared byte-for-byte; no user-agent substitution or policy change was used to bypass it. The existing registered-client path succeeded through supported reload and actual target-client reads/writes. CP034's production-loopback SDK contract, the registered App record and fresh generated target schema were compared separately; none is mislabeled as a captured raw public response. No packaged OpenAPI schema was found in the inspected sources.

This long-lived agent's earlier tool catalog remained older and returned `Unknown tool` on its diagnostic read; fresh target-client verification is the relevant acceptance. Older open contexts may still need a fresh worker/conversation with the same integration. No further deployment or owner action is needed for the repaired workflow.

No runtime tests or generation were repeated for this metadata/documentation-only correction. Actual browser control, target-client schema/read/write and read-only persistence checks provide the new evidence; CP033/CP034 retain the unchanged implementation's regression evidence. Referenced paths, outgoing diff and the framework privacy audit with the external denylist passed. Private receipts and the browser proof remain outside public Git.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
