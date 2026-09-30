import type { EditorJsDocument } from "@myblog/shared";
import { loadAttachment, type AttachmentData } from "@/store/fileStore";
import type { RemoteSession } from "@/store/remoteStore";
import { fileExtension } from "./fileKinds";
import { importSpreadsheet, importWord } from "./import";
import { documentText } from "./search";

const TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "log",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "h",
  "cpp",
  "cs",
  "rb",
  "php",
  "swift",
  "kt",
  "sql",
  "sh",
  "yml",
  "yaml",
  "xml",
  "vue",
  "scss",
  "less",
  "toml",
  "ini",
]);

/** 把上传的文档读成纯文本。图片和无法解析的格式返回空字符串。 */
export async function readFileText(file: File): Promise<string> {
  const ext = fileExtension(file.name);
  if (ext === "docx") {
    const imported = await importWord(file);
    return documentText({ blocks: imported.blocks });
  }
  if (ext === "xlsx" || ext === "xls" || ext === "csv") {
    const imported = await importSpreadsheet(file);
    return documentText({ blocks: imported.blocks });
  }
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXT.has(ext)) {
    const text = await file.text();
    return text.slice(0, 200_000);
  }
  return "";
}

const PER_FILE = 4000;
const PER_PAGE = 12_000;

function isAttachment(data: unknown): data is AttachmentData {
  const value = data as Partial<AttachmentData> | undefined;
  return typeof value?.fileId === "string" && Boolean(value.fileId) && typeof value?.name === "string";
}

/** 页面里已挂附件的正文。读不到的文件仍只靠文件名（由页面索引带上）。 */
export async function attachmentBodyText(session: RemoteSession | null, body: EditorJsDocument): Promise<string> {
  const chunks: string[] = [];
  let used = 0;
  for (const block of body.blocks ?? []) {
    if (block.type !== "attachment" || used >= PER_PAGE) {
      continue;
    }
    if (!isAttachment(block.data)) {
      continue;
    }
    try {
      const blob = await loadAttachment(session, block.data);
      const file = new File([blob], block.data.name, { type: block.data.mime || blob.type });
      const text = (await readFileText(file)).trim().slice(0, PER_FILE);
      if (!text) {
        continue;
      }
      chunks.push(`附件 ${block.data.name}\n${text}`);
      used += text.length;
    } catch {
      /* 文件名已经在页面正文索引里 */
    }
  }
  return chunks.join("\n");
}
