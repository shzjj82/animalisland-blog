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
import { ensureCategoriesFromLabels, getCategoryBySlug, listCategories, listCategorySlugs, resolveExistingCategorySlugs } from "./categories.js";
import { db, getSchemaMeta, setSchemaMeta } from "./db.js";

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

function bodyHasBlocks(body: EditorJsDocument): boolean {
  return (body.blocks?.length ?? 0) > 0;
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

type AncestorRow = {
  id: string;
  parent_id: string | null;
  draft: number;
};

/** 轻量祖先索引：避免 hasDraftAncestor 每次 getPostById 解析整篇 body */
function loadAncestorIndex(): Map<string, AncestorRow> {
  const rows = db
    .prepare("SELECT id, parent_id, draft FROM posts")
    .all() as AncestorRow[];
  return new Map(rows.map((row) => [row.id, row]));
}

/** 子页没有独立草稿：若任一祖先是草稿，前台当作不可见 */
function hasDraftAncestor(postId: string, index?: Map<string, AncestorRow>): boolean {
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
  // 仅绑定已有分类；新建分类走分类管理 / 发布弹窗的显式创建
  const tagSlugs =
    pageKind === "article" && !parentId ? resolveExistingCategorySlugs(rawTags) : rawTags;

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
    pageKind === "article" && !parentId ? resolveExistingCategorySlugs(rawTags) : rawTags;
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

  // 防止空 autosave / 竞态把已有正文冲成空文档
  if (!bodyHasBlocks(input.body) && bodyHasBlocks(existing.body)) {
    throw new Error("EMPTY_BODY");
  }

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

/** 在父文正文末尾挂上子页入口（幂等）；用于侧栏建子页，避免 get→改→put 竞态 */
export function appendPageLinkToParent(
  parentId: string,
  child: Pick<Post, "id" | "slug" | "title">,
): Post | undefined {
  const parent = getPostById(parentId);
  if (!parent || parent.pageKind !== "article") {
    return undefined;
  }
  const blocks = [...(parent.body.blocks ?? [])];
  const exists = blocks.some(
    (block) =>
      block.type === "pageLink" &&
      String((block.data as { pageId?: string }).pageId ?? "") === child.id,
  );
  if (exists) {
    return parent;
  }
  const title = child.title?.trim() && child.title !== "无标题" ? child.title : "无标题";
  const nextBody: EditorJsDocument = {
    ...parent.body,
    time: Date.now(),
    blocks: [
      ...blocks,
      {
        type: "pageLink",
        data: { pageId: child.id, slug: child.slug, title },
      },
    ],
  };
  const now = new Date().toISOString();
  db.prepare("UPDATE posts SET body = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(nextBody),
    now,
    parentId,
  );
  return getPostById(parentId);
}

/** 建子页并在同一事务里写入父文 pageLink */
export function createLinkedChild(parentId: string): { child: Post; parent: Post } {
  const run = db.transaction(() => {
    const parent = getPostById(parentId);
    if (!parent || parent.pageKind !== "article") {
      throw new Error("INVALID_PARENT");
    }
    const child = createPost({
      title: "无标题",
      type: parent.type,
      pageKind: "article",
      parentId,
      summary: "",
      coverUrl: "",
      body: emptyEditorDocument(),
      draft: false,
    });
    const nextParent = appendPageLinkToParent(parentId, child);
    if (!nextParent) {
      throw new Error("INVALID_PARENT");
    }
    return { child, parent: nextParent };
  });
  return run();
}

export function deletePost(id: string): boolean {
  const run = db.transaction((rootId: string) => {
    const existing = getPostById(rootId);
    if (!existing) {
      return false;
    }
    if (existing.pageKind === "about") {
      throw new Error("PAGE_FIXED");
    }

    const collect = (pageId: string): string[] => {
      const kids = db.prepare("SELECT id FROM posts WHERE parent_id = ?").all(pageId) as Array<{ id: string }>;
      return [pageId, ...kids.flatMap((kid) => collect(kid.id))];
    };
    const ids = collect(rootId);

    if (existing.parentId) {
      stripPageLinkFromParent(existing.parentId, rootId);
    }

    const del = db.prepare("DELETE FROM posts WHERE id = ?");
    // 先删子孙再删根，避免中间态孤儿引用
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      del.run(ids[i]);
    }
    return true;
  });
  return run(id);
}

/** 将旧数据迁成工作区页面模型（重活只跑一次） */
export function ensureWorkspacePages(): void {
  const articleCat = listCategories().find((c) => c.kind === "article");
  const defaultType = articleCat?.slug ?? "life";
  const migrated = getSchemaMeta("workspace_migrated_v2") === "1";

  if (!migrated) {
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

    // 文章上的自定义标签 → 分类，并回写 slug（仅迁移期允许建类）
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
  } else if (!migrated) {
    const about = getPageByKind("about");
    if (about && (about.slug === "workspace-about" || about.slug.startsWith("workspace-"))) {
      db.prepare("UPDATE posts SET slug = ? WHERE id = ?").run(
        `sys-about-${about.id.slice(0, 8)}`,
        about.id,
      );
    }
  }

  if (!migrated) {
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

    setSchemaMeta("workspace_migrated_v2", "1");
  }
}
