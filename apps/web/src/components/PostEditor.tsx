import { useEffect, useId, useRef } from "react";
import EditorJS, { type OutputData } from "@editorjs/editorjs";
import Delimiter from "@editorjs/delimiter";
import Embed from "@editorjs/embed";
import Header from "@editorjs/header";
import ImageTool from "@editorjs/image";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";
import DragDrop from "editorjs-drag-drop";
import type { EditorJsDocument } from "@myblog/shared";
import { CodeTool } from "@/components/editor/CodeTool";
import { api } from "@/lib/api";

type Props = {
  initial?: EditorJsDocument;
  onReady?: (editor: EditorJS) => void;
};

export function PostEditor({ initial, onReady }: Props) {
  const holderId = `editor${useId().replace(/:/g, "")}`;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let instance: EditorJS | undefined;

    // 等过 React 严格模式的「先挂再卸」，避免旧实例 destroy 把新编辑器清掉
    const timer = window.setTimeout(() => {
      instance = new EditorJS({
        holder: holderId,
        autofocus: true,
        placeholder: "先写一个大标题，回车后继续正文。左侧 + 可加图片、列表、代码。",
        minHeight: 420,
        inlineToolbar: true,
        data: initial?.blocks?.length ? (initial as OutputData) : undefined,
        tools: {
          header: {
            class: Header,
            config: {
              levels: [1, 2, 3],
              defaultLevel: 1,
            },
          },
          list: List,
          quote: Quote,
          code: CodeTool,
          delimiter: Delimiter,
          embed: Embed,
          image: {
            class: ImageTool,
            config: {
              captionPlaceholder: "图片说明，可空",
              buttonContent: "上传图片",
              types: "image/jpeg,image/png,image/webp,image/gif",
              uploader: {
                async uploadByFile(file: File) {
                  const { url } = await api.upload(file);
                  return { success: 1, file: { url } };
                },
                async uploadByUrl(url: string) {
                  return { success: 1, file: { url } };
                },
              },
            },
          },
        },
        onReady: () => {
          if (!instance) {
            return;
          }
          new DragDrop(instance, "2px dashed #d98c3b");
          onReadyRef.current?.(instance);
        },
      });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      const current = instance;
      if (!current) {
        return;
      }
      void current.isReady
        .then(() => current.destroy())
        .catch(() => undefined);
    };
    // 编辑已有文章时靠 key 重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holderId]);

  return <div id={holderId} className="editor-holder" />;
}

export async function saveEditor(editor: EditorJS | null): Promise<EditorJsDocument> {
  if (!editor) {
    return { time: Date.now(), blocks: [] };
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

export async function applyEditorBlocks(
  editor: EditorJS | null,
  blocks: EditorJsDocument["blocks"],
  apply: "append" | "replace",
): Promise<void> {
  if (!editor || blocks.length === 0) {
    return;
  }
  const current = await editor.save();
  const nextBlocks =
    apply === "replace"
      ? blocks
      : [
          ...current.blocks.filter((block) => {
            if (block.type !== "paragraph") {
              return true;
            }
            const text = String((block.data as { text?: string }).text ?? "")
              .replace(/<[^>]+>/g, "")
              .trim();
            return text.length > 0;
          }),
          ...blocks,
        ];
  await editor.render({
    time: Date.now(),
    version: current.version,
    blocks: nextBlocks as OutputData["blocks"],
  });
}
