export type WorkAction =
  | { action: "snapshot" }
  | { action: "click"; id: number }
  | { action: "type"; id: number; text: string }
  | { action: "scroll"; dir: "up" | "down" }
  | { action: "navigate"; url: string }
  | { action: "done"; summary: string };

export type WorkSnapshot = {
  url: string;
  title: string;
  text: string;
  items: { id: number; tag: string; text: string; href?: string }[];
  at: number;
};

export type WorkSessionState = {
  connected: boolean;
  browserName: string;
  pairCode: string;
  snapshot: WorkSnapshot | null;
  pending: WorkAction | null;
  lastResult: string;
};

export type WorkPair = {
  sessionId: string;
  token: string;
  pairCode: string;
};

const TOKEN_KEY = "editor:work-token";

export function workBridgeOrigin(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.location.origin;
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${workBridgeOrigin()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body && typeof body === "object" && "error" in body ? String(body.error) : "WORK_BRIDGE");
  }
  return body;
}

export async function createWorkPair(): Promise<WorkPair> {
  const pair = await send<WorkPair>("/work-bridge/pair", { method: "POST", body: "{}" });
  sessionStorage.setItem(TOKEN_KEY, pair.token);
  return pair;
}

export function workHeaders(token: string): HeadersInit {
  return { "X-Work-Token": token };
}

export function readWorkSession(token: string): Promise<WorkSessionState> {
  return send<WorkSessionState>(`/work-bridge/session?token=${encodeURIComponent(token)}`);
}

export function postWorkAction(token: string, action: WorkAction): Promise<void> {
  return send("/work-bridge/action", {
    method: "POST",
    headers: workHeaders(token),
    body: JSON.stringify({ token, action }),
  }).then(() => undefined);
}

export function formatSnapshot(snapshot: WorkSnapshot | null): string {
  if (!snapshot) {
    return "（浏览器尚未同步当前页面）";
  }
  const items = snapshot.items
    .map((item) => `[${item.id}] <${item.tag}> ${item.text}${item.href ? ` ${item.href}` : ""}`)
    .join("\n");
  return `URL: ${snapshot.url}\n标题: ${snapshot.title}\n可见元素:\n${items || "（无）"}\n正文摘录:\n${snapshot.text}`;
}

export const WORK_SYSTEM = `你是 wiki-agent 的「工作」助手，在用户选定的本机浏览器里完成网页任务，不是知识库闲聊。
每次只输出一个 work 代码块，正文只用一句人话说明正在做什么，不要把 JSON 写进正文：
\`\`\`work
{"action":"navigate","url":"https://www.baidu.com"}
\`\`\`
action 只能是 snapshot（再看一眼页面）、click（点击编号）、type（向编号输入 text）、scroll（up 或 down）、navigate（在本机浏览器打开 url）、done（任务结束，带 summary）。
用户要打开网站、而当前没有页面时，直接 navigate，不要先 snapshot。
已经能看到页面元素时，再按编号 click 或 type。不要编造编号。登录、支付、提交表单前在正文里说明风险。用户没要求操作网页时用 done。`;

function readWorkAction(body: string): WorkAction | null {
  try {
    const parsed = JSON.parse(body.trim()) as WorkAction;
    if (parsed && typeof parsed === "object" && typeof parsed.action === "string") {
      return parsed;
    }
  } catch {
    // 不是动作 JSON
  }
  return null;
}

export function extractWorkAction(reply: string): { text: string; action: WorkAction | null } {
  let action: WorkAction | null = null;
  let text = reply.replace(/```(?:work|json)?\s*([\s\S]*?)```/gi, (all, body: string) => {
    const parsed = readWorkAction(String(body));
    if (!parsed) {
      return all;
    }
    if (!action) {
      action = parsed;
    }
    return "";
  });
  if (!action) {
    text = text.replace(/\{[^{}]*"action"\s*:\s*"[^"]+"[^{}]*\}/g, (blob) => {
      const parsed = readWorkAction(blob);
      if (parsed && !action) {
        action = parsed;
        return "";
      }
      return blob;
    });
  }
  return { text: text.trim(), action };
}

export function previewWorkAction(action: WorkAction): string {
  if (action.action === "click") {
    return `click #${action.id}`;
  }
  if (action.action === "type") {
    return `type #${action.id} ${action.text}`;
  }
  if (action.action === "scroll") {
    return `scroll ${action.dir}`;
  }
  if (action.action === "navigate") {
    return `open ${action.url}`;
  }
  if (action.action === "done") {
    return action.summary;
  }
  return "snapshot";
}

export function needsWorkConfirm(action: WorkAction): boolean {
  return action.action === "click" || action.action === "type";
}
