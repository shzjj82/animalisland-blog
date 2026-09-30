import type { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
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

function isImageData(data: ImageBlockData | undefined): boolean {
  return Boolean(data?.file?.url || data?.fileId);
}

/** 正文里的图片。由 Word 导入上传后插入，不出现在块菜单里。 */
export class ImageBlockTool implements BlockTool {
  static get isReadOnlySupported() {
    return true;
  }

  private data: ImageBlockData;
  private wrapper = document.createElement("figure");
  private objectUrl = "";

  constructor({ data }: BlockToolConstructorOptions<ImageBlockData>) {
    this.data = data ?? {};
  }

  render() {
    this.wrapper.className = "cdx-image";
    this.wrapper.replaceChildren();
    const img = document.createElement("img");
    img.alt = this.data.caption || this.data.name || "";
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
    this.wrapper.append(img);
    return this.wrapper;
  }

  save() {
    return this.data;
  }

  validate(data: ImageBlockData) {
    return isImageData(data);
  }

  destroy() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = "";
    }
  }
}
