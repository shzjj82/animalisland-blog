import type { API, BlockAPI, BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { appLocale, t } from "@/i18n";
import {
  cachedListTasks,
  createTodo,
  deleteTodo,
  ensureTodoList,
  fineTodoStatus,
  loadListTasks,
  rememberTodoPage,
  subscribeListTasks,
  syncTodoStatus,
  updateTodoMergingData,
  type NotifyTodo,
  type UpsertTodoInput,
} from "@/store/notifyStore";
import { loadSession } from "@/store/remoteStore";
import { menuIcons } from "../menuIcons";

/** pending 未开始 · in_progress 进行中 · done 已完成 · cancelled 已终止 */
export type TodoStatus = "pending" | "in_progress" | "done" | "cancelled";

export type TodoItem = {
  id: string;
  text: string;
  status: TodoStatus;
  /** YYYY-MM-DD，空字符串表示未选 */
  start: string;
  end: string;
  /** 详情正文：Editor.js JSON；非必填 */
  content?: string;
  /** 已同步到 notify 服务的远程待办 id */
  remoteId?: string;
};

/** 块内「添加 / 编辑」走 React 详情对话框 */
export type TodoBlockDetailRequest = {
  creating: boolean;
  pageId: string;
  draft: { title: string; content?: string; status?: TodoStatus };
  onSubmit: (data: { title: string; content: string }) => void | Promise<void>;
  /** 详情里确认后才改状态：未开始 → 进行中，进行中 → 已完成 */
  onStatus?: (status: "in_progress" | "done") => void | Promise<void>;
};

export type TodoData = {
  /** 服务端待办列表 id，与 pageId 绑定。页面只留这个 id */
  listId?: string;
  /** 运行时从 store 填上。写回文档时不再带正文，只留任务 id */
  items?: TodoItem[];
  /** 属于这份列表的任务 id */
  ids?: string[];
  /** 整块待办共用，不跟某一条绑定 */
  notify: boolean;
};

type Tab = "pending" | "in_progress" | "ended";

function isEnded(status: TodoStatus): boolean {
  return status === "done" || status === "cancelled";
}

function migrateStatus(raw: { status?: unknown; done?: unknown }): TodoStatus {
  const status = String(raw.status ?? "").trim();
  if (status === "pending" || status === "in_progress" || status === "done" || status === "cancelled") {
    return status;
  }
  return raw.done ? "done" : "pending";
}

const DAY = 86_400_000;

function glyph(body: string): string {
  return `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true">${body}</svg>`;
}

const LIST_ICON = glyph(
  `<rect x="4" y="6" width="40" height="36" rx="3" stroke="currentColor" stroke-width="3"/>` +
    `<path d="M4 14H44M20 24H36M20 32H36M12 24H14M12 32H14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
);
const GANTT_ICON = glyph(
  `<path d="M10 8v32M10 40h30" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="16" y="11" width="20" height="7" rx="3.5" stroke="currentColor" stroke-width="3"/>` +
    `<rect x="22" y="21" width="16" height="7" rx="3.5" stroke="currentColor" stroke-width="3"/>` +
    `<rect x="14" y="31" width="14" height="7" rx="3.5" stroke="currentColor" stroke-width="3"/>`,
);
const CHECK_ICON = glyph(
  `<path d="M12 24l8 8 16-18" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const CALENDAR_ICON = glyph(
  `<rect x="6" y="8" width="36" height="32" rx="3" stroke="currentColor" stroke-width="3"/>` +
    `<path d="M6 18H42M16 4V12M32 4V12" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
);
const REMOVE_ICON = glyph(
  `<path d="M9 10V44H39V10H9Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>` +
    `<path d="M20 20V33M28 20V33M4 10H44M16 10L19.289 4H28.7771L32 10H16Z" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const CANCEL_ICON = glyph(
  `<circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="3"/>` +
    `<path d="M16 16l16 16M32 16L16 32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
);
const RESTORE_ICON = glyph(
  `<path d="M12 24a12 12 0 1 0 4-8.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M12 12v8h8" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
);
const ADD_ICON = glyph(
  `<path d="M24 10V38M10 24H38" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
);
const EMPTY_ICON =
  `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">` +
  `<path d="M4 30L9 6H39L44 30" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<path d="M4 30H14.9091L16.7273 36H31.2727L33.0909 30H44V43H4V30Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>` +
  `<path d="M19 14H29M16 22H32" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>` +
  `</svg>`;

function textWidth(input: HTMLInputElement): number {
  const probe = document.createElement("span");
  const style = getComputedStyle(input);
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.font = style.font;
  probe.textContent = input.value;
  document.body.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function blankItem(): TodoItem {
  const today = todayIso();
  return { id: uid(), text: "", status: "pending", start: today, end: today };
}

function asDate(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

/** 取消完成 / 恢复终止时回到未开始，状态只由用户确认 */
function reopenStatus(_item: Pick<TodoItem, "start">): TodoStatus {
  return "pending";
}

/** 展示态就是用户确认过的状态。开始日只用于通知，不把任务改成进行中 */
function displayStatus(item: TodoItem, _notifyOn?: boolean): TodoStatus {
  return item.status;
}

function statusLabel(status: TodoStatus): string {
  if (status === "in_progress") {
    return t("todo.inProgress");
  }
  if (status === "done") {
    return t("todo.done");
  }
  if (status === "cancelled") {
    return t("todo.cancelled");
  }
  return t("todo.pending");
}

function normalizeItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<TodoItem> & { done?: boolean };
  const remoteId = typeof item.remoteId === "string" && item.remoteId.trim() ? item.remoteId.trim() : undefined;
  const content = typeof item.content === "string" && item.content.trim() ? item.content : undefined;
  return {
    id: typeof item.id === "string" && item.id ? item.id : uid(),
    text: String(item.text ?? ""),
    status: migrateStatus(item),
    start: asDate(item.start),
    end: asDate(item.end),
    ...(content ? { content } : {}),
    ...(remoteId ? { remoteId } : {}),
  };
}

function dueAtFromItem(item: TodoItem): string | null {
  if (!item.end) return null;
  const date = new Date(`${item.end}T23:59:59.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function upsertPayload(item: TodoItem, pageId: string, listId: string, notify: boolean): UpsertTodoInput | null {
  const title = item.text.trim().slice(0, 120);
  if (!title || !pageId || !listId) return null;
  return {
    title,
    ...(item.content?.trim() ? { content: item.content.trim() } : {}),
    pageId,
    category: "page",
    source: "wiki",
    status: item.status,
    startsAt: item.start || null,
    dueAt: dueAtFromItem(item),
    data: {
      kind: "task",
      listId,
      ...(item.remoteId ? {} : { localItemId: item.id }),
      start: item.start || null,
      end: item.end || null,
      notify,
    },
  };
}

function dayOf(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function todoToItem(todo: NotifyTodo): TodoItem {
  const content = typeof todo.content === "string" && todo.content.trim() ? todo.content : undefined;
  return {
    id: todo.id,
    remoteId: todo.id,
    text: todo.title ?? "",
    status: fineTodoStatus(todo),
    start: dayOf(todo.data?.start) || dayOf(todo.startsAt),
    end: dayOf(todo.data?.end) || dayOf(todo.dueAt),
    ...(content ? { content } : {}),
  };
}

function normalize(data: Partial<TodoData> | undefined): TodoData & { items: TodoItem[] } {
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems.map(normalizeItem).filter((item): item is TodoItem => item !== null);
  const ids = Array.isArray(data?.ids) ? data.ids.filter((id): id is string => typeof id === "string" && Boolean(id.trim())) : [];
  for (const id of ids) {
    if (!items.some((item) => item.remoteId === id || item.id === id)) {
      items.push({ id, remoteId: id, text: "", status: "pending", start: "", end: "" });
    }
  }
  const legacyNotify = rawItems.some(
    (raw) => Boolean(raw && typeof raw === "object" && (raw as { notify?: unknown }).notify),
  );
  const linked = Array.isArray(data?.ids);
  const listId = typeof data?.listId === "string" && data.listId.trim() ? data.listId.trim() : undefined;
  return {
    items: items.length || linked ? items : [blankItem()],
    notify: Boolean(data?.notify) || legacyNotify,
    ...(listId ? { listId } : {}),
  };
}

function utcDay(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoFromDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthWeeks(year: number, month: number): Date[][] {
  const first = new Date(year, month - 1, 1);
  const cursor = new Date(year, month - 1, 1 - first.getDay());
  const last = new Date(year, month, 0);
  const weeks: Date[][] = [];
  while (cursor <= last) {
    const week: Date[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

type GanttSegment = {
  name: string;
  status: TodoStatus;
  overdue: boolean;
  startCol: number;
  endCol: number;
  from: boolean;
  to: boolean;
};

function packGantt(segments: GanttSegment[]): { segment: GanttSegment; lane: number }[] {
  const sorted = [...segments].sort((a, b) => a.startCol - b.startCol || a.endCol - b.endCol);
  const laneEnds: number[] = [];
  return sorted.map((segment) => {
    let lane = laneEnds.findIndex((end) => end < segment.startCol);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(segment.endCol);
    } else {
      laneEnds[lane] = segment.endCol;
    }
    return { segment, lane };
  });
}

function formatPretty(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const thisYear = Number(todayIso().slice(0, 4));
  if (appLocale() === "zh") {
    return year === thisYear ? `${month}月${day}日` : `${year}年${month}月${day}日`;
  }
  return year === thisYear ? `${month}/${day}` : `${year}/${month}/${day}`;
}

/** 待办块：未开始/进行中/已完成/已终止、起止日期、整块通知，以及列表/甘特图页签。 */
export class TodoBlockTool implements BlockTool {
  static get toolbox() {
    return { title: "Todo · todo", icon: menuIcons.todo };
  }

  static get isReadOnlySupported() {
    return true;
  }

  /** 让待办和正文/标题/列表/引用可以互相转换：导出每行的文字，导入时一行变一条 */
  static get conversionConfig() {
    return {
      export: (data: TodoData): string =>
        normalize(data)
          .items.map((item) => item.text.trim())
          .filter(Boolean)
          .join("\n"),
      import: (text: string): TodoData => {
        const lines = String(text ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        return {
          notify: false,
          items: (lines.length ? lines : [""]).map((line) => ({ ...blankItem(), text: line })),
        };
      },
    };
  }

  private data: TodoData & { items: TodoItem[] };
  private readOnly: boolean;
  private api: API;
  private block?: BlockAPI;
  private wrapper = document.createElement("div");
  private tab: Tab = "pending";
  private gantt = false;
  private ganttExpanded = false;
  private ganttYear = 0;
  private ganttMonth = 0;
  private pendingScrollId: string | null = null;
  private calendar: HTMLDivElement | null = null;
  private calendarAnchor: HTMLElement | null = null;
  private leaveTimers: number[] = [];
  private heightFrame = 0;
  private syncing = false;
  private booting = false;
  private listReady: Promise<string> | null = null;
  private watchedPage = "";
  private stopWatch: (() => void) | null = null;
  private getPageId: () => string;
  private onOpenDetail?: (request: TodoBlockDetailRequest) => void;

  constructor({ data, readOnly, block, api, config }: BlockToolConstructorOptions<TodoData>) {
    this.data = normalize(data);
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.api = api;
    const conf = config as
      | { getPageId?: () => string; onOpenDetail?: (request: TodoBlockDetailRequest) => void }
      | undefined;
    this.getPageId = typeof conf?.getPageId === "function" ? conf.getPageId : () => "";
    this.onOpenDetail = typeof conf?.onOpenDetail === "function" ? conf.onOpenDetail : undefined;
    this.wrapper.className = "cdx-todo";
    this.wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Backspace") {
        // 一直吞掉会让 Editor.js 以为这个块永远非空，待办块就再也删不掉
        event.stopPropagation();
      }
      // 一条待办都没有时（空状态），退格 = 删掉整个待办块
      if (event.key === "Backspace" && this.data.items.length === 0) {
        event.preventDefault();
        this.deleteBlock();
      }
    });
  }

  render() {
    try {
      this.paint();
    } catch (err) {
      console.warn("[todo-render]", err);
      this.wrapper.replaceChildren();
      this.wrapper.className = "cdx-todo";
      const fallback = document.createElement("div");
      fallback.className = "cdx-todo__list";
      fallback.append(this.emptyState(t("todo.emptyPending")));
      this.wrapper.append(this.header(), fallback, this.footer());
    }
    // 勿在 render 同步里 dispatchChange：Editor.js 会当成块渲染失败
    this.watchPage();
    return this.wrapper;
  }

  save(): TodoData {
    const ids = [...new Set(this.data.items.map((item) => item.remoteId).filter((id): id is string => Boolean(id)))];
    const pending = this.data.items
      .filter((item) => item.text.trim() && !item.remoteId)
      .map((item) => ({
        id: item.id,
        text: item.text.trim(),
        status: item.status,
        start: item.start,
        end: item.end,
        ...(item.content?.trim() ? { content: item.content.trim() } : {}),
      }));
    return {
      notify: this.data.notify,
      ...(this.data.listId ? { listId: this.data.listId } : {}),
      ids,
      ...(pending.length ? { items: pending } : {}),
    };
  }

  destroy() {
    this.stopWatch?.();
    this.stopWatch = null;
    this.closeCalendar();
    for (const timer of this.leaveTimers) {
      window.clearTimeout(timer);
    }
    this.leaveTimers = [];
    if (this.heightFrame) {
      window.cancelAnimationFrame(this.heightFrame);
      this.heightFrame = 0;
    }
  }

  private commit() {
    this.block?.dispatchChange?.();
  }

  /** 打开待办块：没有列表就向服务端申请，再只拉取这份列表里的任务 */
  private watchPage() {
    const pageId = this.getPageId().trim();
    if (!pageId || this.listReady) return;
    if (this.data.listId && this.watchedPage === this.data.listId) return;
    this.listReady = this.bootList();
  }

  private readyListId(): Promise<string> {
    if (this.data.listId) return Promise.resolve(this.data.listId);
    if (!this.listReady) this.listReady = this.bootList();
    return this.listReady;
  }

  private applyListTasks() {
    const listId = this.data.listId;
    if (!listId) return;
    const remote = cachedListTasks(listId).map(todoToItem);
    const remoteIds = new Set(remote.map((item) => item.remoteId));
    const pending = this.data.items.filter((item) => item.text.trim() && !item.remoteId && !remoteIds.has(item.id));
    this.data.items = [...remote, ...pending];
    if (this.leaveTimers.length) return;
    this.paint();
  }

  private async bootList(): Promise<string> {
    if (this.booting) return this.data.listId ?? "";
    const session = loadSession();
    const pageId = this.getPageId().trim();
    if (!session || !pageId) return "";
    if (!this.data.listId && this.readOnly) return "";
    this.booting = true;
    const unsynced = this.data.items.filter((item) => item.text.trim() && !item.remoteId);
    try {
      const list = await ensureTodoList(session, pageId, this.data.listId);
      this.data.listId = list.id;
      this.stopWatch?.();
      this.watchedPage = list.id;
      this.stopWatch = subscribeListTasks(list.id, () => {
        if (!this.wrapper.isConnected) return;
        this.applyListTasks();
      });
      if (!this.readOnly) this.commit();
      await loadListTasks(session, pageId, list.id);
      if (this.readOnly) return list.id;
      for (const item of unsynced) {
        const payload = upsertPayload(item, pageId, list.id, this.data.notify);
        if (!payload) continue;
        try {
          const created = await createTodo(session, payload);
          if (item.status !== "pending") {
            await syncTodoStatus(session, created.id, item.status, payload);
          }
        } catch (err) {
          console.warn("[todo-migrate]", err);
          if (!this.data.items.some((entry) => entry.id === item.id)) {
            this.data.items.push(item);
            this.paint();
          }
        }
      }
      return list.id;
    } catch (err) {
      console.warn("[todo-list]", err);
      this.listReady = null;
      return "";
    } finally {
      this.booting = false;
    }
  }

  /** 把用户确认过的状态、正文和时间提交到所属列表。时间只用于通知，不改状态 */
  private async syncRemoteTodos() {
    if (this.readOnly || this.syncing) {
      return;
    }
    const session = loadSession();
    const pageId = this.getPageId().trim();
    const listId = (this.data.listId || (await this.readyListId())).trim();
    if (!session || !pageId || !listId) {
      return;
    }
    this.syncing = true;
    try {
      for (const item of [...this.data.items]) {
        const payload = upsertPayload(item, pageId, listId, this.data.notify);
        if (!payload) continue;
        try {
          if (item.remoteId) {
            await updateTodoMergingData(session, item.remoteId, payload);
            if (item.status !== "pending") {
              await syncTodoStatus(session, item.remoteId, item.status, payload);
            }
            rememberTodoPage(item.remoteId, pageId);
          } else {
            const created = await createTodo(session, payload);
            item.remoteId = created.id;
            item.id = created.id;
            if (item.status !== "pending") {
              await syncTodoStatus(session, created.id, item.status, payload);
            }
            rememberTodoPage(created.id, pageId);
          }
        } catch (err) {
          console.warn("[todo-sync]", err);
        }
      }
    } finally {
      this.syncing = false;
    }
  }

  private visibleItems(): TodoItem[] {
    return this.data.items.filter((item) => {
      if (this.tab === "ended") {
        return isEnded(item.status);
      }
      // 未开始 / 进行中按展示态分栏（通知关闭时，到了开始日的 pending 会出现在「进行中」）
      const shown = displayStatus(item, this.data.notify);
      if (this.tab === "in_progress") {
        return shown === "in_progress";
      }
      return shown === "pending";
    });
  }

  private emptyTabMessage(): string {
    if (this.tab === "ended") {
      return t("todo.emptyEnded");
    }
    if (this.tab === "in_progress") {
      return t("todo.emptyInProgress");
    }
    return t("todo.emptyPending");
  }

  private paint() {
    this.closeCalendar();
    const focusId = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.todoFocus : undefined;
    const body = this.gantt ? this.ganttView() : this.listView();
    this.wrapper.replaceChildren(this.header(), body, this.footer());
    this.scheduleGanttHeight(body);
    if (!focusId) {
      return;
    }
    const next = this.wrapper.querySelector<HTMLElement>(`[data-todo-focus="${CSS.escape(focusId)}"]`);
    next?.focus();
  }

  private scheduleGanttHeight(body: HTMLElement) {
    if (this.heightFrame) {
      window.cancelAnimationFrame(this.heightFrame);
    }
    let tries = 0;
    const run = () => {
      this.heightFrame = 0;
      if (!this.wrapper.contains(body)) {
        return;
      }
      tries += 1;
      if ((!body.isConnected || body.clientWidth <= 0) && tries < 60) {
        this.heightFrame = window.requestAnimationFrame(run);
        return;
      }
      if (body.clientWidth <= 0) {
        return;
      }
      this.lockToGanttHeight(body);
    };
    this.heightFrame = window.requestAnimationFrame(run);
  }

  private lockToGanttHeight(body: HTMLElement) {
    const gantt = body.classList.contains("cdx-todo__gantt") ? body : this.ganttView();
    const measuring = gantt !== body;
    if (measuring) {
      gantt.style.position = "absolute";
      gantt.style.visibility = "hidden";
      gantt.style.pointerEvents = "none";
      gantt.style.left = "0";
      gantt.style.width = `${body.clientWidth}px`;
      body.style.position = "relative";
      body.append(gantt);
    }
    const height = gantt.getBoundingClientRect().height;
    if (measuring) {
      gantt.remove();
    }
    if (height <= 0) {
      return;
    }
    body.style.height = `${Math.ceil(height)}px`;
    body.style.overflowY = "auto";
    this.revealPendingItem();
  }

  private revealPendingItem() {
    const id = this.pendingScrollId;
    if (!id) {
      return;
    }
    const input = this.wrapper.querySelector<HTMLInputElement>(`[data-todo-focus="${CSS.escape(id)}"]`);
    const scroller = input?.closest<HTMLElement>(".cdx-todo__list");
    if (!input || !scroller) {
      return;
    }
    this.pendingScrollId = null;
    const row = input.closest<HTMLElement>(".cdx-todo__body") ?? input;
    const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const bottom = top + row.getBoundingClientRect().height;
    const padding = 8;
    if (bottom > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = bottom - scroller.clientHeight + padding;
    } else if (top < scroller.scrollTop) {
      scroller.scrollTop = Math.max(0, top - padding);
    }
    input.focus({ preventScroll: true });
  }

  private header(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "cdx-todo__head";
    if (!this.gantt) {
      bar.append(this.tabs());
    }
    bar.append(this.notifyControl());
    return bar;
  }

  private tabs(): HTMLElement {
    const group = document.createElement("div");
    group.className = "cdx-todo__tabs";
    group.append(
      this.tabButton("pending", t("todo.pending")),
      this.tabButton("in_progress", t("todo.inProgress")),
      this.tabButton("ended", t("todo.ended")),
    );
    return group;
  }

  private tabButton(tab: Tab, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cdx-todo__tab${this.tab === tab ? " is-active" : ""}`;
    button.textContent = label;
    button.addEventListener("click", () => {
      this.tab = tab;
      this.paint();
    });
    return button;
  }

  private notifyControl(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cdx-todo__notify${this.data.notify ? " is-on" : ""}`;
    button.title = t("todo.notifyHint");
    button.disabled = this.readOnly;
    button.setAttribute("aria-pressed", this.data.notify ? "true" : "false");
    const knob = document.createElement("span");
    knob.className = "cdx-todo__switch";
    knob.setAttribute("aria-hidden", "true");
    const caption = document.createElement("span");
    caption.textContent = t("todo.notify");
    button.append(knob, caption);
    button.addEventListener("click", () => {
      this.data.notify = !this.data.notify;
      this.commit();
      this.paint();
      void this.syncRemoteTodos();
    });
    return button;
  }

  private listView(): HTMLElement {
    const list = document.createElement("div");
    list.className = "cdx-todo__list";
    const items = this.visibleItems();
    if (!items.length) {
      list.append(this.emptyState(this.emptyTabMessage()));
      return list;
    }
    for (const item of items) {
      list.append(this.itemRow(item));
    }
    return list;
  }

  private emptyState(message: string): HTMLElement {
    const empty = document.createElement("div");
    empty.className = "cdx-todo__empty";
    const icon = document.createElement("span");
    icon.className = "cdx-todo__empty-icon";
    icon.innerHTML = EMPTY_ICON;
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = message;
    empty.append(icon, text);
    return empty;
  }

  private itemRow(item: TodoItem): HTMLElement {
    const shown = displayStatus(item, this.data.notify);
    const ended = isEnded(item.status);
    const row = document.createElement("div");
    row.className = `cdx-todo__item is-${item.status}${shown === "in_progress" && item.status === "pending" ? " is-due-start" : ""}${this.onOpenDetail && !this.readOnly && item.status !== "cancelled" ? " is-openable" : ""}`;
    if (this.onOpenDetail && !this.readOnly && item.status !== "cancelled") {
      row.addEventListener("click", (event) => {
        const target = event.target;
        if (!(target instanceof Element) || target.closest("button, input, a")) return;
        this.openEditDetail(item);
      });
    }

    const check = document.createElement("button");
    check.type = "button";
    check.className = `cdx-todo__check${item.status === "done" ? " is-checked" : ""}${item.status === "cancelled" ? " is-cancelled" : ""}`;
    check.disabled = this.readOnly;
    check.innerHTML = CHECK_ICON;
    check.setAttribute("aria-pressed", item.status === "done" ? "true" : "false");
    check.setAttribute(
      "aria-label",
      item.status === "done" ? t("todo.reopen") : item.status === "pending" ? t("todo.startTask") : t("todo.finishTask"),
    );
    check.addEventListener("click", () => {
      if (row.classList.contains("is-striking") || row.classList.contains("is-leaving")) {
        return;
      }
      if (item.status === "cancelled") {
        return;
      }
      if (item.status === "done") {
        item.status = reopenStatus(item);
        this.tab = item.status === "in_progress" ? "in_progress" : "pending";
        this.commit();
        void this.syncRemoteTodos();
        this.paint();
        return;
      }
      if (item.status === "pending") {
        item.status = "in_progress";
        this.tab = "in_progress";
        this.commit();
        void this.syncRemoteTodos();
        this.paint();
        return;
      }
      this.finishItem(item, row, check);
    });

    const body = document.createElement("div");
    body.className = "cdx-todo__body";

    const titleRow = document.createElement("div");
    titleRow.className = "cdx-todo__title-row";
    const badge = document.createElement("span");
    badge.className = `cdx-todo__badge is-${shown}`;
    badge.textContent = statusLabel(shown);
    const text = document.createElement("input");
    text.type = "text";
    text.className = "cdx-todo__text";
    text.value = item.text;
    text.placeholder = t("todo.placeholder");
    text.disabled = this.readOnly || item.status === "cancelled";
    text.readOnly = Boolean(this.onOpenDetail) && !this.readOnly && item.status !== "cancelled";
    text.dataset.todoFocus = item.id;
    text.addEventListener("input", () => {
      if (text.readOnly) {
        return;
      }
      item.text = text.value;
      this.commit();
    });
    text.addEventListener("click", () => {
      if (text.readOnly) {
        this.openEditDetail(item);
      }
    });
    text.addEventListener("keydown", (event) => {
      if (text.readOnly && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        this.openEditDetail(item);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.insertAfter(item.id);
      }
      if (event.key === "Backspace" && text.value === "") {
        event.preventDefault();
        if (this.data.items.length <= 1) {
          this.deleteBlock();
        } else {
          this.removeItem(item.id);
        }
      }
    });
    titleRow.append(badge, text);

    const cancelOrRestore = document.createElement("button");
    cancelOrRestore.type = "button";
    cancelOrRestore.className = "cdx-todo__cancel";
    cancelOrRestore.hidden = this.readOnly;
    if (item.status === "cancelled") {
      cancelOrRestore.innerHTML = RESTORE_ICON;
      cancelOrRestore.title = t("todo.restore");
      cancelOrRestore.setAttribute("aria-label", t("todo.restore"));
      cancelOrRestore.addEventListener("click", () => {
        item.status = reopenStatus(item);
        this.tab = item.status === "in_progress" ? "in_progress" : "pending";
        this.commit();
        void this.syncRemoteTodos();
        this.paint();
      });
    } else if (!ended) {
      cancelOrRestore.innerHTML = CANCEL_ICON;
      cancelOrRestore.title = t("todo.cancel");
      cancelOrRestore.setAttribute("aria-label", t("todo.cancel"));
      cancelOrRestore.addEventListener("click", () => {
        item.status = "cancelled";
        this.commit();
        void this.syncRemoteTodos();
        if (this.tab !== "ended") {
          row.classList.add("is-leaving");
          const fade = window.setTimeout(() => {
            this.leaveTimers = this.leaveTimers.filter((timer) => timer !== fade);
            this.paint();
          }, 280);
          this.leaveTimers.push(fade);
        } else {
          this.paint();
        }
      });
    } else {
      cancelOrRestore.hidden = true;
    }

    const flow = this.flowButton(item, row, check);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "cdx-todo__remove";
    remove.innerHTML = REMOVE_ICON;
    remove.hidden = this.readOnly;
    remove.title = t("todo.remove");
    remove.setAttribute("aria-label", t("todo.remove"));
    remove.addEventListener("click", () => this.removeItem(item.id));

    const actions = document.createElement("div");
    actions.className = "cdx-todo__actions";
    actions.append(this.dateRange(item), cancelOrRestore, remove);

    body.append(titleRow, actions);
    row.append(check, body);
    if (flow) row.append(flow);
    return row;
  }

  /** 未开始 → 开始任务；进行中 → 完成任务。状态只在点击后改变 */
  private flowButton(item: TodoItem, row: HTMLElement, check: HTMLButtonElement): HTMLButtonElement | null {
    if (this.readOnly || isEnded(item.status)) return null;
    const button = document.createElement("button");
    button.type = "button";
    if (item.status === "pending") {
      button.className = "cdx-todo__flow";
      button.textContent = t("todo.startTask");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        item.status = "in_progress";
        this.tab = "in_progress";
        this.commit();
        void this.syncRemoteTodos();
        this.paint();
      });
      return button;
    }
    button.className = "cdx-todo__flow is-finish";
    button.textContent = t("todo.finishTask");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (row.classList.contains("is-striking") || row.classList.contains("is-leaving")) return;
      this.finishItem(item, row, check);
    });
    return button;
  }

  private finishItem(item: TodoItem, row: HTMLElement, check: HTMLButtonElement) {
    item.status = "done";
    this.commit();
    void this.syncRemoteTodos();
    check.classList.add("is-checked");
    check.setAttribute("aria-pressed", "true");
    check.disabled = true;
    row.querySelector<HTMLButtonElement>(".cdx-todo__range")?.setAttribute("disabled", "");
    const text = row.querySelector<HTMLInputElement>(".cdx-todo__text");
    const width = text ? textWidth(text) : 0;
    row.classList.add("is-striking");
    window.requestAnimationFrame(() => {
      text?.style.setProperty("--todo-strike", `${width}px`);
    });
    const strike = window.setTimeout(() => {
      row.classList.add("is-leaving");
      const fade = window.setTimeout(() => {
        this.leaveTimers = this.leaveTimers.filter((timer) => timer !== strike && timer !== fade);
        this.paint();
      }, 320);
      this.leaveTimers.push(fade);
    }, 340);
    this.leaveTimers.push(strike);
  }

  private dateRange(item: TodoItem): HTMLButtonElement {
    const locked = isEnded(item.status);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cdx-todo__range";
    button.disabled = this.readOnly || locked;
    button.dataset.todoFocus = `${item.id}:range`;
    const icon = document.createElement("span");
    icon.className = "cdx-todo__range-icon";
    icon.innerHTML = CALENDAR_ICON;
    icon.setAttribute("aria-hidden", "true");
    const start = document.createElement("span");
    start.className = "cdx-todo__date";
    start.dataset.side = "start";
    start.textContent = item.start ? formatPretty(item.start) : t("todo.startDate");
    const sep = document.createElement("span");
    sep.className = "cdx-todo__range-sep";
    sep.textContent = t("todo.to");
    const end = document.createElement("span");
    end.className = "cdx-todo__date";
    end.dataset.side = "end";
    end.textContent = item.end ? formatPretty(item.end) : t("todo.endDate");
    button.append(icon, start, sep, end);
    if (locked) {
      return button;
    }
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      this.openCalendar(button, item);
    });
    return button;
  }

  private onCalendarPointer = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (this.calendar?.contains(target) || this.calendarAnchor?.contains(target)) {
      return;
    }
    this.closeCalendar();
  };

  private onCalendarKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") {
      return;
    }
    event.stopPropagation();
    this.closeCalendar();
  };

  private onCalendarClose: (() => void) | null = null;

  private closeCalendar() {
    const finish = this.onCalendarClose;
    this.onCalendarClose = null;
    finish?.();
    this.calendarAnchor?.classList.remove("is-open");
    this.calendar?.remove();
    this.calendar = null;
    this.calendarAnchor = null;
    document.removeEventListener("pointerdown", this.onCalendarPointer, true);
    document.removeEventListener("keydown", this.onCalendarKey, true);
  }

  private openCalendar(anchor: HTMLElement, item: TodoItem) {
    if (this.calendar && this.calendarAnchor === anchor) {
      this.closeCalendar();
      return;
    }
    this.closeCalendar();
    const selected = item.start || item.end || todayIso();
    const [startYear, startMonth] = selected.split("-").map(Number);
    let year = startYear;
    let month = startMonth;
    let draftStart = item.start;
    let draftEnd = item.end;
    let hoverIso = "";
    let picking: "start" | "end" = "start";
    let settled = false;

    const pop = document.createElement("div");
    pop.className = "cdx-todo__calendar";
    pop.addEventListener("pointerdown", (event) => event.stopPropagation());

    const shift = (amount: number) => {
      const next = new Date(year, month - 1 + amount, 1);
      year = next.getFullYear();
      month = next.getMonth() + 1;
      render();
    };

    const syncField = () => {
      const startLabel = anchor.querySelector<HTMLElement>("[data-side='start']");
      const endLabel = anchor.querySelector<HTMLElement>("[data-side='end']");
      if (startLabel) {
        startLabel.textContent = draftStart ? formatPretty(draftStart) : t("todo.startDate");
        startLabel.classList.toggle("is-picking", picking === "start");
      }
      if (endLabel) {
        endLabel.textContent = draftEnd ? formatPretty(draftEnd) : t("todo.endDate");
        endLabel.classList.toggle("is-picking", picking === "end");
      }
    };

    const render = () => {
      pop.replaceChildren();
      const onHover = (iso: string) => {
        if (picking !== "end" || hoverIso === iso) {
          return;
        }
        hoverIso = iso;
        render();
      };
      const onPick = (iso: string) => {
        if (picking === "start") {
          draftStart = iso;
          draftEnd = "";
          hoverIso = "";
          picking = "end";
          syncField();
          render();
          return;
        }
        if (draftStart && utcDay(iso) < utcDay(draftStart)) {
          draftEnd = draftStart;
          draftStart = iso;
        } else {
          draftEnd = iso;
        }
        item.start = draftStart;
        item.end = draftEnd;
        settled = true;
        this.commit();
        this.closeCalendar();
        this.paint();
        void this.syncRemoteTodos();
      };
      const panels = document.createElement("div");
      panels.className = "cdx-todo__cal-panels";
      panels.append(
        this.monthPanel(year, month, true, shift, onHover, onPick, draftStart, draftEnd, hoverIso, picking),
        this.monthPanel(year, month + 1, false, shift, onHover, onPick, draftStart, draftEnd, hoverIso, picking),
      );
      pop.append(panels);
    };

    this.onCalendarClose = () => {
      if (settled || !draftStart || draftEnd) {
        return;
      }
      item.start = draftStart;
      item.end = draftStart;
      this.commit();
      void this.syncRemoteTodos();
    };

    anchor.classList.add("is-open");
    syncField();
    render();
    document.body.append(pop);
    this.calendar = pop;
    this.calendarAnchor = anchor;
    this.placeCalendar(pop, anchor);
    document.addEventListener("pointerdown", this.onCalendarPointer, true);
    document.addEventListener("keydown", this.onCalendarKey, true);
  }

  private monthPanel(
    year: number,
    month: number,
    leading: boolean,
    shift: (amount: number) => void,
    onHover: (iso: string) => void,
    onPick: (iso: string) => void,
    draftStart: string,
    draftEnd: string,
    hoverIso: string,
    picking: "start" | "end",
  ): HTMLElement {
    const shown = new Date(year, month - 1, 1);
    const shownYear = shown.getFullYear();
    const shownMonth = shown.getMonth() + 1;
    const panel = document.createElement("div");
    panel.className = "cdx-todo__cal-panel";

    const head = document.createElement("div");
    head.className = "cdx-todo__cal-head";
    const leftNav = document.createElement("div");
    leftNav.className = "cdx-todo__cal-navs";
    const rightNav = document.createElement("div");
    rightNav.className = "cdx-todo__cal-navs";
    if (leading) {
      leftNav.append(
        this.calNav("«", t("todo.prevMonth"), () => shift(-12)),
        this.calNav("‹", t("todo.prevMonth"), () => shift(-1)),
      );
    } else {
      rightNav.append(
        this.calNav("›", t("todo.nextMonth"), () => shift(1)),
        this.calNav("»", t("todo.nextMonth"), () => shift(12)),
      );
    }
    const title = document.createElement("div");
    title.className = "cdx-todo__cal-title";
    title.textContent = t("todo.month", { year: shownYear, month: shownMonth });
    head.append(leftNav, title, rightNav);

    const week = document.createElement("div");
    week.className = "cdx-todo__cal-week";
    for (const name of t("todo.weekdays").split(",")) {
      const cell = document.createElement("span");
      cell.textContent = name;
      week.append(cell);
    }

    const grid = document.createElement("div");
    grid.className = "cdx-todo__cal-grid";
    const lead = (new Date(shownYear, shownMonth - 1, 1).getDay() + 6) % 7;
    const origin = new Date(shownYear, shownMonth - 1, 1 - lead);
    const today = todayIso();
    const previewEnd = picking === "end" && hoverIso ? hoverIso : draftEnd;
    const from = draftStart && previewEnd ? Math.min(utcDay(draftStart), utcDay(previewEnd)) : 0;
    const to = draftStart && previewEnd ? Math.max(utcDay(draftStart), utcDay(previewEnd)) : 0;
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(origin);
      date.setDate(origin.getDate() + index);
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cdx-todo__cal-day";
      if (date.getMonth() !== shownMonth - 1) {
        cell.classList.add("is-out");
      }
      const dayUtc = utcDay(iso);
      if (draftStart && previewEnd && dayUtc > from && dayUtc < to) {
        cell.classList.add("is-in-range");
      }
      if (draftStart && iso === draftStart) {
        cell.classList.add("is-selected", "is-start");
      }
      if (previewEnd && iso === previewEnd) {
        cell.classList.add("is-selected", "is-end");
      }
      if (iso === today) {
        cell.classList.add("is-today");
      }
      cell.textContent = String(date.getDate());
      cell.addEventListener("mouseenter", () => onHover(iso));
      cell.addEventListener("click", () => onPick(iso));
      grid.append(cell);
    }

    panel.append(head, week, grid);
    return panel;
  }

  private calNav(label: string, aria: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cdx-todo__cal-nav";
    button.textContent = label;
    button.setAttribute("aria-label", aria);
    button.addEventListener("click", onClick);
    return button;
  }

  private placeCalendar(pop: HTMLElement, anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    let top = rect.bottom + 6;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    let left = rect.left;
    if (left + width > window.innerWidth - 8) {
      left = window.innerWidth - width - 8;
    }
    pop.style.top = `${top}px`;
    pop.style.left = `${Math.max(8, left)}px`;
  }

  private ganttView(): HTMLElement {
    const board = document.createElement("div");
    board.className = "cdx-todo__gantt";
    if (!this.data.items.length) {
      board.append(this.emptyState(t("todo.ganttEmpty")));
      return board;
    }
    if (!this.ganttYear) {
      const now = new Date();
      this.ganttYear = now.getFullYear();
      this.ganttMonth = now.getMonth() + 1;
    }

    const head = document.createElement("div");
    head.className = "cdx-todo__gantt-head";
    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "cdx-todo__gantt-nav";
    prev.textContent = "‹";
    prev.setAttribute("aria-label", t("todo.prevMonth"));
    prev.addEventListener("click", () => this.shiftGantt(-1));
    const title = document.createElement("div");
    title.className = "cdx-todo__gantt-title";
    title.textContent = t("todo.month", { year: this.ganttYear, month: this.ganttMonth });
    const next = document.createElement("button");
    next.type = "button";
    next.className = "cdx-todo__gantt-nav";
    next.textContent = "›";
    next.setAttribute("aria-label", t("todo.nextMonth"));
    next.addEventListener("click", () => this.shiftGantt(1));
    const today = document.createElement("button");
    today.type = "button";
    today.className = "cdx-todo__gantt-today";
    today.textContent = t("todo.today");
    today.addEventListener("click", () => {
      const now = new Date();
      this.ganttYear = now.getFullYear();
      this.ganttMonth = now.getMonth() + 1;
      this.ganttExpanded = false;
      this.paint();
    });
    head.append(prev, title, next, today);

    const weekdays = document.createElement("div");
    weekdays.className = "cdx-todo__gantt-weekdays";
    const names = t("todo.weekdays").split(",");
    const labels = names.length === 7 ? [names[6], ...names.slice(0, 6)] : names;
    for (const name of labels) {
      const cell = document.createElement("span");
      cell.textContent = name;
      weekdays.append(cell);
    }

    const grid = document.createElement("div");
    grid.className = "cdx-todo__gantt-grid";
    for (const week of monthWeeks(this.ganttYear, this.ganttMonth)) {
      grid.append(this.ganttWeek(week));
    }

    board.append(head, weekdays, grid);
    const hidden = Math.max(0, this.monthGanttItems().length - 3);
    if (hidden > 0) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "cdx-todo__gantt-more";
      more.textContent = this.ganttExpanded ? t("todo.ganttLess") : t("todo.ganttMore", { count: hidden });
      more.addEventListener("click", () => {
        this.ganttExpanded = !this.ganttExpanded;
        this.paint();
      });
      board.append(more);
    }
    return board;
  }

  private monthGanttItems(): TodoItem[] {
    const monthStart = utcDay(isoFromDate(new Date(this.ganttYear, this.ganttMonth - 1, 1)));
    const monthEnd = utcDay(isoFromDate(new Date(this.ganttYear, this.ganttMonth, 0)));
    const today = todayIso();
    return this.data.items.filter((item) => {
      const startIso = item.start || today;
      const endIso = item.end || today;
      const start = Math.min(utcDay(startIso), utcDay(endIso));
      const end = Math.max(utcDay(startIso), utcDay(endIso));
      return end >= monthStart && start <= monthEnd;
    });
  }

  private visibleGanttItems(): TodoItem[] {
    const items = this.monthGanttItems();
    if (this.ganttExpanded || items.length <= 3) {
      return items;
    }
    return items.slice(0, 3);
  }

  private shiftGantt(amount: number) {
    const next = new Date(this.ganttYear, this.ganttMonth - 1 + amount, 1);
    this.ganttYear = next.getFullYear();
    this.ganttMonth = next.getMonth() + 1;
    this.ganttExpanded = false;
    this.paint();
  }

  private ganttWeek(week: Date[]): HTMLElement {
    const row = document.createElement("div");
    row.className = "cdx-todo__gantt-week";
    const today = todayIso();
    week.forEach((date, index) => {
      const iso = isoFromDate(date);
      const cell = document.createElement("div");
      cell.className = "cdx-todo__gantt-day";
      cell.style.gridColumn = String(index + 1);
      if (date.getMonth() !== this.ganttMonth - 1) {
        cell.classList.add("is-out");
      }
      if (index === 0 || index === 6) {
        cell.classList.add("is-weekend");
      }
      const num = document.createElement("span");
      num.className = "cdx-todo__gantt-num";
      num.textContent = String(date.getDate());
      if (iso === today) {
        num.classList.add("is-today");
      }
      cell.append(num);
      row.append(cell);
    });

    const weekStart = utcDay(isoFromDate(week[0]));
    const weekEnd = utcDay(isoFromDate(week[6]));
    const segments: GanttSegment[] = [];
    for (const item of this.visibleGanttItems()) {
      const startIso = item.start || today;
      const endIso = item.end || today;
      const start = Math.min(utcDay(startIso), utcDay(endIso));
      const end = Math.max(utcDay(startIso), utcDay(endIso));
      if (end < weekStart || start > weekEnd) {
        continue;
      }
      const visibleStart = Math.max(start, weekStart);
      const visibleEnd = Math.min(end, weekEnd);
      const shown = displayStatus(item, this.data.notify);
      const overdue = !isEnded(item.status) && Boolean(item.end) && item.end < today;
      segments.push({
        name: item.text.trim() || t("todo.placeholder"),
        status: shown,
        overdue,
        startCol: (visibleStart - weekStart) / DAY + 1,
        endCol: (visibleEnd - weekStart) / DAY + 1,
        from: visibleStart === start,
        to: visibleEnd === end,
      });
    }
    const packed = packGantt(segments);
    for (const { segment, lane } of packed) {
      const bar = document.createElement("div");
      const statusClass =
        segment.status === "in_progress"
          ? "is-progress"
          : segment.status === "done"
            ? "is-done"
            : segment.status === "cancelled"
              ? "is-cancelled"
              : "is-pending";
      bar.className = `cdx-todo__gantt-chip ${statusClass}${segment.overdue ? " is-overdue" : ""}${segment.from ? " is-from" : ""}${segment.to ? " is-to" : ""}`;
      bar.style.gridColumn = `${segment.startCol} / ${segment.endCol + 1}`;
      bar.style.gridRow = String(lane + 2);
      bar.textContent = segment.name;
      bar.title = `${segment.name} · ${statusLabel(segment.status)}${segment.overdue ? ` · ${t("todo.overdue")}` : ""}`;
      row.append(bar);
    }
    return row;
  }

  private footer(): HTMLElement {
    const foot = document.createElement("div");
    foot.className = "cdx-todo__foot";
    const add = document.createElement("button");
    add.type = "button";
    add.className = "cdx-todo__add";
    add.hidden = this.readOnly;
    const addIcon = document.createElement("span");
    addIcon.className = "cdx-todo__add-icon";
    addIcon.innerHTML = ADD_ICON;
    addIcon.setAttribute("aria-hidden", "true");
    const addLabel = document.createElement("span");
    addLabel.textContent = t("todo.add");
    add.append(addIcon, addLabel);
    add.addEventListener("click", () => this.openCreateDetail(this.data.items.at(-1)?.id));

    const views = document.createElement("div");
    views.className = "cdx-todo__views";
    views.append(this.viewButton(false, LIST_ICON, t("todo.list")), this.viewButton(true, GANTT_ICON, t("todo.gantt")));

    foot.append(add, views);
    return foot;
  }

  private viewButton(gantt: boolean, icon: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `cdx-todo__view${this.gantt === gantt ? " is-active" : ""}`;
    button.innerHTML = icon;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", this.gantt === gantt ? "true" : "false");
    button.addEventListener("click", () => {
      if (this.gantt === gantt) {
        return;
      }
      this.gantt = gantt;
      this.paint();
    });
    return button;
  }

  private openCreateDetail(_afterId: string | undefined) {
    if (this.readOnly) {
      return;
    }
    if (!this.onOpenDetail) {
      this.insertBlank(_afterId);
      return;
    }
    this.onOpenDetail({
      creating: true,
      pageId: this.getPageId(),
      draft: { title: "", content: "" },
      onSubmit: async ({ title, content }) => {
        const session = loadSession();
        const pageId = this.getPageId().trim();
        if (!session || !pageId) {
          throw new Error(t("notify.actionFailed"));
        }
        const draft: TodoItem = {
          ...blankItem(),
          text: title.trim(),
          ...(content.trim() ? { content: content.trim() } : {}),
        };
        const listId = (this.data.listId || (await this.readyListId())).trim();
        const payload = upsertPayload(draft, pageId, listId, this.data.notify);
        if (!payload) {
          throw new Error(t("notify.actionFailed"));
        }
        const created = await createTodo(session, payload);
        this.tab = "pending";
        this.gantt = false;
        this.pendingScrollId = created.id;
        this.commit();
      },
    });
  }

  private openEditDetail(item: TodoItem) {
    if (this.readOnly || item.status === "cancelled") {
      return;
    }
    if (!this.onOpenDetail) {
      return;
    }
    this.onOpenDetail({
      creating: false,
      pageId: this.getPageId(),
      draft: { title: item.text, content: item.content ?? "", status: displayStatus(item, this.data.notify) },
      onStatus: async (status) => {
        item.status = status;
        this.tab = status === "in_progress" ? "in_progress" : "ended";
        this.commit();
        await this.syncRemoteTodos();
        this.paint();
      },
      onSubmit: async ({ title, content }) => {
        const session = loadSession();
        const pageId = this.getPageId().trim();
        const listId = (this.data.listId || (await this.readyListId())).trim();
        const remoteId = item.remoteId;
        if (!session || !pageId || !listId || !remoteId) {
          throw new Error(t("notify.actionFailed"));
        }
        const payload = upsertPayload(
          { ...item, text: title.trim(), content: content.trim() || undefined },
          pageId,
          listId,
          this.data.notify,
        );
        if (!payload) {
          throw new Error(t("notify.actionFailed"));
        }
        await updateTodoMergingData(session, remoteId, payload);
        this.commit();
      },
    });
  }

  private insertBlank(id: string | undefined) {
    const item = blankItem();
    const index = id ? this.data.items.findIndex((entry) => entry.id === id) : -1;
    this.data.items.splice(index + 1, 0, item);
    this.tab = "pending";
    this.gantt = false;
    this.pendingScrollId = item.id;
    this.commit();
    this.paint();
    this.wrapper.querySelector<HTMLInputElement>(`[data-todo-focus="${CSS.escape(item.id)}"]`)?.focus({ preventScroll: true });
  }

  private insertAfter(id: string | undefined) {
    this.openCreateDetail(id);
  }

  /** 整块待办删掉，光标落到上一块（最后一条清空后再退格就是这个意图） */
  private deleteBlock() {
    if (this.readOnly) {
      return;
    }
    try {
      const current = this.api.blocks.getCurrentBlockIndex();
      const index = current >= 0 ? current : this.block ? this.api.blocks.getBlockIndex(this.block.id) : -1;
      if (index < 0) {
        return;
      }
      this.api.blocks.delete(index);
      // 删掉之后原来的 index 位置是后一块，光标要给到 index - 1（也就是上一块）
      this.api.caret.setToBlock(Math.max(0, index - 1), "end");
    } catch {
      /* 编辑器状态异常时就不删了，留在原地更安全 */
    }
  }

  private removeItem(id: string) {
    const index = this.data.items.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }
    const item = this.data.items[index];
    const previous = this.data.items[index - 1];
    this.data.items.splice(index, 1);
    this.commit();
    this.paint();
    if (previous) {
      this.wrapper
        .querySelector<HTMLInputElement>(`[data-todo-focus="${CSS.escape(previous.id)}"]`)
        ?.focus({ preventScroll: true });
    }
    const session = loadSession();
    const remoteId = item.remoteId;
    if (!session || !remoteId) return;
    void deleteTodo(session, remoteId).catch((err) => {
      console.warn("[todo-delete]", err);
      if (!this.wrapper.isConnected) return;
      if (this.data.items.some((entry) => entry.id === item.id || entry.remoteId === remoteId)) return;
      this.data.items.splice(Math.min(index, this.data.items.length), 0, item);
      this.paint();
    });
  }
}
