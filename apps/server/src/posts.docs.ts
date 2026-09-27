/**
 * 文档服务适配：路径 /docs/documents；对外字段 kind（非 pageKind）。
 * 博客域仍用 pageKind，仅在本文件与 Nest 互转。业务默认值（appCode、life、色板）留在调用方。
 */
import type {
  CategoryKind,
  EditorJsDocument,
  PageKind,
  Post,
  PostListItem,
  PostVisibility,
} from "@myblog/shared";
import { encodeSlugParam, isPageKind } from "@myblog/shared";
import { DocsError, docsRequest, type DocsCredential } from "./docs-client.js";

const DOCS = "/docs/documents";

export type PostListScope = "public" | "feed" | "mine" | "all";

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
  visibility: PostVisibility;
};

export type PostReadAccess = "public" | "feed";

function notFound<T>(): T | undefined {
  return undefined;
}

function credentialForScope(scope: PostListScope): DocsCredential {
  if (scope === "public") {
    return "none";
  }
  if (scope === "feed") {
    return "prefer-user-or-none";
  }
  return "user";
}

/** Nest 文档 → 博客 Post（kind → pageKind） */
function mapDocToPost(raw: unknown): Post {
  const row = (raw ?? {}) as Record<string, unknown>;
  const kindRaw = row.kind ?? row.pageKind;
  const pageKind: PageKind =
    typeof kindRaw === "string" && isPageKind(kindRaw) ? kindRaw : "article";
  const { kind: _k, ...rest } = row;
  return { ...rest, pageKind } as Post;
}

function mapDocToListItem(raw: unknown): PostListItem {
  const { body: _b, ...item } = mapDocToPost(raw) as Post & { body?: unknown };
  return item;
}

function mapListPayload(data: {
  posts?: unknown[];
  documents?: unknown[];
  total?: number;
}): { posts: PostListItem[]; total: number } {
  const rows = data.posts ?? data.documents ?? [];
  const posts = rows.map(mapDocToListItem);
  return { posts, total: typeof data.total === "number" ? data.total : posts.length };
}

function unwrapPost(data: { post?: unknown; document?: unknown }): Post {
  return mapDocToPost(data.post ?? data.document);
}

/** 博客写入体 → Nest（pageKind → kind；不传 draft） */
function toDocsWriteBody(input: PostWriteInput): Record<string, unknown> {
  const { pageKind, ...rest } = input;
  return {
    ...rest,
    kind: pageKind ?? "article",
  };
}

export async function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  pageKind?: PageKind;
  parentId?: string | null;
  limit?: number;
  page?: number;
  pageSize?: number;
  scope?: PostListScope;
  treeOrder?: boolean;
}): Promise<{ posts: PostListItem[]; total: number }> {
  const scope = opts.scope ?? "public";
  // Nest：kind = 文档形态；tree/view 只决定树形，工作区必须另传 scope=mine
  const docKind = opts.pageKind ?? (opts.kind === "article" ? "article" : undefined);
  const data = await docsRequest<{
    posts?: PostListItem[];
    documents?: unknown[];
    total?: number;
  }>("GET", DOCS, {
    credential: credentialForScope(scope),
    query: {
      type: opts.type,
      kind: docKind,
      parentId: opts.parentId === null ? "null" : opts.parentId,
      limit: opts.limit,
      page: opts.page,
      pageSize: opts.pageSize,
      scope,
    },
  });
  return mapListPayload(data);
}

export async function listWorkspaceTree(): Promise<PostListItem[]> {
  const data = await docsRequest<{
    posts?: unknown[];
    documents?: unknown[];
    total?: number;
  }>("GET", DOCS, {
    credential: "user",
    query: { scope: "mine", tree: "1" },
  });
  return mapListPayload(data).posts.filter((p) => p.pageKind === "article");
}

function readCredential(access: PostReadAccess): DocsCredential {
  return access === "feed" ? "prefer-user-or-none" : "none";
}

export async function getPostBySlug(
  slug: string,
  access: PostReadAccess = "public",
): Promise<Post | undefined> {
  try {
    const data = await docsRequest<{ post?: unknown; document?: unknown }>(
      "GET",
      `${DOCS}/${encodeSlugParam(slug)}`,
      { credential: readCredential(access) },
    );
    return unwrapPost(data);
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return notFound();
    }
    throw err;
  }
}

export async function getPostPage(
  slug: string,
  access: PostReadAccess = "public",
): Promise<
  | {
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }
  | undefined
> {
  try {
    const data = await docsRequest<{
      post?: unknown;
      document?: unknown;
      ancestors?: unknown[];
      siblings?: unknown[];
      children?: unknown[];
    }>("GET", `${DOCS}/${encodeSlugParam(slug)}`, {
      credential: readCredential(access),
    });
    const post = unwrapPost(data);
    return {
      post,
      ancestors: (data.ancestors ?? []).map(mapDocToListItem),
      siblings: (data.siblings ?? []).map(mapDocToListItem),
      children: (data.children ?? []).map(mapDocToListItem),
    };
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function getPostById(id: string): Promise<Post | undefined> {
  try {
    const data = await docsRequest<{ post?: unknown; document?: unknown }>(
      "GET",
      `${DOCS}/id/${encodeURIComponent(id)}`,
      { credential: "user" },
    );
    return unwrapPost(data);
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return notFound();
    }
    throw err;
  }
}

export async function listAncestors(
  postId: string,
  access: PostReadAccess = "public",
): Promise<PostListItem[]> {
  try {
    const data = await docsRequest<{
      post?: unknown;
      document?: unknown;
      ancestors?: unknown[];
    }>("GET", `${DOCS}/id/${encodeURIComponent(postId)}`, {
      credential: access === "feed" ? "user" : "none",
    });
    const ancestors = (data.ancestors ?? []).map(mapDocToListItem);
    if (access === "feed") {
      return ancestors;
    }
    const visible: PostListItem[] = [];
    for (const item of ancestors) {
      if (item.visibility === "private") {
        break;
      }
      visible.push(item);
    }
    return visible;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return [];
    }
    throw err;
  }
}

export async function createPost(input: PostWriteInput): Promise<Post> {
  const data = await docsRequest<{ post?: unknown; document?: unknown }>("POST", DOCS, {
    credential: "user",
    body: toDocsWriteBody(input),
  });
  return unwrapPost(data);
}

export async function updatePost(id: string, input: PostWriteInput): Promise<Post | undefined> {
  try {
    const data = await docsRequest<{ post?: unknown; document?: unknown }>(
      "PUT",
      `${DOCS}/${encodeURIComponent(id)}`,
      {
        credential: "user",
        body: toDocsWriteBody(input),
      },
    );
    return unwrapPost(data);
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function createLinkedChild(parentId: string): Promise<{ child: Post; parent: Post }> {
  const data = await docsRequest<{
    post?: unknown;
    document?: unknown;
    child?: unknown;
    parent?: unknown;
  }>("POST", `${DOCS}/id/${encodeURIComponent(parentId)}/children`, { credential: "user" });
  const child = mapDocToPost(data.child ?? data.post ?? data.document);
  const parent = mapDocToPost(data.parent);
  return { child, parent };
}

export async function reparentArticle(
  childId: string,
  parentId: string | null,
): Promise<{ child: Post; oldParent: Post | null; newParent: Post | null }> {
  const data = await docsRequest<{
    child?: unknown;
    oldParent?: unknown;
    newParent?: unknown;
  }>("PUT", `${DOCS}/id/${encodeURIComponent(childId)}/parent`, {
    credential: "user",
    body: { parentId },
  });
  return {
    child: mapDocToPost(data.child),
    oldParent: data.oldParent ? mapDocToPost(data.oldParent) : null,
    newParent: data.newParent ? mapDocToPost(data.newParent) : null,
  };
}

export async function deletePost(id: string): Promise<boolean> {
  try {
    await docsRequest<null>("DELETE", `${DOCS}/${encodeURIComponent(id)}`, {
      credential: "user",
    });
    return true;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

/** 默认分类由博客 ensureDefaultCategories 写入 docs，不再依赖 Nest 种子 */
export function ensureWorkspacePages(): void {}
