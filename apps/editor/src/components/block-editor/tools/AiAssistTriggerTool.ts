import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";

import { menuIcons } from "../menuIcons";

export type AiAssistInvokeContext = {
  blockIndex: number;
};

export type AiAssistTriggerConfig = {
  onInvoke?: (ctx: AiAssistInvokeContext) => void;
};

/** / 命令：选中后打开 AI 对话，不在正文留块 */
export class AiAssistTriggerTool implements BlockTool {
  static get toolbox() {
    return {
      title: "AI Chat · ai",
      icon: menuIcons.ai,
    };
  }

  private api: API;
  private config: AiAssistTriggerConfig;
  private block: BlockAPI | undefined;
  private invoked = false;
  private wrapper: HTMLDivElement;

  constructor({ api, config, block }: BlockToolConstructorOptions<Record<string, never>, AiAssistTriggerConfig>) {
    this.api = api;
    this.config = config ?? {};
    this.block = block;
    this.wrapper = document.createElement("div");
  }

  render() {
    if (!this.invoked) {
      this.invoked = true;
      window.setTimeout(() => {
        let index = this.api.blocks.getCurrentBlockIndex();
        try {
          if (this.block?.id) {
            const byId = this.api.blocks.getById(this.block.id);
            if (byId) {
              index = this.api.blocks.getBlockIndex(this.block.id);
            }
          }
          if (typeof index === "number" && index >= 0) {
            this.api.blocks.delete(index);
          }
        } catch {
          /* 块可能已被清掉 */
        }
        const insertAt = typeof index === "number" && index >= 0 ? index : 0;
        window.setTimeout(() => {
          this.config.onInvoke?.({ blockIndex: insertAt });
        }, 40);
      }, 0);
    }
    this.wrapper.className = "hidden";
    this.wrapper.setAttribute("aria-hidden", "true");
    return this.wrapper;
  }

  save() {
    return {};
  }

  validate() {
    return false;
  }
}
