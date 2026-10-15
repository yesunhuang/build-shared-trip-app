// Server-side role policy. The owner (admin bearer token or an owner browser session) may do
// everything, including permanent trip deletion (DELETE /api/trips/<id>, owner-only and never
// on any allowlist below); MCP additionally requires a bearer credential. Approved viewers get an explicit
// allowlist of read-only routes. Approved content managers get the viewer allowlist plus trip
// creation, import and trip changes (edit, delete content, replace content, archive/unarchive) for
// all current and future trips. Everything not on an allowlist is refused, so a new owner route is
// never accidentally exposed to viewers or content managers.
//
// A content manager's per-account MCP credential (principal.via "mcp-token") and an OAuth access
// token (principal.via "oauth", content-manager permissions only) are accepted only at /mcp;
// app.mjs never builds such a principal for any other route. A browser session (via "cookie")
// never authorizes /mcp.

export const OWNER = "owner";
export const VIEWER = "viewer";
export const CONTENT_MANAGER = "content-manager";

export const canEditContent = (principal) => principal?.role === OWNER || principal?.role === CONTENT_MANAGER;
/**
 * Permanent trip deletion (schema v6) is owner-only: the owner browser session or owner admin bearer
 * over HTTP, or the offline host-operator CLI (server/cli/delete-trip.mjs, channel "operator").
 * Content managers, viewers, MCP credentials, OAuth tokens and every MCP call are refused; there is
 * deliberately no MCP deletion tool or change operation.
 */
export const OPERATOR = "operator";
export function canDeleteTrips(principal, channel) {
  if (principal?.role !== OWNER) return false;
  if (channel === "http") return principal.via === "cookie" || principal.via === "bearer";
  if (channel === OPERATOR) return principal.via === OPERATOR;
  return false;
}
/** Non-owner bearer principals that exist only at /mcp. */
export const isMcpOnlyPrincipal = (principal) => principal?.role === CONTENT_MANAGER && (principal.via === "mcp-token" || principal.via === "oauth");

export function capabilitiesFor(principal) {
  const owner = principal?.role === OWNER;
  const editor = canEditContent(principal);
  return {
    readTrips: Boolean(principal), exportTrips: Boolean(principal),
    editTrips: editor, importTrips: editor, manageAccounts: owner,
    mcp: (owner && principal.via === "bearer") || isMcpOnlyPrincipal(principal)
  };
}

const VIEWER_READ_ROUTES = [/^\/api\/session$/, /^\/api\/trips$/, /^\/api\/trips\/[^/]+$/, /^\/api\/trips\/[^/]+\/export$/];
const MANAGER_WRITE_ROUTES = [/^\/api\/trips$/, /^\/api\/import$/, /^\/api\/trips\/[^/]+\/changes$/];

export function viewerMayAccess(method, pathname) {
  if (method === "POST" && pathname === "/api/logout") return true;
  if (isProtectedMediaPath(pathname)) return method === "GET" || method === "HEAD";
  return method === "GET" && VIEWER_READ_ROUTES.some((route) => route.test(pathname));
}

/** Non-owner route allowlist. The owner is never checked here. */
export function mayAccess(principal, method, pathname) {
  if (pathname === "/mcp") return isMcpOnlyPrincipal(principal);
  if (principal?.via === "mcp-token" || principal?.via === "oauth") return false;
  if (principal?.role === VIEWER) return viewerMayAccess(method, pathname);
  if (principal?.role === CONTENT_MANAGER) return viewerMayAccess(method, pathname) || (method === "POST" && MANAGER_WRITE_ROUTES.some((route) => route.test(pathname)));
  return false;
}

// /photos/* (other than the generic, empty-by-default manifest module) and /attachments/* are
// treated as protected trip media. Matching is case-insensitive and also applied to the decoded
// path, so filesystem case folding or percent-encoding cannot reach the files without a session.
export function isProtectedMediaPath(pathname) {
  if (pathname === "/photos/manifest.js") return false;
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep the raw path */ }
  return [pathname, decoded].some((value) => /^\/+(?:photos|attachments)/i.test(value));
}
