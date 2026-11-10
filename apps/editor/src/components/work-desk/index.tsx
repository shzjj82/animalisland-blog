import { useEffect, useRef, useState } from "react";
import { Close, Laptop, Send } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { SoftScrollbar } from "@/components/soft-scrollbar";
import { ChatMarkdown } from "@/components/editor-spotlight/ChatMarkdown";
import { isDesktopApp } from "@/lib/ai/skills";
import { aiChat } from "@/lib/ai/client";
import { aiErrorMessage, uid, type ChatBubble } from "@/lib/ai/chat";
import {
  createWorkPair,
  extractWorkAction,
  formatSnapshot,
  needsWorkConfirm,
  postWorkAction,
  previewWorkAction,
  readWorkSession,
  workBridgeOrigin,
  WORK_SYSTEM,
  type WorkAction,
  type WorkPair,
  type WorkSessionState,
} from "@/lib/work/bridge";
import { listInstalledBrowsers, openInstalledBrowser, revealWorkExtension, type InstalledBrowser } from "@/lib/work/browsers";
import { iconParkOutline } from "@/lib/iconPark";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  focusToken: number;
  loggedIn: boolean;
  onClose: () => void;
  onLogin: () => void;
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

export function WorkDesk({ open, focusToken, loggedIn, onClose, onLogin }: Props) {
  const { t } = useTranslation();
  const desktop = isDesktopApp();
  const [frame, setFrame] = useState<Frame>(() => (typeof window === "undefined" ? { x: 24, y: 24, w: 420, h: 640 } : loadFrame()));
  const [browsers, setBrowsers] = useState<InstalledBrowser[]>([]);
  const [picked, setPicked] = useState("");
  const [pair, setPair] = useState<WorkPair | null>(null);
  const [remote, setRemote] = useState<WorkSessionState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<WorkAction | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dragRef = useRef<{ pointer: number; x: number; y: number; start: Frame } | null>(null);
  const pairRef = useRef<WorkPair | null>(null);
  pairRef.current = pair;

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
    void (async () => {
      const list = await listInstalledBrowsers();
      setBrowsers(list);
      const first = list.find((item) => item.supported);
      if (first) {
        setPicked(first.id);
      }
      try {
        const next = await createWorkPair();
        setPair(next);
      } catch {
        setError(t("work.bridgeFailed"));
      }
    })();
  }, [open, t]);

  useEffect(() => {
    if (!open || !pair) {
      return;
    }
    const tick = () => {
      const current = pairRef.current;
      if (!current) {
        return;
      }
      void readWorkSession(current.token)
        .then(setRemote)
        .catch(() => undefined);
    };
    tick();
    const timer = window.setInterval(tick, 1200);
    return () => window.clearInterval(timer);
  }, [open, pair]);

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

  const connected = Boolean(remote?.connected);
  const snapshot = remote?.snapshot ?? null;

  const runTurn = async (history: ChatBubble[], assistantId: string) => {
    if (!loggedIn) {
      setError(t("work.login"));
      return;
    }
    setSending(true);
    setError("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const page = formatSnapshot(snapshot);
      const result = await aiChat(
        {
          messages: [
            {
              role: "user",
              content: `${t("work.pageContext")}\n${page}\n\n${history
                .filter((item) => !item.notice)
                .map((item) => `${item.role === "user" ? "用户" : "工作助手"}: ${item.content}`)
                .join("\n\n")}`,
            },
          ],
          system: WORK_SYSTEM,
          rag: false,
        },
        controller.signal,
        {
          onDelta: (delta) => {
            setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: item.content + delta } : item)));
          },
        },
      );
      const parsed = extractWorkAction(result.reply.trim() || t("spotlight.emptyReply"));
      setBubbles((prev) => prev.map((item) => (item.id === assistantId ? { ...item, content: parsed.text || item.content } : item)));
      if (parsed.action && parsed.action.action !== "done") {
        if (needsWorkConfirm(parsed.action)) {
          setPending(parsed.action);
        } else if (pair) {
          await postWorkAction(pair.token, parsed.action);
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(aiErrorMessage(err instanceof Error ? err.message : t("spotlight.failedToSend")));
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
    const user: ChatBubble = { id: uid(), role: "user", content: text };
    const assistantId = uid();
    const history = [...bubbles, user];
    setBubbles([...history, { id: assistantId, role: "assistant", content: "" }]);
    setPrompt("");
    void runTurn(history, assistantId);
  };

  const allowAction = async () => {
    if (!pending || !pair) {
      return;
    }
    const action = pending;
    setPending(null);
    await postWorkAction(pair.token, action);
    const notice: ChatBubble = { id: uid(), role: "user", notice: true, content: previewWorkAction(action) };
    const assistantId = uid();
    const history = [...bubbles, notice];
    setBubbles([...history, { id: assistantId, role: "assistant", content: "" }]);
    window.setTimeout(() => {
      void runTurn(history, assistantId);
    }, 900);
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
        <div className="shrink-0 space-y-2 border-b border-border/40 px-3 py-2 text-xs">
          {desktop && browsers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {browsers.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  size="sm"
                  variant={picked === item.id ? "secondary" : "ghost"}
                  disabled={!item.supported}
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setPicked(item.id);
                    void openInstalledBrowser(item.id).catch(() => setError(t("work.openFailed")));
                  }}
                >
                  {item.name}
                  {item.supported ? "" : ` · ${t("work.unsupported")}`}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground">{desktop ? t("work.noBrowser") : t("work.webHint")}</p>
          )}
          <div className="flex items-center justify-between gap-2">
            <p className="text-muted-foreground">
              {connected ? t("work.connected", { browser: remote?.browserName || t("work.helper") }) : t("work.pairHint", { code: pair?.pairCode ?? "------" })}
            </p>
            {desktop ? (
              <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => void revealWorkExtension().catch(() => setError(t("work.extensionMissing")))}>
                {t("work.openExtension")}
              </Button>
            ) : (
              <a className="text-foreground underline-offset-2 hover:underline" href="/work-extension/install.html" target="_blank" rel="noreferrer">
                {t("work.openExtension")}
              </a>
            )}
          </div>
          <p className="text-muted-foreground break-all">{t("work.bridgeUrl")}: {workBridgeOrigin()}</p>
          {snapshot ? (
            <p className="flex items-center gap-1 truncate text-foreground">
              <Laptop {...iconParkOutline} size={13} />
              {snapshot.title || snapshot.url}
            </p>
          ) : (
            <p className="text-muted-foreground">{t("work.waitingPage")}</p>
          )}
        </div>

        <SoftScrollbar className="min-h-0 flex-1" contentClassName="space-y-3 px-3 py-4" stickToBottom jumpToBottomLabel={t("common.scrollToBottom")}>
          {bubbles.length === 0 ? (
            <p className="text-muted-foreground text-sm leading-6">{t("work.emptyHint")}</p>
          ) : (
            bubbles.map((item) =>
              item.notice ? (
                <p key={item.id} className="text-muted-foreground mx-auto max-w-[90%] rounded-xl bg-muted/70 px-3 py-2 text-center font-mono text-[11px]">
                  {item.content}
                </p>
              ) : item.role === "assistant" ? (
                <div key={item.id} className="bg-muted/70 max-w-[92%] rounded-2xl rounded-bl-md px-3 py-2 text-sm">
                  <ChatMarkdown content={item.content || (sending ? t("spotlight.thinking") : "")} />
                </div>
              ) : (
                <div key={item.id} className="flex justify-end">
                  <div className="bg-primary text-primary-foreground max-w-[85%] rounded-2xl rounded-br-md px-3 py-2 text-sm whitespace-pre-wrap">{item.content}</div>
                </div>
              ),
            )
          )}
        </SoftScrollbar>

        {pending ? (
          <div className="shrink-0 space-y-2 border-t border-border/40 px-3 py-2">
            <p className="text-sm font-medium">{t("work.confirmAction")}</p>
            <p className="text-muted-foreground font-mono text-xs break-all">{previewWorkAction(pending)}</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPending(null)}>
                {t("work.deny")}
              </Button>
              <Button type="button" size="sm" onClick={() => void allowAction()}>
                {t("work.allow")}
              </Button>
            </div>
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
              disabled={!loggedIn || sending}
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
              <Button type="submit" size="icon-sm" className="rounded-full" disabled={!loggedIn || sending || !prompt.trim()} aria-label={t("work.send")}>
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
