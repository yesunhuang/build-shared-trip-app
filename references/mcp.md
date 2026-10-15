# Remote MCP

The authenticated /mcp endpoint uses official @modelcontextprotocol/sdk 1.32.1, stateless Streamable HTTP, and JSON responses. Its tested protocol revision is 2025-11-25. Sources: [official transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [server SDK](https://ts.sdk.modelcontextprotocol.io/server), and [client SDK](https://ts.sdk.modelcontextprotocol.io/client).

Every request needs a bearer header. Two credentials are accepted:

| Credential | Header | Scope |
| --- | --- | --- |
| Owner admin secret | `Authorization: Bearer <SHARED_TRIP_ADMIN_TOKEN>` | All tools. Still supported for compatibility; it is also the master credential for everything else, so prefer a content-manager token for day-to-day AI editing. |
| Content-manager access token | `Authorization: Bearer <owner-issued token>` | All tools, acting as that approved content manager on every trip. Valid **only** at `/mcp`, for a fixed 90 days, until revoked, or until the account is revoked or changes role. |

Browser session cookies are refused at /mcp with 401, including owner, content-manager and viewer sessions. Viewer accounts never get MCP access; do not give a viewer the admin secret or a token to work around this. No tool manages accounts, invitations, roles, tokens, backups, or the server, and none permanently purges a trip. Origin headers, when present, must match the configured origin. GET/DELETE return 405; each message uses POST, and notifications receive 202. A reverse proxy must forward the Authorization header and pass POST/202 responses unbuffered. Legacy SSE, stdio-only transport, OAuth discovery, draft revisions, and external AI client compatibility are not claimed.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| list_trips | none | Summaries |
| get_trip | tripId | Trip and current version |
| create_trip | requestId, trip | Draft with stable ID |
| apply_trip_changes | tripId, requestId, expectedVersion, changes | Stored trip, new version, generated IDs |
| import_trip | requestId, data | New trip and mapping warnings (same as `POST /api/import`) |
| export_trip | tripId | Recoverable versioned JSON (same as `GET /api/trips/<id>/export`) |

import_trip and export_trip expose the existing HTTP import and export through MCP; both share the HTTP validators and storage. Their annotations are published by tool discovery.

Discovery publishes schemas, descriptions, and tool annotations, following the MCP 2025-11-25 [ToolAnnotations schema](https://modelcontextprotocol.io/specification/2025-11-25/schema#toolannotations). These are hints; server authorization remains authoritative:

| Tool | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
| --- | --- | --- | --- | --- |
| list_trips, get_trip | true | false (irrelevant when read-only) | true | false |
| create_trip | false | false (additive) | true | false |
| apply_trip_changes | false | true | true | false |

apply_trip_changes is destructive because delete_day, delete_plan, delete_reminder, and replace_content remove existing content. Writes are idempotent only for an identical requestId and payload, which durably replays the original result; a fresh requestId is a new operation. Tools expose domain operations only, with no SQL, file access, shell, outbound fetch, or account management. Travel content is untrusted data and cannot widen authority.

Read before editing. Use the returned version, a fresh requestId, and the operations in the [HTTP interface](self-hosted.md#http-interface) and [input contract](input-schema.md). Invalid batches change nothing. Failures return isError with structured codes such as version_conflict, validation_failed, trip_not_found, target_not_found, trip_archived, or request_id_conflict.

On conflict, read again and reconcile with a new requestId. After an uncertain response, retry the identical payload and requestId or read its outcome; do not infer success.

## Client configuration

For clients supporting Streamable HTTP with custom headers:

~~~json
{
  "mcpServers": {
    "shared-trips": {
      "type": "http",
      "url": "https://trips.example.org/mcp",
      "headers": { "Authorization": "Bearer <secret-from-client-store>" }
    }
  }
}
~~~

Keep the actual secret in private client storage. Configuration field names and environment expansion depend on the client. The supported transport is Streamable HTTP with a custom `Authorization` header, as used by the official SDK client; OAuth is not implemented, and OAuth-only clients need additional work. No named AI client is claimed to be compatible: verify any external client separately.

### Provisioning a content manager's token (owner only)

1. Invite the person and let them choose their password privately; select **Content manager** for the pending account and approve it ([self-hosted.md](self-hosted.md#accounts-and-access)).
2. On the home page, open that account's **Show assistant access**, enter a descriptive label (for example `sample-editor laptop`), and choose **Issue token**. The secret is shown once.
3. Copy it with the explicit **Copy** button (or select it) directly into the AI client's private, owner-controlled credential store, then choose **Done, hide token**. Never paste it into a chat, issue, document, or repository, and never send it to the content manager over an unprotected channel. Setting up the client is the owner's action.
4. If issuance fails, nothing is retried automatically. Check the token list before issuing again, and revoke any unexpected entry.
5. Renew before the 90-day expiry: issue a replacement, update the client's private configuration, confirm it connects, then revoke the old token. Revoke immediately if a token may have leaked.

The person's account identity persists across token renewals; only the token expires. Revoking the account or changing its role invalidates every token issued for it.

## Reproducible protocol checks

For an owner-provisioned content-manager credential, `npm run mcp:check` initializes MCP, verifies the six-tool inventory and calls only `list_trips`. Set `SHARED_TRIP_MCP_URL` to the HTTPS endpoint and `SHARED_TRIP_MCP_TOKEN_FILE` to an existing private credential file outside the checkout. The check refuses owner tokens, redirects and TLS bypasses. It prints only a bounded result and public tool names, with no endpoint, credential or trip payload. This is an official SDK protocol check; verify the actual AI client's connection separately.

Start the service with fictional temporary storage, provide the same private token in another terminal, then run:

~~~bash
node scripts/mcp-smoke.mjs http://127.0.0.1:4173/mcp
~~~

Alternatively set SHARED_TRIP_MCP_URL and run npm run mcp:smoke. This initializes MCP, discovers tools, creates a fictional trip, adds a day/reminder, and reads them back. The test trip remains in that storage; use a disposable instance.

The automated server suite covers editing in both HTTP/MCP directions, authentication, account negative-access checks, isolation, conflicts, atomicity, retries, persistence, and restore. Only the official SDK client over local HTTP has been verified locally; the earlier fictional live HTTPS trial used the owner admin bearer and predates content-manager tokens, import_trip and export_trip. Content-manager tokens over public HTTPS, proxy behavior, and third-party AI clients remain separate checks.
