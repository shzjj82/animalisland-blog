import { GATEWAY_BASE_URL, prepareSession, type RemoteSession } from "@/store/remoteStore";

export type NotifySocketEvent =
  | { type: "ready"; bizCode: string; userId: string }
  | { type: "error"; message: string }
  | {
      type: "event";
      kind: "todo" | "notice";
      action: "created" | "updated" | "read-all";
      item?: unknown;
    };

type Listener = (event: NotifySocketEvent) => void;

const DEFAULT_PUBLIC_GATEWAY = "https://api.championsea.online";

function socketHttpBase(): string {
  if (GATEWAY_BASE_URL) return GATEWAY_BASE_URL;
  // 开发走同源 Vite 代理；线上浏览器空基址时直连公网网关（WebSocket 不吃 CORS）
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return window.location.origin;
  }
  return DEFAULT_PUBLIC_GATEWAY;
}

export function buildNotifySocketUrl(token: string): string {
  const url = new URL("/wiki/notifications/socket", socketHttpBase());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}

function asSocketEvent(raw: unknown): NotifySocketEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type : "";
  if (type === "ready") {
    return {
      type: "ready",
      bizCode: typeof row.bizCode === "string" ? row.bizCode : "",
      userId: typeof row.userId === "string" ? row.userId : "",
    };
  }
  if (type === "error") {
    return { type: "error", message: typeof row.message === "string" ? row.message : "socket error" };
  }
  if (type === "event") {
    const kind = row.kind === "todo" || row.kind === "notice" ? row.kind : null;
    const action =
      row.action === "created" || row.action === "updated" || row.action === "read-all" ? row.action : null;
    if (!kind || !action) return null;
    return { type: "event", kind, action, item: row.item };
  }
  return null;
}

/** 登录后订阅 /wiki/notifications/socket；断线自动重连 */
export function connectNotifySocket(
  session: RemoteSession,
  onEvent: Listener,
): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let retry = 0;
  let timer = 0;
  let pingTimer = 0;

  const clearTimers = () => {
    if (timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
    if (pingTimer) {
      window.clearInterval(pingTimer);
      pingTimer = 0;
    }
  };

  const schedule = () => {
    if (closed) return;
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(retry, 4));
    timer = window.setTimeout(() => {
      void open();
    }, wait);
  };

  const open = async () => {
    if (closed) return;
    clearTimers();
    try {
      const ready = await prepareSession(session);
      if (!ready?.token || closed) {
        schedule();
        return;
      }
      const url = buildNotifySocketUrl(ready.token);
      socket = new WebSocket(url);
      socket.addEventListener("open", () => {
        retry = 0;
        // 浏览器 WebSocket 无应用层 ping；服务端会 ping，这里只保活重连节奏
        pingTimer = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) {
            try {
              socket.send(JSON.stringify({ type: "ping" }));
            } catch {
              // ignore
            }
          }
        }, 25_000);
      });
      socket.addEventListener("message", (ev) => {
        try {
          const parsed = asSocketEvent(JSON.parse(String(ev.data)));
          if (parsed) onEvent(parsed);
        } catch {
          // ignore malformed
        }
      });
      socket.addEventListener("close", () => {
        clearTimers();
        socket = null;
        if (!closed) {
          retry += 1;
          schedule();
        }
      });
      socket.addEventListener("error", () => {
        try {
          socket?.close();
        } catch {
          // ignore
        }
      });
    } catch {
      retry += 1;
      schedule();
    }
  };

  void open();

  return () => {
    closed = true;
    clearTimers();
    try {
      socket?.close();
    } catch {
      // ignore
    }
    socket = null;
  };
}
