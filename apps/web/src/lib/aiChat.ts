import type { AiAttachment, AiChatMessage } from "@myblog/shared";
import type EditorJS from "@editorjs/editorjs";
import { api } from "@/lib/api";

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
  if (message === "AI_NOT_CONFIGURED") {
    return "还没配 AI。在仓库根目录 .env 里填 AI_API_KEY。";
  }
  if (message === "AI_TIMEOUT") {
    return "AI 超时了，换短一点再说。";
  }
  if (message === "AI_EMPTY_BLOCKS" || message === "AI_BAD_JSON") {
    return "没能整理成可用正文，换个说法或稍后再试。";
  }
  if (message === "AI_EMPTY_REPLY") {
    return "模型没有回复，稍后再试。";
  }
  if (message === "AI_EMPTY_PROMPT") {
    return "先写点问题再发送。";
  }
  if (message.startsWith("AI_UPSTREAM_")) {
    return "上游 AI 接口报错，检查密钥与模型配置。";
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
    return `【划选原文】\n${input.quote.trim()}\n\n【我的问题】\n${text || "请针对上面划选内容给出改写/补充建议。"}`;
  }
  return text || (input.hasAttachments ? "请结合我上传的附件聊聊怎么写。" : "");
}

/** 解析本地文件为附件；图片走上传，文本读入内存 */
export async function parseLocalFiles(files: File[]): Promise<LocalAttachment[]> {
  const out: LocalAttachment[] = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      const { url } = await api.upload(file);
      out.push({ id: `${Date.now()}-${file.name}`, kind: "image", name: file.name, url });
      continue;
    }
    if (isTextFile(file)) {
      if (file.size > 200_000) {
        throw new Error(`文本附件太大：${file.name}`);
      }
      const text = await file.text();
      out.push({ id: `${Date.now()}-${file.name}`, kind: "text", name: file.name, text });
      continue;
    }
    throw new Error(`暂不支持：${file.name}`);
  }
  return out;
}
