/**
 * 后台 Notion 式块编辑器（仅工作区使用，不进前台 bundle）。
 * 产出 EditorJsDocument，由 BlogContent 在公开页按博客样式渲染。
 */
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
import { AiAssistTriggerTool, type AiAssistTriggerConfig } from "@/components/editor/AiAssistTriggerTool";
import { CodeTool } from "@/components/editor/CodeTool";
import { PageLinkTool, type PageLinkToolConfig } from "@/components/editor/PageLinkTool";
import { api } from "@/lib/api";

export type NotionEditorProps = {
  initial?: EditorJsDocument;
  onReady?: (editor: EditorJS) => void;
  /** 内容变更（已 debounce），用于侧栏标题即时预览等 */
  onChange?: (document: EditorJsDocument) => void;
  /** 子页面块：/ 新建、点开子页 */
  pageLink?: PageLinkToolConfig;
  /** 写作助手：/ 唤起光标处 inline AI */
  aiAssist?: AiAssistTriggerConfig;
};

export function NotionEditor({ initial, onReady, onChange, pageLink, aiAssist }: NotionEditorProps) {
  const holderId = `editor${useId().replace(/:/g, "")}`;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pageLinkRef = useRef(pageLink);
  pageLinkRef.current = pageLink;
  const aiAssistRef = useRef(aiAssist);
  aiAssistRef.current = aiAssist;

  useEffect(() => {
    let instance: EditorJS | undefined;
    let changeTimer = 0;

    const timer = window.setTimeout(() => {
      const pageLinkConfig: PageLinkToolConfig | undefined = pageLink
        ? {
            onOpen: (page) => pageLinkRef.current?.onOpen?.(page),
            createChild: pageLink?.createChild
              ? () => {
                  const create = pageLinkRef.current?.createChild;
                  if (!create) {
                    return Promise.reject(new Error("当前编辑器不支持新建子页面"));
                  }
                  return create();
                }
              : undefined,
          }
        : undefined;
      const aiAssistConfig: AiAssistTriggerConfig | undefined = aiAssist
        ? {
            onInvoke: (ctx) => aiAssistRef.current?.onInvoke?.(ctx),
          }
        : undefined;

      const slashHint =
        pageLink?.createChild && aiAssist
          ? "写一个大标题，回车后继续正文。输入 / 可选「子页面」「写作助手」。"
          : pageLink?.createChild
            ? "写一个大标题，回车后继续正文。输入 / 选「子页面」可建子页。"
            : aiAssist
              ? "写一个大标题，回车后继续正文。输入 / 选「写作助手」在光标处生成。"
              : "写一个大标题，回车后继续正文。左侧 + 可加块。";

      instance = new EditorJS({
        holder: holderId,
        autofocus: true,
        placeholder: slashHint,
        minHeight: 200,
        inlineToolbar: true,
        data: initial?.blocks?.length ? (initial as OutputData) : undefined,
        onChange: () => {
          if (!onChangeRef.current || !instance) {
            return;
          }
          window.clearTimeout(changeTimer);
          changeTimer = window.setTimeout(() => {
            void instance
              ?.save()
              .then((data) => {
                onChangeRef.current?.(data as EditorJsDocument);
              })
              .catch(() => undefined);
          }, 180);
        },
        tools: {
          header: {
            class: Header,
            config: { levels: [1, 2, 3], defaultLevel: 1 },
          },
          list: List,
          quote: Quote,
          code: CodeTool,
          delimiter: Delimiter,
          embed: Embed,
          pageLink: {
            class: PageLinkTool,
            config: pageLinkConfig,
          },
          ...(aiAssistConfig
            ? {
                aiAssist: {
                  class: AiAssistTriggerTool,
                  config: aiAssistConfig,
                },
              }
            : {}),
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
      window.clearTimeout(changeTimer);
      const current = instance;
      if (!current) {
        return;
      }
      void current.isReady
        .then(() => current.destroy())
        .catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holderId]);

  return <div id={holderId} className="editor-holder editor-holder--workspace notion-editor" />;
}
