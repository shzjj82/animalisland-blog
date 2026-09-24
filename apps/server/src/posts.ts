import type { CategoryKind, EditorJsDocument, PageKind, Post, PostListItem } from "@myblog/shared";
import { DocsError, docsRequest } from "./docs-client.js";

export type PostWriteInput = {
  title: string;
  slug?: string;
  type: string;
  pageKind?: PageKind;
  parentId?: string | null;
  treeSort?: number;
  summary: string;
  coverUrl: string;
  props?: Record<string, unknown>;
  tags?: string[];
  body: EditorJsDocument;
  draft: boolean;
};

function notFound<T>(): T | undefined {
  return undefined;
}

export async function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  pageKind?: PageKind;
  parentId?: string | null;
  limit?: number;
  page?: number;
  pageSize?: number;
  includeDrafts: boolean;
  treeOrder?: boolean;
}): Promise<{ posts: PostListItem[]; total: number }> {
  return docsRequest<{ posts: PostListItem[]; total: number }>("GET", "/docs/posts", {
    query: {
      type: opts.type,
      kind: opts.kind,
      pageKind: opts.pageKind,
      parentId: opts.parentId === null ? "null" : opts.parentId,
      limit: opts.limit,
      page: opts.page,
      pageSize: opts.pageSize,
      includeDrafts: opts.includeDrafts ? "1" : undefined,
    },
  });
}

export async function listWorkspaceTree(includeDrafts: boolean): Promise<PostListItem[]> {
  const data = await docsRequest<{ posts: PostListItem[]; total: number }>("GET", "/docs/posts", {
    query: { tree: "1", includeDrafts: includeDrafts ? "1" : undefined },
  });
  return data.posts;
}

export async function getPostBySlug(slug: string, includeDrafts: boolean): Promise<Post | undefined> {
  try {
    const data = await docsRequest<{ post: Post }>("GET", `/docs/posts/${encodeURIComponent(slug)}`, {
      query: includeDrafts ? { includeDrafts: "1" } : undefined,
    });
    return data.post;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return notFound();
    }
    throw err;
  }
}

export async function getPostPage(
  slug: string,
  includeDrafts: boolean,
): Promise<{
  post: Post;
  ancestors: PostListItem[];
  siblings: PostListItem[];
  children: PostListItem[];
} | undefined> {
  try {
    return await docsRequest("GET", `/docs/posts/${encodeURIComponent(slug)}`, {
      query: includeDrafts ? { includeDrafts: "1" } : undefined,
    });
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function getPostById(id: string): Promise<Post | undefined> {
  try {
    const data = await docsRequest<{ post: Post; ancestors?: PostListItem[] }>(
      "GET",
      `/docs/posts/id/${encodeURIComponent(id)}`,
    );
    return data.post;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return notFound();
    }
    throw err;
  }
}

export async function getPageByKind(pageKind: PageKind): Promise<Post | undefined> {
  if (pageKind === "about") {
    const data = await docsRequest<{ about: Post | null }>("GET", "/docs/posts/workspace/specials");
    return data.about ?? undefined;
  }
  const { posts } = await listPosts({ pageKind, includeDrafts: true, treeOrder: true, limit: 1 });
  if (!posts[0]) {
    return undefined;
  }
  return getPostById(posts[0].id);
}

export async function listAncestors(postId: string, _includeDrafts: boolean): Promise<PostListItem[]> {
  try {
    const data = await docsRequest<{ post: Post; ancestors?: PostListItem[] }>(
      "GET",
      `/docs/posts/id/${encodeURIComponent(postId)}`,
    );
    return data.ancestors ?? [];
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

export async function createPost(input: PostWriteInput): Promise<Post> {
  const data = await docsRequest<{ post: Post }>("POST", "/docs/posts", { body: input });
  return data.post;
}

export async function updatePost(id: string, input: PostWriteInput): Promise<Post | undefined> {
  try {
    const data = await docsRequest<{ post: Post }>("PUT", `/docs/posts/${encodeURIComponent(id)}`, {
      body: input,
    });
    return data.post;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function createLinkedChild(parentId: string): Promise<{ child: Post; parent: Post }> {
  const data = await docsRequest<{ post: Post; parent: Post }>(
    "POST",
    `/docs/posts/id/${encodeURIComponent(parentId)}/children`,
  );
  return { child: data.post, parent: data.parent };
}

export async function reparentArticle(
  childId: string,
  parentId: string | null,
): Promise<{ child: Post; oldParent: Post | null; newParent: Post | null }> {
  return docsRequest("PUT", `/docs/posts/id/${encodeURIComponent(childId)}/parent`, {
    body: { parentId },
  });
}

export async function deletePost(id: string): Promise<boolean> {
  try {
    await docsRequest<null>("DELETE", `/docs/posts/${encodeURIComponent(id)}`);
    return true;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

/** 默认分类 / about 页由 Nest 文档服务种子，这边不再写本地库 */
export function ensureWorkspacePages(): void {}
