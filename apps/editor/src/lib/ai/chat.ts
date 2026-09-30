import type { AiAttachment, AiChatMessage } from "@myblog/shared";
import type EditorJS from "@editorjs/editorjs";
import { t } from "@/i18n";

export type LocalAttachment =
  | { id: string; kind: "image"; name: string; url: string }
  | { id: string; kind: "text"; name: string; text: string };

export type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  quote?: string;
  attachments?: LocalAttachment[];
};

const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
]);

export const AI_FILE_ACCEPT =
  "image/*,.txt,.md,.markdown,.json,.csv,.log,.ts,.tsx,.js,.jsx,.css,.html,text/plain,application/json";

export function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/") || file.type === "application/json") {
    return true;
  }
  const lower = file.name.toLowerCase();
  return [...TEXT_EXTS].some((ext) => lower.endsWith(ext));
}

export function downloadTextAttachment(file: Extract<LocalAttachment, { kind: "text" }>) {
  const blob = new Blob([file.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = file.name || "attachment.txt";
  link.rel = "noopener";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function aiErrorMessage(message: string): string {
  if (message === "UNAUTHORIZED") {
    return t("ai.sessionExpired");
  }
  if (message === "AI_NOT_CONFIGURED" || message === "FORBIDDEN") {
    return t("ai.notConfigured");
  }
  if (message === "GATEWAY_UNAVAILABLE" || message === "AI_FAILED") {
    return t("ai.gatewayUnavailable");
  }
  if (message === "AI_TIMEOUT") {
    return t("ai.timeout");
  }
  if (message === "AI_EMPTY_BLOCKS" || message === "AI_BAD_JSON") {
    return t("ai.convertFailed");
  }
  if (message === "AI_EMPTY_REPLY" || message === "AI_EMPTY") {
    return t("ai.emptyReply");
  }
  if (message === "AI_EMPTY_PROMPT") {
    return t("ai.emptyQuestion");
  }
  if (message.startsWith("AI_UPSTREAM_")) {
    return t("ai.upstreamError");
  }
  return message;
}

export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function currentBlockIndex(editor: EditorJS | null, fallback: number): number {
  if (!editor) {
    return fallback;
  }
  try {
    const index = editor.blocks.getCurrentBlockIndex();
    if (typeof index === "number" && index >= 0) {
      return index;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

export function toApiMessages(list: ChatBubble[]): AiChatMessage[] {
  return list.map((item) => ({ role: item.role, content: item.content }));
}

export function toApiAttachments(list: LocalAttachment[]): AiAttachment[] {
  return list.map((item) =>
    item.kind === "image"
      ? { kind: "image", name: item.name, url: item.url }
      : { kind: "text", name: item.name, text: item.text },
  );
}

export function buildUserChatContent(input: {
  text: string;
  quote?: string;
  hasAttachments: boolean;
}): string {
  const text = input.text.trim();
  if (input.quote?.trim()) {
    const [quoteLabel, askLabel] = [t("ai.selectedText"), t("ai.myQuestion")];
    return `${quoteLabel}\n${input.quote.trim()}\n\n${askLabel}\n${text || t("ai.selectionPrompt")}`;
  }
  return text || (input.hasAttachments ? t("ai.attachmentsPrompt") : "");
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error(`无法读取：${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** 解析本地文件为附件；图片转成 data URL，文本读入内存 */
export async function parseLocalFiles(files: File[]): Promise<LocalAttachment[]> {
  const out: LocalAttachment[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      if (file.size > 4_000_000) {
        throw new Error(t("ai.imageTooLarge", { name: file.name }));
      }
      const url = await readDataUrl(file);
      out.push({ id: `${Date.now()}-${file.name}`, kind: "image", name: file.name, url });
      continue;
    }
    if (isTextFile(file)) {
      if (file.size > 200_000) {
        throw new Error(t("ai.textAttachmentTooLarge", { name: file.name }));
      }
      const text = await file.text();
      out.push({ id: `${Date.now()}-${file.name}`, kind: "text", name: file.name, text });
      continue;
    }
    throw new Error(t("ai.unsupportedFile", { name: file.name }));
  }
  return out;
}
