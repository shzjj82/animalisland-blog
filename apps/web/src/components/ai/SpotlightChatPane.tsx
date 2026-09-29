import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useState } from "react";
import { Check, Close, Paperclip, Plus } from "@icon-park/react";
import { BubbleAttachments, PendingAttachments } from "@/components/ai/ChatAttachments";
import type { DraftInsert } from "@/components/ai/useSpotlightChat";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { AI_FILE_ACCEPT, type ChatBubble, type LocalAttachment } from "@/lib/aiChat";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

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
  onInsertDirect: (message: ChatBubble) => void;
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
  onInsertDirect,
  onSummarize,
  onConfirmDraft,
  onPickingChange,
}: Props) {
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
              <p>满意某条回答后点「加入到内容」。要合并多段时，再点「整理」勾选。</p>
              {quote ? <p className="editor-spotlight-chat-quote-hint">已带入划选内容</p> : null}
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
                    aria-label={on ? "取消选择这段" : "选择这段"}
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
                      onClick={() => void onInsertDirect(item)}
                    >
                      <Plus {...iconParkOutline} size={14} />
                      {insertingId === item.id ? "写入中…" : "加入到内容"}
                    </Button>
                  </div>
                ) : null}
                </div>
              </div>
              );
            })
          )}
          {sending ? (
            <div className="editor-spotlight-typing" aria-label="正在回复">
              <span className="ai-dot size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="ai-dot ai-dot-delay-1 size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="ai-dot ai-dot-delay-2 size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="text-xs text-muted-foreground">思考中…</span>
            </div>
          ) : null}
        </div>
      </div>

      {draft ? (
        <div className="editor-spotlight-draft">
          <div className="editor-spotlight-draft-head">
            <div>
              <p className="editor-spotlight-draft-label">整理预览 · 确认后再写入</p>
              {draft.note ? <p className="editor-spotlight-draft-note">{draft.note}</p> : null}
            </div>
            <div className="editor-spotlight-draft-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => setDraft(null)}>
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={Boolean(insertingId)}
                onClick={() => void onConfirmDraft()}
              >
                {insertingId === draft.messageId ? "写入中…" : "确认写入"}
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
          <span className="editor-spotlight-selection-label">划选</span>
          <p className="editor-spotlight-selection-text">{quote}</p>
          <button
            type="button"
            className="editor-spotlight-selection-clear"
            aria-label="清除划选"
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
          title="添加图片或文本"
          aria-label="添加图片或文本"
          onClick={() => fileRef.current?.click()}
        >
          <Paperclip {...iconParkOutline} size={16} />
        </Button>
        <span className="editor-spotlight-foot-hint">
          {picking ? "勾选要整理的对话" : "Enter 发送 · Esc 关闭"}
        </span>
        {picking ? (
          <>
            <Button type="button" variant="outline" size="sm" onClick={stopPicking}>
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pickedBubbles.length < 2 || Boolean(insertingId) || sending || !enabled}
              onClick={() => void onSummarize(pickedBubbles)}
            >
              {insertingId === "summary" && !draft ? "整理中…" : `整理 ${pickedBubbles.length} 段`}
            </Button>
          </>
        ) : (
          <>
            {bubbles.length >= 2 ? (
              <Button type="button" variant="outline" size="sm" disabled={sending} onClick={() => setPicking(true)}>
                整理
              </Button>
            ) : null}
            <Button type="button" size="sm" disabled={!canSend} onClick={() => void onSend()}>
              发送
            </Button>
          </>
        )}
      </div>
    </>
  );
}
