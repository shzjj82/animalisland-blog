import { useEffect, useRef, useState } from "react";
import { Close, Send } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { ChatMarkdown } from "@/components/editor-spotlight/ChatMarkdown";
import type { AiAttachment } from "@myblog/shared";
import { aiChat } from "@/lib/ai/client";
import { aiErrorMessage, uid, type ChatBubble } from "@/lib/ai/chat";
import { extractSkills, skillPreview } from "@/lib/ai/skills";
import { captureLook, observeSkill, skillKey } from "@/lib/work/observe";
import { extractDeliverable, takeLooks, takeQuestions, WORK_SYSTEM } from "@/lib/work/task";
import { iconParkOutline } from "@/lib/iconPark";
import { useTranslation } from "react-i18next";

type WorkBubble = ChatBubble & { result?: { id: string; title: string }; shot?: string };

type Props = {
  open: boolean;
  focusToken: number;
  loggedIn: boolean;
  onClose: () => void;
  onLogin: () => void;
  onDeliver: (markdown: string) => Promise<{ id: string; title: string }>;
  onOpenResult: (id: string) => void;
};

const FRAME_KEY = "editor:work-desk-frame";
const MIN_W = 380;
const MIN_H = 520;

type Frame = { x: number; y: number; w: number; h: number };

function defaultFrame(): Frame {
  const w = Math.min(440, Math.max(MIN_W, window.innerWidth - 32));
  const h = Math.min(680, Math.max(MIN_H, window.innerHeight - 40));
  return { w, h, x: Math.max(16, window.innerWidth - w - 24), y: Math.max(16, window.innerHeight - h - 24) };
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

function loadFrame(): Frame {
  try {
    const raw = localStorage.getItem(FRAME_KEY);
    if (!raw) {
      return defaultFrame();
    }
    const parsed = JSON.parse(raw) as Partial<Frame>;
    return clampFrame({
      x: Number(parsed.x) || defaultFrame().x,
      y: Number(parsed.y) || defaultFrame().y,
      w: Number(parsed.w) || defaultFrame().w,
      h: Number(parsed.h) || defaultFrame().h,
    });
  } catch {
    return defaultFrame();
  }
}

export function WorkDesk({ open, focusToken, loggedIn, onClose, onLogin, onDeliver, onOpenResult }: Props) {
  const { t } = useTranslation();
  const [frame, setFrame] = useState<Frame>(() => (typeof window === "undefined" ? { x: 24, y: 24, w: 420, h: 640 } : loadFrame()));
  const [prompt, setPrompt] = useState("");
  const [bubbles, setBubbles] = useState<WorkBubble[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ pointer: number; x: number; y: number; start: Frame } | null>(null);

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
    localStorage.setItem(FRAME_KEY, JSON.stringify(frame));
  }, [frame, open]);

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

  const beginMove = (event: React.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) {
      return;
    }
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragRef.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, start: frame };
  };

  const onMove = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || drag.pointer !== event.pointerId) {
      return;
    }
    setFrame(clampFrame({ ...drag.start, x: drag.start.x + event.clientX - drag.x, y: drag.start.y + event.clientY - drag.y }));
  };

  const showTurn = (assistantId: string, content: string, notes: WorkBubble[], saved: { id: string; title: string } | null) => {
    setBubbles((prev) => [
      ...prev.map((item) =>
        item.id === assistantId ? { ...item, content: content || item.content, result: saved ?? item.result } : item,
      ),
      ...notes,
    ]);
  };

  const runTurn = async (history: WorkBubble[], assistantId: string) => {
    if (!loggedIn) {
      setError(t("work.login"));
      return;
    }
    setSending(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    let thread = history;
    let saved: { id: string; title: string } | null = null;
    const seen = new Map<string, string>();
    let pendingShot: { url: string; expect: string } | null = null;
    try {
      for (let step = 0; step < 6; step += 1) {
        const shot = pendingShot;
        pendingShot = null;
        let streamed = "";
        const transcript = thread
          .filter((item) => !item.result)
          .map((item) => `${item.role === "user" ? "用户" : "工作助手"}: ${item.content}`)
          .join("\n\n");
        const result = await aiChat(
          {
            messages: [
              {
                role: "user",
                content: shot
                  ? `${transcript}\n\n这是刚截的一张画面。预期：${shot.expect}\n对照图片判断是否符合预期。符合就做下一步；需要登录或要人操作就只输出 ask 并停下；不符合就说明差在哪。不要为这次核对再截一张。`
                  : transcript,
              },
            ],
            attachments: shot ? [{ kind: "image", name: "screen.jpg", url: shot.url } satisfies AiAttachment] : undefined,
            system: WORK_SYSTEM,
            rag: false,
          },
          controller.signal,
          {
            onDelta: (delta) => {
              streamed += delta;
              const visible = streamed
                .replace(/```skill[\s\S]*?(```|$)/gi, "")
                .replace(/```deliver[\s\S]*?(```|$)/gi, "")
                .trim();
              if (visible) {
                setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: visible } : item)));
              }
            },
          },
        );
        const asked = takeQuestions(result.reply.trim() || "");
        if (asked.questions.length) {
          const text = extractDeliverable(extractSkills(asked.reply).text).text;
          showTurn(assistantId, [text, ...asked.questions].filter(Boolean).join("\n\n"), [], saved);
          break;
        }
        const looked = takeLooks(asked.reply);
        const skilled = extractSkills(looked.reply);
        const parsed = extractDeliverable(skilled.text);
        if (parsed.markdown && !saved) {
          saved = await onDeliver(parsed.markdown);
        }
        const notes: WorkBubble[] = [];
        for (const call of skilled.skills) {
          const key = skillKey(call);
          if (seen.has(key)) {
            continue;
          }
          const observation = await observeSkill(call);
          seen.set(key, observation.detail);
          if (!observation.ok) {
            setError(t("work.computerFailed"));
          }
          notes.push({
            id: uid(),
            role: "user",
            notice: true,
            content: `${skillPreview(call)}\n${observation.detail}`,
          });
        }
        if (looked.expects.length) {
          const expect = looked.expects.join("；");
          try {
            const url = await captureLook();
            pendingShot = { url, expect };
            notes.push({
              id: uid(),
              role: "user",
              notice: true,
              shot: url,
              content: t("work.lookCheck", { expect }),
            });
          } catch {
            showTurn(assistantId, [parsed.text, t("work.needScreen")].filter(Boolean).join("\n\n"), notes, saved);
            break;
          }
        }
        const content = parsed.text || (saved ? t("work.resultReady") : "");
        showTurn(assistantId, content, notes, saved);
        if (!notes.length) {
          break;
        }
        thread = [...thread, { id: assistantId, role: "assistant", content: content || t("work.lookCheck", { expect: looked.expects.join("；") }) }, ...notes];
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(aiErrorMessage(err instanceof Error ? err.message : t("work.computerFailed")));
      }
    } finally {
      if (!controller.signal.aborted) {
        setSending(false);
      }
    }
  };

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) {
      return;
    }
    if (!loggedIn) {
      setError(t("work.login"));
      return;
    }
    const user: WorkBubble = { id: uid(), role: "user", content: text };
    const assistantId = uid();
    const history = [...bubbles, user];
    setBubbles([...history, { id: assistantId, role: "assistant", content: "" }]);
    setPrompt("");
    void runTurn(history, assistantId);
  };

  return (
    <aside
      className="fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-border/50 bg-background shadow-[0_18px_50px_rgb(0_0_0/0.14)]"
      style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
      onPointerMove={onMove}
      onPointerUp={() => {
        dragRef.current = null;
      }}
    >
      <header
        className="flex shrink-0 cursor-grab items-center gap-1 border-b border-border/40 px-3 py-2 active:cursor-grabbing"
        onPointerDown={beginMove}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{t("work.title")}</span>
        <Button type="button" variant="ghost" size="icon" aria-label={t("work.close")} onClick={onClose}>
          <Close {...iconParkOutline} size={16} />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <SoftScrollbar className="min-h-0 flex-1" contentClassName="space-y-3 px-3 py-4" stickToBottom jumpToBottomLabel={t("common.scrollToBottom")}>
          {bubbles.length === 0 ? (
            <p className="text-muted-foreground text-sm leading-6">{t("work.emptyHint")}</p>
          ) : (
            bubbles.map((item) =>
              item.notice ? (
                <div key={item.id} className="text-muted-foreground mx-auto max-w-[92%] rounded-xl bg-muted/70 px-3 py-2 text-left text-xs leading-5 whitespace-pre-wrap">
                  {item.content}
                  {item.shot ? <img src={item.shot} alt="" className="mt-2 max-h-44 w-full rounded-lg object-contain" /> : null}
                </div>
              ) : item.role === "assistant" ? (
                <div key={item.id} className="bg-muted/70 max-w-[92%] space-y-2 rounded-2xl rounded-bl-md px-3 py-2 text-sm">
                  <ChatMarkdown content={item.content || (sending ? t("spotlight.thinking") : "")} />
                  {item.result ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => onOpenResult(item.result!.id)}>
                      {t("work.openResult", { title: item.result.title })}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <div key={item.id} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap">{item.content}</div>
                </div>
              ),
            )
          )}
        </SoftScrollbar>

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
              <p className="text-muted-foreground text-xs">{t("work.login")}</p>
              <Button type="button" size="sm" onClick={onLogin}>
                {t("app.logIn")}
              </Button>
            </div>
          ) : null}
          <div className="rounded-2xl border border-border/40 bg-muted/20 px-2.5 pt-2.5 pb-2">
            <textarea
              ref={inputRef}
              rows={2}
              value={prompt}
              disabled={sending}
              placeholder={t("work.placeholder")}
              aria-label={t("work.placeholder")}
              className="max-h-36 w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none ring-0 sm:text-sm"
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex justify-end px-1">
              <Button type="submit" size="icon-sm" className="rounded-full" disabled={sending || !prompt.trim()} aria-label={t("work.send")}>
                <Send {...iconParkOutline} size={15} />
              </Button>
            </div>
          </div>
          <p className="text-muted-foreground mt-1.5 px-1 text-[11px]">{t("work.hint")}</p>
        </form>
      </div>
    </aside>
  );
}
