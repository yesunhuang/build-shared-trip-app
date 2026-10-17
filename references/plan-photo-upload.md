# Uploaded itinerary photos

Each plan can have an optional `uploadedPhoto`, independent of its saved Commons or legacy `photo`/`photoSourceId`. In the plan editor, choose a PNG, JPEG or WebP (up to 8 MiB), preview it, provide descriptive alt text, and use the ordinary Save or Cancel controls. Preparation stays local until Save. Invalid files leave the previous draft intact; cancelled or superseded conversions cannot overwrite a later choice. Save is disabled during preparation. A stale save uses normal conflict recovery.

The browser converts accepted input to a bounded PNG. Shared server validation independently checks and re-encodes it, strips metadata, and accepts only nonanimated, noninterlaced 8-bit RGB/RGBA PNG up to 128 KiB and 1024 pixels per edge. The original file is not retained. Existing whole-trip size limits still apply.

## Shared web and MCP contract

The existing `apply_trip_changes` → `upsert_plan.plan` exposes a fully typed field:

```json
{
  "uploadedPhoto": {
    "mimeType": "image/png",
    "data": "<canonical PNG base64 without data URL prefix>",
    "alt": "Fictional harbor artwork"
  }
}
```

The object accepts only these three keys. Alt text is 1–160 characters, with no control characters. Omission preserves the existing upload; explicit `null` clears the uploaded override. This reveals a previously saved Commons/legacy image, if present. Choosing a Commons image deliberately replaces the uploaded override; the Commons Remove action clears both selections. The displayed image carries its applicable attribution: uploaded-image caption or the preserved Commons credit. Google details remain a separate official component, with their existing attribution and allowance controls. Uploaded images cause no place/photo search or Google request.

Read first; use stable day/plan IDs, fresh `expectedVersion` and a durable `requestId`. Validation, atomic batches, conflicts, retries and current trip authorization are shared with ordinary edits. Manage scope does not grant access to a nonmember trip. Read scope can read/export the image within an authorized trip but cannot write it. No new tool, grant or public media endpoint is introduced.

## Privacy and recovery

Sanitized image bytes live inside private trip JSON. Trip summaries omit them; protected trip reads and exports include them. Existing ACL, scope and no-store rules apply. Keep exports, snapshots and generated real-trip output private. Clearing/replacing an image does not erase historical exports, backups or durable retry records.

SQLite backup, restore, restart and JSON export/import retain the image. This additive field does not change the database schema. A rollback image must retain `uploadedPhoto` in shared writable keys, its raster validator and the shared `plan-photo.js` module; an older binary without those capabilities is unsuitable after photo writes. Restore a snapshot only as an explicit recovery decision, preserving later edits and allowance usage.

## Acceptance boundaries

`npm run test:plan-photos` exercises real local HTTP/MCP discovery, set/read/replace/null-clear, membership and scope denial, invalid images, atomicity/conflicts/retries, metadata stripping, import/export, restart and backup/restore, plus editor cancellation/error states. The optional `scripts/test-plan-photo-browser.mjs` uses existing Chrome/Playwright with fictional images: native PNG/JPEG/WebP inputs, preview, Save/Cancel, mobile widths, four languages and provider-request counting. Phone emulation is separate from physical-device acceptance. Google coexistence uses mocked components. Actual target-client field visibility and a permitted readback after deployment remain separate from server SDK discovery; refresh tools on the same installed connection rather than replacing it or adding grants.
