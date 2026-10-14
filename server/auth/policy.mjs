// Server-side role policy. The owner (admin bearer token or an owner browser session) may do
// everything; MCP additionally requires the bearer token. Approved viewers get an explicit
// allowlist of read-only routes. Everything not on the allowlist is refused for viewers, so a new
// owner route is never accidentally exposed to them.

export const OWNER = "owner";
export const VIEWER = "viewer";

export function capabilitiesFor(principal) {
  const owner = principal?.role === OWNER;
  return {
    readTrips: Boolean(principal), exportTrips: Boolean(principal),
    editTrips: owner, importTrips: owner, manageAccounts: owner,
    mcp: owner && principal.via === "bearer"
  };
}

const VIEWER_READ_ROUTES = [/^\/api\/session$/, /^\/api\/trips$/, /^\/api\/trips\/[^/]+$/, /^\/api\/trips\/[^/]+\/export$/];

export function viewerMayAccess(method, pathname) {
  if (method === "POST" && pathname === "/api/logout") return true;
  if (isProtectedMediaPath(pathname)) return method === "GET" || method === "HEAD";
  return method === "GET" && VIEWER_READ_ROUTES.some((route) => route.test(pathname));
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
