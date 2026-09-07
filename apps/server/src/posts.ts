import crypto from "node:crypto";
import type { CategoryKind, EditorJsDocument, Post, PostListItem, SiteSkillColor } from "@myblog/shared";
import { emptyEditorDocument } from "@myblog/shared";
import { getCategoryBySlug, listCategorySlugs } from "./categories.js";
import { db } from "./db.js";

type PostRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  summary: string;
  cover_url: string;
  body: string;
  draft: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

function parseBody(raw: string): EditorJsDocument {
  try {
    const parsed = JSON.parse(raw) as EditorJsDocument;
    if (!parsed || !Array.isArray(parsed.blocks)) {
      return emptyEditorDocument();
    }
    return parsed;
  } catch {
    return emptyEditorDocument();
  }
}

function categoryMeta(type: string): {
  categoryName: string;
  categoryColor: SiteSkillColor;
  categoryKind: CategoryKind;
} {
  const category = getCategoryBySlug(type);
  return {
    categoryName: category?.name ?? type,
    categoryColor: category?.color ?? "app-yellow",
    categoryKind: category?.kind ?? "article",
  };
}

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    ...categoryMeta(row.type),
    summary: row.summary,
    coverUrl: row.cover_url,
    body: parseBody(row.body),
    draft: Boolean(row.draft),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toListItem(row: Omit<PostRow, "body">): PostListItem {
  const { body: _body, ...post } = toPost({ ...row, body: "{}" });
  return post;
}

export function slugify(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || crypto.randomUUID().slice(0, 8);
}

function uniqueSlug(base: string, excludeId?: string): string {
  let slug = slugify(base);
  let i = 2;
  for (;;) {
    const row = db
      .prepare("SELECT id FROM posts WHERE slug = ?")
      .get(slug) as { id: string } | undefined;
    if (!row || row.id === excludeId) {
      return slug;
    }
    slug = `${slugify(base)}-${i}`;
    i += 1;
  }
}

export function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  limit?: number;
  page?: number;
  pageSize?: number;
  includeDrafts: boolean;
}): { posts: PostListItem[]; total: number } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeDrafts) {
    clauses.push("draft = 0");
  }
  if (opts.type) {
    if (!getCategoryBySlug(opts.type)) {
      return { posts: [], total: 0 };
    }
    clauses.push("type = ?");
    params.push(opts.type);
  } else if (opts.kind) {
    const slugs = listCategorySlugs(opts.kind);
    if (slugs.length === 0) {
      return { posts: [], total: 0 };
    }
    clauses.push(`type IN (${slugs.map(() => "?").join(",")})`);
    params.push(...slugs);
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

  const sql = `SELECT id, slug, title, type, summary, cover_url, draft, published_at, created_at, updated_at
       FROM posts ${where}
       ORDER BY COALESCE(published_at, created_at) DESC${limit != null ? " LIMIT ?" : ""}${
         offset != null ? " OFFSET ?" : ""
       }`;
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

export function getPostBySlug(slug: string, includeDrafts: boolean): Post | undefined {
  const row = db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug) as PostRow | undefined;
  if (!row) {
    return undefined;
  }
  const post = toPost(row);
  if (post.draft && !includeDrafts) {
    return undefined;
  }
  return post;
}

export function getPostById(id: string): Post | undefined {
  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as PostRow | undefined;
  return row ? toPost(row) : undefined;
}

type PostWriteInput = {
  title: string;
  slug?: string;
  type: string;
  summary: string;
  coverUrl: string;
  body: EditorJsDocument;
  draft: boolean;
};

export function createPost(input: PostWriteInput): Post {
  if (!getCategoryBySlug(input.type)) {
    throw new Error("INVALID_CATEGORY");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slug = uniqueSlug(input.slug || input.title);
  const publishedAt = input.draft ? null : now;

  db.prepare(
    `INSERT INTO posts
      (id, slug, title, type, summary, cover_url, body, draft, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    slug,
    input.title,
    input.type,
    input.summary,
    input.coverUrl,
    JSON.stringify(input.body),
    input.draft ? 1 : 0,
    publishedAt,
    now,
    now,
  );

  return getPostById(id)!;
}

export function updatePost(id: string, input: PostWriteInput): Post | undefined {
  const existing = getPostById(id);
  if (!existing) {
    return undefined;
  }
  if (!getCategoryBySlug(input.type)) {
    throw new Error("INVALID_CATEGORY");
  }

  const now = new Date().toISOString();
  const slug = uniqueSlug(input.slug || input.title, id);
  let publishedAt = existing.publishedAt;
  if (!input.draft && !publishedAt) {
    publishedAt = now;
  }
  if (input.draft) {
    publishedAt = existing.publishedAt;
  }

  db.prepare(
    `UPDATE posts SET
      slug = ?, title = ?, type = ?, summary = ?, cover_url = ?, body = ?,
      draft = ?, published_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    slug,
    input.title,
    input.type,
    input.summary,
    input.coverUrl,
    JSON.stringify(input.body),
    input.draft ? 1 : 0,
    publishedAt,
    now,
    id,
  );

  return getPostById(id);
}

export function deletePost(id: string): boolean {
  const result = db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  return result.changes > 0;
}
