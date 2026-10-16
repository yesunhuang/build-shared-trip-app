// Native link activation for plan cards, trip cards, booking/resource links and map popups.
//
// Root cause this module addresses: background refreshes (the hosted trip poll, the home-page trip
// list poll and window-focus reload, the resources-page reload) rebuilt the whole card list with
// replaceChildren() or reloaded the page as soon as data arrived. A refresh that landed while a
// finger or mouse button was down on a link (typically right after returning to the tab, which
// resumes the poll immediately) detached the pressed <a> before the browser's click/activation, so
// nothing opened and the person had to tap again.
//
// The guard below never handles a link itself: it does not call preventDefault() or
// stopPropagation(), never uses window.open(), never rewrites href/target/rel and never listens for
// keyboard shortcuts. It only notices that a press started on a link (or on an official embedded
// component, whose private/shadow content is never read) and defers caller-supplied re-render or
// reload work until that press has ended, so the browser's own activation (click, Enter,
// Ctrl/Meta/Shift-click, middle-click/new tab, long-press menu) always reaches the original anchor.
// Deferral is for ordinary content refreshes only: callers apply sign-out, session invalidation and
// authority changes immediately and cancel() (or dispose()) any deferred work for them.

export const OFFICIAL_COMPONENT_PREFIX = "gmp-";
// Settling time after the activation event, so the default action runs before deferred work.
export const LINK_SETTLE_MS = 60;
// After pointerup/touchend a click normally follows at once; wait a little longer for it.
export const LINK_RELEASE_MS = 400;
// Safety valve: deferred work never waits longer than this for an unfinished press.
export const LINK_MAX_HOLD_MS = 10000;

const isElement = (node) => Boolean(node) && node.nodeType === 1 && typeof node.localName === "string";
const isOfficialComponent = (node) => isElement(node) && node.localName.startsWith(OFFICIAL_COMPONENT_PREFIX);
const isLink = (node) => isElement(node) && (node.localName === "a" || node.localName === "area") && node.hasAttribute("href");

function eventPath(event) {
  if (typeof event?.composedPath === "function") {
    const path = event.composedPath();
    if (path.length) return path;
  }
  const path = [];
  for (let node = event?.target; node; node = node.parentNode) path.push(node);
  return path;
}

/**
 * The interactive element an event started on, or null: { kind: "link" | "component", element }.
 * The composed path is scanned from the outside in, and scanning stops at the first official
 * embedded component host (gmp-*), so nodes inside such a component (open or closed shadow DOM)
 * are never inspected. With a boundary, only nodes inside the boundary count.
 */
export function interactiveTargetOf(event, boundary = null) {
  const path = eventPath(event);
  const end = boundary ? path.indexOf(boundary) : -1;
  const inside = end >= 0 ? path.slice(0, end) : path;
  for (let index = inside.length - 1; index >= 0; index -= 1) {
    const node = inside[index];
    if (isOfficialComponent(node)) return { kind: "component", element: node };
    if (isLink(node)) return { kind: "link", element: node };
  }
  return null;
}

/** The anchor a pointer/click/key event belongs to (light DOM only), or null. */
export function linkFromEvent(event, boundary = null) {
  const found = interactiveTargetOf(event, boundary);
  return found?.kind === "link" ? found.element : null;
}

/** True when the event started on a link or an embedded component (never start a gesture then). */
export function startsOnInteractive(event, boundary = null) {
  return Boolean(interactiveTargetOf(event, boundary));
}

/** A plain primary activation (no modifier, primary button). Modified clicks are the browser's. */
export function isPlainPrimaryActivation(event) {
  return Boolean(event) && (event.button === undefined || event.button === 0)
    && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

const defaultSetTimer = (fn, ms) => globalThis.setTimeout(fn, ms);
const defaultClearTimer = (id) => { if (id !== null && id !== undefined) globalThis.clearTimeout(id); };

/**
 * Watches presses on links inside root (capture phase, passive) and defers work while one is in
 * progress. whenIdle(key, fn) runs fn now when no press is active; otherwise it remembers the latest
 * fn per key and runs it once the press ends. Returns true when fn ran synchronously.
 */
export function createLinkActivationGuard({
  root, settleMs = LINK_SETTLE_MS, releaseMs = LINK_RELEASE_MS, maxHoldMs = LINK_MAX_HOLD_MS,
  setTimer = defaultSetTimer, clearTimer = defaultClearTimer
} = {}) {
  const pending = new Map();
  const stats = { presses: 0, deferred: 0, flushed: 0 };
  let active = false;
  let endTimer = null;
  let holdTimer = null;
  let disposed = false;

  function flush() {
    clearTimer(endTimer); clearTimer(holdTimer);
    endTimer = null; holdTimer = null;
    active = false;
    const work = [...pending.values()];
    pending.clear();
    for (const fn of work) {
      stats.flushed += 1;
      try { fn(); } catch (error) { globalThis.console?.error?.("Deferred update failed", error); }
    }
  }

  function begin(event) {
    if (disposed || !interactiveTargetOf(event, null)) return;
    stats.presses += 1;
    active = true;
    clearTimer(endTimer); endTimer = null;
    clearTimer(holdTimer);
    holdTimer = setTimer(flush, maxHoldMs);
  }

  function finishSoon(ms) {
    if (!active) return;
    clearTimer(endTimer);
    endTimer = setTimer(flush, ms);
  }

  const onPress = (event) => begin(event);
  const onActivated = () => finishSoon(settleMs);
  const onRelease = () => finishSoon(releaseMs);
  const listeners = [
    ["pointerdown", onPress], ["mousedown", onPress], ["touchstart", onPress],
    ["click", onActivated], ["auxclick", onActivated], ["contextmenu", onActivated],
    ["dragstart", onActivated], ["pointercancel", onActivated], ["touchcancel", onActivated],
    ["pointerup", onRelease], ["mouseup", onRelease], ["touchend", onRelease]
  ];
  const options = { capture: true, passive: true };
  if (root?.addEventListener) for (const [type, listener] of listeners) root.addEventListener(type, listener, options);

  return {
    whenIdle(key, fn) {
      if (disposed) return false;
      if (!active) { fn(); return true; }
      stats.deferred += 1;
      pending.set(key, fn);
      return false;
    },
    /**
     * Drops deferred work for key without running it, leaving any press in progress untouched.
     * For callers that must apply a change at once (for example an authority change or sign-out)
     * and must never have older deferred work run later. Returns true when something was dropped.
     */
    cancel(key) { return pending.delete(key); },
    /** Runs any deferred work now (for example before an explicit, user-requested reload). */
    flush,
    dispose() {
      disposed = true;
      clearTimer(endTimer); clearTimer(holdTimer);
      pending.clear();
      active = false;
      if (root?.removeEventListener) for (const [type, listener] of listeners) root.removeEventListener(type, listener, options);
    },
    get active() { return active; },
    get pendingCount() { return pending.size; },
    get stats() { return { ...stats }; }
  };
}

/**
 * Accepts only http(s) URLs and root-relative paths for links built from trip data. Everything else
 * (javascript:, data:, vbscript:, protocol-relative //host, credentials, control characters) is "".
 */
export function safeLinkUrl(value) {
  const raw = String(value ?? "").trim();
  // eslint-disable-next-line no-control-regex
  if (!raw || raw.length > 4096 || /[\s\\\u0000-\u001f\u007f]/.test(raw)) return "";
  if (raw.startsWith("/") && !raw.startsWith("//")) return raw;
  let url;
  try { url = new URL(raw); } catch { return ""; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return "";
  return url.href;
}
