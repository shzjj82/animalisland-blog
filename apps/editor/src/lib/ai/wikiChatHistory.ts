import { uid, type ChatBubble } from "@/lib/ai/chat";

export type WikiThread = {
  id: string;
  updatedAt: number;
  title: string;
  bubbles: ChatBubble[];
};

const THREADS_KEY = "editor:wiki-chat-threads";
const ACTIVE_KEY = "editor:wiki-chat-active";
const MAX_THREADS = 30;

function compactBubbles(bubbles: ChatBubble[]): ChatBubble[] {
  return bubbles.map((item) => ({
    ...item,
    attachments: item.attachments?.map((file) => (file.kind === "image" ? { ...file, url: "" } : file)),
  }));
}

function threadTitle(bubbles: ChatBubble[], fallback: string): string {
  const first = bubbles.find((item) => item.role === "user" && !item.notice && item.content.trim());
  const text = first?.content.trim() ?? "";
  if (!text) {
    return fallback;
  }
  return text.length > 36 ? `${text.slice(0, 36)}…` : text;
}

export function loadThreads(): WikiThread[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(THREADS_KEY) ?? "[]") as WikiThread[];
    return Array.isArray(parsed) ? parsed.filter((item) => item?.id && Array.isArray(item.bubbles)) : [];
  } catch {
    return [];
  }
}

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

export function upsertThread(id: string | null, bubbles: ChatBubble[], untitled: string): string | null {
  const hasUser = bubbles.some((item) => item.role === "user" && !item.notice);
  if (!hasUser) {
    return id;
  }
  const threadId = id || uid();
  const next: WikiThread = {
    id: threadId,
    updatedAt: Date.now(),
    title: threadTitle(bubbles, untitled),
    bubbles: compactBubbles(bubbles),
  };
  const rest = loadThreads().filter((item) => item.id !== threadId);
  localStorage.setItem(THREADS_KEY, JSON.stringify([next, ...rest].slice(0, MAX_THREADS)));
  saveActiveThreadId(threadId);
  return threadId;
}

export function deleteThread(id: string) {
  localStorage.setItem(THREADS_KEY, JSON.stringify(loadThreads().filter((item) => item.id !== id)));
  if (loadActiveThreadId() === id) {
    saveActiveThreadId(null);
  }
}

export function findThread(id: string): WikiThread | undefined {
  return loadThreads().find((item) => item.id === id);
}

export function threadPreview(thread: WikiThread): string {
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
