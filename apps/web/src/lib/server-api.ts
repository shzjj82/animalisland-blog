import { cache } from "react";
import {
  encodeSlugParam,
  type ApiResponse,
  type Category,
  type Post,
  type PostListItem,
} from "@myblog/shared";

/** 公开读短缓存（秒）；与 Express Cache-Control 大致对齐 */
const PUBLIC_REVALIDATE_SEC = 60;

function internalBase() {
  return (
    process.env.INTERNAL_API_URL || `http://127.0.0.1:${process.env.API_PORT || 3001}`
  ).replace(/\/$/, "");
}

type ServerRequestInit = RequestInit & {
  /** false = 不缓存；数字 = ISR 秒数；默认公开 60s */
  revalidate?: number | false;
};

async function serverRequest<T>(path: string, init?: ServerRequestInit): Promise<T> {
  const { revalidate = PUBLIC_REVALIDATE_SEC, ...rest } = init ?? {};
  const cacheOpt =
    revalidate === false
      ? ({ cache: "no-store" } as const)
      : ({ next: { revalidate } } as const);

  const res = await fetch(`${internalBase()}${path}`, {
    ...rest,
    ...cacheOpt,
    headers: {
      Accept: "application/json",
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
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

export async function fetchPublishedArticles(opts?: { type?: string }): Promise<PostListItem[]> {
  const params = new URLSearchParams();
  params.set("pageKind", "article");
  params.set("parentId", "null");
  if (opts?.type) {
    params.set("type", opts.type);
  }
  try {
    const data = await serverRequest<{ posts: PostListItem[]; total: number }>(
      `/api/posts?${params.toString()}`,
      { revalidate: 30 },
    );
    return data.posts.filter(
      (item) => item.visibility === "public" && item.pageKind === "article" && !item.parentId,
    );
  } catch {
    return [];
  }
}

export async function fetchCategories(): Promise<Category[]> {
  try {
    const data = await serverRequest<{ categories: Category[] }>("/api/categories", {
      revalidate: 60,
    });
    return data.categories;
  } catch {
    return [];
  }
}

export type PostDetail = {
  post: Post;
  ancestors: PostListItem[];
  siblings: PostListItem[];
  children: PostListItem[];
};

/** 同一次渲染里 metadata + page 共用，避免打两次 Express */
export const fetchPostBySlug = cache(async (slug: string): Promise<PostDetail | null> => {
  try {
    // Next params 对中文 slug 可能仍带 %xx；再 encodeURIComponent 会双重编码 → Express URIError / Nest 404
    const data = await serverRequest<PostDetail>(`/api/posts/${encodeSlugParam(slug)}`, {
      revalidate: 60,
    });
    if (data.post.pageKind !== "article") {
      return null;
    }
    return {
      ...data,
      children: (data.children ?? []).filter((item) => item.visibility === "public"),
    };
  } catch {
    return null;
  }
});

export function publicSiteOrigin() {
  const fromEnv = process.env.SITE_URL?.replace(/\/$/, "");
  if (fromEnv) {
    return fromEnv;
  }
  return "http://127.0.0.1:5173";
}
