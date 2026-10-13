# Remote MCP

The authenticated /mcp endpoint uses official @modelcontextprotocol/sdk 1.32.1, stateless Streamable HTTP, and JSON responses. Its tested protocol revision is 2025-11-25. Sources: [official transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [server SDK](https://ts.sdk.modelcontextprotocol.io/server), and [client SDK](https://ts.sdk.modelcontextprotocol.io/client).

Every request needs an administrator bearer header. Origin headers, when present, must match the configured origin. GET/DELETE return 405; each message uses POST, and notifications receive 202. Legacy SSE, stdio-only transport, OAuth discovery, draft revisions, and external AI client compatibility are not claimed.

## Tools

| Tool | Arguments | Result |
| --- | --- | --- |
| list_trips | none | Summaries |
| get_trip | tripId | Trip and current version |
| create_trip | requestId, trip | Draft with stable ID |
| apply_trip_changes | tripId, requestId, expectedVersion, changes | Stored trip, new version, generated IDs |

Discovery publishes schemas/descriptions. Tools expose domain operations only, with no SQL, file access, shell, or outbound fetch. Travel content is untrusted data and cannot widen authority.

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

Keep the actual secret in private client storage. Configuration field names and environment expansion depend on the client. OAuth-only clients need additional work.

## Reproducible protocol checks

Start the service with fictional temporary storage, provide the same private token in another terminal, then run:

~~~bash
node scripts/mcp-smoke.mjs http://127.0.0.1:4173/mcp
~~~

Alternatively set SHARED_TRIP_MCP_URL and run npm run mcp:smoke. This initializes MCP, discovers tools, creates a fictional trip, adds a day/reminder, and reads them back. The test trip remains in that storage; use a disposable instance.

The automated server suite verifies editing in both HTTP/MCP directions, authentication, isolation, conflicts, atomicity, retries, persistence, and restore. Only the official SDK client over local HTTP has been verified. Public HTTPS hosting and third-party AI clients remain separate checks.
