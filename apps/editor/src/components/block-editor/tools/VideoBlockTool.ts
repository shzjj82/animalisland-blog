import type { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { loadAttachment, type AttachmentData } from "@/store/fileStore";
import { loadSession } from "@/store/remoteStore";

type VideoBlockData = {
  file?: { url?: string };
  caption?: string;
  name?: string;
  fileId?: string;
  size?: number;
  mime?: string;
  source?: "local" | "remote";
};

/** 正文里的视频。拖入或从 Word 导入后插入，不出现在块菜单里。 */
export class VideoBlockTool implements BlockTool {
  static get isReadOnlySupported() {
    return true;
  }

  private data: VideoBlockData;
  private wrapper = document.createElement("figure");
  private objectUrl = "";

  constructor({ data }: BlockToolConstructorOptions<VideoBlockData>) {
    this.data = data ?? {};
  }

  render() {
    this.wrapper.className = "cdx-video";
    this.wrapper.replaceChildren();
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    if (this.data.caption || this.data.name) {
      video.setAttribute("aria-label", this.data.caption || this.data.name || "");
    }
    const url = this.data.file?.url?.trim() ?? "";
    if (url) {
      video.src = url;
    } else if (this.data.fileId && this.data.name && this.data.source) {
      const stored: AttachmentData = {
        fileId: this.data.fileId,
        name: this.data.name,
        size: this.data.size ?? 0,
        mime: this.data.mime || "video/mp4",
        source: this.data.source,
        url: this.data.file?.url,
      };
      void loadAttachment(loadSession(), stored)
        .then((blob) => {
          this.objectUrl = URL.createObjectURL(blob);
          video.src = this.objectUrl;
        })
        .catch(() => undefined);
    }
    this.wrapper.append(video);
    return this.wrapper;
  }

  save() {
    return this.data;
  }

  validate(data: VideoBlockData) {
    return Boolean(data?.file?.url || data?.fileId);
  }

  destroy() {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = "";
    }
  }
}
