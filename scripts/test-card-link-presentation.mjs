import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { projectCardText, projectCardLinks, renderCardLinkGroup } from "../assets/app-template/public/card-link-presentation.js";
import { RELATED_LINK_WORDS } from "../assets/app-template/public/related-links.js";

const u = "https://example.org/book?a=1&b=2", v = "https://example.org/menu";
for (const [input, expected] of [
  [`A fictional meal. [Booking](${u}) · [Menu](${v}).`, "A fictional meal."],
  [`Read [the guide](${u}), then walk.`, "Read the guide, then walk."],
  [`Read [guide](${u}). [Menu](${v})`, "Read guide."],
  [`Read [Mr.](${u}) [Book](${v})`, "Read Mr. Book"],
  [`[Booking](${u}) | [Menu](${v})`, ""],
  [`A fictional meal.\n${u}`, "A fictional meal."],
  [`Menu: ${u}`, "Menu: example.org"],
  [`See https://example.org/a, then continue.`, "See example.org, then continue."],
  ["[bad](https://example.org \"title\")", "[bad](https://example.org \"title\")"],
  ["[bad [nested](https://example.org/a)](https://example.org/b)", "[bad [nested](https://example.org/a)](https://example.org/b)"],
  ["![bad](https://example.org \"title\")", "![bad](https://example.org \"title\")"],
  ["[bad](javascript:alert(1)) <a href=https://example.org>unsafe</a>", "[bad](javascript:alert(1)) <a href=https://example.org>unsafe</a>"],
  ["[broken](https://example.org/unclosed", "[broken](https://example.org/unclosed"],
  ["\\[escaped](https://example.org)", "\\[escaped](https://example.org)"],
  ["完成。 [予約](https://example.org/ja) · [メニュー](https://example.org/menu)", "完成。"]
]) assert.equal(projectCardText(input).text, expected, input);
for (const value of ["[bad](https://example.org \"title\")", "[bad [nested](https://example.org/a)](https://example.org/b)", "![bad](https://example.org \"title\")", "[bad](javascript:alert(1)) <a href=https://example.org>unsafe</a>"]) {
  assert.equal(projectCardText(value).links.length, 0, "malformed/unsafe constructs remain wholly literal");
}
const slot = {
  review: `A meal. ${u} [Menu](${v})`, description: `Read [Reserve](${u}), then arrive.`, notes: `[Menu](${v})`,
  relatedLinks: [{ id: "booking", label: "Booking", url: u }, { id: "extra", label: "Alternate order", url: "https://example.org/book?b=2&a=1" }]
};
const before = JSON.stringify(slot), projected = projectCardLinks(slot);
assert.equal(JSON.stringify(slot), before, "render projection does not mutate stored content");
assert.deepEqual(projected.links.map((link) => [link.href, link.label]), [[u, "Booking · Reserve"], ["https://example.org/book?b=2&a=1", "Alternate order"], [v, "Menu"]]);
assert.equal(projectCardLinks({ review: "https://example.org/a%2Fb https://example.org/a/b" }).links.length, 2, "encoded path semantics retained");
assert.equal(projectCardText("x".repeat(8001) + u).links.length, 0, "input bound preserved");
assert.equal(projectCardText(Array.from({ length: 80 }, (_, i) => `https://example.org/${i}`).join(" ")).links.length, 40, "link bound preserved");
const dom = new JSDOM();
const group = renderCardLinkGroup(dom.window.document, projectCardLinks({ relatedLinks: [{ id: "safe", label: "<img onerror=alert(1)> Booking", url: u }] }).links, "Related links");
assert.equal(group.querySelectorAll("a").length, 1);
assert.equal(group.querySelectorAll("img,script").length, 0);
assert.equal(group.querySelector("svg").getAttribute("aria-hidden"), "true");
assert.equal(group.querySelector("svg").getAttribute("focusable"), "false");
assert.equal(group.querySelector("a").textContent, "<img onerror=alert(1)> Booking");
assert.equal(group.querySelector("a").rel, "noopener noreferrer");
assert.equal(group.querySelector("a").target, "_blank");
for (const words of Object.values(RELATED_LINK_WORDS)) assert.equal(renderCardLinkGroup(dom.window.document, projected.links, words[0]).getAttribute("aria-label"), words[0]);
assert.equal(renderCardLinkGroup(dom.window.document, [], "Related links"), null);
dom.window.close();
console.log("Card presentation projection passed: terminal runs, inline prose/punctuation, exact href deduplication and explicit labels, literal malformed/unsafe input, bounds, immutable source and escaped local-icon native anchors.");
