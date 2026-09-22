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
import Table from "@editorjs/table";
import DragDrop from "editorjs-drag-drop";
import type { EditorJsDocument } from "@myblog/shared";
import { AiAssistTriggerTool, type AiAssistTriggerConfig } from "@/components/editor/AiAssistTriggerTool";
import { CodeTool } from "@/components/editor/CodeTool";
import { PageLinkTool, type PageLinkToolConfig } from "@/components/editor/PageLinkTool";
import { QuoteTool } from "@/components/editor/QuoteTool";
import { api } from "@/lib/api";

/** H1/H2/H3 用字号区分，避免三个标题共用一个图标 */
const headingIcon = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><text x="12" y="16.5" text-anchor="middle" font-size="${label === "H1" ? 13 : label === "H2" ? 12 : 11}" font-weight="800" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor">${label}</text></svg>`;

const EDITOR_I18N = {
  messages: {
    ui: {
      blockTunes: {
        toggler: {
          "Click to tune": "点击调整",
          "or drag to move": "或拖拽移动",
        },
      },
      inlineToolbar: {
        converter: {
          "Convert to": "转换为",
        },
      },
      toolbar: {
        toolbox: {
          Add: "添加",
        },
      },
      popover: {
        Filter: "筛选块…",
        "Nothing found": "没有找到",
        "Convert to": "转换为",
      },
    },
    toolNames: {
      Text: "正文",
      Heading: "标题",
      "Heading 1": "一级标题",
      "Heading 2": "二级标题",
      "Heading 3": "三级标题",
      List: "列表",
      "Unordered List": "无序列表",
      "Ordered List": "有序列表",
      Checklist: "待办",
      Quote: "引用",
      Code: "代码块 · code",
      Table: "表格 · table",
      Delimiter: "分隔线",
      Embed: "嵌入媒体 · embed",
      Image: "图片 · image",
      Link: "链接",
      Marker: "高亮",
      Bold: "粗体",
      Italic: "斜体",
      InlineCode: "行内代码",
      Unlink: "取消链接",
    },
    tools: {
      header: {
        "Heading 1": "一级标题",
        "Heading 2": "二级标题",
        "Heading 3": "三级标题",
      },
      list: {
        Ordered: "有序列表",
        Unordered: "无序列表",
        Checklist: "待办",
        "Unordered List": "无序列表",
        "Ordered List": "有序列表",
        "Start with": "起始编号",
        "Counter type": "编号样式",
      },
      table: {
        "Add column to left": "向左插入列",
        "Add column to right": "向右插入列",
        "Delete column": "删除列",
        "Add row above": "在上方插入行",
        "Add row below": "在下方插入行",
        "Delete row": "删除行",
        "With headings": "带表头",
        "Without headings": "不带表头",
        Stretch: "拉满宽度",
        Collapse: "收起宽度",
        Heading: "表头",
      },
      link: {
        "Add a link": "添加链接",
      },
      stub: {
        "The block can not be displayed correctly.": "该内容块无法正确显示。",
      },
    },
    blockTunes: {
      delete: {
        Delete: "删除",
        "Click to delete": "点击删除",
      },
      moveUp: {
        "Move up": "上移",
      },
      moveDown: {
        "Move down": "下移",
      },
    },
  },
} as const;

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
    let alive = true;
    const disconnectObservers: Array<() => void> = [];

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
          ? "写标题后回车继续。输入 / 可搜「标题、待办、表格、子页面、写作助手」…"
          : pageLink?.createChild
            ? "写标题后回车继续。输入 / 可搜「标题、待办、表格、子页面」…"
            : aiAssist
              ? "写标题后回车继续。输入 / 可搜「标题、待办、表格、写作助手」…"
              : "写标题后回车继续。左侧 + 或输入 / 添加块。";

      instance = new EditorJS({
        holder: holderId,
        autofocus: true,
        // Enter 后仍用段落写正文；空文档的首块由 initial/starterArticleDocument 提供 header
        defaultBlock: "paragraph",
        placeholder: slashHint,
        minHeight: 200,
        inlineToolbar: true,
        i18n: EDITOR_I18N,
        data: initial?.blocks?.length ? (initial as OutputData) : undefined,
        onChange: () => {
          if (!alive || !onChangeRef.current || !instance) {
            return;
          }
          window.clearTimeout(changeTimer);
          changeTimer = window.setTimeout(() => {
            if (!alive || !instance) {
              return;
            }
            void instance
              .save()
              .then((data) => {
                if (!alive) {
                  return;
                }
                onChangeRef.current?.(data as EditorJsDocument);
              })
              .catch(() => undefined);
          }, 320);
        },
        tools: {
          // 顺序即 / 菜单顺序：页面与 AI → 文字 → 列表 → 媒体
          ...(pageLinkConfig
            ? {
                pageLink: {
                  class: PageLinkTool,
                  config: pageLinkConfig,
                },
              }
            : {}),
          ...(aiAssistConfig
            ? {
                aiAssist: {
                  class: AiAssistTriggerTool,
                  config: aiAssistConfig,
                },
              }
            : {}),
          header: {
            class: Header,
            inlineToolbar: true,
            config: { levels: [1, 2, 3], defaultLevel: 1 },
            toolbox: [
              { title: "一级标题 · H1", icon: headingIcon("H1"), data: { level: 1 } },
              { title: "二级标题 · H2", icon: headingIcon("H2"), data: { level: 2 } },
              { title: "三级标题 · H3", icon: headingIcon("H3"), data: { level: 3 } },
            ],
          },
          quote: {
            class: QuoteTool,
            inlineToolbar: true,
            config: {
              quotePlaceholder: "引用内容，Enter 结束 · Shift+Enter 换行",
            },
          },
          list: {
            class: List,
            inlineToolbar: true,
            toolbox: [
              { title: "无序列表 · ul", data: { style: "unordered" } },
              { title: "有序列表 · ol", data: { style: "ordered" } },
              { title: "待办 · todo", data: { style: "checklist" } },
            ],
          },
          table: {
            class: Table,
            inlineToolbar: true,
            config: {
              rows: 3,
              cols: 3,
              maxrows: 40,
              maxcols: 12,
              withHeadings: true,
            },
          },
          code: {
            class: CodeTool,
          },
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
              },
            },
          },
          embed: {
            class: Embed,
          },
          delimiter: {
            class: Delimiter,
          },
        },
        onReady: () => {
          if (!instance) {
            return;
          }
          new DragDrop(instance, "2px dashed #d98c3b");

          // 标题块工具栏：只用 transform 微调，避免反复改 top 引发整页重排
          const clearToolbarNudge = (toolbar?: HTMLElement | null) => {
            toolbar?.style.setProperty("--ce-toolbar-nudge", "0px");
          };

          const realignToolbar = () => {
            const holder = document.getElementById(holderId);
            const toolbar = holder?.querySelector<HTMLElement>(".ce-toolbar--opened");
            if (!toolbar) {
              return;
            }
            const block =
              holder?.querySelector<HTMLElement>(".ce-block--focused") ??
              holder?.querySelector<HTMLElement>(".ce-block--selected");
            const header = block?.querySelector<HTMLElement>("h1.ce-header, h2.ce-header, h3.ce-header");
            if (!block || !header) {
              clearToolbarNudge(toolbar);
              return;
            }
            const btn =
              toolbar.querySelector<HTMLElement>(".ce-toolbar__plus") ??
              toolbar.querySelector<HTMLElement>(".ce-toolbar__settings-btn");
            const btnH = btn?.offsetHeight ?? 26;
            const styles = window.getComputedStyle(header);
            const lineHeight = parseFloat(styles.lineHeight) || header.getBoundingClientRect().height;
            const headerOffset = header.getBoundingClientRect().top - block.getBoundingClientRect().top;
            const idealTop = Math.floor(block.offsetTop + headerOffset + lineHeight / 2 - btnH / 2);
            const baseTop = parseInt(toolbar.style.top || "0", 10) || 0;
            const nudge = idealTop - baseTop;
            const prev = parseFloat(toolbar.style.getPropertyValue("--ce-toolbar-nudge") || "0");
            if (Math.abs(prev - nudge) > 0.5) {
              toolbar.style.setProperty("--ce-toolbar-nudge", `${nudge}px`);
            }
          };

          const scheduleRealign = () => {
            requestAnimationFrame(() => {
              instance?.toolbar.open();
              realignToolbar();
            });
          };

          instance.on("block-changed", () => {
            scheduleRealign();
          });

          const holderEl = document.getElementById(holderId);
          const toolbarEl = holderEl?.querySelector<HTMLElement>(".ce-toolbar");
          const redactorEl = holderEl?.querySelector(".codex-editor__redactor");

          // 只在 Editor.js 改 top / 开关状态时跟一次；不监听我们自己的 CSS 变量写入
          if (toolbarEl) {
            let lastTop = toolbarEl.style.top;
            let lastOpened = toolbarEl.classList.contains("ce-toolbar--opened");
            const toolbarObserver = new MutationObserver(() => {
              const opened = toolbarEl.classList.contains("ce-toolbar--opened");
              const top = toolbarEl.style.top;
              if (top === lastTop && opened === lastOpened) {
                return;
              }
              lastTop = top;
              lastOpened = opened;
              if (!opened) {
                clearToolbarNudge(toolbarEl);
                return;
              }
              realignToolbar();
            });
            toolbarObserver.observe(toolbarEl, { attributes: true, attributeFilter: ["style", "class"] });
            disconnectObservers.push(() => toolbarObserver.disconnect());
          }

          // 标题换级后尺寸变化：ResizeObserver 比反复 rAF 更稳，且不强迫整页重排
          const headerResizeObserver = new ResizeObserver(() => {
            realignToolbar();
          });
          let watchedHeader: HTMLElement | null = null;
          const watchFocusedHeader = () => {
            const holder = document.getElementById(holderId);
            const block =
              holder?.querySelector<HTMLElement>(".ce-block--focused") ??
              holder?.querySelector<HTMLElement>(".ce-block--selected");
            const header =
              block?.querySelector<HTMLElement>("h1.ce-header, h2.ce-header, h3.ce-header") ?? null;
            if (header === watchedHeader) {
              return;
            }
            if (watchedHeader) {
              headerResizeObserver.unobserve(watchedHeader);
            }
            watchedHeader = header;
            if (header) {
              headerResizeObserver.observe(header);
            }
            realignToolbar();
          };
          disconnectObservers.push(() => {
            headerResizeObserver.disconnect();
            watchedHeader = null;
          });

          if (redactorEl) {
            const headerDomObserver = new MutationObserver((mutations) => {
              const headerSwapped = mutations.some((mutation) => {
                if (mutation.type !== "childList") {
                  return false;
                }
                const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
                return nodes.some(
                  (node) => node instanceof HTMLElement && node.classList.contains("ce-header"),
                );
              });
              if (headerSwapped) {
                watchFocusedHeader();
                scheduleRealign();
              }
            });
            headerDomObserver.observe(redactorEl, { childList: true, subtree: true });
            disconnectObservers.push(() => headerDomObserver.disconnect());
          }

          holderEl?.addEventListener(
            "click",
            () => {
              requestAnimationFrame(watchFocusedHeader);
            },
            true,
          );

          // Cmd/Ctrl+A：一次选中整篇可编辑内容，便于全文复制（绕开 Editor.js 需连按两次的行为）
          const onSelectAll = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "a") {
              return;
            }
            if (event.isComposing || event.keyCode === 229) {
              return;
            }
            const redactor = holderEl?.querySelector<HTMLElement>(".codex-editor__redactor");
            if (!redactor || !holderEl?.contains(event.target as Node)) {
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
          holderEl?.addEventListener("keydown", onSelectAll, true);
          disconnectObservers.push(() => holderEl?.removeEventListener("keydown", onSelectAll, true));

          onReadyRef.current?.(instance);
        },
      });
    }, 0);

    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(changeTimer);
      disconnectObservers.forEach((disconnect) => disconnect());
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
