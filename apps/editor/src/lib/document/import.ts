import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";
import { htmlToBlocks } from "./htmlToBlocks";
import { fileExtension, fileKind, videoMime } from "./fileKinds";
import { readZip } from "./zip";
import { t } from "@/i18n";
import { markdownToEditorBlocks } from "@/lib/ai/markdown";

export const WORD_ACCEPT =
  ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 空行分段，段内换行保留为 <br> */
function textToBlocks(text: string): EditorJsBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => ({ type: "paragraph", data: { text: escapeHtml(part).replace(/\n/g, "<br>") } }));
}

/** 拖进来直接转成正文的文件：Markdown、纯文本；其他类型返回 null */
export async function readInsertable(file: File): Promise<EditorJsBlock[] | null> {
  const ext = fileExtension(file.name);
  if (ext === "md" || ext === "markdown") {
    return markdownToEditorBlocks(await file.text());
  }
  if (ext === "txt" || (!ext && file.type.startsWith("text/plain"))) {
    return textToBlocks(await file.text());
  }
  return null;
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || t("document.importedDocument");
}

function zipPath(base: string, target: string): string {
  const raw = target.replace(/\\/g, "/");
  const parts = (raw.startsWith("/") ? raw.slice(1) : `${base}/${raw}`).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      stack.pop();
    } else {
      stack.push(part);
    }
  }
  return stack.join("/");
}

/** mammoth 不抽出视频。从 docx 压缩包里按文档引用顺序取出 word/media 下的视频。 */
async function extractDocxVideos(buffer: ArrayBuffer): Promise<File[]> {
  const files = await readZip(buffer, (name) => {
    const lower = name.toLowerCase();
    return lower === "word/_rels/document.xml.rels" || lower === "word/document.xml" || fileKind(lower) === "video";
  });
  const rels = new TextDecoder().decode(files.get("word/_rels/document.xml.rels") ?? new Uint8Array());
  const doc = new TextDecoder().decode(files.get("word/document.xml") ?? new Uint8Array());
  const byId = new Map<string, string>();
  for (const tag of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const attrs = tag[1] ?? "";
    const id = /(?:^|\s)Id="([^"]+)"/.exec(attrs)?.[1];
    const type = /(?:^|\s)Type="([^"]+)"/.exec(attrs)?.[1] ?? "";
    const target = /(?:^|\s)Target="([^"]+)"/.exec(attrs)?.[1];
    if (!id || !target || /TargetMode="External"/.test(attrs)) {
      continue;
    }
    if (!/video|\/media$/i.test(type) && fileKind(target) !== "video") {
      continue;
    }
    if (fileKind(target) !== "video") {
      continue;
    }
    byId.set(id, zipPath("word", target));
  }
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (path: string) => {
    if (!seen.has(path) && files.has(path)) {
      seen.add(path);
      ordered.push(path);
    }
  };
  for (const id of doc.matchAll(/\br:(?:id|embed|link)="([^"]+)"/g)) {
    const path = byId.get(id[1] ?? "");
    if (path) {
      push(path);
    }
  }
  for (const name of files.keys()) {
    if (fileKind(name) === "video") {
      push(name);
    }
  }
  return ordered.flatMap((path) => {
    const bytes = files.get(path);
    if (!bytes?.byteLength) {
      return [];
    }
    const name = path.split("/").pop() || "video.mp4";
    return [new File([new Uint8Array(bytes)], name, { type: videoMime(name) })];
  });
}

async function wordToHtml(file: File, withVideos: boolean): Promise<{ html: string; images: File[]; videos: File[] }> {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".docx")) {
    if (lower.endsWith(".doc")) {
      throw new Error(t("document.legacyDoc"));
    }
    throw new Error(t("document.wordOnly"));
  }
  const buffer = await file.arrayBuffer();
  const videos = withVideos ? await extractDocxVideos(buffer).catch(() => []) : [];
  const { default: mammoth } = await import("mammoth/mammoth.browser.js");
  const images: File[] = [];
  const result = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"],
      convertImage: mammoth.images.imgElement(async (image) => {
        if (!/^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/.test(image.contentType)) {
          return { src: "" };
        }
        const buffer = await image.readAsArrayBuffer();
        const subtype = image.contentType.split("/")[1]?.toLowerCase() || "png";
        const ext = subtype === "jpeg" ? "jpg" : subtype === "svg+xml" ? "svg" : subtype;
        const index = images.length;
        images.push(new File([buffer], `image-${index + 1}.${ext}`, { type: image.contentType || "image/png" }));
        return { src: `import-image://${index}` };
      }),
    },
  );
  return { html: result.value, images, videos };
}

function mediaBlock(type: "image" | "video", uploaded: UploadedImage, caption = ""): EditorJsBlock {
  return {
    type,
    data: {
      file: { url: uploaded.url ?? "" },
      caption,
      name: uploaded.name,
      fileId: uploaded.fileId,
      size: uploaded.size,
      mime: uploaded.mime,
      source: uploaded.source,
    },
  };
}

export type ImportMode = "replace" | "append" | "prepend";

export type ImportedWord = { name: string; blocks: EditorJsDocument["blocks"] };

/** 上传后的图片或视频，用来替换导入时的占位 */
export type UploadedImage = {
  url?: string;
  fileId: string;
  name: string;
  size: number;
  mime: string;
  source: "local" | "remote";
};

const MAX_TABLE_ROWS = 300;
const MAX_TABLE_COLS = 30;

function escapeCell(value: unknown): string {
  return escapeHtml(String(value ?? "")).replace(/\n/g, "<br>");
}

/** 每个工作表转成一个表格块；多个工作表时前面加工作表名作小标题 */
export async function importSpreadsheet(file: File): Promise<ImportedWord> {
  const XLSX = await import("xlsx");
  const workbook =
    fileExtension(file.name) === "csv"
      ? XLSX.read(await file.text(), { type: "string" })
      : XLSX.read(await file.arrayBuffer(), { type: "array" });
  const blocks: EditorJsDocument["blocks"] = [];
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false })
      .slice(0, MAX_TABLE_ROWS);
    if (rows.length === 0) {
      continue;
    }
    const width = Math.min(MAX_TABLE_COLS, Math.max(...rows.map((row) => row.length)));
    if (workbook.SheetNames.length > 1) {
      blocks.push({ type: "header", data: { text: escapeHtml(sheetName), level: 3 } });
    }
    blocks.push({
      type: "table",
      data: {
        withHeadings: true,
        content: rows.map((row) => Array.from({ length: width }, (_, index) => escapeCell(row[index]))),
      },
    });
  }
  if (blocks.length === 0) {
    throw new Error(t("document.emptyImport"));
  }
  return { name: baseName(file.name), blocks };
}

/** 拖入的视频：确认插入后上传，再放进正文。 */
export async function importVideo(file: File, upload: (file: File) => Promise<UploadedImage>): Promise<ImportedWord> {
  return { name: baseName(file.name), blocks: [mediaBlock("video", await upload(file))] };
}

export async function importWord(
  file: File,
  uploadImage?: (file: File) => Promise<UploadedImage>,
): Promise<ImportedWord> {
  const { html, images, videos } = await wordToHtml(file, Boolean(uploadImage));
  const blocks = htmlToBlocks(html) as EditorJsDocument["blocks"];
  const next: EditorJsDocument["blocks"] = [];
  for (const block of blocks) {
    const url = block.type === "image" ? String((block.data?.file as { url?: string } | undefined)?.url ?? "") : "";
    const marker = url.startsWith("import-image://") ? Number(url.slice("import-image://".length)) : NaN;
    if (!Number.isInteger(marker)) {
      next.push(block);
      continue;
    }
    const image = images[marker];
    if (!image || !uploadImage) {
      continue;
    }
    next.push(mediaBlock("image", await uploadImage(image), String(block.data?.caption ?? "")));
  }
  if (uploadImage) {
    for (const video of videos) {
      next.push(mediaBlock("video", await uploadImage(video)));
    }
  }
  if (next.length === 0) {
    throw new Error(t("document.emptyImport"));
  }
  return { name: baseName(file.name), blocks: next };
}

/**
 * 覆盖：没有标题时用文件名补一个；插入头部：放在页面标题之后，标题保持不变。
 */
export function mergeImported(mode: ImportMode, current: EditorJsDocument, imported: ImportedWord): EditorJsDocument {
  const blocks = current.blocks ?? [];
  let next: EditorJsDocument["blocks"];
  if (mode === "replace") {
    next =
      imported.blocks[0]?.type === "header"
        ? imported.blocks
        : [{ type: "header", data: { text: imported.name, level: 1 } }, ...imported.blocks];
  } else if (mode === "append") {
    next = [...blocks, ...imported.blocks];
  } else {
    const titled = blocks[0]?.type === "header" ? 1 : 0;
    next = [...blocks.slice(0, titled), ...imported.blocks, ...blocks.slice(titled)];
  }
  return { ...current, time: Date.now(), blocks: next };
}
