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
    "X-App-Code": AGENTS_BIZ_CODE,
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
      if (block.type === "todo") {
        const lines = (Array.isArray(data.items) ? data.items : [])
          .map((item) => {
            const row = item as { text?: string; done?: boolean; start?: string; end?: string };
            const text = String(row.text ?? "").trim();
            const start = String(row.start ?? "").trim();
            const end = String(row.end ?? "").trim();
            if (!text && !start && !end) {
              return "";
            }
            const mark = row.done ? "x" : " ";
            const range = start || end ? ` (${start || "?"}–${end || "?"})` : "";
            return `[${mark}] ${text}${range}`;
          })
          .filter(Boolean);
        return `${index + 1}. [todo] ${lines.join("; ").slice(0, 2000)}`;
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

/**
 * Nest 流式聊天（sync:false）。
 * `rag: true` 时网关会再调 `POST /agents/rag/search`，业务须同时开通 agents.chat 与 agents.rag。
 * 「添加到页面」仍用本地 Markdown → Editor.js。
 */
function pickConversationId(value: unknown): string | undefined {
  const id = typeof value === "string" ? value.trim() : "";
  return id || undefined;
}

export async function aiChat(
  input: {
    messages: AiChatMessage[];
    attachments?: AiAttachment[];
    document?: EditorJsDocument;
    system?: string;
    conversationId?: string | null;
    /** 根据 wiki 文档回答。只检索不聊天时不要走这里，改调 rag 接口。 */
    rag?: boolean;
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
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.rag ? { rag: true } : {}),
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
    const json = (await response.json().catch(() => null)) as Envelope<{ reply?: string; conversationId?: string }> | null;
    if (!response.ok || !json?.success) {
      throwFromEnvelope(response.status, json);
    }
    const reply = String(json.data?.reply ?? "").trim();
    if (!reply) {
      throw new Error("AI_EMPTY");
    }
    handlers?.onDelta?.(reply);
    return { reply, conversationId: pickConversationId(json.data?.conversationId) };
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
  let conversationId = pickConversationId(input.conversationId);

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
        return { reply: reply.trim() || reply, conversationId };
      }
      let ev: { delta?: string; reply?: string; error?: string; conversationId?: string };
      try {
        ev = JSON.parse(data) as { delta?: string; reply?: string; error?: string; conversationId?: string };
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
      conversationId = pickConversationId(ev.conversationId) ?? conversationId;
    }
  }

  const trimmed = reply.trim();
  if (!trimmed) {
    throw new Error("AI_EMPTY");
  }
  return { reply: trimmed, conversationId };
}

async function agentsJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await requireToken();
  let response: Response;
  try {
    response = await fetch(gatewayUrl(path), {
      ...init,
      headers: {
        ...agentsHeaders(token, "application/json"),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new Error("GATEWAY_UNAVAILABLE");
  }
  const text = await response.text().catch(() => "");
  if (!text) {
    if (response.ok) {
      return undefined as T;
    }
    throwFromEnvelope(response.status, null);
  }
  let json: Envelope<T> | null = null;
  try {
    json = JSON.parse(text) as Envelope<T>;
  } catch {
    json = null;
  }
  if (!response.ok || json?.success === false) {
    throwFromEnvelope(response.status, json);
  }
  return json?.data as T;
}

function asRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  }
  if (!data || typeof data !== "object") {
    return [];
  }
  const row = data as Record<string, unknown>;
  for (const key of ["items", "list", "conversations", "rows", "records"]) {
    if (Array.isArray(row[key])) {
      return asRows(row[key]);
    }
  }
  return [];
}

function asTime(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export type AgentConversationSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: number;
};

export type AgentConversationDetail = AgentConversationSummary & {
  messages: { id: string; role: "user" | "assistant"; content: string }[];
};

function mapSummary(row: Record<string, unknown>, fallback: string): AgentConversationSummary | null {
  const id = asText(row.id);
  if (!id) {
    return null;
  }
  const title = asText(row.title) || asText(row.name) || fallback;
  const preview =
    asText(row.preview) || asText(row.lastMessage) || asText(row.lastContent) || asText(row.summary);
  return {
    id,
    title,
    preview,
    updatedAt: asTime(row.updatedAt) || asTime(row.updated_at) || asTime(row.createdAt) || Date.now(),
  };
}

function mapMessages(data: unknown): AgentConversationDetail["messages"] {
  const source = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { messages?: unknown }).messages)
      ? ((data as { messages: unknown[] }).messages)
      : [];
  const out: AgentConversationDetail["messages"] = [];
  for (const item of source) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    const role = asText(row.role);
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const content = asText(row.content);
    if (!content) {
      continue;
    }
    out.push({
      id: asText(row.id) || `${role}-${out.length}`,
      role,
      content,
    });
  }
  return out;
}

export async function listAgentConversations(untitled: string): Promise<AgentConversationSummary[]> {
  const data = await agentsJson<unknown>("/agents/conversations?page=1&pageSize=50");
  return asRows(data)
    .map((row) => mapSummary(row, untitled))
    .filter((item): item is AgentConversationSummary => Boolean(item))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getAgentConversation(id: string, untitled: string): Promise<AgentConversationDetail> {
  const data = await agentsJson<unknown>(`/agents/conversations/${encodeURIComponent(id)}`);
  const row = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const summary = mapSummary({ ...row, id: asText(row.id) || id }, untitled) ?? {
    id,
    title: untitled,
    preview: "",
    updatedAt: Date.now(),
  };
  const messages = mapMessages(data);
  const last = [...messages].reverse().find((item) => item.role === "assistant") ?? messages.at(-1);
  return {
    ...summary,
    preview: summary.preview || last?.content.replace(/\s+/g, " ").slice(0, 72) || "",
    messages,
  };
}

export async function deleteAgentConversation(id: string): Promise<void> {
  await agentsJson<unknown>(`/agents/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}
