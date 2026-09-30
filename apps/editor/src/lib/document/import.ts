import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";
import { htmlToBlocks } from "./htmlToBlocks";
import { fileExtension } from "./fileKinds";
import { t } from "@/i18n";
import { markdownToEditorBlocks } from "@/lib/ai/markdown";

export const WORD_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 空行分段，段内换行保留为 <br> */
function textToBlocks(text: string): EditorJsBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ type: "paragraph", data: { text: escapeHtml(part).replace(/\n/g, "<br>") } }));
}

/** 拖进来直接转成正文的文件：Markdown、纯文本；其他类型返回 null */
export async function readInsertable(file: File): Promise<EditorJsBlock[] | null> {
  const ext = fileExtension(file.name);
  if (ext === "md" || ext === "markdown") {
    return markdownToEditorBlocks(await file.text());
  }
  if (ext === "txt" || (!ext && file.type.startsWith("text/plain"))) {
    return textToBlocks(await file.text());
  }
  return null;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || t("document.importedDocument");
}

async function wordToHtml(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx")) {
    if (lower.endsWith(".doc")) {
      throw new Error(t("document.legacyDoc"));
    }
    throw new Error(t("document.wordOnly"));
  }
  const { default: mammoth } = await import("mammoth/mammoth.browser.js");
  const result = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] },
  );
  return result.value;
}

export type ImportMode = "replace" | "append" | "prepend";

export type ImportedWord = { name: string; blocks: EditorJsDocument["blocks"] };

const MAX_TABLE_ROWS = 300;
const MAX_TABLE_COLS = 30;

function escapeCell(value: unknown): string {
  return escapeHtml(String(value ?? "")).replace(/\n/g, "<br>");
}

/** 每个工作表转成一个表格块；多个工作表时前面加工作表名作小标题 */
export async function importSpreadsheet(file: File): Promise<ImportedWord> {
  const XLSX = await import("xlsx");
  const workbook =
    fileExtension(file.name) === "csv"
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const blocks: EditorJsDocument["blocks"] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false })
      .slice(0, MAX_TABLE_ROWS);
    if (rows.length === 0) {
      continue;
    }
    const width = Math.min(MAX_TABLE_COLS, Math.max(...rows.map((row) => row.length)));
    if (workbook.SheetNames.length > 1) {
      blocks.push({ type: "header", data: { text: escapeHtml(sheetName), level: 3 } });
    }
    blocks.push({
      type: "table",
      data: {
        withHeadings: true,
        content: rows.map((row) => Array.from({ length: width }, (_, index) => escapeCell(row[index]))),
      },
    });
  }
  if (blocks.length === 0) {
    throw new Error(t("document.emptyImport"));
  }
  return { name: baseName(file.name), blocks };
}

export async function importWord(file: File): Promise<ImportedWord> {
  const blocks = htmlToBlocks(await wordToHtml(file)) as EditorJsDocument["blocks"];
  if (blocks.length === 0) {
    throw new Error(t("document.emptyImport"));
  }
  return { name: baseName(file.name), blocks };
}

/**
 * 覆盖：没有标题时用文件名补一个；插入头部：放在页面标题之后，标题保持不变。
 */
export function mergeImported(mode: ImportMode, current: EditorJsDocument, imported: ImportedWord): EditorJsDocument {
  const blocks = current.blocks ?? [];
  let next: EditorJsDocument["blocks"];
  if (mode === "replace") {
    next =
      imported.blocks[0]?.type === "header"
        ? imported.blocks
        : [{ type: "header", data: { text: imported.name, level: 1 } }, ...imported.blocks];
  } else if (mode === "append") {
    next = [...blocks, ...imported.blocks];
  } else {
    const titled = blocks[0]?.type === "header" ? 1 : 0;
    next = [...blocks.slice(0, titled), ...imported.blocks, ...blocks.slice(titled)];
  }
  return { ...current, time: Date.now(), blocks: next };
}
