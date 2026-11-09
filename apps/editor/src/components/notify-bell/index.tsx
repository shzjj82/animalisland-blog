import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckOne, Edit, Remind } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  fetchNotifySnapshot,
  markTodoDone,
  type NotifySnapshot,
  type NotifyTodo,
} from "@/store/notifyStore";
import type { RemoteSession } from "@/store/remoteStore";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const POLL_MS = 60_000;

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<NotifySnapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchNotifySnapshot(session));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("notify.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [session, t]);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
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
  const todos = snapshot?.todos ?? [];

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
          {openTodos > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-destructive-foreground">
              {openTodos > 99 ? "99+" : openTodos}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1.5rem))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{t("notify.title")}</div>
            <div className="truncate text-xs text-muted-foreground">{t("notify.progress", { open: openTodos })}</div>
          </div>
          <Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void refresh()}>
            {loading ? t("notify.refreshing") : t("notify.refresh")}
          </Button>
        </div>
        {error ? <div className="px-3 py-2 text-xs text-destructive">{error}</div> : null}
        <div className="max-h-80 overflow-y-auto p-1">
          {todos.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-muted-foreground">{t("notify.emptyTodos")}</div>
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
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
