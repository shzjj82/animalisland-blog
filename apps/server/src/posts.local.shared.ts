import crypto from "node:crypto";
import type {
  CategoryKind,
  EditorJsDocument,
  PageKind,
  Post,
  PostListItem,
  SiteSkillColor,
} from "@myblog/shared";
import { emptyEditorDocument, isPageKind, tagsFromProps } from "@myblog/shared";
import { getCategoryBySlug } from "./categories.local.js";
import { db } from "./db.js";

export type PostRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  page_kind: string;
  parent_id: string | null;
  tree_sort: number;
  summary: string;
  cover_url: string;
  props: string;
  body: string;
  draft: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export function parseBody(raw: string): EditorJsDocument {
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

export function bodyHasBlocks(body: EditorJsDocument): boolean {
  return (body.blocks?.length ?? 0) > 0;
}

export function parseProps(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function categoryMeta(type: string): {
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

export function toPost(row: PostRow): Post {
  const pageKind = isPageKind(row.page_kind) ? row.page_kind : "article";
  const props = parseProps(row.props ?? "{}");
  const fromProps = tagsFromProps(props);
  // 无多选分类时，回退到 posts.type（旧单分类）
  const tags =
    fromProps.length > 0 ? fromProps : row.type && pageKind === "article" ? [row.type] : [];
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    type: row.type,
    pageKind,
    parentId: row.parent_id,
    treeSort: row.tree_sort ?? 0,
    ...categoryMeta(row.type),
    summary: row.summary,
    coverUrl: row.cover_url,
    props,
    tags,
    body: parseBody(row.body),
    draft: Boolean(row.draft),
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toListItem(row: Omit<PostRow, "body">): PostListItem {
  const { body: _body, ...post } = toPost({ ...row, body: "{}" });
  return post;
}

export type AncestorRow = {
  id: string;
  parent_id: string | null;
  draft: number;
};

/** 轻量祖先索引：避免 hasDraftAncestor 每次 getPostById 解析整篇 body */
export function loadAncestorIndex(): Map<string, AncestorRow> {
  const rows = db
    .prepare("SELECT id, parent_id, draft FROM posts")
    .all() as AncestorRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** 子页没有独立草稿：若任一祖先是草稿，前台当作不可见 */
export function hasDraftAncestor(postId: string, index?: Map<string, AncestorRow>): boolean {
  const map = index ?? loadAncestorIndex();
  let current: string | null = map.get(postId)?.parent_id ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const parent = map.get(current);
    if (!parent) {
      break;
    }
    if (parent.draft) {
      return true;
    }
    current = parent.parent_id;
  }
  return false;
}

/** 祖先链（根 → 父），不含自身；供前台面包屑，避免拉全站列表 */
export function listAncestors(postId: string, includeDrafts: boolean): PostListItem[] {
  const index = loadAncestorIndex();
  const chainIds: string[] = [];
  let current: string | null = index.get(postId)?.parent_id ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const parent = index.get(current);
    if (!parent) {
      break;
    }
    if (!includeDrafts && parent.draft) {
      break;
    }
    chainIds.unshift(current);
    current = parent.parent_id;
  }
  if (chainIds.length === 0) {
    return [];
  }
  const placeholders = chainIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT id, slug, title, type, page_kind, parent_id, tree_sort, summary, cover_url, props, draft, published_at, created_at, updated_at
       FROM posts WHERE id IN (${placeholders})`,
    )
    .all(...chainIds) as Omit<PostRow, "body">[];
  const byId = new Map(rows.map((row) => [row.id, toListItem(row)]));
  return chainIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
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

export function uniqueSlug(base: string, excludeId?: string): string {
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

export function nextTreeSort(parentId: string | null, pageKind?: PageKind): number {
  if (parentId) {
    const row = db
      .prepare("SELECT COALESCE(MAX(tree_sort), -1) AS n FROM posts WHERE parent_id = ?")
      .get(parentId) as { n: number };
    return row.n + 1;
  }
  if (pageKind === "article") {
    const row = db
      .prepare(
        "SELECT COALESCE(MAX(tree_sort), -1) AS n FROM posts WHERE page_kind = 'article' AND parent_id IS NULL",
      )
      .get() as { n: number };
    return row.n + 1;
  }
  return 0;
}
