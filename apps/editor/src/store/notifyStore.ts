import type { EditorJsDocument } from "@myblog/shared";
import { request, type RemoteSession } from "@/store/remoteStore";

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
};

type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type NotifySnapshot = {
  openTodoCount: number;
  todos: NotifyTodo[];
};

const TODO_PAGE_KEY = "editor:todo-pages";

export async function fetchNotifySnapshot(session: RemoteSession): Promise<NotifySnapshot> {
  const [openTodo, todos] = await Promise.all([
    request<{ count: number }>(session, "GET", "/todos/open-count"),
    request<Page<NotifyTodo>>(session, "GET", "/todos?status=open&page=1&pageSize=30"),
  ]);
  return {
    openTodoCount: openTodo.count ?? todos.total ?? todos.items?.length ?? 0,
    todos: todos.items ?? [],
  };
}

export function markTodoDone(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/todos/${id}/done`);
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
