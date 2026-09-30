import type EditorJS from "@editorjs/editorjs";
import { Close, Comment, Search } from "@icon-park/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SpotlightChatPane } from "./SpotlightChatPane";
import { SpotlightCommandList, type SpotlightCommandItem } from "./SpotlightCommandList";
import { searchDocs, type SearchDoc } from "@/lib/document/search";
import { useSpotlightChat } from "./useSpotlightChat";
import { pageTitle } from "@/i18n";
import { iconParkOutline } from "@/lib/iconPark";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import "./spotlight.css";

export type SpotlightAction = {
  id: string;
  title: string;
  /** 选中后显示在搜索栏的块级名称 */
  chip?: string;
  subtitle?: string;
  keywords?: string;
  icon?: "robot" | "search";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: SpotlightAction[];
  editor: EditorJS | null;
  insertIndex: number;
  /** 打开时直接进入某命令（划词 / / 菜单） */
  launchActionId?: string | null;
  selection?: string;
  onInserted?: () => void;
  /** 打开时加载全文索引，返回的文档用来检索页面标题和正文 */
  loadPages?: () => Promise<SearchDoc[]>;
  /** 选中页面结果时带上检索词，用来在页面里定位命中位置 */
  onOpenPage?: (id: string, query: string) => void;
  /** 「问知识库」关掉命令面板，交给外侧栏 */
  onAskWiki?: () => void;
};

function matchAction(action: SpotlightAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const hay = `${action.title} ${action.subtitle ?? ""} ${action.keywords ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((part) => hay.includes(part));
}

/**
 * Spotlight 命令面板：先搜命令；选中后顶部留下块级命令名，下方输入即消息。
 */
export function EditorSpotlight({
  open,
  onOpenChange,
  actions,
  editor,
  insertIndex,
  launchActionId,
  selection,
  onInserted,
  loadPages,
  onOpenPage,
  onAskWiki,
}: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [action, setAction] = useState<SpotlightAction | null>(null);
  const [pages, setPages] = useState<SearchDoc[] | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  const chat = useSpotlightChat({ open, editor, insertIndex, onInserted });
  const {
    prompt,
    setPrompt,
    quote,
    setQuote,
    attachments,
    bubbles,
    draft,
    setDraft,
    resetChat,
    addFiles,
    send,
  } = chat;

  const filtered = useMemo<SpotlightCommandItem[]>(() => {
    const commands = actions
      .filter((item) => matchAction(item, query))
      .map((item) => ({ id: item.id, kind: "action" as const, title: item.title, subtitle: item.subtitle }));
    const hits = pages ? searchDocs(pages, query) : [];
    return [
      ...commands,
      ...hits.map((hit) => ({
        id: hit.id,
        kind: "page" as const,
        title: pageTitle(hit.title),
        subtitle: hit.snippet ? (
          <>
            {hit.snippet.before}
            <mark>{hit.snippet.match}</mark>
            {hit.snippet.after}
          </>
        ) : undefined,
      })),
    ];
  }, [actions, pages, query]);

  const choose = (item: SpotlightCommandItem) => {
    if (item.kind === "page") {
      const text = query;
      closeAll();
      onOpenPage?.(item.id, text);
      return;
    }
    const full = actions.find((actionItem) => actionItem.id === item.id);
    if (full?.id === "wiki-ask") {
      closeAll();
      onAskWiki?.();
      return;
    }
    if (full) {
      enterAction(full);
    }
  };
  const inChat = Boolean(action);

  const enterAction = (item: SpotlightAction, nextQuote?: string) => {
    setAction(item);
    setQuery("");
    resetChat();
    setQuote(nextQuote?.trim() || selection?.trim() || "");
    window.setTimeout(() => messageRef.current?.focus({ preventScroll: true }), 30);
  };

  const clearAction = () => {
    setAction(null);
    resetChat();
    setQuery("");
    window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 30);
  };

  const closeAll = () => {
    setAction(null);
    setQuery("");
    setActive(0);
    resetChat();
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open || !loadPages) {
      setPages(null);
      return;
    }
    let alive = true;
    void loadPages()
      .then((docs) => alive && setPages(docs))
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
    // 每次打开重新取一次，列表变化时由缓存兜底
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) {
      setAction(null);
      setQuery("");
      setActive(0);
      resetChat();
      return;
    }
    const launched = launchActionId ? actions.find((item) => item.id === launchActionId) : null;
    if (launched?.id === "wiki-ask") {
      onOpenChange(false);
      onAskWiki?.();
      return;
    }
    if (launched) {
      enterAction(launched, selection);
    } else {
      setQuery("");
      setActive(0);
      setAction(null);
      setQuote(selection?.trim() || "");
      window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 30);
    }
    // 仅在打开瞬间根据 launch 进入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && selection?.trim() && inChat) {
      setQuote(selection.trim());
    }
  }, [selection, open, inChat, setQuote]);

  useEffect(() => {
    setActive((prev) => (filtered.length ? Math.min(prev, filtered.length - 1) : 0));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (inChat) {
        if (draft) {
          setDraft(null);
          return;
        }
        if (prompt.trim() || bubbles.length || attachments.length || quote) {
          closeAll();
        } else {
          clearAction();
        }
        return;
      }
      closeAll();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, inChat, prompt, bubbles.length, attachments.length, quote, draft]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div className="editor-spotlight-root" role="presentation">
      <button
        type="button"
        className="editor-spotlight-scrim"
        aria-label={t("spotlight.closeCommandPalette")}
        onClick={closeAll}
      />
      <div
        className={cn("editor-spotlight-panel", inChat && "is-chat")}
        role="dialog"
        aria-label={inChat ? action?.chip || action?.title || t("spotlight.aiChat") : t("spotlight.commandPalette")}
      >
        <div className="editor-spotlight-search">
          {inChat && action ? (
            <>
              <span className="editor-spotlight-chip">
                <Comment {...iconParkOutline} size={14} aria-hidden />
                <span>{action.chip || action.title}</span>
                <button
                  type="button"
                  className="editor-spotlight-chip-clear"
                  aria-label={t("spotlight.exitCommand")}
                  onClick={clearAction}
                >
                  <Close {...iconParkOutline} size={12} />
                </button>
              </span>
              <textarea
                ref={messageRef}
                className="editor-spotlight-message"
                rows={1}
                value={prompt}
                placeholder={quote ? t("spotlight.askAboutTheSelection") : t("spotlight.messagePlaceholder")}
                aria-label={t("spotlight.messageLabel")}
                onChange={(e) => setPrompt(e.currentTarget.value)}
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={() => {
                  window.setTimeout(() => {
                    composingRef.current = false;
                  }, 0);
                }}
                onPaste={(e) => {
                  const files = Array.from(e.clipboardData?.files ?? []);
                  if (files.length) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                onKeyDown={(e) => {
                  if (composingRef.current || e.nativeEvent.isComposing || e.keyCode === 229) {
                    return;
                  }
                  if (e.key === "Backspace" && !prompt && !quote && !attachments.length && !bubbles.length) {
                    e.preventDefault();
                    clearAction();
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
            </>
          ) : (
            <>
              <Search {...iconParkOutline} size={18} className="editor-spotlight-search-icon" aria-hidden />
              <input
                ref={searchRef}
                className="editor-spotlight-input"
                value={query}
                placeholder={t("spotlight.searchPlaceholder")}
                aria-label={t("spotlight.searchLabel")}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) {
                    return;
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((prev) =>
                      filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0,
                    );
                    return;
                  }
                  if (e.key === "Enter") {
                    const item = filtered[active];
                    if (!item) {
                      return;
                    }
                    e.preventDefault();
                    choose(item);
                  }
                }}
              />
            </>
          )}
          <div className="editor-spotlight-search-end">
            <kbd className="editor-spotlight-kbd">esc</kbd>
            <button type="button" className="editor-spotlight-close" aria-label={t("spotlight.close")} onClick={closeAll}>
              <Close {...iconParkOutline} size={14} />
            </button>
          </div>
        </div>

        {!inChat ? (
          <SpotlightCommandList
            items={filtered}
            active={active}
            loading={Boolean(loadPages) && pages === null && query.trim().length > 0}
            onActiveChange={setActive}
            onSelect={choose}
          />
        ) : (
          <SpotlightChatPane
            listRef={chat.listRef}
            fileRef={chat.fileRef}
            bubbles={chat.bubbles}
            quote={chat.quote}
            setQuote={chat.setQuote}
            attachments={chat.attachments}
            setAttachments={chat.setAttachments}
            draft={chat.draft}
            setDraft={chat.setDraft}
            sending={chat.sending}
            insertingId={chat.insertingId}
            uploading={chat.uploading}
            enabled={chat.enabled}
            error={chat.error}
            canSend={chat.canSend}
            onAddFiles={(files) => void chat.addFiles(files)}
            onSend={() => void chat.send()}
            onInsertDirect={(message) => void chat.insertDirect(message)}
            onSummarize={(messages) => void chat.summarize(messages)}
            onConfirmDraft={() => void chat.confirmDraft()}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
