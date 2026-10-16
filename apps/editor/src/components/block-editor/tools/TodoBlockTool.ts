import type { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import { appLocale, t } from "@/i18n";
import { menuIcons } from "../menuIcons";

export type TodoItem = {
  id: string;
  text: string;
  done: boolean;
  /** YYYY-MM-DD，空字符串表示未选 */
  start: string;
  end: string;
};

export type TodoData = {
  items: TodoItem[];
  /** 整块待办共用，不跟某一条绑定 */
  notify: boolean;
};

type Tab = "open" | "done";

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
  return { id: uid(), text: "", done: false, start: today, end: today };
}

function asDate(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeItem(raw: unknown): TodoItem | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const item = raw as Partial<TodoItem>;
  return {
    id: typeof item.id === "string" && item.id ? item.id : uid(),
    text: String(item.text ?? ""),
    done: Boolean(item.done),
    start: asDate(item.start),
    end: asDate(item.end),
  };
}

function normalize(data: Partial<TodoData> | undefined): TodoData {
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items = rawItems.map(normalizeItem).filter((item): item is TodoItem => item !== null);
  const legacyNotify = rawItems.some(
    (raw) => Boolean(raw && typeof raw === "object" && (raw as { notify?: unknown }).notify),
  );
  return {
    items: items.length ? items : [blankItem()],
    notify: Boolean(data?.notify) || legacyNotify,
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
  done: boolean;
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

/** 待办块：未完成/已完成、起止日期、整块通知，以及列表/甘特图页签。 */
export class TodoBlockTool implements BlockTool {
  static get toolbox() {
    return { title: "Todo · todo", icon: menuIcons.todo };
  }

  static get isReadOnlySupported() {
    return true;
  }

  private data: TodoData;
  private readOnly: boolean;
  private block?: { dispatchChange?: () => void };
  private wrapper = document.createElement("div");
  private tab: Tab = "open";
  private gantt = false;
  private ganttYear = 0;
  private ganttMonth = 0;
  private calendar: HTMLDivElement | null = null;
  private calendarAnchor: HTMLElement | null = null;
  private leaveTimers: number[] = [];
  private heightFrame = 0;

  constructor({ data, readOnly, block }: BlockToolConstructorOptions<TodoData>) {
    this.data = normalize(data);
    this.readOnly = Boolean(readOnly);
    this.block = block;
    this.wrapper.className = "cdx-todo";
    this.wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === "Backspace") {
        event.stopPropagation();
      }
    });
  }

  render() {
    this.paint();
    return this.wrapper;
  }

  save(): TodoData {
    return {
      notify: this.data.notify,
      items: this.data.items
        .map((item) => ({
          id: item.id,
          text: item.text.trim(),
          done: item.done,
          start: item.start,
          end: item.end,
        }))
        .filter((item) => item.text || item.start || item.end || item.done),
    };
  }

  destroy() {
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

  private visibleItems(): TodoItem[] {
    return this.data.items.filter((item) => (this.tab === "done" ? item.done : !item.done));
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
    group.append(this.tabButton("open", t("todo.open")), this.tabButton("done", t("todo.done")));
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
    });
    return button;
  }

  private listView(): HTMLElement {
    const list = document.createElement("div");
    list.className = "cdx-todo__list";
    const items = this.visibleItems();
    if (!items.length) {
      list.append(this.emptyState(this.tab === "done" ? t("todo.emptyDone") : t("todo.emptyOpen")));
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
    const row = document.createElement("div");
    row.className = `cdx-todo__item${item.done ? " is-done" : ""}`;

    const check = document.createElement("button");
    check.type = "button";
    check.className = `cdx-todo__check${item.done ? " is-checked" : ""}`;
    check.disabled = this.readOnly;
    check.innerHTML = CHECK_ICON;
    check.setAttribute("aria-pressed", item.done ? "true" : "false");
    check.setAttribute("aria-label", item.done ? t("todo.open") : t("todo.done"));
    check.addEventListener("click", () => {
      if (row.classList.contains("is-striking") || row.classList.contains("is-leaving")) {
        return;
      }
      const markDone = !item.done;
      if (markDone && this.tab === "open") {
        this.finishItem(item, row, check);
        return;
      }
      item.done = markDone;
      this.commit();
      this.paint();
    });

    const body = document.createElement("div");
    body.className = "cdx-todo__body";

    const text = document.createElement("input");
    text.type = "text";
    text.className = "cdx-todo__text";
    text.value = item.text;
    text.placeholder = t("todo.placeholder");
    text.disabled = this.readOnly;
    text.dataset.todoFocus = item.id;
    text.addEventListener("input", () => {
      item.text = text.value;
      this.commit();
    });
    text.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.insertAfter(item.id);
      }
      if (event.key === "Backspace" && text.value === "") {
        event.preventDefault();
        this.removeItem(item.id);
      }
    });

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
    actions.append(this.dateRange(item), remove);

    body.append(text, actions);
    row.append(check, body);
    return row;
  }

  private finishItem(item: TodoItem, row: HTMLElement, check: HTMLButtonElement) {
    item.done = true;
    this.commit();
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cdx-todo__range";
    button.disabled = this.readOnly || item.done;
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
    if (item.done) {
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
    return board;
  }

  private shiftGantt(amount: number) {
    const next = new Date(this.ganttYear, this.ganttMonth - 1 + amount, 1);
    this.ganttYear = next.getFullYear();
    this.ganttMonth = next.getMonth() + 1;
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
    for (const item of this.data.items) {
      const startIso = item.start || today;
      const endIso = item.end || today;
      const start = Math.min(utcDay(startIso), utcDay(endIso));
      const end = Math.max(utcDay(startIso), utcDay(endIso));
      if (end < weekStart || start > weekEnd) {
        continue;
      }
      const visibleStart = Math.max(start, weekStart);
      const visibleEnd = Math.min(end, weekEnd);
      segments.push({
        name: item.text.trim() || t("todo.placeholder"),
        done: item.done,
        startCol: (visibleStart - weekStart) / DAY + 1,
        endCol: (visibleEnd - weekStart) / DAY + 1,
        from: visibleStart === start,
        to: visibleEnd === end,
      });
    }
    const packed = packGantt(segments);
    for (const { segment, lane } of packed) {
      const bar = document.createElement("div");
      bar.className = `cdx-todo__gantt-chip${segment.done ? " is-done" : ""}${segment.from ? " is-from" : ""}${segment.to ? " is-to" : ""}`;
      bar.style.gridColumn = `${segment.startCol} / ${segment.endCol + 1}`;
      bar.style.gridRow = String(lane + 2);
      bar.textContent = segment.name;
      bar.title = segment.name;
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
    add.addEventListener("click", () => this.insertAfter(this.data.items.at(-1)?.id));

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

  private insertAfter(id: string | undefined) {
    const item = blankItem();
    const index = id ? this.data.items.findIndex((entry) => entry.id === id) : -1;
    this.data.items.splice(index + 1, 0, item);
    this.tab = "open";
    this.gantt = false;
    this.commit();
    this.paint();
    this.wrapper.querySelector<HTMLInputElement>(`[data-todo-focus="${CSS.escape(item.id)}"]`)?.focus();
  }

  private removeItem(id: string) {
    const index = this.data.items.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }
    this.data.items.splice(index, 1);
    this.commit();
    this.paint();
  }
}
