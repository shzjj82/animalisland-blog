import crypto from "node:crypto";
import {
  DEFAULT_CATEGORIES,
  SITE_SKILL_COLORS,
  isCategoryKind,
  isReservedPath,
  isSiteSkillColor,
  normalizeTags,
  tagsFromProps,
  propsWithTags,
  validateTagName,
  validateTagSlug,
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

/** 去掉站点照片墙：分类与 photo/photos 页面 */
export function removePhotosFeature(): void {
  db.prepare("DELETE FROM posts WHERE page_kind IN ('photos', 'photo')").run();
  db.prepare("DELETE FROM categories WHERE kind = 'photos' OR slug = 'photos'").run();
  const fallback =
    (db
      .prepare("SELECT slug FROM categories WHERE kind = 'article' ORDER BY sort ASC LIMIT 1")
      .get() as { slug: string } | undefined)?.slug ?? "life";
  db.prepare(
    `UPDATE posts SET type = ?
     WHERE type NOT IN (SELECT slug FROM categories)`,
  ).run(fallback);
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

export function getCategoryByName(name: string): Category | undefined {
  const key = name.trim().toLocaleLowerCase();
  if (!key) {
    return undefined;
  }
  return listCategories().find(
    (item) => item.name.toLocaleLowerCase() === key || item.slug.toLocaleLowerCase() === key,
  );
}

/**
 * 自定义标签即分类：按名字/slug 解析，没有就创建（默认进导航）。
 * 返回规范化后的 category.slug 列表。
 */
export function ensureCategoriesFromLabels(labels: string[]): string[] {
  const out: string[] = [];
  for (const label of normalizeTags(labels)) {
    const existing = getCategoryBySlug(label) ?? getCategoryByName(label);
    if (existing) {
      out.push(existing.slug);
      continue;
    }
    const nameCheck = validateTagName(label);
    if (!nameCheck.ok) {
      // 旧数据里不合法的标签名：尽量保留可读名，放宽到截断创建
      const fallbackName = label.slice(0, 16).trim() || "标签";
      const safeName = validateTagName(fallbackName).ok
        ? fallbackName
        : `标签${listCategories().length + 1}`;
      const created = createCategory({
        name: safeName,
        hint: "",
        color: SITE_SKILL_COLORS[listCategories().length % SITE_SKILL_COLORS.length] ?? "app-yellow",
        kind: "article",
        nav: true,
      });
      out.push(created.slug);
      continue;
    }
    const created = createCategory({
      name: nameCheck.value,
      hint: "",
      color: SITE_SKILL_COLORS[listCategories().length % SITE_SKILL_COLORS.length] ?? "app-yellow",
      kind: "article",
      nav: true,
    });
    out.push(created.slug);
  }
  return normalizeTags(out);
}

export function createCategory(input: UpsertCategoryInput): Category {
  const nameCheck = validateTagName(input.name);
  if (!nameCheck.ok) {
    throw new Error(`TAG_NAME_INVALID:${nameCheck.error}`);
  }
  const slugCheck = validateTagSlug(input.slug ?? "", { allowEmpty: true });
  if (!slugCheck.ok) {
    throw new Error(`TAG_SLUG_INVALID:${slugCheck.error}`);
  }
  if (getCategoryByName(nameCheck.value)) {
    throw new Error("TAG_NAME_EXISTS");
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slug = uniqueCategorySlug(slugCheck.value || nameCheck.value);
  const sort =
    typeof input.sort === "number"
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
    nameCheck.value,
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

  const nameCheck = validateTagName(input.name);
  if (!nameCheck.ok) {
    throw new Error(`TAG_NAME_INVALID:${nameCheck.error}`);
  }
  const slugCheck = validateTagSlug(input.slug ?? "", { allowEmpty: true });
  if (!slugCheck.ok) {
    throw new Error(`TAG_SLUG_INVALID:${slugCheck.error}`);
  }
  const dup = getCategoryByName(nameCheck.value);
  if (dup && dup.id !== id) {
    throw new Error("TAG_NAME_EXISTS");
  }

  const slug = uniqueCategorySlug(slugCheck.value || nameCheck.value, id);
  const now = new Date().toISOString();
  const sort = typeof input.sort === "number" ? input.sort : existing.sort;

  db.prepare(
    `UPDATE categories SET
      slug = ?, name = ?, hint = ?, color = ?, kind = ?, nav = ?, sort = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    slug,
    nameCheck.value,
    input.hint?.trim() ?? "",
    input.color,
    input.kind,
    input.nav === false ? 0 : 1,
    sort,
    now,
    id,
  );

  if (slug !== existing.slug) {
    db.prepare("UPDATE posts SET type = ? WHERE type = ?").run(slug, existing.slug);
    const rows = db.prepare("SELECT id, props FROM posts").all() as Array<{ id: string; props: string }>;
    const updateProps = db.prepare("UPDATE posts SET props = ?, updated_at = ? WHERE id = ?");
    const touchedAt = new Date().toISOString();
    for (const row of rows) {
      let props: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.props || "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          props = parsed as Record<string, unknown>;
        }
      } catch {
        continue;
      }
      const tags = tagsFromProps(props);
      if (!tags.includes(existing.slug)) {
        continue;
      }
      const nextTags = tags.map((tag) => (tag === existing.slug ? slug : tag));
      updateProps.run(JSON.stringify(propsWithTags(props, nextTags)), touchedAt, row.id);
    }
  }

  return getCategoryById(id);
}

/** 从所有文章上卸掉该标签；若 type 指向它则改到剩余标签或兜底 */
function detachCategoryFromPosts(slug: string): void {
  const fallback =
    listCategories().find((item) => item.slug !== slug && item.kind === "article")?.slug ?? "life";
  const rows = db
    .prepare(`SELECT id, type, props FROM posts WHERE page_kind = 'article'`)
    .all() as Array<{ id: string; type: string; props: string }>;
  const update = db.prepare(`UPDATE posts SET type = ?, props = ?, updated_at = ? WHERE id = ?`);
  const now = new Date().toISOString();
  for (const row of rows) {
    let props: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.props || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      props = {};
    }
    const tags = tagsFromProps(props);
    const had = tags.includes(slug) || row.type === slug;
    if (!had) {
      continue;
    }
    const nextTags = tags.filter((tag) => tag !== slug);
    const nextType =
      row.type === slug ? nextTags[0] ?? fallback : getCategoryBySlug(row.type) ? row.type : nextTags[0] ?? fallback;
    update.run(nextType, JSON.stringify(propsWithTags(props, nextTags)), now, row.id);
  }
}

export function deleteCategory(id: string): boolean {
  const existing = getCategoryById(id);
  if (!existing) {
    return false;
  }
  // 允许删除：先从文章上卸掉该标签，再删分类
  detachCategoryFromPosts(existing.slug);
  const result = db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  if (result.changes <= 0) {
    return false;
  }
  // 一个都不剩时补一个兜底，避免发文/导航空转
  if (listCategorySlugs("article").length === 0) {
    createCategory({
      name: "未分类",
      slug: "uncategorized",
      hint: "还没归类的笔记",
      color: "app-yellow",
      kind: "article",
      nav: false,
    });
  }
  return true;
}

ensureDefaultCategories();
removePhotosFeature();
