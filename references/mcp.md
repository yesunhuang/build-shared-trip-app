# Remote MCP

The authenticated /mcp endpoint uses official @modelcontextprotocol/sdk 1.32.1, stateless Streamable HTTP, and JSON responses. Its tested protocol revision is 2025-11-25. Sources: [official transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [server SDK](https://ts.sdk.modelcontextprotocol.io/server), and [client SDK](https://ts.sdk.modelcontextprotocol.io/client).

Every request needs a bearer header. Three credentials are accepted:

| Credential | Header | Scope |
| --- | --- | --- |
| Owner admin secret | `Authorization: Bearer <SHARED_TRIP_ADMIN_TOKEN>` | All tools. Still supported for compatibility; it is also the master credential for everything else, so prefer a content-manager credential for day-to-day AI editing. |
| Content-manager access token | `Authorization: Bearer <owner-issued token>` | All tools, acting as that approved content manager on every trip. Valid **only** at `/mcp`, for a fixed 90 days, until revoked, or until the account is revoked or changes role. For clients that accept a custom header. |
| OAuth access token (schema v5 release) | `Authorization: Bearer <token obtained by the client>` | All tools, acting as the single configured content manager. Scope `trips:manage`, bound to the `/mcp` resource. For clients such as ChatGPT that cannot accept a custom API key. See [OAuth](#oauth-for-clients-without-custom-headers). |

Browser session cookies are refused at /mcp with 401, including owner, content-manager and viewer sessions. Viewer accounts never get MCP access; do not give a viewer the admin secret or a token to work around this. No tool manages accounts, invitations, roles, tokens, OAuth grants, credentials, security, backups, databases, or the server, and none permanently deletes a trip, not even with the admin secret. Permanent deletion is owner-only over HTTP (`DELETE /api/trips/<id>`) or through the offline host-operator CLI; see [self-hosted.md § Permanent trip deletion](self-hosted.md#permanent-trip-deletion). After a deletion, `get_trip`, `export_trip`, `apply_trip_changes` and retries of earlier `create_trip`/`import_trip` requests for that trip return the error code `trip_deleted`. Origin headers, when present, must match the configured origin. GET/DELETE return 405; each message uses POST, and notifications receive 202. A reverse proxy must forward the Authorization header and pass POST/202 responses unbuffered. Legacy SSE, stdio-only transport, draft revisions, and named external AI-client compatibility are not claimed.

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

**Places and photos.** `apply_trip_changes` (`upsert_plan`) can save the same selected OpenStreetMap `place` and Wikimedia Commons `photo` objects as the browser editor. The shapes are in [input-schema.md](input-schema.md#selected-openstreetmap-place-self-hosted), and the plan's `lat`/`lng`/`address` must stay consistent with the place. MCP has no search tool. The tool set is still the six tools above, and no MCP call contacts Nominatim or Commons. Do not invent OSM IDs, coordinates or photo licences. Save only values that a user chose in the editor or that you confirmed on the OSM object page or Commons file page. If you do research them, follow the provider policies in [place-and-photo-lookups.md](place-and-photo-lookups.md#provider-evaluation-checked-2026-10-15): no bulk or systematic queries, and no confidential text in queries. Keep a Commons photo labelled as representative unless the user confirms it shows the place.

When switching a selected OSM place to a Google Maps URL, send `place: null` together with the new `googleMapsUrl`. A stored place otherwise remains the location source. Clearing the place can restore a retained Google URL; clear that URL too when removing the location entirely.

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

Keep the actual secret in private client storage. Configuration field names and environment expansion depend on the client. This custom-header path is what the official SDK client uses. Clients that cannot send a custom header use [OAuth](#oauth-for-clients-without-custom-headers) instead. No named AI client is claimed to be compatible: verify any external client separately.

### Provisioning a content manager's token (owner only)

1. Invite the person and let them choose their password privately; select **Content manager** for the pending account and approve it ([self-hosted.md](self-hosted.md#accounts-and-access)).
2. On the home page, open that account's **Show assistant access**, enter a descriptive label (for example `sample-editor laptop`), and choose **Issue token**. The secret is shown once.
3. Copy it with the explicit **Copy** button (or select it) directly into the AI client's private, owner-controlled credential store, then choose **Done, hide token**. Never paste it into a chat, issue, document, or repository, and never send it to the content manager over an unprotected channel. Setting up the client is the owner's action.
4. If issuance fails, nothing is retried automatically. Check the token list before issuing again, and revoke any unexpected entry.
5. Renew before the 90-day expiry: issue a replacement, update the client's private configuration, confirm it connects, then revoke the old token. Revoke immediately if a token may have leaked.

The person's account identity persists across token renewals; only the token expires. Revoking the account or changing its role invalidates every token issued for it.

## OAuth for clients without custom headers

Some clients, including ChatGPT, cannot be given a custom API key. For them the schema v5 release adds an OAuth 2.1 authorization server and protected-resource metadata in the same service, following the [MCP 2025-11-25 authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization). OpenAI's requirements are in [Plugin authentication](https://developers.openai.com/plugins/build/auth) and [Plugin submission](https://developers.openai.com/plugins/deploy/submission). The admin bearer and the 90-day content-manager token above are unchanged.

**Eligibility.** OAuth is off by default. Only the one approved content-manager account named by `SHARED_TRIP_OAUTH_USERNAME` (for example `sample-editor`) can approve a grant. If the variable is unset, every grant is denied. Nobody is enrolled, approved, or promoted automatically; the owner still controls invitations, approval, and the role. The owner's admin secret cannot be used to sign in at `/oauth/authorize`, and the owner is never an OAuth principal.

**Authority.** An OAuth grant has scope `trips:manage`. It gives exactly the content-manager rights over the same six tools and nothing else: no account, invitation, role, token, grant, credential, security, infrastructure, database, admin, or purge operation. Every request re-checks the account's current approval, role, and session epoch, and also checks that the grant is current.

### Endpoints and metadata

All values use the configured `SHARED_TRIP_ORIGIN`; `https://trips.example.org` is fictional.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` | Protected-resource metadata (RFC 9728): `resource` is `https://trips.example.org/mcp`; `authorization_servers` is `["https://trips.example.org"]`. |
| GET | `/.well-known/oauth-authorization-server` | Authorization-server metadata (RFC 8414): `issuer` is exactly the origin, `code_challenge_methods_supported` is only `S256`, and `authorization_response_iss_parameter_supported` is `true`. |
| POST | `/oauth/register` | Dynamic client registration for public clients only (token endpoint authentication `none`), with the authorization-code and refresh-token grant types. The only accepted redirect URI is exactly `https://chatgpt.com/connector_platform_oauth_redirect`. Client ID metadata documents (CIMD) are not supported. |
| GET/POST | `/oauth/authorize` | The eligible account signs in explicitly with its username and password, then explicitly approves or denies. An existing browser session is not consent. |
| POST | `/oauth/token` | Exchanges a code or refresh token. Returns an opaque access token (at most 15 minutes) and a rotating refresh token. |
| POST | `/oauth/revoke` | Token revocation, bound to the client that holds the token. |

Security properties:

- Codes are single-use, expire within 5 minutes, and are bound to the client, redirect URI, resource, and PKCE S256 verifier. Access tokens are bound to the `/mcp` resource and are refused by `/api/*`.
- Each grant has an absolute 90-day lifetime from consent. Refreshing never extends it. After that date, the account holder must give a new explicit consent.
- Refresh tokens rotate on use. Replaying an old refresh token revokes the whole token family and its access tokens.
- The database stores only digests of codes, access tokens, and refresh tokens, never their values.
- Revoking the account, changing its role, or revoking the grant through the owner API ends OAuth access immediately.

Owner-only grant administration (metadata only, never token values):

On the home page, open **Accounts → Show assistant access → Browser connections (OAuth)** to list or revoke that account's connections. This panel is available only to the owner. The same operations have these API routes:

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/users/<id>/oauth-grants` | Grant metadata for that account |
| POST | `/api/users/<id>/oauth-grants/<grantId>/revoke` | Revokes that grant and its tokens |

### Connecting an OAuth client (owner-controlled)

1. Make sure the intended account (for example `sample-editor`) is approved with the **Content manager** role ([self-hosted.md](self-hosted.md#accounts-and-access)).
2. In the private env file, set `SHARED_TRIP_OAUTH_USERNAME=<approved-content-manager-username>` and restart the service. Never put this setting, or any real host name, in the repository.
3. In the client, add the MCP server URL `https://<your-origin>/mcp` and choose OAuth. The client discovers the metadata and registers itself. There is no client secret, and nothing needs to be pasted.
4. In the sign-in window that opens, the account holder enters that account's username and password, checks that the request is for this service, and chooses approve or deny.
5. Confirm that the client lists the six tools and that a read-only `list_trips` works.
6. Never paste access tokens, refresh tokens, authorization codes, passwords, or redirect URLs containing a `code` or `state` value into chats, issues, logs, screenshots, or a plugin package.

**ChatGPT plugin packages.** Update the existing private plugin in place, preserving its identity and audience. In root `mcp.json`, set the server's `extensions.com.openai.auth.type` to `oauth`, `client.mode` to `dcr`, and `baseScopes` to `["trips:manage"]`. Discovery supplies the endpoints; `resource`, if specified, must exactly match the MCP resource. These fields follow OpenAI's [MCP authentication configuration reference](https://developers.openai.com/plugins/build/plugins#oauth-configuration-reference). Do not create a duplicate or publish workspace, app, plugin, or connector identifiers. A package must never contain a token or client secret. Public submission ([submission guide](https://developers.openai.com/plugins/deploy/submission)) remains a separate decision for the owner.

**Ending or renewing.** To stop access, revoke the grant through the owner API, or revoke or change the role of the account. Also unset `SHARED_TRIP_OAUTH_USERNAME` so that no new grant can be approved. When the 90-day grant ends, reconnect from the client and give a new explicit consent.

## Reproducible protocol checks

For an owner-provisioned content-manager credential, `npm run mcp:check` initializes MCP, verifies the six-tool inventory and calls only `list_trips`. Set `SHARED_TRIP_MCP_URL` to the HTTPS endpoint and `SHARED_TRIP_MCP_TOKEN_FILE` to an existing private credential file outside the checkout. The check refuses owner tokens, redirects and TLS bypasses. It prints only a bounded result and public tool names, with no endpoint, credential or trip payload. This is an official SDK protocol check; verify the actual AI client's connection separately.

Start the service with fictional temporary storage, provide the same private token in another terminal, then run:

~~~bash
node scripts/mcp-smoke.mjs http://127.0.0.1:4173/mcp
~~~

Alternatively set SHARED_TRIP_MCP_URL and run npm run mcp:smoke. This initializes MCP, discovers tools, creates a fictional trip, adds a day/reminder, and reads them back. The test trip remains in that storage; use a disposable instance.

The automated server suite covers editing in both HTTP/MCP directions, authentication, account negative-access checks, isolation, conflicts, atomicity, retries, persistence, and restore. Only the official SDK client over local HTTP has been verified locally; the earlier fictional live HTTPS trial used the owner admin bearer and predates content-manager tokens, import_trip and export_trip. Content-manager tokens over public HTTPS, proxy behavior, and third-party AI clients remain separate checks.

OAuth acceptance: the complete local suite, official SDK OAuth provider (including automatic refresh), migration/restore and fictional Chrome checks passed in [checkpoint 008](../doc/Progress/progress_2026_10_15_cpx008_codex_b.md). Production-image Linux tests, migration/preservation and live HTTPS discovery/privacy checks passed in [checkpoint 009](../doc/Progress/progress_2026_10_15_cpx009_codex_b.md). The existing private plugin's OAuth update was verified. The owner must sign in and consent, and the actual client must complete a read-only tool call before its compatibility is claimed.
