import { useEffect, useRef } from "react";
import EditorJS, { type OutputData } from "@editorjs/editorjs";
import Code from "@editorjs/code";
import Delimiter from "@editorjs/delimiter";
import Header from "@editorjs/header";
import ImageTool from "@editorjs/image";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";
import type { EditorJsDocument } from "@myblog/shared";
import { api } from "@/lib/api";

type Props = {
  initial?: EditorJsDocument;
  onReady?: (editor: EditorJS) => void;
};

export function PostEditor({ initial, onReady }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorJS | null>(null);

  useEffect(() => {
    if (!holder.current || editor.current) {
      return;
    }

    const instance = new EditorJS({
      holder: holder.current,
      placeholder: "输入 / 或点上方工具，开始写一块内容…",
      minHeight: 280,
      data: initial as OutputData | undefined,
      tools: {
        header: Header,
        list: List,
        quote: Quote,
        code: Code,
        delimiter: Delimiter,
        image: {
          class: ImageTool,
          config: {
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
    });

    editor.current = instance;
    void instance.isReady.then(() => onReady?.(instance));

    return () => {
      void instance.isReady.then(() => instance.destroy());
      editor.current = null;
    };
    // 只初始化一次；编辑已有文章时靠 key 重挂载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={holder} className="editor-holder" />;
}

export async function saveEditor(editor: EditorJS | null): Promise<EditorJsDocument> {
  if (!editor) {
    return { time: Date.now(), blocks: [] };
  }
  const data = await editor.save();
  return {
    time: data.time,
    version: data.version,
    blocks: data.blocks.map((block) => ({
      id: block.id,
      type: block.type,
      data: block.data as Record<string, unknown>,
    })),
  };
}
