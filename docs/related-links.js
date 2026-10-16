// User-authored links only. Shared by browser, HTTP/MCP validation and generator.
import { contentLinkUrl } from "./text-links.js?v=v-2100193edc44";
export const RELATED_LINK_LIMIT = 6;
export const RELATED_LINK_LABEL_MAX = 80;
const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/i;
const CONTROL = /[\p{C}\p{Default_Ignorable_Code_Point}]/u;
export function relatedLinkUrl(value) {
  // Refuse encoded controls/backslashes too; never trim away invalid input.
  if (typeof value !== "string" || /%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)|%(?![0-9a-f]{2})/i.test(value)) return "";
  try { if (CONTROL.test(decodeURI(value))) return ""; } catch { return ""; }
  return contentLinkUrl(value);
}
export function relatedLinksProblems(value) {
  if (!Array.isArray(value) || value.length > RELATED_LINK_LIMIT) return [{ key: "", message: `must be an array of at most ${RELATED_LINK_LIMIT} links` }];
  const issues = [], ids = new Set();
  value.forEach((link, index) => {
    const add = (key, message) => issues.push({ key: `[${index}]${key ? `.${key}` : ""}`, message });
    if (!link || typeof link !== "object" || Array.isArray(link)) { add("", "must be an object"); return; }
    for (const key of Object.keys(link)) if (!["id", "label", "url"].includes(key)) add(key, "is not supported");
    if (typeof link.id !== "string" || !ID.test(link.id) || ids.has(link.id)) add("id", "must be a unique stable ID within this plan");
    ids.add(link.id);
    if (typeof link.label !== "string" || !link.label.trim() || link.label.length > RELATED_LINK_LABEL_MAX || CONTROL.test(link.label)) add("label", "must be nonempty text of at most 80 characters without controls");
    if (!relatedLinkUrl(link.url)) add("url", "must be an absolute HTTP/HTTPS URL without credentials or controls (at most 2048 characters)");
  });
  return issues;
}
export const RELATED_LINK_WORDS = {
  en: ["Related links", "Add link", "Label", "URL", "Remove link", "Move up", "Move down", "Use a label and an absolute HTTP/HTTPS URL without credentials.", "Link order updated", "Link removed"],
  "zh-Hans": ["相关链接", "添加链接", "标签", "网址", "移除链接", "上移", "下移", "请输入标签和不含登录信息的完整 HTTP/HTTPS 网址。", "链接顺序已更新", "链接已移除"],
  "zh-Hant": ["相關連結", "新增連結", "標籤", "網址", "移除連結", "上移", "下移", "請輸入標籤及不含登入資訊的完整 HTTP/HTTPS 網址。", "連結順序已更新", "連結已移除"],
  ja: ["関連リンク", "リンクを追加", "ラベル", "URL", "リンクを削除", "上へ", "下へ", "ラベルと認証情報を含まない完全な HTTP/HTTPS URL を入力してください。", "リンクの順序を更新しました", "リンクを削除しました"]
};

// Native controls, stable IDs and keyboard-accessible ordering; no drag-only affordance.
export function createRelatedLinksEditor({ doc, container, links = [], language = "en", makeId }) {
  const words = RELATED_LINK_WORDS[language] || RELATED_LINK_WORDS.en, rows = [];
  const heading = doc.createElement("legend"); heading.textContent = words[0];
  const list = doc.createElement("div"); list.className = "related-links-editor__list";
  const status = doc.createElement("p"); status.className = "form-hint"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const add = button(words[1], () => { append({ id: makeId(), label: "", url: "" }); rows.at(-1).label.focus(); });
  container.replaceChildren(heading, list, add, status);
  function button(text, action) {
    const node = doc.createElement("button"); node.type = "button"; node.className = "button button--quiet"; node.textContent = text; node.addEventListener("click", action); return node;
  }
  function sync() {
    rows.forEach((row, index) => { row.up.disabled = index === 0; row.down.disabled = index === rows.length - 1; row.node.setAttribute("aria-label", `${words[0]} ${index + 1}`); });
    add.disabled = rows.length >= RELATED_LINK_LIMIT;
  }
  function append(link) {
    const node = doc.createElement("div"); node.className = "related-link-row"; node.setAttribute("role", "group");
    function field(text, type, value, max) {
      const label = doc.createElement("label"); label.className = "form-field";
      const span = doc.createElement("span"); span.textContent = text;
      const input = doc.createElement("input"); input.type = type; input.value = value; input.required = true; input.maxLength = max; input.autocomplete = "off";
      input.addEventListener("input", () => { input.setCustomValidity(""); status.textContent = ""; });
      label.append(span, input); node.append(label); return input;
    }
    const row = { id: link.id, node, label: field(words[2], "text", link.label, RELATED_LINK_LABEL_MAX), url: field(words[3], "url", link.url, 2048) };
    row.url.setAttribute("autocapitalize", "none"); row.url.spellcheck = false; row.url.inputMode = "url";
    const controls = doc.createElement("div"); controls.className = "related-link-controls";
    const move = (direction) => {
      const index = rows.indexOf(row), target = index + direction;
      if (target < 0 || target >= rows.length) return;
      [rows[index], rows[target]] = [rows[target], rows[index]];
      rows.forEach((entry) => list.append(entry.node)); sync();
      (direction < 0 ? (row.up.disabled ? row.down : row.up) : (row.down.disabled ? row.up : row.down)).focus(); status.textContent = words[8];
    };
    row.up = button(words[5], () => move(-1)); row.down = button(words[6], () => move(1));
    const remove = button(words[4], () => { const index = rows.indexOf(row); rows.splice(index, 1); node.remove(); sync(); (rows[index]?.label || rows[index - 1]?.label || add).focus(); status.textContent = words[9]; });
    controls.append(row.up, row.down, remove); node.append(controls); rows.push(row); list.append(node); sync();
  }
  links.forEach(append); sync();
  return { read() {
    const value = rows.map((row) => ({ id: row.id, label: row.label.value, url: row.url.value }));
    const problems = relatedLinksProblems(value);
    if (problems.length) {
      const problem = problems[0], index = Number(/^\[(\d+)\]/.exec(problem.key)?.[1] || 0);
      const field = problem.key.endsWith(".label") ? rows[index]?.label : rows[index]?.url;
      status.textContent = words[7]; field?.setCustomValidity(words[7]); field?.reportValidity(); field?.focus(); return null;
    }
    return value;
  } };
}
