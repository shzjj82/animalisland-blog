import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Remind } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/lib/useMediaQuery";
import { cn } from "@/lib/utils";
import {
  cachedTodoTasks,
  fineTodoStatus,
  loadNotifySnapshot,
  markAllNoticesRead,
  markNoticeRead,
  noticeKind,
  pageIdFromNotice,
  peekNotifySnapshot,
  subscribeNotifySnapshot,
  subscribeTodoTasks,
  todoContentPreview,
  type NotifyNotice,
  type NotifySnapshot,
  type NotifyTodo,
} from "@/store/notifyStore";
import { retainNotifySocket } from "@/store/notifySocket";
import { iconParkOutline } from "@/lib/iconPark";
import type { RemoteSession } from "@/store/remoteStore";
import { TodoDetailDialog, type TodoDetailTarget } from "./TodoDetailDialog";

type Tab = "unread" | "read" | "todos";
type EmptyKind = "unread" | "read" | "todos";

/** 单卡固定高；列表视口 = 4 卡 + 3 间距(space-y-1.5) + 内边距(p-2) */
const NOTIFY_CARD_H = "h-[4.5rem]";
const NOTIFY_LIST_H = "h-[calc(4*4.5rem+3*0.375rem+1rem)]";

type Props = {
  session: RemoteSession | null;
  className?: string;
  onWriteTodo?: (todo: NotifyTodo) => void | Promise<void>;
  onOpenPage?: (pageId: string) => void | Promise<void>;
};

function formatDay(value: string, locale: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function formatWhen(value: string | null, locale: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function todoDue(todo: NotifyTodo, locale: string): string {
  const start =
    (typeof todo.startsAt === "string" && todo.startsAt) ||
    (typeof todo.data?.start === "string" ? todo.data.start : "");
  const end = typeof todo.data?.end === "string" ? todo.data.end : "";
  if (start && end && start !== end) {
    const a = formatDay(start, locale);
    const b = formatDay(end, locale);
    return a && b ? `${a} – ${b}` : a || b;
  }
  if (end) {
    return formatDay(end, locale);
  }
  return formatWhen(todo.dueAt, locale);
}

function todoStatusKey(todo: NotifyTodo): "notify.statusInProgress" | "notify.statusPending" {
  return fineTodoStatus(todo) === "in_progress" ? "notify.statusInProgress" : "notify.statusPending";
}

function noticeKindKey(
  notice: NotifyNotice,
): "notify.noticeStarted" | "notify.noticeProgress" | "notify.noticeOverdue" | null {
  const kind = noticeKind(notice);
  if (kind === "todo.started") return "notify.noticeStarted";
  if (kind === "todo.progress") return "notify.noticeProgress";
  if (kind === "todo.overdue") return "notify.noticeOverdue";
  return null;
}

export function NotifyBell({ session, className, onWriteTodo, onOpenPage }: Props) {
  const { t, i18n } = useTranslation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("unread");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NotifySnapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TodoDetailTarget | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    try {
      setSnapshot(await loadNotifySnapshot(session));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notify.loadFailed"));
    }
  }, [session, t]);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    void loadNotifySnapshot(session).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("notify.loadFailed"));
    });
    const stopLive = subscribeNotifySnapshot(() => {
      const next = peekNotifySnapshot();
      if (next) setSnapshot(next);
    });
    const stopTasks = subscribeTodoTasks(() => {
      setSnapshot((prev) => (prev ? { ...prev, todos: cachedTodoTasks() } : prev));
    });
    const stopSocket = retainNotifySocket(session, (event) => {
      if (event.type !== "event") return;
      if (event.kind === "notice" && event.action === "created") {
        setTab("unread");
      }
      if (event.kind === "todo" && event.action === "created") {
        setTab("todos");
      }
      void loadNotifySnapshot(session);
    });
    return () => {
      stopLive();
      stopTasks();
      stopSocket();
    };
  }, [session, t]);

  if (!session) {
    return null;
  }
  const activeSession = session;

  const openTodos = snapshot?.openTodoCount ?? 0;
  const unread = snapshot?.unreadNoticeCount ?? 0;
  const todos = snapshot?.todos ?? [];
  const unreadNotices = snapshot?.notices ?? [];
  const readNotices = snapshot?.readNotices ?? [];
  const noticeRows = tab === "unread" ? unreadNotices.length > 0 : tab === "read" ? readNotices.length > 0 : false;

  async function onWrite(todo: NotifyTodo) {
    if (!onWriteTodo) {
      return;
    }
    setBusyId(`write:${todo.id}`);
    try {
      await onWriteTodo(todo);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notify.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function onOpenNotice(notice: NotifyNotice, markRead: boolean) {
    setBusyId(notice.id);
    try {
      if (markRead) {
        await markNoticeRead(activeSession, notice.id);
      }
      const pageId = pageIdFromNotice(notice);
      if (pageId && onOpenPage) {
        await onOpenPage(pageId);
        setOpen(false);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notify.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function onReadAll() {
    setBusyId("all");
    try {
      await markAllNoticesRead(activeSession);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notify.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  function openDetail(todo: NotifyTodo) {
    setDetail({ mode: "edit", todo });
    setOpen(false);
  }

  function patchTodoInSnapshot(next: NotifyTodo) {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        todos: prev.todos.map((item) => (item.id === next.id ? { ...item, ...next } : item)),
      };
    });
    setDetail((prev) => (prev?.mode === "edit" && prev.todo.id === next.id ? { mode: "edit", todo: { ...prev.todo, ...next } } : prev));
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={cn("relative", className)}
      aria-label={t("notify.title")}
      onClick={isMobile ? () => setOpen(true) : undefined}
    >
      <Remind {...iconParkOutline} size={16} />
      {unread > 0 ? (
        <span aria-hidden className="notify-bell-dot absolute top-1 right-1 size-1.5 rounded-full bg-red-500" />
      ) : null}
    </Button>
  );

  const panel = (
    <>
      <div className="border-border/50 flex shrink-0 items-center gap-1 border-b px-3 pt-1">
        <LineTab active={tab === "unread"} count={unread} onClick={() => setTab("unread")}>
          {t("notify.unread")}
        </LineTab>
        <LineTab active={tab === "read"} onClick={() => setTab("read")}>
          {t("notify.read")}
        </LineTab>
        <LineTab active={tab === "todos"} count={openTodos} onClick={() => setTab("todos")}>
          {t("notify.todos")}
        </LineTab>
        {tab === "unread" && unread > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="text-muted-foreground ml-auto h-7 shrink-0 px-2 text-[11px]"
            disabled={busyId === "all"}
            onClick={() => void onReadAll()}
          >
            {t("notify.readAll")}
          </Button>
        ) : null}
      </div>
      {error ? <div className="shrink-0 px-3 py-2 text-xs text-destructive">{error}</div> : null}
      <SoftScrollbar
        key={tab}
        className={cn(NOTIFY_LIST_H, noticeRows ? "bg-background" : "bg-muted/30")}
        contentClassName={cn("min-h-full", noticeRows ? "" : "space-y-1.5 p-2")}
      >
        {tab === "todos" ? (
          <TodoList todos={todos} locale={i18n.language} onOpen={openDetail} />
        ) : tab === "unread" ? (
          <NoticeList
            notices={unreadNotices}
            busyId={busyId}
            locale={i18n.language}
            emptyKind="unread"
            empty={t("notify.emptyUnread")}
            unread
            onOpen={(notice) => void onOpenNotice(notice, true)}
          />
        ) : (
          <NoticeList
            notices={readNotices}
            busyId={busyId}
            locale={i18n.language}
            emptyKind="read"
            empty={t("notify.emptyRead")}
            unread={false}
            onOpen={(notice) => void onOpenNotice(notice, false)}
          />
        )}
      </SoftScrollbar>
    </>
  );

  return (
    <>
      {isMobile ? (
        <>
          {trigger}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              className={cn(
                "fixed inset-x-0 bottom-0 top-auto left-0 z-50 flex w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl rounded-b-none p-0 shadow-[0_-12px_40px_rgb(0_0_0/0.16)]",
                "pb-[env(safe-area-inset-bottom,0px)]",
                "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom duration-200",
              )}
            >
              <DialogTitle className="sr-only">{t("notify.title")}</DialogTitle>
              <div className="flex shrink-0 justify-center pt-2.5 pb-1" aria-hidden>
                <span className="h-1 w-10 rounded-full bg-muted-foreground/30" />
              </div>
              {panel}
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="end"
            className="flex w-[min(22.5rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0 origin-top-right duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
          >
            {panel}
          </PopoverContent>
        </Popover>
      )}

      <TodoDetailDialog
        session={activeSession}
        target={detail}
        dueLabel={detail?.mode === "edit" ? todoDue(detail.todo, i18n.language) : ""}
        onClose={() => setDetail(null)}
        onSaved={(todo) => {
          patchTodoInSnapshot(todo);
          void refresh();
        }}
        onDone={() => {
          setDetail(null);
          void refresh();
        }}
        onOpenPage={onWriteTodo ? (todo) => onWrite(todo) : undefined}
      />
    </>
  );
}

function LineTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex h-9 shrink-0 items-center gap-1 px-2.5 text-[12px] transition-colors",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      <span>{children}</span>
      {typeof count === "number" && count > 0 ? (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none tabular-nums text-muted-foreground">
          {count}
        </span>
      ) : null}
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground transition-opacity duration-200",
          active ? "opacity-100" : "opacity-0",
        )}
      />
    </button>
  );
}

function TodoList({
  todos,
  locale,
  onOpen,
}: {
  todos: NotifyTodo[];
  locale: string;
  onOpen: (todo: NotifyTodo) => void;
}) {
  const { t } = useTranslation();
  if (todos.length === 0) {
    return <Empty kind="todos" label={t("notify.emptyTodos")} />;
  }
  return (
    <>
      {todos.map((todo, index) => {
        const due = todoDue(todo, locale);
        const inProgress = fineTodoStatus(todo) === "in_progress";
        const status = t(todoStatusKey(todo));
        const preview = todoContentPreview(todo);
        const title = todo.title.trim() || t("notify.untitled");
        return (
          <button
            key={todo.id}
            type="button"
            className={cn(
              NOTIFY_CARD_H,
              "group relative flex w-full flex-col overflow-hidden rounded-xl border bg-background pl-4 pr-3 pt-2.5 pb-2 text-left shadow-sm",
              "border-border/55 transition-[box-shadow,border-color] duration-200 ease-out",
              "hover:border-border hover:shadow-md",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              "motion-reduce:transition-none",
            )}
            style={{ animation: "notify-card-in 220ms ease-out backwards", animationDelay: `${Math.min(index, 6) * 35}ms` }}
            onClick={() => onOpen(todo)}
          >
            <span
              aria-hidden
              className={cn(
                "absolute inset-y-2.5 left-2 w-0.5 rounded-full",
                inProgress ? "bg-[#2f5fad]/80" : "bg-muted-foreground/25",
              )}
            />
            <span className="block truncate text-[13px] font-medium leading-5 tracking-tight text-foreground">{title}</span>
            {preview ? (
              <span className="mt-0.5 line-clamp-1 text-[11px] leading-4 text-muted-foreground">{preview}</span>
            ) : null}
            <span className="mt-auto flex items-center gap-2 pt-1.5">
              <span
                className={cn(
                  "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                  inProgress ? "bg-[#e7f0ff] text-[#2f5fad]" : "bg-[#ebeae6] text-[#6f6e69]",
                )}
              >
                {status}
              </span>
              {due ? (
                <span className="ml-auto min-w-0 truncate text-right text-[10px] leading-none tabular-nums text-muted-foreground/85">
                  {due}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </>
  );
}

function NoticeList({
  notices,
  busyId,
  locale,
  emptyKind,
  empty,
  unread,
  onOpen,
}: {
  notices: NotifyNotice[];
  busyId: string | null;
  locale: string;
  emptyKind: EmptyKind;
  empty: string;
  unread: boolean;
  onOpen: (notice: NotifyNotice) => void;
}) {
  const { t } = useTranslation();
  if (notices.length === 0) {
    return <Empty kind={emptyKind} label={empty} />;
  }
  return (
    <>
      {notices.map((notice) => {
        const line = notice.title.trim() || notice.content.trim() || t("notify.untitled");
        const when = formatWhen(notice.createdAt, locale);
        const kindKey = noticeKindKey(notice);
        const kind = kindKey ? t(kindKey) : "";
        const reading = busyId === notice.id;
        return (
          <button
            key={notice.id}
            type="button"
            className={cn(
              "flex h-10 w-full items-center gap-2 border-b border-border/40 px-3 text-left transition-colors duration-150 last:border-b-0 motion-reduce:transition-none",
              reading ? "pointer-events-none opacity-40" : "hover:bg-muted/50",
              !unread && "opacity-80",
            )}
            disabled={reading}
            onClick={() => onOpen(notice)}
          >
            {unread ? <span className="size-1.5 shrink-0 rounded-full bg-red-500" /> : <span className="size-1.5 shrink-0" />}
            {kind ? <span className="shrink-0 text-[11px] leading-none text-muted-foreground">{kind}</span> : null}
            <span className="min-w-0 flex-1 truncate text-[13px] leading-5 text-foreground">{line}</span>
            {when ? <span className="shrink-0 text-[11px] leading-none tabular-nums text-muted-foreground">{when}</span> : null}
          </button>
        );
      })}
    </>
  );
}

function EmptyIllustration({ kind }: { kind: EmptyKind }) {
  if (kind === "todos") {
    return (
      <svg width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">
        <ellipse cx="60" cy="78" rx="36" ry="5" fill="#f1f1ef" />
        <g stroke="#191919" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="28" y="14" width="64" height="54" rx="8" fill="#fff" />
          <circle cx="42" cy="30" r="5" fill="#fff" />
          <path d="M40 30h4M42 28v4" />
          <path d="M54 30h26" />
          <circle cx="42" cy="46" r="5" fill="#fff" />
          <path d="M39.5 46.5 41.2 48.2 45 44.4" />
          <path d="M54 46h22" />
          <path d="M54 60h16" opacity="0.45" />
        </g>
      </svg>
    );
  }
  if (kind === "read") {
    return (
      <svg width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">
        <ellipse cx="60" cy="78" rx="36" ry="5" fill="#f1f1ef" />
        <g stroke="#191919" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 28h60v36a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V28Z" fill="#fff" />
          <path d="M30 28 60 48l30-20" fill="#f7f7f5" />
          <path d="M44 58h20" opacity="0.45" />
          <circle cx="86" cy="58" r="10" fill="#fff" />
          <path d="m81.5 58.5 3 3 6.5-7" />
        </g>
      </svg>
    );
  }
  return (
    <svg width="120" height="88" viewBox="0 0 120 88" fill="none" aria-hidden="true">
      <ellipse cx="60" cy="78" rx="36" ry="5" fill="#f1f1ef" />
      <g stroke="#191919" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 28h60v36a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V28Z" fill="#fff" />
        <path d="M30 28 60 48l30-20" fill="#f7f7f5" />
        <path d="M44 58h32" opacity="0.45" />
      </g>
    </svg>
  );
}

function Empty({ kind, label }: { kind: EmptyKind; label: string }) {
  return (
    <div className="flex h-[calc(4*4.5rem+3*0.375rem)] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-background/70 px-4 text-center">
      <EmptyIllustration kind={kind} />
      <p className="text-muted-foreground max-w-[12rem] text-xs leading-5">{label}</p>
    </div>
  );
}
