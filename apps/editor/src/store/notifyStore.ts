import { emptyEditorDocument, normalizeEditorDocument, type EditorJsDocument } from "@myblog/shared";
import { documentText } from "@/lib/document/search";
import { request, type RemoteSession } from "@/store/remoteStore";

/**
 * 网关 `/wiki/todos` 契约
 *
 * 状态只有四态：pending | in_progress | done | cancelled。
 * 不再使用 open，也不再把细态写进 data.localStatus。
 * 开始日、截止日只驱动通知，不改变状态。
 *
 * - POST /wiki/todos（pageId、title 必填；可带 status / startsAt / dueAt）
 * - PATCH /wiki/todos/:id
 * - POST …/start | …/done | …/cancel | …/reopen 直接改 status
 * - DELETE /wiki/todos/:id 删除任务，不是改成 cancelled
 * - GET ?status=pending,in_progress 可逗号分隔多个状态
 *
 * 待办块在服务端对应一条列表记录：data.kind = "list"，与 pageId 绑定。
 * 任务是另一条记录：data.kind = "task"、data.listId = 列表 id。
 * 铃铛待办栏只取 pending 与 in_progress 的任务，不含列表记录。
 */

/** 四态。open 只可能出现在尚未刷完的旧数据里，读到后按 pending 处理，不再写出 */
export type WikiTodoStatus = "pending" | "in_progress" | "done" | "cancelled" | "open";

export type TodoRecordStatus = Exclude<WikiTodoStatus, "open">;

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
  status?: TodoRecordStatus;
  startsAt?: string | null;
  dueAt?: string | null;
  data?: Record<string, unknown> | null;
};

const TODO_PAGE_KEY = "editor:todo-pages";

/**
 * 待办正文只活在这里，按服务端 id 索引。
 * 页面文档只留 id；打开页面时用 pageId 把这一页的任务灌进来。
 * 铃铛和块里的写入都会 publish，订阅方再重绘。
 */
const todosById = new Map<string, NotifyTodo>();
const idsByList = new Map<string, string[]>();
const listListeners = new Set<(listId: string) => void>();
const taskListeners = new Set<() => void>();

export function isTodoListRecord(todo: NotifyTodo | null | undefined): boolean {
  if (!todo) return false;
  return todo.category === "list" || todo.data?.kind === "list";
}

export function taskListId(todo: NotifyTodo | null | undefined): string {
  const raw = todo?.data?.listId;
  return typeof raw === "string" ? raw.trim() : "";
}

function emitListTasks(listId: string) {
  for (const listener of listListeners) {
    listener(listId);
  }
}

function emitTodoTasks() {
  for (const listener of taskListeners) {
    listener();
  }
}

function rememberTodo(todo: NotifyTodo, extra?: Record<string, unknown> | null): NotifyTodo {
  const prev = todosById.get(todo.id);
  const data = {
    ...(prev?.data ?? {}),
    ...(todo.data ?? {}),
    ...(extra ?? {}),
  };
  const next: NotifyTodo = {
    ...prev,
    ...todo,
    ...(Object.keys(data).length ? { data } : {}),
  };
  todosById.set(todo.id, next);
  return next;
}

export function cachedListTasks(listId: string): NotifyTodo[] {
  const ids = idsByList.get(listId) ?? [];
  const out: NotifyTodo[] = [];
  for (const id of ids) {
    const todo = todosById.get(id);
    if (todo && !isTodoListRecord(todo)) out.push(todo);
  }
  return out;
}

export function subscribeListTasks(listId: string, listener: () => void): () => void {
  const wrapped = (changed: string) => {
    if (changed === listId) listener();
  };
  listListeners.add(wrapped);
  return () => listListeners.delete(wrapped);
}

/** 铃铛待办栏：全部任务，不含待办列表本身 */
export function cachedTodoTasks(): NotifyTodo[] {
  return [...todosById.values()].filter((todo) => !isTodoListRecord(todo) && isActiveTodoStatus(todo.status));
}

export function subscribeTodoTasks(listener: () => void): () => void {
  taskListeners.add(listener);
  return () => taskListeners.delete(listener);
}

/** 写入一条任务或列表。列表本身不进任务清单，任务按 listId 通知对应页面块 */
export function publishTodo(todo: NotifyTodo, extra?: Record<string, unknown> | null) {
  if (!todo?.id) return;
  const next = rememberTodo(todo, extra);
  if (isTodoListRecord(next)) return;
  const listId = taskListId(next);
  if (listId) {
    const ids = idsByList.get(listId) ?? [];
    if (!ids.includes(next.id)) {
      idsByList.set(listId, [...ids, next.id]);
    }
    emitListTasks(listId);
  }
  emitTodoTasks();
}

/** 从页面块和铃铛里拿掉一条任务 */
export function forgetTodo(id: string) {
  const todoId = id.trim();
  if (!todoId) return;
  const todo = todosById.get(todoId);
  todosById.delete(todoId);
  const lists = new Set<string>();
  const known = taskListId(todo);
  if (known) lists.add(known);
  for (const [listId, ids] of idsByList) {
    if (ids.includes(todoId)) lists.add(listId);
  }
  for (const listId of lists) {
    idsByList.set(
      listId,
      (idsByList.get(listId) ?? []).filter((itemId) => itemId !== todoId),
    );
    emitListTasks(listId);
  }
  emitTodoTasks();
}

/** 删除任务记录。终止仍走 /cancel，不在这里改状态 */
export async function deleteTodo(session: RemoteSession, id: string): Promise<void> {
  const prev = todosById.get(id);
  forgetTodo(id);
  try {
    await request<unknown>(session, "DELETE", `/wiki/todos/${encodeURIComponent(id)}`);
  } catch (err) {
    if (prev) publishTodo(prev);
    throw err;
  }
}

/** 打开页面上的待办块时，一次取回这份列表的四态任务 */
export async function loadListTasks(session: RemoteSession, pageId: string, listId: string): Promise<NotifyTodo[]> {
  const page = pageId.trim();
  const list = listId.trim();
  if (!page || !list) return [];
  const result = await request<Page<NotifyTodo>>(
    session,
    "GET",
    `/wiki/todos?pageId=${encodeURIComponent(page)}&status=pending,in_progress,done,cancelled&page=1&pageSize=100`,
  );
  const seen = new Set<string>();
  const items = (result.items ?? []).filter((todo) => {
    if (!todo?.id || seen.has(todo.id) || taskListId(todo) !== list || isTodoListRecord(todo)) return false;
    seen.add(todo.id);
    return true;
  });
  for (const todo of items) rememberTodo(todo);
  idsByList.set(list, items.map((todo) => todo.id));
  emitListTasks(list);
  emitTodoTasks();
  return items;
}

/** 创建待办块时向服务端申请一份列表，id 与 pageId 绑定 */
export async function ensureTodoList(session: RemoteSession, pageId: string, listId?: string): Promise<NotifyTodo> {
  const page = pageId.trim();
  const existing = listId?.trim() ?? "";
  if (existing) {
    try {
      const current = await getTodo(session, existing);
      publishTodo(current);
      return current;
    } catch {
      // 列表已被删掉时重新申请
    }
  }
  return createTodo(session, {
    title: "待办",
    pageId: page,
    category: "page",
    status: "pending",
    data: { kind: "list", pageId: page },
  });
}

/** 铃铛待办：未开始和进行中。不含列表记录，也不把 open 当成一种状态 */
export function isActiveTodoStatus(status: string | undefined | null): boolean {
  return status === "pending" || status === "in_progress";
}

/** 写出四态。旧值 open 不再提交，落到 pending */
export function toWireTodoStatus(status: string | undefined | null): TodoRecordStatus {
  if (status === "in_progress" || status === "done" || status === "cancelled" || status === "pending") {
    return status;
  }
  return "pending";
}

export function normalizeTodoStatus(status: string | undefined | null): TodoRecordStatus {
  if (status === "in_progress" || status === "done" || status === "cancelled" || status === "pending") {
    return status;
  }
  return "pending";
}

/** 只看 status。开始时间和 data.localStatus 不参与判断 */
export function fineTodoStatus(todo: Pick<NotifyTodo, "status" | "startedAt" | "data">): TodoRecordStatus {
  return normalizeTodoStatus(todo.status);
}

export async function fetchNotifySnapshot(session: RemoteSession): Promise<NotifySnapshot> {
  const [todos, unreadNotice, notices] = await Promise.all([
    request<Page<NotifyTodo>>(session, "GET", "/wiki/todos?status=pending,in_progress&page=1&pageSize=100"),
    request<{ count: number }>(session, "GET", "/wiki/notifications/unread-count"),
    request<Page<NotifyNotice>>(session, "GET", "/wiki/notifications?unread=1&page=1&pageSize=20"),
  ]);
  const raw = todos.items ?? [];
  const items = raw.filter((todo) => todo?.id && isActiveTodoStatus(todo.status) && !isTodoListRecord(todo));
  for (const todo of items) publishTodo(todo);
  const listCount = raw.filter(isTodoListRecord).length;
  return {
    openTodoCount: Math.max(0, (todos.total ?? items.length) - listCount),
    unreadNoticeCount: unreadNotice.count ?? notices.total ?? notices.items?.length ?? 0,
    todos: items,
    notices: notices.items ?? [],
  };
}

let liveSnapshot: NotifySnapshot | null = null;
const snapshotListeners = new Set<() => void>();
let snapshotInflight: Promise<NotifySnapshot> | null = null;

export function peekNotifySnapshot(): NotifySnapshot | null {
  return liveSnapshot;
}

export function subscribeNotifySnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

function emitNotifySnapshot() {
  for (const listener of snapshotListeners) listener();
}

/** 多个铃铛同时刷新时共用这一次请求 */
export function loadNotifySnapshot(session: RemoteSession): Promise<NotifySnapshot> {
  if (snapshotInflight) return snapshotInflight;
  snapshotInflight = fetchNotifySnapshot(session)
    .then((next) => {
      liveSnapshot = next;
      emitNotifySnapshot();
      return next;
    })
    .finally(() => {
      snapshotInflight = null;
    });
  return snapshotInflight;
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
    const data = { ...(input.data ?? {}) };
    delete data.localStatus;
    patch.data = data;
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
  const body = wireUpsertBody({ ...input, status: input.status ?? "pending", startsAt: input.startsAt ?? null }, pageId);
  const sent = body.data && typeof body.data === "object" ? (body.data as Record<string, unknown>) : undefined;
  return request<NotifyTodo>(session, "POST", "/wiki/todos", body).then((todo) => {
    publishTodo(todo, sent);
    return todosById.get(todo.id) ?? todo;
  });
}

export function getTodo(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "GET", `/wiki/todos/${id}`);
}

export function updateTodo(session: RemoteSession, id: string, input: UpsertTodoInput): Promise<NotifyTodo> {
  const pageId = input.pageId?.trim() ?? "";
  const body = wireUpsertBody(input, pageId || undefined);
  // PATCH 时 source 可省略
  const { source: _source, ...rest } = body;
  return request<NotifyTodo>(session, "PATCH", `/wiki/todos/${id}`, rest).then((todo) => {
    publishTodo(todo);
    return todo;
  });
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
function publishResult(todo: NotifyTodo): NotifyTodo {
  publishTodo(todo);
  return todo;
}

export function bindTodoPage(session: RemoteSession, id: string, pageId: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/page`, { pageId }).then(publishResult);
}

export function markTodoDone(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/done`).then(publishResult);
}

export function markTodoStart(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/start`).then(publishResult);
}

export function markTodoCancel(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/cancel`).then(publishResult);
}

export function reopenTodo(session: RemoteSession, id: string): Promise<NotifyTodo> {
  return request<NotifyTodo>(session, "POST", `/wiki/todos/${id}/reopen`).then(publishResult);
}

/**
 * 按目标状态同步远程。优先 /start /done /cancel /reopen，失败时用 PATCH 写回四态 status。
 */
export async function syncTodoStatus(
  session: RemoteSession,
  id: string,
  status: TodoRecordStatus,
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
    return await reopenTodo(session, id);
  } catch {
    // 专用接口未上线时直接改 status
  }
  if (!fallback?.title) {
    return Promise.reject(new Error("todo status sync failed"));
  }
  return updateTodo(session, id, {
    title: fallback.title,
    ...(fallback.content !== undefined ? { content: fallback.content } : {}),
    pageId: fallback.pageId,
    status,
    startsAt: fallback.startsAt,
    dueAt: fallback.dueAt,
    data: fallback.data,
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
