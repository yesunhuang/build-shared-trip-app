// Safe links inside traveler card text (plan reviews/notes, recommendation descriptions, booking
// notes) and the plan location line. See references/card-text-links.md.
//
// Supported subset (nothing else is interpreted):
//   - Absolute raw URLs that literally start with http:// or https:// (case-insensitive). Unicode
//     letters, marks, digits and symbols continue a URL (internationalized hosts, paths, queries
//     and fragments); spaces and sentence punctuation end it.
//   - Inline Markdown links [label](https://...) with a plain-text label.
// Everything else, including HTML, image syntax ![alt](...), reference links, autolinks <...>,
// titles [a](url "t"), nested brackets and malformed Markdown, stays literal text. Parsing is a
// bounded linear scan; no HTML is parsed and no innerHTML is ever used. Output is text nodes plus
// native <a target="_blank" rel="noopener noreferrer"> anchors whose href is the WHATWG URL
// serialization (punycode host, percent-encoded path/query) while the visible text stays exactly
// what the author wrote. No event handler is attached: the browser's own activation (click, Enter,
// modifiers, middle-click, long-press) is untouched.
import { safeLinkUrl } from "./link-activation.js?v=v-7d714f2937ad";

/** Longer strings are rendered as one plain text node (server text fields are capped at 4,000). */
export const TEXT_LINK_MAX_INPUT = 8000;
/** At most this many links per string; the rest stays literal text. */
export const TEXT_LINK_MAX_LINKS = 40;
/** A URL candidate longer than this (UTF-16 code units of the author's text) stays literal text. */
export const TEXT_LINK_MAX_URL = 2048;
/** A serialized href longer than this (after percent-encoding) is not linked. */
export const TEXT_LINK_MAX_HREF = 8192;
/** A Markdown label longer than this (or empty) leaves the construct literal. */
export const TEXT_LINK_MAX_LABEL = 200;

const SCHEME = /^https?:\/\//i;
// ASCII allowed inside a URL candidate. Other ASCII (space, tab, newline, quotes, angle brackets,
// backtick, braces, pipe, caret, square brackets) ends it; backslash and controls reject it.
const URL_CHAR = /[A-Za-z0-9\-._~:/?#@!$&'()*+,;=%]/;
const isAsciiReject = (code) => code === 0x5c || code <= 0x08 || code === 0x0b || code === 0x0c
  || (code >= 0x0e && code <= 0x1f) || code === 0x7f;
// Non-ASCII code points that make a whole candidate suspicious: controls (C1), format characters
// (soft hyphen, zero-width, bidi embeddings/overrides/isolates/marks, BOM, tag characters), lone
// surrogates, private use, unassigned code points, and every other default-ignorable code point
// (variation selectors, Hangul fillers). Written as Unicode property escapes so that this source
// file never contains invisible characters itself.
const HIDDEN = /[\p{C}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}]/u;
// Non-ASCII spaces and punctuation that end a raw URL the way an ASCII space does: sentence and
// clause punctuation in any script (ideographic full stop and comma, full-width ! ? : ; and comma,
// Devanagari danda, Arabic comma, ...), brackets, quotation marks and dashes.
const UNICODE_SPACE = /[\p{White_Space}\p{Z}]/u;
const UNICODE_DELIMITER = /[\p{Terminal_Punctuation}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\p{Pd}]/u;
const UNICODE_PUNCTUATION = /\p{P}/u;
// Non-ASCII code points allowed in a host: letters, marks and digits only (no symbols or
// punctuation that could imitate "/", "@", "\" or "."), plus the IDNA full stops that the URL
// parser maps to "." (ideographic U+3002, full-width U+FF0E, half-width ideographic U+FF61).
const HOST_CHAR = /[\p{L}\p{M}\p{N}]/u;
const IDEOGRAPHIC_FULL_STOP = String.fromCharCode(0x3002);
const IDNA_DOTS = new Set([0x3002, 0xff0e, 0xff61].map((code) => String.fromCharCode(code)));
const ASCII_HOST_CHAR = /[A-Za-z0-9\-._]/;
const NON_ASCII_OUTSIDE_HOST = new RegExp(`[^\\x00-\\x7f\\p{L}\\p{M}\\p{N}${[...IDNA_DOTS].join("")}]`, "u");
// After NFKC folding (which the URL parser's IDNA step also applies; U+FF0E becomes "." and
// U+FF61 becomes U+3002) an authority may contain only host label characters, dots and an
// optional numeric port.
const FOLDED_AUTHORITY = new RegExp(`^[\\p{L}\\p{M}\\p{N}.\\-_${IDEOGRAPHIC_FULL_STOP}]+(?::\\d{1,5})?$`, "u");
const FOLDED_LABEL_DOT = new RegExp(`[.${IDEOGRAPHIC_FULL_STOP}]`);
// An ASCII word character or URL-ish punctuation right before "http" means it is part of something
// else (for example "xhttps://", "/https://", "a.https://", "src=https://"). CJK and other scripts,
// spaces, brackets, quotes and a label colon ("Site:https://...") are fine.
const BLOCKING_PREFIX = /[A-Za-z0-9_\-/.@+%=&]/;
const TRAILING_PUNCTUATION = /[.,;:!?'*_~]/;

const URL_PART = 1;
const END = 2;
const REJECT = 3;

// The code point (one or two UTF-16 units) starting at index, or "".
function codePointAt(text, index) {
  const code = text.codePointAt(index);
  return code === undefined ? "" : String.fromCodePoint(code);
}

// The code point ending just before end, or "".
function codePointBefore(text, end) {
  if (end <= 0) return "";
  const low = text.charCodeAt(end - 1);
  if (end >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(end - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(end - 2, end);
  }
  return text[end - 1];
}

// How a raw-URL scan treats one code point: part of the URL, a clean end, or a reason to keep the
// whole candidate as literal text.
function classify(char) {
  const code = char.codePointAt(0);
  if (code < 0x80) {
    if (URL_CHAR.test(char)) return URL_PART;
    return isAsciiReject(code) ? REJECT : END;
  }
  if (HIDDEN.test(char)) return REJECT;
  if (UNICODE_SPACE.test(char) || UNICODE_DELIMITER.test(char)) return END;
  return URL_PART;
}

const isHostRunChar = (char) => Boolean(char) && (char.codePointAt(0) < 0x80 ? ASCII_HOST_CHAR.test(char) : HOST_CHAR.test(char) || IDNA_DOTS.has(char));

/**
 * Validates an absolute http(s) URL for a content link. Returns the serialized href or "".
 * Stricter than safeLinkUrl: no root-relative paths, the literal scheme must lead the string, no
 * whitespace (ASCII or Unicode), controls, hidden/format/bidi/default-ignorable characters, quotes,
 * angle brackets, backtick or backslash (also after NFKC folding); no userinfo (even an empty "@"
 * authority), no percent-encoded host, a host made only of letters, marks, digits, "-", "_" and
 * dots; no malformed "xn--" label; a real host and bounded length. Internationalized hosts, paths
 * and queries are accepted; the result is the WHATWG serialization (punycode, percent-encoding).
 */
export function contentLinkUrl(value) {
  if (typeof value !== "string") return "";
  if (!value || value.length > TEXT_LINK_MAX_URL || !SCHEME.test(value)) return "";
  if (/[\x00-\x20\x7f<>"`\\]/.test(value) || HIDDEN.test(value) || UNICODE_SPACE.test(value)) return "";
  if (value.normalize("NFKC").includes("\\")) return "";
  const authority = value.slice(value.indexOf("//") + 2).split(/[/?#]/, 1)[0];
  if (!authority || authority.includes("@") || authority.includes("%")) return "";
  if (NON_ASCII_OUTSIDE_HOST.test(authority)) return "";
  const folded = authority.normalize("NFKC");
  if (!FOLDED_AUTHORITY.test(folded)) return "";
  const labels = folded.toLowerCase().split(FOLDED_LABEL_DOT);
  if (labels.some((label) => label.startsWith("xn--") && /[^\x00-\x7f]/.test(label))) return "";
  if (!safeLinkUrl(value)) return "";
  let url;
  try { url = new URL(value); } catch { return ""; }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) return "";
  if (url.href.length > TEXT_LINK_MAX_HREF) return "";
  return url.href;
}

// Trailing sentence punctuation is not part of a raw URL (ASCII . , ; : ! ? ' * _ ~ and any
// non-ASCII punctuation such as an ellipsis); a trailing ")" is kept only when it balances an "("
// inside the URL (for example .../Fictional_(bay)).
function trimTrailing(candidate) {
  let end = candidate.length;
  for (;;) {
    const last = codePointBefore(candidate, end);
    if (!last) break;
    if (TRAILING_PUNCTUATION.test(last) || (last.codePointAt(0) >= 0x80 && UNICODE_PUNCTUATION.test(last))) {
      end -= last.length;
      continue;
    }
    if (last === ")") {
      const body = candidate.slice(0, end);
      const opens = body.split("(").length - 1;
      const closes = body.split(")").length - 1;
      if (closes > opens) { end -= 1; continue; }
    }
    break;
  }
  return candidate.slice(0, end);
}

// Skips the rest of a rejected candidate (up to the next clean end) so that a hidden-character,
// ambiguous or oversized URL is never partially linked.
function skipRun(text, from) {
  let end = from;
  while (end < text.length) {
    const char = codePointAt(text, end);
    if (classify(char) === END) break;
    end += char.length;
  }
  return end;
}

// A raw URL at index, or null when none starts here. Returns { end, href, text }; href is "" for a
// rejected candidate (which then stays literal text up to end).
function readRawUrl(text, index) {
  if (!SCHEME.test(text.slice(index, index + 8))) return null;
  if (index > 0 && BLOCKING_PREFIX.test(text[index - 1])) return null;
  const limit = Math.min(text.length, index + TEXT_LINK_MAX_URL + 1);
  let end = index + (text[index + 4] === ":" ? 7 : 8);
  let inAuthority = true;
  const rejected = () => ({ end: skipRun(text, end), href: "", text: "" });
  while (end < limit) {
    const char = codePointAt(text, end);
    const kind = classify(char);
    if (kind === REJECT) return rejected();
    if (inAuthority) {
      if (char === "/" || char === "?" || char === "#") {
        inAuthority = false;
      } else if (IDNA_DOTS.has(char)) {
        // An ideographic/full-width full stop inside the host is a label separator only when a
        // further label and then the path, query, fragment or port follow
        // ("https://<label><U+3002><label>/...").
        // Followed by nothing host-like it ends the URL like any sentence punctuation. Anything in
        // between is ambiguous, so the whole candidate stays text rather than a truncated link.
        if (isHostRunChar(codePointAt(text, end + 1))) {
          let cursor = end + 1;
          while (cursor < limit && isHostRunChar(codePointAt(text, cursor))) cursor += codePointAt(text, cursor).length;
          const separates = /[/?#:]/.test(text[cursor] || "");
          end = cursor;
          if (!separates) return rejected();
          continue;
        }
        break;
      } else if (kind === URL_PART && char.codePointAt(0) >= 0x80 && !HOST_CHAR.test(char)) {
        return rejected(); // a symbol or punctuation look-alike inside the host
      }
    }
    if (kind === END) break;
    end += char.length;
  }
  if (end - index > TEXT_LINK_MAX_URL) return rejected();
  const visible = trimTrailing(text.slice(index, end));
  return { end: index + visible.length, href: contentLinkUrl(visible), text: visible };
}

// Inside an explicit Markdown target the closing ")" marks the end, so Unicode punctuation is
// allowed there; spaces, hidden characters and the ASCII characters a raw URL rejects are not.
function isMarkdownTargetChar(char) {
  if (char.codePointAt(0) < 0x80) return URL_CHAR.test(char);
  return !HIDDEN.test(char) && !UNICODE_SPACE.test(char);
}

// An inline Markdown link starting at index ("["), or null when the construct is not well formed.
function readMarkdownLink(text, index) {
  let cursor = index + 1;
  const labelLimit = Math.min(text.length, cursor + TEXT_LINK_MAX_LABEL + 1);
  while (cursor < labelLimit && text[cursor] !== "]" && text[cursor] !== "[" && text[cursor] !== "\n") cursor += 1;
  if (text[cursor] !== "]" || text[cursor + 1] !== "(") return null;
  const label = text.slice(index + 1, cursor);
  if (!label.trim() || label.length > TEXT_LINK_MAX_LABEL) return null;
  // A label with controls or bidi formatting could disguise the link text: keep it all literal.
  if (/[\p{Cc}\p{Bidi_Control}]/u.test(label)) return null;
  const urlStart = cursor + 2;
  let depth = 0;
  let end = urlStart;
  const urlLimit = Math.min(text.length, urlStart + TEXT_LINK_MAX_URL + 1);
  while (end < urlLimit) {
    const char = codePointAt(text, end);
    if (char === "(") depth += 1;
    else if (char === ")") { if (depth === 0) break; depth -= 1; }
    else if (!isMarkdownTargetChar(char)) return null;
    end += char.length;
  }
  if (text[end] !== ")") return null;
  const href = contentLinkUrl(text.slice(urlStart, end));
  if (!href) return null;
  return { end: end + 1, href, label };
}

// Image syntax ![alt](...) is never executed or linked: the whole construct (up to the first ")"
// on the same line, bounded) is skipped as literal text. Returns the index to continue from.
function readImageSyntax(text, index) {
  let cursor = index + 2;
  const labelLimit = Math.min(text.length, cursor + TEXT_LINK_MAX_LABEL + 1);
  while (cursor < labelLimit && text[cursor] !== "]" && text[cursor] !== "[" && text[cursor] !== "\n") cursor += 1;
  if (text[cursor] !== "]" || text[cursor + 1] !== "(") return index + 2;
  let end = cursor + 2;
  const limit = Math.min(text.length, end + TEXT_LINK_MAX_URL + 1);
  while (end < limit && text[end] !== ")" && text[end] !== "\n") end += 1;
  return text[end] === ")" ? end + 1 : index + 2;
}

/**
 * Splits text into { type: "text", text } and { type: "link", text, href } segments.
 * Pure (no DOM). null/undefined give []. Joining all segment texts reproduces the input, except
 * that each accepted Markdown link is replaced by its label.
 */
export function parseTextLinks(value, { sourceInfo = false, strictConstructs = false } = {}) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (!text) return [];
  if (text.length > TEXT_LINK_MAX_INPUT) return [{ type: "text", text }];
  const segments = [];
  let plainStart = 0;
  let links = 0;
  const pushText = (end) => {
    if (end <= plainStart) return;
    const previous = segments.at(-1);
    if (previous?.type === "text") previous.text += text.slice(plainStart, end);
    else segments.push({ type: "text", text: text.slice(plainStart, end) });
  };
  const pushLink = (start, end, label, href, kind) => {
    pushText(start);
    segments.push({ type: "link", text: label, href, ...(sourceInfo ? { kind } : {}) });
    links += 1;
    plainStart = end;
  };
  let index = 0;
  while (index < text.length && links < TEXT_LINK_MAX_LINKS) {
    const char = text[index];
    // Card projection must not extract a partial URL from malformed Markdown or HTML.
    // The legacy inline renderer retains its established parsing behavior.
    if (strictConstructs && char === "<") {
      const end = text.indexOf(">", index + 1);
      index = end < 0 ? text.length : end + 1; continue;
    }
    if (char === "!" && text[index + 1] === "[") { index = strictConstructs ? literalConstructEnd(text, index + 1) : readImageSyntax(text, index); continue; }
    // A backslash escapes a following "[" or raw "http" from linking.
    if (char === "\\" && /[[hH]/.test(text[index + 1] || "")) {
      index = strictConstructs && text[index + 1] === "[" ? literalConstructEnd(text, index + 1) : index + 2; continue;
    }
    if (char === "[") {
      const found = readMarkdownLink(text, index);
      if (found) { pushLink(index, found.end, found.label, found.href, "markdown"); index = found.end; continue; }
      if (strictConstructs) { index = literalConstructEnd(text, index); continue; }
      index += 1; continue;
    }
    if (char === "h" || char === "H") {
      const found = readRawUrl(text, index);
      if (found) {
        if (found.href) pushLink(index, found.end, found.text, found.href, "raw");
        index = Math.max(found.end, index + 1);
        continue;
      }
    }
    index += 1;
  }
  pushText(text.length);
  return segments;
}

function literalConstructEnd(text, start) {
  let cursor = start, depth = 0;
  while (cursor < text.length && text[cursor] !== "\n") {
    if (text[cursor] === "[") depth += 1;
    if (text[cursor++] === "]" && --depth === 0) break;
  }
  while (text[cursor] === " " || text[cursor] === "\t") cursor += 1;
  if (text[cursor] !== "(") return Math.max(cursor, start + 1);
  depth = 0;
  while (cursor < text.length && text[cursor] !== "\n") {
    if (text[cursor] === "(") depth += 1;
    if (text[cursor++] === ")" && --depth === 0) break;
  }
  return cursor;
}

/** Native external anchor (no handlers). Callers pass an already validated href. */
function externalTextAnchor(doc, href, label, className) {
  const link = doc.createElement("a");
  link.className = className;
  link.href = href;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = label;
  return link;
}

function appendSegments(parent, segments, doc, linkClass) {
  for (const segment of segments) {
    if (segment.type === "link") parent.append(externalTextAnchor(doc, segment.href, segment.text, linkClass));
    else parent.append(doc.createTextNode(segment.text));
  }
  return parent;
}

/** Appends text nodes and safe anchors for value to parent. Returns parent. */
export function appendLinkedText(parent, value, { doc = parent.ownerDocument, linkClass = "text-link" } = {}) {
  return appendSegments(parent, parseTextLinks(value), doc, linkClass);
}

/** Like app.js textElement(tag, className, text), but with safe links inside the text. */
export function linkedTextElement(doc, tag, className, value) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  const segments = parseTextLinks(value);
  if (segments.some((segment) => segment.type === "link")) node.classList.add("has-text-links");
  return appendSegments(node, segments, doc, "text-link");
}

/**
 * The plan location line: a native anchor to url (the SAME validated destination the card's map
 * action uses, passed through unchanged), or a plain text node when there is no valid absolute
 * http(s) target or no visible label. Never builds or guesses a URL.
 */
export function locationTextNode(doc, label, url, { className = "location-link", ariaLabel = "" } = {}) {
  const text = String(label ?? "");
  const href = typeof url === "string" && contentLinkUrl(url) ? url : "";
  if (!href || !text.trim()) return doc.createTextNode(text);
  const link = externalTextAnchor(doc, href, text, className);
  if (ariaLabel) link.setAttribute("aria-label", ariaLabel);
  return link;
}
