import { useEffect, useRef, useState, type ReactNode } from "react";
import { Close, Copy, Paperclip, Refresh, Send, SettingTwo, Time } from "@icon-park/react";
import type { AiAttachment, AiChatMessage } from "@myblog/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChatMarkdown } from "@/components/editor-spotlight/ChatMarkdown";
import { PendingAttachments } from "@/components/editor-spotlight/ChatAttachments";
import {
  aiChat,
  deleteAgentConversation,
  getAgentConversation,
  listAgentConversations,
} from "@/lib/ai/client";
import {
  AI_FILE_ACCEPT,
  aiErrorMessage,
  parseLocalFiles,
  toApiAttachments,
  uid,
  type ChatBubble,
  type LocalAttachment,
} from "@/lib/ai/chat";
import {
  SKILL_SYSTEM,
  extractSkills,
  isDesktopApp,
  loadSkillGrants,
  runSkill,
  saveSkillGrants,
  skillPreview,
  skillScope,
  type SkillCall,
  type SkillGrants,
  type SkillScope,
} from "@/lib/ai/skills";
import { readFileText } from "@/lib/document/fileText";
import { fileExtension } from "@/lib/document/fileKinds";
import { pageTodos, retrieveWiki, type SearchDoc } from "@/lib/document/search";
import { copyText } from "@/lib/clipboard";
import {
  detailToThread,
  loadActiveThreadId,
  saveActiveThreadId,
  summaryToThread,
  type WikiThread,
} from "@/lib/ai/wikiChatHistory";
import { iconParkOutline } from "@/lib/iconPark";
import { t } from "@/i18n";
import { useTranslation } from "react-i18next";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { HistoryPanel, HISTORY_SIDEBAR_W } from "./HistoryPanel";

type Props = {
  open: boolean;
  focusToken: number;
  loggedIn: boolean;
  loadPages?: () => Promise<SearchDoc[]>;
  onClose: () => void;
  onLogin: () => void;
};

type Frame = { x: number; y: number; w: number; h: number };

const FRAME_KEY = "editor:wiki-chat-frame";
const MIN_W = 340;
const MIN_H = 480;
const DEFAULT_H = 720;
const LEGACY_H = 560;

function defaultFrame(): Frame {
  const w = Math.min(400, Math.max(MIN_W, window.innerWidth - 32));
  const h = Math.min(DEFAULT_H, Math.max(MIN_H, window.innerHeight - 40));
  return {
    w,
    h,
    x: Math.max(16, window.innerWidth - w - 24),
    y: Math.max(16, window.innerHeight - h - 24),
  };
}

function loadFrame(): Frame {
  try {
    const raw = localStorage.getItem(FRAME_KEY);
    if (!raw) {
      return defaultFrame();
    }
    const parsed = JSON.parse(raw) as Partial<Frame>;
    const base = defaultFrame();
    const savedH = Number(parsed.h) || 0;
    const useDefaultH = !savedH || savedH === LEGACY_H;
    return clampFrame({
      x: Number(parsed.x) || base.x,
      y: useDefaultH ? base.y : Number(parsed.y) || base.y,
      w: Number(parsed.w) || base.w,
      h: useDefaultH ? base.h : savedH,
    });
  } catch {
    return defaultFrame();
  }
}

function windowBox(frame: Frame, historyOpen: boolean): { left: number; width: number } {
  if (!historyOpen) {
    return { left: frame.x, width: frame.w };
  }
  const extra = HISTORY_SIDEBAR_W;
  const preferLeft = frame.x - extra;
  if (preferLeft >= 8) {
    return { left: preferLeft, width: frame.w + extra };
  }
  const maxRight = window.innerWidth - 8;
  return { left: frame.x, width: Math.min(frame.w + extra, Math.max(frame.w, maxRight - frame.x)) };
}

function clampFrame(frame: Frame): Frame {
  const w = Math.min(Math.max(frame.w, MIN_W), Math.max(MIN_W, window.innerWidth - 16));
  const h = Math.min(Math.max(frame.h, MIN_H), Math.max(MIN_H, window.innerHeight - 16));
  return {
    w,
    h,
    x: Math.min(Math.max(8, frame.x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, frame.y), Math.max(8, window.innerHeight - h - 8)),
  };
}

type ResizeCorner = "nw" | "ne" | "sw" | "se";
type DragMode = "move" | ResizeCorner;

function resizeFrame(start: Frame, dx: number, dy: number, corner: ResizeCorner): Frame {
  const maxW = Math.max(MIN_W, window.innerWidth - 16);
  const maxH = Math.max(MIN_H, window.innerHeight - 16);
  const east = corner === "ne" || corner === "se";
  const south = corner === "sw" || corner === "se";
  const w = Math.min(Math.max(east ? start.w + dx : start.w - dx, MIN_W), maxW);
  const h = Math.min(Math.max(south ? start.h + dy : start.h - dy, MIN_H), maxH);
  return clampFrame({
    w,
    h,
    x: east ? start.x : start.x + start.w - w,
    y: south ? start.y : start.y + start.h - h,
  });
}

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
  const desktop = isDesktopApp();
  const [frame, setFrame] = useState<Frame>(() => (typeof window === "undefined" ? { x: 24, y: 24, w: 400, h: DEFAULT_H } : loadFrame()));
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<WikiThread[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [grants, setGrants] = useState<SkillGrants>(() => loadSkillGrants());
  const [permOpen, setPermOpen] = useState(false);
  const [pendingSkills, setPendingSkills] = useState<SkillCall[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const copiedTimer = useRef(0);
  const dragRef = useRef<{ pointer: number; x: number; y: number; start: Frame; mode: DragMode } | null>(null);
  const sendingRef = useRef(false);
  sendingRef.current = sending;

  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      return;
    }
    setFrame(loadFrame());
    const timer = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [open, focusToken]);


  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (permOpen) {
          setPermOpen(false);
          return;
        }
        if (historyOpen) {
          setHistoryOpen(false);
          return;
        }
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, permOpen, historyOpen]);

  useEffect(() => {
    const onResize = () => setFrame((prev) => clampFrame(prev));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    localStorage.setItem(FRAME_KEY, JSON.stringify(frame));
  }, [frame, open]);

  useEffect(() => {
    if (!open || !loggedIn) {
      if (!loggedIn) {
        setThreads([]);
        setThreadId(null);
        setBubbles([]);
      }
      return;
    }
    const untitled = tr("wikiAsk.untitledChat");
    let cancelled = false;
    void (async () => {
      try {
        const list = await listAgentConversations(untitled);
        if (cancelled) {
          return;
        }
        setThreads(list.map(summaryToThread));
        const active = loadActiveThreadId();
        if (!active || sendingRef.current) {
          return;
        }
        if (!list.some((item) => item.id === active)) {
          return;
        }
        const detail = await getAgentConversation(active, untitled);
        if (cancelled || sendingRef.current) {
          return;
        }
        const thread = detailToThread(detail);
        setThreadId(thread.id);
        setBubbles(thread.bubbles);
      } catch {
        if (!cancelled) {
          setError((prev) => prev || tr("wikiAsk.historyLoadFailed"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loggedIn, tr]);

  useEffect(() => {
    if (!open || !loggedIn || !historyOpen) {
      return;
    }
    const untitled = tr("wikiAsk.untitledChat");
    let cancelled = false;
    void listAgentConversations(untitled)
      .then((list) => {
        if (!cancelled) {
          setThreads(list.map(summaryToThread));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, loggedIn, historyOpen, tr]);

  if (!open) {
    return null;
  }

  const persistGrants = (next: SkillGrants) => {
    setGrants(next);
    saveSkillGrants(next);
  };

  const rememberConversation = (id: string | null | undefined) => {
    if (!id) {
      return;
    }
    setThreadId(id);
    saveActiveThreadId(id);
  };

  const refreshThreads = async () => {
    const list = await listAgentConversations(tr("wikiAsk.untitledChat"));
    setThreads(list.map(summaryToThread));
  };

  const startNewChat = () => {
    abortRef.current?.abort();
    setSending(false);
    setPendingSkills([]);
    setError("");
    setPrompt("");
    setAttachments([]);
    setBubbles([]);
    setThreadId(null);
    saveActiveThreadId(null);
    setPermOpen(false);
  };

  const openThread = (id: string) => {
    abortRef.current?.abort();
    setSending(false);
    setPendingSkills([]);
    setError("");
    setPrompt("");
    setAttachments([]);
    rememberConversation(id);
    void (async () => {
      try {
        const detail = await getAgentConversation(id, tr("wikiAsk.untitledChat"));
        const thread = detailToThread(detail);
        setBubbles(thread.bubbles);
        setThreads((prev) => {
          const rest = prev.filter((item) => item.id !== thread.id);
          return [thread, ...rest];
        });
      } catch {
        setError(tr("wikiAsk.historyLoadFailed"));
      }
    })();
  };

  const removeThread = (id: string) => {
    void (async () => {
      try {
        await deleteAgentConversation(id);
        setThreads((prev) => prev.filter((item) => item.id !== id));
        if (threadId !== id) {
          return;
        }
        abortRef.current?.abort();
        setSending(false);
        setPendingSkills([]);
        setError("");
        setPrompt("");
        setAttachments([]);
        setBubbles([]);
        setThreadId(null);
        saveActiveThreadId(null);
      } catch {
        setError(tr("wikiAsk.historyLoadFailed"));
      }
    })();
  };

  const beginDrag = (event: React.PointerEvent, mode: DragMode) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: frame, mode };
  };

  const onDragMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.mode === "move") {
      setFrame(clampFrame({ ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }));
      return;
    }
    setFrame(resizeFrame(drag.start, dx, dy, drag.mode));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragRef.current?.pointer === event.pointerId) {
      dragRef.current = null;
    }
  };

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
    const user = [...history].reverse().find((item) => item.role === "user" && !item.notice);
    const text = user?.content.trim() ?? "";
    const attach = user?.attachments ?? [];
    setError("");
    setSending(true);
    setReplyingId(assistantId);
    setPendingSkills([]);
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
              ? item.notice
                ? item.content
                : userContent(item.content, item.attachments, tr("wikiAsk.uploaded"), tr("wikiAsk.question"), tr("ai.attachmentsPrompt"))
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
      const lastUser = [...messages].reverse().find((item) => item.role === "user");
      const result = await aiChat(
        {
          messages: lastUser ? [lastUser] : messages.slice(-1),
          attachments: capImages(uploadedFiles),
          system: desktop ? `${t("wikiAsk.system")}\n${SKILL_SYSTEM}` : t("wikiAsk.system"),
          conversationId: threadId,
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
      const parsed = extractSkills(result.reply.trim() || tr("spotlight.emptyReply"));
      setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: parsed.text || item.content } : item)));
      if (desktop && parsed.skills.length) {
        setPendingSkills(parsed.skills);
      }
      rememberConversation(result.conversationId);
      void refreshThreads().catch(() => undefined);
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
      if (bubbles[i]?.role === "user" && !bubbles[i]?.notice) {
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

  const allowSkill = async (call: SkillCall, remember: boolean) => {
    const scope = skillScope(call.name);
    if (remember) {
      persistGrants({ ...grants, [scope]: true });
    }
    try {
      const output = await runSkill(call);
      const notice: ChatBubble = {
        id: uid(),
        role: "user",
        notice: true,
        content: tr("wikiAsk.skillResult", { skill: tr(skillLabel[scope]), result: output }),
      };
      const rest = pendingSkills.filter((item) => item !== call);
      setPendingSkills(rest);
      const assistantId = uid();
      const history = [...bubbles, notice];
      setBubbles([...history, { id: assistantId, role: "assistant", content: "" }]);
      void answer(history, assistantId, () => {
        setBubbles((prev) => prev.filter((item) => item.id !== notice.id && item.id !== assistantId));
      });
    } catch (err) {
      setError(err instanceof Error ? skillErrorMessage(err.message) : tr("wikiAsk.skillFailed"));
    }
  };

  const canSend = loggedIn && !sending && !uploading && Boolean(prompt.trim() || attachments.length);
  const box = windowBox(frame, historyOpen);

  return (
    <aside
      className="fixed z-50 flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-background shadow-[0_18px_50px_rgb(0_0_0/0.14)]"
      style={{ left: box.left, top: frame.y, width: box.width, height: frame.h }}
      onPointerMove={onDragMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <header
        className="flex shrink-0 cursor-grab items-center gap-1 border-b border-border/40 px-3 py-2 active:cursor-grabbing"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) {
            return;
          }
          beginDrag(event, "move");
        }}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{tr("wikiAsk.title")}</span>
        <Button type="button" variant={historyOpen ? "secondary" : "ghost"} size="icon" aria-label={tr("wikiAsk.history")} onClick={() => setHistoryOpen((open) => !open)}>
          <Time {...iconParkOutline} size={16} />
        </Button>
        {desktop ? (
          <Button type="button" variant={permOpen ? "secondary" : "ghost"} size="icon" aria-label={tr("wikiAsk.permissions")} onClick={() => setPermOpen((open) => !open)}>
            <SettingTwo {...iconParkOutline} size={16} />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon" aria-label={tr("wikiAsk.close")} onClick={onClose}>
          <Close {...iconParkOutline} size={16} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
      {historyOpen ? (
        <HistoryPanel
          threads={threads}
          activeId={threadId}
          onNew={startNewChat}
          onOpen={openThread}
          onDelete={removeThread}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {desktop && permOpen ? (
        <div className="shrink-0 space-y-3 border-b border-border/40 px-4 py-3 text-sm">
          <p className="text-muted-foreground text-xs">{tr("wikiAsk.permHint")}</p>
          {(["files", "open", "shell"] as SkillScope[]).map((scope) => (
            <label key={scope} className="flex items-start justify-between gap-3">
              <span>
                <span className="block font-medium">{tr(skillLabel[scope])}</span>
                <span className="text-muted-foreground mt-0.5 block text-xs">{tr(skillHint[scope])}</span>
              </span>
              <Switch
                checked={grants[scope]}
                onCheckedChange={(checked) => persistGrants({ ...grants, [scope]: checked })}
              />
            </label>
          ))}
        </div>
      ) : null}

      <SoftScrollbar ref={listRef} className="min-h-0 flex-1" contentClassName="space-y-3 px-3 py-4" stickToBottom jumpToBottomLabel={tr("common.scrollToBottom")}>
        {bubbles.length === 0 ? (
          <AssistantBubble>
            <p className="leading-5">{tr("wikiAsk.emptyHint")}</p>
          </AssistantBubble>
        ) : (
          bubbles.map((item) =>
            item.notice ? (
              <p key={item.id} className="text-muted-foreground mx-auto max-w-[90%] rounded-xl bg-muted/70 px-3 py-2 text-center font-mono text-[11px] whitespace-pre-wrap">
                {item.content}
              </p>
            ) : item.role === "assistant" ? (
              <AssistantBubble key={item.id}>
                <ChatMarkdown content={item.content || (sending && item.id === replyingId ? tr("spotlight.thinking") : "")} />
                {item.content.trim() && item.id !== replyingId ? (
                  <div className="-ml-1 mt-1 flex items-center gap-0.5">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={copiedId === item.id ? tr("wikiAsk.copied") : tr("wikiAsk.copy")} onClick={() => void copyReply(item)}>
                      <Copy {...iconParkOutline} size={14} />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-xs" disabled={sending} aria-label={tr("wikiAsk.regenerate")} onClick={() => regenerate(item.id)}>
                      <Refresh {...iconParkOutline} size={14} />
                    </Button>
                  </div>
                ) : null}
              </AssistantBubble>
            ) : (
              <div key={item.id} className="flex justify-end">
                <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm">
                  {item.content ? <p className="leading-5 whitespace-pre-wrap">{item.content}</p> : null}
                  {item.attachments?.length ? (
                    <div className={item.content ? "mt-2" : undefined}>
                      <PendingAttachments items={item.attachments} />
                    </div>
                  ) : null}
                </div>
              </div>
            ),
          )
        )}
      </SoftScrollbar>

      {desktop && pendingSkills.length ? (
        <div className="shrink-0 space-y-2 border-t border-border/40 px-4 py-3">
          {pendingSkills.map((call, index) => (
            <div key={`${call.name}-${index}`} className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{tr("wikiAsk.skillAsk", { skill: tr(skillLabel[skillScope(call.name)]) })}</p>
              <p className="text-muted-foreground mt-1 font-mono text-xs break-all">{skillPreview(call)}</p>
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setPendingSkills((prev) => prev.filter((item) => item !== call))}>
                  {tr("wikiAsk.skillDeny")}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => void allowSkill(call, false)}>
                  {tr("wikiAsk.skillOnce")}
                </Button>
                <Button type="button" size="sm" onClick={() => void allowSkill(call, true)}>
                  {tr("wikiAsk.skillAllow")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <form
        className="shrink-0 border-t border-border/30 p-3 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        {error ? <p className="text-destructive mb-2 text-xs">{error}</p> : null}
        {!loggedIn ? (
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs">{tr("wikiAsk.login")}</p>
            <Button type="button" size="sm" onClick={onLogin}>
              {tr("app.logIn")}
            </Button>
          </div>
        ) : null}
        <div className="rounded-2xl border border-border/40 bg-muted/20 px-2.5 pt-2.5 pb-2 focus-within:border-border/70">
          {attachments.length ? (
            <PendingAttachments
              items={attachments}
              onRemove={(id) => setAttachments((prev) => prev.filter((item) => item.id !== id))}
              className="pb-2"
            />
          ) : null}
          <textarea
            ref={inputRef}
            rows={2}
            value={prompt}
            disabled={!loggedIn || sending}
            enterKeyHint="send"
            placeholder={tr("wikiAsk.placeholder")}
            aria-label={tr("wikiAsk.placeholder")}
            className="max-h-36 w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none ring-0 focus:outline-none focus-visible:ring-0 sm:text-sm"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-1">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={`${AI_FILE_ACCEPT},.docx,.xlsx,.xls,.csv`}
              className="hidden"
              onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground focus-visible:border-transparent focus-visible:ring-0"
              disabled={!loggedIn || uploading}
              aria-label={tr("wikiAsk.attach")}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip {...iconParkOutline} size={16} />
            </Button>
            <Button type="submit" size="icon-sm" className="rounded-full focus-visible:ring-0" disabled={!canSend} aria-label={tr("wikiAsk.send")}>
              <Send {...iconParkOutline} size={15} />
            </Button>
          </div>
        </div>
        <p className="text-muted-foreground mt-1.5 px-1 text-[11px]">{tr("wikiAsk.hint")}</p>
      </form>
      </div>
      </div>
      <ResizeHandle corner="nw" label={tr("wikiAsk.resize")} onPointerDown={(event) => beginDrag(event, "nw")} />
      <ResizeHandle corner="ne" label={tr("wikiAsk.resize")} onPointerDown={(event) => beginDrag(event, "ne")} />
      <ResizeHandle corner="sw" label={tr("wikiAsk.resize")} onPointerDown={(event) => beginDrag(event, "sw")} />
      <ResizeHandle corner="se" label={tr("wikiAsk.resize")} onPointerDown={(event) => beginDrag(event, "se")} />
    </aside>
  );
}

const RESIZE_POS: Record<ResizeCorner, string> = {
  nw: "top-0 left-0 cursor-nwse-resize border-t-2 border-l-2",
  ne: "top-0 right-0 cursor-nesw-resize border-t-2 border-r-2",
  sw: "bottom-0 left-0 cursor-nesw-resize border-b-2 border-l-2",
  se: "bottom-0 right-0 cursor-nwse-resize border-b-2 border-r-2",
};

function ResizeHandle({
  corner,
  label,
  onPointerDown,
}: {
  corner: ResizeCorner;
  label: string;
  onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`absolute z-20 size-4 rounded-sm border-border/80 ${RESIZE_POS[corner]}`}
      onPointerDown={onPointerDown}
    />
  );
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="bg-muted/70 max-w-[85%] rounded-2xl rounded-bl-md px-3 py-2 text-sm select-text">{children}</div>
    </div>
  );
}

const skillLabel: Record<SkillScope, "wikiAsk.skillFiles" | "wikiAsk.skillOpen" | "wikiAsk.skillShell"> = {
  files: "wikiAsk.skillFiles",
  open: "wikiAsk.skillOpen",
  shell: "wikiAsk.skillShell",
};

const skillHint: Record<SkillScope, "wikiAsk.skillHintFiles" | "wikiAsk.skillHintOpen" | "wikiAsk.skillHintShell"> = {
  files: "wikiAsk.skillHintFiles",
  open: "wikiAsk.skillHintOpen",
  shell: "wikiAsk.skillHintShell",
};

function skillErrorMessage(code: string): string {
  if (code === "DESKTOP_ONLY") {
    return t("wikiAsk.skillDesktopOnly");
  }
  if (code === "COMMAND_TIMEOUT") {
    return t("wikiAsk.skillTimeout");
  }
  return t("wikiAsk.skillFailed");
}
