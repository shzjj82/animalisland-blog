import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloseSmall, DownC, More, Plus, Redo, Robot, Undo } from "@icon-park/react";
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
import { useIsMobile } from "@/lib/useMediaQuery";
import { useVisualViewport } from "@/lib/useKeyboardInset";
import { PageLinkTool, type PageLinkData } from "./tools/PageLinkTool";
import { AttachmentTool } from "./tools/AttachmentTool";
import { ImageBlockTool, imageBlockData } from "./tools/ImageBlockTool";
import { TodoBlockTool } from "./tools/TodoBlockTool";
import { VideoBlockTool } from "./tools/VideoBlockTool";
import type { AttachmentData } from "@/store/fileStore";
import { htmlToBlocks } from "@/lib/document/htmlToBlocks";
import { isImageFile } from "@/lib/document/fileKinds";
import { bindEditingGuards } from "./editingGuards";
import { menuIcons } from "./menuIcons";
import { bindToolbarAnchor, blockIconKey } from "./toolbarAnchor";
import { revealText } from "./revealText";
import { useDocHistory } from "./useDocHistory";
import { cn } from "@/lib/utils";
import "./blockEditor.css";

/** 撤销 / 重做的对外接口：顶栏按钮和快捷键都在 App 里，靠它调到编辑器内部的历史栈 */
export type EditorHistoryApi = {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const inlineTools = ["link", "bold", "italic", "askAi"];

/** 底栏样式按钮的 aria-label 只能取这几个键（写成联合类型，动态取词才不会绕过 i18n 的类型校验） */
type BlockStyleLabel =
  | "blockEditor.styleText"
  | "blockEditor.styleH1"
  | "blockEditor.styleH2"
  | "blockEditor.styleH3"
  | "blockEditor.styleBullet"
  | "blockEditor.styleNumbered"
  | "blockEditor.styleTodo"
  | "blockEditor.styleQuote";

/** 移动端底栏直接摆出来的块样式：点图标即切换，不再弹菜单。key 与 blockIconKey 的返回值一致 */
const blockStyles: { key: string; icon: string; label: BlockStyleLabel; tool: string; data?: Record<string, unknown> }[] = [
  { key: "T", icon: menuIcons.text, label: "blockEditor.styleText", tool: "paragraph" },
  { key: "H1", icon: menuIcons.h1, label: "blockEditor.styleH1", tool: "header", data: { level: 1 } },
  { key: "H2", icon: menuIcons.h2, label: "blockEditor.styleH2", tool: "header", data: { level: 2 } },
  { key: "H3", icon: menuIcons.h3, label: "blockEditor.styleH3", tool: "header", data: { level: 3 } },
  { key: "ul", icon: menuIcons.ul, label: "blockEditor.styleBullet", tool: "list", data: { style: "unordered" } },
  { key: "ol", icon: menuIcons.ol, label: "blockEditor.styleNumbered", tool: "list", data: { style: "ordered" } },
  { key: "todo", icon: menuIcons.todo, label: "blockEditor.styleTodo", tool: "todo" },
  { key: "quote", icon: menuIcons.quote, label: "blockEditor.styleQuote", tool: "quote" },
];

function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files = Array.from(data.files).filter(isImageFile);
  if (files.length > 0) {
    return files;
  }
  const fromItems: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") {
      continue;
    }
    const file = item.getAsFile();
    if (file && isImageFile(file)) {
      fromItems.push(file);
    }
  }
  return fromItems;
}

async function insertPastedImages(
  editor: EditorJS,
  files: File[],
  upload: (file: File) => Promise<AttachmentData>,
  isAlive: () => boolean,
) {
  const current = editor.blocks.getCurrentBlockIndex();
  const block = current >= 0 ? editor.blocks.getBlockByIndex(current) : undefined;
  const replace = Boolean(block?.isEmpty) && block?.name !== "header" && block?.name !== "table";
  let index = current < 0 ? editor.blocks.getBlocksCount() : replace ? current : current + 1;
  let replaceNext = replace;
  for (const file of files) {
    if (!isAlive()) {
      return;
    }
    const uploaded = await upload(file);
    if (!isAlive()) {
      return;
    }
    editor.blocks.insert("image", imageBlockData(uploaded), {}, index, false, replaceNext);
    replaceNext = false;
    index += 1;
  }
}

type Props = {
  doc: EditorJsDocument;
  onChange: (document: EditorJsDocument) => void;
  onOpenPage?: (pageId: string) => void;
  onCreateChild?: () => Promise<PageLinkData>;
  resolvePageTitle?: (pageId: string) => string | undefined;
  onReady?: (editor: EditorJS | null) => void;
  onAi?: (blockIndex: number) => void;
  onAskSelection?: (text: string) => void;
  onUploadFile?: (file: File) => Promise<AttachmentData>;
  onUploadError?: (message: string) => void;
  onOpenFile?: (data: AttachmentData, replace: (next: AttachmentData) => void) => void;
  onConfirmDeleteFile?: (name: string) => Promise<boolean>;
  /** 打开后定位到这段文字；nonce 变化时重新定位，同一页也能再次触发 */
  reveal?: { text: string; nonce: number } | null;
  readOnly?: boolean;
  /** 非移动端的撤销 / 重做按钮在顶栏，通过这个回调拿到编辑器里的历史栈 */
  onHistory?: (api: EditorHistoryApi | null) => void;
  /** 移动端底栏挂载点（父级布局流里的一个空容器）；不传则不渲染底栏 */
  barSlot?: HTMLElement | null;
};

export function BlockEditor({ doc, onChange, onOpenPage, onCreateChild, resolvePageTitle, onReady, onAi, onAskSelection, onUploadFile, onUploadError, onOpenFile, onConfirmDeleteFile, reveal, readOnly = false, onHistory, barSlot }: Props) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const viewport = useVisualViewport();
  const { keyboardOpen } = viewport;
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  /** 当前块的样式（用于底栏高亮），取值与 blockIconKey 一致 */
  const [blockKind, setBlockKind] = useState("T");
  const editorInstanceRef = useRef<EditorJS | null>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  /** 正在做块样式转换：这期间焦点丢失是正常现象，不算离开编辑器 */
  const switchingRef = useRef(false);
  const revealRef = useRef(reveal);
  revealRef.current = reveal;
  const onChangeRef = useRef(onChange);
  const onOpenRef = useRef(onOpenPage);
  const onCreateRef = useRef(onCreateChild);
  const resolveTitleRef = useRef(resolvePageTitle);
  const onReadyRef = useRef(onReady);
  const onAiRef = useRef(onAi);
  const onAskRef = useRef(onAskSelection);
  onChangeRef.current = onChange;
  onOpenRef.current = onOpenPage;
  onCreateRef.current = onCreateChild;
  resolveTitleRef.current = resolvePageTitle;
  onReadyRef.current = onReady;
  onAiRef.current = onAi;
  onAskRef.current = onAskSelection;
  const onUploadRef = useRef(onUploadFile);
  const onUploadErrorRef = useRef(onUploadError);
  const onOpenFileRef = useRef(onOpenFile);
  onUploadRef.current = onUploadFile;
  onUploadErrorRef.current = onUploadError;
  onOpenFileRef.current = onOpenFile;
  const onConfirmDeleteRef = useRef(onConfirmDeleteFile);
  onConfirmDeleteRef.current = onConfirmDeleteFile;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const initialRef = useRef(doc);
  const history = useDocHistory();
  /** 撤销 / 重做期间由我们自己渲染，别把这一次变更又记进历史栈 */
  const applyingRef = useRef(false);
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;
  const undoRef = useRef<() => void>(() => {});
  const redoRef = useRef<() => void>(() => {});
  /** 刚删掉块时给的撤销提示：误删之后底栏可能已经收起，得有个不用找按钮的入口 */
  const [removedToast, setRemovedToast] = useState<{ count: number } | null>(null);
  const blockCountRef = useRef(doc.blocks?.length ?? 0);
  const toastTimerRef = useRef(0);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) {
      return;
    }
    let alive = true;
    const editor = new EditorJS({
      holder,
      data: initialRef.current,
      readOnly,
      // 移动端不自动聚焦：一进页面 Editor.js 就把光标塞进正文，focus 立刻为真，
      // 底栏（以及 iOS 上跟着起来的键盘）会在用户还没操作时就出现在底部
      autofocus: !readOnly && !isMobile,
      minHeight: 40,
      placeholder: t("blockEditor.placeholder"),
      i18n: editorI18n(),
      tools: {
        paragraph: {
          toolbox: { icon: menuIcons.text },
        },
        header: {
          class: Header,
          inlineToolbar: inlineTools,
          config: { placeholder: t("blockEditor.heading"), levels: [1, 2, 3], defaultLevel: 1 },
          toolbox: [
            { title: "Heading 1", icon: menuIcons.h1, data: { level: 1 } },
            { title: "Heading 2", icon: menuIcons.h2, data: { level: 2 } },
            { title: "Heading 3", icon: menuIcons.h3, data: { level: 3 } },
          ],
        },
        list: {
          class: List,
          inlineToolbar: inlineTools,
          toolbox: [
            { title: "Unordered List", icon: menuIcons.ul, data: { style: "unordered" } },
            { title: "Ordered List", icon: menuIcons.ol, data: { style: "ordered" } },
          ],
        },
        todo: {
          class: TodoBlockTool as unknown as typeof Header,
        },
        quote: {
          class: Quote,
          inlineToolbar: inlineTools,
          config: { quotePlaceholder: t("blockEditor.quote"), captionPlaceholder: t("blockEditor.caption") },
          toolbox: { icon: menuIcons.quote },
        },
        delimiter: {
          class: Delimiter,
          toolbox: { icon: menuIcons.line },
        },
        table: {
          class: Table as unknown as typeof Header,
          inlineToolbar: inlineTools,
          toolbox: { icon: menuIcons.table },
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
            resolveTitle: (pageId: string) => resolveTitleRef.current?.(pageId),
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
          config: {
            upload: (file: File) => {
              const upload = onUploadRef.current;
              return upload ? upload(file) : Promise.reject(new Error(t("attachment.uploadFailed")));
            },
          },
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
        editorInstanceRef.current = editor;
        // 打开时的内容就是历史起点：撤销不会撤到上一页去
        history.reset(initialRef.current);
        blockCountRef.current = editor.blocks.getBlocksCount();
        setReady(true);
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
        if (!alive) {
          return;
        }
        onChangeRef.current(saved);
        // 撤销 / 重做是我们自己 render 回去的，不能又记一笔
        if (!applyingRef.current) {
          history.commit(saved);
          const before = blockCountRef.current;
          const after = saved.blocks.length;
          blockCountRef.current = after;
          // 块变少了就是删除：弹一条「撤销」，底栏收起来也还能救回来
          if (after < before) {
            setRemovedToast({ count: before - after });
            window.clearTimeout(toastTimerRef.current);
            toastTimerRef.current = window.setTimeout(() => setRemovedToast(null), 6000);
          }
        }
      },
    });

    const unbindGuards = bindEditingGuards(holder, editor);
    const unbindToolbar = bindToolbarAnchor(holder);

    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      const target = event.target instanceof Element ? event.target : null;
      if (!data || data.types.includes("application/x-editor-js")) {
        return;
      }
      const images = imageFilesFromClipboard(data);
      if (images.length > 0) {
        if (readOnlyRef.current || target?.closest(".tc-table, input, textarea")) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const upload = onUploadRef.current;
        if (!upload) {
          return;
        }
        void insertPastedImages(editor, images, upload, () => alive).catch((error: unknown) => {
          onUploadErrorRef.current?.(error instanceof Error ? error.message : t("attachment.uploadFailed"));
        });
        return;
      }
      if (data.files.length > 0) {
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
      unbindGuards();
      unbindToolbar();
      holder.removeEventListener("paste", onPaste, true);
      window.clearTimeout(toastTimerRef.current);
      onReadyRef.current?.(null);
      onHistoryRef.current?.(null);
      editorInstanceRef.current = null;
      setReady(false);
      destroy();
    };
  }, []);

  /**
   * 兜底：键盘已经弹起、焦点也确实在编辑器里，但 focusin 没被捕获到时，
   * 底栏不该缺席（用户预期“键盘一弹就在键盘上方出现”）。
   */
  useEffect(() => {
    if (!keyboardOpen) {
      return;
    }
    const active = document.activeElement;
    if (active && holderRef.current?.contains(active)) {
      setEditing(true);
    }
  }, [keyboardOpen]);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !readyRef.current || !reveal?.text) {
      return;
    }
    const timer = window.setTimeout(() => revealText(holder, reveal.text), 60);
    return () => window.clearTimeout(timer);
  }, [reveal?.nonce, reveal?.text]);

  /** 底部工具栏按钮：阻止默认行为抢焦点，保证编辑器光标不丢（pointerdown / mousedown 都兜住） */
  function keepEditorFocus(event: { preventDefault: () => void }) {
    event.preventDefault();
  }

  /** 把光标放回当前块。setToBlock 会同步更新 currentBlock，块菜单才知道对谁生效 */
  function focusCurrentBlock(): boolean {
    const editor = editorInstanceRef.current;
    if (!editor) {
      return false;
    }
    try {
      const current = editor.blocks.getCurrentBlockIndex();
      const target = current >= 0 ? current : editor.blocks.getBlocksCount() - 1;
      if (target < 0) {
        return false;
      }
      editor.caret.setToBlock(target, "end");
      return true;
    } catch {
      return false;
    }
  }

  /** 「+」：插入块。走 Editor.js 官方 API，比点 DOM 更稳（内部会先 moveAndOpen 定位工具栏） */
  function openBlockMenu() {
    const editor = editorInstanceRef.current;
    if (!editor || !focusCurrentBlock()) {
      return;
    }
    editor.toolbar.toggleToolbox(true);
  }

  /** 读当前块的样式，用于底栏高亮 */
  function refreshBlockKind() {
    const editor = editorInstanceRef.current;
    if (!editor) {
      return;
    }
    try {
      const index = editor.blocks.getCurrentBlockIndex();
      const block = index >= 0 ? editor.blocks.getBlockByIndex(index) : undefined;
      setBlockKind(block ? blockIconKey(block.holder) : "T");
    } catch {
      setBlockKind("T");
    }
  }

  /** 底栏样式图标：直接把当前块转成目标类型（走官方 convert，文本由 conversionConfig 带过去） */
  function applyBlockStyle(tool: string, data?: Record<string, unknown>) {
    const editor = editorInstanceRef.current;
    if (!editor) {
      return;
    }
    try {
      const index = editor.blocks.getCurrentBlockIndex();
      const block = index >= 0 ? editor.blocks.getBlockByIndex(index) : undefined;
      if (!block) {
        return;
      }
      // 换块时旧块的 DOM 会被拿掉，焦点一定会短暂丢失；这段时间别让底栏以为用户收起了键盘
      switchingRef.current = true;
      void editor.blocks
        .convert(block.id, tool, data)
        .then((next) => {
          try {
            editor.caret.setToBlock(next.id, "end");
          } catch {
            /* 转换后光标放不回去就算了 */
          }
          switchingRef.current = false;
          setEditing(true);
          refreshBlockKind();
        })
        .catch(() => {
          switchingRef.current = false;
          setEditing(true);
        });
    } catch {
      switchingRef.current = false;
      /* 该类型不支持相互转换：保持原样 */
    }
  }

  /** ⋯：块操作（删除 / 上移 / 下移）。移动端行首的 ⋮ 已经隐藏，入口挪到底栏 */
  function openBlockSettings() {
    const editor = editorInstanceRef.current;
    if (!editor || !focusCurrentBlock()) {
      return;
    }
    editor.toolbar.toggleBlockSettings(true);
  }

  /** 把历史里的整份文档渲染回去（撤销 / 重做共用） */
  function applyHistory(body: EditorJsDocument | null) {
    const editor = editorInstanceRef.current;
    const holder = holderRef.current;
    if (!editor || !body) {
      return;
    }
    const hadFocus = Boolean(holder && document.activeElement && holder.contains(document.activeElement));
    let at = -1;
    try {
      at = editor.blocks.getCurrentBlockIndex();
    } catch {
      at = -1;
    }
    applyingRef.current = true;
    void editor.isReady
      .then(() => editor.render(body))
      .catch(() => undefined)
      .then(() => {
        applyingRef.current = false;
        // render 是程序化写入，Editor.js 不一定触发 onChange，这里主动通知外层落盘
        onChangeRef.current(body);
        blockCountRef.current = body.blocks.length;
        if (hadFocus) {
          // 尽量回到撤销前所在的那一块，超出范围就落到最后一块
          try {
            const last = editor.blocks.getBlocksCount() - 1;
            if (last >= 0) {
              editor.caret.setToBlock(Math.min(Math.max(at, 0), last), "end");
            }
          } catch {
            /* 光标放不回去就算了 */
          }
        }
        refreshBlockKind();
      });
  }

  function handleUndo() {
    if (readOnlyRef.current) {
      return;
    }
    applyHistory(history.undo());
  }

  function handleRedo() {
    if (readOnlyRef.current) {
      return;
    }
    applyHistory(history.redo());
  }
  undoRef.current = handleUndo;
  redoRef.current = handleRedo;

  /** 顶栏按钮要知道现在能不能撤 / 能不能重做 */
  useEffect(() => {
    onHistoryRef.current?.({
      undo: () => undoRef.current(),
      redo: () => redoRef.current(),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
    });
  }, [history.canUndo, history.canRedo]);

  /** 呼出 AI */
  function openAi() {
    const editor = editorInstanceRef.current;
    if (!editor) {
      return;
    }
    let index = 0;
    try {
      index = Math.max(0, editor.blocks.getCurrentBlockIndex());
    } catch {
      index = 0;
    }
    onAiRef.current?.(index);
  }

  /** 收起软键盘 */
  function dismissKeyboard() {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }

  /* 光标在块之间移动时刷新底栏的样式高亮 */
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !ready) {
      return;
    }
    const refresh = () => refreshBlockKind();
    holder.addEventListener("keyup", refresh);
    holder.addEventListener("mouseup", refresh);
    return () => {
      holder.removeEventListener("keyup", refresh);
      holder.removeEventListener("mouseup", refresh);
    };
    // refreshBlockKind 只读 ref + setState，不需要进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /* 放在所有 useState 之后：压缩后如果提前引用会命中 TDZ（Cannot access before initialization） */
  const showBar = isMobile && ready && !readOnly && editing;
  const barIconProps = { theme: "outline" as const, strokeWidth: 3, size: 20 };
  const barButtonClass =
    "flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-foreground/70 transition-colors active:bg-muted active:text-foreground";
  /* 提示条贴着可视视口底部；键盘开着时让出底栏的高度 */
  const toastBottom = viewport.top + viewport.height - (keyboardOpen ? 56 : 16);

  return (
    <>
      <div
        className="notion-editor mx-auto max-w-3xl pt-4 px-4 pb-6 sm:pt-6 sm:pr-6 sm:pb-20 sm:pl-20"
        /* 横屏刘海：正文左右也避开非安全区（竖屏 env() 为 0，等价 px-4） */
        style={
          isMobile
            ? {
                paddingLeft: "max(1rem, env(safe-area-inset-left))",
                paddingRight: "max(1rem, env(safe-area-inset-right))",
              }
            : undefined
        }
        onFocusCapture={() => setEditing(true)}
        onBlurCapture={(event) => {
          const next = event.relatedTarget as Node | null;
          // 换块过程中焦点必然短暂丢失，此时不能把底栏收起来（否则键盘会跟着掉）
          if (switchingRef.current) {
            return;
          }
          // 焦点落到底部工具栏（部分浏览器 pointerdown 兜不住）时不算离开编辑器
          if (!next || (!event.currentTarget.contains(next) && !barRef.current?.contains(next))) {
            setEditing(false);
          }
        }}
        ref={holderRef}
      />
      {removedToast && !readOnly
        ? createPortal(
            <div
              className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3"
              style={{ top: toastBottom, transform: "translateY(-100%)" }}
            >
              <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-foreground px-3.5 py-2 text-background shadow-lg">
                <span className="text-sm">{t("app.blockDeleted", { count: removedToast.count })}</span>
                <button
                  type="button"
                  className="text-sm font-medium underline underline-offset-2"
                  onClick={() => {
                    setRemovedToast(null);
                    window.clearTimeout(toastTimerRef.current);
                    handleUndo();
                  }}
                >
                  {t("app.undo")}
                </button>
                <button
                  type="button"
                  aria-label={t("common.cancel")}
                  className="text-background/60"
                  onClick={() => {
                    setRemovedToast(null);
                    window.clearTimeout(toastTimerRef.current);
                  }}
                >
                  <CloseSmall theme="outline" strokeWidth={3} size={16} />
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
      {showBar && barSlot
        ? createPortal(
            <div
              ref={barRef}
              /* 不再是 fixed：占据父级布局流的一行，内容怎么滚它都不动 */
              className="flex items-center gap-1 border-t border-border bg-background pt-1"
              style={{
                // 键盘弹起时去掉底部安全距离，贴住键盘上沿
                paddingBottom: keyboardOpen ? "0.375rem" : "max(0.375rem, env(safe-area-inset-bottom))",
                paddingLeft: "max(0.5rem, env(safe-area-inset-left))",
                paddingRight: "max(0.5rem, env(safe-area-inset-right))",
                // 只允许横向手势（样式条要滑）。竖向划动若交给浏览器，
                // iOS 会去“拖动整页”（平移可视视口），外壳跟着 offsetTop 走就是整屏抖动
                touchAction: "pan-x",
              }}
            >
              {/* 撤销 / 重做：误删一个块按一下就能回来 */}
              <button
                type="button"
                aria-label={t("app.undo")}
                disabled={!history.canUndo}
                className={cn(barButtonClass, !history.canUndo && "opacity-40")}
                onPointerDown={keepEditorFocus}
                onMouseDown={keepEditorFocus}
                onClick={handleUndo}
              >
                <Undo {...barIconProps} />
              </button>
              <button
                type="button"
                aria-label={t("app.redo")}
                disabled={!history.canRedo}
                className={cn(barButtonClass, !history.canRedo && "opacity-40")}
                onPointerDown={keepEditorFocus}
                onMouseDown={keepEditorFocus}
                onClick={handleRedo}
              >
                <Redo {...barIconProps} />
              </button>
              {/* pointerdown / mousedown 都阻止默认行为，避免点按钮时编辑器失焦、光标丢失 */}
              <button type="button" aria-label={t("app.insertBlock")} className={barButtonClass} onPointerDown={keepEditorFocus} onMouseDown={keepEditorFocus} onClick={openBlockMenu}>
                <Plus {...barIconProps} />
              </button>
              {/* 字体/块样式直接铺在底栏上，点哪个就是哪种，不再弹菜单 */}
              <div className="editor-style-strip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
                {blockStyles.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-label={t(item.label)}
                    aria-pressed={blockKind === item.key}
                    className={cn(
                      "flex h-11 w-10 shrink-0 items-center justify-center rounded-lg transition-colors",
                      blockKind === item.key ? "bg-muted text-foreground" : "text-foreground/70 active:bg-muted",
                    )}
                    onPointerDown={keepEditorFocus}
                    onMouseDown={keepEditorFocus}
                    onClick={() => applyBlockStyle(item.tool, item.data)}
                  >
                    <span
                      className="pointer-events-none flex h-[18px] w-[18px] items-center justify-center"
                      dangerouslySetInnerHTML={{ __html: item.icon }}
                    />
                  </button>
                ))}
              </div>
              <button type="button" aria-label={t("app.aiChatTitle")} className={barButtonClass} onPointerDown={keepEditorFocus} onMouseDown={keepEditorFocus} onClick={openAi}>
                <Robot {...barIconProps} />
              </button>
              <button type="button" aria-label={t("app.blockActions")} className={barButtonClass} onPointerDown={keepEditorFocus} onMouseDown={keepEditorFocus} onClick={openBlockSettings}>
                <More {...barIconProps} />
              </button>
              <button type="button" aria-label={t("app.hideKeyboard")} className={barButtonClass} onClick={dismissKeyboard}>
                <DownC {...barIconProps} />
              </button>
            </div>,
            barSlot,
          )
        : null}
    </>
  );
}
