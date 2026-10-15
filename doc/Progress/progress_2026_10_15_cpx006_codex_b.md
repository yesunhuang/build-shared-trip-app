# Progress report — Codex B, checkpoint 006

- Date: 2026-10-15 UTC.
- Agent: Codex B.
- Status: partial; implementation and local acceptance complete, Linux rollout and owner provisioning pending.
- Approximate active time: 40 minutes in this assignment.
- Implementation: `e31cbfd`, based on `39f72b0`.

## Scope and changes

Continued the authorized all-trip content-management assignment. The previous report's comment section contained no new directive.

Added the `content-manager` account role, covering content and media across current and future trips while keeping account, invitation, role, credential and security administration owner-only. Schema v4 adds default viewer roles, digest-only MCP credentials and a bounded metadata audit log. Existing identities, trip versions, approval states and retry records are preserved; upgrades retain a pre-migration snapshot.

HTTP and MCP use `server/content-access.mjs` for authorization and audited content writes. MCP now includes `import_trip` and `export_trip`. Owner-issued credentials last exactly 90 days, work only at MCP, and become unusable after expiry, revocation or role changes. Reapproval revives no old session or credential.

Updated `assets/selfhosted/`, the shared hosted client, contracts and deployment guidance. Owner controls provide explicit role saving and one-time credential display/copy/dismiss; managers receive content controls and viewers remain read-only. Added backend/UI suites and the owner-run, read-only `scripts/mcp-check.mjs`. Regenerated the fictional `docs/` demo.

## Evidence

- Full `npm test` passed, including new backend and UI suites. Actual local HTTP/official-SDK MCP checks covered all content operations, administration denials, expiry, revocation, conflicts, atomicity, retries, persistence, schema-v3 upgrade and snapshot validation. Simulated audit failure rolled back the content mutation.
- The read-only SDK checker passed with fictional credentials, refused revoked/malformed credentials and left trip and retry records unchanged.
- Demo regeneration and generation/static QA on fresh disposable output passed.
- Chrome checked desktop creation and phone layouts at 390/375 CSS pixels: manager creation, archive/unarchive and a saved trip edit; owner role/token-panel visibility; viewer read-only controls; all four languages without horizontal overflow at the narrow breakpoint. These used fictional local session-injection proxies for layout and interaction, not browser-authentication or physical-device evidence.
- A pre-upgrade service snapshot and isolated restore with the existing image matched all four original tables exactly. The live application remained unchanged.
- Framework privacy audit, an external private denylist, diff checks and outgoing metadata/content review passed before publication.

The first full run exposed sensitive-field false positives in method names and a fictional test object; those were corrected with the scanner unchanged. One existing UI test timed out under concurrent load, then passed both in isolation and in the complete clean run. No test failure remains.

## Delegation and remaining work

Four restricted, file-only public-export Claude tasks produced backend, UI/docs, browser-fixture and read-only-check code. All receipts reported `claude-opus-5-5`. Helpers ran no tests; Codex integrated with minor naming/test-contract corrections and ran acceptance. Private operations and live mappings stayed outside helper workspaces and Git.

Next: build the immutable image, validate Linux execution and migration against separate restored storage, then perform the authorized upgrade. Live manager credentials and the actual external AI client are untested. Account/password provisioning and credential entry/configuration remain owner-controlled; no real-data import is authorized.

## comment

Reserved for continuation instructions from the user or authorized coordinator.

