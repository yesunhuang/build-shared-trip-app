// Revocable anonymous read-only itinerary links (schema v9, table trip_shares).
//
// Lifecycle
// - One link per trip. Link shape: /s/<tripId>#<token>; the token is 32 random bytes encoded as
//   43 base64url characters (256 bits). Only its SHA-256 digest is stored. The raw token is
//   returned exactly once, in the response to an explicit create/rotate request. It is never
//   written to request_log, audit_log, browser storage or any log, and cannot be listed again:
//   a manager who lost it rotates the link.
// - Every write (create/rotate, revoke, trigger-driven invalidation) increments share version
//   atomically. The first version is 0 (no row). Ordinary trip content edits never touch it.
// - Management is HTTP only: the owner administrator (cookie or owner bearer) or the trip's current
//   approved creator who is a member, through a browser session. Content-manager role, membership,
//   MCP credentials and OAuth grants alone never qualify. There are no MCP sharing tools.
//
// Fail-closed issuer authority
// - A link stores its issuer ("owner" or an account ID) and that account's session_epoch. Every
//   guest request re-checks: digest match, not revoked, not expired, trip present and not
//   archived, and for account issuers: approved, same session_epoch, still the trip's creator and
//   still a member.
// - SQLite triggers (below) additionally make lost authority permanent: an account revocation or
//   epoch bump (role change), creator reassignment away from the issuer, or removal of the issuer's
//   membership erase the digest. Re-approval or reassignment can therefore never revive a link. The
//   triggers run for every code path, including the offline membership CLI.
// - Archive suspends guest reads without changing the link; unarchive resumes them if the issuer is
//   still authorized. Permanent deletion removes the row (FK cascade). Restoring an older database
//   snapshot restores the share rows it contained, like other credentials.
//
// Guest boundary
// - Guests use only GET/HEAD /guest/trips/<id> and /guest/trips/<id>/media/<key>, with the token in
//   the X-Trip-Share request header. No cookie or session is derived from it, and app.mjs never
//   reads this header for /api, /mcp or /photos.
// - The response is an explicit allowlisted projection (buildGuestProjection), never a spread of the
//   stored record. Embedded image bytes never appear in it; they are served by the media route
//   with the same per-request checks. Local files are served only when currently referenced by an
//   allowed projection field AND bound to this trip in trip_media.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DomainError, conflict, validationError } from "./domain/errors.mjs";
import { LOCALES, PERIODS, PLAN_TYPES, isValidId } from "./domain/validate.mjs";
import { OWNER } from "./auth/policy.mjs";
import { ACCOUNT_ID_PATTERN } from "./auth/accounts.mjs";
import { AttemptLimiter } from "./auth/sessions.mjs";
import { PRIVATE_PHOTO } from "./domain/media.mjs";
import { CARD_CATEGORIES, coverProblems } from "../assets/app-template/public/trip-presentation.js";
import { BRANDING_PRESETS, brandingProblems } from "../assets/app-template/public/trip-branding.js";
import { uploadedPhotoProblems } from "../assets/app-template/public/plan-photo.js";

export const SHARE_HEADER = "x-trip-share";
export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ID = "[A-Za-z0-9][A-Za-z0-9._-]{0,99}";
export const GUEST_TRIP_ROUTE = new RegExp("^/guest/trips/(" + ID + ")$");
export const GUEST_MEDIA_ROUTE = new RegExp("^/guest/trips/(" + ID + ")/media/(cover|logo|plan-" + ID + ")$");
export const SHARE_PAGE_ROUTE = new RegExp("^/s/" + ID + "/?$");
export const SHARE_REVOKE_REASONS = Object.freeze(["revoked", "issuer_displaced", "issuer_inactive"]);
export const SHARE_TRIGGERS = Object.freeze(["trip_shares_creator_changed", "trip_shares_member_removed", "trip_shares_account_changed"]);
const MAX_EXPIRY_MS = 2 * 366 * 86_400_000;
const MIN_EXPIRY_MS = 60_000;
const LOCAL_MEDIA_BYTES_MAX = 10 * 1024 * 1024;
const MEDIA_TYPES = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const erase = (reason) => `token_hash=NULL,issuer=NULL,issuer_epoch=NULL,created_at=NULL,expires_at=NULL,revoked_at=${NOW_SQL},revoked_reason='${reason}',version=version+1,updated_at=${NOW_SQL}`;
// Additive schema v9. CREATE ... IF NOT EXISTS throughout, so re-running is a no-op and a
// dropped trigger (for example in a tampered copy) is recreated on the next open.
export const SHARE_TABLES = `CREATE TABLE IF NOT EXISTS trip_shares (trip_id TEXT PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK(version>0), token_hash TEXT UNIQUE CHECK(token_hash IS NULL OR length(token_hash)=64), issuer TEXT, issuer_epoch INTEGER, created_at TEXT, expires_at INTEGER, revoked_at TEXT, revoked_reason TEXT CHECK(revoked_reason IS NULL OR revoked_reason IN ('revoked','issuer_displaced','issuer_inactive')), updated_at TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS trip_shares_creator_changed AFTER UPDATE OF creator ON trip_access WHEN NEW.creator IS NOT OLD.creator BEGIN UPDATE trip_shares SET ${erase("issuer_displaced")} WHERE trip_id=NEW.trip_id AND token_hash IS NOT NULL AND issuer<>'owner' AND issuer IS NOT NEW.creator; END;
CREATE TRIGGER IF NOT EXISTS trip_shares_member_removed AFTER DELETE ON trip_members BEGIN UPDATE trip_shares SET ${erase("issuer_displaced")} WHERE trip_id=OLD.trip_id AND issuer=OLD.user_id AND token_hash IS NOT NULL; END;
CREATE TRIGGER IF NOT EXISTS trip_shares_account_changed AFTER UPDATE OF status,session_epoch ON users WHEN NEW.status<>'approved' OR NEW.session_epoch IS NOT OLD.session_epoch BEGIN UPDATE trip_shares SET ${erase("issuer_inactive")} WHERE issuer=NEW.id AND token_hash IS NOT NULL; END;`;

const digest = (value) => crypto.createHash("sha256").update(value).digest();
const isPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const notFound = () => new DomainError("trip_not_found", 404, "Trip not found.");
const forbidden = () => new DomainError("forbidden", 403, "This action is not available for this account.");
const unauthorized = () => new DomainError("unauthorized", 401, "Authentication required.");

/** Canonical 32-byte base64url token, or false. Never echoes the value anywhere. */
export function canonicalShareToken(value) {
  if (typeof value !== "string" || !SHARE_TOKEN_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

// ---------------------------------------------------------------------------------------------
// Projection (pure). Every field is copied from an explicit allowlist with a type/bound check.

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HEX6 = /^#[0-9a-f]{6}$/i;
const SECRET_QUERY = /key|token|sig|auth|session|secret|credential|password|code/i;
const str = (value, max = 4000) => typeof value === "string" && value.trim() && value.length <= max && !CONTROL.test(value) ? value : undefined;
const num = (value, min, max) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
const put = (target, key, value) => { if (value !== undefined) target[key] = value; };
const shortHash = (value) => crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);

export const DAY_I18N_FIELDS = Object.freeze(["label", "area", "summary", "notes"]);
export const SLOT_I18N_FIELDS = Object.freeze(["name", "time", "address", "description", "notes"]);
export const REMINDER_I18N_FIELDS = Object.freeze(["item", "notes"]);
export const TRIP_I18N_FIELDS = Object.freeze(["title"]);
const LIMIT = { title: 200, label: 200, area: 200, name: 200, time: 80, address: 500, item: 300, summary: 4000, notes: 4000, description: 4000 };

/** i18n allowlist: only supported locales, only the listed fields whose source field is shared. */
function i18n(source, fields, base) {
  if (!isPlain(source)) return undefined;
  const out = {};
  for (const locale of LOCALES) {
    if (!Object.hasOwn(source, locale) || !isPlain(source[locale])) continue;
    const patch = source[locale], copy = {};
    for (const field of fields) {
      if (base[field] === undefined || !Object.hasOwn(patch, field)) continue;
      put(copy, field, str(patch[field], LIMIT[field] ?? 4000));
    }
    if (Object.keys(copy).length) out[locale] = copy;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Absolute HTTP(S) link without credentials, at most 2048 characters. */
function httpUrl(value) {
  const text = str(value, 2048);
  if (!text || /[\s\\]/.test(text)) return undefined;
  let parsed;
  try { parsed = new URL(text); } catch { return undefined; }
  if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return undefined;
  return parsed.href;
}

/** Same-origin flat private photo path ("/photos/<file>"), or undefined. */
function localPhotoPath(value, origin) {
  const text = str(value, 4096);
  if (!text) return undefined;
  if (PRIVATE_PHOTO.test(text)) return text;
  if (!origin) return undefined;
  try {
    const parsed = new URL(text, origin);
    if (parsed.origin === origin && !parsed.search && !parsed.hash && PRIVATE_PHOTO.test(parsed.pathname)) return parsed.pathname;
  } catch { /* not a URL */ }
  return undefined;
}

/**
 * A remote photo the visitor's browser may load directly: HTTP(S) only, not this origin (the guest
 * never gets ambient access to same-origin paths), no Google API host (no automatic paid request)
 * and no credential-looking query parameter.
 */
function remotePhotoUrl(value, origin) {
  const href = httpUrl(value);
  if (!href) return undefined;
  const parsed = new URL(href);
  if (origin && parsed.origin === origin) return undefined;
  if (/(^|\.)googleapis\.com$/i.test(parsed.hostname) || /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(parsed.hostname)) return undefined;
  for (const key of parsed.searchParams.keys()) if (SECRET_QUERY.test(key)) return undefined;
  return href;
}

/**
 * buildGuestProjection(trip, { origin, isBound(pathname) }) ->
 *   { trip, media: Map<key,{kind:"embedded",data,mimeType}|{kind:"local",pathname}>, descriptors }
 * trip is the stored trip record; isBound must report the current trip_media binding for THIS trip.
 */
export function buildGuestProjection(trip, { origin = "", isBound = () => false } = {}) {
  const id = trip.id;
  const media = new Map(); const descriptors = [];
  const mediaUrl = (key, fingerprint) => "/guest/trips/" + id + "/media/" + key + "?h=" + shortHash(fingerprint);
  const embed = (key, kind, data, extra) => {
    media.set(key, { kind: "embedded", mimeType: "image/png", data });
    const url = mediaUrl(key, data);
    descriptors.push({ key, kind, source: "embedded", url, ...extra });
    return url;
  };
  const allSlots = new Map();
  for (const day of Array.isArray(trip.days) ? trip.days : []) for (const slot of Array.isArray(day?.slots) ? day.slots : []) if (isPlain(slot) && isValidId(slot.id)) allSlots.set(slot.id, slot);

  function photoFor(slot, dayId) {
    const where = { dayId, slotId: slot.id };
    const key = "plan-" + slot.id;
    // Uploaded override first.
    if (isPlain(slot.uploadedPhoto) && !uploadedPhotoProblems(slot.uploadedPhoto).length) {
      const out = {}; out.url = embed(key, "plan-photo", slot.uploadedPhoto.data, { ...where, alt: slot.uploadedPhoto.alt.trim() });
      put(out, "alt", str(slot.uploadedPhoto.alt, 160)); return out;
    }
    // Else the saved photo; photoSourceId refers to another plan's saved photo in this same trip.
    let saved = slot.photo;
    if ((saved === undefined || saved === null || saved === "") && isValidId(slot.photoSourceId) && slot.photoSourceId !== slot.id) saved = allSlots.get(slot.photoSourceId)?.photo;
    const record = typeof saved === "string" ? { url: saved } : isPlain(saved) ? saved : null;
    if (!record) return undefined;
    const out = {};
    const local = localPhotoPath(record.url, origin);
    if (local) {
      if (!isBound(local)) return undefined;
      media.set(key, { kind: "local", pathname: local });
      out.url = mediaUrl(key, local);
      descriptors.push({ key, kind: "plan-photo", source: "local", url: out.url, previewPath: local, ...where });
    } else {
      const remote = remotePhotoUrl(record.url, origin);
      if (!remote) return undefined;
      out.url = remote;
      descriptors.push({ key, kind: "plan-photo", source: "remote", url: remote, ...where });
    }
    put(out, "alt", str(record.alt, 300));
    put(out, "credit", str(record.credit, 500));
    put(out, "sourceUrl", httpUrl(record.sourceUrl));
    put(out, "license", str(record.license, 100));
    put(out, "licenseUrl", httpUrl(record.licenseUrl));
    return out;
  }

  function projectSlot(raw, dayId) {
    if (!isPlain(raw)) return undefined;
    const out = {};
    put(out, "id", isValidId(raw.id) ? raw.id : undefined);
    put(out, "name", str(raw.name, LIMIT.name));
    put(out, "period", PERIODS.includes(raw.period) ? raw.period : undefined);
    put(out, "time", str(raw.time, LIMIT.time));
    put(out, "sortTime", typeof raw.sortTime === "string" && HHMM.test(raw.sortTime) ? raw.sortTime : undefined);
    put(out, "sortOrder", num(raw.sortOrder, -1e6, 1e6));
    put(out, "planType", PLAN_TYPES.includes(raw.planType) ? raw.planType : undefined);
    put(out, "cardCategory", CARD_CATEGORIES.includes(raw.cardCategory) ? raw.cardCategory : undefined);
    put(out, "address", str(raw.address, LIMIT.address));
    const lat = num(raw.lat, -90, 90), lng = num(raw.lng, -180, 180);
    if (lat !== undefined && lng !== undefined) { out.lat = lat; out.lng = lng; }
    put(out, "description", str(raw.description, LIMIT.description));
    put(out, "notes", str(raw.notes, LIMIT.notes));
    put(out, "googleMapsUrl", httpUrl(raw.googleMapsUrl));
    put(out, "mapsUrl", httpUrl(raw.mapsUrl));
    if (out.id) put(out, "photo", photoFor(raw, dayId));
    put(out, "i18n", i18n(raw.i18n, SLOT_I18N_FIELDS, out));
    return out;
  }

  function projectDay(raw) {
    if (!isPlain(raw)) return undefined;
    const out = {};
    put(out, "id", isValidId(raw.id) ? raw.id : undefined);
    put(out, "date", typeof raw.date === "string" && DATE.test(raw.date) ? raw.date : undefined);
    put(out, "label", str(raw.label, LIMIT.label));
    put(out, "area", str(raw.area, LIMIT.area));
    put(out, "summary", str(raw.summary, LIMIT.summary));
    put(out, "notes", str(raw.notes, LIMIT.notes));
    out.slots = (Array.isArray(raw.slots) ? raw.slots.slice(0, 80) : []).map((slot) => projectSlot(slot, out.id)).filter(Boolean);
    put(out, "i18n", i18n(raw.i18n, DAY_I18N_FIELDS, out));
    return out;
  }

  function projectReminder(raw) {
    if (!isPlain(raw)) return undefined;
    const out = {};
    put(out, "id", isValidId(raw.id) ? raw.id : undefined);
    put(out, "item", str(raw.item, LIMIT.item));
    if (!out.item) return undefined;
    put(out, "dueDate", typeof raw.dueDate === "string" && DATE.test(raw.dueDate) ? raw.dueDate : undefined);
    put(out, "notes", str(raw.notes, LIMIT.notes));
    put(out, "i18n", i18n(raw.i18n, REMINDER_I18N_FIELDS, out));
    return out;
  }

  const out = { id, version: trip.version };
  put(out, "title", str(trip.title, LIMIT.title));
  put(out, "timezone", str(trip.timezone, 64) ?? "UTC");
  put(out, "updatedAt", str(trip.updatedAt, 40));
  out.days = (Array.isArray(trip.days) ? trip.days.slice(0, 31) : []).map(projectDay).filter(Boolean);
  out.reminders = (Array.isArray(trip.reminders) ? trip.reminders.slice(0, 80) : []).map(projectReminder).filter(Boolean);
  if (isPlain(trip.cover) && !coverProblems(trip.cover).length) {
    const cover = { url: embed("cover", "cover", trip.cover.data, { alt: trip.cover.alt.trim() }) };
    put(cover, "alt", str(trip.cover.alt, 160));
    cover.focusX = num(trip.cover.focusX, 0, 100) ?? 50; cover.focusY = num(trip.cover.focusY, 0, 100) ?? 50;
    out.cover = cover;
  }
  if (isPlain(trip.branding)) {
    const branding = {};
    const theme = trip.branding.theme;
    if (isPlain(theme) && !brandingProblems({ theme }).length) {
      if (theme.preset === "custom" && ["ink", "accent", "background"].every((k) => HEX6.test(theme[k]))) branding.theme = { preset: "custom", ink: theme.ink, accent: theme.accent, background: theme.background };
      else if (theme.preset !== "custom" && Object.hasOwn(BRANDING_PRESETS, theme.preset)) branding.theme = { preset: theme.preset };
    }
    const logo = trip.branding.logo;
    if (isPlain(logo) && !brandingProblems({ logo }).length) {
      branding.logo = { url: embed("logo", "logo", logo.data, { alt: logo.alt.trim() }) };
      put(branding.logo, "alt", str(logo.alt, 160));
    }
    if (Object.keys(branding).length) out.branding = branding;
  }
  put(out, "i18n", i18n(trip.i18n, TRIP_I18N_FIELDS, out));
  return { trip: out, media, descriptors };
}

// Codes for the manager's inclusion explanation (the UI localizes them).
export const SHARE_INCLUDED = Object.freeze(["trip_title", "time_zone", "cover", "logo_and_theme", "day_dates_labels_areas", "day_summaries_and_notes",
  "plan_names_times_and_order", "plan_addresses_and_coordinates", "plan_descriptions_and_notes", "map_links", "plan_photos", "reminders", "translations_of_included_text"]);
export const SHARE_EXCLUDED = Object.freeze(["booking_details", "booked_status", "reviews", "related_links", "participant_groups", "members_and_accounts",
  "access_and_invitations", "audit_and_security", "google_place_associations", "trip_settings", "resources_and_content_pages", "tips_and_disclaimer",
  "weather_locations", "recommendations", "compatibility_data", "unbound_or_booking_only_media"]);

// ---------------------------------------------------------------------------------------------

/** Bounded fixed-window counters keyed by client address (memory capped by maxKeys). */
class WindowCounter {
  constructor({ limit, windowMs, maxKeys = 10_000 }) { this.limit = limit; this.windowMs = windowMs; this.maxKeys = maxKeys; this.entries = new Map(); }
  hit(key, now) {
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now || entry.until - now > this.windowMs) entry = { count: 0, until: now + this.windowMs };
    entry.count++;
    this.entries.delete(key); this.entries.set(key, entry);
    while (this.entries.size > this.maxKeys) this.entries.delete(this.entries.keys().next().value);
    return entry.count;
  }
  over(key, now) { const entry = this.entries.get(key); return Boolean(entry && entry.until > now && entry.count >= this.limit); }
}

export class TripSharing {
  /**
   * limits (code-only test hook, never from the environment): { requestsPerMinute, invalidPerWindow,
   * invalidWindowMs, writesPerWindow }. Defaults are generous so that a group opening one link from
   * behind the same proxy is not slowed down, while guessing and flooding stay bounded.
   */
  constructor({ service, membership, audit, clock = Date.now, photoDir, limits = {} }) {
    this.service = service; this.db = service.db; this.membership = membership; this.audit = audit; this.clock = clock; this.photoDir = photoDir;
    this.requests = new WindowCounter({ limit: limits.requestsPerMinute ?? 3000, windowMs: 60_000 });
    this.invalid = new WindowCounter({ limit: limits.invalidPerWindow ?? 120, windowMs: limits.invalidWindowMs ?? 10 * 60_000 });
    this.writes = new AttemptLimiter({ limit: limits.writesPerWindow ?? 60, windowMs: 10 * 60_000, message: "Try changing the share link again later." });
  }

  row(tripId) { return this.db.prepare("SELECT * FROM trip_shares WHERE trip_id=?").get(tripId); }

  /** Current issuer authority for an active row (per request; never cached). */
  issuerValid(row) {
    if (!row?.token_hash) return false;
    if (row.issuer === "owner") return row.issuer_epoch === null;
    if (typeof row.issuer !== "string" || !ACCOUNT_ID_PATTERN.test(row.issuer)) return false;
    const user = this.db.prepare("SELECT status,session_epoch FROM users WHERE id=?").get(row.issuer);
    if (!user || user.status !== "approved" || user.session_epoch !== row.issuer_epoch) return false;
    if (this.db.prepare("SELECT creator FROM trip_access WHERE trip_id=?").get(row.trip_id)?.creator !== row.issuer) return false;
    return Boolean(this.db.prepare("SELECT 1 FROM trip_members WHERE trip_id=? AND user_id=?").get(row.trip_id, row.issuer));
  }

  publicState(tripId, now = this.clock()) {
    const row = this.row(tripId);
    if (!row) return { enabled: false, version: 0, expiresAt: null, createdAt: null };
    const live = Boolean(row.token_hash);
    return {
      enabled: live && (row.expires_at === null || now < row.expires_at) && this.issuerValid(row),
      version: row.version,
      expiresAt: live && row.expires_at !== null ? new Date(row.expires_at).toISOString() : null,
      createdAt: live ? row.created_at : null
    };
  }

  /** Owner administrator, or the current approved creator (member) in a browser session. */
  authorize(principal, tripId) {
    if (!principal) throw unauthorized();
    if (principal.via === "mcp-token" || principal.via === "oauth") throw forbidden();
    this.membership.authenticated(principal);
    if (!isValidId(tripId)) throw notFound();
    const trip = this.membership.require(principal, tripId);
    if (principal.role === OWNER) return trip;
    if (principal.via !== "cookie" || !principal.userId) throw forbidden();
    if (this.membership.state(tripId)?.creator !== principal.userId) throw forbidden();
    return trip;
  }

  get(principal, tripId) { this.authorize(principal, tripId); return { sharing: this.publicState(tripId) }; }

  preview(principal, tripId, origin) {
    const trip = this.authorize(principal, tripId);
    const { trip: projection, descriptors } = this.project(trip, origin);
    return { trip: projection, media: descriptors, sharing: this.publicState(tripId), archived: Boolean(trip.archived),
      inclusion: { included: SHARE_INCLUDED, excluded: SHARE_EXCLUDED, freeTextAndPhotosAreNotSanitized: true, anyoneWithLinkCanView: true } };
  }

  body(input, keys) {
    if (!isPlain(input) || Object.keys(input).some((key) => !keys.includes(key))) throw validationError("Send only " + keys.join(" and ") + ".");
    if (!Number.isSafeInteger(input.expectedShareVersion) || input.expectedShareVersion < 0) throw validationError("expectedShareVersion must be a non-negative integer.");
    return input;
  }

  expiry(value, now) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw validationError("expiresAt must be null or an ISO-8601 date and time.");
    const at = Date.parse(value);
    if (!Number.isFinite(at) || at < now + MIN_EXPIRY_MS || at > now + MAX_EXPIRY_MS) throw validationError("expiresAt must be in the future and within two years.");
    return at;
  }

  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = work(); this.db.exec("COMMIT"); return value; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  expected(tripId, input) {
    const current = this.row(tripId)?.version ?? 0;
    if (current !== input.expectedShareVersion) throw conflict("share_conflict", "Sharing changed. Refresh before retrying.", { currentVersion: current });
  }

  record(principal, action, tripId, version, outcome = "accepted") {
    this.audit.record({ actor: principal.role === OWNER ? "owner" : principal.userId, channel: "http", action, outcome, tripId, version });
  }

  /** Create or explicitly rotate. The raw token appears only in this return value. */
  create(principal, tripId, input) {
    this.authorize(principal, tripId);
    const body = this.body(input, ["expectedShareVersion", "expiresAt"]);
    const now = this.clock();
    const expiresAt = this.expiry(body.expiresAt, now);
    const actorKey = principal.role === OWNER ? "owner" : principal.userId;
    this.writes.check(actorKey, now); this.writes.fail(actorKey, now);
    return this.transaction(() => {
      const trip = this.authorize(principal, tripId);
      if (trip.archived) throw conflict("trip_archived", "The trip is archived. Restore it before sharing a link.");
      this.expected(tripId, body);
      const issuer = principal.role === OWNER ? "owner" : principal.userId;
      const epoch = issuer === "owner" ? null : this.db.prepare("SELECT session_epoch FROM users WHERE id=? AND status='approved'").get(issuer)?.session_epoch;
      if (issuer !== "owner" && !Number.isSafeInteger(epoch)) throw forbidden();
      const token = crypto.randomBytes(32).toString("base64url");
      const hash = digest(token).toString("hex");
      const at = new Date(now).toISOString();
      if (this.row(tripId)) this.db.prepare("UPDATE trip_shares SET version=version+1,token_hash=?,issuer=?,issuer_epoch=?,created_at=?,expires_at=?,revoked_at=NULL,revoked_reason=NULL,updated_at=? WHERE trip_id=?").run(hash, issuer, epoch, at, expiresAt, at, tripId);
      else this.db.prepare("INSERT INTO trip_shares (trip_id,version,token_hash,issuer,issuer_epoch,created_at,expires_at,revoked_at,revoked_reason,updated_at) VALUES (?,1,?,?,?,?,?,NULL,NULL,?)").run(tripId, hash, issuer, epoch, at, expiresAt, at);
      const sharing = this.publicState(tripId, now);
      this.record(principal, "trip.share.create", tripId, sharing.version);
      return { sharing, token };
    });
  }

  revoke(principal, tripId, input) {
    this.authorize(principal, tripId);
    const body = this.body(input, ["expectedShareVersion"]);
    const now = this.clock();
    return this.transaction(() => {
      this.authorize(principal, tripId);
      this.expected(tripId, body);
      const row = this.row(tripId);
      if (row?.token_hash) {
        const at = new Date(now).toISOString();
        this.db.prepare("UPDATE trip_shares SET token_hash=NULL,issuer=NULL,issuer_epoch=NULL,created_at=NULL,expires_at=NULL,revoked_at=?,revoked_reason='revoked',version=version+1,updated_at=? WHERE trip_id=?").run(at, at, tripId);
        this.record(principal, "trip.share.revoke", tripId, row.version + 1);
      } else if (row) this.record(principal, "trip.share.revoke", tripId, row.version, "unchanged");
      return { sharing: this.publicState(tripId, now) };
    });
  }

  /** Guest capability check. Returns the stored trip or null; never throws for bad input. */
  resolve(tripId, token, now = this.clock()) {
    if (!isValidId(tripId) || !canonicalShareToken(token)) return null;
    const row = this.row(tripId);
    const presented = digest(token);
    const stored = row?.token_hash ? Buffer.from(row.token_hash, "hex") : crypto.randomBytes(32);
    const match = stored.length === 32 && crypto.timingSafeEqual(stored, presented) && Boolean(row?.token_hash);
    if (!match || row.revoked_at !== null) return null;
    if (row.expires_at !== null && !(now < row.expires_at)) return null;
    if (!this.issuerValid(row)) return null;
    const record = this.db.prepare("SELECT archived,data FROM trips WHERE id=?").get(tripId);
    if (!record || record.archived) return null;
    try { return JSON.parse(record.data); } catch { return null; }
  }

  project(trip, origin) {
    const bound = this.db.prepare("SELECT 1 FROM trip_media WHERE trip_id=? AND pathname=?");
    return buildGuestProjection(trip, { origin, isBound: (pathname) => Boolean(bound.get(trip.id, pathname)) });
  }

  /** Reads a bound flat local image (no subdirectories, no symlink escape, bounded size). */
  readLocal(pathname) {
    const match = /^\/photos\/([A-Za-z0-9][A-Za-z0-9_-]{0,127}(\.webp|\.png|\.jpe?g))$/.exec(pathname);
    if (!match || !this.photoDir) return null;
    try {
      const root = fs.realpathSync(this.photoDir);
      const file = fs.realpathSync(path.join(root, match[1]));
      const stat = fs.statSync(file);
      if (path.dirname(file) !== root || !stat.isFile() || stat.size > LOCAL_MEDIA_BYTES_MAX) return null;
      return { data: fs.readFileSync(file), type: MEDIA_TYPES[match[2]] };
    } catch { return null; }
  }

  /** Full guest request handling. Always generic: 404 for anything invalid. */
  handle(req, res, pathname, { origin, client }) {
    for (const [name, value] of Object.entries(GUEST_HEADERS)) res.setHeader(name, value);
    const reply = (status, payload, extra = {}) => {
      const body = Buffer.from(JSON.stringify(payload));
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
    };
    const generic = () => reply(404, { error: { code: "not_found", message: "Not found." } });
    const tripRoute = GUEST_TRIP_ROUTE.exec(pathname), mediaRoute = GUEST_MEDIA_ROUTE.exec(pathname);
    if (!tripRoute && !mediaRoute) return generic();
    if (!["GET", "HEAD"].includes(req.method)) return reply(405, { error: { code: "method_not_allowed", message: "Read only." } }, { Allow: "GET, HEAD" });
    const now = this.clock();
    if (this.requests.hit(client, now) > this.requests.limit) return reply(429, { error: { code: "rate_limited", message: "Try again shortly." } }, { "Retry-After": "60" });
    const tripId = (tripRoute || mediaRoute)[1];
    const trip = this.resolve(tripId, req.headers[SHARE_HEADER], now);
    if (!trip) {
      if (this.invalid.over(client, now)) return reply(429, { error: { code: "rate_limited", message: "Try again later." } }, { "Retry-After": "600" });
      this.invalid.hit(client, now);
      return generic();
    }
    const projection = this.project(trip, origin);
    if (tripRoute) return reply(200, { trip: projection.trip });
    const entry = projection.media.get(mediaRoute[2]);
    let data, type;
    if (entry?.kind === "embedded") { data = Buffer.from(entry.data, "base64"); type = entry.mimeType; }
    else if (entry?.kind === "local") { const file = this.readLocal(entry.pathname); if (file) { data = file.data; type = file.type; } }
    if (!data) return generic();
    res.writeHead(200, { "Content-Type": type, "Content-Length": data.length, "Content-Disposition": "inline" });
    res.end(req.method === "HEAD" ? undefined : data);
  }
}

// Guest API responses: never cached (browser, proxy or CDN), never indexed, never referred.
export const GUEST_HEADERS = Object.freeze({
  "Cache-Control": "no-store, private, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet, noimageindex",
  "Vary": "X-Trip-Share",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Cross-Origin-Resource-Policy": "same-origin"
});
// The /s/<tripId> shell headers and CSP are defined in static.mjs (GUEST_PAGE_CSP).
