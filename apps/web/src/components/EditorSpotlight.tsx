import type { AiAttachment, AiChatMessage, EditorJsBlock } from "@myblog/shared";
import EditorJS from "@editorjs/editorjs";
import { Close, FileText, Paperclip, Pic, Plus, Robot, Search } from "@icon-park/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  insertEditorBlocksAt,
  saveEditor,
} from "@/content";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/ChatMarkdown";
import { api } from "@/lib/api";
import { blocksToPreviewMarkdown } from "@/lib/chatMarkdown";
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

type LocalAttachment =
  | { id: string; kind: "image"; name: string; url: string }
  | { id: string; kind: "text"; name: string; text: string };

type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  quote?: string;
  attachments?: LocalAttachment[];
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

function matchAction(action: SpotlightAction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) {
    return true;
  }
  const hay = `${action.title} ${action.subtitle ?? ""} ${action.keywords ?? ""}`.toLowerCase();
  return q.split(/\s+/).every((part) => hay.includes(part));
}

function isTextFile(file: File): boolean {
  if (file.type.startsWith("text/") || file.type === "application/json") {
    return true;
  }
  const lower = file.name.toLowerCase();
  return [...TEXT_EXTS].some((ext) => lower.endsWith(ext));
}

function downloadTextAttachment(file: Extract<LocalAttachment, { kind: "text" }>) {
  const blob = new Blob([file.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement("a");
  link.href = url;
  link.download = file.name || "attachment.txt";
  link.rel = "noopener";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

  const [enabled, setEnabled] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [quote, setQuote] = useState("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState<{
    messageId: string;
    blocks: EditorJsBlock[];
    note?: string;
    markdown: string;
  } | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const composingRef = useRef(false);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

  const filtered = useMemo(() => actions.filter((item) => matchAction(item, query)), [actions, query]);
  const inChat = Boolean(action);

  const resetSession = () => {
    setQuery("");
    setActive(0);
    setAction(null);
    setPrompt("");
    setError("");
    setSending(false);
    setInsertingId(null);
    setUploading(false);
    setAttachments([]);
    setQuote("");
    setBubbles([]);
    setDraft(null);
  };

  const enterAction = (item: SpotlightAction, nextQuote?: string) => {
    setAction(item);
    setQuery("");
    setPrompt("");
    setError("");
    setBubbles([]);
    setAttachments([]);
    setDraft(null);
    setQuote(nextQuote?.trim() || selection?.trim() || "");
    window.setTimeout(() => messageRef.current?.focus({ preventScroll: true }), 30);
  };

  const clearAction = () => {
    setAction(null);
    setPrompt("");
    setError("");
    setBubbles([]);
    setAttachments([]);
    setQuote("");
    setQuery("");
    setDraft(null);
    window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 30);
  };

  const closeAll = () => {
    resetSession();
    onOpenChange(false);
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    void api
      .aiStatus()
      .then((data) => setEnabled(data.enabled))
      .catch(() => setEnabled(false));
  }, [open]);

  useEffect(() => {
    if (!open) {
      resetSession();
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
  }, [selection, open, inChat]);

  useEffect(() => {
    setActive((prev) => (filtered.length ? Math.min(prev, filtered.length - 1) : 0));
  }, [filtered.length]);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [bubbles, sending, draft, inChat]);

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
        throw new Error(`暂不支持：${file.name}`);
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
    const attach = [...attachmentsRef.current];
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
      attachments: attach.length ? attach : undefined,
    };
    const nextBubbles = [...bubblesRef.current, userBubble];
    setBubbles(nextBubbles);
    setPrompt("");
    setQuote("");
    setAttachments([]);
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
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "发送失败"));
      setBubbles((prev) => prev.filter((item) => item.id !== userBubble.id));
      setPrompt(text);
      if (userBubble.quote) {
        setQuote(userBubble.quote);
      }
      if (attach.length) {
        setAttachments(attach);
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
      setDraft({
        messageId: message.id,
        blocks,
        note: result.note,
        markdown: blocksToPreviewMarkdown(blocks),
      });
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "整理失败"));
    } finally {
      setInsertingId(null);
    }
  };

  const confirmDraft = async () => {
    if (!editor || !draft || insertingId) {
      return;
    }
    setInsertingId(draft.messageId);
    setError("");
    try {
      const at = currentBlockIndex(editor, insertIndex);
      const inserted = await insertEditorBlocksAt(editor, draft.blocks, at);
      setDraft(null);
      onInserted?.();
      const firstId = inserted.blockIds[0];
      if (firstId) {
        requestAnimationFrame(() => {
          window.document
            .querySelector(`.ce-block[data-id="${firstId}"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      }
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "写入失败"));
    } finally {
      setInsertingId(null);
    }
  };

  const dismissDraft = () => {
    setDraft(null);
  };

  const canSend =
    enabled && !uploading && !sending && Boolean(prompt.trim() || attachments.length || quote);

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
                  // 等本轮 Enter（确认候选）过完，再允许发送，避免拼音回车误发
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
          <>
            <ul className="editor-spotlight-list" role="listbox">
              {filtered.length === 0 ? (
                <li className="editor-spotlight-empty">没有匹配的命令</li>
              ) : (
                filtered.map((item, index) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      className={cn("editor-spotlight-item", index === active && "is-active")}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => enterAction(item)}
                    >
                      <span className="editor-spotlight-item-icon" aria-hidden>
                        <Robot {...iconParkOutline} size={28} />
                      </span>
                      <span className="editor-spotlight-item-copy">
                        <span className="editor-spotlight-item-title">{item.title}</span>
                        {item.subtitle ? (
                          <span className="editor-spotlight-item-sub">{item.subtitle}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <p className="editor-spotlight-foot">↑↓ 选择 · Enter 进入 · Esc 关闭</p>
          </>
        ) : (
          <>
            <div ref={listRef} className="editor-spotlight-chat">
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
                      {item.quote ? (
                        <blockquote className="editor-spotlight-quote">{item.quote}</blockquote>
                      ) : null}
                      <ChatMarkdown
                        content={item.content}
                        className="editor-spotlight-bubble-text"
                        compact={item.role === "user"}
                      />
                      {item.attachments?.length ? (
                        <div className="editor-spotlight-bubble-attach">
                          {item.attachments.map((file) =>
                            file.kind === "image" ? (
                              <a
                                key={file.id}
                                href={file.url}
                                download={file.name}
                                target="_blank"
                                rel="noreferrer"
                                className="editor-spotlight-bubble-attach-item"
                                title={`下载 ${file.name}`}
                              >
                                <span className="editor-spotlight-bubble-attach-icon" aria-hidden>
                                  <Pic {...iconParkOutline} size={16} />
                                </span>
                                <span className="truncate">{file.name}</span>
                              </a>
                            ) : (
                              <button
                                key={file.id}
                                type="button"
                                className="editor-spotlight-bubble-attach-item"
                                title={`下载 ${file.name}`}
                                onClick={() => downloadTextAttachment(file)}
                              >
                                <span className="editor-spotlight-bubble-attach-icon" aria-hidden>
                                  <FileText {...iconParkOutline} size={16} />
                                </span>
                                <span className="truncate">{file.name}</span>
                              </button>
                            ),
                          )}
                        </div>
                      ) : null}
                      {item.role === "assistant" ? (
                        <div className="editor-spotlight-bubble-actions">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={Boolean(insertingId) || sending}
                            onClick={() => void insertReply(item)}
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
                    <Button type="button" variant="ghost" size="sm" onClick={dismissDraft}>
                      取消
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={Boolean(insertingId)}
                      onClick={() => void confirmDraft()}
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

            {attachments.length ? (
              <div className="editor-spotlight-attach">
                {attachments.map((item) => (
                  <span key={item.id} className="editor-spotlight-attach-chip">
                    <span className="editor-spotlight-attach-icon" aria-hidden>
                      {item.kind === "image" ? (
                        <Pic {...iconParkOutline} size={14} />
                      ) : (
                        <FileText {...iconParkOutline} size={14} />
                      )}
                    </span>
                    <span className="truncate">{item.name}</span>
                    <button
                      type="button"
                      aria-label={`移除 ${item.name}`}
                      onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== item.id))}
                    >
                      <Close {...iconParkOutline} size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            {error ? <p className="editor-spotlight-error">{error}</p> : null}

            <div className="editor-spotlight-chat-foot">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                multiple
                accept="image/*,.txt,.md,.markdown,.json,.csv,.log,.ts,.tsx,.js,.jsx,.css,.html,text/plain,application/json"
                onChange={(e) => {
                  const files = e.currentTarget.files;
                  if (files?.length) {
                    void addFiles(Array.from(files));
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
              <Button type="button" size="sm" disabled={!canSend} onClick={() => void send()}>
                发送
              </Button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
