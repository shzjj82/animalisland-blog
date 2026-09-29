import type { EditorJsDocument } from "@myblog/shared";
import { htmlToBlocks } from "./htmlToBlocks";
import { t } from "@/i18n";

export const WORD_ACCEPT = ".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword";

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || t("document.importedDocument");
}

async function wordToHtml(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".docx")) {
    const { default: mammoth } = await import("mammoth/mammoth.browser.js");
    const result = await mammoth.convertToHtml(
      { arrayBuffer: await file.arrayBuffer() },
      { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] },
    );
    return result.value;
  }
  if (lower.endsWith(".doc")) {
    const text = await file.text();
    if (/<html[\s>]/i.test(text)) {
      return text;
    }
    throw new Error(t("document.legacyDoc"));
  }
  throw new Error(t("document.wordOnly"));
}

export type ImportMode = "replace" | "append" | "prepend";

export type ImportedWord = { name: string; blocks: EditorJsDocument["blocks"] };

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
