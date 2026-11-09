import type { EditorJsDocument } from "@myblog/shared";
import { markdownToEditorBlocks } from "@/lib/ai/markdown";

/** Markdown 源文 → Editor.js 文档 */
export function documentFromMarkdown(source: string): EditorJsDocument {
  const blocks = markdownToEditorBlocks(source);
  return {
    time: Date.now(),
    version: "2.30.7",
    blocks: blocks.length
      ? blocks
      : [
          {
            type: "header",
            data: { text: "", level: 1 },
          },
        ],
  };
}

export function titleFromMarkdown(source: string, fallback: string): string {
  for (const block of documentFromMarkdown(source).blocks) {
    if (block.type !== "header") continue;
    const text = String(block.data.text ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (text) return text;
  }
  return fallback;
}
