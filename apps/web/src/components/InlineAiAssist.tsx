import type { AiAttachment, EditorJsBlock } from "@myblog/shared";
import EditorJS from "@editorjs/editorjs";
import { Close, Paperclip } from "@icon-park/react";
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

type Props = {
  editor: EditorJS | null;
  insertIndex: number;
  onClose: () => void;
  /** 接受写入后（触发自动保存等） */
  onAccepted?: () => void;
};

type Phase = "compose" | "loading" | "preview" | "error";

type LocalAttachment =
  | { id: string; kind: "image"; name: string; url: string }
  | { id: string; kind: "text"; name: string; text: string };

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
    return "没能生成可用内容，换个说法试试。";
  }
  if (message === "AI_EMPTY_REPLY") {
    return "模型没有回复，稍后再试。";
  }
  if (message.startsWith("AI_UPSTREAM_")) {
    return "上游 AI 接口报错，检查密钥与模型配置。";
  }
  return message;
}

function measureAnchor(insertIndex: number): { top: number; left: number; width: number } {
  const blocks = document.querySelectorAll(".notion-editor .ce-block");
  const fallback = document.querySelector(".notion-editor");
  const el =
    (blocks[Math.min(insertIndex, Math.max(0, blocks.length - 1))] as HTMLElement | undefined) ??
    (fallback as HTMLElement | null);
  if (!el) {
    return {
      top: Math.min(160, window.innerHeight * 0.2),
      left: Math.max(24, (window.innerWidth - 420) / 2),
      width: 420,
    };
  }
  const rect = el.getBoundingClientRect();
  const width = Math.min(480, Math.max(300, rect.width));
  let top = rect.bottom + 8;
  if (top + 220 > window.innerHeight - 16) {
    top = Math.max(16, rect.top - 8 - 180);
  }
  const left = Math.min(Math.max(16, rect.left), window.innerWidth - width - 16);
  return { top, left, width };
}

const DEFAULT_WITH_ATTACH =
  "请结合我上传的附件写一段适合放进正文的内容；图片请用 image 块插入并配简短说明。";

export function InlineAiAssist({ editor, insertIndex, onClose, onAccepted }: Props) {
  const [phase, setPhase] = useState<Phase>("compose");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [anchor, setAnchor] = useState(() => measureAnchor(insertIndex));
  const [preview, setPreview] = useState<{ startIndex: number; count: number; blockIds: string[] } | null>(
    null,
  );
  const lastPromptRef = useRef("");
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .aiStatus()
      .then((data) => setEnabled(data.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useLayoutEffect(() => {
    const sync = () => setAnchor(measureAnchor(insertIndex));
    sync();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);
    return () => {
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [insertIndex, phase, preview, attachments.length]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 40);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void discardAndClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview, phase]);

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

  const discardAndClose = async () => {
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
      setPhase("error");
    } finally {
      setUploading(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const generate = async (text: string, attachOverride?: LocalAttachment[]) => {
    const attach = attachOverride ?? attachmentsRef.current;
    const promptText = text.trim() || (attach.length ? DEFAULT_WITH_ATTACH : "");
    if (!promptText || !editor) {
      return;
    }
    if (!enabled) {
      setError(aiErrorMessage("AI_NOT_CONFIGURED"));
      setPhase("error");
      return;
    }

    if (preview) {
      clearPreview();
    }

    lastPromptRef.current = promptText;
    setPhase("loading");
    setError("");
    try {
      const document = await saveEditor(editor);
      const result = await api.aiToEditor({
        messages: [{ role: "user", content: promptText }],
        attachments: payloadAttachments(attach),
        document,
        apply: "append",
      });
      const blocks = result.blocks as EditorJsBlock[];
      if (!blocks.length) {
        throw new Error("AI_EMPTY_BLOCKS");
      }
      const inserted = await insertEditorBlocksAt(editor, blocks, insertIndex);
      markEditorPreviewBlocks(inserted.blockIds, true);
      setPreview(inserted);
      setPhase("preview");
      setAnchor(measureAnchor(insertIndex));
    } catch (err) {
      setError(aiErrorMessage(err instanceof Error ? err.message : "生成失败"));
      setPhase("error");
    }
  };

  const accept = () => {
    if (preview?.blockIds.length) {
      markEditorPreviewBlocks(preview.blockIds, false);
    }
    setPreview(null);
    onAccepted?.();
    onClose();
  };

  const retry = () => {
    void generate(lastPromptRef.current || prompt);
  };

  const canGenerate = enabled && !uploading && Boolean(prompt.trim() || attachments.length);

  return createPortal(
    <div className="ai-inline-root" aria-live="polite">
      <button type="button" className="ai-inline-scrim" aria-label="关闭写作助手" onClick={() => void discardAndClose()} />
      <div
        ref={panelRef}
        className={cn(
          "ai-inline-panel",
          phase === "preview" && "ai-inline-panel--preview",
          dragOver && "ai-inline-panel--drag",
        )}
        style={{
          top: anchor.top,
          left: anchor.left,
          width: anchor.width,
        }}
        role="dialog"
        aria-label="写作助手"
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
        {phase === "compose" || phase === "error" ? (
          <>
            <div className="ai-inline-head">
              <span className="ai-inline-brand">写作助手</span>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭" onClick={() => void discardAndClose()}>
                <Close {...iconParkOutline} size={14} />
              </Button>
            </div>

            {attachments.length ? (
              <div className="ai-inline-attach-list">
                {attachments.map((item) => (
                  <span key={item.id} className="ai-inline-attach-chip">
                    {item.kind === "image" ? (
                      <img src={item.url} alt="" className="ai-inline-attach-thumb" />
                    ) : null}
                    <span className="truncate">
                      {item.kind === "image" ? "图" : "文"} · {item.name}
                    </span>
                    <button
                      type="button"
                      className="ai-inline-attach-remove"
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
              className="ai-inline-input"
              rows={2}
              value={prompt}
              placeholder={
                attachments.length
                  ? "说说怎么结合这些附件写…（可空，直接生成）"
                  : "写点什么… 也可拖入图片 / 文本，或点回形针上传"
              }
              onChange={(e) => setPrompt(e.currentTarget.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData?.files ?? []);
                if (files.length) {
                  e.preventDefault();
                  void addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void generate(prompt);
                }
              }}
            />
            {error ? <p className="ai-inline-error">{error}</p> : null}
            <div className="ai-inline-actions">
              <div className="ai-inline-actions-left">
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
                  title={uploading ? "上传中…" : "添加图片或文本"}
                  aria-label="添加图片或文本"
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip {...iconParkOutline} size={16} />
                </Button>
                <span className="ai-inline-hint">
                  {uploading ? "上传中…" : "Enter 生成 · Esc 关闭"}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                disabled={!canGenerate}
                onClick={() => void generate(prompt)}
              >
                生成
              </Button>
            </div>
          </>
        ) : null}

        {phase === "loading" ? (
          <div className="ai-inline-loading">
            <span className="ai-dot size-1.5 rounded-full bg-muted-foreground/70" />
            <span className="ai-dot ai-dot-delay-1 size-1.5 rounded-full bg-muted-foreground/70" />
            <span className="ai-dot ai-dot-delay-2 size-1.5 rounded-full bg-muted-foreground/70" />
            <span className="text-xs text-muted-foreground">
              {attachments.length ? "结合附件生成中…" : "正在生成…"}
            </span>
          </div>
        ) : null}

        {phase === "preview" ? (
          <div className="ai-inline-preview-bar">
            <p className="ai-inline-preview-label">预览已插入正文 · 尚未确认</p>
            <div className="ai-inline-preview-actions">
              <Button type="button" variant="ghost" size="sm" onClick={() => void discardAndClose()}>
                丢弃
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                重试
              </Button>
              <Button type="button" size="sm" onClick={accept}>
                接受
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
