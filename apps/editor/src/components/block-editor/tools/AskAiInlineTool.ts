import type { API } from "@editorjs/editorjs";

export type AskAiInlineConfig = {
  onAsk?: (text: string) => void;
};

/** 划词工具栏里的「问 AI」，和粗体、斜体同一行 */
export class AskAiInlineTool {
  static get isInline() {
    return true;
  }

  static get title() {
    return "AI";
  }

  private api: API;
  private config: AskAiInlineConfig;
  private button: HTMLButtonElement | null = null;

  constructor({ api, config }: { api: API; config?: AskAiInlineConfig }) {
    this.api = api;
    this.config = config ?? {};
  }

  render() {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add(this.api.styles.inlineToolButton, "ce-inline-tool--ask-ai");
    button.textContent = "AI";
    this.button = button;
    return button;
  }

  surround(range: Range) {
    const text = range.toString().replace(/\u200b/g, "").trim();
    if (text.length < 2) {
      return;
    }
    this.config.onAsk?.(text);
    this.api.inlineToolbar.close();
  }

  checkState() {
    this.button?.classList.remove(this.api.styles.inlineToolButtonActive);
    return false;
  }
}
