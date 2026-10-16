// Render-only plan text projection. No stored text, URL semantics or trip state is changed.
import { parseTextLinks } from "./text-links.js?v=v-aebb88e3a26f";
import { relatedLinksProblems, relatedLinkUrl } from "./related-links.js?v=v-aebb88e3a26f";

const SEPARATORS = /^[\s.,;:!?。！？、，；：|·•—–-]*$/u;
const MEANINGFUL = /[\p{L}\p{N}\p{S}]/u;
const meaningful = (text) => !SEPARATORS.test(text) && MEANINGFUL.test(text);
const hostname = (href) => new URL(href).hostname; // validated by the bounded parser
const plainLabel = (part) => part.type === "link" && part.kind === "raw" ? hostname(part.href) : part.text;

export function projectCardText(value) {
  const parts = parseTextLinks(value, { sourceInfo: true, strictConstructs: true });
  const links = parts.filter((part) => part.type === "link").map((part) => ({
    href: part.href, label: plainLabel(part), explicit: part.kind === "markdown"
  }));
  let cut = parts.length, prefix = "";
  // Only a terminal link-only run at a sentence/line boundary can disappear from prose.
  // Inline labels remain words: "Read [the guide](url), then walk" keeps its sentence.
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    if (parts[i].type === "text") { if (!SEPARATORS.test(parts[i].text)) break; continue; }
    const before = parts.slice(0, i).map(plainLabel).join("");
    const boundary = parts[i - 1]?.type === "text" ? parts[i - 1].text : "";
    if (!meaningful(before)) { cut = i; prefix = ""; }
    else if (/[.!?。！？][\s|·•—–-]*$/u.test(boundary)) { cut = i; prefix = before.replace(/[\s|·•—–-]+$/u, ""); }
    else if (/\n[\s|·•—–-]*$/u.test(boundary)) { cut = i; prefix = before.trimEnd(); }
  }
  const text = cut < parts.length ? prefix : parts.map(plainLabel).join("");
  return { text: meaningful(text) ? text : "", links };
}

export function projectCardLinks(slot) {
  const texts = {};
  const candidates = [];
  // Saved editor ordering wins; distinct explicit labels for a shared destination are retained.
  if (Array.isArray(slot.relatedLinks) && !relatedLinksProblems(slot.relatedLinks).length) {
    for (const link of slot.relatedLinks) candidates.push({ href: relatedLinkUrl(link.url), label: link.label, explicit: true, id: link.id });
  }
  for (const field of ["review", "description", "notes"]) {
    const result = projectCardText(slot[field]); texts[field] = result.text;
    candidates.push(...result.links.map((link) => ({ ...link, field })));
  }
  const byHref = new Map();
  for (const candidate of candidates) {
    let link = byHref.get(candidate.href);
    if (!link) { link = { ...candidate, labels: [], fields: [] }; byHref.set(candidate.href, link); }
    if (candidate.explicit && !link.labels.includes(candidate.label)) link.labels.push(candidate.label);
    if (candidate.field && !link.fields.includes(candidate.field)) link.fields.push(candidate.field);
  }
  return { texts, links: [...byHref.values()].map((link) => ({ ...link, label: link.labels.length ? link.labels.join(" · ") : hostname(link.href) })) };
}

export function cardLinkIcon(doc, kind = "link") {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  svg.classList.add("card-link-icon");
  const path = doc.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", kind === "map" ? "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z" : "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2");
  path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round"); svg.append(path); return svg;
}

export function renderCardLinkGroup(doc, links, heading) {
  if (!links.length) return null;
  const section = doc.createElement("section"); section.className = "plan-related-links"; section.setAttribute("aria-label", heading);
  const title = doc.createElement("h4"); title.textContent = heading;
  const list = doc.createElement("ul"); list.className = "plan-related-links__list";
  for (const link of links) {
    const item = doc.createElement("li"); if (link.id) item.dataset.linkId = link.id;
    const anchor = doc.createElement("a"); anchor.className = "related-link card-destination-link";
    anchor.href = link.href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
    anchor.dataset.sourceFields = link.fields.join(" ");
    const label = doc.createElement("span"); label.textContent = link.label;
    anchor.append(cardLinkIcon(doc), label); item.append(anchor); list.append(item);
  }
  section.append(title, list); return section;
}
