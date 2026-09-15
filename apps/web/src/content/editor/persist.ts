import type EditorJS from "@editorjs/editorjs";
import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";

/** 从 Notion 编辑器取出块文档（存 posts.body） */
export async function saveEditor(editor: EditorJS | null): Promise<EditorJsDocument> {
  if (!editor) {
    throw new Error("编辑器尚未就绪");
  }
  const data = await editor.save();
  return {
    time: data.time,
    version: data.version,
    blocks: data.blocks.map((item) => ({
      id: item.id,
      type: item.type,
      data: item.data as Record<string, unknown>,
    })),
  };
}

function scrubFormControls(html: string): string {
  return html
    .replace(/<\s*(input|textarea|select|option|button|form|label)(\s[^>]*)?>/gi, "")
    .replace(/<\s*\/\s*(input|textarea|select|option|button|form|label)\s*>/gi, "")
    .trim();
}

function scrubBlockData(block: EditorJsBlock): EditorJsBlock {
  // AI 若仍返回 code / quote，前端转成段落，杜绝 textarea / 双 cdx-input
  if (block.type === "code") {
    const raw = String(block.data?.code ?? "")
      .replace(/\r\n/g, "\n")
      .trim();
    if (!raw) {
      return { type: "paragraph", data: { text: "" } };
    }
    const escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/\n/g, "<br>");
    return { type: "paragraph", data: { text: scrubFormControls(`<code>${escaped}</code>`) } };
  }

  if (block.type === "quote") {
    const text = scrubFormControls(String(block.data?.text ?? ""));
    const caption = scrubFormControls(String(block.data?.caption ?? ""));
    if (!text) {
      return { type: "paragraph", data: { text: "" } };
    }
    const body = caption ? `<b>${text}</b><br><i>${caption}</i>` : `<b>${text}</b>`;
    return { type: "paragraph", data: { text: body } };
  }

  if (block.type === "delimiter") {
    return { type: "paragraph", data: { text: "" } };
  }

  const data = { ...(block.data ?? {}) };
  if (typeof data.text === "string") {
    data.text = scrubFormControls(data.text);
  }
  if (typeof data.caption === "string") {
    data.caption = scrubFormControls(data.caption);
  }
  if (Array.isArray(data.items)) {
    data.items = data.items.map((item) => {
      if (typeof item === "string") {
        return scrubFormControls(item);
      }
      if (item && typeof item === "object" && "content" in item) {
        return {
          ...(item as Record<string, unknown>),
          content: scrubFormControls(String((item as { content: unknown }).content ?? "")),
        };
      }
      return item;
    });
  }
  return { ...block, data };
}

function plainText(html: unknown): string {
  return String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();
}

/** 插入时丢掉空壳块，避免末尾多出一个空白输入框 */
function isHollowBlock(block: EditorJsBlock): boolean {
  const data = block.data ?? {};
  if (block.type === "paragraph" || block.type === "header" || block.type === "quote") {
    return !plainText(data.text);
  }
  if (block.type === "list") {
    const items = Array.isArray(data.items) ? data.items : [];
    return items.every((item) => {
      if (typeof item === "string") {
        return !plainText(item);
      }
      if (item && typeof item === "object" && "content" in item) {
        return !plainText((item as { content: unknown }).content);
      }
      return true;
    });
  }
  if (block.type === "code") {
    return !String(data.code ?? "").trim();
  }
  if (block.type === "delimiter") {
    return false;
  }
  return false;
}

function isEmptyParagraphAt(editor: EditorJS, index: number): boolean {
  const block = editor.blocks.getBlockByIndex(index);
  if (!block || block.name !== "paragraph") {
    return false;
  }
  const holder = block.holder as HTMLElement | undefined;
  const text = plainText(holder?.innerText ?? holder?.textContent ?? "");
  return !text;
}

/** 在指定下标插入块（Notion 式光标处生成） */
export async function insertEditorBlocksAt(
  editor: EditorJS | null,
  blocks: EditorJsBlock[],
  index: number,
): Promise<{ startIndex: number; count: number; blockIds: string[] }> {
  const usable = blocks.map(scrubBlockData).filter((block) => !isHollowBlock(block));
  if (!editor || usable.length === 0) {
    return { startIndex: index, count: 0, blockIds: [] };
  }
  const total = editor.blocks.getBlocksCount();
  const startIndex = Math.max(0, Math.min(index, total));
  const blockIds: string[] = [];

  for (let i = 0; i < usable.length; i++) {
    const block = usable[i]!;
    // 不聚焦末块，避免 Editor.js 再补一个空白输入段
    editor.blocks.insert(block.type, block.data ?? {}, undefined, startIndex + i, false);
    const id = editor.blocks.getBlockByIndex(startIndex + i)?.id;
    if (id) {
      blockIds.push(id);
    }
  }

  let count = usable.length;
  // 清掉插入段末尾残留空段落
  while (count > 0 && isEmptyParagraphAt(editor, startIndex + count - 1)) {
    editor.blocks.delete(startIndex + count - 1);
    blockIds.pop();
    count -= 1;
  }
  // 插入点后若被自动补了空段，一并删掉
  if (isEmptyParagraphAt(editor, startIndex + count)) {
    editor.blocks.delete(startIndex + count);
  }

  return { startIndex, count, blockIds };
}

export function removeEditorBlocksRange(
  editor: EditorJS | null,
  startIndex: number,
  count: number,
): void {
  if (!editor || count <= 0) {
    return;
  }
  for (let i = 0; i < count; i++) {
    const index = startIndex;
    if (index < 0 || index >= editor.blocks.getBlocksCount()) {
      break;
    }
    editor.blocks.delete(index);
  }
}

export function markEditorPreviewBlocks(blockIds: string[], on: boolean): void {
  for (const id of blockIds) {
    const el = document.querySelector(`.ce-block[data-id="${id}"]`) as HTMLElement | null;
    if (!el) {
      continue;
    }
    el.classList.toggle("ai-preview-block", on);
    // 预览/确认：清掉原生表单控件；引用空 caption 输入框直接移除
    el.querySelectorAll("input, textarea, select, button").forEach((node) => node.remove());
    el.querySelectorAll(".cdx-quote__caption").forEach((caption) => {
      const text = (caption.textContent ?? "").replace(/\u200b/g, "").trim();
      if (!text) {
        caption.remove();
      }
    });
    el.querySelectorAll<HTMLElement>("[contenteditable]").forEach((node) => {
      if (on) {
        node.dataset.aiPrevEditable = node.getAttribute("contenteditable") ?? "true";
        node.setAttribute("contenteditable", "false");
        node.removeAttribute("data-placeholder");
      } else if (node.dataset.aiPrevEditable != null) {
        node.setAttribute("contenteditable", node.dataset.aiPrevEditable);
        delete node.dataset.aiPrevEditable;
      } else {
        node.setAttribute("contenteditable", "true");
      }
    });
  }
}
