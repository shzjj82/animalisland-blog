import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { t } from "@/i18n";
import { fileTypeSvg } from "@/components/file-type-icon";
import { ATTACHMENT_ACCEPT, fileKind, formatFileSize } from "@/lib/document/fileKinds";
import type { AttachmentData } from "@/store/fileStore";

export type AttachmentToolConfig = {
  upload?: (file: File) => Promise<AttachmentData>;
  /** replace 用来在补传到云端后更新块数据 */
  onOpen?: (data: AttachmentData, replace: (next: AttachmentData) => void) => void;
  confirmDelete?: (name: string) => Promise<boolean>;
};

const TRASH_SVG = `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 10v34h30V10H9Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20 20v13M28 20v13M4 10h40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 10 3.3-6h9.5l3.2 6H16Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;

const PAPERCLIP_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M40.7 22.3 24.4 38.6a10 10 0 0 1-14.1-14.1L27.3 7.5a6.7 6.7 0 0 1 9.4 9.4L19.6 34a3.3 3.3 0 0 1-4.7-4.7L30.4 13.8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function isAttachment(data: unknown): data is AttachmentData {
  const value = data as Partial<AttachmentData> | undefined;
  return typeof value?.fileId === "string" && Boolean(value.fileId) && typeof value.name === "string";
}

/** 正文里的文件块：卡片展示，点击在侧边栏预览 */
export class AttachmentTool implements BlockTool {
  static get toolbox() {
    return { title: "File · file", icon: PAPERCLIP_SVG };
  }

  static get isReadOnlySupported() {
    return true;
  }

  private data: AttachmentData | null;
  private config: AttachmentToolConfig;
  private wrapper = document.createElement("div");
  private uploading = "";
  private error = "";
  private picked = false;
  private api: API;
  private block: BlockAPI;
  private readOnly: boolean;

  constructor({ data, config, api, block, readOnly }: BlockToolConstructorOptions<AttachmentData, AttachmentToolConfig>) {
    this.config = config ?? {};
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
    this.data = isAttachment(data) ? { ...data } : null;
    this.wrapper.addEventListener("click", this.handleClick);
    this.wrapper.addEventListener("mouseenter", this.handleHover);
  }

  render() {
    this.paint();
    if (!this.data && !this.picked) {
      this.picked = true;
      window.setTimeout(() => this.pick(), 0);
    }
    return this.wrapper;
  }

  private paint() {
    this.wrapper.className = "cdx-attachment";
    this.wrapper.contentEditable = "false";
    this.wrapper.replaceChildren();

    const icon = document.createElement("span");
    icon.className = "cdx-attachment__icon";
    const name = document.createElement("span");
    name.className = "cdx-attachment__name";
    const meta = document.createElement("span");
    meta.className = "cdx-attachment__meta";

    const kind = this.data ? fileKind(this.data.name) : null;
    if (this.data && kind) {
      icon.innerHTML = fileTypeSvg(kind, 28);
      name.textContent = this.data.name;
      meta.textContent = formatFileSize(this.data.size);
      this.wrapper.setAttribute("aria-label", `${t("attachment.open")}: ${this.data.name}`);
      this.wrapper.classList.add("is-clickable");
    } else {
      icon.innerHTML = PAPERCLIP_SVG;
      name.textContent = this.uploading ? t("attachment.uploading", { name: this.uploading }) : t("attachment.pick");
      meta.textContent = this.error || (this.uploading ? "" : t("attachment.supported"));
      this.wrapper.classList.add(this.uploading ? "is-loading" : "is-empty");
      this.wrapper.classList.toggle("is-error", Boolean(this.error));
    }

    const text = document.createElement("span");
    text.className = "cdx-attachment__text";
    text.append(name, meta);
    this.wrapper.append(icon, text);

    if (this.data) {
      const tip = document.createElement("span");
      tip.className = "cdx-attachment__tip";
      tip.setAttribute("role", "tooltip");
      tip.textContent = this.data.name;
      this.wrapper.append(tip);
    }

    if (!this.readOnly && !this.uploading) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cdx-attachment__delete";
      remove.setAttribute("aria-label", t("attachment.delete"));
      remove.innerHTML = TRASH_SVG;
      remove.addEventListener("click", this.handleDelete);
      this.wrapper.append(remove);
    }
  }

  private handleDelete = async (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const name = this.data?.name ?? t("attachment.pick");
    const ok = this.data ? await (this.config.confirmDelete?.(name) ?? Promise.resolve(window.confirm(name))) : true;
    if (ok) {
      this.api.blocks.delete(this.api.blocks.getBlockIndex(this.block.id));
    }
  };

  /** 文件名被截断时才显示完整名称的浮层 */
  private handleHover = () => {
    const name = this.wrapper.querySelector<HTMLElement>(".cdx-attachment__name");
    this.wrapper.classList.toggle("is-truncated", Boolean(name && name.scrollWidth > name.clientWidth));
  };

  private handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.data) {
      this.config.onOpen?.({ ...this.data }, (next) => {
        this.data = { ...next };
        this.paint();
      });
    } else if (!this.uploading) {
      this.pick();
    }
  };

  private pick() {
    if (!this.config.upload) {
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ATTACHMENT_ACCEPT;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) {
        void this.upload(file);
      }
    });
    input.click();
  }

  private async upload(file: File) {
    if (!this.config.upload) {
      return;
    }
    if (!fileKind(file.name)) {
      this.error = t("attachment.unsupported", { name: file.name });
      this.paint();
      return;
    }
    this.uploading = file.name;
    this.error = "";
    this.paint();
    try {
      this.data = await this.config.upload(file);
    } catch (error) {
      this.error = error instanceof Error ? error.message : t("attachment.uploadFailed");
    } finally {
      this.uploading = "";
      this.paint();
    }
  }

  save() {
    return this.data ? { ...this.data } : {};
  }

  validate(data: Partial<AttachmentData>) {
    return isAttachment(data);
  }

  destroy() {
    this.wrapper.removeEventListener("click", this.handleClick);
    this.wrapper.removeEventListener("mouseenter", this.handleHover);
  }
}
