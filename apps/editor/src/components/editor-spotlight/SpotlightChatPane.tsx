import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Check, Close, Paperclip } from "@icon-park/react";
import { BubbleAttachments, PendingAttachments } from "./ChatAttachments";
import type { DraftInsert } from "./useSpotlightChat";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "./ChatMarkdown";
import { AI_FILE_ACCEPT, type ChatBubble, type LocalAttachment } from "@/lib/ai/chat";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type Props = {
  listRef: RefObject<HTMLDivElement | null>;
  fileRef: RefObject<HTMLInputElement | null>;
  bubbles: ChatBubble[];
  quote: string;
  setQuote: (value: string) => void;
  attachments: LocalAttachment[];
  setAttachments: Dispatch<SetStateAction<LocalAttachment[]>>;
  draft: DraftInsert | null;
  setDraft: (value: DraftInsert | null) => void;
  sending: boolean;
  insertingId: string | null;
  uploading: boolean;
  enabled: boolean;
  error: string;
  canSend: boolean;
  onAddFiles: (files: File[]) => void;
  onSend: () => void;
  onTidyInsert: (message: ChatBubble) => void;
  onSummarize: (messages: ChatBubble[]) => void;
  onConfirmDraft: () => void;
  onPickingChange?: (picking: boolean) => void;
};

export function SpotlightChatPane({
  listRef,
  fileRef,
  bubbles,
  quote,
  setQuote,
  attachments,
  setAttachments,
  draft,
  setDraft,
  sending,
  insertingId,
  uploading,
  enabled,
  error,
  canSend,
  onAddFiles,
  onSend,
  onTidyInsert,
  onSummarize,
  onConfirmDraft,
  onPickingChange,
}: Props) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    onPickingChange?.(picking);
  }, [picking, onPickingChange]);
  useEffect(() => {
    setPicked((prev) => prev.filter((id) => bubbles.some((item) => item.id === id)));
  }, [bubbles]);
  useEffect(() => {
    if (draft) {
      setPicking(false);
      setPicked([]);
    }
  }, [draft]);
  const stopPicking = () => {
    setPicking(false);
    setPicked([]);
  };
  useEffect(() => {
    if (!picking) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      stopPicking();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picking]);
  const pickedBubbles = bubbles.filter((item) => picked.includes(item.id));
  const toggle = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  return (
    <>
      <div ref={listRef as RefObject<HTMLDivElement>} className="editor-spotlight-chat">
        <div className="editor-spotlight-chat-inner">
          {bubbles.length === 0 ? (
            <div className="editor-spotlight-chat-empty">
              <p>{t("spotlight.chatHint")}</p>
              {quote ? <p className="editor-spotlight-chat-quote-hint">{t("spotlight.selectionAttached")}</p> : null}
            </div>
          ) : (
            bubbles.map((item) => {
              const on = picked.includes(item.id);
              return (
              <div
                key={item.id}
                className={cn(
                  "editor-spotlight-bubble",
                  item.role === "user" ? "is-user" : "is-assistant",
                  picking && on && "is-selected",
                )}
              >
                {picking ? (
                  <button
                    type="button"
                    className={cn("editor-spotlight-pick", on && "is-on")}
                    aria-pressed={on}
                    aria-label={on ? t("spotlight.deselect") : t("spotlight.select")}
                    onClick={() => toggle(item.id)}
                  >
                    {on ? <Check {...iconParkOutline} size={12} /> : null}
                  </button>
                ) : null}
                <div className="editor-spotlight-bubble-main">
                {item.quote ? <blockquote className="editor-spotlight-quote">{item.quote}</blockquote> : null}
                <ChatMarkdown
                  content={item.content}
                  className="editor-spotlight-bubble-text"
                  compact={item.role === "user"}
                />
                {item.attachments?.length ? <BubbleAttachments items={item.attachments} /> : null}
                {item.role === "assistant" ? (
                  <div className="editor-spotlight-bubble-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(insertingId) || sending}
                      onClick={() => void onTidyInsert(item)}
                    >
                      {insertingId === item.id ? t("spotlight.combining") : t("spotlight.addToPage")}
                    </Button>
                  </div>
                ) : null}
                </div>
              </div>
              );
            })
          )}
          {sending ? (
            <div className="editor-spotlight-typing" aria-label={t("spotlight.replying")}>
              <span className="ai-dot size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="ai-dot ai-dot-delay-1 size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="ai-dot ai-dot-delay-2 size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="text-xs text-muted-foreground">{t("spotlight.thinking")}</span>
            </div>
          ) : null}
        </div>
      </div>

      {draft ? (
        <div className="editor-spotlight-draft">
          <div className="editor-spotlight-draft-head">
            <div>
              <p className="editor-spotlight-draft-label">{t("spotlight.combinedPreviewConfirmToInsert")}</p>
              {draft.note ? <p className="editor-spotlight-draft-note">{draft.note}</p> : null}
            </div>
            <div className="editor-spotlight-draft-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(insertingId)}
                onClick={() => void onConfirmDraft()}
              >
                {insertingId === draft.messageId ? t("spotlight.inserting") : t("spotlight.insert")}
              </Button>
            </div>
          </div>
          <div className="editor-spotlight-draft-body">
            <ChatMarkdown content={draft.markdown} className="editor-spotlight-draft-md" />
          </div>
        </div>
      ) : null}

      {quote ? (
        <div className="editor-spotlight-selection">
          <span className="editor-spotlight-selection-label">{t("spotlight.selection")}</span>
          <p className="editor-spotlight-selection-text">{quote}</p>
          <button
            type="button"
            className="editor-spotlight-selection-clear"
            aria-label={t("spotlight.clearSelection")}
            onClick={() => setQuote("")}
          >
            <Close {...iconParkOutline} size={12} />
          </button>
        </div>
      ) : null}

      <PendingAttachments
        items={attachments}
        onRemove={(id) => setAttachments((prev) => prev.filter((x) => x.id !== id))}
      />

      {error ? <p className="editor-spotlight-error">{error}</p> : null}

      <div className="editor-spotlight-chat-foot">
        <input
          ref={fileRef as RefObject<HTMLInputElement>}
          type="file"
          className="hidden"
          multiple
          accept={AI_FILE_ACCEPT}
          onChange={(e) => {
            const files = e.currentTarget.files;
            if (files?.length) {
              void onAddFiles(Array.from(files));
            }
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          disabled={uploading || !enabled}
          title={t("spotlight.addImageOrText")}
          aria-label={t("spotlight.addImageOrText")}
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip {...iconParkOutline} size={16} />
        </Button>
        <span className="editor-spotlight-foot-hint">
          {picking ? t("spotlight.pickRepliesToCombine") : t("spotlight.sendHint")}
        </span>
        {picking ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={stopPicking}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pickedBubbles.length < 2 || Boolean(insertingId) || sending || !enabled}
              onClick={() => void onSummarize(pickedBubbles)}
            >
              {insertingId === "summary" && !draft ? t("spotlight.combining") : t("spotlight.combineCount", { count: pickedBubbles.length })}
            </Button>
          </>
        ) : (
          <>
            {bubbles.length >= 2 ? (
              <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => setPicking(true)}>
                {t("spotlight.combine")}
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={!canSend} onClick={() => void onSend()}>
              {t("spotlight.send")}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
