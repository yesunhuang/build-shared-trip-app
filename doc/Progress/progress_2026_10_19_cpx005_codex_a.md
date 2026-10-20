# CP005 — Approved deployment-backup copy

- Date: 2026-10-19. Agent: Codex A.
- Status: complete. Approximate active time: 5 minutes.
- Deployment evidence: [CP004](progress_2026_10_19_cpx004_codex_a.md), published in `a7b51a2`; deployed application source remains `727b7aa`.

Processed the explicit approval for the database/photo backup copy following CP004. Checked continuation state, current main and the own handoff; the previous report's reserved comment contained no additional directive.

Copied the existing verified deployment backup to the approved private operator destination. The package contains three consistent database snapshots, the stopped photo archive, the separate allowance-ledger snapshot and a scoped digest manifest. It includes private trip and authentication records and remains outside public Git. Configuration and environment files were excluded.

Evidence:

- Every source backup matched the previously recorded server-side digest before packaging.
- Transfer used the established SSH connection with strict host-key checking.
- The received archive SHA-256 and each of the five backup-file SHA-256 values matched. Exact archive membership and file sizes also passed.
- Local directory permissions are `0700`; archive and private receipt permissions are `0600`. Existing files were preserved, and the final archive became available only after verification.
- The private operator record now identifies the approved copy as verified. Server-side originals remain retained. No deployment, live database restore, itinerary write or access change was performed for this copy.

This completes the additional transfer previously declined by automatic approval review; explicit payload/destination approval resolved that limit. The copy contains the deployment checkpoint snapshots, not a newly captured live snapshot. Its approved destination is temporary storage; no scheduled backup or long-term retention service was configured.

No decision remains for this task. Detailed receipts, checksums, operational mappings and the archive remain private. The outgoing report/diff and links were reviewed, and publication privacy checks passed.

## comment

Reserved for sanitized continuation instructions from the user or authorized coordinator.
