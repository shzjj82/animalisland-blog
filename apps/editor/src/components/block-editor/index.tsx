import { useEffect, useRef } from "react";
import EditorJS from "@editorjs/editorjs";
import Delimiter from "@editorjs/delimiter";
import Header from "@editorjs/header";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";
import Table from "@editorjs/table";
import DragDrop from "editorjs-drag-drop";
import type { EditorJsDocument } from "@myblog/shared";
import { AiAssistTriggerTool } from "./tools/AiAssistTriggerTool";
import { AskAiInlineTool } from "./tools/AskAiInlineTool";
import { editorI18n } from "./editorI18n";
import { useTranslation } from "react-i18next";
import { PageLinkTool, type PageLinkData } from "./tools/PageLinkTool";
import { AttachmentTool } from "./tools/AttachmentTool";
import { ImageBlockTool } from "./tools/ImageBlockTool";
import { VideoBlockTool } from "./tools/VideoBlockTool";
import type { AttachmentData } from "@/store/fileStore";
import { htmlToBlocks } from "@/lib/document/htmlToBlocks";
import { revealText } from "./revealText";
import "./blockEditor.css";

const inlineTools = ["link", "bold", "italic", "askAi"];

const headingIcon = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="16.5" text-anchor="middle" font-size="${label === "H1" ? 13 : label === "H2" ? 12 : 11}" font-weight="800" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor">${label}</text></svg>`;

type Props = {
  doc: EditorJsDocument;
  onChange: (document: EditorJsDocument) => void;
  onOpenPage?: (pageId: string) => void;
  onCreateChild?: () => Promise<PageLinkData>;
  onReady?: (editor: EditorJS | null) => void;
  onAi?: (blockIndex: number) => void;
  onAskSelection?: (text: string) => void;
  onUploadFile?: (file: File) => Promise<AttachmentData>;
  onOpenFile?: (data: AttachmentData, replace: (next: AttachmentData) => void) => void;
  onConfirmDeleteFile?: (name: string) => Promise<boolean>;
  /** 打开后定位到这段文字；nonce 变化时重新定位，同一页也能再次触发 */
  reveal?: { text: string; nonce: number } | null;
};

export function BlockEditor({ doc, onChange, onOpenPage, onCreateChild, onReady, onAi, onAskSelection, onUploadFile, onOpenFile, onConfirmDeleteFile, reveal }: Props) {
  const { t } = useTranslation();
  const holderRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const onChangeRef = useRef(onChange);
  const onOpenRef = useRef(onOpenPage);
  const onCreateRef = useRef(onCreateChild);
  const onReadyRef = useRef(onReady);
  const onAiRef = useRef(onAi);
  const onAskRef = useRef(onAskSelection);
  onChangeRef.current = onChange;
  onOpenRef.current = onOpenPage;
  onCreateRef.current = onCreateChild;
  onReadyRef.current = onReady;
  onAiRef.current = onAi;
  onAskRef.current = onAskSelection;
  const onUploadRef = useRef(onUploadFile);
  const onOpenFileRef = useRef(onOpenFile);
  onUploadRef.current = onUploadFile;
  onOpenFileRef.current = onOpenFile;
  const onConfirmDeleteRef = useRef(onConfirmDeleteFile);
  onConfirmDeleteRef.current = onConfirmDeleteFile;
  const initialRef = useRef(doc);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) {
      return;
    }
    let alive = true;
    const editor = new EditorJS({
      holder,
      data: initialRef.current,
      autofocus: true,
      placeholder: t("blockEditor.placeholder"),
      i18n: editorI18n(),
      tools: {
        header: {
          class: Header,
          inlineToolbar: inlineTools,
          config: { placeholder: t("blockEditor.heading"), levels: [1, 2, 3], defaultLevel: 1 },
          toolbox: [
            { title: "Heading 1", icon: headingIcon("H1"), data: { level: 1 } },
            { title: "Heading 2", icon: headingIcon("H2"), data: { level: 2 } },
            { title: "Heading 3", icon: headingIcon("H3"), data: { level: 3 } },
          ],
        },
        list: {
          class: List,
          inlineToolbar: inlineTools,
          toolbox: [
            { title: "Unordered List", data: { style: "unordered" } },
            { title: "Ordered List", data: { style: "ordered" } },
            { title: "Checklist", data: { style: "checklist" } },
          ],
        },
        quote: {
          class: Quote,
          inlineToolbar: inlineTools,
          config: { quotePlaceholder: t("blockEditor.quote"), captionPlaceholder: t("blockEditor.caption") },
        },
        delimiter: Delimiter,
        table: {
          class: Table as unknown as typeof Header,
          inlineToolbar: inlineTools,
        },
        askAi: {
          class: AskAiInlineTool as unknown as typeof Header,
          config: {
            onAsk: (text: string) => onAskRef.current?.(text),
          },
        },
        pageLink: {
          class: PageLinkTool as unknown as typeof Header,
          config: {
            onOpen: (page: PageLinkData) => onOpenRef.current?.(page.pageId),
            createChild: () => {
              const create = onCreateRef.current;
              if (!create) {
                return Promise.reject(new Error("无法创建子页面"));
              }
              return create();
            },
          },
        },
        image: {
          class: ImageBlockTool as unknown as typeof Header,
        },
        video: {
          class: VideoBlockTool as unknown as typeof Header,
        },
        attachment: {
          class: AttachmentTool as unknown as typeof Header,
          config: {
            upload: (file: File) => {
              const upload = onUploadRef.current;
              return upload ? upload(file) : Promise.reject(new Error(t("attachment.uploadFailed")));
            },
            onOpen: (data: AttachmentData, replace: (next: AttachmentData) => void) => onOpenFileRef.current?.(data, replace),
            confirmDelete: (name: string) => onConfirmDeleteRef.current?.(name) ?? Promise.resolve(true),
          },
        },
        aiAssist: {
          class: AiAssistTriggerTool as unknown as typeof Header,
          config: {
            onInvoke: ({ blockIndex }: { blockIndex: number }) => onAiRef.current?.(blockIndex),
          },
        },
      },
      onReady() {
        new DragDrop(editor, "2px solid #191919");
        readyRef.current = true;
        onReadyRef.current?.(editor);
        const pending = revealRef.current;
        if (pending?.text) {
          window.setTimeout(() => revealText(holder, pending.text), 60);
        }
      },
      async onChange(api) {
        if (!alive) {
          return;
        }
        const saved = (await api.saver.save()) as EditorJsDocument;
        onChangeRef.current(saved);
      },
    });

    const onSelectAll = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") {
        return;
      }
      if (event.isComposing) {
        return;
      }
      const redactor = holder.querySelector<HTMLElement>(".codex-editor__redactor");
      if (!redactor || !holder.contains(event.target as Node)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(redactor);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    holder.addEventListener("keydown", onSelectAll, true);

    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      const target = event.target instanceof Element ? event.target : null;
      if (!data || data.types.includes("application/x-editor-js") || data.files.length > 0) {
        return;
      }
      if (!target?.closest(".ce-block") || target.closest(".tc-table, .cdx-quote__caption, input, textarea")) {
        return;
      }
      const html = data.getData("text/html");
      if (!html) {
        return;
      }
      const blocks = htmlToBlocks(html);
      if (blocks.length === 0 || (blocks.length === 1 && blocks[0].type === "paragraph")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const current = editor.blocks.getCurrentBlockIndex();
      const block = current >= 0 ? editor.blocks.getBlockByIndex(current) : undefined;
      const replace = Boolean(block?.isEmpty) && block?.name !== "table";
      const at = current < 0 ? editor.blocks.getBlocksCount() : replace ? current : current + 1;
      editor.blocks.insertMany(blocks, at);
      if (replace && block) {
        editor.blocks.delete(editor.blocks.getBlockIndex(block.id));
      }
      editor.caret.setToBlock(at + blocks.length - 1, "end");
    };
    holder.addEventListener("paste", onPaste, true);

    let destroyed = false;
    const destroy = () => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      void editor.isReady.then(() => editor.destroy()).catch(() => undefined);
    };

    return () => {
      alive = false;
      holder.removeEventListener("keydown", onSelectAll, true);
      holder.removeEventListener("paste", onPaste, true);
      onReadyRef.current?.(null);
      destroy();
    };
  }, []);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !readyRef.current || !reveal?.text) {
      return;
    }
    const timer = window.setTimeout(() => revealText(holder, reveal.text), 60);
    return () => window.clearTimeout(timer);
  }, [reveal?.nonce, reveal?.text]);

  return <div className="notion-editor mx-auto max-w-3xl px-6 pt-6 pb-20" ref={holderRef} />;
}
