import type { Post, PostListItem, PostType, SiteAbout, UpsertPostInput } from "@myblog/shared";

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
  listPosts: (type?: PostType) =>
    request<{ posts: PostListItem[] }>(type ? `/api/posts?type=${type}` : "/api/posts"),
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
};
