# Per-trip branding

The self-hosted trip page and its resources page can have an independent logo and light color theme. **Branding** in the trip's editing controls opens a native, scrollable dialog with a preview, image description, Default/Sage/Ocean/Plum presets, custom colors, Remove logo and Reset to defaults. Reset stages a change; Save commits it. Cancel leaves the trip unchanged. The home page, installation name, manifest, favicon, provider attribution and provider components retain the shared application's identity.

Owner, content managers and current trip creators can edit branding through the web. Existing owner/content-manager MCP credentials can edit the same fields; ordinary creators gain no MCP authority. Joined read-only members can read and export it. Archived trips must be restored before editing. A save uses the ordinary atomic `update_trip` operation, the version captured when the dialog opened and a durable request ID. An unknown network result can be retried identically; a conflict retains the draft and offers an explicit reload instead of overwriting newer edits.

## Data and MCP

Optional trip field `branding` has only `logo` and `theme`:

```json
{
  "branding": {
    "logo": null,
    "theme": {"preset": "sage"}
  }
}
```

A custom theme is `{"preset":"custom","ink":"#183b30","accent":"#628b49","background":"#f1f8ef"}`. Colors must be six-digit hexadecimal. Custom backgrounds must have relative luminance at least 0.8; the ink must meet 4.5:1 against the background and supported light surfaces. Rendered accent/muted shades are darkened to meet 4.5:1 and meaningful borders meet 3:1. This is a light-theme editor; dark themes are not supported. Fixed semantic warning, checklist, map and weather colors are preserved.

An embedded logo is `{"mimeType":"image/png","data":"<base64 PNG bytes>","alt":"Fictional trip emblem"}`. `data` is bytes, not a data URL, remote URL or asset path. MCP discovery revision 1.2.0 describes this structure for `create_trip` and `apply_trip_changes` → `update_trip.fields.branding`; `get_trip` and `export_trip` return it. The same six tools, authorization and shared validation remain in use. For example:

```json
{
  "tripId": "fictional-trip-id",
  "expectedVersion": 3,
  "requestId": "fictional-branding-edit-001",
  "changes": [{"type":"update_trip","fields":{"branding":{"logo":null,"theme":{"preset":"ocean"}}}}]
}
```

Omitting `branding` from update fields preserves it. Setting it replaces the complete branding object: nested fields are not merged. To change only the theme while retaining a logo, read the current trip and include its existing logo with the new theme. Omitted logo selects the default icon; omitted theme selects the legacy/default theme. `branding:null` removes branding and restores the legacy/default presentation. The editor's reset explicitly saves `{ "logo": null, "theme": { "preset": "default" } }`, even if a legacy theme remains stored. Existing trips without the field are unchanged on read and require no migration or version bump.

The deployed server's discovery and the installed client's generated schema need separate verification after a future rollout. Refresh metadata for the same installed connection through its supported client settings; this feature adds no login requirement, scope, grant or connection identity. A local SDK test is not evidence that a target conversation has refreshed its tools.

## Safe image handling

The browser accepts PNG, JPEG or WebP files up to 8 MiB, decodes locally with a bounded wait and dimension limits, and downsamples to at most 256 pixels per edge and 64 KiB. It emits a new PNG through Canvas; no upload goes to an image provider. Pending or canceled conversions cannot overwrite a later selection or reset.

The server independently validates canonical base64 and a bounded PNG structure, chunk CRCs, dimensions, inflation size, row filters and end-of-file. It accepts only non-animated, non-interlaced 8-bit RGB/RGBA PNGs; other formats, palette/transparency chunks, remote URLs and SVG are refused. It re-encodes the raster stream and removes ancillary metadata. MCP callers must prepare this bounded PNG themselves or use the editor's conversion. Labels are text, not HTML. The ordinary authenticated trip response carries the logo; there is no public asset endpoint, remote fetching, filesystem filename or new permission.

## Durability and rollback

Logo bytes and theme live in the existing SQLite trip JSON. The existing consistent database snapshot/restore and JSON export/import include them without a separate asset copy or provider dependency. Local tests cover metadata removal, HTTP/MCP writes, conflicts, durable retries, restart, isolated restore and export/import. Resetting or removing a logo does not erase older backups, exports or retained idempotent results; protect those as private trip data.

No SQLite schema migration is needed. Earlier application validators do not recognize the new field: an old presentation can ignore it when reading, but an image rollback using an old validator cannot safely edit or re-import branded trips. A deployer must retain this validator in a compatible rollback build, or keep the new release until forward recovery is available. Never discard branding or restore an old database over later edits or allowance usage to make an old image accept it. Deployment and real-trip changes require separate authorization.

Branding adds no external image requests, provider lookups, Google components, allowance reservations or paid services. The ordinary same-origin module loads and authenticated trip reads/writes carry the editor and saved branding.
