// OAuth capabilities are an additional ceiling over the current website role and trip ACLs.
export const OAUTH_SCOPE = "trips:manage"; // legacy edit grants retain their exact scope
export const OAUTH_READ_SCOPE = "trips:read";
export const OAUTH_SCOPES = Object.freeze([OAUTH_READ_SCOPE, OAUTH_SCOPE]);
export function requestedScopes(value) {
  if (typeof value !== "string" || value.length > 128 || !/^[a-z:]+(?: +[a-z:]+)*$/.test(value)) return null;
  const scopes = [...new Set(value.split(/ +/))];
  return scopes.every(scope => OAUTH_SCOPES.includes(scope)) ? OAUTH_SCOPES.filter(scope => scopes.includes(scope)).join(" ") : null;
}
export const validGrantScope = scope => OAUTH_SCOPES.includes(scope);
export const scopeAllowedForRole = (role, scope) => validGrantScope(scope) && (role === "content-manager" || (role === "viewer" && scope === OAUTH_READ_SCOPE));
// RFC 6749 3.3 permits policy-limited scope selection. Consent and token responses disclose the
// actual grant. A legacy manage request from a Member is capped to read, never a role promotion.
export function consentScope(role, requested) {
  const scopes = requestedScopes(requested);
  if (!scopes || !["viewer", "content-manager"].includes(role)) return null;
  return role === "content-manager" && scopes.split(" ").includes(OAUTH_SCOPE) ? OAUTH_SCOPE : OAUTH_READ_SCOPE;
}
