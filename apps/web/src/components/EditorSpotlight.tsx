import type EditorJS from "@editorjs/editorjs";
import { Close, Robot, Search } from "@icon-park/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SpotlightChatPane } from "@/components/ai/SpotlightChatPane";
import { SpotlightCommandList } from "@/components/ai/SpotlightCommandList";
import { useSpotlightChat } from "@/components/ai/useSpotlightChat";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

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
}: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [action, setAction] = useState<SpotlightAction | null>(null);

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

  const filtered = useMemo(() => actions.filter((item) => matchAction(item, query)), [actions, query]);
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
    if (!open) {
      setAction(null);
      setQuery("");
      setActive(0);
      resetChat();
      return;
    }
    const launched = launchActionId ? actions.find((item) => item.id === launchActionId) : null;
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
        aria-label="关闭快捷命令"
        onClick={closeAll}
      />
      <div
        className={cn("editor-spotlight-panel", inChat && "is-chat")}
        role="dialog"
        aria-label={inChat ? action?.chip || action?.title || "AI 聊天" : "快捷命令"}
      >
        <div className="editor-spotlight-search">
          {inChat && action ? (
            <>
              <span className="editor-spotlight-chip">
                <Robot {...iconParkOutline} size={14} aria-hidden />
                <span>{action.chip || action.title}</span>
                <button
                  type="button"
                  className="editor-spotlight-chip-clear"
                  aria-label="退出命令"
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
                placeholder={quote ? "针对划选内容提问…" : "输入消息…"}
                aria-label="消息"
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
                placeholder="搜索命令…"
                aria-label="搜索命令"
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
                    enterAction(item);
                  }
                }}
              />
            </>
          )}
          <div className="editor-spotlight-search-end">
            <kbd className="editor-spotlight-kbd">esc</kbd>
            <button type="button" className="editor-spotlight-close" aria-label="关闭" onClick={closeAll}>
              <Close {...iconParkOutline} size={14} />
            </button>
          </div>
        </div>

        {!inChat ? (
          <SpotlightCommandList
            items={filtered}
            active={active}
            onActiveChange={setActive}
            onSelect={enterAction}
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
            onInsertReply={(message) => void chat.insertReply(message)}
            onConfirmDraft={() => void chat.confirmDraft()}
          />
        )}
      </div>
    </div>,
    document.body,
  );
}
