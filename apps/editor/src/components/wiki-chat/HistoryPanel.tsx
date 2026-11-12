import { useMemo, useState } from "react";
import { Delete, Plus, Search } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { historyGroup, plainTalk, threadPreview, type HistoryGroupId, type WikiThread } from "@/lib/ai/wikiChatHistory";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

export const HISTORY_SIDEBAR_W = 268;

type Props = {
  threads: WikiThread[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  className?: string;
  /** 不传则用桌面侧栏固定宽度 */
  width?: number | string;
};

const GROUP_ORDER: HistoryGroupId[] = ["today", "yesterday", "week", "older"];
const GROUP_KEY = {
  today: "wikiAsk.historyToday",
  yesterday: "wikiAsk.historyYesterday",
  week: "wikiAsk.historyWeek",
  older: "wikiAsk.historyOlder",
} as const;

function formatChatTime(value: number, locale: string, group: HistoryGroupId, yesterday: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  try {
    if (group === "today") {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    }
    if (group === "yesterday") {
      return yesterday;
    }
    if (group === "week") {
      return new Intl.DateTimeFormat(locale, { weekday: "short" }).format(date);
    }
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat(locale, sameYear ? { month: "numeric", day: "numeric" } : { year: "numeric", month: "numeric", day: "numeric" }).format(date);
  } catch {
    return "";
  }
}

export function HistoryPanel({ threads, activeId, onNew, onOpen, onDelete, className, width = HISTORY_SIDEBAR_W }: Props) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? threads.filter((thread) => `${thread.title} ${threadPreview(thread)}`.toLowerCase().includes(q))
      : threads;
    return GROUP_ORDER.map((id) => ({
      id,
      items: matched.filter((thread) => historyGroup(thread.updatedAt) === id),
    })).filter((group) => group.items.length);
  }, [threads, query]);

  return (
    <aside
      className={cn("flex h-full shrink-0 flex-col border-r border-border/40 bg-muted/30", className)}
      style={{ width }}
    >
      <div className="flex shrink-0 items-center gap-1 px-2.5 pt-2.5">
        <div className="relative min-w-0 flex-1">
          <Search
            {...iconParkOutline}
            size={14}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("wikiAsk.historySearch")}
            aria-label={t("wikiAsk.historySearch")}
            className="h-8 bg-background pl-7"
          />
        </div>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("wikiAsk.newChat")} onClick={onNew}>
          <Plus {...iconParkOutline} size={14} />
        </Button>
      </div>
      {groups.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-3 pb-3">
          <p className="text-muted-foreground flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/60 px-3 text-center text-xs">
            {t(query.trim() ? "wikiAsk.historyNoMatch" : "wikiAsk.historyEmpty")}
          </p>
        </div>
      ) : (
        <SoftScrollbar className="min-h-0 flex-1" contentClassName="px-2.5 pb-3">
          {groups.map((group) => (
            <section key={group.id} className="mt-3">
              <h2 className="text-muted-foreground px-1 pb-1.5 text-[10px] font-medium tracking-wide">{t(GROUP_KEY[group.id])}</h2>
              <ul className="space-y-1.5">
                {group.items.map((thread) => {
                  const title = plainTalk(thread.title) || t("wikiAsk.untitledChat");
                  const current = thread.id === activeId;
                  const when = formatChatTime(thread.updatedAt, i18n.language, group.id, t("wikiAsk.historyYesterday"));
                  return (
                    <li key={thread.id}>
                      <div
                        className={cn(
                          "group relative rounded-xl border bg-background shadow-sm",
                          current ? "border-foreground/25 shadow-md" : "border-border/60 hover:border-border",
                        )}
                      >
                        <button type="button" className="flex min-h-16 w-full flex-col justify-between px-3 pt-2 pb-2.5 pr-7 text-left" onClick={() => onOpen(thread.id)}>
                          {when ? <span className="text-muted-foreground text-[10px] leading-none tabular-nums">{when}</span> : <span />}
                          <span className="block truncate pt-3 text-[13px] leading-5 font-medium">{title}</span>
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="absolute top-1 right-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                          aria-label={t("wikiAsk.deleteChat")}
                          onClick={() => onDelete(thread.id)}
                        >
                          <Delete {...iconParkOutline} size={13} />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </SoftScrollbar>
      )}
    </aside>
  );
}
