import type { OutputBlockData } from "@editorjs/editorjs";

type ListItem = { content: string; meta: { checked?: boolean }; items: ListItem[] };

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DETAILS", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION",
  "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL",
  "P", "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "UL",
]);
const DROP_TAGS = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "NOSCRIPT", "TEMPLATE", "SVG", "IMG", "VIDEO", "AUDIO", "IFRAME", "OBJECT", "BUTTON", "SELECT", "TEXTAREA"]);

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\u00a0/g, " ");
}

function safeHref(value: string | null): string | null {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, "https://invalid.local/");
    if (url.origin === "https://invalid.local") {
      return null;
    }
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function isBold(el: HTMLElement): boolean {
  if (el.tagName === "B" || el.tagName === "STRONG") {
    return el.style.fontWeight !== "normal" && el.style.fontWeight !== "400";
  }
  const weight = el.style.fontWeight;
  return weight === "bold" || weight === "bolder" || Number(weight) >= 600;
}

function isItalic(el: HTMLElement): boolean {
  return el.tagName === "I" || el.tagName === "EM" || el.style.fontStyle === "italic";
}

/** 只保留 b / i / a / br 这几种行内格式，其余标签拆掉取文字 */
function inlineHtml(node: Node): string {
  let out = "";
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      out += escapeText((child.textContent ?? "").replace(/[\r\n\t]+/g, " "));
      return;
    }
    if (!(child instanceof HTMLElement) || DROP_TAGS.has(child.tagName)) {
      return;
    }
    if (child.tagName === "BR") {
      out += "<br>";
      return;
    }
    if (child.tagName === "INPUT") {
      return;
    }
    let inner = inlineHtml(child);
    if (!inner.trim()) {
      out += inner;
      return;
    }
    if (isItalic(child)) {
      inner = `<i>${inner}</i>`;
    }
    if (isBold(child)) {
      inner = `<b>${inner}</b>`;
    }
    const href = child.tagName === "A" ? safeHref(child.getAttribute("href")) : null;
    out += href ? `<a href="${escapeText(href).replace(/"/g, "&quot;")}">${inner}</a>` : inner;
  });
  return out;
}

function tidy(html: string): string {
  return html
    .replace(/ {2,}/g, " ")
    .replace(/^(\s|<br>)+|(\s|<br>)+$/g, "");
}

function pushImage(img: HTMLElement, blocks: OutputBlockData[]) {
  const src = img.getAttribute("src")?.trim() ?? "";
  if (!src.startsWith("import-image://") && !/^https?:\/\//i.test(src)) {
    return;
  }
  blocks.push({
    type: "image",
    data: { file: { url: src }, caption: img.getAttribute("alt") ?? "" },
  });
}

/** 段落里夹着的图片拆成独立图片块，前后文字仍是段落 */
function appendInlineAndImages(el: HTMLElement, blocks: OutputBlockData[]) {
  let bucket = document.createElement("span");
  const flushInline = () => {
    const text = tidy(inlineHtml(bucket));
    if (text) {
      blocks.push({ type: "paragraph", data: { text } });
    }
    bucket = document.createElement("span");
  };
  el.childNodes.forEach((node) => {
    if (node instanceof HTMLElement && node.tagName === "IMG") {
      flushInline();
      pushImage(node, blocks);
      return;
    }
    bucket.appendChild(node.cloneNode(true));
  });
  flushInline();
}

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((child) => BLOCK_TAGS.has(child.tagName) || hasBlockChild(child));
}

function listItems(list: Element): { items: ListItem[]; checklist: boolean } {
  let checklist = false;
  const items: ListItem[] = [];
  for (const li of Array.from(list.children)) {
    if (li.tagName !== "LI") {
      continue;
    }
    const clone = li.cloneNode(true) as HTMLElement;
    const nested = Array.from(clone.children).filter((child) => child.tagName === "UL" || child.tagName === "OL");
    nested.forEach((child) => child.remove());
    const box = li.querySelector<HTMLInputElement>(":scope > input[type=checkbox], :scope > * > input[type=checkbox]");
    const ariaChecked = li.getAttribute("aria-checked");
    if (box || ariaChecked !== null) {
      checklist = true;
    }
    const children: ListItem[] = [];
    for (const sub of Array.from(li.children)) {
      if (sub.tagName === "UL" || sub.tagName === "OL") {
        const result = listItems(sub);
        checklist ||= result.checklist;
        children.push(...result.items);
      }
    }
    items.push({
      content: tidy(inlineHtml(clone)),
      meta: box || ariaChecked !== null ? { checked: box?.checked || box?.hasAttribute("checked") || ariaChecked === "true" } : {},
      items: children,
    });
  }
  return { items, checklist };
}

function tableRows(table: Element): { rows: string[][]; withHeadings: boolean } {
  const rows: string[][] = [];
  let withHeadings = false;
  table.querySelectorAll("tr").forEach((tr, index) => {
    if (tr.closest("table") !== table) {
      return;
    }
    const cells = Array.from(tr.children).filter((cell) => cell.tagName === "TD" || cell.tagName === "TH");
    if (index === 0 && cells.length > 0 && cells.every((cell) => cell.tagName === "TH")) {
      withHeadings = true;
    }
    rows.push(cells.map((cell) => tidy(inlineHtml(cell))));
  });
  const width = Math.max(0, ...rows.map((row) => row.length));
  return { rows: rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]), withHeadings };
}

function walk(container: Node, blocks: OutputBlockData[]): void {
  let pending = document.createElement("div");
  const flush = () => {
    const text = tidy(inlineHtml(pending));
    if (text) {
      blocks.push({ type: "paragraph", data: { text } });
    }
    pending = document.createElement("div");
  };

  container.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      pending.appendChild(child.cloneNode());
      return;
    }
    if (child instanceof HTMLElement && child.tagName === "IMG") {
      flush();
      pushImage(child, blocks);
      return;
    }
    if (!(child instanceof HTMLElement) || DROP_TAGS.has(child.tagName)) {
      return;
    }
    const tag = child.tagName;
    if (!BLOCK_TAGS.has(tag) && !hasBlockChild(child)) {
      pending.appendChild(child.cloneNode(true));
      return;
    }
    flush();
    if (/^H[1-6]$/.test(tag)) {
      const text = tidy(inlineHtml(child));
      if (text) {
        blocks.push({ type: "header", data: { text, level: Math.min(3, Number(tag[1])) } });
      }
      return;
    }
    if (tag === "UL" || tag === "OL") {
      const { items, checklist } = listItems(child);
      if (items.length > 0) {
        blocks.push({
          type: "list",
          data: { style: checklist ? "checklist" : tag === "OL" ? "ordered" : "unordered", meta: {}, items },
        });
      }
      return;
    }
    if (tag === "BLOCKQUOTE") {
      const parts: OutputBlockData[] = [];
      walk(child, parts);
      const text = parts.map((part) => String((part.data as { text?: string }).text ?? "")).filter(Boolean).join("<br>");
      if (text) {
        blocks.push({ type: "quote", data: { text, caption: "", alignment: "left" } });
      }
      return;
    }
    if (tag === "PRE") {
      const text = escapeText(child.textContent ?? "").replace(/\n+$/, "").replace(/\n/g, "<br>");
      if (text.trim()) {
        blocks.push({ type: "paragraph", data: { text } });
      }
      return;
    }
    if (tag === "TABLE") {
      const { rows, withHeadings } = tableRows(child);
      if (rows.length > 0) {
        blocks.push({ type: "table", data: { withHeadings, content: rows } });
      }
      return;
    }
    if (tag === "HR") {
      blocks.push({ type: "delimiter", data: {} });
      return;
    }
    if (tag === "P" && !hasBlockChild(child)) {
      appendInlineAndImages(child, blocks);
      return;
    }
    walk(child, blocks);
  });
  flush();
}

export function sanitizeInline(html: string): string {
  return inlineHtml(new DOMParser().parseFromString(html, "text/html").body);
}

/** 把剪贴板里的 HTML 转成编辑器块；标题只保留到三级。http(s) 和 import-image 图片会变成图片块 */
export function htmlToBlocks(html: string): OutputBlockData[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const blocks: OutputBlockData[] = [];
  walk(doc.body, blocks);
  return blocks;
}
