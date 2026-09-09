import type {
  AiChatInput,
  AiChatResult,
  AiToEditorInput,
  AiToEditorResult,
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
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `HTTP_${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ username: string }>("/api/auth/me"),
  login: (username: string, password: string) =>
    request<{ ok: boolean }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  listCategories: () =>
    request<{ categories: Category[] }>("/api/categories", { cache: "no-store" }),
  getCategory: (slug: string) => request<{ category: Category }>(`/api/categories/${slug}`),
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
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/api/categories/${id}`, { method: "DELETE" }),
  listPosts: (query?: string | {
    type?: string;
    kind?: "article" | "photos";
    limit?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const opts = typeof query === "string" ? { type: query } : (query ?? {});
    const params = new URLSearchParams();
    if (opts.type) {
      params.set("type", opts.type);
    }
    if (opts.kind) {
      params.set("kind", opts.kind);
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
    return request<{ posts: PostListItem[]; total: number; page: number; pageSize: number }>(
      qs ? `/api/posts?${qs}` : "/api/posts",
    );
  },
  getBySlug: (slug: string) => request<{ post: Post }>(`/api/posts/${slug}`),
  getById: (id: string) => request<{ post: Post }>(`/api/posts/id/${id}`),
  createPost: (input: UpsertPostInput) =>
    request<{ post: Post }>("/api/posts", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updatePost: (id: string, input: UpsertPostInput) =>
    request<{ post: Post }>(`/api/posts/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  patchPost: async (id: string, patch: Partial<UpsertPostInput>) => {
    const { post } = await api.getById(id);
    return api.updatePost(id, {
      title: patch.title ?? post.title,
      slug: patch.slug ?? post.slug,
      type: patch.type ?? post.type,
      summary: patch.summary ?? post.summary,
      coverUrl: patch.coverUrl ?? post.coverUrl,
      body: patch.body ?? post.body,
      draft: patch.draft ?? post.draft,
    });
  },
  deletePost: (id: string) =>
    request<{ ok: boolean }>(`/api/posts/${id}`, { method: "DELETE" }),
  getSite: () => request<{ about: SiteAbout }>("/api/site"),
  saveSite: (about: SiteAbout) =>
    request<{ about: SiteAbout }>("/api/site", {
      method: "PUT",
      body: JSON.stringify(about),
    }),
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
