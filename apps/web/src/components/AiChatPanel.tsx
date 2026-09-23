import type { AiAttachment, AiChatMessage, EditorJsBlock } from "@myblog/shared";
import EditorJS from "@editorjs/editorjs";
import { Close, Paperclip, Plus } from "@icon-park/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  insertEditorBlocksAt,
  markEditorPreviewBlocks,
  removeEditorBlocksRange,
  saveEditor,
} from "@/content";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

export type AiChatOpenOptions = {
  insertIndex: number;
  /** 划词带入的选中文本 */
  selection?: string;
};

type Props = {
  editor: EditorJS | null;
  insertIndex: number;
  selection?: string;
  onClose: () => void;
  onInserted?: () => void;
};

type LocalAttachment =
  | { id: string; kind: "image"; name: string; url: string }
  | { id: string; kind: "text"; name: string; text: string };

type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** 划词上下文（仅展示，已并入发给模型的 user 内容） */
  quote?: string;
};

const TEXT_EXTS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".css",
  ".html",
]);

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/") || file.type === "application/json") {
    return true;
  }
  const lower = file.name.toLowerCase();
  return [...TEXT_EXTS].some((ext) => lower.endsWith(ext));
}

function aiErrorMessage(message: string): string {
  if (message === "AI_NOT_CONFIGURED") {
    return "还没配 AI。在仓库根目录 .env 里填 AI_API_KEY。";
  }
  if (message === "AI_TIMEOUT") {
    return "AI 超时了，换短一点再说。";
  }
  if (message === "AI_EMPTY_BLOCKS" || message === "AI_BAD_JSON") {
    return "没能整理成可用正文，换个说法或稍后再试。";
  }
  if (message === "AI_EMPTY_REPLY") {
    return "模型没有回复，稍后再试。";
  }
  if (message === "AI_EMPTY_PROMPT") {
    return "先写点问题再发送。";
  }
  if (message.startsWith("AI_UPSTREAM_")) {
    return "上游 AI 接口报错，检查密钥与模型配置。";
  }
  return message;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function currentBlockIndex(editor: EditorJS | null, fallback: number): number {
  if (!editor) {
    return fallback;
  }
  try {
    const index = editor.blocks.getCurrentBlockIndex();
    if (typeof index === "number" && index >= 0) {
      return index;
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

/** 多轮 AI 聊天：回答只留在面板里，点「添加到页面」才写入编辑器 */
export function AiChatPanel({ editor, insertIndex, selection, onClose, onInserted }: Props) {
  const [enabled, setEnabled] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [quote, setQuote] = useState(selection?.trim() || "");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [preview, setPreview] = useState<{
    startIndex: number;
    count: number;
    blockIds: string[];
    note?: string;
    messageId: string;
  } | null>(null);

  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .aiStatus()
      .then((data) => setEnabled(data.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (selection?.trim()) {
      setQuote(selection.trim());
    }
  }, [selection]);

  useLayoutEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [bubbles, sending, preview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void discardPreviewAndClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  useEffect(() => {
    return () => {
      if (preview?.blockIds.length) {
        markEditorPreviewBlocks(preview.blockIds, false);
      }
    };
  }, [preview]);

  const clearPreview = () => {
    if (!preview) {
      return;
    }
    markEditorPreviewBlocks(preview.blockIds, false);
    removeEditorBlocksRange(editor, preview.startIndex, preview.count);
    setPreview(null);
  };

  const discardPreviewAndClose = async () => {
    if (preview) {
      clearPreview();
    }
    onClose();
  };

  const payloadAttachments = (list: LocalAttachment[]): AiAttachment[] =>
    list.map((item) =>
      item.kind === "image"
        ? { kind: "image", name: item.name, url: item.url }
        : { kind: "text", name: item.name, text: item.text },
    );

  const addFiles = async (files: File[]) => {
    if (!files.length) {
      return;
    }
    setError("");
    setUploading(true);
    try {
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          const { url } = await api.upload(file);
          setAttachments((prev) => [
            ...prev,
            { id: `${Date.now()}-${file.name}`, kind: "image", name: file.name, url },
          ]);
          continue;
        }
        if (isTextFile(file)) {
          if (file.size > 200_000) {
            throw new Error(`文本附件太大：${file.name}`);
          }
          const text = await file.text();
          setAttachments((prev) => [
            ...prev,
            { id: `${Date.now()}-${file.name}`, kind: "text", name: file.name, text },
          ]);
          continue;
        }
        throw new Error(`暂不支持：${file.name}（可传图片或文本文件）`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "附件失败");
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const toApiMessages = (list: ChatBubble[]): AiChatMessage[] =>
    list.map((item) => ({ role: item.role, content: item.content }));

  const send = async () => {
    const text = prompt.trim();
    const attach = attachmentsRef.current;
    if ((!text && !attach.length && !quote) || sending) {
      return;
    }
    if (!enabled) {
      setError(aiErrorMessage("AI_NOT_CONFIGURED"));
      return;
    }

    const userContent = quote
      ? `【划选原文】\n${quote}\n\n【我的问题】\n${text || "请针对上面划选内容给出改写/补充建议。"}`
      : text || "请结合我上传的附件聊聊怎么写。";

    const userBubble: ChatBubble = {
      id: uid(),
      role: "user",
      content: userContent,
      quote: quote || undefined,
    };
    const nextBubbles = [...bubblesRef.current, userBubble];
    setBubbles(nextBubbles);
    setPrompt("");
    setQuote("");
    setError("");
    setSending(true);

    try {
      const editorDocument = editor ? await saveEditor(editor) : undefined;
      const result = await api.aiChat({
        messages: toApiMessages(nextBubbles),
        attachments: payloadAttachments(attach),
        document: editorDocument,
      });
      setBubbles((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: result.reply.trim() || "（空回复）" },
      ]);
      setAttachments([]);
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "发送失败"));
      setBubbles((prev) => prev.filter((item) => item.id !== userBubble.id));
      setPrompt(text);
      if (userBubble.quote) {
        setQuote(userBubble.quote);
      }
    } finally {
      setSending(false);
    }
  };

  const insertReply = async (message: ChatBubble) => {
    if (!editor || message.role !== "assistant" || insertingId) {
      return;
    }
    if (!enabled) {
      setError(aiErrorMessage("AI_NOT_CONFIGURED"));
      return;
    }
    if (preview) {
      clearPreview();
    }

    setInsertingId(message.id);
    setError("");
    try {
      const history = bubblesRef.current;
      const cut = history.findIndex((item) => item.id === message.id);
      const context = cut >= 0 ? history.slice(0, cut + 1) : [...history, message];
      const editorDocument = await saveEditor(editor);
      const result = await api.aiToEditor({
        messages: [
          ...toApiMessages(context),
          {
            role: "user",
            content:
              "请把上面助手刚刚那条回复整理成可插入正文的 Editor.js blocks；只保留适合放进文章的内容，不要聊天寒暄。",
          },
        ],
        document: editorDocument,
        apply: "append",
      });
      const blocks = result.blocks as EditorJsBlock[];
      if (!blocks.length) {
        throw new Error("AI_EMPTY_BLOCKS");
      }
      const at = currentBlockIndex(editor, insertIndex);
      const inserted = await insertEditorBlocksAt(editor, blocks, at);
      markEditorPreviewBlocks(inserted.blockIds, true);
      setPreview({ ...inserted, note: result.note, messageId: message.id });
      const firstId = inserted.blockIds[0];
      if (firstId) {
        requestAnimationFrame(() => {
          window.document
            .querySelector(`.ce-block[data-id="${firstId}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "添加到页面失败"));
    } finally {
      setInsertingId(null);
    }
  };

  const acceptPreview = () => {
    if (preview?.blockIds.length) {
      markEditorPreviewBlocks(preview.blockIds, false);
    }
    setPreview(null);
    onInserted?.();
  };

  const canSend = enabled && !uploading && !sending && Boolean(prompt.trim() || attachments.length || quote);

  return createPortal(
    <div className="ai-chat-root" aria-live="polite">
      <button
        type="button"
        className="ai-chat-scrim"
        aria-label="关闭 AI 聊天"
        onClick={() => void discardPreviewAndClose()}
      />
      <div
        ref={panelRef}
        className={cn("ai-chat-panel", dragOver && "ai-chat-panel--drag")}
        role="dialog"
        aria-label="智能 AI 聊天"
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!panelRef.current?.contains(e.relatedTarget as Node)) {
            setDragOver(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length) {
            void addFiles(files);
          }
        }}
      >
        <div className="ai-chat-head">
          <div className="ai-chat-head-copy">
            <span className="ai-chat-brand">智能 AI 聊天</span>
            <span className="ai-chat-hint">先聊，再点回答添加到页面</span>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" onClick={() => void discardPreviewAndClose()}>
            <Close {...iconParkOutline} size={14} />
          </Button>
        </div>

        <div ref={listRef} className="ai-chat-list">
          {bubbles.length === 0 ? (
            <div className="ai-chat-empty">
              <p>和 AI 商量题目、结构或改写。</p>
              <p>满意某条回答后，点「添加到页面」才会写入正文。</p>
              {quote ? <p className="ai-chat-empty-quote">已带入划选内容，直接提问即可。</p> : null}
            </div>
          ) : (
            bubbles.map((item) => (
              <div
                key={item.id}
                className={cn("ai-chat-bubble", item.role === "user" ? "is-user" : "is-assistant")}
              >
                {item.quote ? (
                  <blockquote className="ai-chat-quote" cite="">
                    {item.quote}
                  </blockquote>
                ) : null}
                <div className="ai-chat-bubble-text">{item.content}</div>
                {item.role === "assistant" ? (
                  <div className="ai-chat-bubble-actions">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={Boolean(insertingId) || sending}
                      onClick={() => void insertReply(item)}
                    >
                      <Plus {...iconParkOutline} size={14} />
                      {insertingId === item.id ? "整理中…" : "添加到页面"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
          {sending ? (
            <div className="ai-chat-typing" aria-label="正在回复">
              <span className="ai-dot size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="ai-dot ai-dot-delay-1 size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="ai-dot ai-dot-delay-2 size-1.5 rounded-full bg-muted-foreground/70" />
              <span className="text-xs text-muted-foreground">思考中…</span>
            </div>
          ) : null}
        </div>

        {preview ? (
          <div className="ai-chat-preview-bar">
            <div className="ai-chat-preview-copy">
              <p className="ai-chat-preview-label">已插入预览 · 尚未确认</p>
              {preview.note ? <p className="ai-chat-preview-note">{preview.note}</p> : null}
            </div>
            <div className="ai-chat-preview-actions">
              <Button type="button" variant="ghost" size="sm" onClick={clearPreview}>
                撤掉
              </Button>
              <Button type="button" size="sm" onClick={acceptPreview}>
                确认留下
              </Button>
            </div>
          </div>
        ) : null}

        <div className="ai-chat-composer">
          {quote ? (
            <div className="ai-chat-selection">
              <span className="ai-chat-selection-label">划选</span>
              <p className="ai-chat-selection-text">{quote}</p>
              <button
                type="button"
                className="ai-chat-selection-clear"
                aria-label="清除划选"
                onClick={() => setQuote("")}
              >
                <Close {...iconParkOutline} size={12} />
              </button>
            </div>
          ) : null}

          {attachments.length ? (
            <div className="ai-chat-attach-list">
              {attachments.map((item) => (
                <span key={item.id} className="ai-chat-attach-chip">
                  {item.kind === "image" ? (
                    <img src={item.url} alt="" className="ai-chat-attach-thumb" />
                  ) : null}
                  <span className="truncate">
                    {item.kind === "image" ? "图" : "文"} · {item.name}
                  </span>
                  <button
                    type="button"
                    className="ai-chat-attach-remove"
                    aria-label={`移除 ${item.name}`}
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== item.id))}
                  >
                    <Close {...iconParkOutline} size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            ref={inputRef}
            className="ai-chat-input"
            rows={2}
            value={prompt}
            placeholder={quote ? "针对划选内容提问…" : "问点什么… 也可拖入图片 / 文本"}
            onChange={(e) => setPrompt(e.currentTarget.value)}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length) {
                e.preventDefault();
                void addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) {
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {error ? <p className="ai-chat-error">{error}</p> : null}
          <div className="ai-chat-actions">
            <div className="ai-chat-actions-left">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,.txt,.md,.markdown,.json,.csv,.log,.ts,.tsx,.js,.jsx,.css,.html,text/plain,application/json"
                onChange={(e) => {
                  const files = e.currentTarget.files;
                  if (files?.length) {
                    void addFiles(files);
                  }
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                disabled={uploading || !enabled}
                title={uploading ? "上传中…" : "添加图片或文本"}
                aria-label="添加图片或文本"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip {...iconParkOutline} size={16} />
              </Button>
              <span className="ai-chat-foot-hint">Enter 发送 · Esc 关闭</span>
            </div>
            <Button type="button" size="sm" disabled={!canSend} onClick={() => void send()}>
              发送
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** @deprecated 旧名，兼容导入 */
export { AiChatPanel as InlineAiAssist };
