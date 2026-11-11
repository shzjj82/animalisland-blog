import type { EditorJsDocument } from "@myblog/shared";
import { request, type RemoteSession } from "@/store/remoteStore";

export type WikiTodoPage = {
  id: string;
  slug?: string;
  title?: string;
  appCode?: string;
  kind?: string;
};

export type NotifyNotice = {
  id: string;
  title: string;
  content: string;
  category: string;
  source: string;
  readAt: string | null;
  createdAt: string;
  data?: Record<string, unknown> | null;
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
  /** 服务端从 data.page 提升上来，跳转优先用它 */
  page?: WikiTodoPage | null;
  data?: {
    pageId?: string;
    page?: WikiTodoPage;
    legacyWithoutPage?: boolean;
    localItemId?: string;
    start?: string | null;
    end?: string | null;
  } | null;
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
  /** 新建必填。更新时带上表示改绑页面 */
  pageId?: string;
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
  const pageId = input.pageId?.trim() ?? "";
  if (!pageId) {
    return Promise.reject(new Error("pageId 必填且须为有效文档 id"));
  }
  return request<NotifyTodo>(session, "POST", "/wiki/todos", {
    title: input.title,
    content: input.content,
    pageId,
    category: input.category ?? "page",
    source: input.source ?? "wiki",
    dueAt: input.dueAt ?? null,
    ...(input.data ? { data: input.data } : {}),
  });
}

export function updateTodo(session: RemoteSession, id: string, input: UpsertTodoInput): Promise<NotifyTodo> {
  const pageId = input.pageId?.trim() ?? "";
  return request<NotifyTodo>(session, "PATCH", `/wiki/todos/${id}`, {
    title: input.title,
    content: input.content,
    category: input.category ?? "page",
    dueAt: input.dueAt ?? null,
    ...(pageId ? { pageId } : {}),
    ...(input.data ? { data: input.data } : {}),
  });
}

/** 给还没有页面的历史待办补绑或改绑文档 */
export function bindTodoPage(session: RemoteSession, id: string, pageId: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/page`, { pageId });
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

function asPage(value: unknown): WikiTodoPage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  return { id };
}

/** 通知或待办 data 里的文档 id：先 page.id，再 pageId */
export function pageIdFromRecord(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  const page = asPage(row.page);
  if (page) return page.id;
  const pageId = typeof row.pageId === "string" ? row.pageId.trim() : "";
  return pageId || null;
}

/** 跳转文档：顶层 page，其次 data.page / data.pageId，最后才是本机记住的旧映射 */
export function pageIdFromTodo(todo: NotifyTodo): string | null {
  const linked = todo.page?.id?.trim() || pageIdFromRecord(todo.data);
  if (linked) return linked;
  return readTodoPageMap()[todo.id] ?? null;
}

export function pageIdFromNotice(notice: NotifyNotice): string | null {
  return pageIdFromRecord(notice.data);
}

/** 服务端还没绑上文档，打开前要先 POST /wiki/todos/:id/page */
export function todoNeedsPageBind(todo: NotifyTodo): boolean {
  if (todo.data?.legacyWithoutPage) return true;
  return !todo.page?.id?.trim() && !pageIdFromRecord(todo.data);
}
