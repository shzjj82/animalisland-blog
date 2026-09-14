import type {
  AiChatInput,
  AiChatResult,
  AiToEditorInput,
  AiToEditorResult,
  ApiResponse,
  Category,
  Post,
  PostListItem,
  SiteAbout,
  UpsertCategoryInput,
  UpsertPostInput,
} from "@myblog/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!body || typeof body !== "object" || !("success" in body)) {
    throw new Error(`HTTP_${res.status}`);
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
  workspaceTree: () => api.listPosts({ tree: true }),
  workspaceSpecials: () =>
    request<{ about: Post | null }>("/api/posts/workspace/specials"),
  getBySlug: (slug: string) =>
    request<{
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }>(`/api/posts/${slug}`),
  getById: (id: string) => request<{ post: Post }>(`/api/posts/id/${id}`),
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
  updatePost: (id: string, input: UpsertPostInput) =>
    request<{ post: Post }>(`/api/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deletePost: (id: string) => request<null>(`/api/posts/${id}`, { method: "DELETE" }),
  getSite: () => request<{ about: SiteAbout }>("/api/site"),
  upload: async (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ url: string }>("/api/upload", { method: "POST", body });
  },
  aiStatus: () =>
    request<{ enabled: boolean; model: string | null; base: string | null }>("/api/ai/status"),
  aiChat: (input: AiChatInput) =>
    request<AiChatResult>("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  aiToEditor: (input: AiToEditorInput) =>
    request<AiToEditorResult>("/api/ai/to-editor", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
