import type { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { NOTES_ICON_SVG, PAGE_LINK_TOOLBOX_SVG } from "@/lib/iconPark";

export type PageLinkData = {
  pageId: string;
  slug: string;
  title: string;
};

export type PageLinkToolConfig = {
  /** 工作区：点链接打开子页 */
  onOpen?: (page: PageLinkData) => void;
  /** 工作区：从 / 插入「子页面」时自动建子页 */
  createChild?: () => Promise<PageLinkData>;
};

/** 正文里的子页面块（Notes 图标）；可点开，不另设「插入链接」按钮 */
export class PageLinkTool implements BlockTool {
  static get toolbox() {
    return {
      title: "子页面",
      icon: PAGE_LINK_TOOLBOX_SVG,
    };
  }

  static get isReadOnlySupported() {
    return true;
  }

  private data: PageLinkData;
  private config: PageLinkToolConfig;
  private wrapper: HTMLDivElement;
  private creating = false;
  private bootstrapped = false;

  constructor({ data, config }: BlockToolConstructorOptions<PageLinkData, PageLinkToolConfig>) {
    this.config = config ?? {};
    this.data = {
      pageId: typeof data?.pageId === "string" ? data.pageId : "",
      slug: typeof data?.slug === "string" ? data.slug : "",
      title: typeof data?.title === "string" && data.title.trim() ? data.title : "无标题",
    };
    this.wrapper = document.createElement("div");
  }

  render() {
    this.paint();
    if (!this.data.pageId && this.config.createChild && !this.bootstrapped) {
      void this.bootstrapChild();
    }
    return this.wrapper;
  }

  private paint() {
    this.wrapper.removeEventListener("click", this.handleOpen);
    this.wrapper.className = "cdx-page-link";
    this.wrapper.contentEditable = "false";
    this.wrapper.replaceChildren();
    this.wrapper.removeAttribute("title");

    const icon = document.createElement("span");
    icon.className = "cdx-page-link__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = NOTES_ICON_SVG;

    const title = document.createElement("span");
    title.className = "cdx-page-link__title";

    if (this.creating) {
      this.wrapper.classList.add("is-loading");
      title.textContent = "正在创建子页面…";
    } else if (!this.data.pageId) {
      this.wrapper.classList.add("is-empty");
      title.textContent = this.config.createChild
        ? "创建子页面…"
        : "用侧栏 + 或工具栏「子页面」新建";
    } else {
      title.textContent = this.data.title || "无标题";
      if (this.config.onOpen) {
        this.wrapper.classList.add("is-clickable");
        this.wrapper.title = "打开子页面";
        this.wrapper.addEventListener("click", this.handleOpen);
      }
    }

    this.wrapper.append(icon, title);
  }

  private handleOpen = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!this.data.pageId || !this.config.onOpen) {
      return;
    }
    this.config.onOpen({ ...this.data });
  };

  private async bootstrapChild() {
    if (!this.config.createChild || this.bootstrapped || this.data.pageId) {
      return;
    }
    this.bootstrapped = true;
    this.creating = true;
    this.paint();
    try {
      const child = await this.config.createChild();
      this.data = {
        pageId: child.pageId,
        slug: child.slug,
        title: child.title?.trim() || "无标题",
      };
    } catch {
      this.bootstrapped = false;
      this.data = { pageId: "", slug: "", title: "无标题" };
    } finally {
      this.creating = false;
      this.paint();
    }
  }

  save() {
    return { ...this.data };
  }

  validate(data: PageLinkData) {
    if (this.creating) {
      return true;
    }
    return Boolean(data.pageId && data.slug);
  }

  destroy() {
    this.wrapper.removeEventListener("click", this.handleOpen);
  }
}
