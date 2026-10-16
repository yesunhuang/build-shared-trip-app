import { getGooglePlaceLinks } from "./google-place-links.js?v=v-875f6f65f5c8";
import {
  GOOGLE_PLACE_PHOTOS_FIELD,
  buildGooglePlacePhotosField,
  createTripPoller,
  downloadJSON,
  expectTrip,
  exportFilename,
  getBootSession,
  getBootTrip,
  hostedApi,
  isISODate,
  isValidTimeZone,
  logoutAndLeave,
  newRequestId,
  redirectToLogin,
  resourcesPath,
  sessionCanEdit,
  sessionHasGooglePlaces,
  signoutPending,
  toRenderTrip,
  tripHasGooglePlacePhotos,
  tripIdFromPath
} from "./hosted-client.js?v=v-875f6f65f5c8";
import {
  GOOGLE_PLACE_ASSOCIATION_FIELD,
  associationForPlan,
  associationMatchesPlan,
  locationBindingForPlan,
  normalizeGooglePlaceAssociation,
  placeIdFromUserInput
} from "./google-place-association.js?v=v-875f6f65f5c8";
import {
  VENUE_QUERY_MAX,
  checkVenueQuery,
  createGoogleAllowanceGate,
  createGooglePlaceHost,
  createGooglePlacesLoader,
  createPlaceDetailsManager,
  createPlacePreviewSession,
  createPlaceSearchSession,
  googleText
} from "./google-places-ui-kit.js?v=v-875f6f65f5c8";
import { buildGoogleMapsUrl, normalizeGoogleMapsUrl } from "./map-links.js?v=v-875f6f65f5c8";
import { createLinkActivationGuard, isPlainPrimaryActivation, safeLinkUrl, startsOnInteractive } from "./link-activation.js?v=v-875f6f65f5c8";
import { linkedTextElement, locationTextNode } from "./text-links.js?v=v-875f6f65f5c8";
import { projectCardLinks, renderCardLinkGroup, cardLinkIcon } from "./card-link-presentation.js?v=v-875f6f65f5c8";
import { createRelatedLinksEditor, relatedLinksProblems, RELATED_LINK_WORDS } from "./related-links.js?v=v-875f6f65f5c8";
import { optimizedPhotoUrl } from "./photo-assets.js?v=v-875f6f65f5c8";
import { parseFullGoogleMapsPlaceUrl } from "./google-maps-place-url.js?v=v-875f6f65f5c8";
import { computeReminders, remindersDueOnDate } from "./reminder-dates.js?v=v-875f6f65f5c8";
import {
  getInitialLanguage,
  languageStorageKey,
  languageMeta,
  localizeTrip,
  saveLanguage,
  ui
} from "./i18n.js?v=v-875f6f65f5c8";
import {
  createWeatherForecastController,
  localizeForecastLocation,
  weatherCodeIcon,
  weatherCodeKey
} from "./weather-forecast.js?v=v-875f6f65f5c8";
import {
  applyDayWeatherChangesLocally,
  buildDayWeatherChanges,
  isValidCoordinate as isValidWeatherCoordinate,
  pointKey as weatherPointKey,
  resolveDayWeather
} from "./weather-association.js?v=v-875f6f65f5c8";
import { createDayWeatherEditor, weatherEditorText } from "./weather-editor.js?v=v-875f6f65f5c8";
import { getFlightBookings } from "./flight-bookings.js?v=v-875f6f65f5c8";
import { getDayArea, getDayGuide, getPlacePhoto, setGuideTrip } from "./daily-guide.js?v=v-875f6f65f5c8";
import {
  OSM_COPYRIGHT_URL,
  coordinateGoogleMapsUrl,
  createLookupController,
  formatCoordinate,
  normalizePhotoCandidate,
  normalizePlaceCandidate,
  normalizeQuery,
  photoForSaving,
  pickerText,
  placeForSaving,
  readSavedPhoto,
  readSavedPlace
} from "./place-picker.js?v=v-875f6f65f5c8";

const FIREBASE_SDK_VERSION = "12.15.0";
// Self-hosted mode is decided before any Firebase code path. It never loads the
// Firebase SDK or its configuration and keeps protected trip data in memory only.
const HOSTED = window.SHARED_TRIP_HOSTED === true;
const HOSTED_TRIP_ID = HOSTED ? tripIdFromPath(window.location.pathname) : "";
const HOSTED_POLL_INTERVAL_MS = 20000;
let firebaseConfig = {};
let tripDocumentPath = "";
const firebaseConfigPromise = HOSTED
  ? Promise.resolve()
  : import("./firebase-config.js?v=v-875f6f65f5c8")
    .then((module) => {
      firebaseConfig = module.firebaseConfig || {};
      tripDocumentPath = module.tripDocumentPath || "";
    })
    .catch((error) => {
      console.warn("Firebase configuration unavailable", error);
    });
let hostedServerTrip = HOSTED ? getBootTrip() : null;
if (HOSTED && (!hostedServerTrip || hostedServerTrip.id !== HOSTED_TRIP_ID)) {
  // Never render a demo seed or a different trip in self-hosted mode.
  hostedServerTrip = null;
  redirectToLogin();
  throw new Error("Self-hosted trip data is unavailable");
}
// Approved viewers (and any session without an explicit edit capability) get an
// honest read-only page: no create/edit/delete/toggle controls are rendered.
// The server independently rejects viewer writes.
const HOSTED_READ_ONLY = HOSTED && !sessionCanEdit(getBootSession());
const READ_ONLY_LABELS = Object.freeze({ en: "Read-only", "zh-Hans": "只读", "zh-Hant": "唯讀", ja: "閲覧のみ" });
if (HOSTED_READ_ONLY) document.documentElement.classList.add("hosted-read-only");
const seedTrip = JSON.parse(document.getElementById("trip-data").textContent);
const APP_NAME = seedTrip.title || "Shared trip";
const APP_NAMESPACE = seedTrip.slug || "shared-trip";
const APP_BUILD_ID = seedTrip.buildId || "preview";
const APP_STORAGE_KEY = `${APP_NAMESPACE}-${APP_BUILD_ID}`;
const APP_CHANNEL_NAME = `${APP_NAMESPACE}-${APP_BUILD_ID}`;
const TRIP_TIMEZONE = seedTrip.timezone || "UTC";
const itineraryViewMedia = window.matchMedia("(max-width: 679px), (max-height: 500px) and (pointer: coarse)");
const mobileFooterMedia = window.matchMedia("(max-width: 679px), (max-height: 500px) and (pointer: coarse)");
const els = {
  title: document.getElementById("trip-title"),
  dateRange: document.getElementById("trip-date-range"),
  status: document.getElementById("sync-status"),
  statusText: document.getElementById("sync-status-text"),
  updated: document.getElementById("last-updated"),
  headerActions: document.querySelector(".header-actions"),
  headerActionsHome: document.querySelector(".header-bar"),
  pageShell: document.querySelector(".page-shell"),
  tipsSection: document.querySelector(".tips-section"),
  mobileFooterTools: document.getElementById("mobile-footer-tools"),
  mobileFooterUpdated: document.getElementById("mobile-footer-updated"),
  install: document.getElementById("install-app"),
  installDialog: document.getElementById("install-dialog"),
  reminders: document.getElementById("reminder-list"),
  reminderCount: document.getElementById("reminder-count"),
  addReminder: document.getElementById("add-reminder"),
  mapOffline: document.getElementById("map-offline"),
  itinerary: document.querySelector(".itinerary"),
  planWorkspace: document.querySelector(".plan-workspace"),
  itinerarySheet: document.querySelector(".itinerary-sheet"),
  itinerarySheetHandle: document.getElementById("itinerary-sheet-handle"),
  daysNav: document.getElementById("days-nav"),
  days: document.getElementById("itinerary-days"),
  itineraryPanel: document.getElementById("itinerary-days"),
  openPlanView: document.getElementById("open-plan-view"),
  closePlanView: document.getElementById("close-plan-view"),
  planLanguage: document.getElementById("plan-language-select"),
  activeWeather: document.getElementById("active-weather"),
  weatherDialog: document.getElementById("weather-dialog"),
  weatherDialogTitle: document.getElementById("weather-dialog-title"),
  weatherDialogArea: document.getElementById("weather-dialog-area"),
  weatherDialogContent: document.getElementById("weather-dialog-content"),
  flights: document.getElementById("flight-list"),
  hotels: document.getElementById("hotel-list"),
  tips: document.getElementById("tips-list"),
  disclaimer: document.getElementById("trip-disclaimer"),
  credits: document.getElementById("credits-list"),
  dialog: document.getElementById("item-dialog"),
  dialogTitle: document.getElementById("dialog-title"),
  form: document.getElementById("item-form"),
  deleteItem: document.getElementById("delete-item"),
  googleMapsLinkError: document.getElementById("google-maps-link-error"),
  googleMapsLinkPreview: document.getElementById("google-maps-link-preview"),
  googleMapsPlaceLabel: document.getElementById("google-maps-place-label"),
  googleMapsPlaceCoordinates: document.getElementById("google-maps-place-coordinates"),
  todoDialog: document.getElementById("todo-dialog"),
  todoDialogTitle: document.getElementById("todo-dialog-title"),
  todoForm: document.getElementById("todo-form"),
  deleteReminder: document.getElementById("delete-reminder"),
  toast: document.getElementById("toast"),
  language: document.getElementById("language-select"),
  metaDescription: document.getElementById("meta-description"),
  mapTitle: document.getElementById("map-title"),
  mapDayLabel: document.getElementById("map-day-label"),
  routeDecoration: document.getElementById("trip-route-decoration")
};

let currentTrip = HOSTED ? toRenderTrip(hostedServerTrip) : (loadLocalTrip() || seedTrip);
let displayTrip = currentTrip;
let hostedPoller = null;
let hostedReady = HOSTED;
let hostedWriteInFlight = false;
let hostedConflictTimer = null;
let hostedReloadPending = false;
let currentLanguage = getInitialLanguage();
let mapInstance = null;
let deferredInstallPrompt = null;
let syncRuntime = null;
let syncReady = false;
let currentSourceIsCache = false;
let toastTimer = null;
let toastKey = null;
let toastVariables = {};
let localChannel = null;
let currentStatusKey = "connecting";
let currentStatusVariables = {};
let lastUpdatedDate = null;
let activeDayId = initialDayId(currentTrip.days);
// Trip-scoped, in-memory forecast state; recomputed from the current trip on every render (see
// weather-forecast.js). Never persisted in any mode.
// Weather work stops for good once the hosted session is being left: sign-out initiation (before
// the logout response arrives, while bootTrip still exists), a pending sign-out from another tab,
// or a redirect to sign-in. Late forecast replies, new batches and editor saves are then ignored.
let weatherSessionEnded = false;
function weatherSessionActive() {
  if (!HOSTED) return true;
  return !weatherSessionEnded && !signoutPending() && Boolean(getBootTrip());
}
const weatherForecast = createWeatherForecastController({
  isActive: weatherSessionActive,
  onChange: () => renderWeatherAfterForecast()
});
function endWeatherSession() {
  weatherSessionEnded = true;
  const session = weatherEditorSession;
  weatherEditorSession = null;
  session?.editor.dispose();
  weatherForecast.dispose();
}
// Sign-out button: stop weather first, then the existing hosted sign-out helper (unchanged).
function signOutAndLeave() {
  endWeatherSession();
  return logoutAndLeave();
}
// One per-day weather editor at a time (owner/content managers only), kept across dialog re-renders.
const WEATHER_EDITOR_ENABLED = !HOSTED_READ_ONLY;
let weatherEditorSession = null;
let weatherEditorNotice = "";
let weatherDialogDayId = "";
let weatherDialogLocationId = "";
let weatherDialogReturnDayId = "";
let currentMapPoints = [];
let mapContentKey = "";
let mapGeometryKey = "";
let lastRemoteTripJSON = "";
let mapResizeTimer = null;
const ITINERARY_SHEET_MODES = Object.freeze(["itinerary", "balanced", "map"]);
const ITINERARY_SHEET_DRAG_THRESHOLD_PX = 8;
let itinerarySheetMode = "itinerary";
let itinerarySheetDrag = null;
let itinerarySheetFrameTimer = null;
let itinerarySheetPositionFrame = null;
let pendingItinerarySheetTop = null;
// The plan highlighted on both the map and the itinerary (marker click or opened card).
let selectedMapSlotId = "";
// One plan-editor session at a time. Place/photo lookups and choices belong to the
// session that started them; closing or reopening the editor discards them.
let editorSession = null;
// Explicit place/photo lookup is a hosted editor feature only. The static
// generator and approved viewers never render lookup controls.
const LOOKUP_ENABLED = HOSTED && !HOSTED_READ_ONLY;
// Optional Google Places UI Kit: hosted pages only, and only when BOTH the signed-in session
// advertises it (the operator enabled it site-wide with a browser key) AND this trip's editors opted
// in (trip.googlePlacePhotosEnabled === true; absent or false means off, the default). Otherwise no
// reservation, Google script, library import, component or query happens for this trip, no Google
// controls are shown, and OpenStreetMap/Commons content works unchanged. Even then, each Google
// action first needs a reservation from the server's monthly allowance (google-places-ui-kit.js);
// a denial shows a translated status and starts no Google work, and the plan's own photo and
// details stay exactly as they are. The loader and gate are created on first need (the first
// expanded plan with a saved association, or an explicit Google action in the plan editor) and
// reused for the rest of the page session. If a poll turns the trip off, pending reservations and
// unused permits are voided and late results are ignored; code the browser already loaded earlier
// in this page is not (and cannot be) unloaded.
const GOOGLE_PLACES_SITE_ENABLED = HOSTED && sessionHasGooglePlaces(getBootSession());
let googlePlacesLoader = null;
let googleAllowanceGate = null;
let googlePlaceDetails = null;
// Background refreshes wait while a press on a link is in progress (see link-activation.js), so
// re-rendering never detaches the anchor a person is activating.
const linkGuard = createLinkActivationGuard({ root: document });
// A 401 is never deferred: redirectToLogin() clears the visible page at once, and any refresh
// deferred during a held link press is dropped so it can never render or reload afterwards. No
// Google reservation or permit can start anything after this.
function leaveForSignIn() { endWeatherSession(); googleAllowanceGate?.dispose(); googlePlaceDetails?.dispose(); linkGuard.dispose(); redirectToLogin(); }
const WEATHER_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const FLIGHT_BOOKING_REFS = Object.freeze({});
const HOTEL_BOOKING_REFS = Object.freeze({});

const PLAN_TYPES = Object.freeze(["flight", "stay", "restaurant", "transport", "car", "sight", "activity", "event", "shopping", "other"]);
const PLAN_TYPE_SET = new Set(PLAN_TYPES);
const SLOT_PLAN_TYPES = Object.freeze({});
const SLOT_PARTICIPANT_GROUPS = Object.freeze({});
const DINING_PLAN_REFS = Object.freeze({});
const DAY_SLOT_ORDER = Object.freeze({});

populateTimeOptions();
syncItineraryViewClass();
syncMobileFooterPlacement();
applyLanguageToDocument();
renderAll();
setupInteractionHandlers();
registerServiceWorker();
let syncStartupPromise = connectRealtimeSync();
refreshWeatherForecast();

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function uid(prefix = "item") {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isFirebaseConfigured() {
  if (HOSTED) return false;
  return Boolean(firebaseConfig?.projectId)
    && !Object.values(firebaseConfig).some((value) => String(value).startsWith("REPLACE_"));
}

function loadLocalTrip() {
  if (HOSTED) return null;
  try {
    const raw = localStorage.getItem(APP_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistLocalTrip() {
  if (HOSTED) return;
  try {
    localStorage.setItem(APP_STORAGE_KEY, JSON.stringify(currentTrip));
  } catch {
    // Storage can be unavailable in private browsing. The in-memory copy still works.
  }
}

function renderAll() {
  normalizeTrip(currentTrip);
  setGuideTrip(currentTrip);
  // Components, failure/denial marks and pending reservations of associations that are no longer
  // current are dropped (components are never carried into rebuilt cards; see renderItinerary).
  googlePlaceDetails?.retain(currentGooglePlaceKeys());
  if (!currentTrip.days.some((day) => day.id === activeDayId)) activeDayId = initialDayId(currentTrip.days);
  displayTrip = localizeTrip(currentTrip, currentLanguage);
  applyStaticTranslations();
  renderHostedControls();
  renderHeader();
  renderReminders();
  renderEssentials();
  renderTravelLogistics();
  renderDayNavigation();
  renderItinerary();
  renderCredits();
  renderTips();
  renderMap();
}

function normalizeTrip(trip) {
  if (!HOSTED) trip.title = APP_NAME;
  trip.days = Array.isArray(trip.days)
    ? trip.days.filter((day) => day && typeof day === "object" && !Array.isArray(day)).slice(0, 31)
    : [];
  trip.reminders = Array.isArray(trip.reminders)
    ? trip.reminders.filter((reminder) => reminder && typeof reminder === "object" && !Array.isArray(reminder)).slice(0, 80)
    : [];
  trip.days.forEach((day, dayIndex) => {
    day.id ||= `day-${day.date || dayIndex}`;
    if (HOSTED && !day.theme && typeof day.label === "string" && day.label.trim()) day.theme = day.label;
    day.slots = Array.isArray(day.slots)
      ? day.slots.filter((slot) => slot && typeof slot === "object" && !Array.isArray(slot)).slice(0, 80)
      : [];
    day.slots.forEach((slot, slotIndex) => {
      slot.id ||= `slot-${dayIndex}-${slotIndex}`;
      slot.booked = slot.booked === true || slot.booked === "true";
      slot.planType = normalizePlanType(slot.planType, slot);
      slot.time = canonicalTimelineTime(slot.time, slot.id);
    });
  });
  trip.reminders.forEach((reminder, index) => {
    reminder.id ||= `reminder-${index}`;
    reminder.item = String(reminder.item || "Reminder").slice(0, 200);
    const leadDays = Number(reminder.leadDays);
    reminder.leadDays = Number.isFinite(leadDays) ? Math.min(365, Math.max(0, Math.round(leadDays))) : 0;
    reminder.done = Boolean(reminder.done);
    reminder.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(reminder.dueDate || ""))
      ? reminder.dueDate
      : "";
  });
}

function renderHeader() {
  els.title.textContent = HOSTED ? currentTrip.title : APP_NAME;
  if (els.routeDecoration) {
    els.routeDecoration.textContent = displayTrip.routeDecoration || displayTrip.country || "";
  }
  applyTripTheme(currentTrip.theme);
  const first = displayTrip.days[0]?.date || displayTrip.startDate;
  const last = displayTrip.days.at(-1)?.date || displayTrip.startDate;
  els.dateRange.textContent = ui(currentLanguage, "tripDateLine", {
    dateRange: formatCompactDateRange(first, last)
  });
  const activeDay = displayTrip.days.find((day) => day.id === activeDayId);
  const planUrl = new URL(window.location.href);
  planUrl.searchParams.set("view", "plan");
  if (activeDay?.date) planUrl.searchParams.set("day", activeDay.date);
  els.openPlanView.href = `${planUrl.pathname}${planUrl.search}${planUrl.hash}`;
  if (HOSTED) {
    const resourceLink = document.querySelector(".header-resource-link");
    if (resourceLink) {
      resourceLink.href = resourcesPath(HOSTED_TRIP_ID);
      resourceLink.hidden = !hasTripResources(currentTrip);
    }
  }
}

function hasTripResources(trip) {
  const resources = trip?.resources;
  if (!resources || typeof resources !== "object") return false;
  return Object.values(resources).some((entry) => entry && typeof entry === "object" && (
    (Array.isArray(entry.payment?.facilities) && entry.payment.facilities.length)
    || (Array.isArray(entry.apps?.items) && entry.apps.items.length)
    || entry.payment?.summary
  ));
}

function applyTripTheme(theme = {}) {
  const allowed = new Set([
    "ink", "ink-2", "paper", "paper-2", "card", "text", "muted", "line",
    "accent", "accent-text", "accent-soft", "moss", "moss-soft", "gold", "danger"
  ]);
  Object.entries(theme || {}).forEach(([name, value]) => {
    if (!allowed.has(name) || !/^#[0-9a-f]{3,8}$/i.test(String(value))) return;
    document.documentElement.style.setProperty(`--${name}`, String(value));
  });
}

function renderReminders() {
  const computed = computeReminders(displayTrip.startDate, displayTrip.reminders);
  els.reminders.innerHTML = renderChecklistHTML(computed, {
    formatDue: (date) => ui(currentLanguage, "dueOnDate", {
      date: formatDate(date, { year: "numeric", month: "long", day: "numeric" })
    })
  });

  bindReminderItems(els.reminders, computed, { editable: true });

  const openCount = currentTrip.reminders.filter((item) => !item.done).length;
  els.reminderCount.textContent = ui(currentLanguage, "openCount", { count: openCount });
}

function bindReminderItems(container, computed, { editable = false } = {}) {
  const ordered = computed.map((item) => displayTrip.reminders.find((reminder) => reminder.id === item.id));
  container.querySelectorAll("li").forEach((item, index) => {
    const displayReminder = ordered[index];
    const reminder = currentTrip.reminders.find((candidate) => candidate.id === displayReminder?.id);
    if (!reminder || !displayReminder) return;
    item.dataset.reminderId = displayReminder.id;
    const input = item.querySelector("input");
    input.checked = reminder.done;
    input.setAttribute("aria-label", ui(currentLanguage, "markComplete", { item: displayReminder.item }));
    item.classList.toggle("is-complete", reminder.done);
    item.classList.toggle("is-overdue", !reminder.done && computed[index].deadline < todayISO());
    item.dataset.overdueLabel = ` · ${ui(currentLanguage, "due")}`;
    if (HOSTED_READ_ONLY) {
      input.disabled = true;
      return;
    }
    input.addEventListener("change", async () => {
      const desiredState = input.checked;
      const saved = await mutateTrip((trip) => {
        const target = trip.reminders.find((candidate) => candidate.id === reminder.id);
        if (target) target.done = desiredState;
      }, desiredState ? "markedComplete" : "reopenedReminder");
      if (!saved) input.checked = reminder.done;
    });
    if (editable) {
      const edit = textElement("button", "todo-edit", ui(currentLanguage, "edit"));
      edit.type = "button";
      edit.setAttribute("aria-label", `${ui(currentLanguage, "editTodo")}: ${displayReminder.item}`);
      edit.addEventListener("click", (event) => {
        event.stopPropagation();
        openTodoDialog(reminder.id);
      });
      item.append(edit);
    }
    item.addEventListener("click", (event) => {
      // The row toggles its checkbox, but never for a click on a button or a link inside it.
      if (event.target !== input && !event.target.closest("button") && !startsOnInteractive(event, item)) input.click();
    });
  });
}

function renderEssentials() {
  syncWeatherForecast();
  const weatherForecastState = weatherForecast.snapshot();
  const previousScrollLeft = els.activeWeather.querySelector(".weather-date-strip")?.scrollLeft || 0;
  els.activeWeather.replaceChildren();
  if (!displayTrip.days.length) return;

  const heading = element("div", "weather-compact__header");
  const headingCopy = element("div", "weather-compact__heading");
  const headingLabel = textElement("span", "eyebrow", ui(currentLanguage, "weatherForecast"));
  headingLabel.id = "weather-compact-title";
  headingCopy.append(headingLabel);
  const weatherStatus = element("div", "weather-compact__status");
  const statusChip = weatherStatusChip(weatherForecastState);
  if (statusChip) weatherStatus.append(statusChip);
  const fetchedAt = weatherForecastState.fetchedAt;
  const fetchedDate = fetchedAt ? new Date(fetchedAt) : null;
  if (fetchedDate && !Number.isNaN(fetchedDate.getTime())) {
    const freshness = textElement(
      "time",
      "weather-compact__updated",
      ui(currentLanguage, "forecastUpdated", { time: formatTimestamp(fetchedDate) })
    );
    freshness.dateTime = fetchedDate.toISOString();
    weatherStatus.append(freshness);
  }
  heading.append(headingCopy);
  if (weatherStatus.childNodes.length) heading.append(weatherStatus);
  if (weatherForecastState.neededPoints) {
    const retry = element("button", "weather-retry");
    const busy = ["loading", "refreshing"].includes(weatherForecastState.status);
    retry.type = "button";
    retry.disabled = !weatherForecastState.canRetry || busy;
    retry.setAttribute("aria-label", ui(currentLanguage, "retryWeather"));
    retry.setAttribute("aria-busy", String(busy));
    retry.dataset.state = busy ? "loading" : retry.disabled ? "cooldown" : "ready";
    const hint = busy ? ui(currentLanguage, weatherForecastState.hasData ? "refreshingForecast" : "loadingForecastShort")
      : retry.disabled ? ui(currentLanguage, "weatherRetryWait") : "";
    retry.title = [ui(currentLanguage, "retryWeather"), hint].filter(Boolean).join(" — ");
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.4 6.4L3 16M3 21v-5h5");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    icon.append(path);
    retry.append(icon);
    retry.addEventListener("click", () => refreshWeatherForecast({ force: true }));
    heading.append(retry);
  }
  els.activeWeather.append(heading);
  if (weatherForecastState.error || weatherForecastState.retrying) {
    const message = textElement("p", "weather-request-message", weatherForecastState.retrying
      ? ui(currentLanguage, "weatherRetrying") : weatherRequestMessage(weatherForecastState.error));
    message.setAttribute("role", "status");
    message.dataset.weatherError = weatherForecastState.error?.code || "";
    els.activeWeather.append(message);
  }

  // Every date and its manual editor remain reachable during an outage, for every reading role.
  {
    const strip = element("div", "weather-date-strip");
    strip.setAttribute("role", "list");
    strip.setAttribute("aria-label", ui(currentLanguage, "weatherDatesAria"));
    strip.tabIndex = 0;
    displayTrip.days.forEach((day, index) => {
      const card = element("article", "weather-date-card");
      card.setAttribute("role", "listitem");
      const cardHeading = element("header", "weather-date-card__header");
      const cardHeadingCopy = element("div", "weather-date-card__heading-copy");
      const dayLabel = ui(currentLanguage, "dayShort", { number: index + 1 });
      cardHeadingCopy.append(
        textElement("span", "weather-date-card__day", day.date === todayInTripISO()
          ? `${dayLabel} · ${ui(currentLanguage, "today")}`
          : dayLabel),
        textElement("strong", "", formatDate(day.date, { weekday: "short", month: "short", day: "numeric" })),
        textElement("span", "weather-date-card__area", getDayArea(day.id, currentLanguage))
      );
      const detailsButton = weatherDetailsButton(day);
      cardHeading.append(cardHeadingCopy, detailsButton);
      card.append(cardHeading);

      const peeks = element("div", "weather-peeks");
      const association = weatherForecast.day(day.id);
      const locations = association.entries.map((entry) => entry.id);
      if (locations.length) peeks.append(renderWeatherPeek(day, locations));
      else if (association.mode === "off") peeks.append(textElement("p", "weather-compact__empty", weatherEditorText(currentLanguage, "offShort")));
      else peeks.append(textElement("p", "weather-compact__empty", weatherDayMessage(day)));
      card.append(peeks);
      strip.append(card);
    });
    els.activeWeather.append(strip);
    if (previousScrollLeft) {
      strip.scrollLeft = previousScrollLeft;
    } else {
      const activeIndex = displayTrip.days.findIndex((day) => day.id === activeDayId);
      const activeCard = activeIndex >= 0 ? strip.children[activeIndex] : null;
      if (activeCard) strip.scrollLeft = Math.max(0, activeCard.offsetLeft - strip.offsetLeft);
    }
  }
  if (els.weatherDialog.open) renderWeatherDialog({ preserveScroll: true });
}

// Recompute the day associations from the current trip. Only a changed set of needed points or a
// changed time zone starts a request; renders, polls, language changes and unrelated edits do not.
function syncWeatherForecast() {
  if (weatherForecast.update(currentTrip)) queueMicrotask(() => refreshWeatherForecast({ force: false }));
}

// The controller reports the start and end of a real request through onChange, which re-renders
// the weather strip; a refresh with nothing due does nothing at all.
function refreshWeatherForecast({ force = true } = {}) {
  return weatherForecast.refresh({ force });
}

// Forecast arrivals re-render only the weather strip and an open weather dialog, never the cards.
function renderWeatherAfterForecast() {
  if (!weatherSessionActive()) return;
  renderEssentials();
}

function weatherStatusChip(weatherForecastState) {
  if (weatherForecastState.status === "live" || weatherForecastState.status === "idle") return null;
  const key = weatherForecastState.status === "live"
    ? "liveForecast"
    : weatherForecastState.status === "saved"
      ? "savedForecast"
      : weatherForecastState.status === "error"
        ? "forecastUnavailableShort"
        : weatherForecastState.hasData
          ? "refreshingForecast"
          : "loadingForecastShort";
  const className = weatherForecastState.status === "live"
    ? "status-chip status-chip--live"
    : weatherForecastState.status === "error"
      ? "status-chip status-chip--warning"
      : "status-chip";
  return textElement("span", className, ui(currentLanguage, key));
}

function weatherRequestMessage(error) {
  const key = { timeout: "weatherTimeout", offline: "weatherOffline", network: "weatherNetwork", rate_limit: "weatherRateLimit", http: "weatherHttpError", invalid_response: "weatherInvalidResponse", empty_response: "weatherEmptyResponse" }[error?.code];
  return ui(currentLanguage, key || "forecastUnavailable");
}

function weatherDayMessage(day) {
  const state = weatherForecast.dayStatus(day.id);
  if (state === "error") return weatherRequestMessage(weatherForecast.dayError(day.id));
  const key = { past: "forecastDatePassed", horizon: "forecastBeyondHorizon", no_location: "weatherNoLocation", loading: "loadingForecast", partial: "weatherPartial" }[state];
  return ui(currentLanguage, key || "weatherMissingMeasurements");
}

// locationIds are the day's association entry IDs (explicit locations or automatic areas).
function renderWeatherPeek(day, locationIds) {
  const available = locationIds
    .map((locationId) => ({ locationId, daily: dailyForecast(day.id, locationId, day.date) }))
    .filter((entry) => entry.daily);
  const representative = available.reduce((wettest, entry) => (
    !wettest || (entry.daily.precipitationProbability ?? -Infinity) > (wettest.daily.precipitationProbability ?? -Infinity)
      ? entry
      : wettest
  ), null);
  const extreme = (field, operation) => { const values = available.map((entry) => entry.daily[field]).filter(Number.isFinite); return values.length ? operation(...values) : null; };
  const daily = representative
    ? {
        weatherCode: representative.daily.weatherCode,
        temperatureMax: extreme("temperatureMax", Math.max),
        temperatureMin: extreme("temperatureMin", Math.min),
        precipitationProbability: extreme("precipitationProbability", Math.max)
      }
    : null;
  const primaryLocationId = available[0]?.locationId || locationIds[0];
  const extraLocationCount = Math.max(0, locationIds.length - 1);
  const primaryLocationLabel = weatherEntryLabel(day.id, primaryLocationId);
  const peek = element("div", "weather-peek");
  const summary = element("div", "weather-peek__summary");
  const identity = element("span", "weather-peek__identity");
  identity.title = locationIds.map((locationId) => weatherEntryLabel(day.id, locationId)).join(" · ");
  identity.append(
    textElement("span", "weather-peek__icon", daily ? weatherCodeIcon(daily.weatherCode) : "☁"),
    textElement("span", "weather-peek__place", extraLocationCount
      ? `${primaryLocationLabel} +${extraLocationCount}`
      : primaryLocationLabel)
  );
  summary.append(identity);

  if (!daily) {
    summary.append(textElement("span", "weather-peek__unavailable", weatherDayMessage(day)));
    peek.append(summary);
    return peek;
  }

  const temperature = element("span", "weather-peek__temperature");
  temperature.append(
    textElement("strong", "", `${formatNumber(daily.temperatureMax, 0)}°`),
    document.createTextNode(` / ${formatNumber(daily.temperatureMin, 0)}°C`)
  );
  const rain = textElement("span", "weather-peek__rain", `💧 ${formatNumber(daily.precipitationProbability, 0)}%`);
  summary.append(temperature, rain);
  peek.append(summary);
  if (weatherForecast.dayStatus(day.id) === "partial") peek.append(textElement("p", "weather-peek__notice", ui(currentLanguage, "weatherPartial")));
  return peek;
}

function weatherDetailsButton(day) {
  const button = element("button", "weather-detail-trigger");
  button.type = "button";
  button.setAttribute("aria-haspopup", "dialog");
  button.dataset.weatherDayId = day.id;
  button.setAttribute("aria-label", ui(currentLanguage, "openWeatherDetails", {
    date: formatDate(day.date, { weekday: "long", month: "long", day: "numeric" })
  }));
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M9 6h10M9 12h10M9 18h10M5 6h.01M5 12h.01M5 18h.01");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  icon.append(path);
  button.append(icon);
  button.addEventListener("click", () => openWeatherDialog(day.id));
  return button;
}

function openWeatherDialog(dayId) {
  weatherDialogDayId = dayId;
  weatherDialogReturnDayId = dayId;
  weatherDialogLocationId = weatherForecast.day(dayId).entries[0]?.id || "";
  weatherEditorNotice = "";
  renderWeatherDialog();
  els.weatherDialogContent.scrollTop = 0;
  if (!els.weatherDialog.open) els.weatherDialog.showModal();
}

function closeWeatherDialog() {
  if (els.weatherDialog.open) els.weatherDialog.close();
}

function renderWeatherDialog({ preserveScroll = false } = {}) {
  const day = displayTrip.days.find((candidate) => candidate.id === weatherDialogDayId);
  if (!day) {
    closeWeatherDialog();
    return;
  }
  const previousScrollTop = preserveScroll ? els.weatherDialogContent.scrollTop : 0;
  els.weatherDialogTitle.textContent = formatDate(day.date, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
  els.weatherDialogArea.textContent = getDayArea(day.id, currentLanguage);
  // An open editor element is detached and re-attached as-is, so typed input survives refreshes.
  const editorElement = weatherEditorSession?.dayId === day.id ? weatherEditorSession.editor.element : null;
  const editorFocusKey = editorElement ? weatherEditorSession.editor.focusedKey() : "";
  els.weatherDialogContent.replaceChildren();
  const association = weatherForecast.day(day.id);
  const locations = association.entries.map((entry) => entry.id);
  renderWeatherEditorControls(day, editorElement);
  if (editorFocusKey) weatherEditorSession.editor.restoreFocus(editorFocusKey);
  if (!locations.length) {
    els.weatherDialogContent.append(textElement("p", "weather-dialog__empty", association.mode === "off"
      ? weatherEditorText(currentLanguage, "offShort")
      : weatherDayMessage(day)));
    if (preserveScroll) els.weatherDialogContent.scrollTop = previousScrollTop;
    return;
  }
  if (!locations.includes(weatherDialogLocationId)) weatherDialogLocationId = locations[0];
  if (locations.length > 1) {
    const locationTabs = element("div", "weather-location-tabs");
    locationTabs.setAttribute("role", "tablist");
    locationTabs.setAttribute("aria-label", ui(currentLanguage, "weatherLocations"));
    locations.forEach((locationId) => {
      const tab = textElement("button", "weather-location-tab", weatherEntryLabel(day.id, locationId));
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(locationId === weatherDialogLocationId));
      tab.dataset.weatherLocationId = locationId;
      tab.addEventListener("click", () => {
        weatherDialogLocationId = locationId;
        renderWeatherDialog();
        requestAnimationFrame(() => {
          [...els.weatherDialogContent.querySelectorAll(".weather-location-tab")]
            .find((candidate) => candidate.dataset.weatherLocationId === locationId)
            ?.focus({ preventScroll: true });
        });
      });
      locationTabs.append(tab);
    });
    els.weatherDialogContent.append(locationTabs);
  }
  els.weatherDialogContent.append(renderWeatherLocationDetails(day, weatherDialogLocationId));
  if (preserveScroll) els.weatherDialogContent.scrollTop = previousScrollTop;
}

function renderWeatherLocationDetails(day, locationId) {
  const section = element("section", "weather-detail-location");
  const daily = dailyForecast(day.id, locationId, day.date);
  const locationHeading = element("div", "weather-detail-location__heading");
  locationHeading.append(
    textElement("span", "weather-detail-location__icon", daily ? weatherCodeIcon(daily.weatherCode) : "☁"),
    textElement("h3", "", weatherEntryLabel(day.id, locationId))
  );
  section.append(locationHeading);

  if (!daily) {
    section.append(textElement("p", "weather-dialog__empty", weatherDayMessage(day)));
  }

  if (daily) {
    const overview = element("div", "weather-detail__overview");
    overview.append(
      textElement("strong", "", ui(currentLanguage, weatherCodeKey(daily.weatherCode))),
      textElement("span", "", `${formatNumber(daily.temperatureMax, 0)}° / ${formatNumber(daily.temperatureMin, 0)}°C`),
      textElement("span", "", `${ui(currentLanguage, "rainChance")} ${formatNumber(daily.precipitationProbability, 0)}% · ${formatNumber(daily.precipitationSum, 1)} mm`),
      textElement("span", "", `${ui(currentLanguage, "uvIndex")} ${formatNumber(daily.uvIndexMax, 1)}`)
    );
    section.append(overview);
  }

  const samples = hourlyForecast(day.id, locationId, day.date).filter((point) => [6, 9, 12, 15, 18, 21].includes(Number(point.time.slice(0, 2))));
  if (samples.length) {
    const table = element("table", "weather-hours");
    const caption = textElement("caption", "sr-only", ui(currentLanguage, "hourlyWeatherFor", {
      location: weatherEntryLabel(day.id, locationId),
      date: formatDate(day.date, { weekday: "long", month: "long", day: "numeric" })
    }));
    const head = element("thead");
    const header = element("tr", "weather-hours__row weather-hours__row--header");
    [ui(currentLanguage, "time"), "°C", ui(currentLanguage, "rainChance"), "UV"].forEach((label) => {
      const cell = textElement("th", "", label);
      cell.scope = "col";
      header.append(cell);
    });
    head.append(header);
    const body = element("tbody");
    samples.forEach((point) => {
      const row = element("tr", "weather-hours__row");
      row.append(
        textElement("td", "", point.time),
        textElement("td", "", `${formatNumber(point.temperature, 0)}°`),
        textElement("td", "", `${formatNumber(point.precipitationProbability, 0)}%`),
        textElement("td", "", formatNumber(point.uvIndex, 1))
      );
      body.append(row);
    });
    table.append(caption, head, body);
    section.append(table);
  }
  if (daily) section.append(textElement("p", "weather-detail__meta", `${ui(currentLanguage, "wind")} ${formatNumber(daily.windSpeedMax, 0)} km/h · ${ui(currentLanguage, "sunriseSunset")} ${formatForecastTime(daily.sunrise)}–${formatForecastTime(daily.sunset)}`));
  return section;
}

function weatherEntry(dayId, entryId) {
  return weatherForecast.day(dayId).entries.find((entry) => entry.id === entryId) || null;
}

function dailyForecast(dayId, entryId, date) {
  const entry = weatherEntry(dayId, entryId);
  return entry ? weatherForecast.daily(entry.key, date) : null;
}

function hourlyForecast(dayId, entryId, date) {
  const entry = weatherEntry(dayId, entryId);
  return entry ? weatherForecast.hourly(entry.key, date) : [];
}

// Explicit locations keep their stored (localized) names. Automatic areas are named after the
// day's own representative plan, as an area, never as a verified city.
function weatherEntryLabel(dayId, entryId) {
  const entry = weatherEntry(dayId, entryId);
  if (!entry) return "";
  if (entry.kind === "location") return localizeForecastLocation(entry.locationId, currentLanguage, weatherForecast.resolved.locations);
  return weatherAreaLabel(dayId, entry);
}

function weatherAreaLabel(dayId, entry) {
  const slot = displayTrip.days.find((day) => day.id === dayId)?.slots?.find((candidate) => candidate.id === entry.representativeSlotId);
  const place = typeof slot?.name === "string" ? slot.name.trim() : "";
  return place
    ? weatherEditorText(currentLanguage, "areaNear", { place })
    : weatherEditorText(currentLanguage, "area", { number: entry.index || 1 });
}

// ---------------------------------------------------------------------------------------------
// Per-day forecast place editor (owner and content managers; never rendered for viewers).

function renderWeatherEditorControls(day, editorElement) {
  if (!WEATHER_EDITOR_ENABLED) return;
  const wrapper = element("div", "weather-editor-panel");
  if (weatherEditorNotice) {
    const notice = textElement("p", "weather-editor__status weather-editor__status--ok", weatherEditorText(currentLanguage, weatherEditorNotice));
    notice.setAttribute("role", "status");
    wrapper.append(notice);
  }
  if (editorElement) {
    weatherEditorSession.editor.setLanguage(currentLanguage);
    if (HOSTED && hostedServerTrip && weatherEditorSession.openedVersion !== hostedServerTrip.version) weatherEditorSession.editor.markStale(true);
    wrapper.append(editorElement);
  } else {
    const toggle = textElement("button", "button button--quiet weather-editor-toggle", weatherEditorText(currentLanguage, "change"));
    toggle.type = "button";
    toggle.dataset.weatherEditorToggle = day.id;
    toggle.disabled = Boolean(HOSTED && hostedServerTrip?.archived);
    toggle.addEventListener("click", () => openWeatherEditor(day.id));
    wrapper.append(toggle);
  }
  els.weatherDialogContent.append(wrapper);
}

// Choosable points: coordinates already saved on this trip's plans (this day first) or stored as
// weather locations. Nothing is looked up.
function weatherEditorData(dayId) {
  const association = weatherForecast.day(dayId);
  const sourceTrip = HOSTED ? hostedServerTrip : currentTrip;
  const localized = displayTrip;
  const points = new Map();
  for (const location of weatherForecast.resolved.locations.values()) {
    const key = weatherPointKey(location.lat, location.lng);
    if (!points.has(key)) points.set(key, { key, lat: location.lat, lng: location.lng, locationId: location.id,
      label: localizeForecastLocation(location.id, currentLanguage, weatherForecast.resolved.locations) });
  }
  const sourceDays = Array.isArray(sourceTrip?.days) ? sourceTrip.days : [];
  const ordered = [...sourceDays.filter((day) => day?.id === dayId), ...sourceDays.filter((day) => day?.id !== dayId)];
  for (const day of ordered) {
    for (const slot of Array.isArray(day?.slots) ? day.slots : []) {
      if (!isValidWeatherCoordinate(slot?.lat, slot?.lng)) continue;
      const key = weatherPointKey(slot.lat, slot.lng);
      if (points.has(key)) continue;
      const shown = localized.days.find((candidate) => candidate.id === day.id)?.slots?.find((candidate) => candidate.id === slot.id);
      const label = String(shown?.name || slot.name || "").trim() || `${slot.lat.toFixed(4)}, ${slot.lng.toFixed(4)}`;
      const i18n = {};
      for (const [locale, patch] of Object.entries(slot.i18n || {})) if (typeof patch?.name === "string" && patch.name.trim()) i18n[locale] = { name: patch.name };
      points.set(key, { key, lat: slot.lat, lng: slot.lng, label, name: String(slot.name || label).trim(), ...(Object.keys(i18n).length ? { i18n } : {}) });
    }
  }
  // Preview automatic mode independently of the stored choice. This pure resolution never
  // changes an off/manual mapping or starts a request while the editor is open.
  const sourceDay = sourceDays.find((day) => day.id === dayId);
  const automatic = resolveDayWeather({}, { ...sourceDay, weatherLocationIds: undefined });
  const autoAreas = automatic.entries.map((entry) => ({
    key: entry.key, label: weatherAreaLabel(dayId, entry), memberCount: entry.memberCount
  }));
  const chosen = association.mode === "manual"
    ? association.entries.map((entry) => ({ key: entry.key, label: weatherEntryLabel(dayId, entry.id), locationId: entry.locationId }))
    : [];
  return { current: { mode: association.mode, entries: association.entries }, autoAreas, savedPoints: [...points.values()], chosen };
}

function openWeatherEditor(dayId) {
  if (!WEATHER_EDITOR_ENABLED || !weatherSessionActive()) return;
  closeWeatherEditor({ restoreFocus: false });
  weatherEditorNotice = "";
  const session = { dayId, openedVersion: HOSTED ? hostedServerTrip.version : 0, attempt: null, editor: null };
  session.editor = createDayWeatherEditor(document, {
    language: currentLanguage,
    ...weatherEditorData(dayId),
    newLocationId: () => uid("weather"),
    onCancel: () => closeWeatherEditor({ restoreFocus: true }),
    onSave: (choice) => saveDayWeatherChoice(session, choice)
  });
  weatherEditorSession = session;
  renderWeatherDialog({ preserveScroll: true });
  session.editor.focus();
}

function closeWeatherEditor({ restoreFocus = false } = {}) {
  const session = weatherEditorSession;
  if (!session) return;
  weatherEditorSession = null;
  session.editor.dispose();
  if (els.weatherDialog.open) {
    renderWeatherDialog({ preserveScroll: true });
    if (restoreFocus) els.weatherDialogContent.querySelector(".weather-editor-toggle")?.focus();
  }
}

// One validated, version-checked write per save: [update_trip weather (only when a new location is
// added), upsert_day weatherLocationIds]. An identical retry after an uncertain failure reuses the
// same requestId; a stale form is refused (and the latest version shown) instead of overwriting.
async function saveDayWeatherChoice(session, choice) {
  if (weatherEditorSession !== session || !weatherSessionActive()) return "error";
  if (!HOSTED) {
    const built = buildDayWeatherChanges(currentTrip, session.dayId, choice);
    if (!built.ok) return built.reason === "limit" ? "limit" : "invalid";
    const saved = await mutateTrip((trip) => applyDayWeatherChangesLocally(trip, session.dayId, built.changes),
      isFirebaseConfigured() ? "synced" : "savedOnDevice");
    if (!saved) return "error";
    finishWeatherEditorSave(session);
    return "saved";
  }
  if (HOSTED_READ_ONLY) return "forbidden";
  if (!hostedServerTrip.days.some((day) => day.id === session.dayId)) return "conflict";
  if (session.openedVersion !== hostedServerTrip.version) {
    resetWeatherEditorToLatest(session);
    return "conflict";
  }
  if (hostedWriteInFlight || !hostedReady || !navigator.onLine) return "offline";
  const built = buildDayWeatherChanges(hostedServerTrip, session.dayId, choice);
  if (!built.ok) return built.reason === "limit" ? "limit" : "invalid";
  const fingerprint = JSON.stringify([session.openedVersion, built.changes]);
  if (session.attempt?.fingerprint !== fingerprint) session.attempt = { fingerprint, requestId: newRequestId("weather") };
  hostedWriteInFlight = true;
  setSyncStatus("saving", "working");
  try {
    const result = await hostedApi.applyChanges(HOSTED_TRIP_ID, session.openedVersion, built.changes, session.attempt.requestId);
    hostedWriteInFlight = false;
    // A reply arriving after sign-out started (or a redirect to sign-in) is never rendered.
    if (!weatherSessionActive()) return "forbidden";
    acceptHostedTrip(expectTrip(result, HOSTED_TRIP_ID));
    setSyncStatus("synced", "synced");
    finishWeatherEditorSave(session);
    return "saved";
  } catch (error) {
    hostedWriteInFlight = false;
    if (!weatherSessionActive()) return "forbidden";
    setSyncStatus("saveFailed", "error");
    if (error.status === 401) { leaveForSignIn(); return "forbidden"; }
    if (error.status === 403) return "forbidden";
    if (error.status === 409) {
      try {
        const latest = await hostedApi.getTrip(HOSTED_TRIP_ID);
        if (weatherSessionActive()) acceptHostedTrip(expectTrip(latest, HOSTED_TRIP_ID));
      } catch { /* the poll catches up */ }
      if (!weatherSessionActive()) return "forbidden";
      if (weatherEditorSession === session) resetWeatherEditorToLatest(session);
      return "conflict";
    }
    if (error.status === 404) return "conflict";
    if (error.status === 422 || error.status === 400) return "invalid";
    // Uncertain outcome: keep the attempt so pressing Save again replays the same requestId.
    return "offline";
  } finally {
    hostedWriteInFlight = false;
  }
}

function resetWeatherEditorToLatest(session) {
  session.openedVersion = hostedServerTrip.version;
  session.attempt = null;
  syncWeatherForecast();
  session.editor.reset(weatherEditorData(session.dayId));
}

function finishWeatherEditorSave(session) {
  if (weatherEditorSession !== session) return;
  weatherEditorSession = null;
  session.editor.dispose();
  weatherEditorNotice = "saved";
  syncWeatherForecast();
  if (els.weatherDialog.open) {
    renderWeatherDialog({ preserveScroll: true });
    els.weatherDialogContent.querySelector(".weather-editor-toggle")?.focus();
  }
}

function renderTravelLogistics() {
  const openBookingKeys = new Set([
    ...els.flights.querySelectorAll(".booking-disclosure[open]"),
    ...els.hotels.querySelectorAll(".booking-disclosure[open]")
  ].map((item) => item.dataset.bookingKey).filter(Boolean));

  els.flights.replaceChildren();
  getFlightBookings(currentLanguage).forEach((bookingTeam) => {
    const teamCard = element("details", "flight-team booking-disclosure");
    teamCard.dataset.bookingKey = `flight:${bookingTeam.travelers}`;
    teamCard.open = openBookingKeys.has(teamCard.dataset.bookingKey);
    const teamHeader = element("summary", "flight-team__header");
    const teamCopy = element("div", "flight-team__copy");
    teamCopy.append(
      textElement("span", "traveler-chip", bookingTeam.travelers),
      textElement("strong", "flight-team__title", bookingTeam.title),
      textElement("span", "booking-route-count", ui(currentLanguage, "segmentCount", { count: bookingTeam.segments.length }))
    );
    const teamStatus = element("span", "booking-summary-status");
    teamStatus.append(
      textElement("span", "status-chip status-chip--booked", ui(currentLanguage, "allBooked")),
      textElement("span", "summary-chevron", "⌄")
    );
    teamHeader.append(teamCopy, teamStatus);
    teamCard.append(teamHeader);

    const segments = element("div", "flight-segments");
    segments.append(textElement("p", "booking-team-note muted", bookingTeam.note));
    bookingTeam.segments.forEach((segment) => {
      const item = element("article", "flight-segment");
      const modeIcon = ({ flight: "✈", bus: "🚌", train: "🚄" })[segment.mode] || "•";
      const route = element("div", "flight-segment__route");
      route.append(
        textElement("span", "flight-segment__icon", modeIcon),
        textElement("h4", "flight-segment__title", segment.route)
      );
      item.append(
        route,
        textElement("p", "flight-segment__service", segment.service),
        textElement("p", "flight-segment__schedule", segment.schedule),
        linkedTextElement(document, "p", "muted", segment.detail)
      );
      if (segment.baggage) {
        const baggage = element("p", "flight-segment__baggage");
        baggage.append(
          textElement("strong", "", `${ui(currentLanguage, "baggage")}: `),
          document.createTextNode(segment.baggage)
        );
        item.append(baggage);
      }
      const links = element("div", "resource-links");
      segment.links.forEach((destination) => links.append(externalAnchor(destination.label, destination.url)));
      item.append(links);
      segments.append(item);
    });
    teamCard.append(segments);
    els.flights.append(teamCard);
  });

  els.hotels.replaceChildren();
  (displayTrip.hotelAreas || []).forEach((area, areaIndex) => {
    const group = element("details", "hotel-group booking-disclosure");
    group.dataset.bookingKey = `hotel:${areaIndex}`;
    group.open = openBookingKeys.has(group.dataset.bookingKey);
    const header = element("summary", "hotel-group__header");
    const headerCopy = element("span", "hotel-group__header-copy");
    headerCopy.append(
      textElement("strong", "hotel-group__title", area.area),
      textElement("span", "muted", area.reason || "")
    );
    header.append(
      headerCopy,
      textElement("span", "summary-chevron", "⌄")
    );
    const hotelCards = element("div", "hotel-group__cards");
    group.append(header, hotelCards);
    (area.options || []).forEach((hotel, hotelIndex) => {
      const canonicalHotel = currentTrip.hotelAreas?.[areaIndex]?.options?.[hotelIndex] || hotel;
      const matchingSlot = findCanonicalLocation(canonicalHotel.name);
      const item = element("article", "compact-card compact-card--hotel");
      item.append(
        textElement("span", "status-chip", translateTier(hotel.tier)),
        textElement("h3", "compact-card__title", hotel.name),
        textElement("p", "compact-card__meta", hotel.priceRange || ""),
        linkedTextElement(document, "p", "muted", hotel.note || "")
      );
      const hotelMapLink = googleMapsAnchor({
        googleMapsKey: `hotel:${canonicalHotel.name}`,
        name: hotel.name,
        lat: matchingSlot?.lat,
        lng: matchingSlot?.lng,
        address: matchingSlot?.address || canonicalHotel.name
      });
      if (hotelMapLink) item.append(hotelMapLink);
      hotelCards.append(item);
    });
    els.hotels.append(group);
  });

  els.disclaimer.textContent = displayTrip.disclaimer;
}

function renderDayNavigation() {
  const today = todayInTripISO();
  els.daysNav.replaceChildren(...displayTrip.days.map((day, index) => {
    const button = element("button", "day-link");
    button.type = "button";
    button.dataset.dayId = day.id;
    button.classList.toggle("is-active", day.id === activeDayId);
    button.classList.toggle("is-today", day.date === today);
    button.setAttribute("aria-pressed", String(day.id === activeDayId));
    button.setAttribute("aria-label", ui(currentLanguage, "chooseDay", {
      number: index + 1,
      date: formatDate(day.date, { dateStyle: "full" }),
      area: getDayArea(day.id, currentLanguage)
    }));
    const compactDate = element("strong", "day-link__date");
    compactDate.append(
      textElement("span", "day-link__weekday", formatDate(day.date, { weekday: "short" })),
      document.createTextNode(" · "),
      textElement("span", "day-link__month-day", formatDate(day.date, { month: "numeric", day: "numeric" }))
    );
    button.append(
      textElement("span", "day-link__number", ui(currentLanguage, "dayShort", { number: index + 1 })),
      compactDate,
      textElement("span", "day-link__area", getDayArea(day.id, currentLanguage))
    );
    if (day.date === today) button.append(textElement("span", "day-link__today", ui(currentLanguage, "today")));
    button.addEventListener("click", () => selectActiveDay(day.id));
    return button;
  }));
  if (HOSTED && !HOSTED_READ_ONLY) {
    const addDate = textElement("button", "day-link day-link--add", ui(currentLanguage, "addDate"));
    addDate.type = "button";
    addDate.addEventListener("click", () => openDayDialog());
    els.daysNav.append(addDate);
  }

  requestAnimationFrame(() => {
    const active = els.daysNav.querySelector(".day-link.is-active");
    if (!active) return;
    const target = active.offsetLeft - (els.daysNav.clientWidth - active.offsetWidth) / 2;
    els.daysNav.scrollTo({ left: Math.max(0, target), behavior: "auto" });
  });
}

function orderedDaySlots(day) {
  if (!day) return [];
  const slots = [...(day.slots || []), ...builtInBookingSlots(day.id)].filter(Boolean);
  const order = DAY_SLOT_ORDER[day.id] || [];
  const orderById = new Map(order.map((id, index) => [id, index]));
  const fixed = slots
    .filter((slot) => orderById.has(slot.id))
    .sort((a, b) => orderById.get(a.id) - orderById.get(b.id));
  const additions = slots
    .filter((slot) => !orderById.has(slot.id))
    .sort(compareSlotSchedule);
  additions.forEach((slot) => {
    const nextSlot = fixed.findIndex((candidate) => compareSlotSchedule(candidate, slot) > 0);
    fixed.splice(nextSlot < 0 ? fixed.length : nextSlot, 0, slot);
  });
  return fixed;
}

function compareSlotSchedule(first, second) {
  const firstOrder = Number(first?.sortOrder);
  const secondOrder = Number(second?.sortOrder);
  if (Number.isFinite(firstOrder) && Number.isFinite(secondOrder) && firstOrder !== secondOrder) {
    return firstOrder - secondOrder;
  }
  const periodRank = (slot) => ({ morning: 0, noon: 1, evening: 2 })[slot?.period] ?? 3;
  const periodDifference = periodRank(first) - periodRank(second);
  if (periodDifference) return periodDifference;
  const firstMinutes = slotStartMinutes(first?.sortTime || first?.time);
  const secondMinutes = slotStartMinutes(second?.sortTime || second?.time);
  if (firstMinutes === secondMinutes) return 0;
  return firstMinutes < secondMinutes ? -1 : 1;
}

function slotStartMinutes(value) {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})/);
  if (!match) return Number.POSITIVE_INFINITY;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? (hours * 60) + minutes : Number.POSITIVE_INFINITY;
}

function builtInBookingSlots() {
  return [];
}

function findDisplaySlot(slotId) {
  for (const day of displayTrip.days || []) {
    const slot = (day.slots || []).find((candidate) => candidate.id === slotId);
    if (slot) return slot;
  }
  return null;
}

function flightBookingForSlot(slot) {
  if (!slot?.booking || normalizePlanType(slot.planType, slot) !== "flight") return null;
  return {
    team: { travelers: slot.participants || slot.travelers || "" },
    segment: {
      route: slot.booking.route || slot.name || "",
      service: slot.booking.service || slot.booking.code || "",
      schedule: slot.booking.schedule || slot.time || "",
      detail: slot.booking.detail || slot.review || "",
      baggage: slot.booking.baggage || "",
      links: Array.isArray(slot.booking.links) ? slot.booking.links : []
    }
  };
}

function hotelBookingForSlot(slot) {
  if (!slot?.booking || normalizePlanType(slot.planType, slot) !== "stay") return null;
  return {
    area: { area: slot.booking.area || slot.address || "" },
    hotel: { name: slot.name || "", note: slot.booking.detail || slot.notes || "" },
    travelers: slot.participants || slot.travelers || ""
  };
}

function normalizePlanType(value, slot = {}) {
  const explicit = String(value || "").trim().toLowerCase();
  if (PLAN_TYPE_SET.has(explicit)) return explicit;
  if (SLOT_PLAN_TYPES[slot.id]) return SLOT_PLAN_TYPES[slot.id];
  if (String(slot.id || "").startsWith("stay-")) return "stay";
  if (slot.hotelBookingSlotId) return "stay";

  const searchable = [slot.name, slot.transport?.mode, slot.review]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\b(flight|airline|airport|terminal)\b/.test(searchable)) return "flight";
  if (/\b(hotel|inn|stay|check[ -]?in|check[ -]?out|onsen)\b/.test(searchable)) return "stay";
  if (/\b(restaurant|dinner|lunch|omakase|sushi|yakiniku|ramen|café|cafe)\b/.test(searchable)) return "restaurant";
  if (/\b(rent(?:al)? car|toyota)\b/.test(searchable)) return "car";
  if (/\b(bus|train|shinkansen|tram|subway|transit|transfer)\b/.test(searchable)) return "transport";
  if (/\b(festival|gion|market event)\b/.test(searchable)) return "event";
  if (/\b(shop|shopping|mall|store)\b/.test(searchable)) return "shopping";
  if (/\b(boat|cruise|tour|class|experience)\b/.test(searchable)) return "activity";
  if (/\b(shrine|temple|gorge|observatory|cape|lake|park|museum|garden|island)\b/.test(searchable)) return "sight";
  return "other";
}

function planTypeLabel(type) {
  return ui(currentLanguage, ({
    flight: "planTypeFlight",
    stay: "planTypeStay",
    restaurant: "planTypeRestaurant",
    transport: "planTypeTransport",
    car: "planTypeCar",
    sight: "planTypeSight",
    activity: "planTypeActivity",
    event: "planTypeEvent",
    shopping: "planTypeShopping",
    other: "planTypeOther"
  })[type] || "planTypeOther");
}

function normalizeParticipantGroup(value) {
  const raw = (Array.isArray(value) ? value.join(" · ") : String(value || "")).trim();
  if (!raw || /^(?:everyone|all|全員|全员)$/i.test(raw)) return "";
  const groups = currentTrip.participantGroups || [];
  const direct = groups.find((group) => group.id === raw || group.label === raw);
  if (direct) return direct.label || (direct.members || []).join(" · ");
  const tokens = raw.split(/[·•,，、/／&+]/).map((token) => token.trim()).filter(Boolean);
  const matching = groups.find((group) => group.alwaysTogether !== false
    && (group.members || []).some((member) => tokens.includes(String(member))));
  return matching?.label || (matching?.members || []).join(" · ") || tokens.join(" · ");
}

function timelineParticipants(slot, flightBooking, hotelBooking) {
  const groups = currentTrip.participantGroups || [];
  const groupIds = Array.isArray(slot?.participantGroupIds) ? slot.participantGroupIds : [];
  if (groupIds.length && groups.length && groupIds.length >= groups.length) return "";
  const grouped = groupIds
    .map((id) => groups.find((group) => group.id === id))
    .filter(Boolean)
    .map((group) => group.label || (group.members || []).join(" · "))
    .filter(Boolean)
    .join(" · ");
  const explicit = grouped
    || flightBooking?.team?.travelers
    || hotelBooking?.travelers
    || slot?.participants
    || slot?.travelers;
  return normalizeParticipantGroup(explicit);
}

function canonicalTimelineTime(value) {
  return String(value || "").trim();
}

function normalizedPlaceName(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\b(?:the|restaurant|area|station|branch|option)\b/g, " ")
    .replace(/[^a-z0-9\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function diningMatchesSlot(meal, slot) {
  const canonicalSlot = currentTrip.days
    .flatMap((day) => day.slots || [])
    .find((candidate) => candidate.id === slot?.id) || slot;
  if (normalizePlanType(canonicalSlot?.planType, canonicalSlot) !== "restaurant") return false;
  const mealName = normalizedPlaceName(meal?.place);
  const slotName = normalizedPlaceName(timelineSlotName(canonicalSlot));
  if (mealName.length < 4 || slotName.length < 4) return false;
  return slotName.includes(mealName) || mealName.includes(slotName);
}

function timelineSlotName(slot) {
  return slot?.name || "";
}

function renderItinerary() {
  const index = displayTrip.days.findIndex((day) => day.id === activeDayId);
  const day = displayTrip.days[index] || displayTrip.days[0];
  const renderedDayId = els.days.querySelector(".day-section")?.id || "";
  const preserveDisclosureState = Boolean(day && renderedDayId === day.id);
  const openSlotIds = preserveDisclosureState
    ? new Set([...els.days.querySelectorAll(".timeline-card[open]")]
      .map((card) => card.closest(".timeline-item")?.dataset.slotId)
      .filter(Boolean))
    : new Set();
  const diningOpen = preserveDisclosureState && Boolean(els.days.querySelector(".dining-disclosure[open]"));
  const guideOpen = preserveDisclosureState && Boolean(els.days.querySelector(".day-guide[open]"));

  // A Google component is never moved into a rebuilt card (a move may disconnect and re-connect it).
  // Every component in the cards about to be replaced is released now; the restored cards reserve
  // and build nothing by themselves and offer an explicit "Show Google place details" instead.
  googlePlaceDetails?.releaseWithin(els.days);
  els.days.replaceChildren(day ? renderDay(day, Math.max(0, index)) : renderNoDays());

  if (!preserveDisclosureState) {
    setMapSelection("");
    return;
  }
  els.days.querySelectorAll(".timeline-item").forEach((item) => {
    const card = item.querySelector(".timeline-card");
    if (card && openSlotIds.has(item.dataset.slotId)) {
      // Restoring an open card after a re-render must not move the map.
      card.dataset.restoring = "true";
      card.open = true;
    }
  });
  const dining = els.days.querySelector(".dining-disclosure");
  const guide = els.days.querySelector(".day-guide");
  if (dining) dining.open = diningOpen;
  if (guide) guide.open = guideOpen;
  const stillShown = [...els.days.querySelectorAll(".timeline-item")]
    .some((item) => item.dataset.slotId === selectedMapSlotId);
  setMapSelection(stillShown ? selectedMapSlotId : "");
}

function renderNoDays() {
  const empty = element("div", "empty-state empty-state--dates");
  empty.append(textElement("p", "", ui(currentLanguage, HOSTED && !HOSTED_READ_ONLY ? "noDatesYet" : "emptyDay")));
  if (HOSTED && !HOSTED_READ_ONLY) {
    const add = textElement("button", "button", ui(currentLanguage, "addDate"));
    add.type = "button";
    add.addEventListener("click", () => openDayDialog());
    empty.append(add);
  }
  return empty;
}

function renderDay(day, index) {
  const section = element("section", "day-section");
  section.id = day.id;

  const heading = element("header", "day-heading");
  const headingCopy = element("div", "day-heading__copy");
  const dayArea = getDayArea(day.id, currentLanguage);
  const dayTitle = day.theme || formatDate(day.date, { month: "long", day: "numeric" });
  headingCopy.append(
    textElement("p", "eyebrow", ui(currentLanguage, "dayNumber", { number: index + 1, weekday: day.weekday || formatDate(day.date, { weekday: "long" }) })),
    textElement("h2", "day-heading__title", dayTitle),
    textElement("p", "active-day-area", [
      formatDate(day.date, { month: "long", day: "numeric" }),
      dayArea && dayArea !== dayTitle ? dayArea : ""
    ].filter(Boolean).join(" · "))
  );
  if (day.date === todayInTripISO()) headingCopy.append(textElement("span", "today-chip", ui(currentLanguage, "today")));
  const add = textElement("button", "button button--quiet", ui(currentLanguage, "addPlanButton"));
  add.type = "button";
  add.setAttribute("aria-label", ui(currentLanguage, "addToDate", { date: formatDate(day.date, { dateStyle: "full" }) }));
  add.addEventListener("click", () => openItemDialog(day.id));
  if (HOSTED_READ_ONLY) {
    heading.append(headingCopy);
  } else if (HOSTED) {
    const actions = element("div", "day-heading__actions");
    const editDate = textElement("button", "button button--quiet", ui(currentLanguage, "editDate"));
    editDate.type = "button";
    editDate.setAttribute("aria-label", `${ui(currentLanguage, "editDate")}: ${formatDate(day.date, { dateStyle: "full" })}`);
    editDate.addEventListener("click", () => openDayDialog(day.id));
    actions.append(add, editDate);
    heading.append(headingCopy, actions);
  } else {
    heading.append(headingCopy, add);
  }
  section.append(heading);

  if (day.summary) section.append(textElement("p", "day-summary", day.summary));

  const dayReminders = renderDayReminders(day);
  if (dayReminders) section.append(dayReminders);

  const timeline = element("div", "timeline");
  const timelineSlots = orderedDaySlots(day);
  timelineSlots.forEach((slot, slotIndex) => timeline.append(renderSlot(day, slot, slotIndex)));
  if (!timelineSlots.length) {
    timeline.append(textElement("p", "empty-state", ui(currentLanguage, "emptyDay")));
  }
  section.append(timeline);

  const visibleDining = Array.isArray(day.dining)
    ? day.dining
      .map((meal, index) => ({ meal, index }))
      .filter(({ meal, index: mealIndex }) => {
        const canonicalMeal = currentTrip.days
          .find((candidate) => candidate.id === day.id)?.dining?.[mealIndex] || meal;
        return !timelineSlots.some((slot) => diningMatchesSlot(canonicalMeal, slot));
      })
    : [];
  if (visibleDining.length) {
    const dining = element("details", "dining-row dining-disclosure");
    const diningSummary = element("summary", "dining-summary");
    diningSummary.append(
      textElement("strong", "", ui(currentLanguage, "foodNotes")),
      textElement("span", "count-chip", String(visibleDining.length)),
      textElement("span", "summary-chevron", "⌄")
    );
    dining.append(diningSummary);
    visibleDining.forEach(({ meal, index: mealIndex }) => {
      const canonicalMeal = currentTrip.days.find((candidate) => candidate.id === day.id)?.dining?.[mealIndex] || meal;
      const matchingSlot = findCanonicalLocation(canonicalMeal.place);
      const line = element("p", "dining-item");
      line.append(
        textElement("strong", "", `${meal.meal}${currentLanguage === "en" ? ": " : "："}${meal.place}`),
        document.createTextNode(meal.hours ? ` · ${meal.hours}` : "")
      );
      const dishes = (meal.dishes || []).map((dish) => `${dish.name}${dish.price ? ` ${dish.price}` : ""}`).join(" · ");
      if (dishes) line.append(textElement("span", "muted", ` — ${dishes}`));
      const diningMapLink = googleMapsAnchor({
        googleMapsKey: `dining:${canonicalMeal.place}`,
        name: meal.place,
        lat: matchingSlot?.lat,
        lng: matchingSlot?.lng,
        address: matchingSlot?.address || canonicalMeal.place
      });
      if (diningMapLink) line.append(document.createTextNode(" "), diningMapLink);
      dining.append(line);
    });
    section.append(dining);
  }

  if (Array.isArray(day.tips) && day.tips.length) {
    section.append(textElement("p", "day-tip", day.tips.join(" · ")));
  }
  const guide = renderDayGuide(day);
  if (guide) section.append(guide);
  return section;
}

function renderDayReminders(day) {
  const computed = remindersDueOnDate(
    computeReminders(displayTrip.startDate, displayTrip.reminders),
    day.date
  );
  if (!computed.length) return null;

  const panel = element("section", "day-todos");
  const heading = element("div", "day-todos__heading");
  heading.append(
    textElement("h3", "", ui(currentLanguage, "todosDueOnDate", {
      date: formatDate(day.date, { month: "short", day: "numeric" })
    })),
    textElement("span", "count-chip", String(computed.length))
  );
  const list = element("div", "day-todos__list");
  list.innerHTML = renderChecklistHTML(computed, {
    formatDue: (date) => ui(currentLanguage, "dueOnDate", {
      date: formatDate(date, { month: "short", day: "numeric" })
    })
  });
  bindReminderItems(list, computed);
  panel.append(heading, list);
  return panel;
}

function renderSlot(day, slot, slotIndex) {
  const article = element("article", "timeline-item");
  article.dataset.slotId = slot.id;
  const flightBooking = flightBookingForSlot(slot);
  const hotelBooking = hotelBookingForSlot(slot);
  const travelers = timelineParticipants(slot, flightBooking, hotelBooking);
  article.classList.toggle("timeline-item--booking", Boolean(flightBooking || hotelBooking));
  const marker = textElement("div", "timeline-marker", String(slotIndex + 1));
  marker.setAttribute("aria-hidden", "true");

  const card = element("details", "timeline-card");
  const summary = element("summary", "timeline-card__summary");
  const photo = renderLocationPhoto(slot);
  const summaryCopy = element("div", "timeline-card__summary-copy");
  const labels = element("div", "timeline-card__labels");
  const scheduleRow = element("div", "timeline-card__schedule-row");
  const tagRow = element("div", "timeline-card__tag-row");
  const period = periodLabel(slot.period);
  const time = canonicalTimelineTime(slot.time, slot.id) || ui(currentLanguage, "flexible");
  scheduleRow.append(textElement("span", "period-chip", period));
  if (normalizedLabel(time) !== normalizedLabel(period)) {
    scheduleRow.append(textElement("span", "time-label", time));
  }
  const planType = normalizePlanType(slot.planType, slot);
  tagRow.append(textElement("span", `plan-type-chip plan-type-chip--${planType}`, planTypeLabel(planType)));
  if (travelers) tagRow.append(textElement("span", "traveler-chip timeline-traveler-chip", travelers));
  if (slot.booked) tagRow.append(textElement("span", "status-chip status-chip--booked", ui(currentLanguage, "booked")));
  if (slot.alternative) tagRow.append(textElement("span", "status-chip", ui(currentLanguage, "chooseOne")));
  if (slot.approximateLocation) tagRow.append(textElement("span", "status-chip", ui(currentLanguage, "approximatePin")));
  if (slot.rating) tagRow.append(textElement("span", "rating-chip", `★ ${slot.rating}`));
  labels.append(scheduleRow, tagRow);
  const slotName = timelineSlotName(slot);
  summaryCopy.append(labels, textElement("h3", "timeline-card__title", slotName));
  summary.append(photo, summaryCopy, textElement("span", "timeline-card__chevron", "⌄"));

  const body = element("div", "timeline-card__body");
  const presentation = projectCardLinks(slot);
  if (presentation.texts.review) body.append(textElement("p", "timeline-card__review", presentation.texts.review));
  // The plan's (localized) description, with safe links like the review. Skipped when it repeats
  // the review so the same paragraph is never shown twice.
  if (typeof slot.description === "string" && slot.description.trim() && !sameCardText(slot.description, slot.review)) {
    if (presentation.texts.description) body.append(textElement("p", "timeline-card__description", presentation.texts.description));
  }

  const meta = [
    slot.openingHours && !slot.hideOpeningHours
      ? ui(currentLanguage, "hoursLabel", { value: slot.openingHours })
      : "",
    slot.seasonal ? ui(currentLanguage, "eventLabel", { value: slot.seasonal }) : "",
    slot.ticketPrice ? ui(currentLanguage, "referenceLabel", { value: slot.ticketPrice }) : "",
    slot.transport?.mode ? ui(currentLanguage, "nextLabel", { value: `${slot.transport.mode}${slot.transport.duration ? ` · ${slot.transport.duration}` : ""}` }) : ""
  ].filter(Boolean);
  // A plan title alone is not a place. Clearing/omitting the location must not turn a flight,
  // free afternoon or other timeline-only plan into an unrelated name search.
  const locationLabel = slot.address || slot.place?.name || slot.googleMapsPlaceLabel || slot.googleMapsPlaceName
    || (googleMapsDestinations(slot, { allowSearchFallback: false }).length ? slot.name : "");
  const locationRow = locationLabel ? planLocationItem(slot, locationLabel, presentation.links) : null;
  if (locationRow) body.append(locationRow);
  const locationHrefs = new Set([...(locationRow?.querySelectorAll("a[href]") || [])].map((link) => link.href));
  if (meta.length) {
    const list = element("ul", "meta-list");
    meta.forEach((item) => list.append(textElement("li", "", item)));
    body.append(list);
  }
  if (presentation.texts.notes) body.append(textElement("p", "note-line", presentation.texts.notes));
  const words = RELATED_LINK_WORDS[currentLanguage] || RELATED_LINK_WORDS.en;
  const linkGroup = renderCardLinkGroup(document, presentation.links.filter((link) => !locationHrefs.has(link.href)), words[0]);
  if (linkGroup) body.append(linkGroup);
  const bookingDetails = renderTimelineBookingDetails(flightBooking, hotelBooking);
  if (bookingDetails) body.append(bookingDetails);
  const placeSource = renderPlaceSource(slot);
  if (placeSource) body.append(placeSource);
  const photoCredit = renderPhotoCredit(slot);
  if (photoCredit) body.append(photoCredit);
  // Saved Google association: an empty host only. The standard component is created when this
  // card is expanded, never on render, poll or reload.
  const googleDescriptor = googlePlaceDescriptor(slot.id);
  const googleHost = googleDescriptor ? createGooglePlaceHost(document, currentLanguage) : null;
  if (googleHost) body.append(googleHost);
  const actions = element("div", "timeline-card__actions");
  const mapsAction = googleMapsAnchor(slot, { allowSearchFallback: false });
  // The location row carries the same native Maps action; do not duplicate it in the footer.
  if (mapsAction?.matches("a")) {
    if (!locationHrefs.has(mapsAction.href)) actions.append(mapsAction);
  } else if (mapsAction) {
    for (const link of mapsAction.querySelectorAll("a")) if (locationHrefs.has(link.href)) link.remove();
    if (mapsAction.querySelector("a")) actions.append(mapsAction);
  }
  if (!slot.syntheticBooking && !HOSTED_READ_ONLY) {
    const edit = textElement("button", "icon-button", ui(currentLanguage, "edit"));
    edit.type = "button";
    edit.setAttribute("aria-label", `${ui(currentLanguage, "editPlan")}: ${slotName}`);
    edit.addEventListener("click", () => openItemDialog(day.id, slot.id));
    actions.append(edit);
  }
  if (actions.childNodes.length) body.append(actions);
  if (slot.needsBooking && !slot.booked) {
    const reminder = element("div", "booking-reminder");
    const leadDays = Number(slot.leadDays);
    const safeLeadDays = Number.isFinite(leadDays) ? Math.min(365, Math.max(0, Math.round(leadDays))) : 0;
    reminder.append(textElement("span", "reminder-badge", ui(currentLanguage, "bookAhead", { count: safeLeadDays })));
    body.append(reminder);
  }

  card.append(summary, body);
  card.addEventListener("toggle", () => {
    const restoring = card.dataset.restoring === "true";
    delete card.dataset.restoring;
    // A card rendered before the trip was opted out may still toggle once: then nothing starts.
    const runtime = googleHost ? googlePlacesRuntime() : null;
    if (runtime) {
      const details = runtime.details;
      // Expanding loads this plan only (after an allowance reservation); re-expanding the same card
      // unhides the component still connected in this host. A card re-opened by a re-render never
      // reserves or builds (its old component was released, never moved here); it and other open
      // cards get an explicit control instead of a new request.
      if (card.open && !restoring) details.show(googleHost, googleDescriptor);
      else if (card.open && details.isActive(googleDescriptor)) details.restore(googleHost, googleDescriptor);
      else if (card.open) details.idle(googleHost, googleDescriptor);
      else if (!restoring) details.deactivate(googleDescriptor);
    }
    const mapped = !slot.mapLocationOmitted && Number.isFinite(slot.lat) && Number.isFinite(slot.lng);
    if (card.open) {
      if (!mapped) return;
      setMapSelection(slot.id);
      if (!restoring && mapInstance) focusMapPoint(slot.lat, slot.lng, 13);
    } else if (selectedMapSlotId === slot.id) {
      setMapSelection("");
    }
  });
  article.append(marker, card);
  return article;
}

// Two card texts that differ only in surrounding or repeated whitespace count as the same text.
function sameCardText(first, second) {
  const normalize = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  return normalize(first) === normalize(second);
}

// Saved destinations/selected coordinates first, then an ordinary encoded Maps search. Multiple
// destinations stay separate and labelled; omitted locations remain deliberately inert.
function planLocationItem(slot, label, related = []) {
  const item = element("div", "plan-location");
  const byUrl = new Map();
  for (const destination of googleMapsDestinations({ ...slot, name: slot.place?.name || slot.googleMapsPlaceName || slot.googleMapsPlaceLabel || slot.name }, { allowNameFallback: true })) {
    if (!byUrl.has(destination.url)) byUrl.set(destination.url, { url: destination.url, labels: [] });
    const text = destination.labels?.[currentLanguage] || destination.labels?.en;
    if (text && !byUrl.get(destination.url).labels.includes(text)) byUrl.get(destination.url).labels.push(text);
  }
  const destinations = [...byUrl.values()];
  const appendLink = (text, url, destinationLabels = []) => {
    const link = locationTextNode(document, text, url, { ariaLabel: `${ui(currentLanguage, "openGoogleMaps")}: ${text}` });
    if (link.nodeType === 1) {
      const aliases = [...new Set([...destinationLabels, ...(related.find((entry) => entry.href === link.href)?.labels || [])])].filter((entry) => entry !== text);
      const copy = textElement("span", "plan-location__label", text);
      if (aliases.length) copy.append(textElement("span", "plan-location__aliases", ` · ${aliases.join(" · ")}`));
      link.replaceChildren(cardLinkIcon(document, "map"), copy);
      if (aliases.length) link.setAttribute("aria-label", `${ui(currentLanguage, "openGoogleMaps")}: ${copy.textContent}`);
    }
    item.append(link);
  };
  if (destinations.length === 1) appendLink(label, destinations[0].url, destinations[0].labels);
  else if (destinations.length > 1) {
    item.append(textElement("span", "plan-location__context", label));
    destinations.forEach((destination, index) => {
      appendLink(destination.labels.join(" · ") || `${ui(currentLanguage, "openGoogleMaps")} ${index + 1}`, destination.url);
    });
  } else item.textContent = label;
  return item;
}

// ---------------------------------------------------------------------------
// Optional Google Places UI Kit (saved associations only). The association is read from the
// canonical server trip, never from a localized copy, and is shown only while its location binding
// matches the plan's current location.

// Site-wide feature (session flag) AND this trip's own choice; each alone does nothing.
function tripGooglePlacesEnabled(trip = hostedServerTrip) {
  return GOOGLE_PLACES_SITE_ENABLED && trip?.googlePlacePhotosEnabled === true;
}

function googlePlacesRuntime() {
  if (!tripGooglePlacesEnabled()) return null;
  // One loader per page session (one script, one library import, started only with a granted key).
  googlePlacesLoader ||= createGooglePlacesLoader({ win: window, language: currentLanguage });
  // One allowance gate per page session. Every Google action reserves through it first.
  googleAllowanceGate ||= createGoogleAllowanceGate({
    tripId: HOSTED_TRIP_ID,
    reserve: (body) => hostedApi.reserveGooglePlace(HOSTED_TRIP_ID, body)
  });
  googlePlaceDetails ||= createPlaceDetailsManager({
    doc: document,
    loader: googlePlacesLoader,
    gate: googleAllowanceGate,
    // Re-checked synchronously right before each dispatch: still opted in, same association.
    isCurrent: (descriptor) => {
      const current = googlePlaceDescriptor(descriptor.planId);
      return Boolean(current) && googlePlaceDetails?.keyOf(current) === googlePlaceDetails?.keyOf(descriptor);
    },
    language: () => currentLanguage
  });
  return { loader: googlePlacesLoader, gate: googleAllowanceGate, details: googlePlaceDetails };
}

// The trip was opted out (for example by another editor; seen on a poll). Cancel what is pending,
// void outstanding reservations and unused permits, discard built components, close any Google
// search/preview in an open editor and ignore late results. Saved associations stay in the trip data
// untouched. The page-session loader is kept so that opting in again later reuses it instead of
// loading the script again; every new component still needs a new reservation.
function stopTripGooglePlaces() {
  googleAllowanceGate?.cancelAll();
  // A load still in progress stops before its next step (no script/library after this point).
  googlePlacesLoader?.cancel?.();
  googlePlaceDetails?.dispose();
  googlePlaceDetails = null;
  const session = editorSession;
  if (session?.google) {
    endGoogleEditorState(session);
    session.google = null;
  }
  hideGooglePanel();
}

function hideGooglePanel() {
  const panel = document.getElementById("google-match");
  if (panel) panel.hidden = true;
}

function canonicalPlan(slotId) {
  for (const day of hostedServerTrip?.days || []) {
    for (const plan of (Array.isArray(day?.slots) ? day.slots : [])) if (plan?.id === slotId) return plan;
  }
  return null;
}

function googlePlaceDescriptor(slotId) {
  if (!tripGooglePlacesEnabled()) return null;
  const plan = canonicalPlan(slotId);
  if (!plan || !associationMatchesPlan(plan)) return null;
  const association = normalizeGooglePlaceAssociation(plan[GOOGLE_PLACE_ASSOCIATION_FIELD]);
  return { tripId: HOSTED_TRIP_ID, planId: plan.id, placeId: association.placeId, binding: association.locationBinding };
}

function currentGooglePlaceKeys() {
  const keys = new Set();
  if (!googlePlaceDetails) return keys;
  for (const day of hostedServerTrip?.days || []) {
    for (const plan of (Array.isArray(day?.slots) ? day.slots : [])) {
      const descriptor = googlePlaceDescriptor(plan?.id);
      if (descriptor) keys.add(googlePlaceDetails.keyOf(descriptor));
    }
  }
  return keys;
}

// Shows where a chosen location came from; provider text is plain text only.
function renderPlaceSource(slot) {
  const place = readSavedPlace(slot?.place);
  if (!place) return null;
  const line = element("p", "place-source");
  line.append(
    textElement("span", "place-source__label", `${pickerText(currentLanguage, "locationSourceLabel")}: `),
    externalAnchor(pickerText(currentLanguage, "viewOnOpenStreetMap"), place.sourceUrl, "place-source__link"),
    textElement("span", "place-source__attribution", ` · ${place.attribution} · ${place.license}`)
  );
  return line;
}

// Visible credit, licence and source for an explicitly chosen licensed photo.
function renderPhotoCredit(slot) {
  const photo = readSavedPhoto(slot?.photo);
  if (!photo) return null;
  return photoCreditLine(photo, "photo-credit photo-credit--licensed");
}

function photoCreditLine(photo, className) {
  const line = element("p", className);
  line.append(textElement("span", "photo-credit__label", `${pickerText(currentLanguage, "representativePhotoLabel")} · `));
  if (photo.author) {
    line.append(textElement("span", "photo-credit__author", pickerText(currentLanguage, "photoBy", { author: photo.author })), document.createTextNode(" · "));
  }
  const licenseLabel = pickerText(currentLanguage, "photoLicense", { license: photo.license });
  line.append(photo.licenseUrl
    ? externalAnchor(licenseLabel, photo.licenseUrl, "photo-credit__license")
    : textElement("span", "photo-credit__license", licenseLabel));
  line.append(document.createTextNode(" · "), externalAnchor(pickerText(currentLanguage, "photoSource"), photo.sourceUrl, "photo-credit__source"));
  return line;
}

// Highlights one plan on both the itinerary and the map, or clears the highlight.
function setMapSelection(slotId) {
  selectedMapSlotId = slotId || "";
  els.days.querySelectorAll(".timeline-item").forEach((item) => {
    const selected = Boolean(selectedMapSlotId) && item.dataset.slotId === selectedMapSlotId;
    item.classList.toggle("is-map-selected", selected);
    if (selected) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  });
  applyMarkerSelection();
}

function applyMarkerSelection() {
  const markers = mapInstance?.tripMarkers;
  if (!markers) return;
  Object.keys(markers).forEach((id) => {
    const marker = markers[id];
    const selected = id === selectedMapSlotId;
    const node = typeof marker?.getElement === "function" ? marker.getElement() : null;
    if (node) {
      node.classList.toggle("is-selected", selected);
      if (selected) node.setAttribute("aria-current", "true");
      else node.removeAttribute("aria-current");
    }
    if (typeof marker?.setZIndexOffset === "function") marker.setZIndexOffset(selected ? 1000 : 0);
  });
}

function renderTimelineBookingDetails(flightBooking, hotelBooking) {
  if (!flightBooking && !hotelBooking) return null;
  const panel = element("div", "timeline-booking-details");

  if (flightBooking) {
    const { segment } = flightBooking;
    if (segment.baggage) {
      const baggage = element("p", "timeline-booking-details__baggage");
      baggage.append(
        textElement("strong", "", `${ui(currentLanguage, "baggage")}: `),
        document.createTextNode(segment.baggage)
      );
      panel.append(baggage);
    }
    const links = element("div", "resource-links");
    segment.links.forEach((destination) => links.append(externalAnchor(destination.label, destination.url)));
    if (links.childNodes.length) panel.append(links);
  }

  if (hotelBooking) {
    panel.append(textElement("p", "muted", hotelBooking.area.area));
  }
  return panel.childNodes.length ? panel : null;
}

function isItinerarySheetActive() {
  return document.documentElement.classList.contains("is-itinerary-view");
}

function clampItinerarySheetTop(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function itinerarySheetSnapPoints() {
  const workspaceRect = els.planWorkspace?.getBoundingClientRect();
  const workspaceHeight = Math.max(1, workspaceRect?.height || window.innerHeight || 1);
  const shortLandscape = window.matchMedia("(max-height: 500px) and (pointer: coarse)").matches
    || (workspaceRect && workspaceRect.width > workspaceHeight && workspaceHeight <= 500);
  const viewportHeights = [
    Number(window.innerHeight),
    Number(window.visualViewport?.height),
    Number(document.documentElement.clientHeight)
  ].filter((value) => Number.isFinite(value) && value > 0);
  const referenceHeight = Math.min(workspaceHeight, ...(viewportHeights.length ? viewportHeights : [workspaceHeight]));
  const handleHeight = els.itinerarySheetHandle?.getBoundingClientRect().height || 32;
  const daysHeight = els.daysNav?.parentElement?.getBoundingClientRect().height || 80;
  const minimumSheetHeight = Math.min(
    workspaceHeight,
    Math.max(shortLandscape ? 145 : 220, handleHeight + daysHeight + (shortLandscape ? 34 : 96))
  );
  const maximumTop = Math.max(0, workspaceHeight - minimumSheetHeight);
  const itineraryTop = Math.min(maximumTop, Math.round(referenceHeight * (shortLandscape ? 0.4 : 0.33)));
  const balancedTop = Math.min(maximumTop, Math.max(itineraryTop, Math.round(referenceHeight * 0.5)));
  const mapTop = Math.min(maximumTop, Math.max(balancedTop, Math.round(referenceHeight * (shortLandscape ? 0.6 : 0.68))));

  return [
    { mode: "itinerary", top: itineraryTop },
    { mode: "balanced", top: balancedTop },
    { mode: "map", top: mapTop }
  ];
}

function closestItinerarySheetSnap(top, points = itinerarySheetSnapPoints()) {
  return points.reduce((closest, point) => (
    Math.abs(point.top - top) < Math.abs(closest.top - top) ? point : closest
  ), points[0]);
}

function itinerarySheetModeLabel(mode) {
  const key = {
    itinerary: "sheetItineraryView",
    balanced: "sheetBalancedView",
    map: "sheetMapView"
  }[mode] || "sheetItineraryView";
  return ui(currentLanguage, key);
}

function updateItinerarySheetHandle(top, mode = itinerarySheetMode) {
  if (!els.itinerarySheetHandle || !els.planWorkspace) return;
  const workspaceHeight = Math.max(1, els.planWorkspace.getBoundingClientRect().height || 1);
  const points = itinerarySheetSnapPoints();
  const currentTop = Number.isFinite(top)
    ? top
    : (closestItinerarySheetSnap(
      els.itinerarySheet.getBoundingClientRect().top - els.planWorkspace.getBoundingClientRect().top,
      points
    ).top);
  els.itinerarySheetHandle.setAttribute("aria-valuemin", String(Math.round((points[0].top / workspaceHeight) * 100)));
  els.itinerarySheetHandle.setAttribute("aria-valuemax", String(Math.round((points.at(-1).top / workspaceHeight) * 100)));
  els.itinerarySheetHandle.setAttribute("aria-valuenow", String(Math.round((currentTop / workspaceHeight) * 100)));
  els.itinerarySheetHandle.setAttribute("aria-valuetext", itinerarySheetModeLabel(mode));
  els.itinerarySheetHandle.dataset.sheetMode = mode;
}

function applyItinerarySheetTop(top, mode = itinerarySheetMode) {
  if (!els.planWorkspace) return;
  const roundedTop = Math.round(top);
  els.planWorkspace.style.setProperty("--itinerary-sheet-top", `${roundedTop}px`);
  updateItinerarySheetHandle(roundedTop, mode);
}

function flushItinerarySheetTop() {
  if (itinerarySheetPositionFrame) cancelAnimationFrame(itinerarySheetPositionFrame);
  itinerarySheetPositionFrame = null;
  if (!Number.isFinite(pendingItinerarySheetTop)) return;
  const top = pendingItinerarySheetTop;
  pendingItinerarySheetTop = null;
  const nearest = closestItinerarySheetSnap(top);
  applyItinerarySheetTop(top, nearest.mode);
}

function queueItinerarySheetTop(top) {
  pendingItinerarySheetTop = top;
  if (itinerarySheetPositionFrame) return;
  itinerarySheetPositionFrame = requestAnimationFrame(() => {
    itinerarySheetPositionFrame = null;
    if (!Number.isFinite(pendingItinerarySheetTop)) return;
    const nextTop = pendingItinerarySheetTop;
    pendingItinerarySheetTop = null;
    const nearest = closestItinerarySheetSnap(nextTop);
    applyItinerarySheetTop(nextTop, nearest.mode);
  });
}

function refreshMapForItinerarySheet() {
  if (!isItinerarySheetActive() || !mapInstance || !window.L) return;
  const insets = mapFrameInsets();
  mapInstance.eachLayer((layer) => {
    const popup = typeof layer.getPopup === "function" ? layer.getPopup() : null;
    if (!popup) return;
    popup.options.autoPanPaddingTopLeft = window.L.point(insets.left, insets.top);
    popup.options.autoPanPaddingBottomRight = window.L.point(insets.right, insets.bottom);
  });
  frameMapToPoints(currentMapPoints, false);
}

function scheduleItinerarySheetMapFrame(delay = 260) {
  clearTimeout(itinerarySheetFrameTimer);
  itinerarySheetFrameTimer = setTimeout(() => {
    itinerarySheetFrameTimer = null;
    requestAnimationFrame(refreshMapForItinerarySheet);
  }, delay);
}

function applyItinerarySheetMode(mode, { reframe = true } = {}) {
  const points = itinerarySheetSnapPoints();
  const target = points.find((point) => point.mode === mode) || points[0];
  itinerarySheetMode = target.mode;
  applyItinerarySheetTop(target.top, target.mode);
  if (reframe) scheduleItinerarySheetMapFrame();
}

function syncItinerarySheetPosition({ reframe = true } = {}) {
  if (!isItinerarySheetActive()) return;
  applyItinerarySheetMode(itinerarySheetMode, { reframe });
}

function finishItinerarySheetDrag(event, { cancelled = false } = {}) {
  const drag = itinerarySheetDrag;
  if (!drag || (event?.pointerId != null && drag.pointerId !== event.pointerId)) return;
  itinerarySheetDrag = null;
  flushItinerarySheetTop();
  document.documentElement.classList.remove("is-sheet-dragging");
  try {
    if (els.itinerarySheetHandle.hasPointerCapture?.(drag.pointerId)) {
      els.itinerarySheetHandle.releasePointerCapture(drag.pointerId);
    }
  } catch {
    // The capture may already have been released by iOS after an interrupted gesture.
  }

  if (!drag.moved) {
    updateItinerarySheetHandle(drag.startTop, itinerarySheetMode);
    return;
  }

  const points = itinerarySheetSnapPoints();
  let targetIndex = points.indexOf(closestItinerarySheetSnap(drag.currentTop, points));
  const recentVelocity = !cancelled && performance.now() - drag.lastTime <= 120 ? drag.velocity : 0;
  if (Math.abs(recentVelocity) >= 0.45) {
    targetIndex = clampItinerarySheetTop(targetIndex + (recentVelocity > 0 ? 1 : -1), 0, points.length - 1);
  }
  const target = points[targetIndex];
  void els.itinerarySheet.offsetTop;
  requestAnimationFrame(() => applyItinerarySheetMode(target.mode));
}

function setupItinerarySheetInteractions() {
  const handle = els.itinerarySheetHandle;
  if (!handle) return;

  handle.addEventListener("pointerdown", (event) => {
    if (!isItinerarySheetActive() || event.isPrimary === false) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A press that starts on a link or an embedded component is never a sheet gesture.
    if (startsOnInteractive(event, handle.parentNode)) return;
    const workspaceRect = els.planWorkspace.getBoundingClientRect();
    const currentTop = clampItinerarySheetTop(
      els.itinerarySheet.getBoundingClientRect().top - workspaceRect.top,
      itinerarySheetSnapPoints()[0].top,
      itinerarySheetSnapPoints().at(-1).top
    );
    itinerarySheetDrag = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: currentTop,
      currentTop,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
      moved: false
    };
    document.documentElement.classList.add("is-sheet-dragging");
    handle.focus({ preventScroll: true });
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; touch-action still isolates the handle gesture.
    }
  });

  const handlePointerMove = (event) => {
    const drag = itinerarySheetDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaY) < ITINERARY_SHEET_DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    const points = itinerarySheetSnapPoints();
    const top = clampItinerarySheetTop(
      drag.startTop + deltaY,
      points[0].top,
      points.at(-1).top
    );
    const now = performance.now();
    const elapsed = Math.max(1, now - drag.lastTime);
    const instantaneousVelocity = (event.clientY - drag.lastY) / elapsed;
    drag.velocity = (drag.velocity * 0.65) + (instantaneousVelocity * 0.35);
    drag.lastY = event.clientY;
    drag.lastTime = now;
    drag.currentTop = top;
    queueItinerarySheetTop(top);
  };

  window.addEventListener("pointermove", handlePointerMove, { passive: false });
  window.addEventListener("pointerup", (event) => finishItinerarySheetDrag(event));
  window.addEventListener("pointercancel", (event) => finishItinerarySheetDrag(event, { cancelled: true }));
  handle.addEventListener("lostpointercapture", (event) => finishItinerarySheetDrag(event, { cancelled: true }));
  window.addEventListener("blur", () => finishItinerarySheetDrag(undefined, { cancelled: true }));
  handle.addEventListener("keydown", (event) => {
    if (!isItinerarySheetActive()) return;
    let targetIndex = ITINERARY_SHEET_MODES.indexOf(itinerarySheetMode);
    if (["ArrowUp", "PageUp"].includes(event.key)) targetIndex -= 1;
    else if (["ArrowDown", "PageDown"].includes(event.key)) targetIndex += 1;
    else if (event.key === "Home") targetIndex = 0;
    else if (event.key === "End") targetIndex = ITINERARY_SHEET_MODES.length - 1;
    else return;
    event.preventDefault();
    targetIndex = clampItinerarySheetTop(targetIndex, 0, ITINERARY_SHEET_MODES.length - 1);
    applyItinerarySheetMode(ITINERARY_SHEET_MODES[targetIndex]);
  });
  els.itinerarySheet.addEventListener("transitionend", (event) => {
    if (event.target !== els.itinerarySheet || event.propertyName !== "top") return;
    clearTimeout(itinerarySheetFrameTimer);
    itinerarySheetFrameTimer = null;
    refreshMapForItinerarySheet();
  });

  requestAnimationFrame(() => syncItinerarySheetPosition({ reframe: false }));
}

function mapFrameInsets() {
  const isPlanner = document.documentElement.classList.contains("is-itinerary-view");
  if (!isPlanner) return { top: 30, right: 30, bottom: 30, left: 30 };
  const sheet = document.querySelector(".itinerary-sheet");
  const mapElement = document.getElementById("map");
  const mapHeading = document.querySelector(".map-heading");
  if (!sheet || !mapElement) return { top: 24, right: 20, bottom: 24, left: 20 };
  const mapRect = mapElement.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();
  const headingRect = mapHeading?.getBoundingClientRect();
  const top = Math.max(24, Math.round((headingRect?.bottom || mapRect.top) - mapRect.top + 12));
  const sheetOverlap = Math.max(0, mapRect.bottom - Math.max(mapRect.top, sheetRect.top));
  const maxBottom = Math.max(24, Math.round(mapRect.height - top - 72));
  const bottom = Math.min(maxBottom, Math.max(24, Math.round(sheetOverlap + 20)));
  return { top, right: 20, bottom, left: 20 };
}

function mapFitBoundsOptions(animate = false) {
  const insets = mapFrameInsets();
  return {
    paddingTopLeft: [insets.left, insets.top],
    paddingBottomRight: [insets.right, insets.bottom],
    maxZoom: document.documentElement.classList.contains("is-itinerary-view") ? 11 : 13,
    animate
  };
}

function centerMapPointInVisibleArea(lat, lng, zoom, animate = false) {
  if (!mapInstance || !window.L) return;
  const insets = mapFrameInsets();
  const projected = mapInstance.project([lat, lng], zoom);
  const adjustedCenter = projected.add(window.L.point(0, (insets.bottom - insets.top) / 2));
  mapInstance.stop();
  mapInstance.setView(mapInstance.unproject(adjustedCenter, zoom), zoom, { animate });
}

function frameMapToPoints(points = currentMapPoints, animate = false) {
  if (!mapInstance || !window.L) return;
  const container = document.getElementById("map");
  if (!container.clientWidth || !container.clientHeight) return;
  // Placeholder-only days show the route overview without inventing POI pins.
  if (!points.length) {
    const tripPoints = displayTrip.days.flatMap((day) => day.slots || [])
      .filter((slot) => !slot.mapLocationOmitted && Number.isFinite(slot.lat) && Number.isFinite(slot.lng));
    if (tripPoints.length) frameMapToPoints(tripPoints, animate);
    else mapInstance.setView([20, 0], 2, { animate: false });
    return;
  }
  if (points.length === 1) {
    const zoom = document.documentElement.classList.contains("is-itinerary-view") ? 11 : 12;
    centerMapPointInVisibleArea(points[0].lat, points[0].lng, zoom, animate);
    return;
  }
  mapInstance.stop();
  mapInstance.fitBounds(
    window.L.latLngBounds(points.map((point) => [point.lat, point.lng])),
    mapFitBoundsOptions(animate)
  );
}

function focusMapPoint(lat, lng, zoom = 13) {
  if (!mapInstance) return;
  const targetZoom = document.documentElement.classList.contains("is-itinerary-view")
    ? 11
    : Math.min(13, Math.max(12, zoom));
  centerMapPointInVisibleArea(lat, lng, targetZoom, true);
}

function renderLocationPhoto(slot) {
  const record = getPlacePhoto(slot.photoSourceId || slot.id);
  const slotPhoto = typeof slot.photo === "string" ? slot.photo : slot.photo?.url;
  const url = slotPhoto || record?.url;
  const frame = element("div", "location-photo");
  frame.append(textElement("span", "location-photo__fallback", slot.name));
  if (!url) return frame;

  const image = document.createElement("img");
  image.src = optimizedPhotoUrl(url);
  image.alt = ui(currentLanguage, "representativePhoto", { name: slot.name });
  image.loading = "lazy";
  image.decoding = "async";
  image.addEventListener("error", () => image.remove());
  frame.append(image);
  return frame;
}

function renderDayGuide(day) {
  const guide = getDayGuide(day.id, currentLanguage);
  const restaurants = Array.isArray(guide.restaurants) ? guide.restaurants : [];
  const extras = Array.isArray(guide.extras) ? guide.extras : [];
  if (!guide.note && !restaurants.length && !extras.length) return null;

  const disclosure = element("details", "day-guide");
  const summary = element("summary", "day-guide__summary");
  const summaryCopy = element("span", "day-guide__summary-copy");
  summaryCopy.append(
    textElement("span", "eyebrow", ui(currentLanguage, "nearbyIdeas")),
    textElement("strong", "", ui(currentLanguage, "eatSeeDoMore"))
  );
  summary.append(
    summaryCopy,
    textElement("span", "count-chip", ui(currentLanguage, "ideaCount", { count: restaurants.length + extras.length })),
    textElement("span", "summary-chevron", "⌄")
  );
  disclosure.append(summary);

  // Keep the closed disclosure cheap: do not create images/cards until opened.
  let bodyCreated = false;
  disclosure.addEventListener("toggle", () => {
    if (!disclosure.open || bodyCreated) return;
    bodyCreated = true;
    const body = element("div", "day-guide__body");
    if (guide.note) body.append(textElement("p", "guide-note", guide.note));
    if (restaurants.length) {
      const section = element("section", "guide-section");
      section.append(textElement("h3", "guide-section__title", ui(currentLanguage, "additionalRestaurants")));
      const grid = element("div", "recommendation-grid");
      restaurants.forEach((restaurant) => grid.append(renderRecommendationCard(restaurant, true)));
      section.append(grid);
      body.append(section);
    }
    if (extras.length) {
      const section = element("section", "guide-section");
      section.append(textElement("h3", "guide-section__title", ui(currentLanguage, "famousNearby")));
      const grid = element("div", "recommendation-grid recommendation-grid--extras");
      extras.forEach((item) => grid.append(renderRecommendationCard(item, false)));
      section.append(grid);
      body.append(section);
    }
    disclosure.append(body);
  });
  return disclosure;
}

function renderRecommendationCard(item, isRestaurant) {
  const card = element("article", "recommendation-card");
  const media = renderRecommendationPhoto(item);
  if (media) card.append(media);
  const categories = isRestaurant
    ? ["restaurant"]
    : (Array.isArray(item.categories) && item.categories.length ? item.categories : [item.category]).filter(Boolean);
  let categoryLabel = categories
    .map((category) => `${recommendationIcon(category)} ${recommendationCategory(category)}`)
    .join(" · ");
  if (item.categoryLabel) categoryLabel = `${categoryLabel} · ${item.categoryLabel}`;
  card.append(
    textElement("p", "recommendation-card__category", categoryLabel),
    textElement("h4", "recommendation-card__title", item.name),
    linkedTextElement(document, "p", "recommendation-card__description", item.description || "")
  );

  const ratings = element("div", "recommendation-ratings");
  if (item.tabelogRating) ratings.append(textElement("span", "rating-chip rating-chip--tabelog", `食べログ ${item.tabelogRating}`));
  if (item.googleRating) ratings.append(textElement("span", "rating-chip", `Google ${item.googleRating}`));
  if (item.reviewCount) ratings.append(textElement("span", "muted", ui(currentLanguage, "reviewCount", { count: item.reviewCount })));
  if (ratings.childNodes.length) card.append(ratings);

  const links = element("div", "resource-links");
  const mapsUrl = normalizeGoogleMapsUrl(item.mapsUrl);
  if (mapsUrl) links.append(externalAnchor(ui(currentLanguage, "openGoogleMaps"), mapsUrl));
  if (item.tabelogUrl) links.append(externalAnchor(ui(currentLanguage, "openTabelog"), item.tabelogUrl));
  if (item.sourceUrl && !item.tabelogUrl) links.append(externalAnchor(ui(currentLanguage, "officialDetails"), item.sourceUrl));
  if (links.childNodes.length) card.append(links);
  return card;
}

function renderRecommendationPhoto(item) {
  const photoRecord = item?.photo;
  const photoUrl = typeof photoRecord === "string" ? photoRecord : photoRecord?.url;
  if (!photoUrl) return null;

  const media = element("div", "recommendation-card__media");
  const fallback = textElement("span", "recommendation-card__photo-fallback", item.name);
  fallback.setAttribute("aria-hidden", "true");
  media.append(fallback);

  const image = document.createElement("img");
  image.src = optimizedPhotoUrl(photoUrl);
  image.alt = ui(currentLanguage, "representativePhoto", { name: item.name });
  image.loading = "lazy";
  image.decoding = "async";
  image.fetchPriority = "low";
  if (photoRecord?.position) image.style.objectPosition = photoRecord.position;
  image.addEventListener("error", () => image.remove());
  media.append(image);

  return media;
}

function recommendationCategory(category) {
  return ui(currentLanguage, ({
    restaurant: "categoryRestaurant",
    eat: "categoryEat",
    snack: "categorySnack",
    do: "categoryDo",
    see: "categorySee",
    buy: "categoryBuy",
    go: "categoryGo"
  })[category] || "nearbyIdeas");
}

function recommendationIcon(category) {
  return ({ restaurant: "🍽️", eat: "🥢", snack: "🍡", do: "🎟️", see: "👀", buy: "🛍️", go: "📍" })[category] || "✦";
}

function renderTips() {
  els.tips.replaceChildren(...(displayTrip.tips || []).map((tip) => textElement("li", "", tip)));
}

function renderCredits() {
  const day = displayTrip.days.find((candidate) => candidate.id === activeDayId);
  const credits = new Map();
  const addPhotoCredit = (record, name) => {
    if (!record?.sourceUrl || !record?.credit || /\b(?:CC0|public domain)\b/i.test(record.credit)) return;
    if (!credits.has(record.sourceUrl)) credits.set(record.sourceUrl, `${name} — ${record.credit}`);
  };

  orderedDaySlots(day).forEach((slot) => {
    addPhotoCredit(getPlacePhoto(slot.photoSourceId || slot.id), timelineSlotName(slot));
  });

  const guide = day ? getDayGuide(day.id, currentLanguage) : null;
  [...(guide?.restaurants || []), ...(guide?.extras || [])].forEach((item) => {
    if (item?.photo && typeof item.photo === "object") addPhotoCredit(item.photo, item.name);
  });

  const placeCredit = orderedDaySlots(day).some((slot) => readSavedPlace(slot.place))
    ? [externalAnchor(pickerText(currentLanguage, "placeDataCredit"), OSM_COPYRIGHT_URL, "footer-credit-link")]
    : [];
  els.credits.replaceChildren(
    externalAnchor(ui(currentLanguage, "weatherDataBy"), "https://open-meteo.com/en/license", "footer-credit-link"),
    ...placeCredit,
    ...[...credits].map(([url, label]) => externalAnchor(label, url, "footer-credit-link"))
  );
  els.credits.closest("details").hidden = false;
}

function renderMap(attempt = 0) {
  if (!window.L || typeof initTravelMap !== "function") {
    if (attempt < 20) {
      setTimeout(() => renderMap(attempt + 1), 250);
    } else {
      els.mapOffline.textContent = ui(currentLanguage, "mapLoadError");
      els.mapOffline.hidden = false;
    }
    return;
  }

  const dayIndex = displayTrip.days.findIndex((day) => day.id === activeDayId);
  const day = displayTrip.days[dayIndex] || displayTrip.days[0];
  const points = orderedDaySlots(day)
    .map((slot, timelineIndex) => ({
      id: slot.id,
      number: timelineIndex + 1,
      lat: slot.lat,
      lng: slot.lng,
      name: timelineSlotName(slot),
      time: slot.time,
      routeGroup: slot.routeGroup || "shared-route",
      mapLocationOmitted: slot.mapLocationOmitted,
      googleMapsUrl: googleMapsUrl(slot, { allowSearchFallback: false })
    }))
    .filter((point) => !point.mapLocationOmitted && Number.isFinite(point.lat) && Number.isFinite(point.lng));
  currentMapPoints = points;

  els.mapTitle.textContent = day ? getDayArea(day.id, currentLanguage) : ui(currentLanguage, "route");
  els.mapDayLabel.textContent = day
    ? `${ui(currentLanguage, "dayShort", { number: Math.max(1, dayIndex + 1) })} · ${formatDate(day.date, { weekday: "short", month: "short", day: "numeric" })}`
    : ui(currentLanguage, "activeDayRoute");

  const container = document.getElementById("map");
  if (!container.clientWidth || !container.clientHeight) {
    mapGeometryKey = "";
    return;
  }
  const nextContentKey = JSON.stringify([currentLanguage, points]);
  const nextGeometryKey = JSON.stringify([day?.id, isItinerarySheetActive(), points.map(({ lat, lng }) => [lat, lng])]);
  const needsFrame = nextGeometryKey !== mapGeometryKey;
  if (!mapInstance || nextContentKey !== mapContentKey) {
    mapInstance = initTravelMap("map", points, {
      existingMap: mapInstance,
      deferFrame: true,
      googleMapsLabel: ui(currentLanguage, "openGoogleMaps"),
      zoomInTitle: ui(currentLanguage, "zoomIn"),
      zoomOutTitle: ui(currentLanguage, "zoomOut"),
      onPointClick: handleMapPointClick,
      fitBoundsOptions: mapFitBoundsOptions(false),
      singlePointZoom: document.documentElement.classList.contains("is-itinerary-view") ? 11 : 12
    });
    mapContentKey = nextContentKey;
  }
  if (selectedMapSlotId && !points.some((point) => point.id === selectedMapSlotId)) setMapSelection("");
  else applyMarkerSelection();
  if (needsFrame) {
    mapGeometryKey = nextGeometryKey;
    requestAnimationFrame(() => {
      mapInstance?.invalidateSize({ pan: false });
      frameMapToPoints(currentMapPoints, false);
    });
  }
  els.mapOffline.hidden = navigator.onLine;
}

function handleMapPointClick(point) {
  if (!point?.id) return;
  const item = [...els.days.querySelectorAll(".timeline-item")]
    .find((candidate) => candidate.dataset.slotId === point.id);
  if (!item) return;
  setMapSelection(point.id);
  const card = item.querySelector(".timeline-card");
  if (card) card.open = true;
  if (document.documentElement.classList.contains("is-itinerary-view")) {
    const panelRect = els.itineraryPanel.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const target = Math.max(0, els.itineraryPanel.scrollTop + itemRect.top - panelRect.top - 12);
    els.itineraryPanel.scrollTo({ top: target, behavior: "smooth" });
  } else {
    item.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

function isItineraryViewRequested() {
  try {
    return new URL(window.location.href).searchParams.get("view") === "plan";
  } catch {
    return false;
  }
}

function syncItineraryViewClass() {
  const active = itineraryViewMedia.matches && isItineraryViewRequested();
  document.documentElement.classList.toggle("is-itinerary-view", active);
  document.body.classList.toggle("is-itinerary-view", active);
  if (!active) {
    document.documentElement.classList.remove("is-sheet-dragging");
    itinerarySheetDrag = null;
  }
  return active;
}

function closeItineraryView() {
  if (window.history.state?.itineraryView) {
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("view");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  syncItineraryViewClass();
  requestAnimationFrame(() => renderMap());
}

function syncMobileFooterPlacement() {
  if (!els.mobileFooterTools || !els.mobileFooterUpdated) return;
  if (mobileFooterMedia.matches) {
    if (els.headerActions.parentElement !== els.mobileFooterTools) els.mobileFooterTools.append(els.headerActions);
    if (els.tipsSection.parentElement !== els.mobileFooterTools) els.mobileFooterTools.append(els.tipsSection);
    if (els.status.parentElement !== els.mobileFooterUpdated) els.mobileFooterUpdated.append(els.status);
    return;
  }
  if (els.status.parentElement !== els.headerActions) {
    els.headerActions.querySelector(".language-control")?.after(els.status);
  }
  if (els.headerActions.parentElement !== els.headerActionsHome) els.headerActionsHome.append(els.headerActions);
  if (els.tipsSection.parentElement !== els.pageShell) els.pageShell.append(els.tipsSection);
}

function setupInteractionHandlers() {
  document.documentElement.classList.toggle("is-standalone", isStandaloneApp());
  document.documentElement.classList.toggle("is-ios", isIosDevice());
  syncStandaloneCanvasMetrics();
  setupItinerarySheetInteractions();
  els.language.value = currentLanguage;
  els.planLanguage.value = currentLanguage;
  els.language.addEventListener("change", () => switchLanguage(els.language.value));
  els.planLanguage.addEventListener("change", () => switchLanguage(els.planLanguage.value));
  els.openPlanView.addEventListener("click", (event) => {
    if (!itineraryViewMedia.matches) return;
    // Ctrl/Meta/Shift/Alt-click, non-primary buttons and clicks another handler already cancelled
    // belong to the browser (new tab/window, download, etc.); only a plain primary activation
    // (mouse click, tap, or Enter) switches this page into the planner in place.
    if (event.defaultPrevented || !isPlainPrimaryActivation(event)) return;
    event.preventDefault();
    const url = new URL(window.location.href);
    const day = currentTrip.days.find((candidate) => candidate.id === activeDayId);
    url.searchParams.set("view", "plan");
    if (day?.date) url.searchParams.set("day", day.date);
    window.history.pushState({ ...(window.history.state || {}), itineraryView: true }, "", `${url.pathname}${url.search}${url.hash}`);
    syncItineraryViewClass();
    requestAnimationFrame(() => {
      syncItinerarySheetPosition({ reframe: false });
      renderMap();
      els.itineraryPanel.scrollTop = 0;
    });
  });
  els.closePlanView.addEventListener("click", closeItineraryView);
  window.addEventListener("popstate", () => {
    syncItineraryViewClass();
    requestAnimationFrame(() => {
      syncItinerarySheetPosition({ reframe: false });
      renderMap();
    });
  });
  itineraryViewMedia.addEventListener("change", () => {
    syncItineraryViewClass();
    requestAnimationFrame(() => {
      syncItinerarySheetPosition({ reframe: false });
      renderMap();
    });
  });
  mobileFooterMedia.addEventListener("change", syncMobileFooterPlacement);
  const refreshMapGeometry = () => {
    clearTimeout(mapResizeTimer);
    mapResizeTimer = setTimeout(() => requestAnimationFrame(() => {
      syncItinerarySheetPosition({ reframe: false });
      mapGeometryKey = "";
      renderMap();
    }), 120);
  };
  window.addEventListener("orientationchange", () => {
    requestAnimationFrame(() => {
      syncStandaloneCanvasMetrics();
      syncItinerarySheetPosition({ reframe: false });
      renderMap();
    });
    setTimeout(() => {
      syncStandaloneCanvasMetrics();
      syncItinerarySheetPosition();
    }, 250);
  });
  window.addEventListener("pageshow", () => {
    syncStandaloneCanvasMetrics();
    syncItinerarySheetPosition();
  });
  window.visualViewport?.addEventListener("resize", refreshMapGeometry);
  window.addEventListener("resize", refreshMapGeometry);
  window.addEventListener("storage", (event) => {
    if (event.key === languageStorageKey() && event.newValue && event.newValue !== currentLanguage) {
      switchLanguage(event.newValue, false);
    }
  });

  window.addEventListener("online", () => {
    els.mapOffline.hidden = true;
    setSyncStatus(syncReady && !currentSourceIsCache ? "online" : "syncing", "working");
    refreshWeatherForecast({ force: false });
    if (HOSTED) hostedPoller?.retryNow();
  });
  window.addEventListener("offline", () => {
    syncReady = false;
    els.mapOffline.hidden = false;
    if (HOSTED) { hostedReady = false; setSyncStatus("offlineCopy", "offline"); }
    else setSyncStatus("savedOffline", "offline");
  });
  const refreshWeatherOnResume = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      refreshWeatherForecast({ force: false });
    }
  };
  document.addEventListener("visibilitychange", refreshWeatherOnResume);
  window.addEventListener("pageshow", refreshWeatherOnResume);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (!isStandaloneApp()) els.install.hidden = false;
  });
  els.install.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      els.install.hidden = true;
      return;
    }
    if (isIosDevice() && !isStandaloneApp()) els.installDialog.showModal();
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    els.install.hidden = true;
  });
  document.querySelectorAll("[data-close-install-dialog]").forEach((button) => {
    button.addEventListener("click", () => els.installDialog.close());
  });
  els.installDialog.addEventListener("click", (event) => {
    if (event.target === els.installDialog) els.installDialog.close();
  });

  if (isIosDevice() && !isStandaloneApp()) {
    els.install.dataset.installMethod = "ios";
    els.install.hidden = false;
  } else if (isStandaloneApp()) {
    els.install.hidden = true;
  }

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => els.dialog.close());
  });
  document.querySelectorAll("[data-close-todo-dialog]").forEach((button) => {
    button.addEventListener("click", () => els.todoDialog.close());
  });
  document.querySelectorAll("[data-close-weather-dialog]").forEach((button) => {
    button.addEventListener("click", closeWeatherDialog);
  });
  els.addReminder.addEventListener("click", () => openTodoDialog());
  const googleMapsInput = els.form.elements.googleMapsUrl;
  googleMapsInput.addEventListener("input", () => {
    updateGoogleMapsLinkState();
    handleGoogleMapsInputForLookup();
  });
  googleMapsInput.addEventListener("blur", () => updateGoogleMapsLinkState({ showError: true }));
  googleMapsInput.addEventListener("invalid", () => updateGoogleMapsLinkState({ showError: true }));
  els.form.addEventListener("submit", handleItemSubmit);
  els.deleteItem.addEventListener("click", handleItemDelete);
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close();
  });
  // Cancelling or closing the editor discards unsaved place/photo choices and
  // makes any late lookup response irrelevant.
  els.dialog.addEventListener("close", endEditorSession);
  els.todoForm.addEventListener("submit", handleTodoSubmit);
  els.deleteReminder.addEventListener("click", handleTodoDelete);
  els.todoDialog.addEventListener("click", (event) => {
    if (event.target === els.todoDialog) els.todoDialog.close();
  });
  els.weatherDialog.addEventListener("click", (event) => {
    if (event.target === els.weatherDialog) closeWeatherDialog();
  });
  els.weatherDialog.addEventListener("close", () => {
    const returnDayId = weatherDialogReturnDayId;
    // Closing the dialog (or the day disappearing) discards an unsaved forecast-place edit.
    closeWeatherEditor();
    weatherEditorNotice = "";
    weatherDialogDayId = "";
    weatherDialogLocationId = "";
    weatherDialogReturnDayId = "";
    requestAnimationFrame(() => {
      [...document.querySelectorAll(".weather-detail-trigger")]
        .find((candidate) => candidate.dataset.weatherDayId === returnDayId)
        ?.focus({ preventScroll: true });
    });
  });
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

function syncStandaloneCanvasMetrics() {
  const extensionProperty = "--standalone-canvas-extension";
  const heightProperty = "--standalone-canvas-height";
  const root = document.documentElement;
  if (!isStandaloneApp()) {
    root.style.removeProperty(extensionProperty);
    root.style.removeProperty(heightProperty);
    return;
  }

  const screenWidth = Number(window.screen?.width);
  const screenHeight = Number(window.screen?.height);
  const portrait = window.matchMedia("(orientation: portrait)").matches;
  const screenCanvasHeight = Number.isFinite(screenWidth) && Number.isFinite(screenHeight)
    ? (portrait ? Math.max(screenWidth, screenHeight) : Math.min(screenWidth, screenHeight))
    : 0;
  const viewportHeights = [
    Number(window.innerHeight),
    Number(window.visualViewport?.height),
    Number(document.documentElement.clientHeight)
  ].filter((value) => Number.isFinite(value) && value > 0);
  const fixedViewportHeight = Math.min(...viewportHeights);
  const fullCanvasHeight = [
    fixedViewportHeight,
    screenCanvasHeight,
    Number(window.innerHeight),
    Number(window.outerHeight)
  ]
    .filter((value) => Number.isFinite(value)
      && value >= fixedViewportHeight
      && value - fixedViewportHeight <= 120)
    .reduce((largest, value) => Math.max(largest, value), fixedViewportHeight);
  const missingCanvas = Math.round(fullCanvasHeight - fixedViewportHeight);
  const extension = Math.min(120, Math.max(0, missingCanvas));
  const canvasHeight = Math.round(fixedViewportHeight + extension);

  if (extension >= 2) {
    root.style.setProperty(heightProperty, `${canvasHeight}px`);
    root.style.setProperty(extensionProperty, `${extension}px`);
  } else {
    root.style.removeProperty(heightProperty);
    root.style.removeProperty(extensionProperty);
  }
}

function openTodoDialog(reminderId = "") {
  if (HOSTED_READ_ONLY) return;
  if (HOSTED) els.todoForm.dataset.hostedVersion = String(hostedServerTrip.version);
  const reminder = currentTrip.reminders.find((candidate) => candidate.id === reminderId);
  const displayReminder = displayTrip.reminders.find((candidate) => candidate.id === reminderId);
  const itemInput = els.todoForm.elements.namedItem("item");
  els.todoForm.reset();
  els.todoForm.elements.reminderId.value = reminderId;
  els.todoDialogTitle.textContent = ui(currentLanguage, reminder ? "editTodo" : "addTodo");
  els.deleteReminder.hidden = !reminder;
  els.todoForm.elements.dueDate.removeAttribute("max");

  if (reminder) {
    itemInput.value = displayReminder?.item || reminder.item || "";
    els.todoForm.elements.dueDate.value = reminderDeadline(reminder);
  } else {
    els.todoForm.elements.dueDate.value = todayISO();
  }

  els.todoDialog.showModal();
  focusDialogFieldOnDesktop(itemInput);
}

async function handleTodoSubmit(event) {
  event.preventDefault();
  const data = new FormData(els.todoForm);
  const reminderId = String(data.get("reminderId") || "");
  const submittedItem = String(data.get("item") || "").trim();
  const dueDate = String(data.get("dueDate") || "");
  if (!submittedItem || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
  const canonicalExisting = currentTrip.reminders.find((candidate) => candidate.id === reminderId);
  const displayExisting = displayTrip.reminders.find((candidate) => candidate.id === reminderId);
  const itemUnchanged = Boolean(canonicalExisting) && submittedItem === String(displayExisting?.item ?? "").trim();
  const item = itemUnchanged ? canonicalExisting.item : submittedItem;
  const newReminderId = reminderId || uid("reminder");

  const saved = await mutateTrip((trip) => {
    if (!Array.isArray(trip.reminders)) trip.reminders = [];
    const existing = trip.reminders.find((candidate) => candidate.id === reminderId);
    const next = {
      id: newReminderId,
      item,
      dueDate,
      done: existing?.done || false
    };
    if (existing) {
      Object.assign(existing, next);
      delete existing.leadDays;
      // An edited to-do must not keep showing its old translation.
      if (!itemUnchanged) invalidateTranslations(existing, ["item"]);
    } else {
      trip.reminders.push(next);
    }
  }, reminderId ? "todoUpdated" : "todoAdded");
  if (saved) els.todoDialog.close();
}

async function handleTodoDelete() {
  const reminderId = els.todoForm.elements.reminderId.value;
  const reminder = displayTrip.reminders.find((candidate) => candidate.id === reminderId);
  if (!reminderId || !window.confirm(ui(currentLanguage, "deleteConfirm", { item: reminder?.item || ui(currentLanguage, "todoItem") }))) return;
  const saved = await mutateTrip((trip) => {
    trip.reminders = (Array.isArray(trip.reminders) ? trip.reminders : []).filter((candidate) => candidate.id !== reminderId);
  }, "todoDeleted");
  if (saved) els.todoDialog.close();
}

function reminderDeadline(reminder) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(reminder?.dueDate || ""))) return reminder.dueDate;
  const deadline = new Date(`${currentTrip.startDate}T00:00:00Z`);
  deadline.setUTCDate(deadline.getUTCDate() - Number(reminder?.leadDays || 0));
  return deadline.toISOString().slice(0, 10);
}

let relatedLinksEditor = null;
function openItemDialog(dayId, slotId = "") {
  if (HOSTED_READ_ONLY) return;
  if (HOSTED) els.form.dataset.hostedVersion = String(hostedServerTrip.version);
  const day = currentTrip.days.find((candidate) => candidate.id === dayId);
  const slot = day?.slots.find((candidate) => candidate.id === slotId);
  if (!day) return;

  els.form.reset();
  populateTimeOptions(slot?.time || "");
  els.form.elements.dayId.value = dayId;
  els.form.elements.slotId.value = slotId;
  els.dialogTitle.textContent = ui(currentLanguage, slot ? "editPlan" : "addPlan");
  els.deleteItem.hidden = !slot;
  els.form.elements.planType.value = slot ? normalizePlanType(slot.planType, slot) : "sight";
  els.form.elements.booked.value = String(slot?.booked === true || slot?.booked === "true");

  const googleMapsInput = els.form.elements.googleMapsUrl;
  const storedMapsUrl = String(slot?.googleMapsUrl || slot?.mapsUrl || "").trim();
  const storedMapsPlace = parseFullGoogleMapsPlaceUrl(storedMapsUrl);
  const canPreserveLegacyLocation = Boolean(
    slot
    && !storedMapsPlace.ok
    && Number.isFinite(slot.lat)
    && Number.isFinite(slot.lng)
  );
  googleMapsInput.required = false;
  googleMapsInput.dataset.preserveLegacyLocation = String(canPreserveLegacyLocation);
  googleMapsInput.value = storedMapsPlace.ok ? storedMapsPlace.url : "";

  // Show the text in the language being viewed. Unchanged fields keep their
  // source value and translations; edited fields replace the source and drop
  // the now-stale translations so every language falls back to the new text.
  const displaySlot = slot
    ? displayTrip.days.find((candidate) => candidate.id === dayId)?.slots?.find((candidate) => candidate.id === slotId)
    : null;
  const initialName = String(displaySlot?.name ?? slot?.name ?? "");
  const initialReview = String(displaySlot?.review ?? slot?.review ?? "");
  els.form.dataset.initialName = initialName;
  els.form.dataset.initialReview = initialReview;
  if (slot) {
    els.form.elements.name.value = initialName;
    els.form.elements.period.value = slot.period || "morning";
    els.form.elements.time.value = slot.time || "";
    els.form.elements.review.value = initialReview;
  }

  updateGoogleMapsLinkState();
  // Shows any saved place/photo from trip data only; nothing is looked up here.
  startEditorSession(dayId, slotId, slot);
  relatedLinksEditor = createRelatedLinksEditor({ doc: document,
    container: document.getElementById("related-links-editor"), links: slot?.relatedLinks || [],
    language: currentLanguage, makeId: () => uid("link") });
  els.dialog.showModal();
  focusDialogFieldOnDesktop(els.form.elements.name);
}

function populateTimeOptions(selectedValue = "") {
  const select = els.form?.elements?.time;
  if (!select) return;
  const value = String(selectedValue || "").trim();
  const standardTimes = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mins = String(minutes % 60).padStart(2, "0");
    standardTimes.push(`${hours}:${mins}`);
  }

  const options = [];
  const flexible = document.createElement("option");
  flexible.value = "";
  flexible.textContent = ui(currentLanguage, "flexible");
  options.push(flexible);

  if (value && !standardTimes.includes(value)) {
    const existing = document.createElement("option");
    existing.value = value;
    existing.textContent = value;
    options.push(existing);
  }

  standardTimes.forEach((time) => {
    const option = document.createElement("option");
    option.value = time;
    option.textContent = time;
    options.push(option);
  });
  select.replaceChildren(...options);
  select.value = value;
}

function updateGoogleMapsLinkState({ showError = false, report = false } = {}) {
  const input = els.form.elements.googleMapsUrl;
  const parsed = parseFullGoogleMapsPlaceUrl(input.value);
  input.setCustomValidity("");
  input.removeAttribute("aria-invalid");
  els.googleMapsLinkError.hidden = true;
  els.googleMapsLinkError.textContent = "";
  els.googleMapsLinkPreview.hidden = true;
  els.googleMapsPlaceLabel.textContent = "";
  els.googleMapsPlaceCoordinates.textContent = "";

  if (parsed.ok) {
    els.googleMapsPlaceLabel.textContent = parsed.placeLabel;
    els.googleMapsPlaceCoordinates.textContent = `${coordinateLabel(parsed.lat)}, ${coordinateLabel(parsed.lng)}`;
    els.googleMapsLinkPreview.hidden = false;
    return parsed;
  }

  if (showError && (input.required || input.value.trim())) {
    const message = ui(currentLanguage, "googleMapsLinkInvalid");
    input.setCustomValidity(message);
    input.setAttribute("aria-invalid", "true");
    els.googleMapsLinkError.textContent = message;
    els.googleMapsLinkError.hidden = false;
    if (report) input.reportValidity();
  }
  return parsed;
}

function coordinateLabel(value) {
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

// ---------------------------------------------------------------------------
// Explicit place and photo matching (self-hosted editors only).
// No request is made while rendering, opening the editor, typing or saving
// unrelated fields: only the Search and Refresh results controls call the server.

const GOOGLE_LOCATION_KEYS = Object.freeze([
  "googleMapsUrl", "mapsUrl", "googleMapsPlaceName", "googleMapsPlaceLabel", "googleMapsFeatureId"
]);
const ALL_LOCATION_KEYS = Object.freeze([
  ...GOOGLE_LOCATION_KEYS, "address", "lat", "lng", "approximateLocation", "place", "mapLocationOmitted"
]);

function pickerNode(tag, className, key) {
  const node = textElement(tag, className, pickerText(currentLanguage, key));
  node.dataset.pickerText = key;
  return node;
}

function ensureLookupPanels() {
  let placePanel = document.getElementById("place-lookup");
  let photoPanel = document.getElementById("photo-lookup");
  if (!placePanel) {
    placePanel = buildLookupPanel("place");
    els.form.elements.googleMapsUrl.closest("label").before(placePanel);
  }
  if (!photoPanel) {
    photoPanel = buildLookupPanel("photo");
    els.form.elements.review.closest("label").after(photoPanel);
  }
  return { place: placePanel, photo: photoPanel };
}

function buildLookupPanel(kind) {
  const prefix = kind === "place" ? "place" : "photo";
  const panel = element("section", `lookup-panel lookup-panel--${kind}`);
  panel.id = `${kind}-lookup`;
  panel.dataset.lookupKind = kind;
  const title = pickerNode("h3", "lookup-panel__title", `${prefix}SectionTitle`);
  title.id = `${kind}-lookup-title`;
  panel.setAttribute("aria-labelledby", title.id);
  const hint = pickerNode("p", "form-hint lookup-panel__hint", `${prefix}SectionHint`);
  const current = element("div", "lookup-current");
  current.dataset.lookupCurrent = kind;

  const search = element("div", "lookup-search");
  const input = document.createElement("input");
  input.type = "search";
  input.id = `${kind}-lookup-query`;
  input.className = "lookup-search__input";
  input.maxLength = 200;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.setAttribute("enterkeyhint", "search");
  input.dataset.pickerPlaceholder = `${prefix}SearchPlaceholder`;
  input.placeholder = pickerText(currentLanguage, `${prefix}SearchPlaceholder`);
  const label = pickerNode("label", "lookup-search__label", `${prefix}SearchLabel`);
  label.htmlFor = input.id;
  const privacy = pickerNode("p", "lookup-privacy", `${prefix}PrivacyNote`);
  privacy.id = `${kind}-lookup-privacy`;
  input.setAttribute("aria-describedby", privacy.id);
  const searchButton = pickerNode("button", "button button--small lookup-search__button", "search");
  searchButton.type = "button";
  searchButton.dataset.lookupAction = "search";
  const refreshButton = pickerNode("button", "button button--quiet button--small lookup-search__button", "refreshResults");
  refreshButton.type = "button";
  refreshButton.dataset.lookupAction = "refresh";
  refreshButton.hidden = true;
  const row = element("div", "lookup-search__row");
  row.append(input, searchButton, refreshButton);
  search.append(label, privacy, row);

  const status = element("p", "lookup-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.dataset.lookupStatus = kind;
  const results = element("ul", `lookup-results lookup-results--${kind}`);
  results.dataset.lookupResults = kind;
  results.setAttribute("aria-labelledby", title.id);
  panel.append(title, hint, current, search, status, results);
  if (kind === "place") panel.append(pickerNode("p", "form-hint lookup-panel__or", "orPasteGoogle"));

  // Enter in the search box is an explicit search; it never submits the plan.
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!event.isComposing) runLookup(kind, "search");
  });
  searchButton.addEventListener("click", () => runLookup(kind, "search"));
  refreshButton.addEventListener("click", () => runLookup(kind, "refresh"));
  return panel;
}

function lookupParts(session, kind) {
  const panel = session.panels[kind];
  return {
    panel,
    input: panel.querySelector(".lookup-search__input"),
    search: panel.querySelector('[data-lookup-action="search"]'),
    refresh: panel.querySelector('[data-lookup-action="refresh"]'),
    status: panel.querySelector(".lookup-status"),
    results: panel.querySelector(".lookup-results"),
    current: panel.querySelector(".lookup-current")
  };
}

function startEditorSession(dayId, slotId, slot) {
  endEditorSession();
  if (!LOOKUP_ENABLED) return;
  const panels = ensureLookupPanels();
  // The language can change while the dialog is closed and its panels are retained.
  refreshLookupLanguage();
  const originalPhoto = slot
    ? (slot.photo || getPlacePhoto(slot.photoSourceId || slot.id) || null)
    : null;
  const session = {
    tripId: HOSTED_TRIP_ID,
    dayId,
    slotId,
    revision: 0,
    language: currentLanguage,
    panels,
    renderedResults: { place: null, photo: null },
    original: {
      place: readSavedPlace(slot?.place),
      lat: slot?.lat,
      lng: slot?.lng,
      label: String(slot?.address || slot?.googleMapsPlaceLabel || "").trim(),
      photo: originalPhoto,
      photoName: String(slot?.name || "")
    },
    location: { mode: "unchanged", place: null },
    photo: { mode: "unchanged", photo: null, preview: null }
  };
  session.google = createGoogleEditorState(slotId ? (canonicalPlan(slotId) || slot) : null);
  session.lookups = {
    place: createLookupController({
      request: (query, refresh) => hostedApi.searchPlaces(session.tripId, query, refresh),
      normalize: normalizePlaceCandidate,
      onChange: () => { if (editorSession === session) renderLookup(session, "place"); }
    }),
    photo: createLookupController({
      request: (query, refresh) => hostedApi.searchPhotos(session.tripId, query, refresh),
      normalize: normalizePhotoCandidate,
      onChange: () => { if (editorSession === session) renderLookup(session, "photo"); }
    })
  };
  editorSession = session;
  ["place", "photo"].forEach((kind) => {
    const parts = lookupParts(session, kind);
    parts.input.value = "";
    parts.input.disabled = false;
    parts.results.replaceChildren();
    parts.status.textContent = "";
    delete parts.status.dataset.error;
    renderLookup(session, kind);
  });
}

function endEditorSession() {
  const session = editorSession;
  if (!session) return;
  editorSession = null;
  session.lookups?.place.dispose();
  session.lookups?.photo.dispose();
  // Cancel or close: any pending Google search, preview or choice is discarded and its late events
  // are ignored. Nothing is saved.
  endGoogleEditorState(session);
  ["place", "photo"].forEach((kind) => {
    const parts = lookupParts(session, kind);
    parts.results.replaceChildren();
    parts.status.textContent = "";
    parts.current.replaceChildren();
    parts.panel.removeAttribute("aria-busy");
  });
}

async function runLookup(kind, action) {
  const session = editorSession;
  if (!session || !LOOKUP_ENABLED || !els.dialog.open) return;
  const lookup = session.lookups[kind];
  const { input } = lookupParts(session, kind);
  if (action === "refresh") await lookup.refresh();
  else await lookup.search(input.value);
  if (editorSession !== session) return;
  if (lookup.state.error?.status === 401) leaveForSignIn();
}

function renderLookup(session, kind, { forceResults = false } = {}) {
  const parts = lookupParts(session, kind);
  const { state } = session.lookups[kind];
  const loading = state.status === "loading";
  if (loading) parts.panel.setAttribute("aria-busy", "true");
  else parts.panel.removeAttribute("aria-busy");
  parts.input.disabled = state.forbidden;
  parts.search.disabled = loading || state.forbidden;
  parts.refresh.hidden = !state.lastQuery;
  parts.refresh.disabled = loading || state.forbidden;

  let message = "";
  let isError = false;
  if (loading) message = pickerText(currentLanguage, "searching");
  else if (state.status === "error") {
    isError = true;
    message = pickerText(currentLanguage, state.errorKey || "lookupFailed");
    if (state.errorDetail && state.errorDetail !== message) message = `${message} (${state.errorDetail})`;
  } else if (state.status === "done") {
    message = state.results.length
      ? pickerText(currentLanguage, kind === "place" ? "placeResultsCount" : "photoResultsCount", { count: state.results.length })
      : pickerText(currentLanguage, kind === "place" ? "placeNoResults" : "photoNoResults");
    if (state.cached && state.results.length) message = `${message} ${pickerText(currentLanguage, "cachedResults")}`;
  }
  const chosenNote = kind === "place"
    ? (session.location.mode === "place" ? pickerText(currentLanguage, "placeSelectedPending") : "")
    : (session.photo.mode === "photo" ? pickerText(currentLanguage, "photoSelectedPending") : "");
  if (!loading && !isError && state.status !== "done" && chosenNote) message = chosenNote;
  parts.status.textContent = message;
  if (isError) parts.status.dataset.error = "true";
  else delete parts.status.dataset.error;

  if (forceResults || session.renderedResults[kind] !== state.results) {
    session.renderedResults[kind] = state.results;
    parts.results.replaceChildren(...state.results.map((candidate) => (
      kind === "place" ? renderPlaceResult(session, candidate) : renderPhotoResult(session, candidate)
    )));
  }
  markChosenResults(session, kind);
  renderLookupCurrent(session, kind);
}

function renderPlaceResult(session, candidate) {
  const item = element("li", "lookup-result lookup-result--place");
  item.dataset.candidateId = candidate.id;
  const copy = element("div", "lookup-result__copy");
  copy.append(textElement("strong", "lookup-result__name", candidate.name));
  if (candidate.address && candidate.address !== candidate.name) copy.append(textElement("span", "lookup-result__address", candidate.address));
  copy.append(textElement("span", "lookup-result__coordinates muted", `${pickerText(currentLanguage, "coordinatesLabel")}: ${formatCoordinate(candidate.lat)}, ${formatCoordinate(candidate.lng)}`));
  const source = element("span", "lookup-result__source");
  source.append(
    externalAnchor(pickerText(currentLanguage, "viewOnOpenStreetMap"), candidate.sourceUrl, "lookup-result__link"),
    textElement("span", "lookup-result__attribution", ` · ${candidate.attribution} · ${candidate.license}`)
  );
  copy.append(source);
  const choose = textElement("button", "button button--quiet button--small lookup-result__choose", pickerText(currentLanguage, "useThisPlace"));
  choose.type = "button";
  choose.setAttribute("aria-pressed", "false");
  choose.setAttribute("aria-label", `${pickerText(currentLanguage, "useThisPlace")}: ${candidate.name}`);
  choose.addEventListener("click", () => choosePlace(session, candidate));
  item.append(copy, choose);
  return item;
}

function renderPhotoResult(session, candidate) {
  const item = element("li", "lookup-result lookup-result--photo");
  item.dataset.candidateUrl = candidate.url;
  const name = candidate.title || session.original.photoName || pickerText(currentLanguage, "representativePhotoLabel");
  item.append(lookupThumbnail(candidate.thumbnailUrl || optimizedPhotoUrl(candidate.url), name));
  const copy = element("div", "lookup-result__copy");
  if (candidate.title) copy.append(textElement("strong", "lookup-result__name", candidate.title));
  copy.append(photoCreditLine(candidate, "photo-credit lookup-result__credit"));
  const choose = textElement("button", "button button--quiet button--small lookup-result__choose", pickerText(currentLanguage, "useThisPhoto"));
  choose.type = "button";
  choose.setAttribute("aria-pressed", "false");
  choose.setAttribute("aria-label", `${pickerText(currentLanguage, "useThisPhoto")}: ${name}`);
  choose.addEventListener("click", () => choosePhoto(session, candidate));
  item.append(copy, choose);
  return item;
}

// Bounded, lazily loaded preview. A failed image shows a text fallback; it never
// triggers another search or a retry.
function lookupThumbnail(url, name) {
  const frame = element("span", "lookup-thumb");
  const fallback = textElement("span", "lookup-thumb__fallback", pickerText(currentLanguage, "previewUnavailable"));
  frame.append(fallback);
  if (!url) return frame;
  fallback.hidden = true;
  const image = document.createElement("img");
  image.alt = ui(currentLanguage, "representativePhoto", { name });
  image.setAttribute("loading", "lazy");
  image.setAttribute("decoding", "async");
  image.setAttribute("referrerpolicy", "no-referrer");
  image.width = 160;
  image.height = 120;
  image.addEventListener("error", () => {
    image.remove();
    fallback.hidden = false;
  }, { once: true });
  image.src = url;
  frame.append(image);
  return frame;
}

function markChosenResults(session, kind) {
  const { results } = lookupParts(session, kind);
  results.querySelectorAll(".lookup-result").forEach((item) => {
    const chosen = kind === "place"
      ? session.location.mode === "place" && session.location.place?.id === item.dataset.candidateId
      : session.photo.mode === "photo" && session.photo.photo?.url === item.dataset.candidateUrl;
    item.classList.toggle("is-chosen", chosen);
    const button = item.querySelector(".lookup-result__choose");
    if (!button) return;
    button.setAttribute("aria-pressed", String(chosen));
    button.textContent = pickerText(currentLanguage, chosen ? "chosen" : (kind === "place" ? "useThisPlace" : "useThisPhoto"));
  });
}

function choosePlace(session, candidate) {
  if (editorSession !== session || !els.dialog.open) return;
  const place = placeForSaving(candidate);
  if (!place) return;
  session.revision += 1;
  session.location = { mode: "place", place, revision: session.revision };
  // A chosen place replaces any Google Maps link for this plan.
  els.form.elements.googleMapsUrl.value = "";
  updateGoogleMapsLinkState();
  renderLookup(session, "place");
  lookupParts(session, "place").status.textContent = pickerText(currentLanguage, "placeSelectedPending");
}

function choosePhoto(session, candidate) {
  if (editorSession !== session || !els.dialog.open) return;
  const photo = photoForSaving(candidate);
  if (!photo) return;
  session.revision += 1;
  session.photo = { mode: "photo", photo, preview: candidate, revision: session.revision };
  renderLookup(session, "photo");
  lookupParts(session, "photo").status.textContent = pickerText(currentLanguage, "photoSelectedPending");
}

function clearChosenLocation(session) {
  if (editorSession !== session) return;
  session.revision += 1;
  session.location = { mode: "cleared", place: null, revision: session.revision };
  els.form.elements.googleMapsUrl.value = "";
  updateGoogleMapsLinkState();
  renderLookup(session, "place");
  lookupParts(session, "place").status.textContent = pickerText(currentLanguage, "locationCleared");
}

function clearChosenPhoto(session) {
  if (editorSession !== session) return;
  session.revision += 1;
  session.photo = { mode: "cleared", photo: null, preview: null, revision: session.revision };
  renderLookup(session, "photo");
  lookupParts(session, "photo").status.textContent = pickerText(currentLanguage, "photoRemoved");
}

function renderLookupCurrent(session, kind) {
  const { current } = lookupParts(session, kind);
  const box = element("div", "lookup-current__box");
  const actions = element("div", "lookup-current__actions");
  if (kind === "place") {
    const googleValue = els.form.elements.googleMapsUrl.value.trim();
    const { mode, place } = session.location;
    const original = session.original;
    const hasOriginalLocation = Number.isFinite(original.lat) && Number.isFinite(original.lng);
    if (googleValue) {
      box.append(textElement("p", "lookup-current__note", pickerText(currentLanguage, "usingGoogleLink")));
    } else if (mode === "place" && place) {
      box.append(placeSummary(place, pickerText(currentLanguage, "selectedPlace")));
    } else if (mode === "cleared") {
      box.append(textElement("p", "lookup-current__note", pickerText(currentLanguage, "locationCleared")));
    } else if (original.place) {
      box.append(placeSummary(original.place, pickerText(currentLanguage, "savedPlace")));
    } else if (hasOriginalLocation) {
      const summary = element("div", "lookup-summary");
      summary.append(textElement("span", "eyebrow", pickerText(currentLanguage, "currentLocation")));
      if (original.label) summary.append(textElement("strong", "lookup-summary__name", original.label));
      summary.append(textElement("span", "muted", `${pickerText(currentLanguage, "coordinatesLabel")}: ${formatCoordinate(original.lat)}, ${formatCoordinate(original.lng)}`));
      box.append(summary);
    } else {
      box.append(textElement("p", "lookup-current__note muted", pickerText(currentLanguage, "noLocation")));
    }
    const canClear = Boolean(googleValue) || mode === "place" || (mode === "unchanged" && (original.place || hasOriginalLocation));
    if (canClear) {
      const clear = textElement("button", "button button--quiet button--small lookup-current__clear", pickerText(currentLanguage, "clearLocation"));
      clear.type = "button";
      clear.addEventListener("click", () => clearChosenLocation(session));
      actions.append(clear);
    }
  } else {
    const { mode, photo, preview } = session.photo;
    const original = session.original;
    let shown = null;
    let heading = "";
    if (mode === "photo" && photo) {
      shown = preview || photo;
      heading = pickerText(currentLanguage, "selectedPhoto");
    } else if (mode === "unchanged" && original.photo) {
      shown = typeof original.photo === "string" ? { url: original.photo } : original.photo;
      heading = pickerText(currentLanguage, "currentPhoto");
    }
    if (shown?.url) {
      const summary = element("div", "lookup-summary lookup-summary--photo");
      summary.append(lookupThumbnail(shown.thumbnailUrl || optimizedPhotoUrl(shown.url), original.photoName || heading));
      const copy = element("div", "lookup-summary__copy");
      copy.append(textElement("span", "eyebrow", heading));
      const licensed = readSavedPhoto(shown) || normalizePhotoCandidate(shown);
      if (licensed) copy.append(photoCreditLine(licensed, "photo-credit"));
      else if (shown.credit) copy.append(textElement("span", "photo-credit", String(shown.credit)));
      summary.append(copy);
      box.append(summary);
      const remove = textElement("button", "button button--quiet button--small lookup-current__clear", pickerText(currentLanguage, "removePhoto"));
      remove.type = "button";
      remove.addEventListener("click", () => clearChosenPhoto(session));
      actions.append(remove);
    } else {
      box.append(textElement("p", "lookup-current__note muted", pickerText(currentLanguage, mode === "cleared" ? "photoRemoved" : "noPhoto")));
    }
  }
  if (actions.childNodes.length) box.append(actions);
  current.replaceChildren(box);
  // Every change to the pending location passes through here (choose, clear, paste a link).
  if (kind === "place") syncGoogleEditor(session);
}

function placeSummary(place, heading) {
  const summary = element("div", "lookup-summary");
  summary.append(
    textElement("span", "eyebrow", heading),
    textElement("strong", "lookup-summary__name", place.name)
  );
  if (place.address && place.address !== place.name) summary.append(textElement("span", "lookup-summary__address", place.address));
  summary.append(textElement("span", "muted", `${pickerText(currentLanguage, "coordinatesLabel")}: ${formatCoordinate(place.lat)}, ${formatCoordinate(place.lng)}`));
  const source = element("span", "lookup-summary__source");
  source.append(
    externalAnchor(pickerText(currentLanguage, "viewOnOpenStreetMap"), place.sourceUrl, "lookup-result__link"),
    textElement("span", "", ` · ${place.attribution} · ${place.license}`)
  );
  summary.append(source);
  return summary;
}

function refreshLookupLanguage() {
  document.querySelectorAll(".lookup-panel [data-picker-text]").forEach((node) => {
    node.textContent = pickerText(currentLanguage, node.dataset.pickerText);
  });
  document.querySelectorAll("#google-match [data-google-text]").forEach((node) => {
    node.textContent = googleText(currentLanguage, node.dataset.googleText);
  });
  document.querySelectorAll("#google-match [data-google-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", googleText(currentLanguage, node.dataset.googlePlaceholder));
  });
  if (editorSession?.google) renderGoogleEditor(editorSession);
  document.querySelectorAll(".lookup-panel [data-picker-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", pickerText(currentLanguage, node.dataset.pickerPlaceholder));
  });
  // A background trip refresh re-runs static translations; only an actual
  // language change rebuilds the result list.
  if (editorSession && editorSession.language !== currentLanguage) {
    editorSession.language = currentLanguage;
    ["place", "photo"].forEach((kind) => renderLookup(editorSession, kind, { forceResults: true }));
  }
}

function handleGoogleMapsInputForLookup() {
  const session = editorSession;
  if (!session) return;
  // Pasting a Google Maps link replaces a place chosen in this editor.
  if (els.form.elements.googleMapsUrl.value.trim() && session.location.mode !== "unchanged") {
    session.revision += 1;
    session.location = { mode: "unchanged", place: null, revision: session.revision };
    markChosenResults(session, "place");
    lookupParts(session, "place").status.textContent = "";
  }
  renderLookupCurrent(session, "place");
}

// ---------------------------------------------------------------------------
// Optional Google place link in the plan editor (owner and content managers only).
// Opening the editor sends nothing. A Google search or preview starts only from the explicit
// "Search on Google" / "Show this place" buttons, only after the public-venue box is ticked, and
// only with the dedicated query field (never the plan name, notes, travelers or address). A place
// is linked only when the user picks it in Google's own list or checks a pasted place ID; there is
// no automatic or first-result match. Only the Place ID is kept, bound to this plan's location.

function createGoogleEditorState(plan) {
  // Opted-out (or never opted-in) trips show no Google matching controls at all.
  if (!tripGooglePlacesEnabled()) { hideGooglePanel(); return null; }
  ensureGooglePanel().hidden = false;
  resetGooglePanelFields();
  const original = plan && associationMatchesPlan(plan) ? normalizeGooglePlaceAssociation(plan[GOOGLE_PLACE_ASSOCIATION_FIELD]) : null;
  const originalBinding = locationBindingForPlan(plan);
  return {
    original, originalPlan: plan, originalBinding, lastBinding: originalBinding,
    mode: "unchanged", placeId: "", selectionBinding: "", formOpen: false,
    search: null, preview: null, statusKey: "", statusError: false, ended: false
  };
}

function endGoogleEditorState(session) {
  const state = session?.google;
  if (!state) return;
  state.ended = true;
  stopGoogleWork(state);
  resetGooglePanelFields();
}

function googleNode(tag, className, key) {
  const node = textElement(tag, className, googleText(currentLanguage, key));
  node.dataset.googleText = key;
  return node;
}

function googleButton(className, action, key = "") {
  const node = textElement("button", className, key ? googleText(currentLanguage, key) : "");
  node.type = "button";
  node.dataset.googleAction = action;
  if (key) node.dataset.googleText = key;
  return node;
}

function ensureGooglePanel() {
  let panel = document.getElementById("google-match");
  if (panel) return panel;
  panel = element("section", "lookup-panel google-match");
  panel.id = "google-match";
  const title = googleNode("h3", "lookup-panel__title", "sectionTitle");
  title.id = "google-match-title";
  panel.setAttribute("aria-labelledby", title.id);
  const hint = googleNode("p", "form-hint lookup-panel__hint", "sectionHint");
  const current = element("p", "google-match__current");
  const actions = element("div", "lookup-current__actions google-match__actions");
  actions.append(
    googleButton("button button--quiet button--small", "open"),
    googleButton("button button--quiet button--small", "remove", "removeLink")
  );

  const form = element("div", "google-match__form");
  form.hidden = true;
  const query = document.createElement("input");
  query.type = "search";
  query.id = "google-match-query";
  query.className = "lookup-search__input";
  query.maxLength = VENUE_QUERY_MAX;
  query.autocomplete = "off";
  query.spellcheck = false;
  query.setAttribute("enterkeyhint", "search");
  query.dataset.googlePlaceholder = "queryPlaceholder";
  query.placeholder = googleText(currentLanguage, "queryPlaceholder");
  const queryLabel = googleNode("label", "lookup-search__label", "queryLabel");
  queryLabel.htmlFor = query.id;
  const privacy = googleNode("p", "lookup-privacy", "privacyNote");
  privacy.id = "google-match-privacy";
  query.setAttribute("aria-describedby", privacy.id);
  const venue = element("label", "google-match__venue");
  const venueBox = document.createElement("input");
  venueBox.type = "checkbox";
  venueBox.id = "google-match-public";
  venue.append(venueBox, googleNode("span", "", "publicVenueLabel"));
  const searchRow = element("div", "lookup-search__row");
  searchRow.append(query, googleButton("button button--small lookup-search__button", "search", "searchGoogle"));

  const placeId = document.createElement("input");
  placeId.type = "url";
  placeId.id = "google-match-place-id";
  placeId.className = "lookup-search__input";
  placeId.maxLength = 4096;
  placeId.autocomplete = "off";
  placeId.spellcheck = false;
  placeId.setAttribute("autocapitalize", "none");
  placeId.setAttribute("inputmode", "url");
  placeId.dataset.googlePlaceholder = "placeIdPlaceholder";
  placeId.placeholder = googleText(currentLanguage, "placeIdPlaceholder");
  const placeIdLabel = googleNode("label", "lookup-search__label", "placeIdLabel");
  placeIdLabel.htmlFor = placeId.id;
  const placeIdRow = element("div", "lookup-search__row");
  placeIdRow.append(placeId, googleButton("button button--quiet button--small lookup-search__button", "preview", "showPlace"));

  const status = element("p", "lookup-status google-match__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const results = element("div", "google-match__results");
  const preview = element("div", "google-match__preview");
  const use = googleButton("button button--small google-match__use", "use", "usePlace");
  use.hidden = true;
  const cancel = googleButton("button button--quiet button--small google-match__cancel", "cancel", "cancelSearch");
  form.append(queryLabel, privacy, venue, searchRow, placeIdLabel, placeIdRow, status, results, preview, use, cancel);
  panel.append(title, hint, current, actions, form);

  // Enter in either field is an explicit action for that field; it never submits the plan.
  query.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!event.isComposing) googleEditorAction("search");
  });
  placeId.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (!event.isComposing) googleEditorAction("preview");
  });
  venueBox.addEventListener("change", () => googleEditorAction("venue"));
  panel.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-google-action]");
    if (button && panel.contains(button)) googleEditorAction(button.dataset.googleAction);
  });
  els.googleMapsLinkPreview.after(panel);
  return panel;
}

function googleParts() {
  const panel = document.getElementById("google-match");
  if (!panel) return null;
  return {
    panel,
    current: panel.querySelector(".google-match__current"),
    open: panel.querySelector('[data-google-action="open"]'),
    remove: panel.querySelector('[data-google-action="remove"]'),
    form: panel.querySelector(".google-match__form"),
    query: panel.querySelector("#google-match-query"),
    venue: panel.querySelector("#google-match-public"),
    placeId: panel.querySelector("#google-match-place-id"),
    status: panel.querySelector(".google-match__status"),
    results: panel.querySelector(".google-match__results"),
    preview: panel.querySelector(".google-match__preview"),
    use: panel.querySelector('[data-google-action="use"]')
  };
}

function resetGooglePanelFields() {
  const parts = googleParts();
  if (!parts) return;
  parts.query.value = "";
  parts.venue.checked = false;
  parts.placeId.value = "";
  parts.results.replaceChildren();
  parts.preview.replaceChildren();
  parts.use.hidden = true;
  parts.status.textContent = "";
  delete parts.status.dataset.error;
  parts.form.hidden = true;
  parts.panel.removeAttribute("aria-busy");
}

function stopGoogleWork(state) {
  state.search?.dispose();
  state.preview?.dispose();
  state.search = null;
  state.preview = null;
  const parts = googleParts();
  if (parts) {
    parts.results.replaceChildren();
    parts.preview.replaceChildren();
  }
}

// The location the editor would save, for display only. Saving recomputes the binding from the
// exact plan that is sent, and refuses a choice made for a different location.
function pendingLocationPlan(session) {
  const googleValue = els.form.elements.googleMapsUrl.value.trim();
  const parsed = parseFullGoogleMapsPlaceUrl(googleValue);
  if (session.location.mode === "place" && session.location.place && !googleValue) return { place: session.location.place };
  if (parsed.ok) return { googleMapsUrl: parsed.url };
  if (session.location.mode === "cleared") return {};
  const original = session.google?.originalPlan || {};
  if (!googleValue && !original.place && parseFullGoogleMapsPlaceUrl(original.googleMapsUrl || original.mapsUrl || "").ok) return {};
  return original;
}

function setGoogleStatus(state, key, isError = false) {
  state.statusKey = key;
  state.statusError = isError;
}

function syncGoogleEditor(session) {
  const state = session?.google;
  if (!state || state.ended) return;
  const binding = locationBindingForPlan(pendingLocationPlan(session));
  if (binding !== state.lastBinding) {
    state.lastBinding = binding;
    // A changed location invalidates any pending Google search, preview or choice.
    stopGoogleWork(state);
    if (state.mode === "chosen") Object.assign(state, { mode: "unchanged", placeId: "", selectionBinding: "" });
    // A new or changed location offers the search form; it still sends nothing by itself.
    state.formOpen = Boolean(binding) && binding !== state.originalBinding;
    setGoogleStatus(state, "");
  }
  renderGoogleEditor(session);
}

function renderGoogleEditor(session) {
  const state = session?.google;
  const parts = googleParts();
  if (!state || state.ended || !parts) return;
  const binding = state.lastBinding;
  const locationChanged = binding !== state.originalBinding;
  const currentKey = !binding ? "needsLocation"
    : state.mode === "chosen" ? "chosenPending"
      : state.mode === "removed" ? "removedPending"
        : state.original && locationChanged ? "staleLink"
          : state.original ? "linked" : "notLinked";
  parts.current.textContent = googleText(currentLanguage, currentKey);
  parts.current.dataset.state = currentKey;
  const correcting = (state.original && !locationChanged) || state.mode === "chosen";
  parts.open.textContent = googleText(currentLanguage, correcting ? "chooseDifferent" : "findOnGoogle");
  parts.open.hidden = !binding || state.formOpen;
  parts.remove.hidden = !(state.mode === "chosen" || (state.original && !locationChanged && state.mode === "unchanged"));
  parts.form.hidden = !binding || !state.formOpen;
  parts.use.hidden = !state.preview?.readyPlaceId || (state.mode === "chosen" && state.placeId === state.preview.readyPlaceId);
  parts.status.textContent = state.statusKey ? googleText(currentLanguage, state.statusKey) : "";
  if (state.statusError) parts.status.dataset.error = "true";
  else delete parts.status.dataset.error;
  if (state.statusKey === "searching" || state.statusKey === "previewLoading") parts.panel.setAttribute("aria-busy", "true");
  else parts.panel.removeAttribute("aria-busy");
}

function chooseGooglePlace(session, placeId) {
  const state = session.google;
  const binding = locationBindingForPlan(pendingLocationPlan(session));
  if (!binding || state.ended) return;
  Object.assign(state, { mode: "chosen", placeId, selectionBinding: binding });
  setGoogleStatus(state, "chosenPending");
  renderGoogleEditor(session);
}

function googleEditorAction(action) {
  const session = editorSession;
  const state = session?.google;
  const parts = googleParts();
  if (!state || state.ended || !parts || !els.dialog.open) return;
  const binding = locationBindingForPlan(pendingLocationPlan(session));
  if (action === "open") {
    if (!binding) return;
    state.formOpen = true;
    setGoogleStatus(state, "");
    renderGoogleEditor(session);
    parts.query.focus({ preventScroll: true });
    return;
  }
  if (action === "remove" || action === "cancel") {
    // Remove: the saved link goes on Save. Cancel: stop searching and drop any pending choice.
    stopGoogleWork(state);
    if (action === "remove") state.mode = state.original ? "removed" : "unchanged";
    else if (state.mode === "chosen") state.mode = "unchanged";
    Object.assign(state, { placeId: "", selectionBinding: "", formOpen: false });
    setGoogleStatus(state, "");
    renderGoogleEditor(session);
    if (!parts.open.hidden) parts.open.focus({ preventScroll: true });
    return;
  }
  if (action === "venue") {
    if (!parts.venue.checked && state.mode === "chosen") {
      // Withdrawing the public-venue answer withdraws the pending choice.
      stopGoogleWork(state);
      Object.assign(state, { mode: "unchanged", placeId: "", selectionBinding: "" });
      setGoogleStatus(state, "needPublicVenue", true);
    }
    renderGoogleEditor(session);
    return;
  }
  if (!binding || !state.formOpen) return;
  if (action === "use") {
    const placeId = state.preview?.readyPlaceId;
    if (placeId && parts.venue.checked) chooseGooglePlace(session, placeId);
    return;
  }
  if (!parts.venue.checked) {
    setGoogleStatus(state, "needPublicVenue", true);
    renderGoogleEditor(session);
    parts.venue.focus({ preventScroll: true });
    return;
  }
  const runtime = googlePlacesRuntime();
  if (!runtime) return;
  // Re-checked synchronously right before a search or preview is dispatched: the same editor is
  // still open, the trip is still opted in, the location is unchanged and the box is still ticked.
  const editorCurrent = () => editorSession === session && !state.ended && els.dialog.open && tripGooglePlacesEnabled() &&
    parts.venue.checked && locationBindingForPlan(pendingLocationPlan(session)) === binding;
  if (action === "search") {
    const checked = checkVenueQuery(parts.query.value);
    if (!checked.ok) {
      setGoogleStatus(state, checked.errorKey, true);
      renderGoogleEditor(session);
      parts.query.focus({ preventScroll: true });
      return;
    }
    state.preview?.dispose();
    state.preview = null;
    parts.preview.replaceChildren();
    state.search ||= createPlaceSearchSession({
      doc: document,
      loader: runtime.loader,
      gate: runtime.gate,
      mount: parts.results,
      isCurrent: () => editorCurrent(),
      onStatus: (key) => {
        if (editorSession !== session || state.ended) return;
        const failedKey = ["disabled", "searchFailed", "limitReached", "paused"].includes(key);
        setGoogleStatus(state, key === "disabled" ? "searchFailed" : key, failedKey);
        renderGoogleEditor(session);
      },
      onSelect: (placeId) => {
        if (editorSession !== session || state.ended || !els.dialog.open || !parts.venue.checked) return;
        chooseGooglePlace(session, placeId);
      }
    });
    state.search.search(checked.query);
    return;
  }
  if (action === "preview") {
    const placeId = placeIdFromUserInput(parts.placeId.value);
    if (!placeId) {
      setGoogleStatus(state, "placeIdInvalid", true);
      renderGoogleEditor(session);
      parts.placeId.focus({ preventScroll: true });
      return;
    }
    state.preview ||= createPlacePreviewSession({
      doc: document,
      loader: runtime.loader,
      gate: runtime.gate,
      mount: parts.preview,
      isCurrent: () => editorCurrent(),
      onStatus: (key) => {
        if (editorSession !== session || state.ended) return;
        const failedKey = ["disabled", "detailsUnavailable", "limitReached", "paused"].includes(key);
        setGoogleStatus(state, key === "disabled" ? "detailsUnavailable" : key, failedKey);
        renderGoogleEditor(session);
      }
    });
    state.preview.preview(placeId);
  }
}

// Applies the editor's Google choice to the exact plan being saved. Only the Place ID, the binding
// of this plan's saved location and the public-venue flag are written; an unchanged association is
// dropped as soon as the location binding changes (the server enforces the same rule).
// Returns true when a pending choice was made for a location other than the one actually being
// saved: it is never attached, any earlier link is cleared, and the user is told to choose again.
function applyGoogleChoice(next, before, choice) {
  const field = GOOGLE_PLACE_ASSOCIATION_FIELD;
  if (choice?.mode === "chosen") {
    const association = associationForPlan(next, choice.placeId);
    if (association && association.locationBinding === choice.selectionBinding) {
      next[field] = association;
      return false;
    }
    delete next[field];
    return true;
  }
  if (choice?.mode === "removed") {
    delete next[field];
    return false;
  }
  if (next[field] && locationBindingForPlan(next) !== locationBindingForPlan(before)) delete next[field];
  return false;
}

// Shown after a save in which a pending Google choice could not match the saved location.
const GOOGLE_RELINK_NOTICE = Object.freeze({
  en: "Your changes were saved, but the Google place you chose did not match this plan's saved location, so the Google link was cleared. Open the plan and choose the Google place again.",
  "zh-Hans": "更改已保存，但所选的 Google 地点与此行程保存的位置不一致，因此已清除 Google 链接。请打开此行程，重新选择 Google 地点。",
  "zh-Hant": "變更已儲存，但所選的 Google 地點與此行程儲存的位置不一致，因此已清除 Google 連結。請開啟此行程，重新選擇 Google 地點。",
  ja: "変更は保存されましたが、選んだ Google の場所がこの予定の保存済みの場所と一致しないため、Google のリンクは解除されました。予定を開いて、Google の場所をもう一度選んでください。"
});
const GOOGLE_RELINK_NOTICE_MS = 10000;

function googleRelinkNoticeText() {
  return GOOGLE_RELINK_NOTICE[currentLanguage] || GOOGLE_RELINK_NOTICE.en;
}

function showGoogleRelinkNotice() {
  clearTimeout(toastTimer);
  toastKey = null;
  toastVariables = {};
  els.toast.textContent = googleRelinkNoticeText();
  els.toast.dataset.error = "true";
  els.toast.dataset.notice = "google-relink";
  els.toast.hidden = false;
  // Longer than an ordinary toast: the user has to act on it.
  toastTimer = setTimeout(hideToast, GOOGLE_RELINK_NOTICE_MS);
}

function focusDialogFieldOnDesktop(field) {
  if (!field || window.matchMedia("(pointer: coarse)").matches || isIosDevice()) return;
  requestAnimationFrame(() => field.focus({ preventScroll: true }));
}

async function handleItemSubmit(event) {
  event.preventDefault();
  const relatedLinks = relatedLinksEditor?.read();
  if (!relatedLinks) return;
  const data = new FormData(els.form);
  const dayId = data.get("dayId");
  const slotId = data.get("slotId");
  const existingSlot = currentTrip.days
    .find((day) => day.id === dayId)?.slots
    .find((slot) => slot.id === slotId);
  const nextSlotId = slotId || uid("slot");
  const googleMapsInput = els.form.elements.googleMapsUrl;
  const submittedMapsUrl = googleMapsInput.value.trim();
  const parsedMapsPlace = updateGoogleMapsLinkState({ showError: true, report: true });
  const preservingLegacyLocation = Boolean(
    existingSlot
    && !submittedMapsUrl
    && googleMapsInput.dataset.preserveLegacyLocation === "true"
  );
  if (submittedMapsUrl && !parsedMapsPlace.ok) return;
  const existingMapsPlace = parseFullGoogleMapsPlaceUrl(existingSlot?.googleMapsUrl || existingSlot?.mapsUrl || "");
  const clearingMappedLocation = Boolean(existingSlot && !submittedMapsUrl && existingMapsPlace.ok);
  // Choices made in this editor apply only to the plan the editor was opened for.
  const session = editorSession && editorSession.dayId === dayId && editorSession.slotId === slotId
    ? editorSession
    : null;
  const chosenPlace = session?.location.mode === "place" && !submittedMapsUrl ? session.location.place : null;
  const clearingLocation = session?.location.mode === "cleared" && !submittedMapsUrl;
  const chosenPhoto = session?.photo.mode === "photo" ? session.photo.photo : null;
  const clearingPhoto = session?.photo.mode === "cleared";
  const googleChoice = session?.google
    ? { mode: session.google.mode, placeId: session.google.placeId, selectionBinding: session.google.selectionBinding }
    : null;
  const googleUrlChanged = parsedMapsPlace.ok && (!existingMapsPlace.ok || existingMapsPlace.url !== parsedMapsPlace.url);
  const removedKeys = new Set();
  if (chosenPlace) {
    GOOGLE_LOCATION_KEYS.forEach((key) => removedKeys.add(key));
    removedKeys.add("mapLocationOmitted");
    if (!chosenPlace.address) removedKeys.add("address");
  } else if (parsedMapsPlace.ok) {
    // A newly pasted Google Maps link replaces a previously chosen place.
    if (googleUrlChanged) removedKeys.add("place");
  } else if (clearingLocation || (clearingMappedLocation && !preservingLegacyLocation)) {
    ALL_LOCATION_KEYS.forEach((key) => removedKeys.add(key));
  }
  if (chosenPhoto) removedKeys.add("photoSourceId");
  else if (clearingPhoto) ["photo", "photoSourceId"].forEach((key) => removedKeys.add(key));
  const locationChanged = Boolean(chosenPlace) || googleUrlChanged || removedKeys.has("lat");

  const submittedName = String(data.get("name") || "").trim();
  const submittedReview = String(data.get("review") || "").trim();
  if (!submittedName) return;
  const nameChanged = !existingSlot || submittedName !== String(els.form.dataset.initialName || "").trim();
  const reviewChanged = !existingSlot || submittedReview !== String(els.form.dataset.initialReview || "").trim();
  const slotPatch = {
    period: ["morning", "noon", "evening"].includes(data.get("period")) ? data.get("period") : "morning",
    planType: normalizePlanType(data.get("planType")),
    booked: data.get("booked") === "true",
    name: nameChanged ? submittedName : (existingSlot.name || submittedName),
    time: String(data.get("time") || "").trim(),
    review: reviewChanged ? submittedReview : (existingSlot.review || "")
  };
  if (relatedLinks.length || existingSlot?.relatedLinks !== undefined) slotPatch.relatedLinks = relatedLinks;
  const scheduleChanged = !existingSlot
    || String(existingSlot.time || "").trim() !== slotPatch.time
    || String(existingSlot.period || "") !== slotPatch.period;
  const staleTranslationFields = [
    ...(nameChanged ? ["name"] : []),
    ...(reviewChanged ? ["review"] : []),
    ...(locationChanged ? ["address"] : [])
  ];
  if (chosenPlace) {
    Object.assign(slotPatch, {
      place: clone(chosenPlace),
      lat: chosenPlace.lat,
      lng: chosenPlace.lng,
      approximateLocation: false
    });
    if (chosenPlace.address) slotPatch.address = chosenPlace.address;
  } else if (parsedMapsPlace.ok) {
    Object.assign(slotPatch, {
      googleMapsUrl: parsedMapsPlace.url,
      googleMapsPlaceName: parsedMapsPlace.placeName,
      googleMapsPlaceLabel: parsedMapsPlace.placeLabel,
      googleMapsFeatureId: parsedMapsPlace.featureId,
      address: parsedMapsPlace.address,
      lat: parsedMapsPlace.lat,
      lng: parsedMapsPlace.lng,
      approximateLocation: false
    });
  }
  if (chosenPhoto) slotPatch.photo = clone(chosenPhoto);

  // Set by the last run of the mutator (a sync transaction may run it more than once).
  let googleRelinkNeeded = false;
  const saved = await mutateTrip((trip) => {
    googleRelinkNeeded = false;
    const day = trip.days.find((candidate) => candidate.id === dayId);
    if (!day) return;
    if (!Array.isArray(day.slots)) day.slots = [];
    const existingIndex = day.slots.findIndex((candidate) => candidate.id === slotId);
    let next;
    if (existingIndex >= 0) {
      const before = day.slots[existingIndex];
      next = { ...before, ...slotPatch };
      removedKeys.forEach((key) => delete next[key]);
      if (next.i18n) next.i18n = clone(next.i18n);
      invalidateTranslations(next, staleTranslationFields);
      googleRelinkNeeded = applyGoogleChoice(next, before, googleChoice);
      day.slots[existingIndex] = next;
    } else {
      next = { id: nextSlotId, ...slotPatch };
      googleRelinkNeeded = applyGoogleChoice(next, null, googleChoice);
      day.slots.push(next);
    }
    if (scheduleChanged) resequenceDaySlots(day, next.id);
  }, slotId ? "planUpdated" : "planAdded");
  if (!saved) return;
  els.dialog.close();
  // The other edits are saved; the unmatched Google choice was not, and the user is told so.
  if (googleRelinkNeeded) showGoogleRelinkNotice();
}

// Removes translations that depended on edited source fields. Languages then
// fall back to the new source text instead of showing an outdated translation.
function invalidateTranslations(target, fields) {
  if (!target || !fields.length || !target.i18n || typeof target.i18n !== "object") return;
  Object.keys(target.i18n).forEach((language) => {
    const patch = target.i18n[language];
    if (!patch || typeof patch !== "object") return;
    fields.forEach((field) => delete patch[field]);
    if (!Object.keys(patch).length) delete target.i18n[language];
  });
  if (!Object.keys(target.i18n).length) delete target.i18n;
}

function scheduleSortTime(time) {
  const match = String(time || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${match[2]}`;
}

function compareByPeriodAndTime(first, second) {
  const periodRank = (slot) => ({ morning: 0, noon: 1, evening: 2 })[slot?.period] ?? 3;
  const periodDifference = periodRank(first) - periodRank(second);
  if (periodDifference) return periodDifference;
  const firstMinutes = slotStartMinutes(first?.sortTime || first?.time);
  const secondMinutes = slotStartMinutes(second?.sortTime || second?.time);
  if (firstMinutes === secondMinutes) return 0;
  return firstMinutes < secondMinutes ? -1 : 1;
}

// After a time/period change, the edited plan's sort metadata is recomputed
// from its new schedule and the day's stored order is rewritten so that the
// stored order, sortOrder values and the displayed timeline all agree.
function resequenceDaySlots(day, changedSlotId) {
  const slots = Array.isArray(day?.slots) ? day.slots : [];
  const changed = slots.find((slot) => slot.id === changedSlotId);
  if (!changed) return;
  const usedSortOrder = slots.some((slot) => Number.isFinite(Number(slot.sortOrder)) && slot.sortOrder !== "" && slot.sortOrder !== null);
  delete changed.sortOrder;
  const sortTime = scheduleSortTime(changed.time);
  if (sortTime) changed.sortTime = sortTime;
  else delete changed.sortTime;

  const others = orderedDaySlots({ ...day, slots: slots.filter((slot) => slot.id !== changedSlotId) })
    .filter((slot) => slots.includes(slot));
  const insertAt = others.findIndex((slot) => compareByPeriodAndTime(slot, changed) > 0);
  const ordered = [...others];
  ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, changed);
  if (usedSortOrder) ordered.forEach((slot, index) => { slot.sortOrder = (index + 1) * 10; });
  day.slots = ordered;
}

async function handleItemDelete() {
  const dayId = els.form.elements.dayId.value;
  const slotId = els.form.elements.slotId.value;
  if (!slotId) return;
  const slot = currentTrip.days.find((day) => day.id === dayId)?.slots.find((item) => item.id === slotId);
  const displaySlot = displayTrip.days.find((day) => day.id === dayId)?.slots.find((item) => item.id === slotId);
  if (!window.confirm(ui(currentLanguage, "deleteConfirm", { item: displaySlot?.name || ui(currentLanguage, "plan") }))) return;

  const saved = await mutateTrip((trip) => {
    const day = trip.days.find((candidate) => candidate.id === dayId);
    if (day) day.slots = (Array.isArray(day.slots) ? day.slots : []).filter((candidate) => candidate.id !== slotId);
  }, "planDeleted");
  if (saved) els.dialog.close();
}

async function connectRealtimeSync() {
  if (HOSTED) { connectHostedSync(); return; }
  await firebaseConfigPromise;
  if (!isFirebaseConfigured()) {
    setupLocalPreviewSync();
    setSyncStatus("localPreview", "offline");
    return;
  }

  setSyncStatus("connecting", "working");
  try {
    const [appSdk, authSdk, firestoreSdk] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore.js`)
    ]);

    const app = appSdk.initializeApp(firebaseConfig);
    const auth = authSdk.getAuth(app);
    try {
      await authSdk.setPersistence(auth, authSdk.browserLocalPersistence);
    } catch (persistenceError) {
      console.warn("Local auth persistence unavailable; using memory only", persistenceError);
      await authSdk.setPersistence(auth, authSdk.inMemoryPersistence);
    }
    const db = firestoreSdk.initializeFirestore(app, {
      localCache: firestoreSdk.memoryLocalCache()
    });
    const [collectionName, documentId] = tripDocumentPath.split("/");
    const ref = firestoreSdk.doc(db, collectionName, documentId);
    await ensureAnonymousUser(auth, authSdk);
    syncRuntime = { auth, db, ref, authSdk, firestoreSdk };
    firestoreSdk.onSnapshot(ref, { includeMetadataChanges: true }, (snapshot) => {
      currentSourceIsCache = snapshot.metadata.fromCache;
      if (!snapshot.exists()) {
        syncReady = !snapshot.metadata.fromCache;
        if (!snapshot.metadata.fromCache) {
          setSyncStatus("online", "synced");
        }
        return;
      }

      const data = snapshot.data();
      const remoteTripJSON = data.trip ? JSON.stringify(data.trip) : "";
      if (data.trip && remoteTripJSON !== lastRemoteTripJSON) {
        lastRemoteTripJSON = remoteTripJSON;
        currentTrip = data.trip;
        persistLocalTrip();
        // A remote update never rebuilds the cards while a link is being pressed.
        linkGuard.whenIdle("remote-trip", renderAll);
      }
      renderUpdatedAt(data.updatedAt);

      if (!snapshot.metadata.fromCache) {
        syncReady = true;
        if (["savedCopyNoSync", "syncTemporaryError", "listenerError", "initializationError"].includes(toastKey)) {
          hideToast();
        }
      }
      if (snapshot.metadata.hasPendingWrites) setSyncStatus("saving", "working");
      else if (snapshot.metadata.fromCache || !navigator.onLine) setSyncStatus("savedOffline", "offline");
      else setSyncStatus("synced", "synced");
    }, (error) => {
      console.error("Realtime listener failed", error);
      syncReady = false;
      setSyncStatus("offlineCopy", "offline");
      showToast("listenerError", true);
    });
  } catch (error) {
    console.error("Firebase setup failed", error);
    syncRuntime = null;
    syncReady = false;
    setupLocalPreviewSync();
    setSyncStatus(navigator.onLine ? "syncUnavailable" : "savedOffline", "offline");
    showToast("syncTemporaryError", true);
  }
}

function ensureAnonymousUser(auth, authSdk) {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve, reject) => {
    const stop = authSdk.onAuthStateChanged(auth, async (user) => {
      if (user) {
        stop();
        resolve(user);
        return;
      }
      try {
        const credential = await authSdk.signInAnonymously(auth);
        stop();
        resolve(credential.user);
      } catch (error) {
        stop();
        reject(error);
      }
    }, reject);
  });
}

function setupLocalPreviewSync() {
  if (!("BroadcastChannel" in window) || localChannel) return;
  localChannel = new BroadcastChannel(APP_CHANNEL_NAME);
  localChannel.addEventListener("message", (event) => {
    if (event.data?.type !== "trip-update") return;
    currentTrip = event.data.trip;
    persistLocalTrip();
    linkGuard.whenIdle("remote-trip", renderAll);
  });
}

async function mutateTrip(mutator, successMessage) {
  if (HOSTED_READ_ONLY) return false;
  if (HOSTED) return mutateHostedTrip(mutator, successMessage);
  await firebaseConfigPromise;
  setSyncStatus("saving", "working");
  try {
    if (!syncRuntime && isFirebaseConfigured() && syncStartupPromise) {
      await syncStartupPromise;
    }
    if (isFirebaseConfigured() && (!syncRuntime || !syncReady || !navigator.onLine)) {
      setSyncStatus(syncRuntime ? "offlineCopy" : "syncUnavailable", "offline");
      showToast("editRequiresConnection", true);
      return false;
    }

    if (syncRuntime) {
      const { auth, db, ref, firestoreSdk } = syncRuntime;
      await firestoreSdk.runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(ref);
        const base = snapshot.exists() && snapshot.data().trip ? snapshot.data().trip : currentTrip;
        const next = clone(base);
        mutator(next);
        normalizeTrip(next);
        const payload = {
          trip: next,
          schemaVersion: 1,
          updatedAt: firestoreSdk.serverTimestamp(),
          updatedBy: auth.currentUser.uid
        };
        if (snapshot.exists()) transaction.update(ref, payload);
        else transaction.set(ref, { ...payload, createdAt: firestoreSdk.serverTimestamp() });
      });
    } else {
      const next = clone(currentTrip);
      mutator(next);
      currentTrip = next;
      persistLocalTrip();
      renderAll();
      localChannel?.postMessage({ type: "trip-update", trip: currentTrip });
      setSyncStatus("savedOnDevice", "offline");
    }
    showToast(successMessage);
    return true;
  } catch (error) {
    console.error("Save failed", error);
    setSyncStatus("saveFailed", "error");
    showToast("saveError", true);
    return false;
  }
}

function connectHostedSync() {
  syncReady = true;
  lastUpdatedDate = new Date(hostedServerTrip.updatedAt);
  setSyncStatus("synced", "synced");
  renderUpdatedAt();
  hostedPoller = createTripPoller({
    load: () => hostedApi.getTrip(HOSTED_TRIP_ID),
    onData: (payload) => {
      hostedReady = true; syncReady = true;
      if (!hostedWriteInFlight) acceptHostedTrip(expectTrip(payload, HOSTED_TRIP_ID));
      setSyncStatus("synced", "synced");
    },
    onError: (error, { final }) => {
      hostedReady = false; syncReady = false;
      if (error.status === 401) { hostedPoller.stop(); leaveForSignIn(); return; }
      if (final) {
        hostedPoller.stop(); hostedServerTrip = null; currentTrip = {days:[],reminders:[]};
        document.querySelector("main").replaceChildren(textElement("p","empty-state",ui(currentLanguage,"tripUnavailable")));
      }
      setSyncStatus("offlineCopy", "offline");
    }
  });
  hostedPoller.start();
}

function acceptHostedTrip(trip) {
  // Delayed polls must not revive an older trip or reverse a newer Google opt-out.
  if (hostedServerTrip && trip.version <= hostedServerTrip.version) return;
  // Weather choices are recomputed in place (weather-forecast.js), so they no longer need a reload.
  const metadataChanged = ["title","timezone","resources"].some((key) =>
    JSON.stringify(trip[key]) !== JSON.stringify(hostedServerTrip?.[key]));
  const googleWasEnabled = tripGooglePlacesEnabled();
  hostedServerTrip = trip;
  currentTrip = toRenderTrip(trip);
  lastUpdatedDate = new Date(trip.updatedAt);
  // Opt-out takes effect at once (no new Google work, late results ignored); the DOM follows below.
  if (googleWasEnabled && !tripGooglePlacesEnabled()) stopTripGooglePlaces();
  // Rebuilding the itinerary or reloading replaces every card and anchor. While a press on a link is
  // in progress, wait until the browser has activated that link (latest data wins afterwards).
  if (metadataChanged && !document.querySelector("dialog[open]")) hostedReloadPending = true;
  linkGuard.whenIdle("hosted-trip", () => {
    if (hostedReloadPending) location.reload();
    else renderAll();
  });
}

async function mutateHostedTrip(mutator, successMessage) {
  if (hostedWriteInFlight || !hostedReady || !navigator.onLine || hostedServerTrip?.archived) {
    showToast("editRequiresConnection", true); return false;
  }
  const openedVersion = els.dialog.open ? els.form.dataset.hostedVersion
    : els.todoDialog.open ? els.todoForm.dataset.hostedVersion : "";
  if (openedVersion && Number(openedVersion) !== hostedServerTrip.version) {
    showToast("versionConflict",true); return false;
  }
  hostedWriteInFlight = true; setSyncStatus("saving","working");
  const base = clone(hostedServerTrip);
  try {
    mutator(base);
    const result = await hostedApi.applyChanges(HOSTED_TRIP_ID,hostedServerTrip.version,
      [{type:"replace_content",trip:base}],newRequestId("edit"));
    acceptHostedTrip(expectTrip(result,HOSTED_TRIP_ID));
    setSyncStatus("synced","synced");showToast(successMessage);return true;
  } catch(error) {
    if(error.status===401)leaveForSignIn();
    if(error.status===409) {
      try {acceptHostedTrip(expectTrip(await hostedApi.getTrip(HOSTED_TRIP_ID),HOSTED_TRIP_ID));}catch{}
      showToast("versionConflict",true);
    } else showToast("saveError",true);
    setSyncStatus("saveFailed","error");return false;
  } finally {hostedWriteInFlight=false;}
}

function renderHostedControls() {
  if (!HOSTED) return;
  let controls = document.getElementById("hosted-controls");
  if (!controls) { controls = element("div","hosted-controls"); controls.id="hosted-controls"; els.headerActions.prepend(controls); }
  const button = (label,action) => {
    const node=textElement("button","button button--quiet",ui(currentLanguage,label));node.type="button";node.addEventListener("click",action);return node;
  };
  const home=textElement("a","button button--light",ui(currentLanguage,"allTrips"));home.href="/";
  const exportButton=button("exportTrip",async()=> {
    try {downloadJSON(await hostedApi.exportTrip(HOSTED_TRIP_ID),exportFilename(hostedServerTrip));}
    catch(error){if(error.status===401)leaveForSignIn();else showToast("saveError",true);}
  });
  if (HOSTED_READ_ONLY) {
    const badge=textElement("span","hosted-read-only-badge",READ_ONLY_LABELS[currentLanguage]||READ_ONLY_LABELS.en);
    controls.replaceChildren(home,badge,exportButton,button("retrySync",()=>hostedPoller?.retryNow()),button("signOut",signOutAndLeave));
    els.addReminder.hidden=true;els.addReminder.disabled=true;
    return;
  }
  controls.replaceChildren(home,
    button("editTrip",()=>openMetadataDialog()),
    exportButton,
    button("retrySync",()=>hostedPoller?.retryNow()),
    button("signOut",signOutAndLeave));
  els.addReminder.disabled=Boolean(hostedServerTrip.archived);
}

function hostedEditor(title,fields,onSave,onDelete) {
  if (HOSTED_READ_ONLY) return;
  const dialog=element("dialog","hosted-editor"); const form=document.createElement("form");
  form.append(textElement("h2","",ui(currentLanguage,title)));
  for(const [key,definition] of Object.entries(fields)){
    if(definition.node){form.append(definition.node);continue;}
    const label=element("label","field");label.append(textElement("span","",ui(currentLanguage,definition.label||key)));
    const input=document.createElement("input");input.name=key;input.type=definition.type||"text";input.value=definition.value||"";
    input.required=Boolean(definition.required);input.maxLength=definition.maxLength||300;label.append(input);form.append(label);
  }
  const error=textElement("p","hosted-form-error","");error.setAttribute("role","alert");form.append(error);
  const actions=element("div","hosted-form-actions");
  const cancel=textElement("button","button button--quiet",ui(currentLanguage,"cancel"));cancel.type="button";cancel.addEventListener("click",()=>dialog.close());
  const save=textElement("button","button",ui(currentLanguage,"saveForEveryone"));actions.append(cancel,save);
  if(onDelete){const remove=textElement("button","button button--quiet",ui(currentLanguage,"delete"));remove.type="button";remove.addEventListener("click",()=>perform(onDelete));actions.prepend(remove);}
  form.append(actions);dialog.append(form);document.body.append(dialog);
  async function perform(action) {
    form.querySelectorAll("button").forEach((b)=>b.disabled=true);
    try {await action(Object.fromEntries(new FormData(form)));dialog.close();}
    catch(problem){error.textContent=problem.status===409?ui(currentLanguage,"versionConflict"):problem.message;if(problem.status===401)leaveForSignIn();}
    finally {form.querySelectorAll("button").forEach((b)=>b.disabled=false);}
  }
  form.addEventListener("submit",(event)=>{event.preventDefault();perform(onSave);});
  dialog.addEventListener("close",()=>dialog.remove());dialog.showModal();
}

function openDayDialog(dayId="") {
  const day=hostedServerTrip.days.find((d)=>d.id===dayId);
  const version=hostedServerTrip.version;const requestId=newRequestId("day");
  const targetId=dayId||uid("day");
  const save=async(fields)=> {
    const result=await hostedApi.applyChanges(HOSTED_TRIP_ID,version,[{type:"upsert_day",day:{id:targetId,date:fields.date,theme:fields.theme}}],requestId);
    acceptHostedTrip(expectTrip(result,HOSTED_TRIP_ID));
  };
  hostedEditor(day?"editDate":"addDate",{
    date:{type:"date",value:day?.date||"",required:true,label:"date"},
    theme:{value:day?.theme||"",label:"dayLabel",maxLength:200}
  },save,day?async()=> {
    const result=await hostedApi.applyChanges(HOSTED_TRIP_ID,version,[{type:"delete_day",dayId}],newRequestId("delete-day"));
    acceptHostedTrip(expectTrip(result,HOSTED_TRIP_ID));
  }:null);
}

// Owner and content managers only (viewers never get this dialog; the server refuses viewer writes
// regardless). The Google choice is saved for this trip even while the site-wide feature is off; it
// is sent only when it changed, through the same validated update_trip operation.
function openMetadataDialog() {
  const version=hostedServerTrip.version;const requestId=newRequestId("metadata");
  const googleBefore=tripHasGooglePlacePhotos(hostedServerTrip);
  hostedEditor("editTrip",{
    title:{value:hostedServerTrip.title,required:true,maxLength:200},
    timezone:{value:hostedServerTrip.timezone,required:true},
    country:{value:hostedServerTrip.country},
    route:{value:hostedServerTrip.route},
    [GOOGLE_PLACE_PHOTOS_FIELD]:{node:buildGooglePlacePhotosField(document,{language:currentLanguage,checked:googleBefore,idPrefix:"edit-trip"})}
  },async(fields)=> {
    const googleAfter=fields[GOOGLE_PLACE_PHOTOS_FIELD]==="true";
    delete fields[GOOGLE_PLACE_PHOTOS_FIELD];
    if(googleAfter!==googleBefore)fields[GOOGLE_PLACE_PHOTOS_FIELD]=googleAfter;
    await hostedApi.applyChanges(HOSTED_TRIP_ID,version,[{type:"update_trip",fields}],requestId);
    location.reload();
  });
}

function setSyncStatus(key, state, variables = {}) {
  currentStatusKey = key;
  currentStatusVariables = variables;
  els.statusText.textContent = ui(currentLanguage, key, variables);
  els.status.dataset.state = state;
}

function renderUpdatedAt(timestamp) {
  if (timestamp?.toDate) lastUpdatedDate = timestamp.toDate();
  if (!lastUpdatedDate) {
    els.updated.textContent = ui(currentLanguage, "liveTripBoard");
    return;
  }
  const time = formatTimestamp(lastUpdatedDate);
  els.updated.textContent = ui(currentLanguage, "updatedAt", { time });
}

function showToast(key, isError = false, variables = {}) {
  clearTimeout(toastTimer);
  toastKey = key;
  toastVariables = variables;
  els.toast.textContent = ui(currentLanguage, key, variables);
  els.toast.dataset.error = String(isError);
  delete els.toast.dataset.notice;
  els.toast.hidden = false;
  toastTimer = setTimeout(hideToast, 3200);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastTimer = null;
  els.toast.hidden = true;
  delete els.toast.dataset.notice;
  toastKey = null;
  toastVariables = {};
}

function applyLanguageToDocument() {
  const meta = languageMeta(currentLanguage);
  document.documentElement.lang = meta.htmlLang;
  document.title = ui(currentLanguage, "documentTitle");
  els.metaDescription.setAttribute("content", ui(currentLanguage, "metaDescription"));
  els.language.value = currentLanguage;
  els.language.setAttribute("aria-label", ui(currentLanguage, "language"));
  els.planLanguage.value = currentLanguage;
  els.planLanguage.setAttribute("aria-label", ui(currentLanguage, "language"));
}

function applyStaticTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = ui(currentLanguage, node.dataset.i18n);
  });
  populateTimeOptions(els.form.elements.time.value);
  const installLabel = ui(currentLanguage, isIosDevice() ? "installIos" : "install");
  els.install.textContent = installLabel;
  els.install.setAttribute("aria-label", installLabel);
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", ui(currentLanguage, node.dataset.i18nAriaLabel));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((node) => {
    node.setAttribute("placeholder", ui(currentLanguage, node.dataset.i18nPlaceholder));
  });

  if (els.dialog.open) {
    els.dialogTitle.textContent = ui(currentLanguage, els.form.elements.slotId.value ? "editPlan" : "addPlan");
    updateGoogleMapsLinkState({ showError: els.form.elements.googleMapsUrl.getAttribute("aria-invalid") === "true" });
    refreshLookupLanguage();
  }
  if (els.todoDialog.open) {
    els.todoDialogTitle.textContent = ui(currentLanguage, els.todoForm.elements.reminderId.value ? "editTodo" : "addTodo");
  }
  if (els.weatherDialog.open) renderWeatherDialog();
  if (!els.toast.hidden && toastKey) {
    els.toast.textContent = ui(currentLanguage, toastKey, toastVariables);
  } else if (!els.toast.hidden && els.toast.dataset.notice === "google-relink") {
    els.toast.textContent = googleRelinkNoticeText();
  }
  updateItinerarySheetHandle(undefined, itinerarySheetMode);
  setSyncStatus(currentStatusKey, els.status.dataset.state || "working", currentStatusVariables);
  renderUpdatedAt();
}

function initialDayId(days = []) {
  if (!days.length) return "";
  let requested = "";
  try {
    requested = new URL(window.location.href).searchParams.get("day") || "";
  } catch {
    // The current trip date remains a safe default if URL parsing is unavailable.
  }
  const requestedDay = days.find((day) => day.id === requested || day.date === requested);
  if (requestedDay) return requestedDay.id;

  const today = todayInTripISO();
  const currentDay = days.find((day) => day.date === today);
  if (currentDay) return currentDay.id;
  return (days.find((day) => day.date >= today) || days.at(-1)).id;
}

function selectActiveDay(dayId) {
  const day = currentTrip.days.find((candidate) => candidate.id === dayId);
  if (!day) return;
  activeDayId = day.id;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("day", day.date);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Day switching still works when history manipulation is unavailable.
  }
  displayTrip = localizeTrip(currentTrip, currentLanguage);
  renderDayNavigation();
  renderItinerary();
  renderCredits();
  renderMap();
  if (document.documentElement.classList.contains("is-itinerary-view")) els.itineraryPanel.scrollTop = 0;
}

// "Today" follows the CURRENT trip's validated time zone (the same zone the weather controller
// uses), so a remote time-zone edit received while a dialog is open updates the weather/date labels
// in place. The embedded seed zone is only a fallback; page reloads behave as before.
function currentTripTimeZone() {
  const zone = currentTrip?.timezone;
  return typeof zone === "string" && isValidTimeZone(zone) ? zone : TRIP_TIMEZONE;
}

function todayInTripISO() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: currentTripTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function switchLanguage(language, persist = true) {
  if (!Object.hasOwn({ en: true, "zh-Hans": true, "zh-Hant": true, ja: true }, language) || language === currentLanguage) return;
  const anchor = captureViewAnchor();
  currentLanguage = language;
  if (persist) saveLanguage(language);
  applyLanguageToDocument();
  renderAll();
  requestAnimationFrame(() => {
    syncItinerarySheetPosition({ reframe: false });
    restoreViewAnchor(anchor);
  });
}

function captureViewAnchor() {
  if (document.documentElement.classList.contains("is-itinerary-view")) {
    return { itineraryScrollTop: els.itineraryPanel.scrollTop };
  }
  const sections = [...document.querySelectorAll(".day-section")];
  const section = sections.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.top <= 110 && rect.bottom > 110;
  });
  if (!section) return { scrollY: window.scrollY };
  return { id: section.id, offset: section.getBoundingClientRect().top };
}

function restoreViewAnchor(anchor) {
  if (Number.isFinite(anchor.itineraryScrollTop)) {
    els.itineraryPanel.scrollTop = anchor.itineraryScrollTop;
    return;
  }
  if (anchor.id) {
    const section = document.getElementById(anchor.id);
    if (section) {
      window.scrollBy(0, section.getBoundingClientRect().top - anchor.offset);
      return;
    }
  }
  window.scrollTo(0, anchor.scrollY || 0);
}

function translateTier(tier) {
  if (!tier) return ui(currentLanguage, "stays");
  if (/^confirmed$/i.test(tier)) return ui(currentLanguage, "confirmed");
  if (/^planned$/i.test(tier)) return ui(currentLanguage, "planned");
  return tier;
}

function findCanonicalLocation(name) {
  const needle = String(name || "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .trim();
  if (!needle) return null;

  const locations = (currentTrip.days || []).flatMap((day) => day.slots || []);
  return locations.find((location) => {
    const candidate = String(location.name || "")
      .toLocaleLowerCase("en")
      .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
      .trim();
    return candidate === needle || candidate.includes(needle) || needle.includes(candidate);
  }) || null;
}

function googleMapsUrl(location, options) {
  return googleMapsDestinations(location, options)[0]?.url || "";
}

function googleMapsAnchor(location, options) {
  const destinations = googleMapsDestinations(location, options);
  const links = destinations.map((destination) => {
    const label = destination.labels?.[currentLanguage] || "";
    const link = element("a", "google-maps-link");
    link.href = destination.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = label
      ? `${ui(currentLanguage, "openGoogleMaps")} · ${label}`
      : ui(currentLanguage, "openGoogleMaps");
    link.setAttribute("aria-label", `${ui(currentLanguage, "openGoogleMaps")}: ${label || location?.name || location?.address || ""}`);
    return link;
  });

  if (links.length <= 1) return links[0] || null;
  const group = element("span", "google-maps-links");
  group.append(...links);
  return group;
}

function googleMapsDestinations(location = {}, { allowSearchFallback = true, allowNameFallback = false } = {}) {
  if (location.mapLocationOmitted) return [];
  const stored = normalizeGoogleMapsUrl(location.googleMapsUrl || location.mapsUrl || "");
  if (stored) return [{ url: stored }];
  const verified = getGooglePlaceLinks(location)
    .map((entry) => ({ ...entry, url: normalizeGoogleMapsUrl(entry.url) }))
    .filter((entry) => entry.url);
  if (verified.length) return verified;
  // A chosen OpenStreetMap place opens its saved coordinates in Google Maps; no
  // Google place identifier is implied.
  if (location.place && Number.isFinite(location.lat) && Number.isFinite(location.lng) && readSavedPlace(location.place)) {
    const coordinateUrl = coordinateGoogleMapsUrl(location.lat, location.lng);
    if (coordinateUrl) return [{ url: coordinateUrl }];
  }
  if (!allowSearchFallback) return [];
  if (!String(location.address || "").trim() && !(Number.isFinite(location.lat) && Number.isFinite(location.lng)) && !allowNameFallback) return [];
  const fallbackUrl = buildGoogleMapsUrl(location);
  return fallbackUrl ? [{ url: fallbackUrl }] : [];
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service worker registration failed", error);
    });
  };
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
}

// A native link that opens in a new tab with noopener/noreferrer. Only http(s) URLs and root-relative
// paths become links; anything else (javascript:, data:, //host, credentials) is shown as plain text.
function externalAnchor(label, url, className = "resource-link") {
  const href = safeLinkUrl(url);
  if (!href) return textElement("span", className, label);
  const link = element("a", className);
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function element(tag, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function textElement(tag, className, text) {
  const node = element(tag, className);
  node.textContent = text || "";
  return node;
}

function normalizedLabel(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase(languageMeta(currentLanguage).htmlLang)
    .replace(/[\s·・:：—–-]+/g, " ");
}

function formatDate(iso, options) {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return String(iso);
  return new Intl.DateTimeFormat(languageMeta(currentLanguage).dateLocale, { timeZone: "UTC", ...options }).format(date);
}

function formatCompactDateRange(first, last) {
  const start = new Date(`${first}T00:00:00Z`);
  const end = new Date(`${last}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [first, last].filter(Boolean).join(" – ");
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  const startMonth = start.getUTCMonth() + 1;
  const endMonth = end.getUTCMonth() + 1;
  const startDay = start.getUTCDate();
  const endDay = end.getUTCDate();
  const sameYear = startYear === endYear;
  const sameMonth = sameYear && startMonth === endMonth;

  if (currentLanguage === "zh-Hans" || currentLanguage === "zh-Hant") {
    if (sameMonth) return `${startYear}年${startMonth}月${startDay}日至${endDay}日`;
    if (sameYear) return `${startYear}年${startMonth}月${startDay}日至${endMonth}月${endDay}日`;
  }
  if (currentLanguage === "ja") {
    if (sameMonth) return `${startYear}年${startMonth}月${startDay}日〜${endDay}日`;
    if (sameYear) return `${startYear}年${startMonth}月${startDay}日〜${endMonth}月${endDay}日`;
  }
  if (currentLanguage === "en" && sameYear) {
    const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" });
    if (sameMonth) return `${month.format(start)} ${startDay}–${endDay}, ${startYear}`;
    return `${month.format(start)} ${startDay}–${month.format(end)} ${endDay}, ${startYear}`;
  }
  const formatter = new Intl.DateTimeFormat(languageMeta(currentLanguage).dateLocale, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric"
  });
  return typeof formatter.formatRange === "function"
    ? formatter.formatRange(start, end)
    : `${formatter.format(start)} – ${formatter.format(end)}`;
}

function formatNumber(value, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(languageMeta(currentLanguage).dateLocale, {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits > 0 && !Number.isInteger(value) ? 1 : 0
  }).format(value);
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(languageMeta(currentLanguage).dateLocale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

function formatForecastTime(value) {
  const match = String(value || "").match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "—";
}

function periodLabel(period) {
  return ({
    morning: ui(currentLanguage, "morning"),
    noon: ui(currentLanguage, "midday"),
    evening: ui(currentLanguage, "evening")
  })[period] || ui(currentLanguage, "plan");
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeMarkup(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
