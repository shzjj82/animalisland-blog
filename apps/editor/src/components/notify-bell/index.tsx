import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckOne, Edit, Remind } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverSeparator, PopoverTrigger } from "@/components/ui/popover";
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
import type { RemoteSession } from "@/store/remoteStore";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const POLL_MS = 60_000;

type Tab = "todos" | "notices";

type Props = {
  session: RemoteSession | null;
  className?: string;
  onWriteTodo?: (todo: NotifyTodo) => void | Promise<void>;
};

function formatTime(value: string | null, locale: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function NotifyBell({ session, className, onWriteTodo }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("todos");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NotifySnapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    if (!quiet) {
      setLoading(true);
      setError(null);
    }
    try {
      setSnapshot(await fetchNotifySnapshot(session));
    } catch (err) {
      if (!quiet) {
        setError(err instanceof Error ? err.message : t("notify.loadFailed"));
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [session, t]);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      setLive(false);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(true), POLL_MS);
    const stopSocket = connectNotifySocket(session, (event) => {
      if (event.type === "ready") {
        setLive(true);
        void refresh(true);
        return;
      }
      if (event.type === "error") {
        setLive(false);
        return;
      }
      if (event.type === "event") {
        if (event.kind === "notice" && event.action === "created") {
          setTab("notices");
        }
        if (event.kind === "todo" && event.action === "created") {
          setTab("todos");
        }
        void refresh(true);
      }
    });
    return () => {
      window.clearInterval(timer);
      stopSocket();
      setLive(false);
    };
  }, [session, refresh]);

  useEffect(() => {
    if (open && session) {
      void refresh();
    }
  }, [open, session, refresh]);

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
    if (!onWriteTodo) return;
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
          <Remind {...iconProps} />
          {badge > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-destructive-foreground">
              {badge > 99 ? "99+" : badge}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm font-medium text-foreground">{t("notify.title")}</div>
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  live ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
                title={live ? t("notify.liveOn") : t("notify.liveOff")}
              />
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {t("notify.progress", { open: openTodos, unread })}
            </div>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>
            {loading ? t("notify.refreshing") : t("notify.refresh")}
          </Button>
        </div>
        <div className="flex gap-1 border-b border-border px-2 py-1">
          <TabButton active={tab === "todos"} onClick={() => setTab("todos")} count={openTodos}>
            {t("notify.todos")}
          </TabButton>
          <TabButton active={tab === "notices"} onClick={() => setTab("notices")} count={unread}>
            {t("notify.notices")}
          </TabButton>
        </div>
        {error ? <div className="px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="max-h-80 overflow-y-auto p-1">
          {tab === "todos" ? (
            todos.length === 0 ? (
              <Empty>{t("notify.emptyTodos")}</Empty>
            ) : (
              todos.map((todo) => {
                const writing = busyId === `write:${todo.id}`;
                const finishing = busyId === todo.id;
                return (
                  <div key={todo.id} className="flex items-start gap-1 rounded-md px-2 py-2 hover:bg-muted">
                    <button
                      type="button"
                      className="min-w-0 flex-1 rounded-sm text-left disabled:opacity-50"
                      disabled={writing || !onWriteTodo}
                      onClick={() => void onWrite(todo)}
                    >
                      <div className="truncate text-sm text-foreground">{todo.title || t("notify.untitled")}</div>
                      {todo.content ? (
                        <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{todo.content}</div>
                      ) : (
                        <div className="mt-0.5 text-xs text-muted-foreground">{t("notify.writeHint")}</div>
                      )}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {[
                          todo.dueAt ? t("notify.due", { time: formatTime(todo.dueAt, i18n.language) }) : null,
                          formatTime(todo.createdAt, i18n.language),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </button>
                    <div className="flex shrink-0 flex-col gap-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={writing || !onWriteTodo}
                        aria-label={t("notify.write")}
                        title={t("notify.write")}
                        onClick={() => void onWrite(todo)}
                      >
                        <Edit {...iconProps} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={finishing}
                        aria-label={t("notify.markDone")}
                        title={t("notify.markDone")}
                        onClick={() => void onDone(todo)}
                      >
                        <CheckOne {...iconProps} />
                      </Button>
                    </div>
                  </div>
                );
              })
            )
          ) : notices.length === 0 ? (
            <Empty>{t("notify.emptyNotices")}</Empty>
          ) : (
            <>
              <div className="flex justify-end px-2 py-1">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  disabled={busyId === "all" || unread === 0}
                  onClick={() => void onReadAll()}
                >
                  {t("notify.readAll")}
                </button>
              </div>
              <PopoverSeparator />
              {notices.map((notice) => (
                <button
                  key={notice.id}
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-50"
                  disabled={busyId === notice.id}
                  onClick={() => void onRead(notice)}
                >
                  <div className="w-full truncate text-sm text-foreground">{notice.title}</div>
                  {notice.content ? (
                    <div className="line-clamp-2 text-xs text-muted-foreground">{notice.content}</div>
                  ) : null}
                  <div className="text-[11px] text-muted-foreground">{formatTime(notice.createdAt, i18n.language)}</div>
                </button>
              ))}
            </>
          )}
        </div>
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
        "flex h-8 flex-1 items-center justify-center gap-1 rounded-md text-xs",
        active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60",
      )}
      onClick={onClick}
    >
      <span>{children}</span>
      {count > 0 ? <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px]">{count}</span> : null}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-8 text-center text-xs text-muted-foreground">{children}</div>;
}
