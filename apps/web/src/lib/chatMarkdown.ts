import type { EditorJsBlock } from "@myblog/shared";
import DOMPurify from "dompurify";
import { highlightCode } from "@/lib/highlight";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`\n]+)`/g, '<code class="md-inline-code">$1</code>');
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>',
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
  return out;
}

function splitTableRow(line: string): string[] {
  let raw = line.trim();
  if (raw.startsWith("|")) {
    raw = raw.slice(1);
  }
  if (raw.endsWith("|")) {
    raw = raw.slice(0, -1);
  }
  return raw.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  if (cells.length < 2) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && !isTableSeparator(trimmed);
}

type Block =
  | { kind: "code"; lang: string; code: string }
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "p"; text: string }
  | { kind: "hr" };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (/^\s*```/.test(line)) {
      const lang = line.replace(/^\s*```/, "").trim();
      i += 1;
      const codeLines: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) {
        codeLines.push(lines[i] ?? "");
        i += 1;
      }
      if (i < lines.length) {
        i += 1;
      }
      blocks.push({ kind: "code", lang, code: codeLines.join("\n") });
      continue;
    }

    // GFM 表格：表头 + 分隔行 + 数据行
    if (
      isTableRow(line) &&
      i + 1 < lines.length &&
      isTableSeparator(lines[i + 1] ?? "")
    ) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i] ?? "")) {
        const cells = splitTableRow(lines[i] ?? "");
        while (cells.length < headers.length) {
          cells.push("");
        }
        rows.push(cells.slice(0, headers.length));
        i += 1;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    if (/^\s*---+\s*$/.test(line) || /^\s*\*\*\*+\s*$/.test(line)) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: Math.min(3, heading[1]!.length) as 1 | 2 | 3,
        text: heading[2]!.trim(),
      });
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i] ?? "")) {
        quoteLines.push((lines[i] ?? "").replace(/^\s*>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? "")) {
        items.push((lines[i] ?? "").replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      (lines[i] ?? "").trim() &&
      !/^\s*```/.test(lines[i] ?? "") &&
      !/^(#{1,3})\s+/.test(lines[i] ?? "") &&
      !/^\s*>\s?/.test(lines[i] ?? "") &&
      !/^\s*[-*+]\s+/.test(lines[i] ?? "") &&
      !/^\s*\d+\.\s+/.test(lines[i] ?? "") &&
      !/^\s*---+\s*$/.test(lines[i] ?? "") &&
      !(
        isTableRow(lines[i] ?? "") &&
        i + 1 < lines.length &&
        isTableSeparator(lines[i + 1] ?? "")
      )
    ) {
      para.push(lines[i] ?? "");
      i += 1;
    }
    blocks.push({ kind: "p", text: para.join("\n") });
  }

  return blocks;
}

function blockToHtml(block: Block): string {
  switch (block.kind) {
    case "code": {
      const highlighted = highlightCode(block.code, block.lang || "plaintext");
      const langClass = block.lang ? ` language-${escapeHtml(block.lang)}` : "";
      return `<pre class="md-pre"><code class="hljs${langClass}">${highlighted}</code></pre>`;
    }
    case "heading":
      return `<h${block.level} class="md-h">${renderInline(block.text)}</h${block.level}>`;
    case "quote":
      return `<blockquote class="md-quote">${block.lines
        .map((line) => `<p>${renderInline(line)}</p>`)
        .join("")}</blockquote>`;
    case "ul":
      return `<ul class="md-ul">${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`;
    case "ol":
      return `<ol class="md-ol">${block.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ol>`;
    case "table": {
      const thead = `<thead><tr>${block.headers
        .map((cell) => `<th>${renderInline(cell)}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${block.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody>`;
      return `<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`;
    }
    case "hr":
      return `<hr class="md-hr" />`;
    case "p":
      return `<p class="md-p">${renderInline(block.text).replace(/\n/g, "<br />")}</p>`;
    default:
      return "";
  }
}

const PURIFY = {
  ALLOWED_TAGS: [
    "p",
    "br",
    "strong",
    "em",
    "a",
    "code",
    "pre",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "blockquote",
    "hr",
    "span",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "div",
  ],
  ALLOWED_ATTR: ["href", "target", "rel", "class"],
};

/** 将 Editor.js blocks 转成可预览的 Markdown（确认写入前查看） */
export function blocksToPreviewMarkdown(blocks: EditorJsBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    const data = block.data ?? {};
    switch (block.type) {
      case "header": {
        const level = Math.min(3, Math.max(1, Number(data.level) || 2));
        const text = String(data.text ?? "").trim();
        if (text) {
          parts.push(`${"#".repeat(level)} ${stripHtml(text)}`);
        }
        break;
      }
      case "paragraph": {
        const text = String(data.text ?? "").trim();
        if (text) {
          parts.push(stripHtml(text));
        }
        break;
      }
      case "list": {
        const items = Array.isArray(data.items) ? data.items : [];
        const ordered = data.style === "ordered";
        const lines = items
          .map((item, index) => {
            const text = stripHtml(typeof item === "string" ? item : String((item as { content?: string })?.content ?? ""));
            return ordered ? `${index + 1}. ${text}` : `- ${text}`;
          })
          .filter(Boolean);
        if (lines.length) {
          parts.push(lines.join("\n"));
        }
        break;
      }
      case "table": {
        const content = Array.isArray(data.content) ? (data.content as string[][]) : [];
        if (content.length) {
          const header = content[0] ?? [];
          const sep = header.map(() => "---");
          const rows = [header, sep, ...content.slice(1)].map(
            (row) => `| ${row.map((cell) => stripHtml(String(cell ?? ""))).join(" | ")} |`,
          );
          parts.push(rows.join("\n"));
        }
        break;
      }
      case "quote": {
        const text = stripHtml(String(data.text ?? "").trim());
        if (text) {
          parts.push(text.split("\n").map((line) => `> ${line}`).join("\n"));
        }
        break;
      }
      case "image": {
        const file = data.file as { url?: string } | undefined;
        const url = file?.url || String(data.url ?? "");
        const caption = stripHtml(String(data.caption ?? "").trim());
        if (url) {
          parts.push(caption ? `![${caption}](${url})` : `![](${url})`);
        }
        break;
      }
      default: {
        const text = stripHtml(String(data.text ?? "").trim());
        if (text) {
          parts.push(text);
        }
      }
    }
  }
  return parts.join("\n\n");
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** 聊天气泡 Markdown → 安全 HTML */
export function renderChatMarkdown(source: string): string {
  const raw = String(source ?? "");
  if (!raw.trim()) {
    return "";
  }
  const html = parseBlocks(raw).map(blockToHtml).join("");
  return DOMPurify.sanitize(html, { ...PURIFY });
}
