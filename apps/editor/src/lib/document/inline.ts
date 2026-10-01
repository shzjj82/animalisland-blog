export type ListItem = { content?: string; meta?: { checked?: boolean }; items?: ListItem[] };

export type InlinePart =
  | { kind: "text"; text: string; bold?: boolean; italics?: boolean }
  | { kind: "break" }
  | { kind: "link"; text: string; href: string; bold?: boolean; italics?: boolean };

export function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** 把编辑器里残留的简单 HTML（b/i/a/br）拆成文本片段 */
export function parseInline(html: string): InlinePart[] {
  const root = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html").body.firstElementChild;
  if (!root) {
    return [];
  }
  const parts: InlinePart[] = [];

  const walk = (node: Node, bold: boolean, italics: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").replace(/\u00a0/g, " ");
      if (text) {
        parts.push({ kind: "text", text, bold, italics });
      }
      return;
    }
    if (!(node instanceof HTMLElement)) {
      return;
    }
    if (node.tagName === "BR") {
      parts.push({ kind: "break" });
      return;
    }
    const nextBold = bold || node.tagName === "B" || node.tagName === "STRONG";
    const nextItalic = italics || node.tagName === "I" || node.tagName === "EM";
    if (node.tagName === "A") {
      const href = node.getAttribute("href")?.trim() ?? "";
      const text = (node.textContent ?? "").replace(/\u00a0/g, " ").trim() || href;
      if (href && /^https?:|^mailto:/i.test(href) && text) {
        parts.push({ kind: "link", text, href, bold: nextBold, italics: nextItalic });
        return;
      }
    }
    node.childNodes.forEach((child) => walk(child, nextBold, nextItalic));
  };

  root.childNodes.forEach((child) => walk(child, false, false));
  return parts;
}
