import type { EditorJsBlock } from "@myblog/shared";
import type EditorJS from "@editorjs/editorjs";
import { useEffect, useRef, useState } from "react";
import { aiChat, aiStatus, aiToEditor } from "@/lib/ai/client";
import { insertEditorBlocksAt, saveEditor } from "@/lib/document/insertBlocks";
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
} from "@/lib/ai/chat";
import { blocksToPreviewMarkdown, markdownToEditorBlocks } from "@/lib/ai/markdown";
import { t } from "@/i18n";

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
  const [statusError, setStatusError] = useState("");
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
    void aiStatus()
      .then((data) => {
        setEnabled(data.enabled);
        setStatusError(data.enabled ? "" : aiErrorMessage("AI_NOT_CONFIGURED"));
      })
      .catch((err: unknown) => {
        setEnabled(false);
        setStatusError(err instanceof Error ? err.message : t("common.aiServiceUnavailable"));
      });
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
      setError(err instanceof Error ? err.message : t("spotlight.attachmentFailed"));
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
      setError(statusError || aiErrorMessage("AI_NOT_CONFIGURED"));
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
      const result = await aiChat(
        {
          messages: toApiMessages(nextBubbles),
          attachments: toApiAttachments(attach),
          document: editorDocument,
        },
        signal,
      );
      setBubbles((prev) => [
        ...prev,
        { id: uid(), role: "assistant", content: result.reply.trim() || t("spotlight.emptyReply") },
      ]);
    } catch (err) {
      if (isAbort(err) || signal.aborted) {
        return;
      }
      setError(aiErrorMessage(err instanceof Error ? err.message : t("spotlight.failedToSend")));
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

  const insertDirect = async (message: ChatBubble) => {
    if (!editor || insertingId) {
      return;
    }
    setInsertingId(message.id);
    setError("");
    try {
      const blocks = markdownToEditorBlocks(message.content);
      if (!blocks.length) {
        throw new Error(t("spotlight.nothingToInsert"));
      }
      const at = currentBlockIndex(editor, insertIndex);
      const inserted = await insertEditorBlocksAt(editor, blocks, at);
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
      setError(aiErrorMessage(err instanceof Error ? err.message : t("spotlight.failedToInsert")));
    } finally {
      setInsertingId(null);
    }
  };

  const summarize = async (messages: ChatBubble[]) => {
    if (!editor || messages.length < 2 || insertingId) {
      return;
    }
    if (!enabled) {
      setError(statusError || aiErrorMessage("AI_NOT_CONFIGURED"));
      return;
    }

    setInsertingId("summary");
    setError("");
    const signal = nextSignal();
    try {
      const editorDocument = await saveEditor(editor);
      if (signal.aborted) {
        return;
      }
      const result = await aiToEditor(
        {
          messages: [
            ...toApiMessages(messages),
            {
              role: "user",
              content: t("spotlight.combinePrompt"),
            },
          ],
          document: editorDocument,
          apply: "append",
        },
        signal,
      );
      const blocks = result.blocks as EditorJsBlock[];
      if (!blocks.length) {
        throw new Error("AI_EMPTY_BLOCKS");
      }
      setDraft({
        messageId: "summary",
        blocks,
        note: result.note,
        markdown: blocksToPreviewMarkdown(blocks),
      });
    } catch (err) {
      if (isAbort(err) || signal.aborted) {
        return;
      }
      setError(aiErrorMessage(err instanceof Error ? err.message : t("spotlight.failedToCombine")));
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
      setError(aiErrorMessage(err instanceof Error ? err.message : t("spotlight.failedToInsert")));
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
    insertDirect,
    summarize,
    confirmDraft,
    canSend,
  };
}
