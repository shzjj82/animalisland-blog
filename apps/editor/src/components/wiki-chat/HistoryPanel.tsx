import { useMemo, useState } from "react";
import { Delete, Plus, Search } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { historyGroup, threadPreview, type HistoryGroupId, type WikiThread } from "@/lib/ai/wikiChatHistory";
import { iconParkOutline } from "@/lib/iconPark";
import { useTranslation } from "react-i18next";

export const HISTORY_SIDEBAR_W = 236;

type Props = {
  threads: WikiThread[];
  activeId: string | null;
  onNew: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
};

const GROUP_ORDER: HistoryGroupId[] = ["today", "yesterday", "week", "older"];
const GROUP_KEY = {
  today: "wikiAsk.historyToday",
  yesterday: "wikiAsk.historyYesterday",
  week: "wikiAsk.historyWeek",
  older: "wikiAsk.historyOlder",
} as const;

function formatCardTime(value: number, locale: string, group: HistoryGroupId): string {
  if (!value) {
    return "";
  }
  try {
    if (group === "today" || group === "yesterday") {
      return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(value);
    }
    if (group === "week") {
      return new Intl.DateTimeFormat(locale, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(value);
    }
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(value);
  } catch {
    return "";
  }
}

export function HistoryPanel({ threads, activeId, onNew, onOpen, onDelete }: Props) {
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
    <aside className="flex h-full shrink-0 flex-col border-r border-border/40 bg-muted/25" style={{ width: HISTORY_SIDEBAR_W }}>
      <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background/80 px-2 py-1.5">
          <Search {...iconParkOutline} size={13} className="text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("wikiAsk.historySearch")}
            className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
          />
        </label>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={t("wikiAsk.newChat")} onClick={onNew}>
          <Plus {...iconParkOutline} size={14} />
        </Button>
      </div>
      <SoftScrollbar className="min-h-0 flex-1" contentClassName="px-1.5 pb-2">
        {groups.length === 0 ? (
          <p className="text-muted-foreground px-2 py-8 text-center text-xs">
            {t(query.trim() ? "wikiAsk.historyNoMatch" : "wikiAsk.historyEmpty")}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.id} className="mt-2">
              <h2 className="text-muted-foreground px-2 pb-0.5 text-[10px] font-medium tracking-wide">{t(GROUP_KEY[group.id])}</h2>
              <ul className="space-y-1">
                {group.items.map((thread) => {
                  const preview = threadPreview(thread);
                  const current = thread.id === activeId;
                  const when = formatCardTime(thread.updatedAt, i18n.language, group.id);
                  return (
                    <li key={thread.id}>
                      <div className={`group flex items-stretch rounded-xl ${current ? "bg-background shadow-sm" : "hover:bg-background/70"}`}>
                        <button type="button" className="min-w-0 flex-1 px-2.5 py-2.5 text-left" onClick={() => onOpen(thread.id)}>
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate text-[13px] font-medium">{thread.title}</span>
                            {when ? <span className="text-muted-foreground shrink-0 text-[10px] tabular-nums">{when}</span> : null}
                          </span>
                          {preview ? <span className="text-muted-foreground mt-1 line-clamp-2 text-[11px] leading-4">{preview}</span> : <span className="mt-1 block h-4" />}
                        </button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground mr-1 self-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
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
          ))
        )}
      </SoftScrollbar>
    </aside>
  );
}
