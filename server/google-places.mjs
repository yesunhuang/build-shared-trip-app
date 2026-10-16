// Optional Google Places UI Kit configuration (self-hosted, off by default).
//
// The server never contacts Google. When the operator opts in, signed-in browsers may load the
// official standard UI Kit components themselves, but only after the server has granted a
// reservation from the monthly allowance (google-allowance.mjs). The owner's browser-restricted Maps
// JavaScript API key is delivered only inside such a granted, no-store reservation response
// (POST /api/trips/<id>/google-places/reservations), never by itself. Nothing here is written to
// static assets, trip JSON, exports, backups, audit records or logs.
//
//   SHARED_TRIP_GOOGLE_PLACES_UI_KIT=1           opt in (unset, empty or 0 = off)
//   SHARED_TRIP_GOOGLE_MAPS_BROWSER_KEY=<key>    owner-created browser key restricted to this site's
//                                                origin and to the APIs required by Places UI Kit
//
// Both are needed, and they are still not enough: the explicit monthly allowance and headroom must
// also be configured and the allowance ledger initialized by an operator (see google-allowance.mjs),
// and each trip must opt in. Off, or on without a key: { enabled: false }. The session response then
// carries no feature flag and the trip page never reserves, loads Google code, or builds any Google
// component. GET /api/google-places/config is available only to signed-in browser sessions and to
// the owner bearer and carries no key. MCP access tokens and OAuth tokens never reach either route
// because app.mjs accepts them only at /mcp.

export const GOOGLE_PLACES_FLAG_ENV = "SHARED_TRIP_GOOGLE_PLACES_UI_KIT";
export const GOOGLE_MAPS_BROWSER_KEY_ENV = "SHARED_TRIP_GOOGLE_MAPS_BROWSER_KEY";
export const GOOGLE_PLACES_CONFIG_ROUTE = "/api/google-places/config";
// Browser API keys are URL-safe tokens. The pattern only checks the shape; it never proves that
// the owner restricted the key, which remains an owner action in the provider console.
const BROWSER_KEY_SHAPE = /^[A-Za-z0-9_-]{30,100}$/;

/** Reads the opt-in settings. Throws only for malformed values; never logs the key. */
export function readGooglePlacesConfig(env = process.env, { adminToken = "" } = {}) {
  const flag = env[GOOGLE_PLACES_FLAG_ENV];
  if (flag !== undefined && flag !== "" && flag !== "0" && flag !== "1") {
    throw new Error(`${GOOGLE_PLACES_FLAG_ENV} must be 1 to opt in, or 0 / unset.`);
  }
  const key = env[GOOGLE_MAPS_BROWSER_KEY_ENV] ?? "";
  if (key !== "" && (typeof key !== "string" || !BROWSER_KEY_SHAPE.test(key))) {
    throw new Error(`${GOOGLE_MAPS_BROWSER_KEY_ENV} must be a browser API key of 30-100 letters, digits, '-' or '_'.`);
  }
  if (key !== "" && adminToken && key === adminToken) {
    throw new Error(`${GOOGLE_MAPS_BROWSER_KEY_ENV} must not reuse the admin token.`);
  }
  if (flag !== "1" || key === "") return { enabled: false };
  return { enabled: true, browserKey: key };
}

/** The non-secret flag added to /api/session only when the feature is on. */
export function sessionFeatures(config) {
  return config?.enabled === true ? { features: { googlePlacesUiKit: true } } : {};
}

/**
 * Body of GET /api/google-places/config. It never carries the key: browsers receive the key only
 * with a granted allowance reservation, so no Google script can be bootstrapped without one.
 */
export function configResponse(config) {
  if (config?.enabled !== true) return { enabled: false };
  return { enabled: true, libraries: ["places"], keyDelivery: "reservation" };
}
