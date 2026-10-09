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
  /** 相对正文栏宽度的百分比。不写则按图片原始尺寸显示，最大不超过正文栏 */
  width?: number;
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

function storedWidth(data: ImageBlockData): number | undefined {
  const width = data.width;
  if (typeof width !== "number" || !Number.isFinite(width)) {
    return undefined;
  }
  return Math.min(100, Math.max(15, Math.round(width)));
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
  private resizeDrag: { pointerId: number; edge: "left" | "right"; startX: number; startWidth: number; column: number } | null = null;
  private layoutObserver: ResizeObserver | null = null;
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
      this.pick();
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
    const frame = document.createElement("div");
    frame.className = "cdx-image__frame";
    const width = storedWidth(this.data);
    if (width) {
      frame.classList.add("is-resized");
      frame.style.width = `${width}%`;
    }
    const img = document.createElement("img");
    img.alt = this.data.caption || this.data.name || "";
    img.draggable = false;
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
    frame.append(img);
    if (!this.readOnly) {
      frame.append(this.resizeHandle("left"), this.resizeHandle("right"), this.deleteButton());
    }
    this.wrapper.append(frame);
    if (storedWidth(this.data)) {
      requestAnimationFrame(() => {
        this.applyStoredWidth();
        this.watchColumn();
      });
    }
  }

  /** 正文栏宽度。图片块本身是收缩的，不能拿它的宽度当百分比基准 */
  private columnWidth(): number {
    const redactor = this.wrapper.closest(".codex-editor__redactor");
    if (redactor instanceof HTMLElement) {
      const style = getComputedStyle(redactor);
      const pad = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
      const width = redactor.clientWidth - pad;
      if (width > 0) {
        return width;
      }
    }
    return this.wrapper.clientWidth;
  }

  private applyStoredWidth() {
    if (this.resizeDrag) {
      return;
    }
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    const width = storedWidth(this.data);
    if (!(frame instanceof HTMLElement) || !width) {
      return;
    }
    const column = this.columnWidth();
    if (column <= 0) {
      return;
    }
    frame.classList.add("is-resized");
    frame.style.width = `${Math.round((column * width) / 100)}px`;
  }

  private watchColumn() {
    if (this.layoutObserver || typeof ResizeObserver === "undefined") {
      return;
    }
    const redactor = this.wrapper.closest(".codex-editor__redactor");
    if (!(redactor instanceof Element)) {
      return;
    }
    this.layoutObserver = new ResizeObserver(() => this.applyStoredWidth());
    this.layoutObserver.observe(redactor);
  }

  private resizeHandle(edge: "left" | "right"): HTMLButtonElement {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `cdx-image__resize cdx-image__resize--${edge}`;
    handle.setAttribute("aria-label", t("image.resize"));
    handle.addEventListener("pointerdown", (event) => this.beginResize(event, edge));
    handle.addEventListener("dragstart", (event) => event.preventDefault());
    return handle;
  }

  private deleteButton(): HTMLButtonElement {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cdx-image__delete";
    remove.setAttribute("aria-label", t("image.delete"));
    remove.innerHTML = TRASH_SVG;
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeBlock();
    });
    return remove;
  }

  private beginResize(event: PointerEvent, edge: "left" | "right") {
    if (this.readOnly || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    if (!(frame instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const column = this.columnWidth() || frame.getBoundingClientRect().width;
    this.resizeDrag = {
      pointerId: event.pointerId,
      edge,
      startX: event.clientX,
      startWidth: frame.getBoundingClientRect().width,
      column,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 个别环境下捕获指针会失败，文档级监听仍然能完成拖拽
    }
    this.wrapper.classList.add("is-resizing");
    document.documentElement.classList.add("is-image-resizing");
    document.addEventListener("pointermove", this.onResizeMove);
    document.addEventListener("pointerup", this.onResizeEnd);
    document.addEventListener("pointercancel", this.onResizeEnd);
  }

  /** 图片靠左，左边缘不动。向右拖右侧手柄，右边缘跟着光标；拖左侧手柄同样只改宽度 */
  private onResizeMove = (event: PointerEvent) => {
    const drag = this.resizeDrag;
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    if (!drag || event.pointerId !== drag.pointerId || !(frame instanceof HTMLElement) || drag.column <= 0) {
      return;
    }
    const along = drag.edge === "left" ? drag.startX - event.clientX : event.clientX - drag.startX;
    const min = Math.min(drag.column, Math.max(120, drag.column * 0.12));
    const next = Math.min(drag.column, Math.max(min, drag.startWidth + along));
    frame.classList.add("is-resized");
    frame.style.width = `${Math.round(next)}px`;
  };

  private onResizeEnd = (event: PointerEvent) => {
    const drag = this.resizeDrag;
    if (!drag || event.pointerId !== drag.pointerId) {
      return;
    }
    this.resizeDrag = null;
    document.removeEventListener("pointermove", this.onResizeMove);
    document.removeEventListener("pointerup", this.onResizeEnd);
    document.removeEventListener("pointercancel", this.onResizeEnd);
    this.wrapper.classList.remove("is-resizing");
    document.documentElement.classList.remove("is-image-resizing");
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    if (!(frame instanceof HTMLElement) || drag.column <= 0) {
      return;
    }
    const percent = Math.min(100, Math.max(15, Math.round((frame.getBoundingClientRect().width / drag.column) * 100)));
    this.data = { ...this.data, width: percent };
    this.applyStoredWidth();
    this.watchColumn();
    this.block.dispatchChange();
  };

  private removeBlock() {
    const index = this.api.blocks.getBlockIndex(this.block.id);
    if (index >= 0) {
      this.api.blocks.delete(index);
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
    input.hidden = true;
    document.body.append(input);
    let settled = false;
    let dialogOpened = false;
    const finish = () => {
      input.remove();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
    const onBlur = () => {
      dialogOpened = true;
    };
    const onFocus = () => {
      window.setTimeout(() => {
        if (!settled && dialogOpened && !isImageData(this.data) && !this.uploading) {
          finish();
          this.removeBlock();
        }
      }, 200);
    };
    input.addEventListener("change", () => {
      settled = true;
      const file = input.files?.[0];
      finish();
      if (file) {
        void this.upload(file);
      } else if (!isImageData(this.data)) {
        this.removeBlock();
      }
    });
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    input.click();
    if (!dialogOpened) {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      input.remove();
    }
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
    this.layoutObserver?.disconnect();
    this.layoutObserver = null;
    this.wrapper.removeEventListener("click", this.handleEmptyClick);
    document.removeEventListener("pointermove", this.onResizeMove);
    document.removeEventListener("pointerup", this.onResizeEnd);
    document.removeEventListener("pointercancel", this.onResizeEnd);
    document.documentElement.classList.remove("is-image-resizing");
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = "";
    }
  }
}
