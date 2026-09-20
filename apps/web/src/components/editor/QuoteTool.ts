import type { API, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

type QuoteData = {
  text: string;
  caption?: string;
};

type QuoteConfig = {
  quotePlaceholder?: string;
};

const QUOTE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 10.8182L9 10.8182C8.80222 10.8182 8.60888 10.7649 8.44443 10.665C8.27998 10.5651 8.15181 10.4231 8.07612 10.257C8.00043 10.0909 7.98063 9.90808 8.01922 9.73174C8.0578 9.55539 8.15304 9.39341 8.29289 9.26627C8.43275 9.13913 8.61093 9.05255 8.80491 9.01747C8.99889 8.98239 9.19996 9.00039 9.38268 9.0692C9.56541 9.13801 9.72159 9.25453 9.83147 9.40403C9.94135 9.55353 10 9.72929 10 9.90909L10 12.1818C10 12.664 9.78929 13.1265 9.41421 13.4675C9.03914 13.8084 8.53043 14 8 14"/><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 10.8182L15 10.8182C14.8022 10.8182 14.6089 10.7649 14.4444 10.665C14.28 10.5651 14.1518 10.4231 14.0761 10.257C14.0004 10.0909 13.9806 9.90808 14.0192 9.73174C14.0578 9.55539 14.153 9.39341 14.2929 9.26627C14.4327 9.13913 14.6109 9.05255 14.8049 9.01747C14.9989 8.98239 15.2 9.00039 15.3827 9.0692C15.5654 9.13801 15.7216 9.25453 15.8315 9.40403C15.9414 9.55353 16 9.72929 16 9.90909L16 12.1818C16 12.664 15.7893 13.1265 15.4142 13.4675C15.0391 13.8084 14.5304 14 14 14"/></svg>';

/**
 * 单输入引用块。
 * enableLineBreaks=false → Enter 由 Editor.js 结束当前块并新建段落。
 * Shift+Enter → 引用内换行。
 */
export class QuoteTool implements BlockTool {
  static get toolbox() {
    return {
      title: "引用 · quote",
      icon: QUOTE_ICON,
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  static get enableLineBreaks() {
    return false;
  }

  static get conversionConfig() {
    return {
      import: "text",
      export: (data: QuoteData) => data.text ?? "",
    };
  }

  static get sanitize() {
    return {
      text: { br: true },
      caption: {},
    };
  }

  private api: API;
  private readOnly: boolean;
  private data: QuoteData;
  private quotePlaceholder: string;
  private textEl: HTMLDivElement | null = null;

  constructor({ data, api, readOnly, config }: BlockToolConstructorOptions<QuoteData, QuoteConfig>) {
    this.api = api;
    this.readOnly = Boolean(readOnly);
    this.data = {
      text: typeof data?.text === "string" ? data.text : "",
      caption: typeof data?.caption === "string" ? data.caption : "",
    };
    this.quotePlaceholder = config?.quotePlaceholder?.trim() || "引用内容，Enter 结束";
  }

  render() {
    const wrap = document.createElement("blockquote");
    wrap.className = "cdx-quote";

    const text = document.createElement("div");
    text.className = "cdx-quote__text cdx-input";
    text.contentEditable = this.readOnly ? "false" : "true";
    text.dataset.placeholder = this.quotePlaceholder;
    text.innerHTML = this.data.text || "";
    this.textEl = text;

    if (!this.readOnly) {
      text.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key !== "Enter" || !event.shiftKey || event.isComposing) {
          return;
        }
        // Shift+Enter：引用内换行（普通 Enter 交给 Editor.js 退出块）
        event.preventDefault();
        event.stopPropagation();
        document.execCommand("insertLineBreak");
      });

      window.requestAnimationFrame(() => {
        text.focus();
      });
    }

    wrap.append(text);
    return wrap;
  }

  save() {
    return {
      text: this.textEl?.innerHTML ?? this.data.text,
      caption: this.data.caption ?? "",
    };
  }

  validate() {
    return true;
  }
}
