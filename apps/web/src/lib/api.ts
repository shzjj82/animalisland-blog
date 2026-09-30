import {
  encodeSlugParam,
  type AiChatInput,
  type AiChatResult,
  type ApiResponse,
  type Category,
  type Post,
  type PostListItem,
  type UpsertCategoryInput,
  type UpsertPostInput,
} from "@myblog/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const hasJsonBody = Boolean(init?.body) && !(init?.body instanceof FormData);
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }
    const reason = err instanceof Error ? err.message : "网络错误";
    throw new Error(reason || "Failed to fetch");
  }
  const text = await res.text();
  let body: ApiResponse<T> | null = null;
  try {
    body = text ? (JSON.parse(text) as ApiResponse<T>) : null;
  } catch {
    throw new Error(
      `HTTP_${res.status}: 响应不是 JSON（${text.slice(0, 120).replace(/\s+/g, " ") || "空"}）`,
    );
  }
  if (!body || typeof body !== "object" || !("success" in body)) {
    throw new Error(
      `HTTP_${method} ${url} → HTTP_${res.status}: 响应格式异常（${text.slice(0, 120).replace(/\s+/g, " ") || "空"}）`,
    );
  }
  if (!res.ok || !body.success) {
    throw new Error(body.code || body.message || `HTTP_${res.status}`);
  }
  return body.data;
}

export const api = {
  me: () => request<{ username: string }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ username: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (username: string, password: string, nickname?: string) =>
    request<{ username: string }>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password, nickname }),
    }),
  logout: () => request<null>("/api/auth/logout", { method: "POST" }),
  listCategories: () =>
    request<{ categories: Category[] }>("/api/categories", { cache: "no-store" }),
  createCategory: (input: UpsertCategoryInput) =>
    request<{ category: Category }>("/api/categories", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateCategory: (id: string, input: UpsertCategoryInput) =>
    request<{ category: Category }>(`/api/categories/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteCategory: (id: string) => request<null>(`/api/categories/${id}`, { method: "DELETE" }),
  listPosts: (query?: string | {
    type?: string;
    kind?: "article";
    pageKind?: Post["pageKind"];
    parentId?: string | null;
    tree?: boolean;
    limit?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const opts = typeof query === "string" ? { type: query } : (query ?? {});
    const params = new URLSearchParams();
    if (opts.tree) {
      params.set("tree", "1");
    }
    if (opts.type) {
      params.set("type", opts.type);
    }
    if (opts.kind) {
      params.set("kind", opts.kind);
    }
    if (opts.pageKind) {
      params.set("pageKind", opts.pageKind);
    }
    if (opts.parentId !== undefined) {
      params.set("parentId", opts.parentId === null ? "null" : opts.parentId);
    }
    if (opts.limit) {
      params.set("limit", String(opts.limit));
    }
    if (opts.page) {
      params.set("page", String(opts.page));
    }
    if (opts.pageSize) {
      params.set("pageSize", String(opts.pageSize));
    }
    const qs = params.toString();
    return request<{ posts: PostListItem[]; total: number; page?: number; pageSize?: number }>(
      qs ? `/api/posts?${qs}` : "/api/posts",
    );
  },
  workspaceTree: (signal?: AbortSignal) =>
    request<{ posts: PostListItem[]; total: number }>("/api/posts?tree=1", {
      cache: "no-store",
      signal,
    }),
  getBySlug: (slug: string) =>
    request<{
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }>(`/api/posts/${encodeSlugParam(slug)}`, { cache: "no-store" }),
  getById: (id: string) =>
    request<{ post: Post }>(`/api/posts/id/${id}`, { cache: "no-store" }),
  createPost: (input: UpsertPostInput) =>
    request<{ post: Post }>("/api/posts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** 侧栏建子页：服务端事务创建 + 挂 pageLink */
  createChildPage: (parentId: string) =>
    request<{ post: Post; parent: Post }>(`/api/posts/id/${parentId}/children`, {
      method: "POST",
    }),
  /** 把文章挂到另一篇文章下（parentId=null 表示顶层） */
  reparentPage: (id: string, parentId: string | null) =>
    request<{ child: Post; oldParent: Post | null; newParent: Post | null }>(`/api/posts/id/${id}/parent`, {
      method: "PUT",
      body: JSON.stringify({ parentId }),
    }),
  updatePost: (id: string, input: UpsertPostInput) =>
    request<{ post: Post }>(`/api/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deletePost: (id: string) => request<null>(`/api/posts/${id}`, { method: "DELETE" }),
  upload: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ url: string }>("/api/upload", { method: "POST", body });
  },
  aiStatus: () =>
    request<{ enabled: boolean; model: string | null }>("/api/ai/status"),
  aiChat: (input: AiChatInput, init?: { signal?: AbortSignal }) =>
    request<AiChatResult>("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(input),
      signal: init?.signal,
    }),
};
