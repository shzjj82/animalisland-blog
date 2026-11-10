import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type WorkAction =
  | { action: "snapshot" }
  | { action: "click"; id: number }
  | { action: "type"; id: number; text: string }
  | { action: "scroll"; dir: "up" | "down" }
  | { action: "navigate"; url: string }
  | { action: "done"; summary: string };

export type WorkElement = {
  id: number;
  tag: string;
  text: string;
  href?: string;
};

export type WorkSnapshot = {
  url: string;
  title: string;
  text: string;
  items: WorkElement[];
  at: number;
};

type Session = {
  id: string;
  pairCode: string;
  token: string;
  createdAt: number;
  connected: boolean;
  browserName: string;
  snapshot: WorkSnapshot | null;
  pending: WorkAction | null;
  lastResult: string;
};

const TTL = 45 * 60 * 1000;
const sessions = new Map<string, Session>();

function purge(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > TTL) {
      sessions.delete(id);
    }
  }
}

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Work-Token");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("BODY_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        resolve(parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function pairCode(): string {
  const n = randomBytes(3).readUIntBE(0, 3) % 1_000_000;
  return String(n).padStart(6, "0");
}

function token(): string {
  return randomBytes(16).toString("hex");
}

function findByCode(code: string): Session | undefined {
  for (const session of sessions.values()) {
    if (session.pairCode === code) {
      return session;
    }
  }
  return undefined;
}

function findByToken(value: string): Session | undefined {
  for (const session of sessions.values()) {
    if (session.token === value || session.id === value) {
      return session;
    }
  }
  return undefined;
}

function tokenOf(req: IncomingMessage, body: Record<string, unknown>): string {
  const header = String(req.headers["x-work-token"] ?? "").trim();
  if (header) {
    return header;
  }
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  return String(url.searchParams.get("token") || body.token || "").trim();
}

export async function handleWorkBridge(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/work-bridge")) {
    return false;
  }
  cors(res);
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return true;
  }
  purge();
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (path === "/work-bridge/health" && req.method === "GET") {
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/work-bridge/pair" && req.method === "POST") {
      const session: Session = {
        id: token(),
        pairCode: pairCode(),
        token: token(),
        createdAt: Date.now(),
        connected: false,
        browserName: "",
        snapshot: null,
        pending: null,
        lastResult: "",
      };
      sessions.set(session.id, session);
      json(res, 200, { sessionId: session.id, token: session.token, pairCode: session.pairCode });
      return true;
    }

    const body = req.method === "GET" || req.method === "HEAD" ? {} : await readBody(req);

    if (path === "/work-bridge/connect" && req.method === "POST") {
      const code = String(body.pairCode ?? "").replace(/\D/g, "");
      const session = findByCode(code);
      if (!session) {
        json(res, 404, { error: "PAIR_NOT_FOUND" });
        return true;
      }
      session.connected = true;
      session.browserName = String(body.browserName ?? "").slice(0, 80);
      json(res, 200, { sessionId: session.id, token: session.token });
      return true;
    }

    const key = tokenOf(req, body);
    const session = findByToken(key);
    if (!session) {
      json(res, 404, { error: "SESSION_NOT_FOUND" });
      return true;
    }

    if (path === "/work-bridge/session" && req.method === "GET") {
      json(res, 200, {
        connected: session.connected,
        browserName: session.browserName,
        pairCode: session.pairCode,
        snapshot: session.snapshot,
        pending: session.pending,
        lastResult: session.lastResult,
      });
      return true;
    }

    if (path === "/work-bridge/snapshot" && req.method === "POST") {
      const snap = body.snapshot as WorkSnapshot | undefined;
      if (snap && typeof snap.url === "string") {
        session.snapshot = {
          url: snap.url.slice(0, 2000),
          title: String(snap.title ?? "").slice(0, 300),
          text: String(snap.text ?? "").slice(0, 6000),
          items: Array.isArray(snap.items) ? snap.items.slice(0, 80) : [],
          at: Date.now(),
        };
      }
      json(res, 200, { ok: true, pending: session.pending });
      return true;
    }

    if (path === "/work-bridge/action" && req.method === "POST") {
      session.pending = (body.action as WorkAction) ?? null;
      session.lastResult = "";
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/work-bridge/result" && req.method === "POST") {
      session.lastResult = String(body.result ?? "").slice(0, 4000);
      session.pending = null;
      json(res, 200, { ok: true });
      return true;
    }

    if (path === "/work-bridge/session" && req.method === "DELETE") {
      sessions.delete(session.id);
      json(res, 200, { ok: true });
      return true;
    }

    json(res, 404, { error: "NOT_FOUND" });
    return true;
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : "WORK_BRIDGE" });
    return true;
  }
}
