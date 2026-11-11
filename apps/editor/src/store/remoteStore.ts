import type { EditorJsDocument } from "@myblog/shared";
import { starterArticleDocument } from "@myblog/shared";
import { titleFromBody, type EditorPage, type PageNode } from "./localStore";
import { t } from "@/i18n";

type Envelope<T> = {
  success?: boolean;
  message?: string;
  data?: T;
};

export type RemoteSession = {
  baseUrl: string;
  token: string;
  username: string;
  /** 登录用户的账号 id。权限和作者判断用它，不用 user.id */
  accountId?: string;
  refreshToken?: string;
  /** access token 到期时间（毫秒时间戳） */
  expiresAt?: number;
};

/**
 * 浏览器侧网关基址：默认空串＝同源（由 Vite / 桌面服务代理到 Nest，避免 CORS）。
 * 仅当显式设置 VITE_GATEWAY_PUBLIC_BASE 时才直连。
 */
export const GATEWAY_BASE_URL = (
  (import.meta.env.VITE_GATEWAY_BASE_URL as string | undefined) || ""
).replace(/\/$/, "");

/**
 * Editor 只走 /wiki/*。网关会给这些路由注入 bizCode=wiki，前端不必再带 X-Biz-Code。
 * 文档上的 appCode 仍用来丢掉不属于 wiki 的行。
 */
export const WIKI_APP_CODE = "wiki";

const SESSION_KEY = "editor:remote-session";
const EXPIRY_SKEW_MS = 60_000;

type SessionListener = (session: RemoteSession | null) => void;
const sessionListeners = new Set<SessionListener>();

export function subscribeSession(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

function emitSession(session: RemoteSession | null): void {
  for (const listener of sessionListeners) {
    listener(session);
  }
}

function wikiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    "X-App-Code": WIKI_APP_CODE,
    ...extra,
  };
}

/** 拼网关路径；基址为空时走当前源（/auth、/wiki…） */
export function gatewayUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!GATEWAY_BASE_URL) {
    return normalized;
  }
  return `${GATEWAY_BASE_URL}${normalized}`;
}

function readRawSession(): RemoteSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY) ?? sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as RemoteSession;
    if (!parsed.token && !parsed.refreshToken) {
      return null;
    }
    if (!localStorage.getItem(SESSION_KEY)) {
      localStorage.setItem(SESSION_KEY, raw);
      sessionStorage.removeItem(SESSION_KEY);
    }
    return { ...parsed, baseUrl: GATEWAY_BASE_URL };
  } catch {
    return null;
  }
}

export function loadSession(): RemoteSession | null {
  return readRawSession();
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  emitSession(null);
}

function saveSession(session: RemoteSession): void {
  const stored: RemoteSession = {
    baseUrl: GATEWAY_BASE_URL,
    token: session.token,
    username: session.username,
    accountId: session.accountId,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(stored));
  sessionStorage.removeItem(SESSION_KEY);
}

function accessStillValid(session: RemoteSession): boolean {
  if (!session.token) {
    return false;
  }
  if (!session.expiresAt) {
    return true;
  }
  return session.expiresAt - EXPIRY_SKEW_MS > Date.now();
}

type AuthPayload = {
  token?: string;
  refreshToken?: string;
  expiresIn?: number;
  user?: { username?: string; accountId?: string; id?: string };
};

function sessionFromAuth(data: AuthPayload, fallbackUsername: string, previousAccountId?: string): RemoteSession {
  const token = data.token?.trim() ?? "";
  if (!token) {
    throw new Error(t("common.loginFailed"));
  }
  const expiresIn = Number(data.expiresIn);
  const accountId = data.user?.accountId?.trim() || previousAccountId;
  return {
    baseUrl: GATEWAY_BASE_URL,
    token,
    username: data.user?.username || fallbackUsername,
    accountId: accountId || undefined,
    refreshToken: data.refreshToken?.trim() || undefined,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : undefined,
  };
}

let refreshInflight: Promise<RemoteSession | null> | null = null;

/** 用 refresh_token 换新的 access token；失败则清掉登录态 */
export function refreshSession(): Promise<RemoteSession | null> {
  if (refreshInflight) {
    return refreshInflight;
  }
  refreshInflight = (async () => {
    const current = readRawSession();
    if (!current?.refreshToken) {
      return current?.token ? current : null;
    }
    const response = await fetch(gatewayUrl("/wiki/auth/refresh"), {
      method: "POST",
      headers: wikiHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ refreshToken: current.refreshToken }),
    });
    const json = (await response.json().catch(() => null)) as Envelope<AuthPayload> | null;
    if (!response.ok || !json?.success || !json.data?.token) {
      clearSession();
      return null;
    }
    const next = sessionFromAuth(json.data, current.username, current.accountId);
    if (!next.refreshToken) {
      next.refreshToken = current.refreshToken;
    }
    saveSession(next);
    return next;
  })().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

/** 保证 session 上的 access token 还有效；过期则用 refresh_token 轮换并写回同一对象 */
export async function prepareSession(session: RemoteSession): Promise<RemoteSession | null> {
  if (accessStillValid(session)) {
    return session;
  }
  const next = await refreshSession();
  if (!next) {
    return null;
  }
  session.token = next.token;
  session.refreshToken = next.refreshToken;
  session.expiresAt = next.expiresAt;
  return session;
}

export async function request<T>(
  session: RemoteSession,
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const ready = await prepareSession(session);
  if (!ready?.token) {
    throw new Error("UNAUTHORIZED");
  }
  const url = new URL(gatewayUrl(path), typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
  const response = await fetch(url, {
    method,
    headers: wikiHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${ready.token}`,
    }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401 && !retried && ready.refreshToken) {
    ready.expiresAt = 0;
    const next = await refreshSession();
    if (next) {
      ready.token = next.token;
      ready.refreshToken = next.refreshToken;
      ready.expiresAt = next.expiresAt;
      return request(ready, method, path, body, true);
    }
  }
  const json = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!json?.success) {
    throw new Error(json?.message || t("common.requestFailed", { status: response.status }));
  }
  return json.data as T;
}

async function authRemote(
  path: "/wiki/auth/login" | "/wiki/auth/register",
  body: { username: string; password: string; nickname?: string },
  fallback: string,
): Promise<RemoteSession> {
  const response = await fetch(gatewayUrl(path), {
    method: "POST",
    headers: wikiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as Envelope<AuthPayload> | null;
  if (!json?.success || !json.data?.token) {
    throw new Error(json?.message || fallback);
  }
  const session = sessionFromAuth(json.data, body.username);
  saveSession(session);
  return session;
}

/** 退出时通知网关作废 refresh_token，本地登录态总会清掉 */
export async function logoutRemote(session: RemoteSession | null): Promise<void> {
  const refreshToken = session?.refreshToken;
  const token = session?.token;
  clearSession();
  if (!refreshToken && !token) {
    return;
  }
  try {
    await fetch(gatewayUrl("/wiki/auth/logout"), {
      method: "POST",
      headers: wikiHeaders({
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      }),
      body: JSON.stringify({
        ...(refreshToken ? { refreshToken } : {}),
      }),
    });
  } catch {
    // 本地已退出
  }
}

export function loginRemote(username: string, password: string): Promise<RemoteSession> {
  return authRemote("/wiki/auth/login", { username, password }, t("common.loginFailed"));
}

export function registerRemote(username: string, password: string, nickname?: string): Promise<RemoteSession> {
  return authRemote("/wiki/auth/register", { username, password, nickname }, t("common.signUpFailed"));
}

/** POST /wiki/auth/change-password，body 为 { oldPassword, newPassword } */
export async function changePasswordRemote(session: RemoteSession, oldPassword: string, newPassword: string): Promise<void> {
  const ready = await prepareSession(session);
  if (!ready?.token) {
    throw new Error("UNAUTHORIZED");
  }
  const response = await fetch(gatewayUrl("/wiki/auth/change-password"), {
    method: "POST",
    headers: wikiHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${ready.token}`,
    }),
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  const json = (await response.json().catch(() => null)) as Envelope<unknown> | null;
  if (!json?.success) {
    throw new Error(json?.message || (response.status === 404 ? t("store.changePasswordUnsupported") : t("common.failedToChangePassword")));
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toNode(raw: unknown): PageNode | null {
  const row = asRecord(raw);
  const code = row.appCode ?? row.app_code;
  if (typeof code === "string" && code !== WIKI_APP_CODE) {
    return null;
  }
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) {
    return null;
  }
  const parent = row.parentId;
  const rawTeam = row.teamId ?? row.team_id;
  return {
    id,
    title: typeof row.title === "string" && row.title.trim() ? row.title : t("common.untitled"),
    parentId: typeof parent === "string" ? parent : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
    teamId: typeof rawTeam === "string" && rawTeam ? rawTeam : null,
  };
}

function toPage(raw: unknown): EditorPage | null {
  const node = toNode(raw);
  if (!node) {
    return null;
  }
  const row = asRecord(raw);
  const body = row.body;
  const document =
    body && typeof body === "object" && Array.isArray((body as EditorJsDocument).blocks)
      ? (body as EditorJsDocument)
      : starterArticleDocument();
  return { ...node, body: document };
}

const WIKI_DOCUMENTS = "/wiki/documents";

export async function listRemote(session: RemoteSession): Promise<PageNode[]> {
  const data = await request<{ posts?: unknown[]; documents?: unknown[] }>(
    session,
    "GET",
    `${WIKI_DOCUMENTS}?scope=mine&tree=1`,
  );
  const rows = data.posts ?? data.documents ?? [];
  return rows.map(toNode).filter((item): item is PageNode => item !== null);
}

/** 远程文档里记着的本地 uuid，用来防止同一页被新建两次 */
export async function listRemoteClientIds(session: RemoteSession): Promise<Map<string, string>> {
  const data = await request<{ posts?: unknown[]; documents?: unknown[] }>(
    session,
    "GET",
    `${WIKI_DOCUMENTS}?scope=mine&tree=1`,
  );
  const map = new Map<string, string>();
  for (const raw of data.posts ?? data.documents ?? []) {
    const node = toNode(raw);
    const clientId = asRecord(asRecord(raw).props).clientId;
    if (node && typeof clientId === "string" && clientId) {
      map.set(clientId, node.id);
    }
  }
  return map;
}

export async function createRemoteFromLocal(
  session: RemoteSession,
  input: { clientId: string; parentId: string | null; title: string },
): Promise<string> {
  const data = await request<{ post?: unknown; document?: unknown }>(session, "POST", WIKI_DOCUMENTS, {
    title: input.title || t("common.untitled"),
    type: "life",
    kind: "article",
    parentId: input.parentId,
    summary: "",
    coverUrl: "",
    props: { clientId: input.clientId },
    body: starterArticleDocument(),
    visibility: "private",
  });
  const node = toNode(data.post ?? data.document);
  if (!node) {
    throw new Error(t("store.failedToCreatePage"));
  }
  return node.id;
}

export async function loadRemote(session: RemoteSession, id: string): Promise<EditorPage> {
  const data = await request<{ post?: unknown; document?: unknown }>(session, "GET", `${WIKI_DOCUMENTS}/id/${encodeURIComponent(id)}`);
  const page = toPage(data.post ?? data.document);
  if (!page) {
    throw new Error(t("store.pageNotFound"));
  }
  return page;
}

export async function createRemote(
  session: RemoteSession,
  parentId: string | null,
  teamId?: string | null,
  seed?: { title?: string; body?: EditorJsDocument; props?: Record<string, unknown> },
): Promise<EditorPage> {
  const body = seed?.body ?? starterArticleDocument();
  const title = seed?.title?.trim() || titleFromBody(body) || t("common.untitled");
  const data = await request<{ post?: unknown; document?: unknown }>(session, "POST", WIKI_DOCUMENTS, {
    title,
    type: "life",
    kind: "article",
    parentId,
    summary: "",
    coverUrl: "",
    props: seed?.props ?? {},
    body,
    visibility: "private",
    ...(teamId ? { teamId } : {}),
  });
  const page = toPage(data.post ?? data.document);
  if (!page) {
    throw new Error(t("store.failedToCreatePage"));
  }
  return { ...page, title, body: page.body.blocks.length > 0 ? page.body : body };
}

export async function saveRemote(
  session: RemoteSession,
  page: EditorPage,
  props: Record<string, unknown> = {},
): Promise<EditorPage> {
  const title = titleFromBody(page.body);
  const data = await request<{ post?: unknown; document?: unknown }>(session, "PUT", `${WIKI_DOCUMENTS}/${encodeURIComponent(page.id)}`, {
    title,
    type: "life",
    kind: "article",
    parentId: page.parentId,
    summary: "",
    coverUrl: "",
    props,
    body: page.body,
    visibility: "private",
    ...(page.teamId !== undefined ? { teamId: page.teamId } : {}),
  });
  const saved = toPage(data.post ?? data.document);
  return saved ?? { ...page, title, updatedAt: new Date().toISOString() };
}

export async function reparentRemote(session: RemoteSession, id: string, parentId: string | null): Promise<void> {
  await request<null>(session, "PUT", `${WIKI_DOCUMENTS}/id/${encodeURIComponent(id)}/parent`, { parentId });
}

export async function removeRemote(session: RemoteSession, id: string): Promise<void> {
  try {
    await request<null>(session, "DELETE", `${WIKI_DOCUMENTS}/${encodeURIComponent(id)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("404") || message.includes("不存在") || message.includes("NOT_FOUND")) {
      return;
    }
    throw err;
  }
}
