import type { EditorJsDocument } from "@myblog/shared";
import { request, type RemoteSession } from "@/store/remoteStore";

export type NotifyNotice = {
  id: string;
  title: string;
  content: string;
  category: string;
  source: string;
  readAt: string | null;
  createdAt: string;
};

export type NotifyTodo = {
  id: string;
  title: string;
  content: string;
  category: string;
  source: string;
  status: "open" | "done" | "cancelled";
  dueAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  data?: Record<string, unknown> | null;
};

type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type NotifySnapshot = {
  openTodoCount: number;
  unreadNoticeCount: number;
  todos: NotifyTodo[];
  notices: NotifyNotice[];
};

export type UpsertTodoInput = {
  title: string;
  content: string;
  category?: string;
  source?: string;
  dueAt?: string | null;
  data?: Record<string, unknown> | null;
};

const TODO_PAGE_KEY = "editor:todo-pages";

export async function fetchNotifySnapshot(session: RemoteSession): Promise<NotifySnapshot> {
  const [openTodo, unreadNotice, todos, notices] = await Promise.all([
    request<{ count: number }>(session, "GET", "/wiki/todos/open-count"),
    request<{ count: number }>(session, "GET", "/wiki/notifications/unread-count"),
    request<Page<NotifyTodo>>(session, "GET", "/wiki/todos?status=open&page=1&pageSize=30"),
    request<Page<NotifyNotice>>(session, "GET", "/wiki/notifications?unread=1&page=1&pageSize=20"),
  ]);
  return {
    openTodoCount: openTodo.count ?? todos.total ?? todos.items?.length ?? 0,
    unreadNoticeCount: unreadNotice.count ?? notices.total ?? notices.items?.length ?? 0,
    todos: todos.items ?? [],
    notices: notices.items ?? [],
  };
}

export function createTodo(session: RemoteSession, input: UpsertTodoInput): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", "/wiki/todos", {
    title: input.title,
    content: input.content,
    category: input.category ?? "wiki",
    source: input.source ?? "wiki",
    dueAt: input.dueAt ?? null,
    data: input.data ?? null,
  });
}

export function updateTodo(session: RemoteSession, id: string, input: UpsertTodoInput): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "PATCH", `/wiki/todos/${id}`, {
    title: input.title,
    content: input.content,
    category: input.category ?? "wiki",
    dueAt: input.dueAt ?? null,
    data: input.data ?? null,
  });
}

export function markTodoDone(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/done`);
}

export function markNoticeRead(session: RemoteSession, id: string): Promise<NotifyNotice> {
  return request<NotifyNotice>(session, "POST", `/wiki/notifications/${id}/read`);
}

export function markAllNoticesRead(session: RemoteSession): Promise<{ updated: number }> {
  return request<{ updated: number }>(session, "POST", "/wiki/notifications/read-all");
}

/** 把远程待办转成 wiki 页初始正文：标题 + 任务说明，方便继续填写 */
export function documentFromTodo(todo: NotifyTodo): EditorJsDocument {
  const title = todo.title.trim();
  const content = todo.content.trim();
  const blocks: EditorJsDocument["blocks"] = [
    {
      type: "header",
      data: { text: title, level: 1 },
    },
  ];
  if (content) {
    for (const line of content.split(/\n+/).map((part) => part.trim()).filter(Boolean)) {
      blocks.push({ type: "paragraph", data: { text: line } });
    }
  } else {
    blocks.push({ type: "paragraph", data: { text: "" } });
  }
  return {
    time: Date.now(),
    version: "2.30.7",
    blocks,
  };
}

export function readTodoPageMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TODO_PAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [todoId, pageId] of Object.entries(parsed)) {
      if (typeof pageId === "string" && pageId) out[todoId] = pageId;
    }
    return out;
  } catch {
    return {};
  }
}

export function rememberTodoPage(todoId: string, pageId: string): void {
  const next = { ...readTodoPageMap(), [todoId]: pageId };
  localStorage.setItem(TODO_PAGE_KEY, JSON.stringify(next));
}

export function pageIdFromTodo(todo: NotifyTodo): string | null {
  const fromData = todo.data?.pageId;
  if (typeof fromData === "string" && fromData.trim()) {
    return fromData.trim();
  }
  return readTodoPageMap()[todo.id] ?? null;
}
