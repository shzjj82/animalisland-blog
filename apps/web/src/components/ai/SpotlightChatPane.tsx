import type { Dispatch, RefObject, SetStateAction } from "react";
import { Close, Paperclip, Plus } from "@icon-park/react";
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
  onInsertReply: (message: ChatBubble) => void;
  onConfirmDraft: () => void;
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
  onInsertReply,
  onConfirmDraft,
}: Props) {
  return (
    <>
      <div ref={listRef as RefObject<HTMLDivElement>} className="editor-spotlight-chat">
        <div className="editor-spotlight-chat-inner">
          {bubbles.length === 0 ? (
            <div className="editor-spotlight-chat-empty">
              <p>在上方输入消息发送。满意某条回答后点「添加到页面」。</p>
              {quote ? <p className="editor-spotlight-chat-quote-hint">已带入划选内容</p> : null}
            </div>
          ) : (
            bubbles.map((item) => (
              <div
                key={item.id}
                className={cn(
                  "editor-spotlight-bubble",
                  item.role === "user" ? "is-user" : "is-assistant",
                )}
              >
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
                      onClick={() => void onInsertReply(item)}
                    >
                      <Plus {...iconParkOutline} size={14} />
                      {insertingId === item.id && !draft ? "整理中…" : "整理到页面"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
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
        <span className="editor-spotlight-foot-hint">Enter 发送 · Esc 关闭</span>
        <Button type="button" size="sm" disabled={!canSend} onClick={() => void onSend()}>
          发送
        </Button>
      </div>
    </>
  );
}
