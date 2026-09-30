import type { AiAttachment, AiChatMessage, AiChatResult, EditorJsDocument } from "@myblog/shared";
import { gatewayUrl, loadSession, prepareSession, WIKI_APP_CODE } from "@/store/remoteStore";
import { t } from "@/i18n";

/** Editor 智能体业务码：与登录/文档一致，用 wiki（博客用 blog） */
const AGENTS_BIZ_CODE = WIKI_APP_CODE;

type Envelope<T> = {
  success?: boolean;
  message?: string;
  code?: string | number;
  data?: T;
};

export type AiStatusResult = {
  enabled: boolean;
  model?: string | null;
  /** UNAUTHORIZED | AI_NOT_CONFIGURED | GATEWAY_UNAVAILABLE | FORBIDDEN | … */
  reason?: string;
};

async function requireToken(): Promise<string> {
  const session = loadSession();
  if (!session) {
    throw new Error("UNAUTHORIZED");
  }
  const ready = await prepareSession(session);
  if (!ready?.token) {
    throw new Error("UNAUTHORIZED");
  }
  return ready.token;
}

function agentsHeaders(token: string, accept: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "X-Biz-Code": AGENTS_BIZ_CODE,
    Accept: accept,
    "Content-Type": "application/json",
  };
}

function summarizeDocument(document?: EditorJsDocument): string {
  const blocks = document?.blocks ?? [];
  if (blocks.length === 0) {
    return "（当前正文为空）";
  }
  return blocks
    .slice(0, 80)
    .map((block, index) => {
      const data = block.data ?? {};
      if (block.type === "header") {
        return `${index + 1}. [header h${data.level ?? 2}] ${String(data.text ?? "")}`;
      }
      if (block.type === "paragraph") {
        return `${index + 1}. [paragraph] ${String(data.text ?? "").slice(0, 240)}`;
      }
      if (block.type === "list") {
        return `${index + 1}. [list]`;
      }
      if (block.type === "image") {
        const file = data.file as { url?: string } | undefined;
        return `${index + 1}. [image] ${file?.url ?? ""}`;
      }
      return `${index + 1}. [${block.type}]`;
    })
    .join("\n");
}

function withDocumentContext(
  messages: AiChatMessage[],
  document?: EditorJsDocument,
): AiChatMessage[] {
  if (!document) {
    return messages;
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return messages;
  }
  const content = `${last.content}\n\n——\n当前 Editor.js 正文摘要：\n${summarizeDocument(document)}`.slice(
    0,
    8000,
  );
  return [...messages.slice(0, -1), { ...last, content }];
}

function throwFromEnvelope(status: number, json: Envelope<unknown> | null): never {
  const message = String(json?.message ?? json?.code ?? "").trim();
  if (status === 401 || message === "UNAUTHORIZED") {
    throw new Error("UNAUTHORIZED");
  }
  if (status === 403) {
    throw new Error(message || "FORBIDDEN");
  }
  if (message) {
    throw new Error(message);
  }
  throw new Error(t("common.requestFailed", { status }));
}

/**
 * 先看本地登录态；已登录再问 Nest `/agents/chat/status`。
 * 网络失败返回 reason，不再抛「本地写作接口请重启」。
 */
export async function aiStatus(): Promise<AiStatusResult> {
  const session = loadSession();
  if (!session?.token && !session?.refreshToken) {
    return { enabled: false, reason: "UNAUTHORIZED" };
  }
  const ready = session ? await prepareSession(session) : null;
  if (!ready?.token) {
    return { enabled: false, reason: "UNAUTHORIZED" };
  }

  let response: Response;
  try {
    response = await fetch(gatewayUrl("/agents/chat/status"), {
      method: "GET",
      headers: agentsHeaders(ready.token, "application/json"),
    });
  } catch {
    return { enabled: false, reason: "GATEWAY_UNAVAILABLE" };
  }

  const json = (await response.json().catch(() => null)) as Envelope<{
    enabled?: boolean;
    model?: string | null;
  }> | null;

  if (response.status === 401) {
    return { enabled: false, reason: "UNAUTHORIZED" };
  }
  if (response.status === 403) {
    return { enabled: false, reason: String(json?.message ?? "FORBIDDEN") };
  }
  if (!response.ok || !json?.success) {
    const message = String(json?.message ?? "").trim();
    return {
      enabled: false,
      reason: message || (response.status === 503 ? "AI_NOT_CONFIGURED" : "GATEWAY_UNAVAILABLE"),
    };
  }

  const enabled = Boolean(json.data?.enabled);
  return {
    enabled,
    model: json.data?.model ?? null,
    reason: enabled ? undefined : "AI_NOT_CONFIGURED",
  };
}

export type AiChatStreamHandlers = {
  onDelta?: (delta: string) => void;
};

/** Nest 流式聊天（sync:false）；「添加到页面」仍用本地 Markdown → Editor.js */
export async function aiChat(
  input: {
    messages: AiChatMessage[];
    attachments?: AiAttachment[];
    document?: EditorJsDocument;
    system?: string;
  },
  signal?: AbortSignal,
  handlers?: AiChatStreamHandlers,
): Promise<AiChatResult> {
  const token = await requireToken();
  const messages = withDocumentContext(input.messages, input.document);

  let response: Response;
  try {
    response = await fetch(gatewayUrl("/agents/chat"), {
      method: "POST",
      headers: agentsHeaders(token, "text/event-stream"),
      body: JSON.stringify({
        sync: false,
        messages,
        attachments: input.attachments,
        system: input.system,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    throw new Error("GATEWAY_UNAVAILABLE");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const json = (await response.json().catch(() => null)) as Envelope<{ reply?: string }> | null;
    if (!response.ok || !json?.success) {
      throwFromEnvelope(response.status, json);
    }
    const reply = String(json.data?.reply ?? "").trim();
    if (!reply) {
      throw new Error("AI_EMPTY");
    }
    handlers?.onDelta?.(reply);
    return { reply };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let json: Envelope<unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Envelope<unknown>) : null;
    } catch {
      json = null;
    }
    throwFromEnvelope(response.status, json);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("GATEWAY_UNAVAILABLE");
  }

  const dec = new TextDecoder();
  let buf = "";
  let reply = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      const line = block.split("\n").find((item) => item.startsWith("data:"));
      if (!line) {
        continue;
      }
      const data = line.slice(5).trim();
      if (data === "[DONE]") {
        return { reply: reply.trim() || reply };
      }
      let ev: { delta?: string; reply?: string; error?: string };
      try {
        ev = JSON.parse(data) as { delta?: string; reply?: string; error?: string };
      } catch {
        continue;
      }
      if (ev.error) {
        throw new Error(ev.error);
      }
      if (typeof ev.delta === "string" && ev.delta) {
        reply += ev.delta;
        handlers?.onDelta?.(ev.delta);
      }
      if (typeof ev.reply === "string" && ev.reply) {
        reply = ev.reply;
      }
    }
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    throw new Error("AI_EMPTY");
  }
  return { reply: trimmed };
}
