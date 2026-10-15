# Progress report — Codex B, checkpoint 007

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: partial; implementation and deployment complete, owner provisioning and actual external-client acceptance pending.
- Approximate active time: 55 minutes cumulative in this assignment.
- Application/source image: `e31cbfd`; local acceptance report: `1320d1a`.

## Completed rollout

Continued checkpoint 006's next action; its comment section contained no new directive. Built the immutable production image and ran `scripts/test-content-manager.mjs` inside it on Linux with networking disabled and fictional temporary data. All role, MCP read/write, denial, expiry, revocation, audit, persistence, upgrade and restore checks passed.

Before deployment, restored a consistent service snapshot with the previous image and matched every original table. Separately restored/migrated that snapshot with the new image: all original trip, retry, account and invitation fields matched; existing accounts defaulted to viewers and no credential was issued.

At cutover, stopped only the application, took another validated consistent snapshot and copied the protected photo store byte-for-byte. Recreated the application with the accepted image. Health became good; the proxy remained running. Live schema v4 preserved all three trip rows, ten retry records, one account and one invitation exactly, plus the photo. Only the private image-tag setting changed; existing credentials and other configuration were retained. A new post-upgrade snapshot also passed integrity and schema validation. Previous images, snapshots and separate restored storage remain available for rollback.

## Live and local evidence

At 03:07 UTC, public HTTPS with certificate verification enabled returned:

- 200 for the generic home and health endpoints.
- 401 for anonymous trip, account, audit and session APIs, MCP and protected media.
- `Cache-Control: no-store` throughout; edge cache status was dynamic or bypass, with no Age header.

These are live anonymous/privacy checks, not authenticated content-manager or external-client evidence. Live metadata confirmed no approved account, no requested manager account and no MCP credential. The existing revoked viewer remains unchanged.

Checkpoint 006 records the clean full `npm test`, desktop/phone Chrome fixtures, four-language checks, fresh generation/static QA and the read-only SDK checker. All four public-only Claude receipts identified `claude-opus-5-5`; Codex performed local and live acceptance. No live credentials or private operational details were supplied to helpers.

Updated `README.md`, `deploy/README.md` and the feature contract with the tested scope, and corrected trailing whitespace in checkpoint 006 without changing its comment. Reviewed outgoing text/metadata and ran framework privacy auditing with an external private denylist before publication.

## Owner handoff and remaining acceptance

Prepared the deployed sign-in page and private provisioning instructions. Stopped before owner credential entry, account-password setup, live token issuance and client configuration, as required by the active assignment. No real trip was imported.

The owner must finish the dedicated account's enrollment, select and save the content-manager role, approve it, then issue the 90-day MCP credential and place it directly into the actual client's private store. This scope is already approved; the remaining step is owner-controlled credential handling.

After setup, the actual client must initialize MCP, discover the six content tools and perform a read-only trip listing. Until that happens, authenticated content-manager traffic through the public proxy/CDN and named-client compatibility remain unverified. Custom-header Streamable HTTP is supported; OAuth-only clients require additional work. The standalone SDK checker proves only its own protocol path.

No role-scope decision remains missing. Resume with the owner's completed provisioning and safe client/version plus connection results; never request a secret in chat. Real-data import remains outside this assignment.

## comment

Reserved for continuation instructions from the user or authorized coordinator.
