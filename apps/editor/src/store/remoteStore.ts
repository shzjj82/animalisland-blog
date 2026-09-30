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
};

/**
 * 浏览器侧网关基址：默认空串＝同源（由 Vite / 桌面服务代理到 Nest，避免 CORS）。
 * 仅当显式设置 VITE_GATEWAY_PUBLIC_BASE 时才直连。
 */
export const GATEWAY_BASE_URL = (
  (import.meta.env.VITE_GATEWAY_BASE_URL as string | undefined) || ""
).replace(/\/$/, "");

/**
 * Editor（Web / 桌面）统一业务码：登录、文档、智能体都用 wiki。
 * 与博客的 blog 隔离，两边页面不能互相读写。
 * Nest 要求请求头 X-Biz-Code（仅 body/query 的 appCode 不够）。
 */
export const WIKI_APP_CODE = "wiki";

const SESSION_KEY = "editor:remote-session";

function wikiHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Biz-Code": WIKI_APP_CODE,
    ...extra,
  };
}

/** 拼网关路径；基址为空时走当前源（/auth、/docs…） */
export function gatewayUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!GATEWAY_BASE_URL) {
    return normalized;
  }
  return `${GATEWAY_BASE_URL}${normalized}`;
}

export function loadSession(): RemoteSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as RemoteSession;
    if (!parsed.token) {
      return null;
    }
    return { ...parsed, baseUrl: GATEWAY_BASE_URL };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function saveSession(session: RemoteSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

async function request<T>(session: RemoteSession, method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(gatewayUrl(path), typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1");
  if (!url.searchParams.has("appCode")) {
    url.searchParams.set("appCode", WIKI_APP_CODE);
  }
  const response = await fetch(url, {
    method,
    headers: wikiHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    }),
    body: body === undefined ? undefined : JSON.stringify({ ...(body as object), appCode: WIKI_APP_CODE }),
  });
  const json = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!json?.success) {
    throw new Error(json?.message || t("common.requestFailed", { status: response.status }));
  }
  return json.data as T;
}

async function authRemote(
  path: "/auth/login" | "/auth/register",
  body: { username: string; password: string; nickname?: string },
  fallback: string,
): Promise<RemoteSession> {
  const response = await fetch(gatewayUrl(path), {
    method: "POST",
    headers: wikiHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ ...body, appCode: WIKI_APP_CODE }),
  });
  const json = (await response.json().catch(() => null)) as Envelope<{
    token?: string;
    user?: { username?: string };
  }> | null;
  const token = json?.data?.token;
  if (!json?.success || !token) {
    throw new Error(json?.message || fallback);
  }
  const session: RemoteSession = {
    baseUrl: GATEWAY_BASE_URL,
    token,
    username: json.data?.user?.username || body.username,
  };
  saveSession(session);
  return session;
}

export function loginRemote(username: string, password: string): Promise<RemoteSession> {
  return authRemote("/auth/login", { username, password }, t("common.loginFailed"));
}

export function registerRemote(username: string, password: string, nickname?: string): Promise<RemoteSession> {
  return authRemote("/auth/register", { username, password, nickname }, t("common.signUpFailed"));
}

/** 需要用户中心提供 POST /auth/change-password，body 为 { oldPassword, newPassword } */
export async function changePasswordRemote(session: RemoteSession, oldPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(gatewayUrl("/auth/change-password"), {
    method: "POST",
    headers: wikiHeaders({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
    }),
    body: JSON.stringify({ oldPassword, newPassword, appCode: WIKI_APP_CODE }),
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
  return {
    id,
    title: typeof row.title === "string" && row.title.trim() ? row.title : t("common.untitled"),
    parentId: typeof parent === "string" ? parent : null,
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
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

export async function listRemote(session: RemoteSession): Promise<PageNode[]> {
  const data = await request<{ posts?: unknown[]; documents?: unknown[] }>(
    session,
    "GET",
    "/docs/documents?scope=mine&tree=1",
  );
  const rows = data.posts ?? data.documents ?? [];
  return rows.map(toNode).filter((item): item is PageNode => item !== null);
}

/** 远程文档里记着的本地 uuid，用来防止同一页被新建两次 */
export async function listRemoteClientIds(session: RemoteSession): Promise<Map<string, string>> {
  const data = await request<{ posts?: unknown[]; documents?: unknown[] }>(
    session,
    "GET",
    "/docs/documents?scope=mine&tree=1",
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
  const data = await request<{ post?: unknown; document?: unknown }>(session, "POST", "/docs/documents", {
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
  const data = await request<{ post?: unknown; document?: unknown }>(session, "GET", `/docs/documents/id/${id}`);
  const page = toPage(data.post ?? data.document);
  if (!page) {
    throw new Error(t("store.pageNotFound"));
  }
  return page;
}

export async function createRemote(session: RemoteSession, parentId: string | null): Promise<EditorPage> {
  const body = starterArticleDocument();
  const data = await request<{ post?: unknown; document?: unknown }>(session, "POST", "/docs/documents", {
    title: t("common.untitled"),
    type: "life",
    kind: "article",
    parentId,
    summary: "",
    coverUrl: "",
    props: {},
    body,
    visibility: "private",
  });
  const page = toPage(data.post ?? data.document);
  if (!page) {
    throw new Error(t("store.failedToCreatePage"));
  }
  return { ...page, body: page.body.blocks.length > 0 ? page.body : body };
}

export async function saveRemote(
  session: RemoteSession,
  page: EditorPage,
  props: Record<string, unknown> = {},
): Promise<EditorPage> {
  const title = titleFromBody(page.body);
  const data = await request<{ post?: unknown; document?: unknown }>(session, "PUT", `/docs/documents/${page.id}`, {
    title,
    type: "life",
    kind: "article",
    parentId: page.parentId,
    summary: "",
    coverUrl: "",
    props,
    body: page.body,
    visibility: "private",
  });
  const saved = toPage(data.post ?? data.document);
  return saved ?? { ...page, title, updatedAt: new Date().toISOString() };
}

export async function reparentRemote(session: RemoteSession, id: string, parentId: string | null): Promise<void> {
  await request<null>(session, "PUT", `/docs/documents/id/${encodeURIComponent(id)}/parent`, { parentId });
}

export async function removeRemote(session: RemoteSession, id: string): Promise<void> {
  try {
    await request<null>(session, "DELETE", `/docs/documents/${id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("404") || message.includes("不存在") || message.includes("NOT_FOUND")) {
      return;
    }
    throw err;
  }
}
