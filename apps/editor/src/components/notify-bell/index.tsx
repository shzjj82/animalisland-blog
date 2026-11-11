import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { CheckOne, Remind } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  fetchNotifySnapshot,
  markAllNoticesRead,
  markNoticeRead,
  markTodoDone,
  pageIdFromNotice,
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

export function NotifyBell({ session, className, onWriteTodo, onOpenPage }: Props) {
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
      <PopoverContent
        align="end"
        className="w-[min(22rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden p-0 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 motion-reduce:animate-none"
      >
        <div className="relative m-2 grid grid-cols-2 rounded-lg bg-muted/60 p-1">
          <span
            aria-hidden
            className="absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-md bg-background shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none"
            style={{ transform: tab === "notices" ? "translateX(100%)" : "translateX(0)" }}
          />
          <TabButton active={tab === "todos"} count={openTodos} onClick={() => setTab("todos")}>
            <CheckOne {...iconParkOutline} size={14} />
            {t("notify.todos")}
          </TabButton>
          <TabButton active={tab === "notices"} count={unread} onClick={() => setTab("notices")}>
            <Remind {...iconParkOutline} size={14} />
            {t("notify.notices")}
          </TabButton>
        </div>
        {error ? <div className="px-3 pb-2 text-xs text-destructive">{error}</div> : null}
        <SoftScrollbar key={tab} className="max-h-96 bg-muted/30" contentClassName="space-y-1.5 p-2.5 pt-1">
          {tab === "todos" ? (
            todos.length === 0 ? (
              <Empty>{t("notify.emptyTodos")}</Empty>
            ) : (
              todos.map((todo, index) => {
                const due = todoDue(todo, i18n.language);
                const writing = busyId === `write:${todo.id}`;
                const finishing = busyId === todo.id;
                return (
                  <div
                    key={todo.id}
                    className={cn(
                      "group relative rounded-xl border border-border/60 bg-background shadow-sm transition-[transform,opacity,box-shadow] duration-200 ease-out motion-reduce:transition-none",
                      finishing ? "pointer-events-none scale-[0.98] opacity-0" : "hover:-translate-y-0.5 hover:shadow-md",
                    )}
                    style={{ animation: "notify-card-in 220ms ease-out backwards", animationDelay: `${Math.min(index, 6) * 35}ms` }}
                  >
                    <button
                      type="button"
                      className="flex min-h-16 w-full flex-col justify-between px-3 pt-2 pb-2.5 pr-9 text-left disabled:opacity-50"
                      disabled={writing || !onWriteTodo}
                      onClick={() => void onWrite(todo)}
                    >
                      {due ? <span className="text-muted-foreground text-[10px] leading-none tabular-nums">{due}</span> : <span />}
                      <span className="block truncate pt-3 text-[13px] leading-5 font-medium">{todo.title.trim() || t("notify.untitled")}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground absolute right-1.5 bottom-1.5 transition-transform duration-200 hover:scale-110 active:scale-90 motion-reduce:transition-none"
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
                <div className="flex justify-end px-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="text-muted-foreground h-6 px-2 text-[11px]"
                    disabled={busyId === "all"}
                    onClick={() => void onReadAll()}
                  >
                    {t("notify.readAll")}
                  </Button>
                </div>
              ) : null}
              {notices.map((notice, index) => {
                const line = notice.title.trim() || notice.content.trim() || t("notify.untitled");
                const when = formatWhen(notice.createdAt, i18n.language);
                const reading = busyId === notice.id;
                return (
                  <button
                    key={notice.id}
                    type="button"
                    className={cn(
                      "flex min-h-16 w-full flex-col justify-between rounded-xl border border-border/60 bg-background px-3 pt-2 pb-2.5 text-left shadow-sm transition-[transform,opacity,box-shadow] duration-200 ease-out motion-reduce:transition-none",
                      reading ? "pointer-events-none scale-[0.98] opacity-0" : "hover:-translate-y-0.5 hover:shadow-md",
                    )}
                    style={{ animation: "notify-card-in 220ms ease-out backwards", animationDelay: `${Math.min(index, 6) * 35}ms` }}
                    disabled={reading}
                    onClick={() => void onRead(notice)}
                  >
                    <span className="flex items-center gap-1.5">
                      <span className="size-1.5 shrink-0 rounded-full bg-red-500" />
                      {when ? <span className="text-muted-foreground text-[10px] leading-none tabular-nums">{when}</span> : null}
                    </span>
                    <span className="block truncate pt-3 text-[13px] leading-5 font-medium">{line}</span>
                  </button>
                );
              })}
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
        "relative z-10 flex h-8 items-center justify-center gap-1.5 rounded-md text-xs transition-colors duration-200",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
      {count > 0 ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none">{count}</span> : null}
    </button>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="text-muted-foreground rounded-xl border border-dashed border-border/70 bg-background/70 px-3 py-10 text-center text-xs">
      {children}
    </div>
  );
}
