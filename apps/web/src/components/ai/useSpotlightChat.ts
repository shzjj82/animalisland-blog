import type { EditorJsBlock } from "@myblog/shared";
import type EditorJS from "@editorjs/editorjs";
import { useEffect, useRef, useState } from "react";
import { insertEditorBlocksAt, saveEditor } from "@/content";
import { api } from "@/lib/api";
import {
  aiErrorMessage,
  buildUserChatContent,
  currentBlockIndex,
  parseLocalFiles,
  toApiAttachments,
  toApiMessages,
  uid,
  type ChatBubble,
  type LocalAttachment,
} from "@/lib/aiChat";
import { blocksToPreviewMarkdown } from "@/lib/chatMarkdown";

export type DraftInsert = {
  messageId: string;
  blocks: EditorJsBlock[];
  note?: string;
  markdown: string;
};

type Options = {
  open: boolean;
  editor: EditorJS | null;
  insertIndex: number;
  onInserted?: () => void;
};

export function useSpotlightChat({ open, editor, insertIndex, onInserted }: Options) {
  const [enabled, setEnabled] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [insertingId, setInsertingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [quote, setQuote] = useState("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState<DraftInsert | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const bubblesRef = useRef(bubbles);
  bubblesRef.current = bubbles;

  const abortInFlight = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const nextSignal = () => {
    abortInFlight();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller.signal;
  };

  useEffect(() => {
    if (!open) {
      abortInFlight();
      return;
    }
    void api
      .aiStatus()
      .then((data) => setEnabled(data.enabled))
      .catch(() => setEnabled(false));
    return () => abortInFlight();
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [bubbles, sending, draft]);

  const resetChat = () => {
    abortInFlight();
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

  const addFiles = async (files: File[]) => {
    if (!files.length) {
      return;
    }
    setError("");
    setUploading(true);
    try {
      const next = await parseLocalFiles(files);
      setAttachments((prev) => [...prev, ...next]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "附件失败");
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const isAbort = (err: unknown) =>
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError");

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

    const userBubble: ChatBubble = {
      id: uid(),
      role: "user",
      content: buildUserChatContent({
        text,
        quote,
        hasAttachments: attach.length > 0,
      }),
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

    const signal = nextSignal();
    try {
      const editorDocument = editor ? await saveEditor(editor) : undefined;
      if (signal.aborted) {
        return;
      }
      const result = await api.aiChat(
        {
          messages: toApiMessages(nextBubbles),
          attachments: toApiAttachments(attach),
          document: editorDocument,
        },
        { signal },
      );
      setBubbles((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: result.reply.trim() || "（空回复）" },
      ]);
    } catch (err) {
      if (isAbort(err) || signal.aborted) {
        return;
      }
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
      if (!signal.aborted) {
        setSending(false);
      }
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
    const signal = nextSignal();
    try {
      const history = bubblesRef.current;
      const cut = history.findIndex((item) => item.id === message.id);
      const context = cut >= 0 ? history.slice(0, cut + 1) : [...history, message];
      const editorDocument = await saveEditor(editor);
      if (signal.aborted) {
        return;
      }
      const result = await api.aiToEditor(
        {
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
        },
        { signal },
      );
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
      if (isAbort(err) || signal.aborted) {
        return;
      }
      setError(aiErrorMessage(err instanceof Error ? err.message : "整理失败"));
    } finally {
      if (!signal.aborted) {
        setInsertingId(null);
      }
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

  const canSend =
    enabled && !uploading && !sending && Boolean(prompt.trim() || attachments.length || quote);

  return {
    enabled,
    prompt,
    setPrompt,
    error,
    sending,
    insertingId,
    uploading,
    attachments,
    setAttachments,
    quote,
    setQuote,
    bubbles,
    draft,
    setDraft,
    listRef,
    fileRef,
    resetChat,
    addFiles,
    send,
    insertReply,
    confirmDraft,
    canSend,
  };
}
