import type { EditorJsBlock, EditorJsDocument } from "./editor.js";

export type AiAttachment =
  | { kind: "image"; name: string; url: string }
  | { kind: "text"; name: string; text: string };

export type AiChatRole = "user" | "assistant";

export type AiChatMessage = {
  role: AiChatRole;
  content: string;
};

export type AiChatInput = {
  messages: AiChatMessage[];
  attachments?: AiAttachment[];
  document?: EditorJsDocument;
};

export type AiChatResult = {
  reply: string;
};

export type AiToEditorInput = {
  messages: AiChatMessage[];
  attachments?: AiAttachment[];
  document?: EditorJsDocument;
  apply?: "append" | "replace";
};

export type AiToEditorResult = {
  blocks: EditorJsBlock[];
  apply: "append" | "replace";
  note?: string;
};

/** @deprecated 旧单次协助接口，保留类型兼容 */
export const AI_ASSIST_MODES = ["draft", "continue", "revise", "chat"] as const;
export type AiAssistMode = (typeof AI_ASSIST_MODES)[number];
export type AiAssistInput = {
  mode: AiAssistMode;
  prompt: string;
  document?: EditorJsDocument;
  attachments?: AiAttachment[];
  apply?: "append" | "replace";
};
export type AiAssistResult = AiToEditorResult;

export function isAiAssistMode(value: string): value is AiAssistMode {
  return (AI_ASSIST_MODES as readonly string[]).includes(value);
}

export function isAiChatRole(value: string): value is AiChatRole {
  return value === "user" || value === "assistant";
}
