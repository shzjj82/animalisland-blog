import crypto from "node:crypto";
import type { EditorJsDocument, Post, PostListItem, PostType } from "@myblog/shared";
import { emptyEditorDocument, isPostType } from "@myblog/shared";
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

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type as PostType,
    summary: row.summary,
    coverUrl: row.cover_url,
    body: parseBody(row.body),
    draft: Boolean(row.draft),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toListItem(row: PostRow): PostListItem {
  const { body: _body, ...rest } = toPost(row);
  return rest;
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

export function listPosts(opts: { type?: string; includeDrafts: boolean }): PostListItem[] {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (!opts.includeDrafts) {
    clauses.push("draft = 0");
  }
  if (opts.type) {
    if (!isPostType(opts.type)) {
      return [];
    }
    clauses.push("type = ?");
    params.push(opts.type);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT * FROM posts ${where}
       ORDER BY COALESCE(published_at, created_at) DESC`,
    )
    .all(...params) as PostRow[];

  return rows.map(toListItem);
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
  type: PostType;
  summary: string;
  coverUrl: string;
  body: EditorJsDocument;
  draft: boolean;
};

export function createPost(input: PostWriteInput): Post {
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
