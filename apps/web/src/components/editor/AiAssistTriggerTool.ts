import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { AI_ASSIST_TOOLBOX_SVG } from "@/lib/iconPark";

export type AiAssistInvokeContext = {
  /** 删除临时块之后，新内容应插入的下标 */
  blockIndex: number;
};

export type AiAssistTriggerConfig = {
  /** 从 / 菜单选中时唤起 inline 写作助手 */
  onInvoke?: (ctx: AiAssistInvokeContext) => void;
};

/** / 命令：选中后打开写作助手，不在正文留块 */
export class AiAssistTriggerTool implements BlockTool {
  static get toolbox() {
    return {
      title: "写作助手",
      icon: AI_ASSIST_TOOLBOX_SVG,
    };
  }

  private api: API;
  private config: AiAssistTriggerConfig;
  private block: BlockAPI | undefined;
  private invoked = false;
  private wrapper: HTMLDivElement;

  constructor({
    api,
    config,
    block,
  }: BlockToolConstructorOptions<Record<string, never>, AiAssistTriggerConfig>) {
    this.api = api;
    this.config = config ?? {};
    this.block = block;
    this.wrapper = document.createElement("div");
  }

  render() {
    if (!this.invoked) {
      this.invoked = true;
      // 等 Editor.js 插块完成后再删；删完再唤起，避免焦点被编辑器抢回
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
          /* 块可能已被 validate 清掉 */
        }
        const insertAt = typeof index === "number" && index >= 0 ? index : 0;
        window.setTimeout(() => {
          this.config.onInvoke?.({ blockIndex: insertAt });
        }, 40);
      }, 0);
    }
    this.wrapper.className = "cdx-ai-assist-trigger";
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
