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
import DragDrop from "editorjs-drag-drop";
import type { EditorJsDocument } from "@myblog/shared";
import { AiAssistTriggerTool, type AiAssistTriggerConfig } from "@/components/editor/AiAssistTriggerTool";
import { CodeTool } from "@/components/editor/CodeTool";
import { PageLinkTool, type PageLinkToolConfig } from "@/components/editor/PageLinkTool";
import { QuoteTool } from "@/components/editor/QuoteTool";
import { api } from "@/lib/api";

/** 菜单 / 工具名统一中文，避免中英混杂 */
const HEADER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M9 7L9 12M9 17V12M9 12L15 12M15 7V12M15 17L15 12"/></svg>';

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
        Filter: "筛选",
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
      Checklist: "选项卡",
      Quote: "引用",
      Code: "代码",
      Delimiter: "分隔线",
      Embed: "嵌入",
      Image: "图片",
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
        Checklist: "选项卡",
        "Unordered List": "无序列表",
        "Ordered List": "有序列表",
        "Start with": "起始编号",
        "Counter type": "编号样式",
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
          ? "写一个大标题，回车后继续正文。输入 / 可选「子页面」「写作助手」。"
          : pageLink?.createChild
            ? "写一个大标题，回车后继续正文。输入 / 选「子页面」可建子页。"
            : aiAssist
              ? "写一个大标题，回车后继续正文。输入 / 选「写作助手」在光标处生成。"
              : "写一个大标题，回车后继续正文。左侧 + 可加块。";

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
          }, 320);
        },
        tools: {
          header: {
            class: Header,
            inlineToolbar: true,
            config: { levels: [1, 2, 3], defaultLevel: 1 },
            // 菜单里分别展示三级标题（仍存为 type=header + level）
            toolbox: [
              { title: "一级标题", icon: HEADER_ICON, data: { level: 1 } },
              { title: "二级标题", icon: HEADER_ICON, data: { level: 2 } },
              { title: "三级标题", icon: HEADER_ICON, data: { level: 3 } },
            ],
          },
          list: {
            class: List,
            inlineToolbar: true,
            toolbox: [
              { title: "无序列表", data: { style: "unordered" } },
              { title: "有序列表", data: { style: "ordered" } },
              { title: "选项卡", data: { style: "checklist" } },
            ],
          },
          quote: {
            class: QuoteTool,
            inlineToolbar: true,
            config: {
              quotePlaceholder: "引用内容，Enter 结束 · Shift+Enter 换行",
            },
          },
          code: {
            class: CodeTool,
            toolbox: { title: "代码" },
          },
          delimiter: {
            class: Delimiter,
            toolbox: { title: "分隔线" },
          },
          embed: {
            class: Embed,
            toolbox: { title: "嵌入" },
          },
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
            toolbox: { title: "图片" },
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
        },
        onReady: () => {
          if (!instance) {
            return;
          }
          new DragDrop(instance, "2px dashed #d98c3b");

          // 切换标题级别后字号/行高变了，强制重算左侧 + / 拖拽钮垂直位置
          const realignToolbar = () => {
            const holder = document.getElementById(holderId);
            const toolbar = holder?.querySelector<HTMLElement>(".ce-toolbar--opened");
            const block =
              holder?.querySelector<HTMLElement>(".ce-block--focused") ??
              holder?.querySelector<HTMLElement>(".ce-block--selected");
            const header = block?.querySelector<HTMLElement>("h1.ce-header, h2.ce-header, h3.ce-header");
            if (!toolbar || !block || !header) {
              return;
            }
            const btn =
              toolbar.querySelector<HTMLElement>(".ce-toolbar__plus") ??
              toolbar.querySelector<HTMLElement>(".ce-toolbar__settings-btn");
            const btnH = btn?.offsetHeight ?? 26;
            const styles = window.getComputedStyle(header);
            const lineHeight = parseFloat(styles.lineHeight) || header.getBoundingClientRect().height;
            const headerOffset = header.getBoundingClientRect().top - block.getBoundingClientRect().top;
            const nextTop = Math.floor(block.offsetTop + headerOffset + lineHeight / 2 - btnH / 2);
            if (Math.abs(parseInt(toolbar.style.top || "0", 10) - nextTop) > 1) {
              toolbar.style.top = `${nextTop}px`;
            }
          };

          /** H1→H2 等换标签后，等布局落地再对齐（单次 rAF 经常还是旧高度） */
          const scheduleRealign = () => {
            const run = () => {
              instance?.toolbar.open();
              realignToolbar();
            };
            run();
            requestAnimationFrame(() => {
              run();
              requestAnimationFrame(run);
            });
          };

          instance.on("block-changed", () => {
            scheduleRealign();
          });

          const holderEl = document.getElementById(holderId);
          const toolbarEl = holderEl?.querySelector(".ce-toolbar");
          const redactorEl = holderEl?.querySelector(".codex-editor__redactor");
          let alignLock = false;
          if (toolbarEl) {
            const toolbarObserver = new MutationObserver(() => {
              if (alignLock) {
                return;
              }
              alignLock = true;
              realignToolbar();
              requestAnimationFrame(() => {
                alignLock = false;
              });
            });
            toolbarObserver.observe(toolbarEl, { attributes: true, attributeFilter: ["style", "class"] });
            disconnectObservers.push(() => toolbarObserver.disconnect());
          }

          // Header.setLevel 是 replaceChild(h1→h2)，用 DOM 变化兜住「移出再移入才正常」的时机
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
                scheduleRealign();
              }
            });
            headerDomObserver.observe(redactorEl, { childList: true, subtree: true });
            disconnectObservers.push(() => headerDomObserver.disconnect());
          }

          onReadyRef.current?.(instance);
        },
      });
    }, 0);

    return () => {
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
