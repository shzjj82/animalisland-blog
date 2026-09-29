import type { AiAttachment, AiChatMessage, AiChatResult, AiToEditorResult, EditorJsDocument } from "@myblog/shared";
import { t } from "@/i18n";

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new Error(t("common.aiServiceUnavailable"));
  }
  const json = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok && !json?.message) {
    throw new Error(t("common.aiServiceUnavailable"));
  }
  if (!json?.success) {
    throw new Error(json?.message || t("common.requestFailed", { status: response.status }));
  }
  return json.data as T;
}

export function aiStatus(): Promise<{ enabled: boolean }> {
  return request("/api/ai/status", { method: "GET" });
}

export function aiChat(
  input: { messages: AiChatMessage[]; attachments?: AiAttachment[]; document?: EditorJsDocument },
  signal?: AbortSignal,
): Promise<AiChatResult> {
  return request("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}

export function aiToEditor(
  input: { messages: AiChatMessage[]; attachments?: AiAttachment[]; document?: EditorJsDocument; apply?: "append" | "replace" },
  signal?: AbortSignal,
): Promise<AiToEditorResult> {
  return request("/api/ai/to-editor", {
    method: "POST",
    body: JSON.stringify(input),
    signal,
  });
}
