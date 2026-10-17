# Independent account OAuth for MCP (schema v8)

This opt-in mode lets existing approved accounts independently authorize their own MCP clients. It changes neither website roles nor trip memberships. Only the owner administrator has global access. Existing clients, singleton configuration, grants, resource/audience and absolute authorization horizons remain intact.

## Enablement and scope

`SHARED_TRIP_OAUTH_MULTIUSER=1` enables independent consent. Any other value retains legacy singleton selection through `SHARED_TRIP_OAUTH_USERNAME`; an unset singleton in legacy mode denies OAuth. Keep the singleton value unchanged when enabling the new mode. Neither setting enrolls or approves an account.

| Current account and requested access | Granted scope | MCP tools |
| --- | --- | --- |
| Approved Member (`viewer`), including a website trip creator | `trips:read` | `list_trips`, `get_trip`, `export_trip` |
| Approved content manager requesting read-only access | `trips:read` | The same three read tools |
| Approved content manager requesting management | `trips:manage` | The existing six content tools, bounded to member trips |
| Pending, revoked, missing account or owner admin credential | None | No OAuth authority |

Discovery advertises both scopes. A Member's legacy manage request is capped to read, with the actual scope shown in explicit consent and every token response. This policy-limited selection follows [RFC 6749 section 3.3](https://www.rfc-editor.org/rfc/rfc6749#section-3.3). It preserves the existing package request shape without promoting the account. Clients must honor the returned scope. The official MCP SDK fixture exercises discovery, consent, code exchange and automatic refresh with this cap; actual recipient-client acceptance remains a separate check.

The account holder personally signs in and consents. Website cookies never substitute for this flow. Every code is bound to the selected stable account, epoch, client, redirect, resource, scope and S256 verifier. Code exchange never takes its identity from another website session or a submitted account override. Existing PKCE, CSRF/state handling, exact redirect/resource validation, rate limits, 15-minute access expiry and 90-day grant horizon remain in place.

## Enforcement and revocation

- Each MCP request rechecks the current account role/status/epoch and token/grant scope/resource before enforcing current trip membership in the shared domain.
- Read grants cannot create, import, mutate, replay a write or use editor lookups, even when the account is a manager or a website trip creator. Only three tools are registered, and the shared write boundary independently refuses cached or direct write attempts. Permission projections are capped to the credential too.
- MCP credentials authorize no website/API/media endpoint or membership/account/security administration. They never expose the Google browser key or reserve provider usage.
- Removing membership ends access to that trip immediately, including export and retries; it does not grant access to another trip. New trips created by others never auto-enroll an assistant or recipient.
- Grants and token families are independent across accounts and clients. A wrong-client or unverifiable used-code replay cannot revoke another family's grant. A correctly bound code replay or refresh reuse still ends its matching family. Account revoke/role changes and owner grant revocation remain immediately effective.
- Server storage and audit remain digest-only and payload-free. There is no token, password or client secret to distribute through a package or chat.

## Upgrade and compatible rollback

Schema v8 adds a scope-format version and accepts read grants alongside unchanged legacy manage grants. It changes no existing table rows, roles, grants, memberships, trip content or allowance state. A fresh consistent backup and isolated restore must precede rollout.

A compatible rollback must retain schema-v8 scope validation, multiuser eligibility, role/scope ceilings and the current membership enforcement. Test later read/manage grants, refresh/revocation and versioned writes in disposable storage before cutover. Keep the current database and allowance ledger; never restore historical consent/revocation, edits or usage over later state. A pre-v8 binary is not a compatible live rollback once new scopes exist.

Turning multiuser mode off restores singleton eligibility without reassigning or deleting grants. This is a mode switch, not individual revocation. To end one recipient's access, revoke only that account's grant or account through existing owner controls.

## Recipient-controlled connection

1. Use your own approved existing account and your own client connection to the established service. Do not reuse another person's credentials, replace their connection, or change an account role to connect.
2. Select OAuth. The existing endpoints and public-client registration mechanism are unchanged. Read-only profiles may request `trips:read`; existing manage profiles are policy-capped as above.
3. Enter your own credentials in the service's supported sign-in page and check the displayed account, client, return address and read/edit consent. Approve or deny personally. Never send passwords, codes, verifier values, tokens or callback URLs containing code/state through chat or Git.
4. Verify three read tools or six manager tools, then use `list_trips` and an authorized `get_trip`. A successful server fixture does not establish that this recipient has consented or that their client's cached schema is current.

Existing manager connections require no replacement or new consent merely for this backward-compatible rollout. The portable package uses a reserved example origin that must be replaced in the recipient's private setup copy. Preserve existing installed connection identities when refreshing metadata; creating a recipient's own connection is separate from replacing another account's connection.
