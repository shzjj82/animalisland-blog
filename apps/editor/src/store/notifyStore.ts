import { emptyEditorDocument, normalizeEditorDocument, type EditorJsDocument } from "@myblog/shared";
import { documentText } from "@/lib/document/search";
import { request, type RemoteSession } from "@/store/remoteStore";

/**
 * 网关 `/wiki/todos` 契约
 *
 * 线上 Nest 目前仍校验：status ∈ open | done | cancelled。
 * 编辑器本地四态：pending | in_progress | done | cancelled。
 * 出入站用 toWireTodoStatus / normalizeTodoStatus 互转：
 *   pending / in_progress → 线上 open；open → 本地 pending（细态以文档块为准）。
 *
 * 目标契约（Nest 升级后）：
 * - 状态 pending | in_progress | done | cancelled
 * - POST /wiki/todos（pageId、title 必填；content 非必填；可带 startsAt/dueAt/status）
 * - PATCH /wiki/todos/:id（content 非必填）
 * - POST …/start | …/done | …/cancel | …/reopen
 * - GET ?status=pending,in_progress；open-count 计活跃态
 *
 * 定时通知（通知表，不新建第二条 todo；source=wiki 且 data.notify）：
 * - todo.started / todo.progress / todo.overdue
 * 通知 data：{ todoId, pageId, kind, localItemId? }
 */

/** 本地 / 目标契约四态，另含线上旧值 open */
export type WikiTodoStatus = "pending" | "in_progress" | "done" | "cancelled" | "open";

/** 当前线上可写入的 status */
export type WikiTodoWireStatus = "open" | "done" | "cancelled";

export type WikiTodoPage = {
  id: string;
  slug?: string;
  title?: string;
  appCode?: string;
  kind?: string;
};

export type NotifyNoticeKind = "todo.started" | "todo.progress" | "todo.overdue" | string;

export type NotifyNotice = {
  id: string;
  title: string;
  content: string;
  category: string;
  source: string;
  readAt: string | null;
  createdAt: string;
  data?: {
    todoId?: string;
    pageId?: string;
    page?: WikiTodoPage;
    kind?: NotifyNoticeKind;
    localItemId?: string;
    [key: string]: unknown;
  } | null;
};

export type NotifyTodo = {
  id: string;
  title: string;
  /** 可选；详情块文档 JSON 或旧纯文本 */
  content?: string | null;
  category: string;
  source: string;
  /** 新契约四态；旧服务可能仍回 open，前端当 pending */
  status: WikiTodoStatus;
  dueAt: string | null;
  startsAt?: string | null;
  startedAt?: string | null;
  finishedAt: string | null;
  cancelledAt?: string | null;
  lastProgressNoticeOn?: string | null;
  lastOverdueNoticeOn?: string | null;
  startedNoticeAt?: string | null;
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
    notify?: boolean;
    [key: string]: unknown;
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

/** 挂在 todo.data.attachments；与文档附件块同结构 */
export type TodoAttachment = {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  source: "local" | "remote";
  url?: string;
};

export type UpsertTodoInput = {
  title: string;
  /** 非必填。省略则不改；块同步创建/更新都不带，正文只在详情里写 */
  content?: string;
  /** 新建必填。更新时带上表示改绑页面 */
  pageId?: string;
  category?: string;
  source?: string;
  status?: Exclude<WikiTodoStatus, "open">;
  startsAt?: string | null;
  dueAt?: string | null;
  data?: Record<string, unknown> | null;
};

const TODO_PAGE_KEY = "editor:todo-pages";

/** 活跃态：铃铛待办列表与 open-count 只计这两态（含旧 open） */
export function isActiveTodoStatus(status: string | undefined | null): boolean {
  return status === "pending" || status === "in_progress" || status === "open" || !status;
}

/** 本地四态 / open → 线上可写入的 open|done|cancelled */
export function toWireTodoStatus(status: string | undefined | null): WikiTodoWireStatus {
  if (status === "done") return "done";
  if (status === "cancelled") return "cancelled";
  return "open";
}

export function normalizeTodoStatus(status: string | undefined | null): Exclude<WikiTodoStatus, "open"> {
  if (status === "in_progress" || status === "done" || status === "cancelled" || status === "pending") {
    return status;
  }
  if (status === "open") {
    return "pending";
  }
  return "pending";
}

/** 远程细态：优先 data.localStatus；否则用 status / startedAt 推断 */
export function fineTodoStatus(todo: Pick<NotifyTodo, "status" | "startedAt" | "data">): Exclude<WikiTodoStatus, "open"> {
  const local = todo.data?.localStatus;
  if (local === "pending" || local === "in_progress" || local === "done" || local === "cancelled") {
    return local;
  }
  const normalized = normalizeTodoStatus(todo.status);
  if (normalized === "done" || normalized === "cancelled" || normalized === "in_progress") {
    return normalized;
  }
  if (todo.startedAt) {
    return "in_progress";
  }
  return "pending";
}

export async function fetchNotifySnapshot(session: RemoteSession): Promise<NotifySnapshot> {
  const [openTodo, unreadNotice, todos, notices] = await Promise.all([
    request<{ count: number }>(session, "GET", "/wiki/todos/open-count"),
    request<{ count: number }>(session, "GET", "/wiki/notifications/unread-count"),
    // 线上目前只认 open；升级四态后仍兼容 pending/in_progress
    request<Page<NotifyTodo>>(session, "GET", "/wiki/todos?status=open&page=1&pageSize=30"),
    request<Page<NotifyNotice>>(session, "GET", "/wiki/notifications?unread=1&page=1&pageSize=20"),
  ]);
  const items = (todos.items ?? []).filter((todo) => isActiveTodoStatus(todo.status));
  return {
    openTodoCount: openTodo.count ?? todos.total ?? items.length,
    unreadNoticeCount: unreadNotice.count ?? notices.total ?? notices.items?.length ?? 0,
    todos: items,
    notices: notices.items ?? [],
  };
}

function wireUpsertBody(input: UpsertTodoInput, pageId?: string) {
  const patch: Record<string, unknown> = {
    title: input.title,
    category: input.category ?? "page",
    source: input.source ?? "wiki",
    dueAt: input.dueAt ?? null,
  };
  if (input.startsAt !== undefined) {
    patch.startsAt = input.startsAt;
  }
  if (input.content !== undefined) {
    patch.content = input.content;
  }
  if (input.status !== undefined) {
    patch.status = toWireTodoStatus(input.status);
  }
  if (input.data !== undefined) {
    // 调用方负责带上需保留的字段（如 attachments）
    patch.data = {
      ...(input.data ?? {}),
      ...(input.status !== undefined ? { localStatus: input.status } : {}),
    };
  }
  if (pageId) {
    patch.pageId = pageId;
  }
  return patch;
}

export function todoAttachments(todo: NotifyTodo | null | undefined): TodoAttachment[] {
  const raw = todo?.data?.attachments;
  if (!Array.isArray(raw)) return [];
  const out: TodoAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const fileId = typeof row.fileId === "string" ? row.fileId.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (!fileId || !name) continue;
    out.push({
      fileId,
      name,
      size: typeof row.size === "number" ? row.size : 0,
      mime: typeof row.mime === "string" ? row.mime : "",
      source: row.source === "remote" ? "remote" : "local",
      ...(typeof row.url === "string" && row.url ? { url: row.url } : {}),
    });
  }
  return out;
}

export function createTodo(session: RemoteSession, input: UpsertTodoInput): Promise<NotifyTodo> {
  const pageId = input.pageId?.trim() ?? "";
  if (!pageId) {
    return Promise.reject(new Error("pageId 必填且须为有效文档 id"));
  }
  return request<NotifyTodo>(
    session,
    "POST",
    "/wiki/todos",
    wireUpsertBody({ ...input, status: input.status ?? "pending", startsAt: input.startsAt ?? null }, pageId),
  );
}

export function getTodo(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "GET", `/wiki/todos/${id}`);
}

export function updateTodo(session: RemoteSession, id: string, input: UpsertTodoInput): Promise<NotifyTodo> {
  const pageId = input.pageId?.trim() ?? "";
  const body = wireUpsertBody(input, pageId || undefined);
  // PATCH 时 source 可省略
  const { source: _source, ...rest } = body;
  return request<NotifyTodo>(session, "PATCH", `/wiki/todos/${id}`, rest);
}

/** 块同步更新时合并 data，避免冲掉详情里的 attachments / content 附属字段 */
export async function updateTodoMergingData(
  session: RemoteSession,
  id: string,
  input: UpsertTodoInput,
): Promise<NotifyTodo> {
  let merged = input.data;
  if (input.data !== undefined) {
    try {
      const current = await getTodo(session, id);
      const prev =
        current.data && typeof current.data === "object" ? (current.data as Record<string, unknown>) : {};
      merged = { ...prev, ...input.data };
    } catch {
      // 读失败则按调用方 data 写入
    }
  }
  return updateTodo(session, id, { ...input, data: merged });
}

/** 给还没有页面的历史待办补绑或改绑文档 */
export function bindTodoPage(session: RemoteSession, id: string, pageId: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/page`, { pageId });
}

export function markTodoDone(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/done`);
}

export function markTodoStart(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/start`);
}

export function markTodoCancel(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/cancel`);
}

export function reopenTodo(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/reopen`);
}

/**
 * 按目标状态同步远程。优先专用接口；失败时回退 PATCH（线上 status 只能是 open/done/cancelled）。
 */
export async function syncTodoStatus(
  session: RemoteSession,
  id: string,
  status: Exclude<WikiTodoStatus, "open">,
  fallback?: UpsertTodoInput,
): Promise<NotifyTodo> {
  try {
    if (status === "done") {
      return await markTodoDone(session, id);
    }
    if (status === "in_progress") {
      return await markTodoStart(session, id);
    }
    if (status === "cancelled") {
      return await markTodoCancel(session, id);
    }
    if (status === "pending") {
      return await reopenTodo(session, id);
    }
  } catch {
    // start / cancel / reopen 未上线时回退
  }
  // 线上尚无 in_progress：与 pending 一样写成 open，细态在 data.localStatus
  return updateTodo(session, id, {
    title: fallback?.title ?? "",
    ...(fallback?.content !== undefined ? { content: fallback.content } : {}),
    pageId: fallback?.pageId,
    status,
    startsAt: fallback?.startsAt,
    dueAt: fallback?.dueAt,
    data: fallback?.data,
  });
}

export function markNoticeRead(session: RemoteSession, id: string): Promise<NotifyNotice> {
  return request<NotifyNotice>(session, "POST", `/wiki/notifications/${id}/read`);
}

export function markAllNoticesRead(session: RemoteSession): Promise<{ updated: number }> {
  return request<{ updated: number }>(session, "POST", "/wiki/notifications/read-all");
}

const EMBED_BLOCK_DENY = new Set(["todo", "pageLink", "aiAssist"]);

/** 详情正文：旧纯文本或 Editor.js JSON；并去掉嵌入态不允许的块 */
export function contentDocumentFromTodo(todo: Pick<NotifyTodo, "content"> | null | undefined): EditorJsDocument {
  const raw = (todo?.content ?? "").trim();
  if (!raw) {
    return emptyEditorDocument();
  }
  const doc = normalizeEditorDocument(raw);
  return {
    ...doc,
    blocks: (doc.blocks ?? []).filter((block) => !EMBED_BLOCK_DENY.has(block.type)),
  };
}

export function encodeTodoContent(doc: EditorJsDocument): string {
  const blocks = (doc.blocks ?? []).filter((block) => !EMBED_BLOCK_DENY.has(block.type));
  if (!blocks.length) {
    return "";
  }
  return JSON.stringify({
    time: doc.time ?? Date.now(),
    version: doc.version ?? "2.30.7",
    blocks,
  });
}

/** 铃铛列表摘要：块文档抽纯文本；旧 content 当纯文本 */
export function todoContentPreview(todo: Pick<NotifyTodo, "title" | "content">): string {
  const title = todo.title.trim();
  const raw = (todo.content ?? "").trim();
  if (!raw) return "";
  const text = documentText(normalizeEditorDocument(raw)).replace(/\s+/g, " ").trim();
  if (!text || text === title) return "";
  return text;
}

/** 把远程待办转成 wiki 页初始正文：标题 + 任务说明，方便继续填写 */
export function documentFromTodo(todo: NotifyTodo): EditorJsDocument {
  const title = todo.title.trim();
  const body = contentDocumentFromTodo(todo);
  const blocks: EditorJsDocument["blocks"] = [
    {
      type: "header",
      data: { text: title, level: 1 },
    },
  ];
  if (body.blocks.length) {
    blocks.push(...body.blocks);
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

export function noticeKind(notice: NotifyNotice): string {
  const kind = notice.data?.kind;
  return typeof kind === "string" ? kind : "";
}

/** 服务端还没绑上文档，打开前要先 POST /wiki/todos/:id/page */
export function todoNeedsPageBind(todo: NotifyTodo): boolean {
  if (todo.data?.legacyWithoutPage) return true;
  return !todo.page?.id?.trim() && !pageIdFromRecord(todo.data);
}
