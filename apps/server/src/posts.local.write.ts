import crypto from "node:crypto";
import type { EditorJsDocument, PageKind, Post } from "@myblog/shared";
import { starterArticleDocument, propsWithTags, tagsFromProps } from "@myblog/shared";
import {
  ensureCategoriesFromLabels,
  getCategoryBySlug,
  listCategories,
  resolveExistingCategorySlugs,
} from "./categories.local.js";
import { db } from "./db.js";
import {
  bodyHasBlocks,
  nextTreeSort,
  toPost,
  uniqueSlug,
  type PostRow,
} from "./posts.local.shared.js";
import { getPageByKind, getPostById } from "./posts.local.read.js";

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
      body: starterArticleDocument(),
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

/**
 * 把任意文章挂到另一篇文章下（或移回顶层）。
 * 会同步旧/新父文里的 pageLink，并避免成环。
 */
export function reparentArticle(
  childId: string,
  newParentId: string | null,
): { child: Post; oldParent: Post | null; newParent: Post | null } {
  const run = db.transaction(() => {
    const child = getPostById(childId);
    if (!child || child.pageKind !== "article") {
      throw new Error("NOT_FOUND");
    }

    const resolvedParentId = resolveArticleParent(newParentId);
    if (resolvedParentId && wouldCreateCycle(childId, resolvedParentId)) {
      throw new Error("INVALID_PARENT");
    }
    if ((child.parentId ?? null) === resolvedParentId) {
      return {
        child,
        oldParent: child.parentId ? getPostById(child.parentId) ?? null : null,
        newParent: resolvedParentId ? getPostById(resolvedParentId) ?? null : null,
      };
    }

    const oldParentId = child.parentId;
    if (oldParentId) {
      stripPageLinkFromParent(oldParentId, childId);
    }

    const now = new Date().toISOString();
    const treeSort = nextTreeSort(resolvedParentId, "article");
    // 挂到父页下后不再当草稿；回到顶层则保持原草稿状态
    const asDraft = resolvedParentId ? false : child.draft;
    let publishedAt = child.publishedAt;
    if (!asDraft && !publishedAt) {
      publishedAt = now;
    }

    db.prepare(
      `UPDATE posts SET parent_id = ?, tree_sort = ?, draft = ?, published_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(resolvedParentId, treeSort, asDraft ? 1 : 0, publishedAt, now, childId);

    const updatedChild = getPostById(childId)!;
    let newParent: Post | null = null;
    if (resolvedParentId) {
      newParent = appendPageLinkToParent(resolvedParentId, updatedChild) ?? null;
    }

    return {
      child: updatedChild,
      oldParent: oldParentId ? getPostById(oldParentId) ?? null : null,
      newParent,
    };
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
