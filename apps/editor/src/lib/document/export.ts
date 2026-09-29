import type { EditorJsDocument } from "@myblog/shared";
import { sanitizeInline } from "./htmlToBlocks";
import { t } from "@/i18n";

export type ExportFormat = "pdf" | "word";

type ListItem = { content?: string; meta?: { checked?: boolean }; items?: ListItem[] };

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function listHtml(style: string, items: ListItem[]): string {
  const tag = style === "ordered" ? "ol" : "ul";
  const rows = items
    .map((item) => {
      const mark = style === "checklist" ? `${item.meta?.checked ? "☑" : "☐"} ` : "";
      const nested = item.items?.length ? listHtml(style, item.items) : "";
      return `<li>${mark}${sanitizeInline(item.content ?? "")}${nested}</li>`;
    })
    .join("");
  return `<${tag}${style === "checklist" ? ' class="checklist"' : ""}>${rows}</${tag}>`;
}

function blockHtml(block: EditorJsDocument["blocks"][number]): string {
  const data = (block.data ?? {}) as Record<string, unknown>;
  const text = (value: unknown) => sanitizeInline(typeof value === "string" ? value : "");
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

function documentHtml(title: string, doc: EditorJsDocument, extraHead = ""): string {
  const body = doc.blocks.map(blockHtml).filter(Boolean).join("\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeText(title)}</title>${extraHead}<style>${STYLE}</style></head><body><main>${body}</main></body></html>`;
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

/** Word 可以直接打开带 Office 命名空间的 HTML，保存成 .doc */
function exportWord(title: string, doc: EditorJsDocument): void {
  const html = documentHtml(title, doc)
    .replace("<html>", '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">');
  download(new Blob(["\ufeff", html], { type: "application/msword" }), fileName(title, "doc"));
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

export function exportDocument(format: ExportFormat, title: string, doc: EditorJsDocument): void {
  if (format === "word") {
    exportWord(title, doc);
  } else {
    exportPdf(title, doc);
  }
}
