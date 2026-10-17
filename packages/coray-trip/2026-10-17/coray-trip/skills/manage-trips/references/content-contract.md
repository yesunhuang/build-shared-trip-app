# Content operations and verified boundaries

Contract checked against installed tool declarations and current service source on 2026-10-17. The recipient's actual tool schema remains authoritative.

## Versioned editing
- Read scope: list_trips, get_trip, export_trip. Manager manage scope retains six tools, also create_trip, apply_trip_changes, import_trip. All content fields below apply only when the actual tool/schema and role/scope allow the operation.
- get_trip gives current trip/version and read-only planLocationBindings, members and access metadata. Resolve IDs from reads, never from guesses.
- apply_trip_changes needs tripId, expectedVersion, requestId and changes. Invalid batches are atomic. delete_day, delete_plan, delete_reminder and replace_content are destructive.
- Prefer narrow update_trip or upsert_plan operations. Do not use replace_content to evade a stale or missing client schema.
- Reuse identical requestId and payload after an uncertain response. A conflict needs a fresh read and reconciled operation. Read back successful writes. Do not write merely to test connectivity.

## Branding
branding is a whole-object replacement, not a nested merge. Omit it to preserve; null clears it. When retaining a logo while changing theme, include the current logo. Explicit reset is {"logo":null,"theme":{"preset":"default"}}.
Logo: canonical base64 PNG, no data URL; at most 64 KiB, 256 pixels per edge, non-animated/non-interlaced 8-bit RGB or RGBA, alt text. No SVG, remote URL or palette PNG. Prepare with headroom. Server sanitization re-encodes and strips metadata, so raw byte hashes may differ; check dimensions and decoded pixels instead.
Themes: default, sage, ocean, plum, or custom with preset=custom, ink/accent/background six-digit hex colors. Custom background luminance >=0.8 and ink contrast >=4.5:1. This is a light theme. Changing a trip's branding does not change the installed app identity.

## Cover and highlights
cover is separate from branding.logo. Omit to preserve, null to clear. Object: mimeType=image/png, canonical base64 data, alt (1–160 characters), optional focusX/focusY (0–100, default 50). At most 256 KiB and 1024 pixels per edge; same non-animated/non-interlaced 8-bit RGB/RGBA restrictions. Original artwork is not retained, so keep your own original privately.
cardCategory enum: neutral, restaurant, hotel, ticketed-transport. It is an explicit visual highlight and never changes planType, booked, booking data, routing or coordinates. Do not infer ticketed transport from generic transport/walking/car text. Use neutral to clear a highlight.

## Maps and providers
- An address, Google association or valid location binding does not itself ensure a map marker. The itinerary map needs finite verified lat/lng and mapLocationOmitted unset/false.
- A legacy mapsUrl may produce a binding without deriving coordinates; explicit-write coordinate derivation uses canonical googleMapsUrl. Never guess coordinates, place IDs or OSM objects.
- Prefer a verified user-selected OSM place snapshot or independently verified coordinates. A stored place remains the location source; when intentionally switching to googleMapsUrl, send place:null with it. Clear both when removing all location information.
- googlePlaceAssociation contains a person-confirmed exact public-venue placeId, the current non-null locationBinding from get_trip, and publicVenueConfirmed:true. null removes it. Location changes invalidate old associations. No MCP Google/OSM/Commons search tool exists.
- Google UI Kit content and attribution stay in the supported provider component. Do not extract/rehost its photo URLs, ratings or reviews into trip data. Keep separately chosen trip/Commons artwork distinct and correctly credited.
- googlePlacePhotosEnabled is a trip boolean, default false, requiring an already operator-enabled site feature. Changing it does not provision a key or budget. Never reset the monthly usage ledger or initialize it again as a UI fix.

## Access and sharing
Only owner administration has global access. Content managers, including assistants, require membership per trip. New trips created by somebody else do not automatically enroll them. Ordinary members may create/manage their own trip in the web UI but membership/creator status alone does not grant MCP authority. A legacy creator may be unknown; do not infer creator/invitation authority from itinerary names.
Membership and invitation administration are authorized owner/current-creator HTTP/UI operations, not MCP tools. A trip code is for an already approved account and is not an account invitation. Exports/imports contain content, not memberships or authorization. Keep exports, embedded photos and backups private.

## Uploaded plan photos
upsert_plan.plan.uploadedPhoto is a fully typed object or null. Omit to preserve; null removes the uploaded override, revealing any saved Commons/legacy image. Object keys are exactly mimeType=image/png, data (canonical base64 without data URL prefix) and alt (1-160 characters, no controls). Maximum 128 KiB decoded and 1024 pixels per edge; nonanimated, noninterlaced 8-bit RGB/RGBA PNG only. Prepare PNG/JPEG/WebP input locally to this canonical contract; the server strips metadata and re-encodes it. Original files are not retained.
Read get_trip first and use a fresh expectedVersion, stable IDs and durable requestId. Read back successful edits; do not replace the whole trip for a missing field. Shared validation, membership and read/manage scope limits apply. get_trip/export_trip/import_trip retain the image. No provider search, Google content extraction, public image URL or new grant is required. Saved Commons attribution remains with its baseline; Google details stay a separate attributed component. Keep uploaded artwork, exports and backups private. Use only artwork the user is entitled to upload.
The web plan editor supports local preview, alt text, Save/Cancel, replacement and clearing. This content field requires deployed server schema support and actual target-client visibility; package version alone cannot add a missing tool parameter. Use supported Reload tools on the SAME installed connection, without disconnecting or reauthorizing it merely for content writes.
