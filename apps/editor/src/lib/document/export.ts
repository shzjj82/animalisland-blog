import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type FileChild,
  type IBorderOptions,
} from "docx";
import type { EditorJsDocument } from "@myblog/shared";
import { t } from "@/i18n";

export type ExportFormat = "pdf" | "word";

type ListItem = { content?: string; meta?: { checked?: boolean }; items?: ListItem[] };

type InlinePart =
  | { kind: "text"; text: string; bold?: boolean; italics?: boolean }
  | { kind: "break" }
  | { kind: "link"; text: string; href: string; bold?: boolean; italics?: boolean };

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function stripTags(html: string): string {
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

/** 把编辑器里残留的简单 HTML（b/i/a/br）拆成 docx 文本片段 */
function parseInline(html: string): InlinePart[] {
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

function inlineRuns(html: string): Array<TextRun | ExternalHyperlink> {
  const runs: Array<TextRun | ExternalHyperlink> = [];
  for (const part of parseInline(html)) {
    if (part.kind === "break") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (part.kind === "link") {
      runs.push(
        new ExternalHyperlink({
          children: [new TextRun({ text: part.text, bold: part.bold, italics: part.italics, style: "Hyperlink" })],
          link: part.href,
        }),
      );
      continue;
    }
    runs.push(new TextRun({ text: part.text, bold: part.bold, italics: part.italics }));
  }
  return runs.length ? runs : [new TextRun("")];
}

function heading(level: number) {
  if (level <= 1) {
    return HeadingLevel.HEADING_1;
  }
  if (level === 2) {
    return HeadingLevel.HEADING_2;
  }
  return HeadingLevel.HEADING_3;
}

function listParagraphs(style: string, items: ListItem[], depth = 0): Paragraph[] {
  const out: Paragraph[] = [];
  items.forEach((item, index) => {
    const mark =
      style === "checklist"
        ? `${item.meta?.checked ? "☑" : "☐"} `
        : style === "ordered"
          ? `${index + 1}. `
          : "• ";
    const indent = { left: 360 * (depth + 1) };
    out.push(
      new Paragraph({
        indent,
        children: [new TextRun(mark), ...inlineRuns(String(item.content ?? ""))],
      }),
    );
    if (item.items?.length) {
      out.push(...listParagraphs(style, item.items, depth + 1));
    }
  });
  return out;
}

const thinBorder: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "D9D9D6" };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function tableFromBlock(data: Record<string, unknown>): Table | null {
  const rows = (data.content as string[][] | undefined) ?? [];
  if (!rows.length) {
    return null;
  }
  const head = Boolean(data.withHeadings);
  const width = Math.max(...rows.map((row) => row.length), 1);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row, rowIndex) => {
      const isHead = head && rowIndex === 0;
      return new TableRow({
        children: Array.from({ length: width }, (_, col) => {
          const html = String(row[col] ?? "");
          const runs = isHead
            ? [new TextRun({ text: stripTags(html) || " ", bold: true })]
            : inlineRuns(html);
          return new TableCell({
            borders: cellBorders,
            width: { size: Math.floor(100 / width), type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: runs })],
          });
        }),
      });
    }),
  });
}

function blocksToChildren(doc: EditorJsDocument): FileChild[] {
  const children: FileChild[] = [];
  for (const block of doc.blocks ?? []) {
    const data = (block.data ?? {}) as Record<string, unknown>;
    switch (block.type) {
      case "header": {
        const level = Math.min(3, Math.max(1, Number(data.level) || 1));
        children.push(
          new Paragraph({
            heading: heading(level),
            children: inlineRuns(String(data.text ?? "")),
          }),
        );
        break;
      }
      case "paragraph":
        children.push(new Paragraph({ children: inlineRuns(String(data.text ?? "")) }));
        break;
      case "list":
        children.push(...listParagraphs(String(data.style ?? "unordered"), (data.items as ListItem[] | undefined) ?? []));
        break;
      case "quote": {
        children.push(
          new Paragraph({
            indent: { left: 420 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: "191919", space: 8 } },
            children: inlineRuns(String(data.text ?? "")),
          }),
        );
        if (data.caption) {
          children.push(
            new Paragraph({
              indent: { left: 420 },
              children: [new TextRun({ text: stripTags(String(data.caption)), italics: true, color: "787774", size: 20 })],
            }),
          );
        }
        break;
      }
      case "delimiter":
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun("—")] }));
        break;
      case "table": {
        const table = tableFromBlock(data);
        if (table) {
          children.push(table);
        }
        break;
      }
      case "pageLink":
        children.push(
          new Paragraph({
            children: [new TextRun(`↗ ${String(data.title ?? t("common.subpage"))}`)],
          }),
        );
        break;
      case "attachment":
        if (data.name) {
          children.push(new Paragraph({ children: [new TextRun(`📎 ${String(data.name)}`)] }));
        }
        break;
      default:
        break;
    }
  }
  return children.length ? children : [new Paragraph({ children: [new TextRun("")] })];
}

function listHtml(style: string, items: ListItem[]): string {
  const tag = style === "ordered" ? "ol" : "ul";
  const rows = items
    .map((item) => {
      const mark = style === "checklist" ? `${item.meta?.checked ? "☑" : "☐"} ` : "";
      const nested = item.items?.length ? listHtml(style, item.items) : "";
      return `<li>${mark}${String(item.content ?? "")}${nested}</li>`;
    })
    .join("");
  return `<${tag}${style === "checklist" ? ' class="checklist"' : ""}>${rows}</${tag}>`;
}

function blockHtml(block: EditorJsDocument["blocks"][number]): string {
  const data = (block.data ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => String(typeof value === "string" ? value : "");
  switch (block.type) {
    case "header": {
      const level = Math.min(3, Math.max(1, Number(data.level) || 1));
      return `<h${level}>${text(data.text)}</h${level}>`;
    }
    case "paragraph":
      return `<p>${text(data.text)}</p>`;
    case "list":
      return listHtml(String(data.style ?? "unordered"), (data.items as ListItem[] | undefined) ?? []);
    case "quote": {
      const caption = text(data.caption);
      return `<blockquote><p>${text(data.text)}</p>${caption ? `<footer>${caption}</footer>` : ""}</blockquote>`;
    }
    case "delimiter":
      return "<hr>";
    case "table": {
      const rows = (data.content as string[][] | undefined) ?? [];
      const head = Boolean(data.withHeadings);
      const body = rows
        .map((row, index) => {
          const cell = head && index === 0 ? "th" : "td";
          return `<tr>${row.map((value) => `<${cell}>${text(value)}</${cell}>`).join("")}</tr>`;
        })
        .join("");
      return `<table>${body}</table>`;
    }
    case "pageLink":
      return `<p>↗ ${escapeText(String(data.title ?? t("common.subpage")))}</p>`;
    case "attachment":
      return data.name ? `<p>📎 ${escapeText(String(data.name))}</p>` : "";
    default:
      return "";
  }
}

const STYLE = `
body { font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif; color: #191919; line-height: 1.7; font-size: 14px; margin: 0; }
main { max-width: 720px; margin: 0 auto; padding: 32px 24px; }
h1 { font-size: 28px; margin: 24px 0 12px; } h2 { font-size: 22px; margin: 20px 0 10px; } h3 { font-size: 18px; margin: 16px 0 8px; }
p { margin: 6px 0; } a { color: #191919; }
blockquote { margin: 12px 0; padding-left: 14px; border-left: 3px solid #191919; }
blockquote footer { color: #787774; font-size: 12px; }
ul.checklist { list-style: none; padding-left: 4px; }
hr { border: 0; border-top: 1px solid #e9e9e7; margin: 20px 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; }
th, td { border: 1px solid #d9d9d6; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f7f7f5; }
@page { margin: 16mm; }
`;

function documentHtml(title: string, doc: EditorJsDocument): string {
  const body = doc.blocks.map(blockHtml).filter(Boolean).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
}

function fileName(title: string, ext: string): string {
  const safe = title.replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 80) || t("document.untitled");
  return `${safe}.${ext}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 导出真正的 OOXML `.docx`，与导入（mammoth）对齐 */
async function exportWord(title: string, doc: EditorJsDocument): Promise<void> {
  const document = new Document({
    creator: "Animal Island Editor",
    title,
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
          },
        },
        children: blocksToChildren(doc),
      },
    ],
  });
  const blob = await Packer.toBlob(document);
  download(blob, fileName(title, "docx"));
}

/** 用隐藏 iframe 调起系统打印，在打印面板里选「存储为 PDF」 */
function exportPdf(title: string, doc: EditorJsDocument): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;";
  frame.srcdoc = documentHtml(title, doc);
  frame.onload = () => {
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      return;
    }
    win.addEventListener("afterprint", () => setTimeout(() => frame.remove(), 0));
    win.focus();
    win.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export async function exportDocument(format: ExportFormat, title: string, doc: EditorJsDocument): Promise<void> {
  if (format === "word") {
    await exportWord(title, doc);
  } else {
    exportPdf(title, doc);
  }
}
