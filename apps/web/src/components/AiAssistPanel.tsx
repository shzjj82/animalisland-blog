import type { AiAttachment, AiChatMessage } from "@myblog/shared";
import EditorJS from "@editorjs/editorjs";
import { Paperclip, RotateCcw, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { applyEditorBlocks, saveEditor } from "@/components/PostEditor";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type LocalAttachment =
  | { id: string; kind: "image"; name: string; url: string }
  | { id: string; kind: "text"; name: string; text: string };

type UiMessage = AiChatMessage & { id: string };

type Props = {
  editor: EditorJS | null;
  className?: string;
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
    return "没能转成 Editor.js 块，再聊两句或换个说法试试。";
  }
  if (message === "AI_EMPTY_REPLY") {
    return "模型没有回复，稍后再试。";
  }
  if (message.startsWith("AI_UPSTREAM_")) {
    return "上游 AI 接口报错，检查密钥、模型名和 AI_API_BASE。";
  }
  return message;
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function AiAssistPanel({ editor, className }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "你好，我是写作助手。可以说说想写什么，聊得差不多后，用下方技能把内容整理进正文。",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [skillBusy, setSkillBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void api
      .aiStatus()
      .then((data) => {
        setEnabled(data.enabled);
      })
      .catch(() => {
        setEnabled(false);
      });
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, busy, skillBusy]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) {
      return;
    }
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  const payloadAttachments = (): AiAttachment[] =>
    attachments.map((item) =>
      item.kind === "image"
        ? { kind: "image", name: item.name, url: item.url }
        : { kind: "text", name: item.name, text: item.text },
    );

  const toApiMessages = (list: UiMessage[]): AiChatMessage[] =>
    list
      .filter((item) => item.id !== "welcome")
      .map(({ role, content }) => ({ role, content }));

  const addFiles = async (files: File[]) => {
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

  const send = async () => {
    const text = draft.trim();
    if (!text || busy || skillBusy) {
      return;
    }
    if (!enabled) {
      setError(aiErrorMessage("AI_NOT_CONFIGURED"));
      return;
    }

    const userMsg: UiMessage = { id: uid(), role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setDraft("");
    setBusy(true);
    setError("");
    setNote("");
    try {
      const document = await saveEditor(editor);
      const { reply } = await api.aiChat({
        messages: toApiMessages(nextMessages),
        attachments: payloadAttachments(),
        document,
      });
      setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: reply }]);
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "AI 失败"));
    } finally {
      setBusy(false);
    }
  };

  const runToEditorSkill = async (apply: "replace" | "append") => {
    if (!enabled) {
      setError(aiErrorMessage("AI_NOT_CONFIGURED"));
      return;
    }
    const usable = toApiMessages(messages);
    if (usable.filter((item) => item.role === "user").length === 0) {
      setError("先聊几句再转成 Editor.js。");
      return;
    }
    setSkillBusy(true);
    setError("");
    setNote("");
    try {
      const document = await saveEditor(editor);
      const result = await api.aiToEditor({
        messages: usable,
        attachments: payloadAttachments(),
        document,
        apply,
      });
      await applyEditorBlocks(editor, result.blocks, result.apply);
      const tip = result.note || (result.apply === "replace" ? "已写入编辑器（替换）" : "已追加到编辑器");
      setNote(tip);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: `已执行技能「转成 Editor.js」：${tip}`,
        },
      ]);
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "转换失败"));
    } finally {
      setSkillBusy(false);
    }
  };

  const clearChat = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "对话已清空。再说说你想写什么吧。",
      },
    ]);
    setNote("");
    setError("");
  };

  const canSend = enabled && !busy && !skillBusy && Boolean(draft.trim());

  return (
    <aside
      className={cn(
        "ai-side flex h-full min-h-0 w-[360px] shrink-0 flex-col border-l border-border/60 bg-background",
        className,
      )}
      aria-label="AI 写作助手"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-3.5">
        <p className="text-sm font-semibold tracking-tight text-foreground">写作助手</p>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          title="清空对话"
          onClick={clearChat}
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2" ref={listRef}>
        {messages.map((item) => {
          const isUser = item.role === "user";
          return (
            <div
              key={item.id}
              className={cn("flex", isUser ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[88%] px-3.5 py-2.5 text-[13px] leading-6",
                  isUser
                    ? "rounded-[18px] rounded-tr-md bg-foreground text-background"
                    : "rounded-[18px] rounded-tl-md bg-muted/70 text-foreground",
                )}
              >
                <p className="whitespace-pre-wrap break-words">{item.content}</p>
              </div>
            </div>
          );
        })}

        {busy ? (
          <div className="flex justify-start">
            <div className="rounded-[18px] rounded-tl-md bg-muted/70 px-4 py-3">
              <div className="flex items-center gap-1">
                <span className="ai-dot size-1.5 rounded-full bg-muted-foreground/70" />
                <span className="ai-dot ai-dot-delay-1 size-1.5 rounded-full bg-muted-foreground/70" />
                <span className="ai-dot ai-dot-delay-2 size-1.5 rounded-full bg-muted-foreground/70" />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="shrink-0 space-y-2 px-3 pb-3 pt-1">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={!enabled || busy || skillBusy}
            className="inline-flex h-7 items-center rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-45"
            onClick={() => void runToEditorSkill("replace")}
          >
            {skillBusy ? "写入中…" : "写入正文"}
          </button>
          <button
            type="button"
            disabled={!enabled || busy || skillBusy}
            className="inline-flex h-7 items-center rounded-full border border-border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-45"
            onClick={() => void runToEditorSkill("append")}
          >
            追加到文末
          </button>
        </div>

        {error ? <p className="px-1 text-xs text-destructive">{error}</p> : null}
        {note ? <p className="px-1 text-xs text-muted-foreground">{note}</p> : null}

        <div className="rounded-[22px] border border-border bg-muted/40 p-2">
          {attachments.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5 px-1 pt-1">
              {attachments.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-background px-2 py-1 text-[11px] text-muted-foreground ring-1 ring-border"
                >
                  <span className="truncate">
                    {item.kind === "image" ? "图" : "文"} · {item.name}
                  </span>
                  <button
                    type="button"
                    className="rounded-full p-0.5 hover:bg-muted hover:text-foreground"
                    onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== item.id))}
                    aria-label={`移除 ${item.name}`}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <textarea
            ref={inputRef}
            className="max-h-[120px] min-h-[44px] w-full resize-none bg-transparent px-2.5 py-1.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/70"
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="发消息给写作助手…"
            rows={1}
            disabled={busy || skillBusy}
          />

          <div className="mt-1 flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-1">
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
                disabled={uploading || busy || skillBusy}
                title={uploading ? "上传中…" : "添加附件"}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
            </div>

            <button
              type="button"
              disabled={!canSend}
              className={cn(
                "inline-flex size-8 items-center justify-center rounded-full transition",
                canSend
                  ? "bg-foreground text-background hover:opacity-90"
                  : "bg-muted text-muted-foreground/50",
              )}
              aria-label="发送"
              onClick={() => void send()}
            >
              <SendHorizontal className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
