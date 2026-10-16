#!/usr/bin/env node
// Unit and jsdom checks for assets/app-template/public/text-links.js (card text links and the plan
// location line). All text and URLs are fictional. jsdom only: no real browser, navigation or
// provider is involved. See references/card-text-links.md.
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { JSDOM } from "jsdom";
import {
  TEXT_LINK_MAX_INPUT, TEXT_LINK_MAX_LINKS, TEXT_LINK_MAX_URL,
  appendLinkedText, contentLinkUrl, linkedTextElement, locationTextNode, parseTextLinks
} from "../assets/app-template/public/text-links.js";
import { normalizeGoogleMapsUrl } from "../assets/app-template/public/map-links.js";
import { coordinateGoogleMapsUrl } from "../assets/app-template/public/place-picker.js";

const ch = (code) => String.fromCharCode(code);
const ZWSP = ch(0x200b);
const RLO = ch(0x202e);
const NUL = ch(0x00);
const BOM = ch(0xfeff);
const SOFT_HYPHEN = ch(0xad);
const C1 = ch(0x85);
// Right-to-left sample words are built from code points so the source has no RTL literals.
const AR_VISIT = String.fromCodePoint(0x632, 0x648, 0x631, 0x648, 0x627);
const AR_PATH = String.fromCodePoint(0x645, 0x633, 0x627, 0x631);
const AR_TODAY = String.fromCodePoint(0x627, 0x644, 0x64a, 0x648, 0x645);

const links = (value) => parseTextLinks(value).filter((segment) => segment.type === "link");
const hrefs = (value) => links(value).map((segment) => segment.href);
const joined = (value) => parseTextLinks(value).map((segment) => segment.text).join("");
const T = (text) => ({ type: "text", text });
const L = (text, href = new URL(text).href) => ({ type: "link", text, href });

// ---------------------------------------------------------------------------------------------
// 1. contentLinkUrl: absolute http(s) only.
for (const [value, expected] of [
  ["https://example.org/fictional", "https://example.org/fictional"],
  ["http://example.org/", "http://example.org/"],
  ["HTTPS://EXAMPLE.ORG/A", "https://example.org/A"],
  ["https://example.org/a?x=1&y=two#top", "https://example.org/a?x=1&y=two#top"],
  ["https://example.org/w/Fictional_(bay)", "https://example.org/w/Fictional_(bay)"],
  ["https://example.org:8443/p", "https://example.org:8443/p"],
  ["https://www.google.com/maps/search/?api=1&query=40.2%2C10.3", "https://www.google.com/maps/search/?api=1&query=40.2%2C10.3"],
  ["javascript:alert(1)", ""], ["JaVaScRiPt:alert(1)", ""], [" javascript:alert(1)", ""],
  ["data:text/html,<b>x</b>", ""], ["file:///etc/fictional", ""], ["vbscript:msgbox(1)", ""],
  ["ftp://example.org/", ""], ["mailto:someone@example.org", ""], ["//evil.example/x", ""],
  ["/relative/path", ""], ["www.example.org", ""], ["example.org", ""],
  ["https://user:pw@evil.example/", ""], ["https://user@evil.example/", ""], ["https://@evil.example/", ""],
  ["https://good.example%40evil.example/", ""], ["https://%65vil.example/", ""],
  ["https://good.example\\@evil.example/", ""], ["https:\\\\evil.example", ""], ["https:/evil.example", ""],
  ["https://", ""], ["https:///path", ""], ["https://exa mple.org", ""], [`https://exa${ZWSP}mple.org`, ""],
  [`https://example.org/${RLO}gpj.exe`, ""], [`https://example.org/${NUL}`, ""], [`https://example.org/${BOM}`, ""],
  ["https://example.org/\"onmouseover=alert(1)", ""], ["https://example.org/<script>", ""], ["https://example.org/`x`", ""],
  [`https://example.org/${"a".repeat(TEXT_LINK_MAX_URL)}`, ""], ["https://xn--fictional-例.org", ""],
  [null, ""], [undefined, ""], [42, ""], [{ toString: () => "https://example.org/" }, ""],
  // Internationalized forms are accepted and serialized; look-alike/hidden forms are not.
  ["https://example.test/温泉?言語=日本語", "https://example.test/%E6%B8%A9%E6%B3%89?%E8%A8%80%E8%AA%9E=%E6%97%A5%E6%9C%AC%E8%AA%9E"],
  ["https://旅館.example.test/予約#朝", new URL("https://旅館.example.test/予約#朝").href],
  ["https://例え.テスト/パス", new URL("https://例え.テスト/パス").href],
  ["https://example.test,https://evil.example/", ""], ["https://example.test:/", ""],
  ["https://例え.test＠evil.example/", ""], ["https://good.test∕evil.example/", ""], ["https://good.test／evil.example/", ""],
  ["https://good.test⁄evil.example/", ""], ["https://例え.test＼evil.example/", ""], ["https://例え.test/＼x", ""],
  ["https://例え.test/ 温泉", ""], [`https://例え.test/${ch(0x3000)}温泉`, ""], [`https://例え.test/${ch(0xa0)}`, ""],
  [`https://例え.test/${ch(0x200f)}`, ""], [`https://例え.test/${ch(0x2066)}`, ""], [`https://例え.test/${ch(0x061c)}`, ""],
  [`https://例${ch(0x200d)}え.test/`, ""], [`https://例え.test/${ch(0xfe0f)}`, ""], [`https://例え.test/${ch(0x3164)}`, ""],
  [`https://例え.test/${String.fromCodePoint(0xe0041)}`, ""], [`https://例え.test/${ch(0xd800)}`, ""], [`https://例え.test/${ch(0xe000)}`, ""],
  ["https://😀.example.test/", ""], ["https://ｕｓｅｒ＠example.test/", ""]
]) assert.equal(contentLinkUrl(value), expected, `contentLinkUrl(${JSON.stringify(String(value)).slice(0, 80)})`);
// Serialized hrefs are plain ASCII (punycode host, percent-encoded path/query) and keep the host.
for (const value of ["https://旅館.example.test/予約#朝", "https://例え.テスト/パス", "https://пример.example.test/путь?язык=ru", "HTTPS://BÜCHER.example.test/Straße"]) {
  const href = contentLinkUrl(value);
  assert.ok(/^https:\/\/[\x21-\x7e]+$/.test(href), `ASCII serialization: ${value} -> ${href}`);
  assert.equal(new URL(href).hostname, new URL(value).hostname, `same host: ${value}`);
  assert.ok(new URL(href).hostname.startsWith("xn--"), `punycode host: ${href}`);
}

// ---------------------------------------------------------------------------------------------
// 2. Raw URLs: punctuation, query strings, parentheses.
assert.deepEqual(parseTextLinks("Plain fictional text only."), [T("Plain fictional text only.")]);
assert.deepEqual(parseTextLinks("See https://example.org/fictional."), [T("See "), L("https://example.org/fictional"), T(".")]);
assert.deepEqual(parseTextLinks("Tickets: https://tickets.example.org/a?x=1&y=two#top, then walk!"),
  [T("Tickets: "), L("https://tickets.example.org/a?x=1&y=two#top"), T(", then walk!")]);
assert.deepEqual(parseTextLinks("(see https://en.example.org/wiki/Fictional_(bay))"),
  [T("(see "), L("https://en.example.org/wiki/Fictional_(bay)"), T(")")], "balanced parentheses kept, the outer one trimmed");
assert.deepEqual(parseTextLinks("Read (https://example.org/a)."), [T("Read ("), L("https://example.org/a"), T(").")]);
assert.deepEqual(parseTextLinks("Is it https://example.org/a?"), [T("Is it "), L("https://example.org/a"), T("?")]);
assert.deepEqual(parseTextLinks("'https://example.org/q' and \"https://example.org/d\""),
  [T("'"), L("https://example.org/q"), T("' and \""), L("https://example.org/d"), T("\"")]);
assert.deepEqual(parseTextLinks("Site:https://example.org/site;"), [T("Site:"), L("https://example.org/site"), T(";")]);
assert.deepEqual(parseTextLinks("Two: http://a.example.org/1 https://b.example.org/2"),
  [T("Two: "), L("http://a.example.org/1"), T(" "), L("https://b.example.org/2")]);
assert.deepEqual(parseTextLinks("HTTPS://EXAMPLE.ORG/A"), [L("HTTPS://EXAMPLE.ORG/A", "https://example.org/A")], "visible text keeps the author's case");
assert.deepEqual(parseTextLinks("line one\nhttps://example.org/n\nline three"), [T("line one\n"), L("https://example.org/n"), T("\nline three")]);
for (const text of ["xhttps://example.org", "/https://example.org", "a.https://example.org", "src=https://example.org", "user@https://example.org"]) {
  assert.deepEqual(hrefs(text), [], `glued prefix is not linked: ${text}`);
  assert.equal(joined(text), text);
}

// ---------------------------------------------------------------------------------------------
// 3. Markdown inline links with explicit labels.
assert.deepEqual(parseTextLinks("Menu: [Fictional menu](https://example.org/menu?lang=en) today."),
  [T("Menu: "), L("Fictional menu", "https://example.org/menu?lang=en"), T(" today.")]);
assert.deepEqual(parseTextLinks("[Wiki](https://example.org/w/A_(b))"), [L("Wiki", "https://example.org/w/A_(b)")]);
assert.deepEqual(parseTextLinks("[One](https://example.org/1) and [Two](http://example.org/2)"),
  [L("One", "https://example.org/1"), T(" and "), L("Two", "http://example.org/2")]);
assert.deepEqual(parseTextLinks("[<b>bold?</b>](https://example.org/b)"), [L("<b>bold?</b>", "https://example.org/b")], "label is literal text");

// ---------------------------------------------------------------------------------------------
// 4. Multilingual text.
assert.deepEqual(parseTextLinks("詳細はhttps://example.org/ja。次へ"), [T("詳細は"), L("https://example.org/ja"), T("。次へ")]);
assert.deepEqual(parseTextLinks("预订：https://example.org/zh，谢谢"), [T("预订："), L("https://example.org/zh"), T("，谢谢")]);
assert.deepEqual(parseTextLinks("[地図を見る](https://example.org/map) 🍜"), [L("地図を見る", "https://example.org/map"), T(" 🍜")]);
assert.deepEqual(parseTextLinks("（https://example.org/fw）"), [T("（"), L("https://example.org/fw"), T("）")]);
assert.deepEqual(parseTextLinks("Café https://example.org/caf%C3%A9 — ok"), [T("Café "), L("https://example.org/caf%C3%A9"), T(" — ok")]);

// ---------------------------------------------------------------------------------------------
// 4b. Internationalized URLs: the complete URL is linked; visible text is the author's text and
//     href is the WHATWG serialization. A Unicode letter never truncates a URL.
assert.deepEqual(parseTextLinks("Visit https://example.test/温泉?言語=日本語 today"), [
  T("Visit "),
  { type: "link", text: "https://example.test/温泉?言語=日本語", href: "https://example.test/%E6%B8%A9%E6%B3%89?%E8%A8%80%E8%AA%9E=%E6%97%A5%E6%9C%AC%E8%AA%9E" },
  T(" today")
], "coordinator probe: full Unicode path and query");
assert.deepEqual(parseTextLinks("https://example.org/パス"), [L("https://example.org/パス")], "a Unicode path is not truncated");
for (const [text, expected, label] of [
  ["Book at https://旅館.example.test/予約 now", [T("Book at "), L("https://旅館.example.test/予約"), T(" now")], "IDN host and path"],
  ["https://例え.テスト/パス?q=値#節", [L("https://例え.テスト/パス?q=値#節")], "IDN host, path, query, fragment"],
  ["HTTPS://例え.TEST/温泉", [L("HTTPS://例え.TEST/温泉")], "visible text keeps the author's case"],
  ["詳細はhttps://example.test/温泉?言語=日本語。次へ", [T("詳細は"), L("https://example.test/温泉?言語=日本語"), T("。次へ")], "Japanese full stop ends it"],
  ["预订：https://例子.example.test/路径，谢谢", [T("预订："), L("https://例子.example.test/路径"), T("，谢谢")], "Chinese full-width comma ends it"],
  ["「https://example.test/温泉」を見て", [T("「"), L("https://example.test/温泉"), T("」を見て")], "corner brackets"],
  ["（https://example.test/地図）", [T("（"), L("https://example.test/地図"), T("）")], "full-width parentheses"],
  ["Смотрите https://пример.example.test/путь?язык=ru, спасибо", [T("Смотрите "), L("https://пример.example.test/путь?язык=ru"), T(", спасибо")], "Cyrillic"],
  ["Bücher: https://bücher.example.test/straße.", [T("Bücher: "), L("https://bücher.example.test/straße"), T(".")], "German"],
  [`${AR_VISIT} https://example.test/${AR_PATH} ${AR_TODAY}`, [T(`${AR_VISIT} `), L(`https://example.test/${AR_PATH}`), T(` ${AR_TODAY}`)], "Arabic path"],
  ["देखें https://example.test/हिन्दी।", [T("देखें "), L("https://example.test/हिन्दी"), T("।")], "Devanagari marks continue, danda ends"],
  ["ดูที่ https://example.test/ไทย ครับ", [T("ดูที่ "), L("https://example.test/ไทย"), T(" ครับ")], "Thai"],
  ["https://example.test/温泉・旅館/地図。", [L("https://example.test/温泉・旅館/地図"), T("。")], "middle dot inside the path continues"],
  ["https://example.test/温泉…", [L("https://example.test/温泉"), T("…")], "trailing ellipsis is prose"],
  ["https://example.test/ラーメン🍜 です", [L("https://example.test/ラーメン🍜"), T(" です")], "emoji symbol continues"],
  ["https://例え。テスト/パス", [L("https://例え。テスト/パス")], "ideographic full stop as a host label separator"],
  ["See https://example.test。 Next", [T("See "), L("https://example.test"), T("。 Next")], "ideographic full stop after a host"],
  ["[温泉ガイド](https://旅館.example.test/温泉・案内?言語=日本語)", [L("温泉ガイド", new URL("https://旅館.example.test/温泉・案内?言語=日本語").href)], "Markdown IDN target"],
  ["[案内](https://example.test/温泉、旅館)です", [L("案内", new URL("https://example.test/温泉、旅館").href), T("です")], "Markdown target may contain Unicode punctuation"]
]) {
  assert.deepEqual(parseTextLinks(text), expected, label);
  for (const link of links(text)) assert.ok(/^https?:\/\/[\x21-\x7e]+$/.test(link.href), `${label}: ASCII href ${link.href}`);
}
assert.equal(new URL(hrefs("https://例え。テスト/パス")[0]).hostname, new URL("https://例え.テスト/").hostname, "U+3002 maps to a dot in the host");

// ---------------------------------------------------------------------------------------------
// 5. Hostile input stays literal text.
const hostile = [
  "javascript:alert(1)", "JAVASCRIPT:alert(1)", "java\tscript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=",
  "file:///etc/fictional", "vbscript:msgbox(1)", "//evil.example/x", "www.example.org/no-scheme", "example.org",
  "[x](javascript:alert(1))", "[x](JaVaScript:alert(1))", "[x](data:text/html,hi)", "[x](//evil.example)", "[x](/relative)",
  "[x](vbscript:x)", "[x](file:///x)", "[x](%6Aavascript:alert(1))", "[x](https://user:pw@evil.example/)",
  "[x](https://user@evil.example/)", "[x](https://good.example\\@evil.example)", `[x](https://exa${ZWSP}mple.org)`,
  `[x](https://example.org/${RLO})`, `[x](https://example.org/${NUL})`, "https://user:pw@evil.example/", "https://@evil.example",
  "https://good.example%40evil.example", "https://good.example\\@evil.example", "https://good.example\\path",
  `https://exa${ZWSP}mple.org`, `https://example.org/${RLO}gpj.exe`, `https://example.org${SOFT_HYPHEN}x`, `https://example.org/${C1}`,
  `https://example.org/${BOM}`, `http://${NUL}evil.example`, "https://", "https:///path", "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>", "<a href=\"javascript:alert(1)\">x</a>", "<iframe src=//evil.example></iframe>",
  "&lt;b&gt; &amp; &#106;avascript:alert(1)", "\\https://example.org/escaped", "\\[x](https://example.org/escaped-md)"
];
for (const text of hostile) {
  const found = hrefs(text);
  assert.ok(found.every((href) => /^https?:\/\/[^/@\\]+\//i.test(href)), `only plain http(s) hrefs: ${JSON.stringify(text)} -> ${found}`);
  assert.ok(!found.some((href) => /evil|javascript|data:|vbscript|file:/i.test(href)), `no hostile target: ${JSON.stringify(text)} -> ${found}`);
}
for (const text of hostile.slice(0, 39)) assert.equal(links(text).length, 0, `no link at all: ${JSON.stringify(text)}`);
assert.equal(joined("<script>alert(1)</script>"), "<script>alert(1)</script>", "HTML-looking text is preserved verbatim");
// The escaped Markdown still contains a raw URL after the bracket; it may be linked only as itself.
assert.deepEqual(hrefs("\\[x](https://example.org/escaped-md)"), ["https://example.org/escaped-md"]);
assert.deepEqual(hrefs("\\https://example.org/escaped"), [], "an escaped raw URL stays text");

// Internationalized hostile, hidden-character and ambiguous candidates stay wholly literal text:
// no anchor at all, and in particular no truncated "https://host/" prefix anchor.
const unicodeHostile = [
  `https://example.test/温泉${ZWSP}旅館`, `https://example.test/${RLO}温泉`, `https://example.test/温泉${ch(0x200f)}`,
  `https://example.test/温泉${ch(0x2066)}x`, `https://example.test/${ch(0x061c)}x`, `https://例${ch(0x200d)}え.test/温泉`,
  `https://例え.test/温泉${ch(0xfe0f)}`, `https://例え.test/${ch(0x3164)}`, `https://例え.test/${String.fromCodePoint(0xe0041, 0xe0042)}`,
  `https://例え.test/${ch(0xd800)}x`, `https://例え.test/${ch(0xe000)}`, `https://例え.test/${C1}温泉`, `https://例え${SOFT_HYPHEN}.test/`,
  "https://例え.test\\温泉", "https://例え.test/温泉\\evil", "https://例え.test＼evil.example/", "https://例え.test/＼温泉",
  "https://user@例え.test/温泉", "https://ユーザー:pw@例え.test/", "https://例え.test＠evil.example/温泉", "https://ｕｓｅｒ＠example.test/",
  "https://good.test∕evil.example/温泉", "https://good.test／evil.example/", "https://good.test⁄evil.example/", "https://😀.example.test/",
  "https://例え。test＠evil.example/", "https://例え。テスト", "https://example.test。次へ", "https://xn--fictional-例.test/",
  "ｈｔｔｐｓ://example.test/温泉", "https:／／example.test/温泉", "温泉javascript:alert(1)", "[温泉](javascript:alert('温泉'))",
  `[温泉](https://例え.test/${ZWSP})`, "[温泉](https://例え.test＠evil.example/)", "[温泉](https://user:pw@例え.test/)",
  `[温泉](https://例え.test/${RLO}x)`, "[温泉](//例え.test/)", "[温泉](例え.test/温泉)"
];
for (const text of unicodeHostile) {
  assert.deepEqual(links(text), [], `no link at all: ${JSON.stringify(text)}`);
  assert.equal(joined(text), text, `wholly literal text: ${JSON.stringify(text)}`);
}
// A space inside a Markdown target makes the Markdown literal; the complete raw URL before the
// space is an ordinary raw URL and is linked only as exactly itself (as for ASCII).
for (const space of [" ", ch(0x3000)]) {
  const text = `[温泉](https://例え.test/${space}温泉)`;
  assert.deepEqual(links(text), [L("https://例え.test/")], `space in target: ${JSON.stringify(text)}`);
  assert.equal(joined(text), text);
}
// A label with bidi formatting or controls cannot disguise a Markdown link: the construct stays
// literal (the label is never link text); only the raw URL inside may be linked as itself.
for (const text of [`[${RLO}gpj.exe](https://example.test/a)`, `[a${ch(0x2067)}b](https://example.test/b)`, `[a${ch(0x7)}b](https://example.test/c)`]) {
  assert.ok(links(text).every((link) => link.text === new URL(link.text).href), `no disguised label link: ${JSON.stringify(text)}`);
  assert.equal(links(text).length, 1);
  assert.equal(joined(text), text, "the label and brackets stay literal");
}
// Rejected candidates do not swallow a later, separate valid URL.
assert.deepEqual(hrefs(`https://example.test/${ZWSP}x https://example.test/温泉`), [new URL("https://example.test/温泉").href]);

// ---------------------------------------------------------------------------------------------
// 6. Malformed Markdown and image syntax.
for (const text of ["[unclosed](https://example.org", "[label] (https://example.org/x)", "[a [b] c](https://example.org/n)",
  "[](https://example.org/empty)", "[   ](https://example.org/blank)", "[x](https://example.org/a \"title\")", "[x]( https://example.org/s)"]) {
  assert.ok(joined(text).includes("["), `brackets stay literal: ${text}`);
  for (const link of links(text)) assert.equal(link.text, contentLinkUrl(link.text) ? link.text : "!", `only a raw URL may still be linked as itself: ${text}`);
}
assert.deepEqual(parseTextLinks("[a [b](https://example.org/inner)](https://example.org/outer)"),
  [T("[a "), L("b", "https://example.org/inner"), T("]("), L("https://example.org/outer"), T(")")], "no nested links: inner Markdown, outer raw URL");
for (const text of ["![Fictional photo](https://img.example.org/a.png)", "![a](https://img.example.org/a.png \"t\")",
  "![alt](javascript:alert(1))", "![](https://img.example.org/b.png)", "<img src=https://img.example.org/c.png>"]) {
  assert.deepEqual(parseTextLinks(text), [T(text)], `image syntax is literal text: ${text}`);
}
assert.deepEqual(parseTextLinks("![x](https://img.example.org/a.png) then https://example.org/after"),
  [T("![x](https://img.example.org/a.png) then "), L("https://example.org/after")]);

// ---------------------------------------------------------------------------------------------
// 7. Bounds: oversized input, oversized URL, link cap, pathological strings.
const big = `${"x".repeat(TEXT_LINK_MAX_INPUT)} https://example.org/late`;
assert.deepEqual(parseTextLinks(big), [T(big)], "oversized strings are one text node");
const longUrl = `https://example.org/${"a".repeat(TEXT_LINK_MAX_URL + 10)}`;
assert.deepEqual(parseTextLinks(`go ${longUrl} now`), [T(`go ${longUrl} now`)], "oversized URL stays text");
const many = Array.from({ length: TEXT_LINK_MAX_LINKS + 10 }, (_, index) => `https://example.org/${index}`).join(" ");
assert.equal(links(many).length, TEXT_LINK_MAX_LINKS, "link cap");
assert.equal(joined(many), many, "text after the cap is preserved");
for (const [label, text] of [
  ["brackets", "[".repeat(7999)], ["open md", "[a](".repeat(1999)], ["images", "![a](".repeat(1599)],
  ["schemes", "https://".repeat(999)], ["parens", `[a](https://example.org/${"(".repeat(2000)}`],
  ["labels", `[${"a".repeat(199)}`.repeat(39)], ["mixed", "[x](h ".repeat(1333)]
]) {
  const started = performance.now();
  const segments = parseTextLinks(text);
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `${label}: bounded work (${elapsed.toFixed(1)} ms)`);
  assert.equal(segments.map((segment) => segment.text).join(""), text, `${label}: preserved`);
}
for (const [value, expected] of [[null, []], [undefined, []], ["", []], [42, [T("42")]]]) assert.deepEqual(parseTextLinks(value), expected);

// ---------------------------------------------------------------------------------------------
// 8. DOM rendering (jsdom): only text nodes and safe anchors; no HTML parsing, no handlers.
{
  const { window } = new JSDOM("<!doctype html><body></body>", { url: "http://fictional-trips.test/" });
  const doc = window.document;
  // HTML-parsing sinks and window.open are counted globally (they must never be used). Listeners are
  // tracked per target instead: jsdom's own selector engine lazily installs document-level listeners
  // on first querySelector use, which says nothing about the renderer. What must hold is that the
  // renderer adds no listener at all while it runs, and that no listener ever targets a node it
  // created (anchors, text nodes or their containers).
  const counts = { innerHTML: 0, insertAdjacentHTML: 0, open: 0, parser: 0 };
  const listenerTargets = [];
  const rendered = [];
  const render = (build) => {
    const before = listenerTargets.length;
    const result = build();
    assert.equal(listenerTargets.length, before, "the renderer adds no event listener while it runs");
    rendered.push(result);
    return result;
  };
  const listenersOnRendered = () => listenerTargets.filter((target) => target instanceof window.Node
    && rendered.some((root) => root === target || root.contains(target)));
  for (const proto of [window.Element.prototype, window.HTMLElement.prototype]) {
    const innerHTML = Object.getOwnPropertyDescriptor(proto, "innerHTML");
    if (innerHTML?.set) Object.defineProperty(proto, "innerHTML", { configurable: true, get: innerHTML.get, set(value) { counts.innerHTML += 1; innerHTML.set.call(this, value); } });
  }
  for (const proto of [window.Element.prototype, window.HTMLElement.prototype]) {
    const outerHTML = Object.getOwnPropertyDescriptor(proto, "outerHTML");
    if (outerHTML?.set) Object.defineProperty(proto, "outerHTML", { configurable: true, get: outerHTML.get, set(value) { counts.innerHTML += 1; outerHTML.set.call(this, value); } });
  }
  window.Element.prototype.insertAdjacentHTML = () => { counts.insertAdjacentHTML += 1; };
  const addListener = window.EventTarget.prototype.addEventListener;
  window.EventTarget.prototype.addEventListener = function (...args) { listenerTargets.push(this); return addListener.apply(this, args); };
  window.open = () => { counts.open += 1; return null; };
  window.DOMParser = class { constructor() { counts.parser += 1; } };

  const everything = [...hostile, ...unicodeHostile, "See https://example.org/a.", "[Menu](https://example.org/m)", "![i](https://img.example.org/x.png)",
    "<script>alert(1)</script> https://example.org/s", "[<img src=x onerror=alert(1)>](https://example.org/l)",
    "Visit https://example.test/温泉?言語=日本語 today", "[温泉ガイド](https://旅館.example.test/案内)"].join("\n");
  const node = render(() => linkedTextElement(doc, "p", "note-line", everything));
  doc.body.append(node);
  assert.equal(node.className, "note-line has-text-links", "original class kept; marker class added only when linked");
  const elements = [...node.querySelectorAll("*")];
  assert.ok(elements.length > 0 && elements.every((element) => element.localName === "a"), "the only elements are anchors");
  assert.equal(node.querySelectorAll("script, img, iframe, object, embed, svg, style, b").length, 0, "no element from text");
  for (const anchor of node.querySelectorAll("a")) {
    assert.ok(/^https?:\/\/[\x21-\x7e]+$/.test(anchor.getAttribute("href")), `http(s) ASCII-serialized href: ${anchor.getAttribute("href")}`);
    assert.ok(!/evil|javascript|data:|vbscript/i.test(anchor.href));
    assert.deepEqual([anchor.className, anchor.target, anchor.rel], ["text-link", "_blank", "noopener noreferrer"]);
    assert.equal(anchor.children.length, 0, "anchor content is a text node only");
    assert.equal(anchor.attributes.length, 4, "href, class, target, rel only (no on* attributes)");
    assert.equal(anchor.onclick, null, "no click handler property");
  }
  assert.equal(node.querySelector("a a"), null, "no nested anchors");
  assert.ok(node.textContent.includes("<script>alert(1)</script>"), "script-looking text is shown literally");
  assert.ok(node.textContent.includes("<img src=x onerror=alert(1)>"), "HTML label shown literally");
  assert.ok(node.textContent.includes("![i](https://img.example.org/x.png)"), "image Markdown shown literally");
  const unicodeAnchor = [...node.querySelectorAll("a")].find((anchor) => anchor.textContent === "https://example.test/温泉?言語=日本語");
  assert.ok(unicodeAnchor, "the complete Unicode URL is one anchor with the author's visible text");
  assert.equal(unicodeAnchor.getAttribute("href"), "https://example.test/%E6%B8%A9%E6%B3%89?%E8%A8%80%E8%AA%9E=%E6%97%A5%E6%9C%AC%E8%AA%9E", "serialized href");
  const idnAnchor = [...node.querySelectorAll("a")].find((anchor) => anchor.textContent === "温泉ガイド");
  assert.equal(idnAnchor?.getAttribute("href"), new URL("https://旅館.example.test/案内").href, "Markdown IDN target, punycode href");
  assert.equal([...node.querySelectorAll("a")].filter((anchor) => anchor.getAttribute("href") === "https://example.test/").length, 0,
    "no truncated host-only anchor from any Unicode candidate");

  const plain = render(() => linkedTextElement(doc, "p", "timeline-card__review", "Fictional plain review"));
  assert.deepEqual([plain.className, plain.childNodes.length, plain.firstChild.nodeType, plain.textContent], ["timeline-card__review", 1, 3, "Fictional plain review"]);
  const empty = render(() => linkedTextElement(doc, "p", "muted", undefined));
  assert.deepEqual([empty.className, empty.textContent], ["muted", ""], "undefined renders like textElement(..., undefined)");
  const host = doc.createElement("span");
  render(() => appendLinkedText(host, "a https://example.org/x b", { linkClass: "custom-link" }));
  assert.equal(host.querySelector("a").className, "custom-link");

  // -------------------------------------------------------------------------------------------
  // 9. Location line: the SAME validated map-action URL, else plain text.
  const fullMaps = "https://www.google.com/maps/place/Invented+Lantern+Museum,+1+Sample+Quay/data=!4m6!3m5!1s0x0:0x1!8m2!3d40.1!4d10.2!16s%2Fg%2Fsample";
  const verified = normalizeGoogleMapsUrl(fullMaps);
  assert.ok(verified, "fixture: a verified full Maps URL");
  const osm = coordinateGoogleMapsUrl(40.2, 10.3);
  assert.equal(osm, "https://www.google.com/maps/search/?api=1&query=40.2%2C10.3", "fixture: OSM saved coordinates");
  for (const [label, url] of [["verified Maps URL", verified], ["OSM coordinates", osm]]) {
    const reference = doc.createElement("a");
    reference.href = url; // what googleMapsAnchor assigns
    const link = render(() => locationTextNode(doc, "1 Sample Quay, Fictional Bay", url, { ariaLabel: "Open in Google Maps: 1 Sample Quay" }));
    assert.equal(link.localName, "a", `${label}: anchor`);
    assert.equal(link.href, reference.href, `${label}: href equals the map action href`);
    assert.equal(link.getAttribute("href"), url, `${label}: passed through unchanged`);
    assert.deepEqual([link.className, link.target, link.rel, link.textContent, link.getAttribute("aria-label")],
      ["location-link", "_blank", "noopener noreferrer", "1 Sample Quay, Fictional Bay", "Open in Google Maps: 1 Sample Quay"]);
  }
  for (const [label, url] of [["missing", ""], ["undefined", undefined], ["javascript", "javascript:alert(1)"], ["data", "data:text/html,x"],
    ["protocol-relative", "//evil.example/maps"], ["root-relative", "/maps"], ["userinfo", "https://user@evil.example/maps"],
    ["backslash", "https://www.google.com\\@evil.example"], ["hidden", `https://www.google.com/maps${ZWSP}`]]) {
    const result = render(() => locationTextNode(doc, "1 Sample Quay", url));
    assert.equal(result.nodeType, 3, `${label}: plain text node`);
    assert.equal(result.textContent, "1 Sample Quay");
  }
  assert.equal(locationTextNode(doc, "   ", verified).nodeType, 3, "a blank label is never an empty link");
  assert.equal(locationTextNode(doc, "<b>Quay</b>", verified).textContent, "<b>Quay</b>", "label is text");
  assert.equal(locationTextNode(doc, "<b>Quay</b>", verified).children.length, 0);

  // Measured after every selector/assertion above: still no listener on anything the renderer
  // created, and no HTML parsing or window.open anywhere.
  assert.ok(rendered.length >= 15, "fixture: the renderer outputs were tracked");
  assert.deepEqual(listenersOnRendered(), [], "no event listener targets a rendered anchor, text node or container");
  assert.deepEqual(counts, { innerHTML: 0, insertAdjacentHTML: 0, open: 0, parser: 0 }, "no HTML parsing or window.open");
  window.close();
}

console.log("Card text link checks passed (jsdom/unit, fictional data): http(s)-only validation, raw URLs with punctuation/query/parentheses, Markdown [label](url) links, multilingual text, hostile protocol/control/hidden/userinfo/backslash/oversized/malformed/image/HTML cases stay literal, bounded parsing, DOM output of only text nodes and safe anchors without handlers or HTML parsing, and location links equal to the validated map URL or plain text. No browser or provider claim.");
