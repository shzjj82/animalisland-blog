import crypto from "node:crypto";
import type {
  CategoryKind,
  EditorJsDocument,
  PageKind,
  Post,
  PostListItem,
  SiteSkillColor,
} from "@myblog/shared";
import { emptyEditorDocument, isPageKind, tagsFromProps, propsWithTags } from "@myblog/shared";
import { ensureCategoriesFromLabels, getCategoryBySlug, listCategories, listCategorySlugs } from "./categories.js";
import { db } from "./db.js";

type PostRow = {
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

function parseProps(raw: string): Record<string, unknown> {
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

function nextTreeSort(parentId: string | null, pageKind?: PageKind): number {
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
    // 按分类筛：type 或 tags 命中即可，SQL 侧先收窄 page_kind
    if (!opts.pageKind) {
      clauses.push("page_kind = 'article'");
    }
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
  let posts = rows.map(toListItem);
  if (typeSlug) {
    posts = posts.filter((p) => p.type === typeSlug || p.tags.includes(typeSlug));
  }
  if (!opts.includeDrafts) {
    posts = posts.filter((p) => !hasDraftAncestor(p.id));
  }

  return { posts, total: posts.length };
}

/** 工作区树：about + articles（含子页面） */
export function listWorkspaceTree(includeDrafts: boolean): PostListItem[] {
  const { posts } = listPosts({
    includeDrafts,
    treeOrder: true,
  });
  return posts.filter((p) => p.pageKind === "about" || p.pageKind === "article");
}

/** 子页没有独立草稿：若任一祖先是草稿，前台当作不可见 */
function hasDraftAncestor(postId: string): boolean {
  let current: string | null = getPostById(postId)?.parentId ?? null;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      break;
    }
    seen.add(current);
    const parent = getPostById(current);
    if (!parent) {
      break;
    }
    if (parent.draft) {
      return true;
    }
    current = parent.parentId;
  }
  return false;
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

type PostWriteInput = {
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

function wouldCreateCycle(pageId: string, newParentId: string): boolean {
  if (pageId === newParentId) {
    return true;
  }
  let current: string | null = newParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === pageId) {
      return true;
    }
    if (seen.has(current)) {
      return true;
    }
    seen.add(current);
    const row = db.prepare("SELECT parent_id FROM posts WHERE id = ?").get(current) as
      | { parent_id: string | null }
      | undefined;
    current = row?.parent_id ?? null;
  }
  return false;
}

function resolveArticleParent(parentId: string | null | undefined): string | null {
  if (!parentId) {
    return null;
  }
  const parent = getPostById(parentId);
  if (!parent || parent.pageKind !== "article") {
    throw new Error("INVALID_PARENT");
  }
  return parent.id;
}

export function createPost(input: PostWriteInput): Post {
  const pageKind = input.pageKind ?? "article";
  if (pageKind === "about") {
    const existing = getPageByKind(pageKind);
    if (existing) {
      throw new Error("PAGE_EXISTS");
    }
  }

  let parentId: string | null = null;
  if (pageKind === "article") {
    parentId = resolveArticleParent(input.parentId);
  }

  // 子页面不参与草稿：始终已发布，可见性跟祖先顶层文章的草稿状态
  const asDraft = parentId ? false : Boolean(input.draft);

  const rawTags =
    input.tags !== undefined
      ? tagsFromProps(propsWithTags({}, input.tags))
      : tagsFromProps(input.props);
  // 自定义标签自动落成分类（进导航）
  const tagSlugs =
    pageKind === "article" && !parentId ? ensureCategoriesFromLabels(rawTags) : rawTags;

  const resolvedType =
    pageKind === "article"
      ? (tagSlugs[0] && getCategoryBySlug(tagSlugs[0])
          ? tagSlugs[0]
          : (getCategoryBySlug(input.type)?.slug ??
            listCategories().find((c) => c.kind === "article")?.slug ??
            "life"))
      : input.type ||
        listCategories().find((c) => c.kind === "article")?.slug ||
        "life";

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const slug = uniqueSlug(input.slug || input.title || pageKind);
  const publishedAt = asDraft ? null : now;
  const treeSort =
    typeof input.treeSort === "number" ? input.treeSort : nextTreeSort(parentId, pageKind);
  const props =
    pageKind === "article" && !parentId
      ? propsWithTags(input.props, tagSlugs)
      : input.tags !== undefined
        ? propsWithTags(input.props, input.tags)
        : propsWithTags(input.props, tagsFromProps(input.props));

  db.prepare(
    `INSERT INTO posts
      (id, slug, title, type, page_kind, parent_id, tree_sort, summary, cover_url, props, body, draft, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    slug,
    input.title,
    resolvedType,
    pageKind,
    parentId,
    treeSort,
    input.summary,
    input.coverUrl,
    JSON.stringify(props),
    JSON.stringify(input.body),
    asDraft ? 1 : 0,
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

  const pageKind = input.pageKind ?? existing.pageKind;
  if (existing.pageKind === "about") {
    if (pageKind !== existing.pageKind) {
      throw new Error("PAGE_KIND_FIXED");
    }
  }

  let parentId = existing.parentId;
  if (pageKind === "article") {
    if (input.parentId !== undefined) {
      parentId = resolveArticleParent(input.parentId);
      if (parentId && wouldCreateCycle(id, parentId)) {
        throw new Error("INVALID_PARENT");
      }
    }
  } else {
    parentId = null;
  }

  // 子页面不参与草稿
  const asDraft = parentId ? false : Boolean(input.draft);

  const now = new Date().toISOString();
  const slug = uniqueSlug(input.slug || input.title || existing.slug, id);
  let publishedAt = existing.publishedAt;
  if (!asDraft && !publishedAt) {
    publishedAt = now;
  }
  if (asDraft) {
    publishedAt = existing.publishedAt;
  }

  const treeSort = typeof input.treeSort === "number" ? input.treeSort : existing.treeSort;
  const baseProps = input.props ?? existing.props;
  const rawTags =
    input.tags !== undefined ? tagsFromProps(propsWithTags({}, input.tags)) : tagsFromProps(baseProps);
  const tagSlugs =
    pageKind === "article" && !parentId ? ensureCategoriesFromLabels(rawTags) : rawTags;
  const props =
    pageKind === "article" && !parentId
      ? propsWithTags(baseProps, tagSlugs)
      : input.tags !== undefined
        ? propsWithTags(baseProps, input.tags)
        : propsWithTags(baseProps, tagsFromProps(baseProps));

  const resolvedType =
    pageKind === "article"
      ? (tagSlugs[0] && getCategoryBySlug(tagSlugs[0])
          ? tagSlugs[0]
          : (getCategoryBySlug(input.type)?.slug ??
            (existing.type ||
              listCategories().find((c) => c.kind === "article")?.slug ||
              "life")))
      : input.type;

  db.prepare(
    `UPDATE posts SET
      slug = ?, title = ?, type = ?, page_kind = ?, parent_id = ?, tree_sort = ?,
      summary = ?, cover_url = ?, props = ?, body = ?,
      draft = ?, published_at = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    slug,
    input.title,
    resolvedType,
    pageKind,
    parentId,
    treeSort,
    input.summary,
    input.coverUrl,
    JSON.stringify(props),
    JSON.stringify(input.body),
    asDraft ? 1 : 0,
    publishedAt,
    now,
    id,
  );

  return getPostById(id);
}

function stripPageLinkFromParent(parentId: string, childId: string): void {
  const parent = getPostById(parentId);
  if (!parent) {
    return;
  }
  const blocks = parent.body.blocks ?? [];
  const next = blocks.filter(
    (block) =>
      !(
        block.type === "pageLink" &&
        String((block.data as { pageId?: string }).pageId ?? "") === childId
      ),
  );
  if (next.length === blocks.length) {
    return;
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE posts SET body = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify({ ...parent.body, time: Date.now(), blocks: next }),
    now,
    parentId,
  );
}

export function deletePost(id: string): boolean {
  const existing = getPostById(id);
  if (!existing) {
    return false;
  }
  if (existing.pageKind === "about") {
    throw new Error("PAGE_FIXED");
  }
  // 先从父文去掉入口块，再递归删子页
  if (existing.parentId) {
    stripPageLinkFromParent(existing.parentId, id);
  }
  const children = db
    .prepare("SELECT id FROM posts WHERE parent_id = ?")
    .all(id) as Array<{ id: string }>;
  for (const child of children) {
    deletePost(child.id);
  }
  const result = db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  return result.changes > 0;
}

/** 全站已用过的文章标签（去重） */
export function listAllTags(): string[] {
  const rows = db
    .prepare(`SELECT props FROM posts WHERE page_kind = 'article'`)
    .all() as Array<{ props: string }>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    let props: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.props || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    for (const tag of tagsFromProps(props)) {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(tag);
    }
  }
  return out.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function reorderPages(orderedIds: string[]): void {
  const now = new Date().toISOString();
  const update = db.prepare("UPDATE posts SET tree_sort = ?, updated_at = ? WHERE id = ?");
  const tx = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      update.run(index, now, id);
    });
  });
  tx();
}

/** 将旧数据迁成工作区页面模型 */
export function ensureWorkspacePages(): void {
  const articleCat = listCategories().find((c) => c.kind === "article");
  const defaultType = articleCat?.slug ?? "life";

  // 旧文章默认 article；清掉已废弃的 photo/photos 页
  db.prepare("DELETE FROM posts WHERE page_kind IN ('photos', 'photo')").run();
  db.prepare(
    `UPDATE posts SET page_kind = 'article'
     WHERE page_kind IS NULL OR page_kind = '' OR page_kind NOT IN ('article', 'about')`,
  ).run();
  db.prepare(
    `UPDATE posts SET type = ?
     WHERE type NOT IN (SELECT slug FROM categories)`,
  ).run(defaultType);

  // 子页面不能是草稿：旧数据一并纠正
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE posts SET draft = 0, published_at = COALESCE(published_at, ?), updated_at = ?
     WHERE parent_id IS NOT NULL AND draft = 1`,
  ).run(now, now);

  // 文章上的自定义标签 → 分类，并回写 slug
  const articleRows = db
    .prepare(
      `SELECT id, type, props FROM posts WHERE page_kind = 'article' AND parent_id IS NULL`,
    )
    .all() as Array<{ id: string; type: string; props: string }>;
  const updateArticle = db.prepare(
    `UPDATE posts SET type = ?, props = ?, updated_at = ? WHERE id = ?`,
  );
  for (const row of articleRows) {
    let props: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(row.props || "{}") as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        props = parsed as Record<string, unknown>;
      }
    } catch {
      props = {};
    }
    const raw = tagsFromProps(props);
    const labels = raw.length > 0 ? raw : row.type ? [row.type] : [];
    if (labels.length === 0) {
      continue;
    }
    const slugs = ensureCategoriesFromLabels(labels);
    const nextType = slugs[0] && getCategoryBySlug(slugs[0]) ? slugs[0] : row.type;
    updateArticle.run(nextType, JSON.stringify(propsWithTags(props, slugs)), now, row.id);
  }

  if (!getPageByKind("about")) {
    const siteRow = db.prepare("SELECT * FROM site WHERE id = 1").get() as
      | {
          about_name: string;
          about_body: string;
          about_avatar: string;
          skills: string;
        }
      | undefined;
    let body = emptyEditorDocument();
    let avatar = "";
    let skills: unknown[] = [];
    let name = "关于";
    if (siteRow) {
      name = siteRow.about_name || name;
      avatar = siteRow.about_avatar || avatar;
      try {
        skills = JSON.parse(siteRow.skills) as unknown[];
      } catch {
        skills = [];
      }
      try {
        const parsed = JSON.parse(siteRow.about_body) as EditorJsDocument;
        if (parsed?.blocks) {
          body = parsed;
        }
      } catch {
        /* keep empty */
      }
    }
    createPost({
      title: name,
      slug: `sys-about-${crypto.randomUUID().slice(0, 8)}`,
      type: defaultType,
      pageKind: "about",
      summary: "",
      coverUrl: "",
      body,
      draft: false,
      treeSort: -1,
      props: { avatar, skills },
    });
  } else {
    // 旧数据可能被 slugify 成 workspace-about，改成不可读的系统 slug
    const about = getPageByKind("about");
    if (about && (about.slug === "workspace-about" || about.slug.startsWith("workspace-"))) {
      db.prepare("UPDATE posts SET slug = ? WHERE id = ?").run(
        `sys-about-${about.id.slice(0, 8)}`,
        about.id,
      );
    }
  }

  // 文章 tree_sort 补齐
  const articles = listPosts({
    pageKind: "article",
    includeDrafts: true,
    treeOrder: true,
  }).posts;
  articles.forEach((item, index) => {
    if (item.treeSort !== index) {
      db.prepare("UPDATE posts SET tree_sort = ? WHERE id = ?").run(index, item.id);
    }
  });

  // about 正文若仍为空，从 site 回填一次
  const aboutPage = getPageByKind("about");
  if (aboutPage && (!aboutPage.body.blocks || aboutPage.body.blocks.length === 0)) {
    const siteRow = db.prepare("SELECT * FROM site WHERE id = 1").get() as
      | {
          about_name: string;
          about_body: string;
          about_avatar: string;
          skills: string;
        }
      | undefined;
    if (siteRow) {
      try {
        const parsed = JSON.parse(siteRow.about_body) as EditorJsDocument;
        if (parsed?.blocks?.length) {
          const props = {
            ...aboutPage.props,
            avatar: siteRow.about_avatar || aboutPage.props.avatar,
            skills: JSON.parse(siteRow.skills),
          };
          db.prepare("UPDATE posts SET title = ?, body = ?, props = ? WHERE id = ?").run(
            siteRow.about_name || aboutPage.title,
            JSON.stringify(parsed),
            JSON.stringify(props),
            aboutPage.id,
          );
        }
      } catch {
        /* ignore */
      }
    }
  }
}
