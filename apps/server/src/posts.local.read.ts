import type { CategoryKind, PageKind, Post, PostListItem } from "@myblog/shared";
import { getCategoryBySlug, listCategorySlugs } from "./categories.local.js";
import { db } from "./db.js";
import {
  hasDraftAncestor,
  listAncestors,
  toListItem,
  toPost,
  type PostRow,
} from "./posts.local.shared.js";

export { listAncestors } from "./posts.local.shared.js";

export function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  pageKind?: PageKind;
  parentId?: string | null;
  limit?: number;
  page?: number;
  pageSize?: number;
  includeDrafts: boolean;
  treeOrder?: boolean;
}): { posts: PostListItem[]; total: number } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeDrafts) {
    clauses.push("draft = 0");
  }
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
    // type 字段或 props.tags JSON 数组命中（在 SQL 侧过滤，保证分页/total 正确）
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

  // 公开列表：排除「祖先为草稿」的子树（含子页自身 draft=0 的情况）
  if (!opts.includeDrafts) {
    clauses.push(`id NOT IN (
      WITH RECURSIVE under_draft AS (
        SELECT id FROM posts WHERE draft = 1
        UNION ALL
        SELECT p.id FROM posts p INNER JOIN under_draft u ON p.parent_id = u.id
      )
      SELECT id FROM under_draft
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

  const sql = `SELECT id, slug, title, type, page_kind, parent_id, tree_sort, summary, cover_url, props, draft, published_at, created_at, updated_at
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

/** 工作区树：about + articles（含子页面） */
export function listWorkspaceTree(includeDrafts: boolean): PostListItem[] {
  const { posts } = listPosts({
    includeDrafts,
    treeOrder: true,
  });
  return posts.filter((p) => p.pageKind === "about" || p.pageKind === "article");
}

export function getPostBySlug(slug: string, includeDrafts: boolean): Post | undefined {
  const row = db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as PostRow | undefined;
  if (!row) {
    return undefined;
  }
  const post = toPost(row);
  if (!includeDrafts && (post.draft || hasDraftAncestor(post.id))) {
    return undefined;
  }
  return post;
}

export function getPostPage(
  slug: string,
  includeDrafts: boolean,
):
  | {
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }
  | undefined {
  const post = getPostBySlug(slug, includeDrafts);
  if (!post) {
    return undefined;
  }
  const ancestors = listAncestors(post.id, includeDrafts);
  const { posts: siblings } = listPosts({
    pageKind: "article",
    parentId: post.parentId ?? null,
    includeDrafts,
    treeOrder: true,
  });
  const { posts: children } = listPosts({
    pageKind: "article",
    parentId: post.id,
    includeDrafts,
    treeOrder: true,
  });
  return {
    post,
    ancestors,
    siblings,
    children: includeDrafts ? children : children.filter((item) => !item.draft),
  };
}

export function getPostById(id: string): Post | undefined {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
  return row ? toPost(row) : undefined;
}

export function getPageByKind(pageKind: PageKind): Post | undefined {
  const row = db
    .prepare("SELECT * FROM posts WHERE page_kind = ? LIMIT 1")
    .get(pageKind) as PostRow | undefined;
  return row ? toPost(row) : undefined;
}
