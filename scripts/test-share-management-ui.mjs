// DOM tests for the authenticated share-management dialog (assets/app-template/public/share-management.js).
// Fictional fixtures only. Exercises the real module against a contract-shaped fetch fake installed on the
// jsdom window. This is DOM simulation, not a browser, device or messaging in-app-browser check.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  installShareManagement,
  shareManagementText,
  normalizeShareLanguage,
  localDateTimeToIso,
  SHARE_MANAGEMENT_LANGUAGES
} from "../assets/app-template/public/share-management.js";

const ORIGIN = "https://trips.example.test";
const TRIP = "fictional-trip-0001";
const BASE = `/api/trips/${TRIP}/sharing`;
const TOKEN_A = "A".repeat(40) + "_-9";
const TOKEN_B = "b".repeat(40) + "-_0";
const TOKEN_C = "C".repeat(43);
const FORBIDDEN = ["FICTIONAL-EXCLUDED-BOOKING", "FICTIONAL-BOOKING-CODE", "fictional-member-name", "FICTIONAL-NESTED-VALUE", "fictional-audit-entry", "FICTIONAL-GROUP-LABEL", "FICTIONAL-REVIEW-I18N"];

const PREVIEW = {
  trip: {
    id: TRIP,
    version: 7,
    title: "Fictional <img src=x onerror=alert(1)> Coast Walk",
    timezone: "Asia/Tokyo",
    updatedAt: "2026-09-01T00:00:00.000Z",
    cover: { url: `/guest/trips/${TRIP}/media/cover`, alt: "Fictional harbour at dawn", focusX: 50, focusY: 40 },
    branding: { theme: "harbor", logo: { url: `/guest/trips/${TRIP}/media/logo`, alt: "Fictional club logo" } },
    i18n: { ja: { title: "架空の海岸散歩", nested: { secret: "FICTIONAL-NESTED-VALUE" } }, "zh-Hans": { title: "虚构海岸漫步" } },
    days: [
      {
        id: "day-1", date: "2027-04-03", label: "Arrival", area: "Fictional Harbour", summary: "Easy first day",
        notes: "Meet at the fictional north gate at 09:00.",
        i18n: { "zh-Hant": { notes: "九點在虛構北門集合。" } },
        slots: [
          {
            id: "slot-1", name: "Fictional Ferry Terminal", period: "morning", time: "09:30", sortTime: "09:30", sortOrder: 0,
            planType: "transport", address: "1 Example Pier, Fictional City", lat: 35.1, lng: 139.2,
            description: "Board the sample ferry.", notes: "Bring the printed sample map.",
            mapsUrl: "https://www.openstreetmap.org/?mlat=35.1&mlon=139.2",
            photo: { url: `/guest/trips/${TRIP}/media/slot-1`, alt: "Sample ferry", credit: "Fictional Photographer", license: "CC BY 4.0", sourceUrl: "https://example.test/photo" },
            booking: { code: "FICTIONAL-BOOKING-CODE" },
            i18n: { ja: { name: "架空フェリー乗り場", review: "FICTIONAL-REVIEW-I18N" } }
          }
        ]
      },
      { id: "day-x", label: "Flexible day", slots: [{ id: "slot-2", name: "Fictional undated museum" }] }
    ],
    reminders: [{ id: "rem-1", item: "Pack fictional rain jacket", dueDate: "2027-04-01", notes: "Light one is fine." }],
    bookings: [{ provider: "FICTIONAL-EXCLUDED-BOOKING" }],
    participantGroups: [{ label: "FICTIONAL-GROUP-LABEL" }],
    members: [{ username: "fictional-member-name" }],
    audit: ["fictional-audit-entry"]
  }
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(condition, label) {
  for (let i = 0; i < 300; i++) { if (condition()) return; await tick(); }
  assert.fail(`timed out waiting for ${label}`);
}
async function idle(n = 25) { for (let i = 0; i < n; i++) await tick(); }
const json = (status, body) => new Response(body === undefined ? "" : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function fakeServer({ enabled = false, version = 0, expiresAt = null } = {}) {
  const server = {
    sharing: { enabled, version, expiresAt, createdAt: enabled ? "2026-08-01T00:00:00.000Z" : null },
    tokens: [TOKEN_A, TOKEN_B, TOKEN_C],
    calls: [],
    intercept: null,
    preview: structuredClone(PREVIEW),
    count(method, path) { return this.calls.filter((c) => c.method === method && c.path === path).length; }
  };
  server.fetch = async (path, init = {}) => {
    const call = { path, method: init.method || "GET", init, body: init.body ? JSON.parse(init.body) : undefined };
    server.calls.push(call);
    // Every request is the authenticated same-origin cookie request; never the guest share header.
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.ok(path.startsWith(BASE), `unexpected path ${path}`);
    assert.ok(!Object.keys(init.headers || {}).some((h) => /share|authorization/i.test(h)), "no share or bearer header");
    if (server.intercept) { const out = await server.intercept(call, server); if (out !== undefined) return out; }
    if (call.method === "GET" && path === BASE) return json(200, { sharing: structuredClone(server.sharing) });
    if (call.method === "GET" && path === `${BASE}/preview`) return json(200, structuredClone(server.preview));
    if (call.method === "POST" && path === BASE) {
      assert.deepEqual(Object.keys(call.body).sort(), ["expectedShareVersion", "expiresAt"]);
      if (call.body.expectedShareVersion !== server.sharing.version) return json(409, { error: { code: "share_version_conflict" } });
      server.sharing = { enabled: true, version: server.sharing.version + 1, expiresAt: call.body.expiresAt, createdAt: "2026-10-19T00:00:00.000Z" };
      return json(200, { sharing: structuredClone(server.sharing), token: server.tokens.shift() });
    }
    if (call.method === "POST" && path === `${BASE}/revoke`) {
      assert.deepEqual(Object.keys(call.body), ["expectedShareVersion"]);
      if (call.body.expectedShareVersion !== server.sharing.version) return json(409, { error: { code: "share_version_conflict" } });
      server.sharing = { enabled: false, version: server.sharing.version + 1, expiresAt: null, createdAt: null };
      return json(200, { sharing: structuredClone(server.sharing) });
    }
    return json(404, { error: { code: "not_found" } });
  };
  return server;
}

function setup(server) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><header id="trip-header"><h1>Fictional</h1></header></body></html>', { url: `${ORIGIN}/trips/${TRIP}`, pretendToBeVisual: true });
  const w = dom.window;
  const proto = w.HTMLDialogElement.prototype;
  proto.showModal = function () { this.setAttribute("open", ""); };
  proto.close = function () { if (!this.hasAttribute("open")) return; this.removeAttribute("open"); this.dispatchEvent(new w.Event("close")); };
  if (server) w.fetch = server.fetch;
  const storageWrites = [];
  // Spy on the prototype: assigning a property on a Storage instance would itself create an item.
  const originalSetItem = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = function (key, value) { storageWrites.push([key, value]); return originalSetItem.call(this, key, value); };
  const historyWrites = [];
  w.history.pushState = (...args) => historyWrites.push(args);
  w.history.replaceState = (...args) => historyWrites.push(args);
  const doc = w.document;
  return { dom, w, doc, header: doc.getElementById("trip-header"), storageWrites, historyWrites };
}

const dialogOf = (doc) => doc.querySelector("dialog.stm-dialog");
const action = (doc, name) => dialogOf(doc).querySelector(`[data-share-action="${name}"]`);
const statusText = (doc) => dialogOf(doc).querySelector('[role="status"]').textContent;
const field = (doc, name) => dialogOf(doc).querySelector(`input[name="${name}"]`);
const visible = (node) => { for (let n = node; n; n = n.parentElement) if (n.hidden) return false; return true; };
async function openDialog(ctx, handle) {
  handle.button.click();
  await waitFor(() => dialogOf(ctx.doc) && !action(ctx.doc, "refresh").disabled, "dialog load");
}
function assertNoSecret(ctx, token) {
  assert.ok(!ctx.doc.documentElement.outerHTML.includes(token), "token never serialized into DOM attributes/markup");
  assert.ok(!ctx.doc.body.textContent.includes(token), "token not in text content");
  assert.equal(ctx.storageWrites.length, 0, "no web storage writes");
  assert.equal(ctx.w.localStorage.length + ctx.w.sessionStorage.length, 0);
  assert.equal(ctx.historyWrites.length, 0, "no history writes");
  assert.equal(ctx.doc.cookie, "", "no cookies written by the module");
  assert.equal(ctx.w.location.href, `${ORIGIN}/trips/${TRIP}`, "page URL/fragment unchanged");
}

// --- Pure helpers -----------------------------------------------------------------------------------
assert.deepEqual([...SHARE_MANAGEMENT_LANGUAGES], ["en", "zh-Hans", "zh-Hant", "ja"]);
assert.equal(normalizeShareLanguage("zh-TW"), "zh-Hant");
assert.equal(normalizeShareLanguage("zh-Hant-HK"), "zh-Hant");
assert.equal(normalizeShareLanguage("zh-CN"), "zh-Hans");
assert.equal(normalizeShareLanguage("ja-JP"), "ja");
assert.equal(normalizeShareLanguage("fr"), "en");
assert.equal(normalizeShareLanguage(undefined), "en");
assert.equal(localDateTimeToIso("2001-01-01T00:00"), undefined, "past expiry rejected");
assert.equal(localDateTimeToIso("not a date"), undefined);
assert.equal(localDateTimeToIso("2030-01-02T03:04"), new Date("2030-01-02T03:04").toISOString(), "local wall time converted to ISO instant");
const KEYS = ["open", "title", "close", "before", "anyone", "review", "excluded", "once", "messaging", "recall", "enabled", "disabled", "expired", "previewTitle", "generate", "rotate", "revoke", "confirmRotate", "confirmRevoke", "linkOnce", "copy", "share", "copied", "copyManual", "conflict", "uncertain", "uncertainChanged", "uncertainUnknown", "failed", "lost", "reviewFirst", "expiryInvalid", "revokedOk", "rotatedOk", "createdOk"];
for (const language of ["zh-Hans", "zh-Hant", "ja"]) for (const key of KEYS) {
  assert.ok(shareManagementText(language, key), `${language}.${key} present`);
  assert.notEqual(shareManagementText(language, key), shareManagementText("en", key), `${language}.${key} translated`);
}

// --- Visibility: nothing is installed or fetched without management authority ------------------------
{
  const server = fakeServer();
  const ctx = setup(server);
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: false, document: ctx.doc });
  assert.equal(ctx.header.querySelector("button"), null, "ordinary member / content manager sees no launcher");
  await handle.open();
  assert.equal(dialogOf(ctx.doc), null);
  assert.equal(server.calls.length, 0, "no sharing request without canManage");
  handle.setCanManage(true);
  assert.ok(ctx.header.querySelector("button.stm-launcher"), "owner/current creator sees launcher once the coordinator grants it");
  handle.setCanManage(false);
  assert.equal(ctx.header.querySelector("button.stm-launcher"), null, "authority change hides the launcher");
  ctx.w.close();
}

// --- Four languages: first reads, actual preview text, explanation, redaction of unexpected fields -----
for (const language of SHARE_MANAGEMENT_LANGUAGES) {
  const server = fakeServer();
  const ctx = setup(server);
  const t = (key) => shareManagementText(language, key);
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, language, document: ctx.doc });
  assert.equal(handle.button.textContent, t("open"));
  assert.equal(handle.button.type, "button");
  assert.equal(ctx.doc.querySelectorAll("#share-management-styles").length, 1);
  assert.match(ctx.doc.getElementById("share-management-styles").textContent, /min-height:44px/);
  await openDialog(ctx, handle);
  handle.button.click(); // second click focuses the same dialog instead of opening another
  await idle(3);
  assert.equal(ctx.doc.querySelectorAll("dialog").length, 1);
  assert.equal(server.count("GET", BASE), 1);
  assert.equal(server.count("GET", `${BASE}/preview`), 1);
  assert.equal(server.calls.filter((c) => c.method !== "GET").length, 0, "opening never writes");
  const dialog = dialogOf(ctx.doc);
  assert.equal(dialog.lang, language);
  assert.equal(dialog.querySelector("h2").textContent, t("title"));
  assert.equal(dialog.getAttribute("aria-labelledby"), dialog.querySelector("h2").id);
  for (const key of ["anyone", "review", "excluded", "once", "messaging", "recall"]) {
    assert.equal(dialog.querySelector(`[data-share-explain="${key}"]`).textContent, t(key));
  }
  const preview = dialog.querySelector("[data-share-preview]").textContent;
  for (const text of ["Fictional <img src=x onerror=alert(1)> Coast Walk", "Meet at the fictional north gate at 09:00.", "Fictional Ferry Terminal", "09:30", "1 Example Pier, Fictional City", "Bring the printed sample map.", "Pack fictional rain jacket", "架空の海岸散歩", "九點在虛構北門集合。", "架空フェリー乗り場", "Fictional Photographer", "Fictional harbour at dawn", "Fictional undated museum", t("undated"), t("photo"), t("cover"), t("logo")]) {
    assert.ok(preview.includes(text), `${language} preview shows ${text}`);
  }
  for (const secret of FORBIDDEN) assert.ok(!dialog.textContent.includes(secret), `${language} preview never renders ${secret}`);
  assert.equal(dialog.querySelectorAll("img,script,iframe").length, 0, "trip text never becomes markup; preview loads no images");
  assert.equal(dialog.querySelector(".stm-state dd").textContent, t("disabled"));
  assert.equal(action(ctx.doc, "create").textContent, t("generate"));
  assert.equal(visible(action(ctx.doc, "revoke")), false, "no revoke while sharing is off");
  for (const button of dialog.querySelectorAll("button")) assert.equal(button.type, "button");
  action(ctx.doc, "refresh").click();
  await waitFor(() => server.count("GET", BASE) === 2 && !action(ctx.doc, "refresh").disabled, "manual refresh");
  dialog.querySelector("[data-share-close]").click();
  assert.equal(dialogOf(ctx.doc), null, "close removes the dialog");
  assert.equal(ctx.doc.activeElement, handle.button, "focus returns to launcher");
  handle.destroy();
  assert.equal(ctx.header.querySelector("button.stm-launcher"), null);
  ctx.w.close();
}

// --- Generate: explicit review, duplicate-click suppression, once-only in-memory link, copy fallback ---
{
  const server = fakeServer();
  const ctx = setup(server);
  const t = (key) => shareManagementText("en", key);
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc, navigator: {} });
  await openDialog(ctx, handle);
  assert.equal(visible(action(ctx.doc, "share")), false, "no share button without navigator.share");
  action(ctx.doc, "create").click();
  await idle();
  assert.equal(statusText(ctx.doc), t("reviewFirst"));
  assert.equal(server.count("POST", BASE), 0, "no write before explicit review");
  field(ctx.doc, "shareExpiryEnabled").click();
  field(ctx.doc, "shareExpiresAt").value = "2001-01-01T00:00";
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  await idle();
  assert.equal(statusText(ctx.doc), t("expiryInvalid"));
  assert.equal(server.count("POST", BASE), 0, "past expiry never sent");
  field(ctx.doc, "shareExpiryEnabled").click(); // back to no expiry
  action(ctx.doc, "create").click();
  action(ctx.doc, "create").click();
  await waitFor(() => statusText(ctx.doc) === t("createdOk"), "created");
  assert.equal(server.count("POST", BASE), 1, "double click sends one write");
  assert.deepEqual(server.calls.find((c) => c.method === "POST").body, { expectedShareVersion: 0, expiresAt: null });
  const link = field(ctx.doc, "shareLink");
  assert.equal(link.value, `${ORIGIN}/s/${TRIP}#${TOKEN_A}`);
  assert.equal(link.readOnly, true);
  assert.equal(link.hasAttribute("value"), false);
  assert.equal(visible(link), true);
  assertNoSecret(ctx, TOKEN_A);
  assert.equal(action(ctx.doc, "create").textContent, t("rotate"));
  assert.equal(field(ctx.doc, "shareReviewed").checked, false, "next write needs a fresh review");
  action(ctx.doc, "copy").click();
  await waitFor(() => statusText(ctx.doc) === t("copyManual"), "manual copy fallback");
  assert.equal(ctx.doc.activeElement, link);
  assert.equal(link.selectionStart, 0);
  assert.equal(link.selectionEnd, link.value.length, "whole link selected for manual copy");
  // A metadata refresh with the same version keeps the link; nothing is retrievable from the server later.
  action(ctx.doc, "refresh").click();
  await waitFor(() => server.count("GET", BASE) === 2 && !action(ctx.doc, "refresh").disabled, "refresh");
  assert.equal(link.value, `${ORIGIN}/s/${TRIP}#${TOKEN_A}`);
  action(ctx.doc, "hide").click();
  assert.equal(link.value, "", "hide drops the token");
  assert.equal(visible(link), false);
  dialogOf(ctx.doc).close();
  assert.equal(dialogOf(ctx.doc), null);
  assertNoSecret(ctx, TOKEN_A);
  // Reopening shows metadata only; the raw token cannot be shown again.
  await openDialog(ctx, handle);
  assert.equal(field(ctx.doc, "shareLink").value, "");
  assert.equal(dialogOf(ctx.doc).querySelector(".stm-state dd").textContent, t("enabled"));
  assert.ok(!server.calls.some((c) => c.method === "GET" && c.path.includes("token")));
  dialogOf(ctx.doc).close();
  ctx.w.close();
}

// --- Rotate: explicit confirm/cancel, expiry conversion, clipboard and explicit-only navigator.share ---
{
  const server = fakeServer({ enabled: true, version: 3 });
  const ctx = setup(server);
  const t = (key) => shareManagementText("zh-Hans", key);
  const copied = [], shared = [];
  const nav = { clipboard: { writeText: async (value) => { copied.push(value); } }, share: async (data) => { shared.push(data); } };
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, language: "zh-Hans", document: ctx.doc, navigator: nav });
  await openDialog(ctx, handle);
  assert.equal(action(ctx.doc, "create").textContent, t("rotate"));
  assert.equal(visible(action(ctx.doc, "revoke")), true);
  assert.equal(dialogOf(ctx.doc).querySelector(".stm-state dd").textContent, t("enabled"));
  field(ctx.doc, "shareExpiryEnabled").click();
  field(ctx.doc, "shareExpiresAt").value = "2030-01-02T03:04";
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  await idle();
  const confirmBox = dialogOf(ctx.doc).querySelector(".stm-confirm");
  assert.equal(confirmBox.hidden, false);
  assert.ok(confirmBox.textContent.includes(t("confirmRotate")));
  assert.equal(server.count("POST", BASE), 0, "rotation needs confirmation");
  action(ctx.doc, "cancel").click();
  assert.equal(confirmBox.hidden, true);
  await idle();
  assert.equal(server.count("POST", BASE), 0, "cancel sends nothing");
  action(ctx.doc, "create").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("rotatedOk"), "rotated");
  assert.deepEqual(server.calls.find((c) => c.method === "POST").body, { expectedShareVersion: 3, expiresAt: new Date("2030-01-02T03:04").toISOString() });
  const expected = `${ORIGIN}/s/${TRIP}#${TOKEN_A}`;
  assert.equal(field(ctx.doc, "shareLink").value, expected);
  assert.equal(shared.length, 0, "navigator.share is never called automatically");
  assert.equal(copied.length, 0, "clipboard is never written automatically");
  action(ctx.doc, "copy").click();
  await waitFor(() => statusText(ctx.doc) === t("copied"), "copied");
  assert.deepEqual(copied, [expected]);
  action(ctx.doc, "share").click();
  await waitFor(() => shared.length === 1, "shared");
  assert.equal(shared[0].url, expected);
  assert.equal(shared[0].title, t("shareTitle"));
  assert.ok(!JSON.stringify(shared[0]).includes("Coast Walk"), "share sheet carries a generic title only");
  assertNoSecret(ctx, TOKEN_A);
  dialogOf(ctx.doc).close();
  assert.equal(ctx.doc.body.textContent.includes(TOKEN_A), false);
  ctx.w.close();
}

// --- Revoke: explicit confirm, link cleared, state off ---------------------------------------------
{
  const server = fakeServer({ enabled: true, version: 5, expiresAt: "2031-05-01T00:00:00.000Z" });
  const ctx = setup(server);
  const t = (key) => shareManagementText("ja", key);
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, language: "ja", document: ctx.doc });
  await openDialog(ctx, handle);
  assert.equal(field(ctx.doc, "shareExpiryEnabled").checked, true, "existing expiry prefilled for the next rotation");
  assert.equal(field(ctx.doc, "shareExpiresAt").value.length, 16);
  action(ctx.doc, "revoke").click();
  await idle();
  assert.equal(server.count("POST", `${BASE}/revoke`), 0, "revocation needs confirmation");
  assert.ok(dialogOf(ctx.doc).querySelector(".stm-confirm").textContent.includes(t("confirmRevoke")));
  action(ctx.doc, "confirm").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("revokedOk"), "revoked");
  assert.equal(server.count("POST", `${BASE}/revoke`), 1);
  assert.deepEqual(server.calls.find((c) => c.method === "POST").body, { expectedShareVersion: 5 });
  assert.equal(dialogOf(ctx.doc).querySelector(".stm-state dd").textContent, t("disabled"));
  assert.equal(visible(action(ctx.doc, "revoke")), false);
  assert.equal(action(ctx.doc, "create").textContent, t("generate"));
  dialogOf(ctx.doc).close();
  ctx.w.close();
}

// --- Stale 409: refresh status and preview, never retry the write -----------------------------------
{
  const server = fakeServer({ enabled: true, version: 2 });
  const ctx = setup(server);
  const t = (key) => shareManagementText("zh-Hant", key);
  server.intercept = (call, s) => {
    if (call.method === "POST" && s.count("POST", BASE) === 1) {
      s.sharing = { ...s.sharing, version: 4 }; // a concurrent rotation by another authorized manager
      return json(409, { error: { code: "share_version_conflict" } });
    }
    return undefined;
  };
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, language: "zh-Hant", document: ctx.doc });
  await openDialog(ctx, handle);
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("conflict"), "conflict");
  await idle();
  assert.equal(server.count("POST", BASE), 1, "conflict is not retried");
  assert.equal(server.count("GET", BASE), 2);
  assert.equal(server.count("GET", `${BASE}/preview`), 2, "preview re-read too");
  assert.equal(field(ctx.doc, "shareLink").value, "");
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("rotatedOk"), "explicit second attempt");
  assert.equal(server.calls.filter((c) => c.method === "POST")[1].body.expectedShareVersion, 4, "explicit retry uses refreshed version");
  dialogOf(ctx.doc).close();
  ctx.w.close();
}

// --- Uncertain outcomes: re-read metadata, never auto-retry, never show a token not received ----------
{
  const t = (key) => shareManagementText("en", key);
  // (a) Network loss after the server applied the creation.
  let server = fakeServer();
  let ctx = setup(server);
  server.intercept = (call, s) => {
    if (call.method === "POST") { s.sharing = { enabled: true, version: 1, expiresAt: null, createdAt: "2026-10-19T00:00:00.000Z" }; throw new TypeError("fictional network loss"); }
    return undefined;
  };
  let handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  await openDialog(ctx, handle);
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  await waitFor(() => statusText(ctx.doc) === t("uncertainChanged"), "uncertain changed");
  await idle();
  assert.equal(server.count("POST", BASE), 1, "uncertain write not retried");
  assert.equal(server.count("GET", BASE), 2, "metadata re-read after uncertainty");
  assert.equal(field(ctx.doc, "shareLink").value, "");
  assert.equal(dialogOf(ctx.doc).querySelector(".stm-state dd").textContent, t("enabled"));
  dialogOf(ctx.doc).close();
  ctx.w.close();
  // (b) 5xx without a change, then 200 without a token (treated as uncertain, nothing displayed).
  server = fakeServer();
  ctx = setup(server);
  server.intercept = (call, s) => {
    if (call.method !== "POST") return undefined;
    if (s.count("POST", BASE) === 1) return json(503, { error: { code: "unavailable" } });
    s.sharing = { enabled: true, version: 1, expiresAt: null, createdAt: "2026-10-19T00:00:00.000Z" };
    return json(200, { sharing: structuredClone(s.sharing) });
  };
  handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  await openDialog(ctx, handle);
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  await waitFor(() => statusText(ctx.doc) === t("uncertain"), "uncertain unchanged");
  assert.equal(action(ctx.doc, "create").textContent, t("generate"));
  action(ctx.doc, "create").click(); // review still checked; explicit second click
  await waitFor(() => statusText(ctx.doc) === t("uncertainChanged"), "tokenless success treated as uncertain");
  assert.equal(server.count("POST", BASE), 2);
  assert.equal(field(ctx.doc, "shareLink").value, "");
  dialogOf(ctx.doc).close();
  ctx.w.close();
  // (c) Uncertain revoke that did apply; then status re-read failing entirely.
  server = fakeServer({ enabled: true, version: 8 });
  ctx = setup(server);
  server.intercept = (call, s) => {
    if (call.method === "POST") { s.sharing = { enabled: false, version: 9, expiresAt: null, createdAt: null }; throw new TypeError("fictional network loss"); }
    return undefined;
  };
  handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  await openDialog(ctx, handle);
  action(ctx.doc, "revoke").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("revokedOk"), "uncertain revoke confirmed by re-read");
  assert.equal(server.count("POST", `${BASE}/revoke`), 1);
  dialogOf(ctx.doc).close();
  ctx.w.close();
  server = fakeServer({ enabled: true, version: 8 });
  ctx = setup(server);
  server.intercept = (call, s) => { if (s.calls.length > 2) throw new TypeError("fictional offline"); return undefined; };
  handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  await openDialog(ctx, handle);
  action(ctx.doc, "revoke").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("uncertainUnknown"), "unknown state");
  assert.equal(action(ctx.doc, "create").disabled, true, "writes disabled until a successful refresh");
  assert.equal(action(ctx.doc, "refresh").disabled, false);
  dialogOf(ctx.doc).close();
  ctx.w.close();
}

// --- Late responses after close: aborted, ignored, no private text or token surfaces ------------------
{
  const server = fakeServer();
  const ctx = setup(server);
  let releasePreview, signal;
  server.intercept = (call) => {
    if (call.path === `${BASE}/preview` && !releasePreview) { signal = call.init.signal; return new Promise((resolve) => { releasePreview = resolve; }); }
    return undefined;
  };
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  handle.button.click();
  await waitFor(() => releasePreview, "pending preview");
  dialogOf(ctx.doc).querySelector("[data-share-close]").click();
  assert.equal(signal.aborted, true, "close aborts in-flight reads");
  const late = structuredClone(PREVIEW);
  late.trip.days[0].notes = "Late fictional private note";
  releasePreview(json(200, late));
  await idle();
  assert.equal(dialogOf(ctx.doc), null);
  assert.ok(!ctx.doc.body.textContent.includes("Late fictional private note"));
  // Late write success after close: its token is discarded, never displayed.
  let releaseWrite;
  server.intercept = (call, s) => {
    if (call.method === "POST") return new Promise((resolve) => { releaseWrite = () => { s.sharing = { enabled: true, version: 1, expiresAt: null, createdAt: null }; resolve(json(200, { sharing: s.sharing, token: TOKEN_B })); }; });
    return undefined;
  };
  await openDialog(ctx, handle);
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  await waitFor(() => releaseWrite, "pending write");
  dialogOf(ctx.doc).close();
  releaseWrite();
  await idle();
  assert.equal(dialogOf(ctx.doc), null);
  assertNoSecret(ctx, TOKEN_B);
  ctx.w.close();
}

// --- Authority loss: 401 reports once and closes; 403/404 hides management and the launcher -----------
{
  let server = fakeServer();
  let ctx = setup(server);
  let unauthorized = 0;
  server.intercept = () => json(401, { error: { code: "unauthorized" } });
  let handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc, onUnauthorized: () => { unauthorized++; } });
  handle.button.click();
  await waitFor(() => unauthorized === 1, "unauthorized");
  await idle();
  assert.equal(unauthorized, 1, "reported once even with two failed reads");
  assert.equal(dialogOf(ctx.doc), null);
  assert.equal(ctx.header.querySelector("button.stm-launcher"), null);
  ctx.w.close();

  server = fakeServer({ enabled: true, version: 1 });
  ctx = setup(server);
  const t = (key) => shareManagementText("en", key);
  handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  await openDialog(ctx, handle);
  server.intercept = (call) => (call.method === "POST" ? json(403, { error: { code: "forbidden" } }) : undefined);
  field(ctx.doc, "shareReviewed").click();
  action(ctx.doc, "create").click();
  action(ctx.doc, "confirm").click();
  await waitFor(() => statusText(ctx.doc) === t("lost"), "authority lost");
  assert.equal(ctx.header.querySelector("button.stm-launcher"), null, "launcher hidden after authority loss");
  assert.equal(visible(action(ctx.doc, "create")), false);
  assert.equal(dialogOf(ctx.doc).querySelector("[data-share-preview]").textContent, "", "preview text cleared");
  assert.equal(server.count("POST", BASE), 1);
  dialogOf(ctx.doc).close();
  ctx.w.close();

  server = fakeServer();
  ctx = setup(server);
  server.intercept = (call) => (call.path.endsWith("/preview") ? json(404, { error: { code: "not_found" } }) : undefined);
  handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, document: ctx.doc });
  handle.button.click();
  await waitFor(() => dialogOf(ctx.doc) && statusText(ctx.doc) === t("lost"), "deleted/inaccessible trip");
  assert.equal(ctx.header.querySelector("button.stm-launcher"), null);
  dialogOf(ctx.doc).close();
  ctx.w.close();
}

// --- Language callback is re-evaluated for each open -----------------------------------------------
{
  const server = fakeServer();
  const ctx = setup(server);
  let language = "ja";
  const handle = installShareManagement({ tripId: TRIP, container: ctx.header, canManage: true, language: () => language, document: ctx.doc });
  assert.equal(handle.button.textContent, shareManagementText("ja", "open"));
  language = "zh-Hant";
  await openDialog(ctx, handle);
  assert.equal(handle.button.textContent, shareManagementText("zh-Hant", "open"));
  assert.equal(dialogOf(ctx.doc).querySelector("h2").textContent, shareManagementText("zh-Hant", "title"));
  dialogOf(ctx.doc).close();
  language = "en-GB";
  handle.relabel();
  assert.equal(handle.button.textContent, shareManagementText("en", "open"));
  ctx.w.close();
}

console.log("Share-management DOM tests passed: owner/creator visibility parameter, contract-shaped same-origin cookie fetch, four languages, actual preview text with escaped markup and redaction of unexpected fields, explicit review/confirm before generate/rotate/revoke, duplicate-click suppression, once-only in-memory link with no storage/history/cookie/attribute writes, manual copy fallback, explicit-only navigator.share, 409 refresh without retry, uncertain outcomes re-read without retry, late responses after close ignored, and authority-loss hiding. jsdom simulation only; no browser, device or WeChat claim.");
