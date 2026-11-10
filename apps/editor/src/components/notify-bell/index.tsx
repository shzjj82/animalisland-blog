import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckOne, Remind, Time } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  fetchNotifySnapshot,
  markAllNoticesRead,
  markNoticeRead,
  markTodoDone,
  type NotifyNotice,
  type NotifySnapshot,
  type NotifyTodo,
} from "@/store/notifyStore";
import { connectNotifySocket } from "@/store/notifySocket";
import { iconParkOutline } from "@/lib/iconPark";
import type { RemoteSession } from "@/store/remoteStore";

type Tab = "todos" | "notices";

type Props = {
  session: RemoteSession | null;
  className?: string;
  onWriteTodo?: (todo: NotifyTodo) => void | Promise<void>;
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
  const start = typeof todo.data?.start === "string" ? todo.data.start : "";
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

export function NotifyBell({ session, className, onWriteTodo }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("todos");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NotifySnapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    try {
      setSnapshot(await fetchNotifySnapshot(session));
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
    void refresh();
    const stopSocket = connectNotifySocket(session, (event) => {
      if (event.type === "ready") {
        void refresh();
        return;
      }
      if (event.type === "error") {
        return;
      }
      if (event.type === "event") {
        if (event.kind === "notice" && event.action === "created") {
          setTab("notices");
        }
        if (event.kind === "todo" && event.action === "created") {
          setTab("todos");
        }
        void refresh();
      }
    });
    return () => {
      stopSocket();
    };
  }, [session, refresh]);

  if (!session) {
    return null;
  }
  const activeSession = session;

  const openTodos = snapshot?.openTodoCount ?? 0;
  const unread = snapshot?.unreadNoticeCount ?? 0;
  const badge = openTodos + unread;
  const todos = snapshot?.todos ?? [];
  const notices = snapshot?.notices ?? [];

  async function onDone(todo: NotifyTodo) {
    setBusyId(todo.id);
    try {
      await markTodoDone(activeSession, todo.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notify.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

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

  async function onRead(notice: NotifyNotice) {
    setBusyId(notice.id);
    try {
      await markNoticeRead(activeSession, notice.id);
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn("relative", className)}
          aria-label={t("notify.title")}
        >
          <Remind {...iconParkOutline} size={16} />
          {badge > 0 ? <span className="absolute top-1 right-1 size-1.5 rounded-full bg-red-500" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden p-0">
        <div className="grid grid-cols-2 border-b border-border/50">
          <TabButton active={tab === "todos"} count={openTodos} onClick={() => setTab("todos")}>
            <CheckOne {...iconParkOutline} size={14} />
            {t("notify.todos")}
          </TabButton>
          <TabButton active={tab === "notices"} count={unread} onClick={() => setTab("notices")}>
            <Remind {...iconParkOutline} size={14} />
            {t("notify.notices")}
          </TabButton>
        </div>
        {error ? <div className="px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <SoftScrollbar className="max-h-80" contentClassName="p-1.5">
          {tab === "todos" ? (
            todos.length === 0 ? (
              <Empty>{t("notify.emptyTodos")}</Empty>
            ) : (
              todos.map((todo) => {
                const due = todoDue(todo, i18n.language);
                const writing = busyId === `write:${todo.id}`;
                const finishing = busyId === todo.id;
                return (
                  <div key={todo.id} className="group flex items-center gap-1 rounded-xl px-2 py-2 hover:bg-muted/70">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left disabled:opacity-50"
                      disabled={writing || !onWriteTodo}
                      onClick={() => void onWrite(todo)}
                    >
                      <span className="block truncate text-sm font-medium">{todo.title.trim() || t("notify.untitled")}</span>
                      {due ? (
                        <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                          <Time {...iconParkOutline} size={12} />
                          {due}
                        </span>
                      ) : null}
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      disabled={finishing}
                      aria-label={t("notify.markDone")}
                      onClick={() => void onDone(todo)}
                    >
                      <CheckOne {...iconParkOutline} size={16} />
                    </Button>
                  </div>
                );
              })
            )
          ) : notices.length === 0 ? (
            <Empty>{t("notify.emptyNotices")}</Empty>
          ) : (
            <>
              {unread > 0 ? (
                <div className="flex justify-end px-1 pb-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    disabled={busyId === "all"}
                    aria-label={t("notify.readAll")}
                    onClick={() => void onReadAll()}
                  >
                    <CheckOne {...iconParkOutline} size={14} />
                  </Button>
                </div>
              ) : null}
              {notices.map((notice) => (
                <button
                  key={notice.id}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-xl px-2 py-2 text-left hover:bg-muted/70 disabled:opacity-50"
                  disabled={busyId === notice.id}
                  onClick={() => void onRead(notice)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{notice.title}</span>
                    {notice.content.trim() ? (
                      <span className="text-muted-foreground mt-0.5 line-clamp-2 block text-xs">{notice.content}</span>
                    ) : null}
                    <span className="text-muted-foreground mt-0.5 flex items-center gap-1 text-[11px]">
                      <Time {...iconParkOutline} size={12} />
                      {formatWhen(notice.createdAt, i18n.language)}
                    </span>
                  </span>
                </button>
              ))}
            </>
          )}
        </SoftScrollbar>
      </PopoverContent>
    </Popover>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-10 items-center justify-center gap-1.5 text-xs",
        active ? "border-b-2 border-foreground font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
      {count > 0 ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none">{count}</span> : null}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-muted-foreground px-3 py-10 text-center text-xs">{children}</div>;
}
