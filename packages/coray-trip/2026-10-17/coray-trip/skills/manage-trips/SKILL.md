---
name: manage-trips
description: Use when the user asks to review or manage trips in their connected Coray Trip app.
---

# Coray Trip

Use the connected Coray Trip MCP tools for the user's requested trip-management work. Preserve the existing app and hosting.

## Access and scope

- Use only the tools and input schemas actually exposed by the connected server. Do not invent tool names, supported fields, or capabilities.
- The connected account's permissions define available access. Never change roles, authentication, tokens, or access permissions as part of ordinary trip management.
- If connection is incomplete, use the host-supported connection flow. The owner must enter credentials in the supported secure interface. Never request or store passwords, bearer tokens, or other secrets in chat, files, or plugin configuration.
- After connecting, verify access with an appropriate read-only tool before claiming the connection works. Do not make a change merely to test authentication.

## Workflow

1. Resolve the requested trip and read its current state. Ask when multiple trips match and the intended target cannot be determined.
2. Use available read-only tools to answer questions and summarize relevant details. Distinguish confirmed app data from suggestions or unknowns.
3. Make only changes covered by the user's request and applicable confirmation requirements. Confirm recipients and sharing targets before any authorized sharing action.
4. Check the result after a change and report what was confirmed. Do not repeat an uncertain write without first checking the current state.

The plugin does not itself authorize bookings, purchases, external communications, credential management, or expanded access.

## Installation and current content contract

Read [setup and troubleshooting](references/setup-and-pitfalls.zh-CN.md) when installing, connecting, refreshing metadata or diagnosing access. Read [content operations](references/content-contract.md) before editing location, branding, cover or card categories.

The portable package connects an existing service; it does not deploy a server, copy another person's App binding, grant, account or trip membership. Use the current host-supported import/create flow, then the recipient's own eligible OAuth sign-in and consent. Never claim an installation or connection succeeded based solely on the ZIP or a successful package upload.

Read-scope connections expose list_trips, get_trip and export_trip. Manager edit-scope connections retain create_trip, apply_trip_changes and import_trip too (six total). The current role, credential scope and current membership all limit access. A Member must never be promoted to connect; a website creator with read-only OAuth still cannot write. Verify the actual exposed schemas. No MCP tool administers members, accounts, roles, invitation codes, grants, credentials or permanent deletion. Read-only members/access metadata is not writable trip content and is not part of content exports. participantGroups is itinerary grouping, not access control.

Read the current trip version before writing. Use narrow changes and stable IDs. On an uncertain write, read the result or retry the identical payload with the same requestId; never issue a new requestId blindly. On a version conflict, re-read and reconcile before a new request. import_trip creates a new trip, never overwrites an existing one, and never imports access grants.
