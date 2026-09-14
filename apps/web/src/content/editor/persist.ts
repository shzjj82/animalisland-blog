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

/** 在指定下标插入块（Notion 式光标处生成） */
export async function insertEditorBlocksAt(
  editor: EditorJS | null,
  blocks: EditorJsBlock[],
  index: number,
): Promise<{ startIndex: number; count: number; blockIds: string[] }> {
  if (!editor || blocks.length === 0) {
    return { startIndex: index, count: 0, blockIds: [] };
  }
  const total = editor.blocks.getBlocksCount();
  const startIndex = Math.max(0, Math.min(index, total));
  const blockIds: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    editor.blocks.insert(block.type, block.data ?? {}, undefined, startIndex + i, i === blocks.length - 1);
    const id = editor.blocks.getBlockByIndex(startIndex + i)?.id;
    if (id) {
      blockIds.push(id);
    }
  }

  return { startIndex, count: blocks.length, blockIds };
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
    const el = document.querySelector(`.ce-block[data-id="${id}"]`);
    el?.classList.toggle("ai-preview-block", on);
  }
}
