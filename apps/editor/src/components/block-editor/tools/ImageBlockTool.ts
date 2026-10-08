import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { t } from "@/i18n";
import { IMAGE_ACCEPT, isImageFile } from "@/lib/document/fileKinds";
import { loadAttachment, type AttachmentData } from "@/store/fileStore";
import { loadSession } from "@/store/remoteStore";

export type ImageBlockData = {
  file?: { url?: string };
  caption?: string;
  name?: string;
  fileId?: string;
  size?: number;
  mime?: string;
  source?: "local" | "remote";
};

export type ImageToolConfig = {
  upload?: (file: File) => Promise<AttachmentData>;
};

const IMAGE_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" stroke-width="3"/><circle cx="17" cy="20" r="3" stroke="currentColor" stroke-width="3"/><path d="m6 32 10-8 8 7 6-5 12 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const TRASH_SVG = `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 10v34h30V10H9Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20 20v13M28 20v13M4 10h40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 10 3.3-6h9.5l3.2 6H16Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;

export function imageBlockData(uploaded: AttachmentData): ImageBlockData {
  return {
    file: { url: uploaded.url ?? "" },
    name: uploaded.name,
    fileId: uploaded.fileId,
    size: uploaded.size,
    mime: uploaded.mime,
    source: uploaded.source,
  };
}

function isImageData(data: ImageBlockData | undefined): boolean {
  return Boolean(data?.file?.url || data?.fileId);
}

/** 正文里的图片。菜单、粘贴、拖入都能插入；Word 导入的图片也走这块。 */
export class ImageBlockTool implements BlockTool {
  static get toolbox() {
    return { title: "Image · image", icon: IMAGE_SVG };
  }

  static get isReadOnlySupported() {
    return true;
  }

  private data: ImageBlockData;
  private config: ImageToolConfig;
  private wrapper = document.createElement("figure");
  private objectUrl = "";
  private uploading = "";
  private error = "";
  private picked = false;
  private api: API;
  private block: BlockAPI;
  private readOnly: boolean;

  constructor({ data, config, api, block, readOnly }: BlockToolConstructorOptions<ImageBlockData, ImageToolConfig>) {
    this.data = data ?? {};
    this.config = config ?? {};
    this.api = api;
    this.block = block;
    this.readOnly = readOnly;
  }

  render() {
    this.paint();
    if (!this.readOnly && !isImageData(this.data) && !this.picked) {
      this.picked = true;
      window.setTimeout(() => this.pick(), 0);
    }
    return this.wrapper;
  }

  private paint() {
    this.wrapper.removeEventListener("click", this.handleEmptyClick);
    this.wrapper.className = "cdx-image";
    this.wrapper.replaceChildren();
    if (!isImageData(this.data)) {
      this.paintEmpty();
      return;
    }
    const img = document.createElement("img");
    img.alt = this.data.caption || this.data.name || "";
    if (this.objectUrl) {
      img.src = this.objectUrl;
    } else {
      const url = this.data.file?.url?.trim() ?? "";
      if (url) {
        img.src = url;
      } else if (this.data.fileId && this.data.name && this.data.source) {
        const stored: AttachmentData = {
          fileId: this.data.fileId,
          name: this.data.name,
          size: this.data.size ?? 0,
          mime: this.data.mime || "image/png",
          source: this.data.source,
          url: this.data.file?.url,
        };
        void loadAttachment(loadSession(), stored)
          .then((blob) => {
            this.objectUrl = URL.createObjectURL(blob);
            img.src = this.objectUrl;
          })
          .catch(() => undefined);
      }
    }
    this.wrapper.append(img);
    if (!this.readOnly) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "cdx-image__delete";
      remove.setAttribute("aria-label", t("image.delete"));
      remove.innerHTML = TRASH_SVG;
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.api.blocks.delete(this.api.blocks.getBlockIndex(this.block.id));
      });
      this.wrapper.append(remove);
    }
  }

  private paintEmpty() {
    this.wrapper.classList.add(this.uploading ? "is-loading" : "is-empty");
    this.wrapper.classList.toggle("is-error", Boolean(this.error));
    const icon = document.createElement("span");
    icon.className = "cdx-image__icon";
    icon.innerHTML = IMAGE_SVG;
    const text = document.createElement("span");
    text.textContent = this.uploading
      ? t("image.uploading", { name: this.uploading })
      : this.error || t("image.pick");
    this.wrapper.append(icon, text);
    if (!this.readOnly && !this.uploading) {
      this.wrapper.addEventListener("click", this.handleEmptyClick);
    }
  }

  private handleEmptyClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    this.pick();
  };

  private pick() {
    if (!this.config.upload || this.readOnly || this.uploading) {
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_ACCEPT;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) {
        void this.upload(file);
      } else if (!isImageData(this.data)) {
        this.api.blocks.delete(this.api.blocks.getBlockIndex(this.block.id));
      }
    });
    input.click();
  }

  private async upload(file: File) {
    if (!this.config.upload) {
      return;
    }
    if (!isImageFile(file)) {
      this.error = t("image.unsupported", { name: file.name });
      this.paint();
      return;
    }
    this.uploading = file.name || "image";
    this.error = "";
    this.paint();
    try {
      const uploaded = await this.config.upload(file);
      if (this.objectUrl) {
        URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = "";
      }
      this.data = imageBlockData(uploaded);
      if (!uploaded.url) {
        this.objectUrl = URL.createObjectURL(file);
      }
      this.block.dispatchChange();
    } catch (error) {
      this.error = error instanceof Error ? error.message : t("attachment.uploadFailed");
    } finally {
      this.uploading = "";
      this.paint();
    }
  }

  save() {
    return this.data;
  }

  validate(data: ImageBlockData) {
    return isImageData(data);
  }

  destroy() {
    this.wrapper.removeEventListener("click", this.handleEmptyClick);
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = "";
    }
  }
}
