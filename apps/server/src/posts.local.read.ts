import type { CategoryKind, PageKind, Post, PostListItem } from "@myblog/shared";
import { getCategoryBySlug, listCategorySlugs } from "./categories.local.js";
import { db } from "./db.js";
import { getAuthUser } from "./request-context.js";
import {
  hasPrivateAncestor,
  listAncestors,
  toListItem,
  toPost,
  type PostRow,
} from "./posts.local.shared.js";

export { listAncestors } from "./posts.local.shared.js";

export type PostListScope = "public" | "feed" | "mine" | "all";
export type PostReadAccess = "public" | "feed";

const LIST_COLS =
  "id, slug, title, type, page_kind, parent_id, tree_sort, summary, cover_url, props, draft, author_id, published_at, created_at, updated_at";

export function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  pageKind?: PageKind;
  parentId?: string | null;
  limit?: number;
  page?: number;
  pageSize?: number;
  scope?: PostListScope;
  treeOrder?: boolean;
}): { posts: PostListItem[]; total: number } {
  const scope = opts.scope ?? "public";
  const viewerId = getAuthUser()?.id;
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (scope === "public") {
    clauses.push("draft = 0");
  } else if (scope === "feed") {
    // 公开 + 当前用户自己的私有（详情页兄弟/子页用）；无会话等同 public
    if (viewerId) {
      clauses.push("(draft = 0 OR author_id = ?)");
      params.push(viewerId);
    } else {
      clauses.push("draft = 0");
    }
  } else if (scope === "mine") {
    if (!viewerId) {
      return { posts: [], total: 0 };
    }
    // 本人文章 + 无作者旧文（首次编辑会认领）
    clauses.push("(author_id = ? OR author_id IS NULL)");
    params.push(viewerId);
  }
  // scope=all：不过滤可见性/作者（本机运维）

  if (opts.pageKind) {
    clauses.push("page_kind = ?");
    params.push(opts.pageKind);
  }
  if (opts.parentId !== undefined) {
    if (opts.parentId === null) {
      clauses.push("parent_id IS NULL");
    } else {
      clauses.push("parent_id = ?");
      params.push(opts.parentId);
    }
  }
  let typeSlug: string | undefined;
  if (opts.type) {
    if (!getCategoryBySlug(opts.type)) {
      return { posts: [], total: 0 };
    }
    typeSlug = opts.type;
    if (!opts.pageKind) {
      clauses.push("page_kind = 'article'");
    }
    clauses.push(
      `(type = ? OR EXISTS (
        SELECT 1 FROM json_each(json_extract(COALESCE(props, '{}'), '$.tags')) AS tag
        WHERE tag.value = ?
      ))`,
    );
    params.push(typeSlug, typeSlug);
  } else if (opts.kind && !opts.pageKind) {
    const slugs = listCategorySlugs(opts.kind);
    if (slugs.length === 0) {
      return { posts: [], total: 0 };
    }
    clauses.push(`type IN (${slugs.map(() => "?").join(",")})`);
    params.push(...slugs);
    if (opts.kind === "article") {
      clauses.push("page_kind = 'article'");
    }
  }

  // 公开列表：排除「祖先为私有」的子树
  if (scope === "public" || (scope === "feed" && !viewerId)) {
    clauses.push(`id NOT IN (
      WITH RECURSIVE under_private AS (
        SELECT id FROM posts WHERE draft = 1
        UNION ALL
        SELECT p.id FROM posts p INNER JOIN under_private u ON p.parent_id = u.id
      )
      SELECT id FROM under_private
    )`);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const totalRow = db.prepare(`SELECT COUNT(*) AS count FROM posts ${where}`).get(...params) as {
    count: number;
  };
  const total = Number(totalRow?.count ?? 0);

  let limit: number | undefined;
  let offset: number | undefined;
  if (opts.pageSize && opts.pageSize > 0) {
    const pageSize = Math.min(Math.floor(opts.pageSize), 100);
    const page = Math.max(1, Math.floor(opts.page ?? 1));
    limit = pageSize;
    offset = (page - 1) * pageSize;
  } else if (opts.limit && opts.limit > 0) {
    limit = Math.min(opts.limit, 100);
  }

  const order = opts.treeOrder
    ? "ORDER BY tree_sort ASC, created_at ASC"
    : "ORDER BY COALESCE(published_at, created_at) DESC";

  const sql = `SELECT ${LIST_COLS}
       FROM posts ${where}
       ${order}${limit != null ? " LIMIT ?" : ""}${offset != null ? " OFFSET ?" : ""}`;
  const bind = [...params];
  if (limit != null) {
    bind.push(limit);
  }
  if (offset != null) {
    bind.push(offset);
  }
  const rows = db.prepare(sql).all(...bind) as Omit<PostRow, "body">[];
  return { posts: rows.map(toListItem), total };
}

/** 工作区树：仅本人 articles（含子页面） */
export function listWorkspaceTree(): PostListItem[] {
  const { posts } = listPosts({
    scope: "mine",
    treeOrder: true,
  });
  return posts.filter((p) => p.pageKind === "article");
}

export function getPostBySlug(
  slug: string,
  access: PostReadAccess = "public",
): Post | undefined {
  const row = db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as PostRow | undefined;
  if (!row) {
    return undefined;
  }
  const post = toPost(row);
  if (access === "public") {
    if (post.visibility === "private" || hasPrivateAncestor(post.id)) {
      return undefined;
    }
    return post;
  }
  // feed：公开可见；私有仅作者（或无作者旧文，首次打开后认领）
  if (post.visibility === "private" || hasPrivateAncestor(post.id)) {
    const viewerId = getAuthUser()?.id;
    if (!viewerId) {
      return undefined;
    }
    if (post.authorId && post.authorId !== viewerId) {
      return undefined;
    }
  }
  return post;
}

export function getPostPage(
  slug: string,
  access: PostReadAccess = "public",
):
  | {
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }
  | undefined {
  const post = getPostBySlug(slug, access);
  if (!post) {
    return undefined;
  }
  const ancestors = listAncestors(post.id, access);
  const scope: PostListScope = access === "feed" ? "feed" : "public";
  const { posts: siblings } = listPosts({
    pageKind: "article",
    parentId: post.parentId ?? null,
    scope,
    treeOrder: true,
  });
  const { posts: children } = listPosts({
    pageKind: "article",
    parentId: post.id,
    scope,
    treeOrder: true,
  });
  return {
    post,
    ancestors,
    siblings,
    children:
      access === "feed" ? children : children.filter((item) => item.visibility === "public"),
  };
}

export function getPostById(id: string): Post | undefined {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
  return row ? toPost(row) : undefined;
}
