import crypto from "node:crypto";
import {
  DEFAULT_CATEGORIES,
  isCategoryKind,
  isReservedPath,
  isSiteSkillColor,
  type Category,
  type CategoryKind,
  type SiteSkillColor,
  type UpsertCategoryInput,
} from "@myblog/shared";
import { db } from "./db.js";

type CategoryRow = {
  id: string;
  slug: string;
  name: string;
  hint: string;
  color: string;
  kind: string;
  nav: number;
  sort: number;
  created_at: string;
  updated_at: string;
};

function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    hint: row.hint,
    color: (isSiteSkillColor(row.color) ? row.color : "app-yellow") as SiteSkillColor,
    kind: (isCategoryKind(row.kind) ? row.kind : "article") as CategoryKind,
    nav: Boolean(row.nav),
    sort: row.sort,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function slugifyCategory(input: string): string {
  const base = input
    .trim()
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || crypto.randomUUID().slice(0, 8);
}

function uniqueCategorySlug(base: string, excludeId?: string): string {
  let slug = slugifyCategory(base);
  let i = 2;
  for (;;) {
    if (isReservedPath(slug)) {
      slug = `${slugifyCategory(base)}-${i}`;
      i += 1;
      continue;
    }
    const row = db
      .prepare("SELECT id FROM categories WHERE slug = ?")
      .get(slug) as { id: string } | undefined;
    if (!row || row.id === excludeId) {
      return slug;
    }
    slug = `${slugifyCategory(base)}-${i}`;
    i += 1;
  }
}

export function ensureDefaultCategories(): void {
  const count = (db.prepare("SELECT COUNT(*) AS n FROM categories").get() as { n: number }).n;
  if (count > 0) {
    return;
  }
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO categories
      (id, slug, name, hint, color, kind, nav, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const item of DEFAULT_CATEGORIES) {
    insert.run(
      crypto.randomUUID(),
      item.slug,
      item.name,
      item.hint,
      item.color,
      item.kind,
      item.nav ? 1 : 0,
      item.sort,
      now,
      now,
    );
  }
}

export function listCategories(): Category[] {
  const rows = db
    .prepare("SELECT * FROM categories ORDER BY sort ASC, created_at ASC")
    .all() as CategoryRow[];
  return rows.map(toCategory);
}

export function listCategorySlugs(kind: CategoryKind): string[] {
  return listCategories()
    .filter((item) => item.kind === kind)
    .map((item) => item.slug);
}

export function getCategoryById(id: string): Category | undefined {
  const row = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as CategoryRow | undefined;
  return row ? toCategory(row) : undefined;
}

export function getCategoryBySlug(slug: string): Category | undefined {
  const row = db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug) as CategoryRow | undefined;
  return row ? toCategory(row) : undefined;
}

export function countPostsInCategory(slug: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM posts WHERE type = ?").get(slug) as { n: number }).n;
}

export function createCategory(input: UpsertCategoryInput): Category {
  if (input.kind === "photos" && listCategorySlugs("photos").length > 0) {
    throw new Error("PHOTOS_EXISTS");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slug = uniqueCategorySlug(input.slug || input.name);
  const sort =
    input.kind === "photos"
      ? 1000
      : typeof input.sort === "number"
        ? input.sort
        : ((db
            .prepare("SELECT COALESCE(MAX(sort), -1) AS n FROM categories WHERE kind = 'article'")
            .get() as { n: number }).n + 1);

  db.prepare(
    `INSERT INTO categories
      (id, slug, name, hint, color, kind, nav, sort, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    slug,
    input.name.trim(),
    input.hint?.trim() ?? "",
    input.color,
    input.kind,
    input.nav === false ? 0 : 1,
    sort,
    now,
    now,
  );

  return getCategoryById(id)!;
}

export function updateCategory(id: string, input: UpsertCategoryInput): Category | undefined {
  const existing = getCategoryById(id);
  if (!existing) {
    return undefined;
  }
  // 照片墙分类固定：不允许改成文章栏
  const kind = existing.kind === "photos" ? "photos" : input.kind;
  if (kind === "photos" && existing.kind !== "photos" && listCategorySlugs("photos").length > 0) {
    throw new Error("PHOTOS_EXISTS");
  }

  const slug = uniqueCategorySlug(input.slug || input.name, id);
  const now = new Date().toISOString();
  // 照片墙 sort 固定靠后，不参与文章分类排序
  const sort =
    existing.kind === "photos"
      ? 1000
      : typeof input.sort === "number"
        ? input.sort
        : existing.sort;

  db.prepare(
    `UPDATE categories SET
      slug = ?, name = ?, hint = ?, color = ?, kind = ?, nav = ?, sort = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    slug,
    input.name.trim(),
    input.hint?.trim() ?? "",
    input.color,
    kind,
    input.nav === false ? 0 : 1,
    sort,
    now,
    id,
  );

  if (slug !== existing.slug) {
    db.prepare("UPDATE posts SET type = ? WHERE type = ?").run(slug, existing.slug);
  }

  return getCategoryById(id);
}

export function deleteCategory(id: string): boolean {
  const existing = getCategoryById(id);
  if (!existing) {
    return false;
  }
  if (existing.kind === "photos") {
    throw new Error("PHOTOS_FIXED");
  }
  if (countPostsInCategory(existing.slug) > 0) {
    throw new Error("CATEGORY_IN_USE");
  }
  if (existing.kind === "article" && listCategorySlugs("article").length <= 1) {
    throw new Error("LAST_ARTICLE_CATEGORY");
  }
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  return result.changes > 0;
}

ensureDefaultCategories();
// 既有库也把照片墙 sort 钉在文章分类之后
db.prepare("UPDATE categories SET sort = 1000 WHERE kind = 'photos' AND sort != 1000").run();
