import { useEffect, useRef, useState } from "react";
import { Close, Paperclip, Robot } from "@icon-park/react";
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
import { retrieveWiki, type SearchDoc } from "@/lib/document/search";
import { fileExtension } from "@/lib/document/fileKinds";
import { iconParkOutline } from "@/lib/iconPark";
import { t } from "@/i18n";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  focusToken: number;
  loggedIn: boolean;
  loadDocs: () => Promise<SearchDoc[]>;
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

export function WikiChat({ open, focusToken, loggedIn, loadDocs, onClose, onLogin }: Props) {
  const { t: tr } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

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
    setError("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const docs = loggedIn ? await loadDocs() : [];
      const hits = text ? retrieveWiki(docs, text) : [];
      const uploadedFiles = toApiAttachments(attach).filter((item) =>
        item.kind === "image" ? Boolean(item.url) : Boolean(item.text.trim()),
      );
      const wikiFiles: AiAttachment[] = hits.map((hit) => ({
        kind: "text" as const,
        name: hit.title,
        text: hit.excerpt || tr("wikiAsk.empty"),
      }));
      if (!hits.length && text && !uploadedFiles.length) {
        wikiFiles.push({ kind: "text", name: tr("wikiAsk.title"), text: tr("wikiAsk.empty") });
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
      const result = await aiChat(
        {
          messages,
          attachments: capImages([...uploadedFiles, ...wikiFiles]),
          system: t("wikiAsk.system"),
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
      const sources = hits.map((hit) => hit.title).filter(Boolean);
      const withSources = sources.length
        ? `${finalText}\n\n${tr("wikiAsk.sources")}: ${sources.join(tr("common.listSeparator"))}`
        : finalText;
      setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: withSources } : item)));
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      setError(aiErrorMessage(err instanceof Error ? err.message : tr("spotlight.failedToSend")));
      setBubbles((prev) => prev.filter((item) => item.id !== user.id && item.id !== assistantId));
      setPrompt(text);
      setAttachments(attach);
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
      }
    }
  };

  return (
    <aside className="fixed top-0 right-0 bottom-0 z-50 flex w-[min(420px,100vw)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgb(0_0_0/0.08)]">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Robot {...iconParkOutline} size={16} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{tr("wikiAsk.title")}</span>
        <Button type="button" variant="ghost" size="icon" aria-label={tr("wikiAsk.close")} onClick={onClose}>
          <Close {...iconParkOutline} size={16} />
        </Button>
      </header>
      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {bubbles.map((item) => (
          <div key={item.id} className={item.role === "user" ? "text-sm" : "rounded-md bg-muted px-3 py-2 text-sm"}>
            {item.role === "assistant" ? (
              <ChatMarkdown content={item.content || (sending ? tr("spotlight.thinking") : "")} />
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
          placeholder={tr("wikiAsk.placeholder")}
          aria-label={tr("wikiAsk.placeholder")}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <Button type="button" variant="ghost" size="sm" disabled={!loggedIn || uploading} onClick={() => fileRef.current?.click()}>
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
              <Button type="submit" size="sm" disabled={sending || uploading || (!prompt.trim() && !attachments.length)}>
                {tr("wikiAsk.send")}
              </Button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
