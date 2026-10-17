# Package provenance and verification

Prepared 2026-10-17. This is a portable source export, not a published directory release, automatic installer, new server deployment or new authentication grant.

## Basis

- Freshly read installed Coray Trip wrapper and manage-trips skill, version 0.2.1. Original App-bound source was not modified. Portable export removes the private App binding, personal author/contact fields and account-specific compatibility manifest; root plugin.json and mcp.json follow Agent Plugins 1.0.
- Skill preserves the installed workflow and adds task-specific references for the current six-tool content contract.
- Freshly inspected actual connected tool declarations for all six tools, including typed branding, cover, category, Google association and relatedLinks fields. No private trip read was required for packaging.
- Current public service-source documentation: references/mcp.md, references/trip-membership.md, references/trip-branding.md and references/trip-cover-and-categories.md in Build Shared Trip App. These are documentation and source-contract checks, not an independent recipient-client acceptance test.
- Source-level OAuth eligibility remains single configured approved Content manager; the relevant current OAuth source matches deployed source revision 04f6b01. A second independent account is not automatically eligible. Changing the configured principal may invalidate the first account's tokens and is not included in installation.
- Service host is the existing Coray Trip deployment, with source-confirmed /mcp routing. Independent cloud reads of public OAuth metadata returned 403; no bypass attempted. Do not label this a successful direct HTTP discovery test.

## Format and installation

The supported portable format has one enclosing coray-trip directory, root schema-declared plugin.json and mcp.json, and skills/manage-trips/SKILL.md with YAML name/description. No .app.json, private app dependency or legacy MCP-only configuration is included. DCR OAuth options follow the service's MCP documentation and official plugin package format; endpoint metadata is discovered by the recipient's authorized client.

Recipient-side Plugin Creator/import capability is required. A ZIP alone cannot install itself, provide an account, authenticate the user or assign trip membership. Where web uploading is available, use that account's official upload flow. Current official installation help:
https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
https://agent-plugins.org/

OAuth registration and user consent establish persistent access and must be completed through the recipient's supported approval/login flow. No credentials should be pasted into this package or chat. MCP endpoint accepts the documented ChatGPT redirect, not arbitrary client callbacks.

## Verification performed / pending

Performed: JSON parsing, manifest/name/version checks, skill frontmatter, six-tool contract comparison, ZIP traversal/symlink/component checks, credential/identifier scan and separate publication privacy review.
Pending: recipient-host import diagnostics, own-account OAuth eligibility/consent, actual target-client schema visibility and read-only list_trips/get_trip acceptance. No service changes, account provisioning, real-trip edits or external booking actions performed.

This bundle is suitable for forwarding and inspecting/importing in a supported host. It is not proof that a second user's OAuth account is enabled. Public-directory submission and its review materials are outside scope.
