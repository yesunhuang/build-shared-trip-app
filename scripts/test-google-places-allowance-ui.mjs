// Browser-side allowance gate for the optional Google Places UI Kit
// (assets/app-template/public/google-places-ui-kit.js), tested in jsdom with a MOCKED Google library,
// explicitly injected monotonic and wall clocks and a controllable fictional reservation server.
//
// Nothing here contacts Google or any server. The gmp-* tags are fake custom elements (the component
// AND its nested custom children) that record constructions, every connectedCallback and
// disconnectedCallback per instance, connectedMoveCallback calls, place-request assignments and text
// queries. Element.moveBefore is absent, throws, or is a native-equivalent mock: as in Chrome and the
// HTML standard, an element WITHOUT connectedMoveCallback is disconnected and connected again by it
// (one world), and only connectedMoveCallback runs when it is defined (a second world). The app must
// never call it at all: a Google component is connected once into its own host and never reparented.
//
// Covers every app-controlled request category: Details construction and place assignment, editor
// search queries, Place ID previews, explicit retries, eviction/re-instantiation; zero activity on
// denial (no script, library or element); late and aborted reservations after cancellation, opt-out,
// sign-out or a change of state; delayed responses and long SDK loads that outlive a permit; clock
// trust (no monotonic clock, backward wall or monotonic clock, OS sleep, provider-month crossing in
// America/Los_Angeles including DST, malformed months); hidden tabs and lifecycle changes; checks
// before SDK bootstrap and before dispatch; transport retries with one idempotency key and the
// validity window from the first send; replayed and unverifiable permits; search context
// normalization; collapse/re-expand in the same host, two open cards, renderer replacement, eviction
// and explicit retry without any re-connection. UI/contract evidence only: no real SDK, billing or
// browser claim.
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  CLOCK_TOLERANCE_MS, DISPATCH_SAFETY_MS, GOOGLE_TEXT_LANGUAGES, MAPS_JS_URL, PERMIT_MAX_MS, STANDARD_TAGS, createGoogleAllowanceGate,
  createGooglePlaceHost, createGooglePlacesLoader, createPlaceDetailsManager, createPlacePreviewSession, createPlaceSearchSession, googleText,
  providerMonth, reservationContext
} from "../assets/app-template/public/google-places-ui-kit.js";

const FAKE_KEY = "FAKE-browser-key-for-tests-only-000000000";
const TRIP = "fictional-gate-trip";
const PLACE = Object.freeze({ a: "FAKE_place_gate_000A", b: "FAKE_place_gate_000B", c: "FAKE_place_gate_000C", d: "FAKE_place_gate_000D" });
const BINDING = "v1:" + "c".repeat(64);
const DETAILS = "gmp-place-details-compact";
// 2031-05-15 12:00 PDT: well inside the provider month 2031-05.
const MAY_NOON = Date.UTC(2031, 4, 15, 19, 0, 0);
const MONTH = "2031-05";
// 2031-10-31 23:59:30 PDT, thirty seconds before the provider month changes to 2031-11.
const OCT_END = Date.UTC(2031, 10, 1, 6, 59, 30);
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await tick(); };
const textOf = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------------------------
// Fixtures

// Two clocks under test control. advance(): ordinary time; sleep(): OS sleep with a paused
// monotonic clock (only the wall clock moves); jumpWall(): a wall-clock change in either direction.
function fakeClock({ mono = 1000, wall = MAY_NOON } = {}) {
  const clock = { mono, wall };
  clock.now = () => clock.mono;
  clock.wallNow = () => clock.wall;
  clock.advance = (ms) => { clock.mono += ms; clock.wall += ms; };
  clock.sleep = (ms) => { clock.wall += ms; };
  clock.jumpWall = (ms) => { clock.wall += ms; };
  return clock;
}

let permitCounter = 0;
const permitId = () => "gpr_" + String(++permitCounter).padStart(24, "0");
function grantFor(body, extra = {}, permitExtra = {}, month = MONTH) {
  return { granted: true, replayed: false, apiKey: FAKE_KEY, libraries: ["places"],
    permit: { id: permitId(), kind: body.kind, tripId: TRIP, placeId: body.placeId ?? null, month, validForMs: 45000, ...permitExtra }, ...extra };
}
const httpError = (status, code = "") => Object.assign(new Error("fictional"), { status, code });

// A fictional reservation server whose answers the test releases explicitly.
function controllableServer({ month = () => MONTH } = {}) {
  const calls = [];
  const reserve = (body) => new Promise((resolve, reject) => { calls.push({ body, resolve, reject }); });
  return {
    calls, reserve,
    grant(index = calls.length - 1, extra, permitExtra) { const response = grantFor(calls[index].body, extra, permitExtra, month()); calls[index].resolve(response); return response; },
    deny(status, code, index = calls.length - 1) { calls[index].reject(httpError(status, code)); },
    fail(index = calls.length - 1) { calls[index].reject(httpError(0, "network")); }
  };
}
// Grants immediately, with the provider month the fictional server believes is current.
function grantingServer({ month = () => MONTH } = {}) {
  const calls = [];
  return { calls, reserve: async (body) => { calls.push({ body }); return grantFor(body, {}, {}, month()); } };
}
// Every gate in this suite gets explicit clocks (never the real ones) and no real visibility events.
function gateFor(server, { clock = fakeClock(), ...options } = {}) {
  return createGoogleAllowanceGate({ tripId: TRIP, reserve: server.reserve, sleep: async () => {}, now: clock.now, wallNow: clock.wallNow,
    watchVisibility: () => () => {}, ...options });
}
const gateWith = (reserve, options) => gateFor({ reserve }, options);
function visibilityWatcher() {
  const watcher = { listener: null, subscribed: 0, unsubscribed: 0 };
  watcher.watch = (listener) => { watcher.listener = listener; watcher.subscribed += 1; return () => { watcher.listener = null; watcher.unsubscribed += 1; }; };
  watcher.fire = () => watcher.listener?.();
  return watcher;
}

function controllableLoader() {
  const loader = {
    calls: 0, keys: [], resets: 0, state: "idle", promise: null, settle: null,
    load(key) {
      loader.calls += 1;
      loader.keys.push(key);
      if (!loader.promise) { loader.state = "loading"; loader.promise = new Promise((resolve, reject) => { loader.settle = { resolve, reject }; }); loader.promise.catch(() => {}); }
      return loader.promise;
    },
    resolve() { loader.state = "ready"; loader.settle.resolve({ fictional: true }); },
    reset() { if (loader.state !== "failed") return false; loader.resets += 1; loader.promise = null; loader.state = "idle"; return true; },
    onFailure() { return () => {}; }
  };
  return loader;
}
function readyLoader() { const loader = controllableLoader(); loader.load("prime"); loader.resolve(); loader.calls = 0; loader.keys = []; return loader; }

// A jsdom world with fake standard components. withMoveCallback: the fakes also define
// connectedMoveCallback (the app must not assume it is free either).
function makeWorld({ withMoveCallback = false } = {}) {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url: "http://fictional-trips.test/trips/gate" });
  const { window } = dom;
  const doc = window.document;
  const record = { constructed: {}, instances: [], connections: 0, disconnections: 0, reconnects: [], moveCallbacks: 0, moveCalls: 0, moving: 0, placeAssignments: [], textQueries: [], created: [] };
  for (const tag of STANDARD_TAGS) {
    class FakeStandardElement extends window.HTMLElement {
      static get observedAttributes() { return ["place", "text-query"]; }
      constructor() {
        super();
        record.constructed[tag] = (record.constructed[tag] || 0) + 1;
        this.fictional = { connects: 0, disconnects: 0, moves: 0 };
        record.instances.push(this);
      }
      connectedCallback() {
        if (record.moving) return;
        record.connections += 1;
        this.fictional.connects += 1;
        if (this.fictional.connects > 1) record.reconnects.push(tag);
      }
      disconnectedCallback() {
        if (record.moving) return;
        record.disconnections += 1;
        this.fictional.disconnects += 1;
      }
      attributeChangedCallback(name, _old, value) {
        if (name === "place") record.placeAssignments.push(value);
        if (name === "text-query") record.textQueries.push(value);
      }
    }
    if (withMoveCallback) FakeStandardElement.prototype.connectedMoveCallback = function () { record.moveCallbacks += 1; this.fictional.moves += 1; };
    window.customElements.define(tag, FakeStandardElement);
  }
  const originalCreate = doc.createElement.bind(doc);
  doc.createElement = (tag, ...rest) => { record.created.push(String(tag).toLowerCase()); return originalCreate(tag, ...rest); };
  const moveModes = {
    // Native-equivalent Element.moveBefore. Without connectedMoveCallback the element and its custom
    // descendants get disconnectedCallback and connectedCallback (an ordinary insert does exactly
    // that in jsdom); with it, only connectedMoveCallback runs.
    native(node, child) {
      record.moveCalls += 1;
      if (!this.isConnected || !node.isConnected) throw new window.DOMException("Both nodes must be connected.", "HierarchyRequestError");
      if (typeof node.connectedMoveCallback !== "function") { this.insertBefore(node, child); return; }
      record.moving += 1;
      try { this.insertBefore(node, child); } finally { record.moving -= 1; }
      for (const element of [node, ...node.querySelectorAll("*")]) element.connectedMoveCallback?.();
    },
    throws() { record.moveCalls += 1; throw new window.DOMException("Simulated unsupported move.", "HierarchyRequestError"); },
    absent: undefined
  };
  const setMoveMode = (mode) => Object.defineProperty(window.Element.prototype, "moveBefore", { configurable: true, writable: true, value: moveModes[mode] });
  setMoveMode("native");
  const containers = doc.body.appendChild(doc.createElement("div"));
  return {
    window, doc, record, containers, setMoveMode,
    makeHost: (language = "en", parent = containers) => parent.appendChild(createGooglePlaceHost(doc, language)),
    gmpCreated: () => record.created.filter((tag) => tag.startsWith("gmp-")).length,
    detailsBuilt: () => record.constructed[DETAILS] || 0
  };
}

const world = makeWorld();
const { window, doc, record } = world;
const containers = world.containers;
const makeHost = (language) => world.makeHost(language);
const gmpCreated = world.gmpCreated;
const detailsBuilt = world.detailsBuilt;
const desc = (planId, placeId, extra = {}) => ({ tripId: TRIP, planId, placeId, binding: BINDING, ...extra });
const status = (host) => textOf(host.querySelector(".google-place__status"));
const action = (host) => host.querySelector(".google-place__action");
const mountOf = (host) => host.querySelector(".google-place__mount");
const family = (element) => [element, ...element.querySelectorAll("*")];
const manual = { set: () => 0, clear: () => {} };
const extraWorlds = [];

try {
  // -------------------------------------------------------------------------------------------
  // 0. Provider month: America/Los_Angeles, daylight saving time included.
  {
    for (const [ms, expected, label] of [
      [Date.UTC(2031, 3, 1, 6, 59, 59), "2031-03", "2031-03-31 23:59:59 PDT"],
      [Date.UTC(2031, 3, 1, 7, 0, 0), "2031-04", "2031-04-01 00:00 PDT (UTC is already April at 00:00Z)"],
      [Date.UTC(2031, 10, 1, 6, 59, 59), "2031-10", "2031-10-31 23:59:59 PDT"],
      [Date.UTC(2031, 10, 1, 7, 0, 0), "2031-11", "2031-11-01 00:00 PDT (DST still in force until 2031-11-02)"],
      [Date.UTC(2031, 11, 1, 7, 59, 59), "2031-11", "2031-11-30 23:59:59 PST"],
      [Date.UTC(2031, 11, 1, 8, 0, 0), "2031-12", "2031-12-01 00:00 PST"],
      [Date.UTC(2031, 0, 1, 7, 59, 59), "2030-12", "2030-12-31 23:59:59 PST (UTC is already 2031)"],
      [Date.UTC(2031, 0, 1, 8, 0, 0), "2031-01", "2031-01-01 00:00 PST"],
      [MAY_NOON, MONTH, "fixture"]
    ]) assert.equal(providerMonth(ms), expected, label);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null, "2031-05-01"]) assert.equal(providerMonth(bad), "", `no month for ${String(bad)}`);
  }

  // -------------------------------------------------------------------------------------------
  // 1. The gate itself

  {
    // 1a. One request, one permit, one dispatch; the body names nothing but kind/plan/Place ID.
    const server = grantingServer();
    const clock = fakeClock();
    const gate = gateFor(server, { clock, newRequestKey: () => "fictional-key-0000000001" });
    const grant = await gate.acquire({ kind: "details", planId: "plan-a", placeId: PLACE.a });
    assert.deepEqual(server.calls.map((call) => call.body), [{ requestId: "fictional-key-0000000001", kind: "details", planId: "plan-a", placeId: PLACE.a }]);
    assert.equal(grant.granted, true);
    assert.equal(grant.apiKey, FAKE_KEY);
    assert.equal(grant.permit.deadline, 1000 + 45000 - DISPATCH_SAFETY_MS, "monotonic validity is measured from when the request was sent");
    assert.equal(grant.permit.wallDeadline, MAY_NOON + 45000 - DISPATCH_SAFETY_MS, "and so is the wall-clock validity");
    assert.equal(grant.permit.month, MONTH);
    let runs = 0;
    assert.deepEqual(gate.dispatch(grant, { kind: "details", placeId: PLACE.a }, () => { runs += 1; }), { dispatched: true, reason: "" });
    assert.deepEqual(gate.dispatch(grant, { kind: "details", placeId: PLACE.a }, () => { runs += 1; }), { dispatched: false, reason: "consumed" }, "a permit is single-use");
    assert.equal(runs, 1);
    // Regression: a search given plan/Place ID context drops it consistently (request body AND the
    // permit it verifies), so the permit is verified and then refused for another kind.
    const search = await gate.acquire({ kind: "search", planId: "ignored", placeId: "ignored" });
    assert.deepEqual(Object.keys(server.calls[1].body).sort(), ["kind", "requestId"], "a search reservation carries no plan, Place ID or text");
    assert.equal(search.granted, true, "the ignored context does not make the search grant unverifiable");
    assert.deepEqual([search.permit.kind, search.permit.planId, search.permit.placeId], ["search", "", ""], "the search permit is bound to no plan or place");
    assert.equal(gate.dispatch(search, { kind: "details", placeId: PLACE.a }, () => assert.fail("must not run")).reason, "mismatch", "a permit only authorizes its own kind");
    assert.equal(gate.dispatch(search, { kind: "preview", placeId: PLACE.a }, () => assert.fail("must not run")).reason, "mismatch", "a search permit never authorizes a preview");
    assert.equal(gate.dispatch(search, { kind: "search" }, () => {}).dispatched, true, "but does authorize its own search");
    const preview = await gate.acquire({ kind: "preview", placeId: PLACE.b });
    assert.equal(gate.dispatch(preview, { kind: "preview", placeId: PLACE.c }, () => {}).reason, "mismatch", "and its own Place ID");
    assert.equal(gate.dispatch(preview, { kind: "details", placeId: PLACE.b }, () => {}).reason, "mismatch", "a preview permit never authorizes saved details");
    assert.equal(gate.dispatch(preview, { kind: "preview", placeId: PLACE.b, isCurrent: () => false }, () => {}).reason, "notCurrent", "the caller's state is re-checked synchronously");
    assert.equal(gate.check(preview, { kind: "preview", placeId: PLACE.b }), "", "the pre-bootstrap check passes");
    assert.equal(gate.check(preview, { kind: "preview", placeId: PLACE.b }), "", "and consumes nothing");
    assert.equal(gate.dispatch(preview, { kind: "preview", placeId: PLACE.b }, () => {}).dispatched, true, "refusals and checks did not consume it");
    assert.equal(gate.check(preview, { kind: "preview", placeId: PLACE.b }), "consumed");
    const throwing = await gate.acquire({ kind: "search" });
    assert.throws(() => gate.dispatch(throwing, { kind: "search" }, () => { throw new Error("fictional"); }));
    assert.equal(gate.dispatch(throwing, { kind: "search" }, () => {}).reason, "consumed", "work that threw still used its permit");
  }

  {
    // 1b. Unsupported reservation context is refused BEFORE anything is reserved.
    const server = grantingServer();
    const gate = gateFor(server);
    for (const request of [{}, { kind: "photos" }, { kind: "details", placeId: PLACE.a }, { kind: "details", planId: "plan-a", placeId: "not a place id!" },
      { kind: "details", planId: "plan-a" }, { kind: "preview" }, { kind: "preview", placeId: "x" }, { kind: "details", planId: 7, placeId: PLACE.a }]) {
      assert.deepEqual(await gate.acquire(request), { granted: false, reason: "invalid" }, JSON.stringify(request));
    }
    assert.equal(server.calls.length, 0, "nothing was reserved for unsupported context");
    assert.equal(gate.stats.invalid, 8);
    assert.deepEqual(reservationContext({ kind: "search", planId: "p", placeId: PLACE.a }), { kind: "search", planId: "", placeId: "" });
    assert.deepEqual(reservationContext({ kind: "preview", planId: "p", placeId: PLACE.a }), { kind: "preview", planId: "", placeId: PLACE.a });
    assert.deepEqual((await gate.acquire({ kind: "preview", planId: "dropped", placeId: PLACE.a })).granted, true);
    assert.deepEqual(Object.keys(server.calls[0].body).sort(), ["kind", "placeId", "requestId"], "a preview carries only its Place ID");
  }

  {
    // 1c. Expiry: a slow response or a long wait never dispatches with an old permit.
    const server = controllableServer();
    const clock = fakeClock();
    const gate = gateFor(server, { clock });
    const pending = gate.acquire({ kind: "details", planId: "plan-a", placeId: PLACE.a });
    await tick();
    clock.advance(50_000);
    server.grant();
    const late = await pending;
    assert.equal(late.granted, true, "the answer itself is well formed");
    assert.equal(gate.check(late, { kind: "details", placeId: PLACE.a }), "expired", "no SDK bootstrap with a permit older than its window");
    assert.equal(gate.dispatch(late, { kind: "details", placeId: PLACE.a }, () => assert.fail("must not run")).reason, "expired", "a response slower than the permit cannot start work");
    const second = gate.acquire({ kind: "search" });
    await tick();
    server.grant(undefined, undefined, { validForMs: 10 * 60_000 });
    const capped = await second;
    assert.equal(capped.permit.deadline, clock.mono + PERMIT_MAX_MS - DISPATCH_SAFETY_MS, "an over-long validity is capped");
    assert.equal(capped.permit.wallDeadline, clock.wall + PERMIT_MAX_MS - DISPATCH_SAFETY_MS);
    clock.advance(PERMIT_MAX_MS);
    assert.equal(gate.usable(capped, { kind: "search" }), false);
    assert.equal(gate.dispatch(capped, { kind: "search" }, () => assert.fail("must not run")).reason, "expired");
    assert.equal(gate.blocked, "", "ordinary expiry blocks nothing");
  }

  {
    // 1d. Unverifiable answers never authorize anything (including malformed provider months).
    const bad = [
      (body) => ({ ...grantFor(body), granted: false }),
      (body) => ({ ...grantFor(body), permit: null }),
      (body) => grantFor(body, {}, { id: "not-a-permit" }),
      (body) => grantFor(body, {}, { kind: "search" }),
      (body) => grantFor(body, {}, { tripId: "fictional-other-trip" }),
      (body) => grantFor(body, {}, { placeId: PLACE.c }),
      (body) => grantFor(body, {}, { validForMs: 0 }),
      (body) => grantFor(body, {}, { validForMs: -5 }),
      (body) => grantFor(body, {}, { validForMs: Number.NaN }),
      (body) => grantFor(body, {}, { validForMs: "45000" }),
      (body) => grantFor(body, { apiKey: "" }),
      (body) => grantFor(body, { apiKey: "has spaces in it 0000000000000000" }),
      (body) => grantFor(body, {}, { month: "2031-13" }),
      (body) => grantFor(body, {}, { month: "2031-5" }),
      (body) => grantFor(body, {}, { month: "31-05" }),
      (body) => grantFor(body, {}, { month: "" }),
      (body) => grantFor(body, {}, { month: 203105 }),
      (body) => grantFor(body, {}, { month: null }),
      (body) => { const answer = grantFor(body); delete answer.permit.month; return answer; },
      () => null,
      () => "granted"
    ];
    for (const [index, make] of bad.entries()) {
      const gate = gateWith(async (body) => make(body));
      const grant = await gate.acquire({ kind: "details", planId: "plan-a", placeId: PLACE.a });
      assert.deepEqual(grant, { granted: false, reason: "unverifiable" }, `unverifiable answer ${index}`);
      assert.equal(gate.dispatch(grant, { kind: "details", placeId: PLACE.a }, () => assert.fail("must not run")).dispatched, false);
    }
  }

  {
    // 1e. Transport retries reuse one idempotency key, and the window starts at the FIRST send.
    let attempt = 0;
    const seen = [];
    const clock = fakeClock();
    const flaky = gateWith(async (body) => {
      seen.push(body.requestId);
      attempt += 1;
      // The first transport times out after 8 s; the server had already issued the permit then.
      if (attempt === 1) { clock.advance(8000); throw httpError(0, "network"); }
      return grantFor(body, { replayed: true });
    }, { clock });
    const grant = await flaky.acquire({ kind: "search" });
    assert.equal(grant.granted, true);
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1], "the retry reuses the same durable idempotency key");
    assert.equal(flaky.stats.acquisitions, 1, "one attempt, two transports");
    assert.equal(flaky.stats.replays, 1);
    assert.equal(grant.permit.deadline, 1000 + 45000 - DISPATCH_SAFETY_MS, "a replayed answer is valid from the first send, never from the retry");
    let proxyAttempts = 0;
    const proxy = gateWith(async (body) => { proxyAttempts += 1; if (proxyAttempts === 1) throw httpError(502); return grantFor(body); });
    assert.equal((await proxy.acquire({ kind: "search" })).granted, true, "a code-less proxy 502 is a transport failure");
    let downAttempts = 0;
    const down = gateWith(async () => { downAttempts += 1; throw httpError(0, "timeout"); });
    assert.deepEqual(await down.acquire({ kind: "search" }), { granted: false, reason: "unavailable" });
    assert.equal(downAttempts, 2, "at most one transport retry");
    for (const [statusCode, code, reason] of [[503, "google_allowance_unavailable", "unavailable"], [503, "google_allowance_clock_uncertain", "unavailable"], [503, "google_allowance_month_boundary", "boundary"], [429, "google_allowance_exhausted", "exhausted"], [403, "forbidden", "forbidden"], [409, "google_place_not_linked", "notCurrent"]]) {
      let calls = 0;
      const gate = gateWith(async () => { calls += 1; throw httpError(statusCode, code); });
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason }, code);
      assert.equal(calls, 1, `${code} is a decision, never retried`);
    }
  }

  {
    // 1f. Blocking denials, explicit unblock, sign-out, cancellation and disposal.
    const server = controllableServer();
    const gate = gateFor(server);
    const first = gate.acquire({ kind: "search" });
    await tick();
    server.deny(429, "google_allowance_exhausted");
    assert.deepEqual(await first, { granted: false, reason: "exhausted" });
    assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "exhausted" });
    assert.equal(server.calls.length, 1, "a blocked page asks nothing more");
    gate.unblock();
    const again = gate.acquire({ kind: "search" });
    await tick();
    assert.equal(server.calls.length, 2, "an explicit Try again asks once");
    server.grant();
    const grant = await again;
    gate.cancelAll();
    assert.equal(gate.dispatch(grant, { kind: "search" }, () => assert.fail("must not run")).reason, "cancelled", "an opt-out voids unused permits");
    const inFlight = gate.acquire({ kind: "search" });
    await tick();
    gate.cancelAll();
    server.grant();
    assert.deepEqual(await inFlight, { granted: false, reason: "cancelled" }, "a grant arriving after an opt-out is ignored");
    const signOut = gate.acquire({ kind: "search" });
    await tick();
    server.deny(401, "unauthorized");
    assert.deepEqual(await signOut, { granted: false, reason: "signedOut" });
    assert.equal(gate.disposed, true, "a sign-out ends the gate");
    const before = server.calls.length;
    assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "cancelled" });
    assert.equal(server.calls.length, before, "nothing is reserved after a sign-out");
    const other = gateFor(server);
    const pendingDispose = other.acquire({ kind: "search" });
    await tick();
    other.dispose();
    server.grant();
    assert.deepEqual(await pendingDispose, { granted: false, reason: "cancelled" }, "a late grant after disposal is ignored");
  }

  {
    // 1g. Hidden tabs reserve and dispatch nothing; any visibility or lifecycle change voids
    //     outstanding permits for good, including one still in flight.
    let visible = false;
    const server = controllableServer();
    const watcher = visibilityWatcher();
    const gate = gateFor(server, { isVisible: () => visible, watchVisibility: watcher.watch });
    assert.equal(watcher.subscribed, 1);
    assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "hidden" });
    assert.equal(server.calls.length, 0, "a background tab sends no reservation");
    visible = true;
    let pending = gate.acquire({ kind: "search" });
    await tick();
    server.grant();
    const grant = await pending;
    visible = false;
    assert.equal(gate.check(grant, { kind: "search" }), "hidden", "no SDK bootstrap in a hidden tab");
    assert.equal(gate.dispatch(grant, { kind: "search" }, () => assert.fail("must not run")).reason, "hidden", "a tab hidden before dispatch does not start work");
    visible = true;
    watcher.fire(); watcher.fire();
    assert.equal(gate.usable(grant, { kind: "search" }), false, "hidden and shown again: the old permit is never reused");
    assert.equal(gate.dispatch(grant, { kind: "search" }, () => assert.fail("must not run")).reason, "hidden");
    pending = gate.acquire({ kind: "search" });
    await tick();
    watcher.fire();
    server.grant();
    assert.deepEqual(await pending, { granted: false, reason: "hidden" }, "an answer that arrives after the tab was hidden is not used");
    gate.dispose();
    assert.equal(watcher.unsubscribed, 1, "disposal stops watching");
  }

  {
    // 1h. A replayed permit ID is refused after first use, whatever the request key was.
    const fixed = permitId();
    const gate = gateWith(async (body) => grantFor(body, {}, { id: fixed }));
    const one = await gate.acquire({ kind: "search" });
    const two = await gate.acquire({ kind: "search" });
    assert.equal(gate.dispatch(one, { kind: "search" }, () => {}).dispatched, true);
    assert.equal(gate.dispatch(two, { kind: "search" }, () => assert.fail("must not run")).reason, "consumed", "replaying one successful response never becomes another attempt");
  }

  {
    // 1i. Clock trust. No monotonic clock, or no provider month: fail closed before reserving.
    for (const [label, options] of [
      ["NaN monotonic clock", { now: () => Number.NaN }],
      ["throwing monotonic clock", { now: () => { throw new Error("fictional"); } }],
      ["non-number monotonic clock", { now: () => "1000" }],
      ["NaN wall clock", { wallNow: () => Number.NaN }],
      ["no provider month (no time-zone support)", { monthOf: () => "" }],
      ["malformed provider month", { monthOf: () => "2031-5" }]
    ]) {
      const server = grantingServer();
      const gate = gateFor(server, options);
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "clock" }, label);
      assert.equal(server.calls.length, 0, `${label}: nothing reserved`);
      assert.equal(gate.blocked, "clock", `${label}: blocked until an explicit Try again`);
      assert.deepEqual(await gate.acquire({ kind: "details", planId: "plan-a", placeId: PLACE.a }), { granted: false, reason: "clock" });
      gate.unblock();
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "clock" }, `${label}: Try again asks the clock again, not the server`);
      assert.equal(server.calls.length, 0);
    }
    // The production default has no Date.now() fallback: without performance.now nothing is reserved.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "performance");
    assert.ok(descriptor?.configurable, "fixture: performance can be hidden for this check");
    Object.defineProperty(globalThis, "performance", { configurable: true, writable: true, value: undefined });
    try {
      const server = grantingServer();
      const gate = createGoogleAllowanceGate({ tripId: TRIP, reserve: server.reserve, sleep: async () => {}, watchVisibility: () => () => {} });
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "clock" }, "no monotonic clock in production: fail closed");
      assert.equal(server.calls.length, 0);
    } finally {
      Object.defineProperty(globalThis, "performance", descriptor);
    }

    // The wall clock runs backwards while the request is in flight: the answer is not used.
    {
      const server = controllableServer();
      const clock = fakeClock();
      const gate = gateFor(server, { clock });
      const pending = gate.acquire({ kind: "search" });
      await tick();
      clock.advance(200);
      clock.jumpWall(-(CLOCK_TOLERANCE_MS + 1000));
      server.grant();
      assert.deepEqual(await pending, { granted: false, reason: "clock" });
      assert.equal(gate.blocked, "clock");
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "clock" });
      assert.equal(server.calls.length, 1, "a page with an untrustworthy clock keeps no reservations coming");
    }
    // Backward wall clock, or backward monotonic clock, between grant and dispatch.
    for (const [label, change] of [
      ["wall clock set back", (clock) => clock.jumpWall(-5000)],
      ["wall clock behind the monotonic clock beyond tolerance", (clock) => { clock.mono += CLOCK_TOLERANCE_MS + 500; }],
      ["monotonic clock running backwards", (clock) => { clock.mono -= 10; }]
    ]) {
      const clock = fakeClock();
      const gate = gateFor(grantingServer(), { clock });
      const grant = await gate.acquire({ kind: "search" });
      change(clock);
      assert.equal(gate.usable(grant, { kind: "search" }), false, label);
      assert.equal(gate.dispatch(grant, { kind: "search" }, () => assert.fail("must not run")).reason, "clock", label);
      assert.equal(gate.blocked, "clock", `${label}: blocked`);
    }
    // OS sleep with a paused monotonic clock: the wall clock runs ahead, so the permit is too old.
    {
      const clock = fakeClock();
      const server = grantingServer();
      const gate = gateFor(server, { clock });
      const grant = await gate.acquire({ kind: "search" });
      clock.advance(1000);
      clock.sleep(CLOCK_TOLERANCE_MS - 500);
      assert.equal(gate.check(grant, { kind: "search" }), "", "a small drift inside the tolerance is accepted");
      clock.sleep(10 * 60_000);
      assert.equal(gate.check(grant, { kind: "search" }), "expired", "after sleep the monotonic clock alone would still say 'fresh'");
      assert.equal(gate.dispatch(grant, { kind: "search" }, () => assert.fail("must not run")).reason, "expired");
      assert.equal(gate.blocked, "", "sleep is not a clock fault: nothing is blocked");
      const slept = controllableServer();
      const sleepy = gateFor(slept, { clock });
      const inFlight = sleepy.acquire({ kind: "search" });
      await tick();
      clock.sleep(5 * 60_000);
      slept.grant();
      const lateAfterSleep = await inFlight;
      assert.equal(sleepy.dispatch(lateAfterSleep, { kind: "search" }, () => assert.fail("must not run")).reason, "expired", "an answer that arrives after a sleep is never dispatched");
      // A wall clock moved forward without sleeping behaves the same.
      const jumped = gateFor(grantingServer(), { clock });
      const forward = await jumped.acquire({ kind: "search" });
      clock.jumpWall(60_000);
      assert.equal(jumped.dispatch(forward, { kind: "search" }, () => assert.fail("must not run")).reason, "expired");
    }
  }

  {
    // 1j. Provider-month crossings (America/Los_Angeles) never reuse the old month's grant.
    // A late answer that crosses the month while in flight.
    {
      const clock = fakeClock({ wall: OCT_END });
      const server = controllableServer({ month: () => "2031-10" });
      const gate = gateFor(server, { clock });
      const pending = gate.acquire({ kind: "search" });
      await tick();
      clock.advance(40_000);
      server.grant();
      assert.deepEqual(await pending, { granted: false, reason: "month" }, "sent in October, answered in November: not used");
      assert.equal(gate.blocked, "", "a boundary crossing is not a clock fault");
    }
    // Granted in October; bootstrap/dispatch would happen in November.
    {
      const clock = fakeClock({ wall: OCT_END + 10_000 });
      const gate = gateFor(grantingServer({ month: () => "2031-10" }), { clock });
      const grant = await gate.acquire({ kind: "details", planId: "plan-a", placeId: PLACE.a });
      assert.equal(grant.granted, true);
      assert.equal(gate.check(grant, { kind: "details", placeId: PLACE.a }), "");
      clock.advance(25_000);
      assert.equal(providerMonth(clock.wall), "2031-11", "fixture: now in the next provider month");
      assert.equal(gate.check(grant, { kind: "details", placeId: PLACE.a }), "month", "no SDK bootstrap with last month's permit");
      assert.equal(gate.dispatch(grant, { kind: "details", placeId: PLACE.a }, () => assert.fail("must not run")).reason, "month");
      assert.equal(gate.blocked, "");
    }
    // A hidden tab that sleeps across the boundary: voided by the lifecycle change and by time.
    {
      const clock = fakeClock({ wall: OCT_END });
      const watcher = visibilityWatcher();
      const gate = gateFor(grantingServer({ month: () => "2031-10" }), { clock, watchVisibility: watcher.watch });
      const grant = await gate.acquire({ kind: "search" });
      watcher.fire();
      clock.sleep(2 * 3600_000);
      watcher.fire();
      assert.equal(gate.dispatch(grant, { kind: "search" }, () => assert.fail("must not run")).reason, "hidden");
      const silent = gateFor(grantingServer({ month: () => "2031-10" }), { clock: fakeClock({ wall: OCT_END }) });
      const silentGrant = await silent.acquire({ kind: "search" });
      assert.equal(silent.usable(silentGrant, { kind: "search" }), true);
    }
    // The device month disagrees with the server's (no crossing during the request): blocked.
    {
      const server = grantingServer({ month: () => "2031-06" });
      const gate = gateFor(server);
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "clock" });
      assert.equal(gate.blocked, "clock");
      assert.deepEqual(await gate.acquire({ kind: "search" }), { granted: false, reason: "clock" });
      assert.equal(server.calls.length, 1, "no more reservations are spent with a wrong device month");
    }
    // DST: the same UTC instant is still March in Los Angeles.
    {
      const clock = fakeClock({ wall: Date.UTC(2031, 3, 1, 6, 0, 0) });
      const april = gateFor(grantingServer({ month: () => "2031-04" }), { clock });
      assert.deepEqual(await april.acquire({ kind: "search" }), { granted: false, reason: "clock" }, "a UTC-month permit is refused before the Pacific month changes");
      const march = gateFor(grantingServer({ month: () => "2031-03" }), { clock });
      assert.equal((await march.acquire({ kind: "search" })).granted, true, "the Pacific month is the boundary");
    }
  }

  // -------------------------------------------------------------------------------------------
  // 2. Loader: no key, no script

  {
    const win = { document: doc };
    const injected = [];
    const loader = createGooglePlacesLoader({ win, injectScript: async (src) => { injected.push(src); } });
    await assert.rejects(loader.load(undefined), (error) => error.code === "unavailable");
    assert.equal(injected.length, 0, "no script without a key from a granted reservation");
    assert.equal(doc.head.querySelectorAll(`script[src^="${MAPS_JS_URL}"]`).length, 0);
  }

  // -------------------------------------------------------------------------------------------
  // 3. Details manager

  {
    // 3a. Denials: zero Google activity, translated accessible status, retry semantics.
    for (const [code, statusCode, state, key, retry] of [
      ["google_allowance_exhausted", 429, "limit", "limitReached", false],
      ["google_allowance_unconfigured", 503, "paused", "paused", true],
      ["google_allowance_unavailable", 503, "paused", "paused", true],
      ["google_allowance_clock_uncertain", 503, "paused", "paused", true]
    ]) {
      for (const language of GOOGLE_TEXT_LANGUAGES) {
        let calls = 0;
        const gate = gateWith(async () => { calls += 1; throw httpError(statusCode, code); });
        const loader = controllableLoader();
        const manager = createPlaceDetailsManager({ doc, loader, gate, language: () => language, setTimer: manual.set, clearTimer: manual.clear });
        const host = makeHost(language);
        const before = gmpCreated();
        assert.equal(await manager.show(host, desc("plan-a", PLACE.a)), false);
        assert.equal(host.dataset.googlePlaceState, state);
        assert.equal(status(host), googleText(language, key), `${code} ${language}: translated status`);
        assert.equal(host.querySelector(".google-place__status").getAttribute("role"), "status");
        assert.equal(mountOf(host).hidden, true);
        assert.equal(action(host).hidden, !retry, `${code}: retry offered only when it can help`);
        assert.deepEqual([loader.calls, gmpCreated() - before], [0, 0], `${code}: no library load and no Google element`);
        manager.deactivate(desc("plan-a", PLACE.a));
        await manager.show(host, desc("plan-a", PLACE.a));
        await manager.show(makeHost(language), desc("plan-b", PLACE.b));
        assert.equal(calls, 1, `${code}: re-expansion and other plans ask nothing more`);
        if (retry) {
          action(host).click();
          await settle();
          assert.equal(calls, 2, `${code}: an explicit Try again asks exactly once`);
          assert.equal(loader.calls, 0);
        }
        manager.dispose();
      }
    }
    const offGate = gateWith(async () => { throw httpError(503, "google_places_disabled"); });
    const offManager = createPlaceDetailsManager({ doc, loader: controllableLoader(), gate: offGate, setTimer: manual.set, clearTimer: manual.clear });
    const offHost = makeHost();
    await offManager.show(offHost, desc("plan-a", PLACE.a));
    assert.equal(offHost.hidden, true, "a site switched off hides the host");
    offManager.dispose();
  }

  {
    // 3b. Rapid repeated expansion while a reservation is pending: one reservation, one component;
    //     a re-render releases it and restores nothing by itself.
    const server = controllableServer();
    const gate = gateFor(server);
    const loader = readyLoader();
    const manager = createPlaceDetailsManager({ doc, loader, gate, setTimer: manual.set, clearTimer: manual.clear });
    const root = containers.appendChild(doc.createElement("div"));
    const host = world.makeHost("en", root);
    const d = desc("plan-rapid", PLACE.a);
    const before = detailsBuilt();
    const shows = [];
    for (let round = 0; round < 5; round += 1) { shows.push(manager.show(host, d)); manager.deactivate(d); }
    const final = manager.show(host, d);
    await tick();
    assert.equal(server.calls.length, 1, "five toggles while reserving send one reservation");
    server.grant(0);
    assert.equal(await final, true);
    for (const shown of shows) assert.equal(await shown, false, "superseded expansions build nothing");
    assert.equal(detailsBuilt() - before, 1);
    assert.equal(loader.keys.at(-1), FAKE_KEY);
    const element = host.querySelector(DETAILS);
    for (let round = 0; round < 3; round += 1) { manager.deactivate(d); assert.equal(await manager.show(host, d), true); }
    assert.equal(host.querySelector(DETAILS), element, "same element in the same host");
    manager.releaseWithin(root);
    root.replaceChildren();
    const rebuilt = world.makeHost("en", root);
    assert.equal(await manager.restore(rebuilt, d), false, "a re-render never re-attaches a released component");
    assert.equal(rebuilt.dataset.googlePlaceState, "inactive");
    assert.deepEqual([server.calls.length, detailsBuilt() - before, element.isConnected, element.fictional.connects], [1, 1, false, 1], "repeated expansion and renders: no new reservation, construction or connection");
    manager.dispose();
  }

  {
    // 3c. A long SDK load outlives the permit: nothing is dispatched; an explicit show reserves again.
    const server = grantingServer();
    const clock = fakeClock();
    const gate = gateFor(server, { clock });
    const loader = controllableLoader();
    const manager = createPlaceDetailsManager({ doc, loader, gate, setTimer: manual.set, clearTimer: manual.clear });
    const host = makeHost();
    const before = detailsBuilt();
    const shown = manager.show(host, desc("plan-slow", PLACE.b));
    await settle();
    assert.equal(loader.calls, 1, "the SDK load started with the granted key");
    clock.advance(46_000);
    loader.resolve();
    assert.equal(await shown, false);
    assert.equal(detailsBuilt() - before, 0, "an expired permit never builds a component");
    assert.equal(host.dataset.googlePlaceState, "inactive");
    assert.equal(textOf(action(host)), googleText("en", "showDetails"), "the plan offers an explicit control");
    action(host).click();
    await settle();
    assert.deepEqual([server.calls.length, detailsBuilt() - before], [2, 1], "the explicit show had its own reservation");
    manager.dispose();
  }

  {
    // 3d. Opt-out or a changed association between approval and dispatch: nothing is built and
    //     the permit is not consumed.
    const server = grantingServer();
    const gate = gateFor(server);
    const loader = controllableLoader();
    let current = true;
    const manager = createPlaceDetailsManager({ doc, loader, gate, isCurrent: () => current, setTimer: manual.set, clearTimer: manual.clear });
    const host = makeHost();
    const before = detailsBuilt();
    const shown = manager.show(host, desc("plan-optout", PLACE.c));
    await settle();
    current = false;
    loader.resolve();
    assert.equal(await shown, false);
    assert.deepEqual([detailsBuilt() - before, gate.stats.dispatched, gate.stats.refused], [0, 0, 1], "refused synchronously at dispatch time");
    manager.dispose();
  }

  {
    // 3e. Eviction and re-instantiation each reserve; failures need an explicit retry.
    const server = grantingServer();
    const gate = gateFor(server);
    const manager = createPlaceDetailsManager({ doc, loader: readyLoader(), gate, maxRetained: 1, setTimer: manual.set, clearTimer: manual.clear });
    const before = detailsBuilt();
    const first = makeHost();
    await manager.show(first, desc("plan-e1", PLACE.a));
    const evicted = first.querySelector(DETAILS);
    await manager.show(makeHost(), desc("plan-e2", PLACE.b));
    assert.equal(evicted.isConnected, false, "beyond the bound the inactive component is removed for good");
    assert.equal(first.dataset.googlePlaceState, "inactive");
    const host = makeHost();
    await manager.show(host, desc("plan-e1", PLACE.a));
    assert.deepEqual([server.calls.length, detailsBuilt() - before], [3, 3], "an evicted component is re-instantiated only with a new reservation");
    assert.equal(evicted.fictional.connects, 1, "and the evicted one is never connected again");
    host.querySelector(DETAILS).dispatchEvent(new window.Event("gmp-error"));
    manager.deactivate(desc("plan-e1", PLACE.a));
    await manager.show(host, desc("plan-e1", PLACE.a));
    assert.equal(server.calls.length, 3, "a failure is never retried automatically");
    action(host).click();
    await settle();
    assert.deepEqual([server.calls.length, detailsBuilt() - before], [4, 4], "an explicit retry reserves once and builds once");
    manager.dispose();
  }

  {
    // 3f. A hidden tab: no reservation; the card offers an explicit control.
    let visible = false;
    const server = grantingServer();
    const manager = createPlaceDetailsManager({ doc, loader: readyLoader(), gate: gateFor(server, { isVisible: () => visible }), setTimer: manual.set, clearTimer: manual.clear });
    const host = makeHost();
    assert.equal(await manager.show(host, desc("plan-hidden", PLACE.a)), false);
    assert.deepEqual([server.calls.length, host.dataset.googlePlaceState], [0, "inactive"]);
    visible = true;
    action(host).click();
    await settle();
    assert.equal(server.calls.length, 1);
    manager.dispose();
  }

  {
    // 3g. The pre-bootstrap check runs synchronously before the SDK load, the dispatch check after
    //     it; a clock fault, a month change or a lifecycle change in between starts no SDK work.
    const spyGate = (real, order, hook) => ({
      acquire: (request) => real.acquire(request),
      usable: (grant, expected) => real.usable(grant, expected),
      unblock: () => real.unblock(),
      check(grant, expected) { order.push("check"); hook?.(); return real.check(grant, expected); },
      dispatch(grant, expected, work) { order.push("dispatch"); return real.dispatch(grant, expected, work); }
    });
    const spyLoader = (order) => {
      const loader = controllableLoader();
      const load = loader.load;
      loader.load = (key) => { order.push("load"); return load(key); };
      return loader;
    };
    {
      const order = [];
      const loader = spyLoader(order);
      const manager = createPlaceDetailsManager({ doc, loader, gate: spyGate(gateFor(grantingServer()), order), setTimer: manual.set, clearTimer: manual.clear });
      const shown = manager.show(makeHost(), desc("plan-order", PLACE.a));
      await settle();
      loader.resolve();
      assert.equal(await shown, true);
      assert.deepEqual(order, ["check", "load", "dispatch"], "checked before the SDK bootstrap and again before the dispatch");
      manager.dispose();
    }
    for (const [label, start, month, hook, state] of [
      ["wall clock set back", MAY_NOON, () => MONTH, (clock) => clock.jumpWall(-5000), "paused"],
      ["provider month changed", OCT_END + 10_000, null, (clock) => clock.advance(25_000), "inactive"],
      ["tab hidden and shown again", MAY_NOON, () => MONTH, (_clock, watcher) => { watcher.fire(); watcher.fire(); }, "inactive"],
      ["laptop slept", MAY_NOON, () => MONTH, (clock) => clock.sleep(15 * 60_000), "inactive"]
    ]) {
      const clock = fakeClock({ wall: start });
      const watcher = visibilityWatcher();
      const server = grantingServer({ month: month || (() => providerMonth(clock.wall)) });
      const real = gateFor(server, { clock, watchVisibility: watcher.watch });
      const order = [];
      let fired = false;
      const loader = spyLoader(order);
      const manager = createPlaceDetailsManager({ doc, loader, gate: spyGate(real, order, () => { if (!fired) { fired = true; hook(clock, watcher); } }), setTimer: manual.set, clearTimer: manual.clear });
      const host = makeHost();
      const before = gmpCreated();
      assert.equal(await manager.show(host, desc("plan-preflight", PLACE.b)), false, label);
      assert.deepEqual(order, ["check"], `${label}: refused before any SDK bootstrap`);
      assert.deepEqual([loader.calls, gmpCreated() - before, real.stats.dispatched], [0, 0, 0], `${label}: no load, no component`);
      assert.equal(host.dataset.googlePlaceState, state, `${label}: ${state}`);
      assert.equal(action(host).hidden, false, `${label}: an explicit control is offered`);
      assert.equal(server.calls.length, 1);
      if (state === "inactive") {
        // The explicit control reserves afresh (old permit never reused) and then builds.
        action(host).click();
        await settle();
        assert.equal(server.calls.length, 2, `${label}: explicit Show reserves afresh`);
        loader.resolve();
        await settle();
        assert.equal(host.querySelector(DETAILS)?.isConnected, true, `${label}: built after the fresh reservation`);
        assert.equal(real.stats.dispatched, 1);
      } else {
        assert.equal(real.blocked, "clock", `${label}: a clock fault blocks further reservations`);
        assert.equal(status(host), googleText("en", "paused"));
      }
      manager.dispose();
    }
  }

  {
    // 3h. The provider month changes while the SDK loads: dispatch refused, explicit Show reserves
    //     afresh in the new month.
    const clock = fakeClock({ wall: OCT_END + 10_000 });
    const server = grantingServer({ month: () => providerMonth(clock.wall) });
    const gate = gateFor(server, { clock });
    const loader = controllableLoader();
    const manager = createPlaceDetailsManager({ doc, loader, gate, setTimer: manual.set, clearTimer: manual.clear });
    const host = makeHost();
    const before = detailsBuilt();
    const shown = manager.show(host, desc("plan-month", PLACE.c));
    await settle();
    assert.equal(loader.calls, 1);
    clock.advance(25_000);
    loader.resolve();
    assert.equal(await shown, false);
    assert.deepEqual([detailsBuilt() - before, host.dataset.googlePlaceState, gate.blocked], [0, "inactive", ""], "October's permit builds nothing in November");
    action(host).click();
    await settle();
    assert.deepEqual([server.calls.length, detailsBuilt() - before], [2, 1], "a fresh November reservation builds once");
    manager.dispose();
  }

  // -------------------------------------------------------------------------------------------
  // 3i. Connection callbacks: the component and its nested custom children are connected once and
  //     never re-connected: collapse/re-expand in the same host, two open cards, renderer
  //     replacement, eviction and explicit retry, with moveBefore absent, throwing or native-equivalent
  //     (with and without connectedMoveCallback).
  {
    const fixture = makeWorld();
    extraWorlds.push(fixture);
    const probe = fixture.doc.createElement("gmp-place-media");
    const left = fixture.containers.appendChild(fixture.doc.createElement("div"));
    const right = fixture.containers.appendChild(fixture.doc.createElement("div"));
    left.append(probe);
    right.moveBefore(probe, null);
    assert.deepEqual([probe.fictional.connects, probe.fictional.disconnects, fixture.record.reconnects.length], [2, 1, 1], "fixture: the native-equivalent move re-connects an element without connectedMoveCallback");
    const moving = makeWorld({ withMoveCallback: true });
    extraWorlds.push(moving);
    const probe2 = moving.doc.createElement("gmp-place-media");
    moving.containers.appendChild(moving.doc.createElement("div")).append(probe2);
    moving.containers.moveBefore(probe2, null);
    assert.deepEqual([probe2.fictional.connects, probe2.fictional.moves], [1, 1], "fixture: with connectedMoveCallback only that callback runs");
  }
  for (const withMoveCallback of [false, true]) {
    for (const mode of ["native", "absent", "throws"]) {
      const label = `${mode}${withMoveCallback ? " + connectedMoveCallback" : ""}`;
      const scene = makeWorld({ withMoveCallback });
      extraWorlds.push(scene);
      scene.setMoveMode(mode);
      const sceneRecord = scene.record;
      const server = grantingServer();
      const gate = gateFor(server);
      const manager = createPlaceDetailsManager({ doc: scene.doc, loader: readyLoader(), gate, maxRetained: 2, setTimer: manual.set, clearTimer: manual.clear });
      const built = () => scene.detailsBuilt();
      // The "itinerary" root that a re-render replaces.
      const root = scene.containers.appendChild(scene.doc.createElement("div"));
      const hostA = scene.makeHost("en", root);
      const hostB = scene.makeHost("en", root);
      const dA = desc("plan-c1", PLACE.a);
      const dB = desc("plan-c2", PLACE.b);
      const dC = desc("plan-c3", PLACE.c);

      // Expand A: one reservation, one connection of the component and each nested child.
      assert.equal(await manager.show(hostA, dA), true);
      const elementA = hostA.querySelector(DETAILS);
      const familyA = family(elementA);
      assert.equal(familyA.length, 6, `${label}: the component and its five nested custom children`);
      assert.ok(familyA.every((node) => node.fictional.connects === 1), `${label}: each connected exactly once`);
      assert.deepEqual([server.calls.length, built()], [1, 1]);

      // Collapse / re-expand the same host: hidden and unhidden in place.
      for (let round = 0; round < 3; round += 1) {
        manager.deactivate(dA);
        assert.ok(elementA.isConnected && elementA.parentNode === mountOf(hostA), `${label}: collapsed, still in its own host`);
        assert.equal(mountOf(hostA).hidden, true, `${label}: and hidden`);
        assert.equal(await manager.show(hostA, dA), true);
        assert.equal(mountOf(hostA).hidden, false, `${label}: re-expanding unhides it`);
        assert.equal(hostA.querySelector(DETAILS), elementA);
      }
      assert.deepEqual([server.calls.length, built()], [1, 1], `${label}: re-expansion reserves and builds nothing`);
      assert.ok(familyA.every((node) => node.fictional.connects === 1 && node.fictional.disconnects === 0), `${label}: no callbacks on re-expansion`);

      // Two open cards: B becomes active; A stays hidden in its own host and comes back by its control.
      assert.equal(await manager.show(hostB, dB), true);
      const elementB = hostB.querySelector(DETAILS);
      const familyB = family(elementB);
      assert.equal(server.calls.length, 2);
      assert.ok(elementA.parentNode === mountOf(hostA) && mountOf(hostA).hidden, `${label}: A hidden in place`);
      assert.equal(textOf(action(hostA)), googleText("en", "showDetails"));
      action(hostA).click();
      await settle();
      assert.ok(mountOf(hostB).hidden && !mountOf(hostA).hidden, `${label}: one active component`);
      assert.equal(hostA.querySelector(DETAILS), elementA);
      manager.restore(hostA, dA);
      manager.idle(hostB, dB);
      assert.deepEqual([server.calls.length, built()], [2, 2], `${label}: switching between open cards reserves nothing`);
      assert.ok([...familyA, ...familyB].every((node) => node.fictional.connects === 1 && node.fictional.disconnects === 0), `${label}: and calls no callback`);

      // Renderer replacement: released (one disconnect), never moved into the new cards.
      manager.releaseWithin(root);
      root.replaceChildren();
      let newA = scene.makeHost("en", root);
      let newB = scene.makeHost("en", root);
      assert.equal(await manager.restore(newA, dA), false);
      manager.idle(newB, dB);
      assert.deepEqual([newA.dataset.googlePlaceState, newB.dataset.googlePlaceState], ["inactive", "inactive"], `${label}: restored cards offer an explicit control`);
      assert.equal(newA.querySelector(DETAILS), null);
      for (let round = 0; round < 4; round += 1) {
        // Unrelated re-renders (polls with other edits, language changes).
        manager.releaseWithin(root);
        root.replaceChildren();
        newA = scene.makeHost("en", root);
        newB = scene.makeHost("en", root);
        await manager.restore(newA, dA);
        manager.idle(newB, dB);
      }
      assert.deepEqual([server.calls.length, built(), gate.stats.acquisitions], [2, 2, 2], `${label}: re-renders reserve, call and build nothing`);
      assert.ok([...familyA, ...familyB].every((node) => !node.isConnected && node.fictional.connects === 1 && node.fictional.disconnects === 1), `${label}: released components disconnected once, never re-connected`);

      // Explicit retry on the new host: a fresh reservation and a fresh component.
      action(newA).click();
      await settle();
      const elementA2 = newA.querySelector(DETAILS);
      assert.ok(elementA2 && elementA2 !== elementA, `${label}: a new component, never the released one`);
      assert.deepEqual([server.calls.length, built()], [3, 3]);

      // Eviction (bound 2): B and C shown; A (oldest inactive) removed for good; its Show reserves.
      await manager.show(newB, dB);
      const hostC = scene.makeHost("en", root);
      await manager.show(hostC, dC);
      assert.equal(manager.retainedCount, 2, `${label}: bounded retention`);
      assert.equal(elementA2.isConnected, false, `${label}: the oldest inactive one was evicted`);
      assert.equal(newA.dataset.googlePlaceState, "inactive");
      assert.deepEqual([server.calls.length, built()], [5, 5]);
      action(newA).click();
      await settle();
      assert.deepEqual([server.calls.length, built()], [6, 6], `${label}: re-opening an evicted plan reserves afresh`);

      // A host removed without announcement is swept, never re-attached.
      const elementC = hostC.querySelector(DETAILS);
      assert.ok(elementC?.isConnected, `${label}: fixture: C is still retained in its host`);
      hostC.remove();
      manager.idle(newB, dB);
      assert.equal(elementC.isConnected, false);
      assert.equal(manager.retainedCount, 1, `${label}: the swept component is no longer retained`);
      const replacementC = scene.makeHost("en", root);
      assert.equal(await manager.restore(replacementC, dC), false);
      assert.deepEqual([replacementC.querySelector(DETAILS), replacementC.dataset.googlePlaceState], [null, "inactive"], `${label}: never re-attached to a new host`);
      assert.deepEqual([server.calls.length, built()], [6, 6], `${label}: nothing new reserved for the swept host`);
      assert.equal(elementC.fictional.connects, 1);

      manager.dispose();
      assert.equal(scene.doc.querySelectorAll(DETAILS).length, 0);
      assert.deepEqual(sceneRecord.reconnects, [], `${label}: no component or nested child was ever re-connected`);
      assert.ok(sceneRecord.instances.every((node) => node.fictional.connects <= 1), `${label}: at most one connection per instance`);
      assert.deepEqual([sceneRecord.moveCalls, sceneRecord.moveCallbacks], [0, 0], `${label}: moveBefore never called, connectedMoveCallback never relied on`);
      assert.equal(gate.stats.dispatched, built(), `${label}: one consumed permit per constructed component`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // 4. Editor search and preview

  {
    // 4a. Search: denial, in-flight dedupe, one reservation per new query, stale state, disposal.
    const statuses = [];
    const deniedLoader = controllableLoader();
    const denied = createPlaceSearchSession({ doc, loader: deniedLoader, mount: containers.appendChild(doc.createElement("div")), onStatus: (key) => statuses.push(key),
      gate: gateWith(async () => { throw httpError(429, "google_allowance_exhausted"); }), setTimer: manual.set, clearTimer: manual.clear });
    const queriesBefore = record.textQueries.length;
    const before = gmpCreated();
    assert.equal(await denied.search("Invented Gate Hall"), false);
    assert.deepEqual(statuses, ["searching", "limitReached"]);
    assert.deepEqual([deniedLoader.calls, gmpCreated() - before, record.textQueries.length - queriesBefore], [0, 0, 0], "denied search: nothing built or sent");
    denied.dispose();

    const server = controllableServer();
    let current = true;
    const mount = containers.appendChild(doc.createElement("div"));
    const session = createPlaceSearchSession({ doc, loader: readyLoader(), gate: gateFor(server), mount, isCurrent: () => current, onStatus: () => {}, setTimer: manual.set, clearTimer: manual.clear });
    const one = session.search("Invented Gate Hall");
    const two = session.search("Invented Gate Hall");
    await tick();
    assert.equal(server.calls.length, 1, "repeating a search that is still being reserved sends nothing new");
    server.grant(0);
    assert.deepEqual([await one, await two], [true, true]);
    assert.deepEqual(record.textQueries.slice(queriesBefore), ["Invented Gate Hall"]);
    assert.equal(await session.search("Invented Gate Hall"), true);
    assert.equal(server.calls.length, 1, "the query on screen needs nothing new");
    const searchElement = mount.querySelector("gmp-place-search");
    const next = session.search("Invented Gate Pier");
    await tick();
    current = false;
    server.grant(1);
    assert.equal(await next, false, "a stale editor state sends no query");
    assert.deepEqual(record.textQueries.slice(queriesBefore), ["Invented Gate Hall"]);
    current = true;
    const late = session.search("Invented Gate Quay");
    await tick();
    session.dispose();
    server.grant(2);
    assert.equal(await late, false, "a grant after the editor closed is ignored");
    assert.deepEqual(record.textQueries.slice(queriesBefore), ["Invented Gate Hall"]);
    assert.equal(server.calls.length, 3, "every new query had its own reservation");
    assert.ok(family(searchElement).every((node) => node.fictional.connects === 1), "the search element and its children were connected once");
  }

  {
    // 4b. Search with a clock fault after the grant: no SDK bootstrap, no query, "paused".
    const clock = fakeClock();
    const real = gateFor(grantingServer(), { clock });
    const statuses = [];
    const loader = controllableLoader();
    const gate = { acquire: (request) => real.acquire(request), check: (grant, expected) => { clock.jumpWall(-10_000); return real.check(grant, expected); }, dispatch: (...args) => real.dispatch(...args) };
    const session = createPlaceSearchSession({ doc, loader, gate, mount: containers.appendChild(doc.createElement("div")), onStatus: (key) => statuses.push(key), setTimer: manual.set, clearTimer: manual.clear });
    const queriesBefore = record.textQueries.length;
    assert.equal(await session.search("Invented Gate Clock"), false);
    assert.deepEqual([loader.calls, record.textQueries.length - queriesBefore, statuses], [0, 0, ["searching", "paused"]], "no bootstrap and no query with an untrustworthy clock");
    session.dispose();
  }

  {
    // 4c. Preview: denial, in-flight dedupe, one reservation per Place ID, disposal.
    const statuses = [];
    const before = detailsBuilt();
    const denied = createPlacePreviewSession({ doc, loader: controllableLoader(), mount: containers.appendChild(doc.createElement("div")), onStatus: (key) => statuses.push(key),
      gate: gateWith(async () => { throw httpError(503, "google_allowance_unavailable"); }), setTimer: manual.set, clearTimer: manual.clear });
    assert.equal(await denied.preview(PLACE.a), false);
    assert.deepEqual(statuses, ["previewLoading", "paused"]);
    assert.equal(detailsBuilt() - before, 0);
    denied.dispose();
    const server = controllableServer();
    const mount = containers.appendChild(doc.createElement("div"));
    const preview = createPlacePreviewSession({ doc, loader: readyLoader(), gate: gateFor(server), mount, onStatus: () => {}, setTimer: manual.set, clearTimer: manual.clear });
    const first = preview.preview(PLACE.b);
    const again = preview.preview(PLACE.b);
    await tick();
    assert.equal(server.calls.length, 1);
    assert.deepEqual(server.calls[0].body.placeId, PLACE.b);
    server.grant(0);
    assert.deepEqual([await first, await again], [true, true]);
    assert.equal(detailsBuilt() - before, 1);
    assert.equal(await preview.preview(PLACE.b), true);
    assert.equal(server.calls.length, 1, "the preview on screen needs nothing new");
    const late = preview.preview(PLACE.c);
    await tick();
    preview.dispose();
    server.grant(1);
    assert.equal(await late, false);
    assert.equal(detailsBuilt() - before, 1, "a grant after the editor closed builds nothing");
  }

  assert.equal(doc.head.querySelectorAll("script").length, 0, "no Google script was ever injected in this suite");
  assert.deepEqual(record.reconnects, [], "no component in the main world was ever re-connected");
  assert.equal(record.moveCalls, 0, "the app never called moveBefore");
  console.log("Google Places allowance UI tests passed (mocked Google, injected monotonic and wall clocks, fictional reservation server): Pacific provider month with DST; unsupported context refused before reserving and search context normalized; single-use permits checked synchronously before SDK bootstrap and before every details/search/preview dispatch; validity from the first send on both clocks, capped, expired after slow responses, SDK loads or OS sleep; no monotonic clock, backward clocks, missing or disagreeing months fail closed and block; month crossings and hidden/lifecycle changes never reuse a grant; unverifiable (incl. malformed month) and replayed permits refused; transport retry with one key; blocking denials, explicit unblock, opt-out, sign-out and disposal; zero Google activity and translated accessible status on denial in four languages; rapid expansion without duplicate reservations; components and nested children connected once and never re-connected across collapse/re-expand, two open cards, renderer replacement, eviction and explicit retry with moveBefore absent, throwing or native-equivalent (with and without connectedMoveCallback), moveBefore never called; no real SDK, billing or browser claim.");
} finally {
  window.close();
  for (const extra of extraWorlds) extra.window.close();
}
