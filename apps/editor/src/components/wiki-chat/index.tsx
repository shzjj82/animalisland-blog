import { useEffect, useRef, useState } from "react";
import { Close, Copy, Paperclip, Refresh, Robot } from "@icon-park/react";
import type { AiAttachment, AiChatMessage } from "@myblog/shared";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/editor-spotlight/ChatMarkdown";
import { PendingAttachments } from "@/components/editor-spotlight/ChatAttachments";
import { aiChat } from "@/lib/ai/client";
import {
  AI_FILE_ACCEPT,
  aiErrorMessage,
  parseLocalFiles,
  toApiAttachments,
  uid,
  type ChatBubble,
  type LocalAttachment,
} from "@/lib/ai/chat";
import { readFileText } from "@/lib/document/fileText";
import { fileExtension } from "@/lib/document/fileKinds";
import { pageTodos, retrieveWiki, type SearchDoc } from "@/lib/document/search";
import { copyText } from "@/lib/clipboard";
import { iconParkOutline } from "@/lib/iconPark";
import { t } from "@/i18n";
import { useVisualViewport } from "@/lib/useKeyboardInset";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  focusToken: number;
  loggedIn: boolean;
  loadPages?: () => Promise<SearchDoc[]>;
  onClose: () => void;
  onLogin: () => void;
};

function capImages(list: AiAttachment[]): AiAttachment[] {
  let images = 0;
  return list.filter((item) => {
    if (item.kind !== "image") {
      return true;
    }
    images += 1;
    return images <= 6;
  });
}

function asksAboutTodos(query: string): boolean {
  return /待办|未完成|已完成|todo/i.test(query);
}

function keepsTodo(query: string, done: boolean): boolean {
  const open = /未完成|待办|todo/i.test(query);
  const closed = /已完成/.test(query);
  if (open && closed) {
    return true;
  }
  if (closed && !open) {
    return done;
  }
  if (open) {
    return !done;
  }
  return true;
}

function formatTodos(docs: SearchDoc[], query: string, rule: string, empty: string): string {
  const lines = [rule];
  for (const page of pageTodos(docs)) {
    const items = page.items.filter((item) => keepsTodo(query, item.done));
    if (!items.length) {
      continue;
    }
    lines.push(`《${page.title}》`);
    for (const item of items) {
      const range = item.start || item.end ? `（${item.start || "?"}至${item.end || "?"}）` : "";
      lines.push(`- ${item.done ? "已完成" : "未完成"}：${item.text}${range}`);
    }
  }
  return lines.length > 1 ? lines.join("\n") : empty;
}

const MESSAGE_LIMIT = 8000;

async function readUpload(files: File[]): Promise<LocalAttachment[]> {
  const plain: File[] = [];
  const out: LocalAttachment[] = [];
  for (const file of files) {
    const ext = fileExtension(file.name);
    if (ext === "docx" || ext === "xlsx" || ext === "xls" || ext === "csv") {
      const text = (await readFileText(file)).trim();
      if (!text) {
        throw new Error(t("document.emptyImport"));
      }
      out.push({ id: uid(), kind: "text", name: file.name, text });
      continue;
    }
    plain.push(file);
  }
  if (plain.length) {
    out.push(...(await parseLocalFiles(plain)));
  }
  return out;
}

/** 把这一轮上传的正文写进用户消息，避免只靠附件字段时被页面摘录盖住 */
function userContent(question: string, files: LocalAttachment[] | undefined, uploadedLabel: string, questionLabel: string, fallback: string): string {
  const ask = question.trim();
  const uploaded = (files ?? [])
    .flatMap((file) => (file.kind === "text" && file.text.trim() ? [`《${file.name}》\n${file.text.trim()}`] : []))
    .join("\n\n");
  if (!uploaded) {
    return ask;
  }
  const questionPart = `${questionLabel}\n${ask || fallback}`;
  const room = MESSAGE_LIMIT - questionPart.length - 2;
  const filePart = `${uploadedLabel}\n${uploaded}`.slice(0, Math.max(0, room));
  return `${filePart}\n\n${questionPart}`;
}

export function WikiChat({ open, focusToken, loggedIn, loadPages, onClose, onLogin }: Props) {
  const { t: tr } = useTranslation();
  const viewport = useVisualViewport();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copiedTimer = useRef(0);

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [open, focusToken]);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [bubbles, sending]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const addFiles = async (files: File[]) => {
    if (!files.length) {
      return;
    }
    setUploading(true);
    setError("");
    try {
      const next = await readUpload(files);
      setAttachments((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : tr("spotlight.attachmentFailed"));
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
      inputRef.current?.focus();
    }
  };

  const answer = async (history: ChatBubble[], assistantId: string, onFail: () => void) => {
    const user = [...history].reverse().find((item) => item.role === "user");
    const text = user?.content.trim() ?? "";
    const attach = user?.attachments ?? [];
    setError("");
    setSending(true);
    setReplyingId(assistantId);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const uploadedFiles = toApiAttachments(attach).filter((item) =>
        item.kind === "image" ? Boolean(item.url) : Boolean(item.text.trim()),
      );
      let retrieved = "";
      let aboutTodos = false;
      if (loadPages && text) {
        aboutTodos = asksAboutTodos(text);
        try {
          const docs = await loadPages();
          retrieved = aboutTodos
            ? formatTodos(docs, text, tr("wikiAsk.todoRule"), tr("wikiAsk.todoEmpty"))
            : retrieveWiki(docs, text)
                .map((hit) => `《${hit.title}》\n${hit.excerpt}`)
                .join("\n\n")
                .slice(0, 5000);
        } catch {
          retrieved = "";
        }
      }
      const messages: AiChatMessage[] = history
        .map((item) => ({
          role: item.role,
          content:
            item.role === "user"
              ? userContent(item.content, item.attachments, tr("wikiAsk.uploaded"), tr("wikiAsk.question"), tr("ai.attachmentsPrompt"))
              : item.content,
        }))
        .filter((item) => item.content.trim());
      if (!messages.length || messages[messages.length - 1]?.role !== "user") {
        messages.push({
          role: "user",
          content: userContent(text, attach, tr("wikiAsk.uploaded"), tr("wikiAsk.question"), tr("ai.attachmentsPrompt")) || tr("ai.attachmentsPrompt"),
        });
      }
      if (retrieved) {
        const last = messages[messages.length - 1];
        if (last?.role === "user") {
          const room = MESSAGE_LIMIT - last.content.length - 2;
          const block = `${tr("wikiAsk.retrieved")}\n${retrieved}`.slice(0, Math.max(0, room));
          if (block.trim()) {
            last.content = `${block}\n\n${last.content}`;
          }
        }
      }
      const result = await aiChat(
        {
          messages,
          attachments: capImages(uploadedFiles),
          system: t("wikiAsk.system"),
          rag: !aboutTodos,
        },
        controller.signal,
        {
          onDelta: (delta) => {
            setBubbles((prev) =>
              prev.map((item) => (item.id === assistantId ? { ...item, content: item.content + delta } : item)),
            );
          },
        },
      );
      const finalText = result.reply.trim() || tr("spotlight.emptyReply");
      setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: finalText } : item)));
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setError(aiErrorMessage(err instanceof Error ? err.message : tr("spotlight.failedToSend")));
      onFail();
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
        setReplyingId(null);
      }
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if ((!text && !attachments.length) || sending) {
      return;
    }
    if (!loggedIn) {
      setError(tr("wikiAsk.login"));
      return;
    }
    const attach = attachments;
    const user: ChatBubble = { id: uid(), role: "user", content: text, attachments: attach.length ? attach : undefined };
    const history = [...bubbles, user];
    const assistantId = uid();
    setBubbles([...history, { id: assistantId, role: "assistant", content: "" }]);
    setPrompt("");
    setAttachments([]);
    void answer(history, assistantId, () => {
      setBubbles((prev) => prev.filter((item) => item.id !== user.id && item.id !== assistantId));
      setPrompt(text);
      setAttachments(attach);
    });
  };

  const regenerate = (assistantId: string) => {
    if (sending) {
      return;
    }
    const index = bubbles.findIndex((item) => item.id === assistantId);
    if (index < 0) {
      return;
    }
    let userIndex = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (bubbles[i]?.role === "user") {
        userIndex = i;
        break;
      }
    }
    if (userIndex < 0) {
      return;
    }
    const previous = bubbles[index]?.content ?? "";
    const history = bubbles.slice(0, userIndex + 1);
    setBubbles([...history, { id: assistantId, role: "assistant", content: "" }]);
    void answer(history, assistantId, () => {
      setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: previous } : item)));
    });
  };

  const copyReply = async (item: ChatBubble) => {
    const ok = await copyText(item.content);
    if (!ok) {
      setError(tr("wikiAsk.copyFailed"));
      return;
    }
    setCopiedId(item.id);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      setCopiedId((current) => (current === item.id ? null : current));
    }, 1600);
  };

  return (
    <aside
      className="fixed top-0 right-0 bottom-0 z-50 flex w-[min(420px,100vw)] flex-col border-l border-border bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] shadow-[-12px_0_32px_rgb(0_0_0/0.08)]"
      /* 跟随可视视口（top + height）：键盘弹出 / iOS 平移可视视口时都精确覆盖可见区域，
         键盘弹出时去掉底部安全距离，贴住键盘上沿 */
      style={{
        top: viewport.top,
        height: viewport.height,
        paddingBottom: viewport.keyboardOpen ? "0px" : undefined,
      }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Robot {...iconParkOutline} size={16} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{tr("wikiAsk.title")}</span>
        <Button type="button" variant="ghost" size="icon" aria-label={tr("wikiAsk.close")} onClick={onClose}>
          <Close {...iconParkOutline} size={16} />
        </Button>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {bubbles.map((item) => (
          <div key={item.id} className={item.role === "user" ? "select-text text-sm" : "select-text rounded-md bg-muted px-3 py-2 text-sm"}>
            {item.role === "assistant" ? (
              <>
                <ChatMarkdown content={item.content || (sending && item.id === replyingId ? tr("spotlight.thinking") : "")} />
                {item.content.trim() && item.id !== replyingId ? (
                  <div className="mt-2 flex items-center gap-1">
                    <Button type="button" variant="ghost" size="xs" onClick={() => void copyReply(item)}>
                      <Copy {...iconParkOutline} size={14} />
                      {copiedId === item.id ? tr("wikiAsk.copied") : tr("wikiAsk.copy")}
                    </Button>
                    <Button type="button" variant="ghost" size="xs" disabled={sending} onClick={() => regenerate(item.id)}>
                      <Refresh {...iconParkOutline} size={14} />
                      {tr("wikiAsk.regenerate")}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                {item.content}
                {item.attachments?.length ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.attachments.map((file) => file.name).join(tr("common.listSeparator"))}
                  </p>
                ) : null}
              </>
            )}
          </div>
        ))}
      </div>
      <form
        className="shrink-0 border-t border-border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {attachments.length ? (
          <PendingAttachments
            items={attachments}
            onRemove={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
          />
        ) : null}
        {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
        {!loggedIn ? <p className="mb-2 text-xs text-muted-foreground">{tr("wikiAsk.login")}</p> : null}
        <textarea
          ref={inputRef}
          rows={3}
          value={prompt}
          disabled={!loggedIn || sending}
          enterKeyHint="send"
          placeholder={tr("wikiAsk.placeholder")}
          aria-label={tr("wikiAsk.placeholder")}
          // text-base(16px) 防止 iOS 聚焦时整页放大；桌面端回到 text-sm
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={`${AI_FILE_ACCEPT},.docx,.xlsx,.xls,.csv`}
              className="hidden"
              onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
            />
            <Button type="button" variant="ghost" size="sm" className="min-h-9" disabled={!loggedIn || uploading} onClick={() => fileRef.current?.click()}>
              <Paperclip {...iconParkOutline} size={14} />
              {tr("wikiAsk.attach")}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{tr("wikiAsk.hint")}</span>
            {!loggedIn ? (
              <Button type="button" size="sm" onClick={onLogin}>
                {tr("app.logIn")}
              </Button>
            ) : (
              <Button type="submit" size="sm" className="min-h-9 px-4" disabled={sending || uploading || (!prompt.trim() && !attachments.length)}>
                {tr("wikiAsk.send")}
              </Button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
