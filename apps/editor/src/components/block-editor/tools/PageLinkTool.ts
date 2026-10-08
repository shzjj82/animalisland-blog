import type { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { pageTitle, t } from "@/i18n";

export type PageLinkData = {
  pageId: string;
  slug: string;
  title: string;
};

export type PageLinkToolConfig = {
  onOpen?: (page: PageLinkData) => void;
  createChild?: () => Promise<PageLinkData>;
  /** 与侧栏同一份标题；有则覆盖块里存的旧名称 */
  resolveTitle?: (pageId: string) => string | undefined;
};

const NOTES_ICON_SVG = `<svg width="1em" height="1em" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 6C8 4.89543 8.89543 4 10 4H30L40 14V42C40 43.1046 39.1046 44 38 44H10C8.89543 44 8 43.1046 8 42V6Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16 20H32" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 28H32" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 正文里的子页面块。未注册时 Editor.js 会显示 “can not be displayed correctly”。 */
export class PageLinkTool implements BlockTool {
  static get toolbox() {
    return {
      title: "Subpage · page",
      icon: NOTES_ICON_SVG.replace('width="1em"', 'width="18"').replace('height="1em"', 'height="18"'),
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
      title: typeof data?.title === "string" && data.title.trim() ? data.title : t("common.untitled"),
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

  /** 侧栏标题优先，这样父页面里的子页面名称和侧栏一致 */
  private pullTitle() {
    const live = this.data.pageId ? this.config.resolveTitle?.(this.data.pageId)?.trim() : "";
    if (live && live !== this.data.title) {
      this.data = { ...this.data, title: live };
    }
  }

  private paint() {
    this.pullTitle();
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
      title.textContent = t("blockEditor.creatingSubpage");
    } else if (!this.data.pageId) {
      this.wrapper.classList.add("is-empty");
      title.textContent = t("common.subpage");
    } else {
      title.textContent = pageTitle(this.data.title);
      if (this.config.onOpen) {
        this.wrapper.classList.add("is-clickable");
        this.wrapper.title = t("blockEditor.openSubpage");
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
        title: child.title?.trim() || t("common.untitled"),
      };
    } catch {
      this.bootstrapped = false;
      this.data = { pageId: "", slug: "", title: t("common.untitled") };
    } finally {
      this.creating = false;
      this.paint();
    }
  }

  save() {
    this.pullTitle();
    return { ...this.data };
  }

  validate(data: PageLinkData) {
    if (this.creating) {
      return true;
    }
    return Boolean(data?.pageId);
  }

  destroy() {
    this.wrapper.removeEventListener("click", this.handleOpen);
  }
}
