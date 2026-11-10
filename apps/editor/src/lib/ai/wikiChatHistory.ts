import { uid, type ChatBubble } from "@/lib/ai/chat";
import type { AgentConversationDetail, AgentConversationSummary } from "@/lib/ai/client";

export type WikiThread = {
  id: string;
  updatedAt: number;
  title: string;
  preview?: string;
  bubbles: ChatBubble[];
};

const ACTIVE_KEY = "editor:wiki-chat-active";

export function loadActiveThreadId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function saveActiveThreadId(id: string | null) {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

export function summaryToThread(item: AgentConversationSummary): WikiThread {
  return {
    id: item.id,
    updatedAt: item.updatedAt,
    title: item.title,
    preview: item.preview,
    bubbles: [],
  };
}

export function detailToThread(item: AgentConversationDetail): WikiThread {
  return {
    id: item.id,
    updatedAt: item.updatedAt,
    title: item.title,
    preview: item.preview,
    bubbles: item.messages.map((message) => ({
      id: message.id || uid(),
      role: message.role,
      content: message.content,
    })),
  };
}

export function threadPreview(thread: WikiThread): string {
  if (thread.preview?.trim()) {
    return thread.preview.replace(/\s+/g, " ").trim().slice(0, 72);
  }
  const last = [...thread.bubbles].reverse().find((item) => item.role === "assistant" && item.content.trim());
  return (last?.content ?? "").replace(/\s+/g, " ").trim().slice(0, 72);
}

export type HistoryGroupId = "today" | "yesterday" | "week" | "older";

export function historyGroup(updatedAt: number, now = Date.now()): HistoryGroupId {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  if (updatedAt >= today) {
    return "today";
  }
  if (updatedAt >= today - 86_400_000) {
    return "yesterday";
  }
  if (updatedAt >= today - 7 * 86_400_000) {
    return "week";
  }
  return "older";
}
