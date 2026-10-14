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
  /** 不写或 left 为靠左。只有块级时，居中和右对齐才会挪位置 */
  align?: "left" | "center" | "right";
  /** 不写为内联并排；block 时单独占一行 */
  layout?: "inline" | "block";
};

export type ImageToolConfig = {
  upload?: (file: File) => Promise<AttachmentData>;
};

const IMAGE_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="6" y="10" width="36" height="28" rx="3" stroke="currentColor" stroke-width="3"/><circle cx="17" cy="20" r="3" stroke="currentColor" stroke-width="3"/><path d="m6 32 10-8 8 7 6-5 12 9" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const TRASH_SVG = `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M9 10v34h30V10H9Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M20 20v13M28 20v13M4 10h40" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="m16 10 3.3-6h9.5l3.2 6H16Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>`;

function icon(paths: string[]): string {
  const body = paths
    .map((d) => `<path d="${d}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("");
  return `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true">${body}</svg>`;
}

const PREVIEW_SVG = icon(["M33 6H42V15", "M42 33V42H33", "M15 42H6V33", "M6 15V6H15"]);
const DOWNLOAD_SVG = icon(["M6 24.0083V42H42V24", "M33 23L24 32L15 23", "M23.9917 6V32"]);
const ALIGN_LEFT_SVG = icon(["M42 9H6", "M34 19H6", "M42 29H6", "M34 39H6"]);
const ALIGN_CENTER_SVG = icon(["M36 19H12", "M42 9H6", "M42 29H6", "M36 39H12"]);
const ALIGN_RIGHT_SVG = icon(["M42 9H6", "M42 19H14", "M42 29H6", "M42 39H14"]);
const LAYOUT_INLINE_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><rect x="4" y="8" width="18" height="32" rx="3" fill="currentColor"/><path d="M28 14h16M28 24h16M28 34h10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;
const LAYOUT_BLOCK_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M6 7h36M6 41h36" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><rect x="8" y="15" width="32" height="18" rx="3" fill="currentColor"/></svg>`;

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

type ImageCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

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
  private resizeDrag: {
    pointerId: number;
    corner: ImageCorner;
    startX: number;
    startY: number;
    startWidth: number;
    column: number;
  } | null = null;
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
    this.wrapper.addEventListener("pointerenter", this.onBarEnter);
    this.wrapper.addEventListener("pointerleave", this.onBarLeave);
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
    if (this.data.layout === "block") {
      this.wrapper.classList.add("is-layout-block");
    }
    const align = this.data.align;
    if (align === "left" || align === "center" || align === "right") {
      this.wrapper.classList.add(`is-align-${align}`);
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
    img.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openPreview();
    });
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
    frame.append(img, this.hoverBar());
    if (!this.readOnly) {
      frame.addEventListener("pointerdown", this.onFramePointerDown);
      frame.append(
        this.resizeHandle("top-left"),
        this.resizeHandle("top-right"),
        this.resizeHandle("bottom-left"),
        this.resizeHandle("bottom-right"),
      );
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

  private onFramePointerDown = (event: PointerEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest(".cdx-image__resize, .cdx-image__bar")) {
      return;
    }
    this.select();
  };

  /** 点中后才出现四角圆点；再点到图片外面就收起 */
  private select() {
    document.querySelectorAll(".cdx-image.is-selected").forEach((node) => {
      if (node !== this.wrapper) {
        node.classList.remove("is-selected");
      }
    });
    if (this.wrapper.classList.contains("is-selected")) {
      return;
    }
    this.wrapper.classList.add("is-selected");
    document.addEventListener("pointerdown", this.onOutsidePointerDown);
  }

  private deselect() {
    this.wrapper.classList.remove("is-selected");
    document.removeEventListener("pointerdown", this.onOutsidePointerDown);
  }

  private onOutsidePointerDown = (event: PointerEvent) => {
    if (this.resizeDrag) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && this.wrapper.contains(target)) {
      return;
    }
    this.deselect();
  };

  private resizeHandle(corner: ImageCorner): HTMLButtonElement {
    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = `cdx-image__resize cdx-image__resize--${corner}`;
    handle.setAttribute("aria-label", t("image.resize"));
    handle.addEventListener("pointerdown", (event) => this.beginResize(event, corner));
    handle.addEventListener("dragstart", (event) => event.preventDefault());
    return handle;
  }

  private hoverBar(): HTMLDivElement {
    const bar = document.createElement("div");
    bar.className = "cdx-image__bar";
    bar.setAttribute("role", "toolbar");
    const preview = this.actionButton(t("image.preview"), PREVIEW_SVG, () => this.openPreview());
    const download = this.actionButton(t("image.download"), DOWNLOAD_SVG, () => void this.downloadImage());
    bar.append(preview, download);
    if (!this.readOnly) {
      bar.append(
        this.barDivider(),
        this.layoutControl(),
        this.alignControl(),
        this.barDivider(),
        this.actionButton(t("image.delete"), TRASH_SVG, () => this.removeBlock(), "is-danger"),
      );
    }
    return bar;
  }

  private barDivider(): HTMLSpanElement {
    const divider = document.createElement("span");
    divider.className = "cdx-image__bar-divider";
    divider.setAttribute("aria-hidden", "true");
    return divider;
  }

  private actionButton(label: string, svg: string, onClick: () => void, extra?: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = extra ? `cdx-image__action ${extra}` : "cdx-image__action";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = svg;
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  private layoutControl(): HTMLButtonElement {
    return this.actionButton(this.layoutLabel(), this.data.layout === "block" ? LAYOUT_BLOCK_SVG : LAYOUT_INLINE_SVG, () => this.toggleLayout(), "is-layout");
  }

  private layoutLabel(): string {
    return this.data.layout === "block" ? t("image.layoutBlock") : t("image.layoutInline");
  }

  private toggleLayout() {
    const block = this.data.layout !== "block";
    this.data = { ...this.data, layout: block ? "block" : undefined };
    this.wrapper.classList.toggle("is-layout-block", block);
    const button = this.wrapper.querySelector<HTMLButtonElement>(".cdx-image__action.is-layout");
    if (button) {
      const label = this.layoutLabel();
      button.innerHTML = block ? LAYOUT_BLOCK_SVG : LAYOUT_INLINE_SVG;
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    this.setAlignEnabled(block);
    if (!block) {
      this.setAlignMenuOpen(false);
    }
    this.block.dispatchChange();
  }

  private currentAlign(): "left" | "center" | "right" {
    return this.data.align === "center" || this.data.align === "right" ? this.data.align : "left";
  }

  private alignLabel(align: "left" | "center" | "right"): string {
    if (align === "center") {
      return t("image.alignCenter");
    }
    if (align === "right") {
      return t("image.alignRight");
    }
    return t("image.alignLeft");
  }

  private alignIcon(align: "left" | "center" | "right"): string {
    if (align === "center") {
      return ALIGN_CENTER_SVG;
    }
    if (align === "right") {
      return ALIGN_RIGHT_SVG;
    }
    return ALIGN_LEFT_SVG;
  }

  /** 按钮显示当前对齐，点开后再选左对齐、居中或右对齐 */
  private alignControl(): HTMLDivElement {
    const align = this.currentAlign();
    const wrap = document.createElement("div");
    wrap.className = "cdx-image__align";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cdx-image__action is-align";
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.title = this.alignLabel(align);
    button.setAttribute("aria-label", this.alignLabel(align));
    button.innerHTML = this.alignIcon(align);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) {
        return;
      }
      this.setAlignMenuOpen(!wrap.classList.contains("is-open"));
    });
    const menu = document.createElement("div");
    menu.className = "cdx-image__align-menu";
    menu.hidden = true;
    menu.setAttribute("role", "menu");
    for (const item of ["left", "center", "right"] as const) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "cdx-image__align-option";
      option.dataset.align = item;
      option.setAttribute("role", "menuitemradio");
      option.setAttribute("aria-checked", String(item === align));
      option.classList.toggle("is-active", item === align);
      option.innerHTML = `${this.alignIcon(item)}<span>${this.alignLabel(item)}</span>`;
      option.addEventListener("pointerdown", (event) => event.stopPropagation());
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.setAlign(item);
        this.setAlignMenuOpen(false);
      });
      menu.append(option);
    }
    wrap.append(button, menu);
    if (this.data.layout !== "block") {
      button.disabled = true;
      button.title = t("image.alignDisabled");
      button.setAttribute("aria-label", t("image.alignDisabled"));
    }
    return wrap;
  }

  private setAlignEnabled(enabled: boolean) {
    const button = this.wrapper.querySelector<HTMLButtonElement>(".cdx-image__action.is-align");
    if (!button) {
      return;
    }
    button.disabled = !enabled;
    const label = enabled ? this.alignLabel(this.currentAlign()) : t("image.alignDisabled");
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  private setAlignMenuOpen(open: boolean) {
    const align = this.wrapper.querySelector(".cdx-image__align");
    const menu = this.wrapper.querySelector<HTMLElement>(".cdx-image__align-menu");
    const button = this.wrapper.querySelector(".cdx-image__action.is-align");
    align?.classList.toggle("is-open", open);
    this.wrapper.classList.toggle("is-align-open", open);
    if (menu) {
      menu.hidden = !open;
    }
    button?.setAttribute("aria-expanded", String(open));
    document.removeEventListener("pointerdown", this.onAlignMenuOutside);
    if (open) {
      document.addEventListener("pointerdown", this.onAlignMenuOutside);
    }
    requestAnimationFrame(() => this.placeBar());
  }

  /** 下方放不下操作条时翻到图片上方，避免被滚动容器裁掉 */
  private placeBar = () => {
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    const bar = this.wrapper.querySelector(".cdx-image__bar");
    if (!(frame instanceof HTMLElement) || !(bar instanceof HTMLElement)) {
      return;
    }
    const rect = frame.getBoundingClientRect();
    const scroller = this.scrollParent();
    const bounds = scroller?.getBoundingClientRect();
    const topLimit = Math.max(0, bounds?.top ?? 0);
    const bottomLimit = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight);
    const menu = this.wrapper.querySelector(".cdx-image__align-menu");
    const menuHeight = menu instanceof HTMLElement && !menu.hidden ? menu.offsetHeight + 8 : 0;
    const needed = Math.max(bar.offsetHeight, 36) + 8 + menuHeight;
    const spaceBelow = bottomLimit - rect.bottom;
    const spaceAbove = rect.top - topLimit;
    this.wrapper.classList.toggle("is-bar-above", spaceBelow < needed && spaceAbove > spaceBelow);
  };

  private scrollParent(): HTMLElement | null {
    let node = this.wrapper.parentElement;
    while (node && node !== document.body) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === "auto" || overflow === "scroll") {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  private onBarEnter = () => {
    this.placeBar();
    this.scrollParent()?.addEventListener("scroll", this.placeBar);
    window.addEventListener("scroll", this.placeBar, true);
    window.addEventListener("resize", this.placeBar);
  };

  private onBarLeave = () => {
    if (this.wrapper.matches(":hover") || this.wrapper.classList.contains("is-align-open")) {
      return;
    }
    this.scrollParent()?.removeEventListener("scroll", this.placeBar);
    window.removeEventListener("scroll", this.placeBar, true);
    window.removeEventListener("resize", this.placeBar);
  };

  private stopBarWatch() {
    this.scrollParent()?.removeEventListener("scroll", this.placeBar);
    window.removeEventListener("scroll", this.placeBar, true);
    window.removeEventListener("resize", this.placeBar);
  }

  private onAlignMenuOutside = (event: PointerEvent) => {
    const align = this.wrapper.querySelector(".cdx-image__align");
    if (align && event.target instanceof Node && align.contains(event.target)) {
      return;
    }
    this.setAlignMenuOpen(false);
  };

  private setAlign(align: "left" | "center" | "right") {
    this.data = { ...this.data, align, layout: "block" };
    this.wrapper.classList.add("is-layout-block");
    this.wrapper.classList.remove("is-align-left", "is-align-center", "is-align-right");
    this.wrapper.classList.add(`is-align-${align}`);
    const layoutButton = this.wrapper.querySelector<HTMLButtonElement>(".cdx-image__action.is-layout");
    if (layoutButton) {
      const label = t("image.layoutBlock");
      layoutButton.innerHTML = LAYOUT_BLOCK_SVG;
      layoutButton.title = label;
      layoutButton.setAttribute("aria-label", label);
    }
    const button = this.wrapper.querySelector<HTMLButtonElement>(".cdx-image__action.is-align");
    if (button) {
      const label = this.alignLabel(align);
      button.innerHTML = this.alignIcon(align);
      button.title = label;
      button.setAttribute("aria-label", label);
    }
    this.wrapper.querySelectorAll<HTMLButtonElement>(".cdx-image__align-option").forEach((option) => {
      const selected = option.dataset.align === align;
      option.classList.toggle("is-active", selected);
      option.setAttribute("aria-checked", String(selected));
    });
    this.block.dispatchChange();
  }

  private publicUrl(): string {
    const url = this.data.file?.url?.trim() ?? "";
    return /^https?:\/\//i.test(url) ? url : "";
  }

  private imageSource(): string {
    return this.wrapper.querySelector("img")?.currentSrc || this.wrapper.querySelector("img")?.src || this.publicUrl();
  }

  private openPreview() {
    const src = this.imageSource();
    if (!src) {
      return;
    }
    const overlay = document.createElement("div");
    overlay.className = "cdx-image-preview";
    const image = document.createElement("img");
    image.src = src;
    image.alt = this.data.caption || this.data.name || "";
    image.addEventListener("click", (event) => event.stopPropagation());
    overlay.append(image);
    const close = () => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
  }

  private async downloadImage() {
    const src = this.imageSource();
    if (!src) {
      return;
    }
    const name = this.data.name || "image";
    try {
      const response = await fetch(src);
      if (!response.ok) {
        throw new Error("download");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      const link = document.createElement("a");
      link.href = this.publicUrl() || src;
      link.download = name;
      link.target = "_blank";
      link.rel = "noopener";
      link.click();
    }
  }

  private beginResize(event: PointerEvent, corner: ImageCorner) {
    if (this.readOnly || !(event.currentTarget instanceof HTMLElement)) {
      return;
    }
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    if (!(frame instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.select();
    const column = this.columnWidth() || frame.getBoundingClientRect().width;
    this.resizeDrag = {
      pointerId: event.pointerId,
      corner,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: frame.getBoundingClientRect().width,
      column,
    };
    const cursor = corner === "top-left" || corner === "bottom-right" ? "nwse-resize" : "nesw-resize";
    document.documentElement.style.setProperty("--image-resize-cursor", cursor);
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

  /** 四角圆点都改宽度，图片仍靠左。往外拖变大，往里拖变小 */
  private onResizeMove = (event: PointerEvent) => {
    const drag = this.resizeDrag;
    const frame = this.wrapper.querySelector(".cdx-image__frame");
    if (!drag || event.pointerId !== drag.pointerId || !(frame instanceof HTMLElement) || drag.column <= 0) {
      return;
    }
    const dx = drag.corner.endsWith("right") ? event.clientX - drag.startX : drag.startX - event.clientX;
    const dy = drag.corner.startsWith("bottom") ? event.clientY - drag.startY : drag.startY - event.clientY;
    const along = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
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
    document.documentElement.style.removeProperty("--image-resize-cursor");
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
    document.removeEventListener("pointerdown", this.onOutsidePointerDown);
    document.removeEventListener("pointerdown", this.onAlignMenuOutside);
    this.stopBarWatch();
    document.removeEventListener("pointermove", this.onResizeMove);
    document.removeEventListener("pointerup", this.onResizeEnd);
    document.removeEventListener("pointercancel", this.onResizeEnd);
    document.documentElement.classList.remove("is-image-resizing");
    document.documentElement.style.removeProperty("--image-resize-cursor");
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = "";
    }
  }
}
