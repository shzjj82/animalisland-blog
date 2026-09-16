import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";

function plainText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** 跳过过短、纯符号、斜杠命令残留等无意义摘要 */
function isUsefulSummary(text: string): boolean {
  if (text.length < 8) {
    return false;
  }
  if (/^[\/\\|#*\-_=.。，,!！?？…·\s]+$/.test(text)) {
    return false;
  }
  return true;
}

function listPlain(data: Record<string, unknown>): string {
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((item) => {
      if (typeof item === "string") {
        return plainText(item);
      }
      if (item && typeof item === "object" && "content" in item) {
        return plainText((item as { content: unknown }).content);
      }
      return "";
    })
    .filter(Boolean)
    .join("；");
}

function summaryFromBlock(block: EditorJsBlock): string {
  if (block.type === "paragraph") {
    return plainText(block.data.text);
  }
  if (block.type === "quote") {
    return plainText(block.data.text);
  }
  if (block.type === "list") {
    return listPlain(block.data);
  }
  return "";
}

export type EditorMeta = {
  title: string;
  summary: string;
  coverUrl: string;
};

/** 从 Editor.js 文档里抽出列表/SEO 需要的标题、摘要、封面 */
export function metaFromEditorDocument(document: EditorJsDocument, fallback: Partial<EditorMeta> = {}): EditorMeta {
  let title = "";
  let summary = "";
  let coverUrl = "";

  for (const block of document.blocks ?? []) {
    if (!title && block.type === "header") {
      title = plainText(block.data.text);
    }
    if (!summary) {
      const candidate = summaryFromBlock(block).slice(0, 160);
      if (isUsefulSummary(candidate)) {
        summary = candidate;
      }
    }
    if (!coverUrl && block.type === "image") {
      const file = block.data.file as { url?: string } | undefined;
      coverUrl = file?.url?.trim() ?? "";
    }
    if (title && summary && coverUrl) {
      break;
    }
  }

  const fallbackSummary = fallback.summary?.trim() || "";
  return {
    title: title || fallback.title?.trim() || "无标题",
    summary: summary || (isUsefulSummary(fallbackSummary) ? fallbackSummary : ""),
    coverUrl: coverUrl || fallback.coverUrl?.trim() || "",
  };
}

/** 打开已有文章时，若正文没有标题块，把库里的标题补成第一块 */
export function ensureTitleHeader(document: EditorJsDocument, title: string): EditorJsDocument {
  const blocks = [...(document.blocks ?? [])];
  const first = blocks[0];
  const heading = title.trim();
  if (!heading) {
    return { ...document, blocks };
  }
  if (first?.type === "header") {
    return document;
  }
  const header: EditorJsBlock = {
    type: "header",
    data: { text: heading, level: 1 },
  };
  return {
    ...document,
    blocks: [header, ...blocks],
  };
}
