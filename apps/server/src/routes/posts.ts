import { Router } from "express";
import type { EditorJsDocument, PageKind } from "@myblog/shared";
import { isPageKind, normalizeTags } from "@myblog/shared";
import { optionalAuth, requireAuth } from "../auth.js";
import { listCategories } from "../categories.js";
import { fail, ok } from "../http.js";
import {
  createLinkedChild,
  createPost,
  deletePost,
  getPageByKind,
  getPostById,
  getPostBySlug,
  listAllTags,
  listAncestors,
  listPosts,
  listWorkspaceTree,
  reorderPages,
  updatePost,
} from "../posts.js";
import { syncSiteFromAboutPage } from "../site.js";

export const postsRouter = Router();

type ParsedUpsert =
  | {
      ok: true;
      value: {
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
    }
  | { ok: false; error: "INVALID_INPUT" | "INVALID_BODY" };

function readBody(input: unknown): EditorJsDocument | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const doc = input as EditorJsDocument;
  if (!Array.isArray(doc.blocks)) {
    return null;
  }
  return doc;
}

function defaultTypeForKind(_pageKind: PageKind): string {
  return listCategories().find((c) => c.kind === "article")?.slug ?? "life";
}

function parseUpsert(raw: unknown): ParsedUpsert {
  const {
    title,
    slug,
    type,
    pageKind: rawKind,
    parentId,
    treeSort,
    summary,
    coverUrl,
    props,
    tags,
    body,
    draft,
  } = (raw ?? {}) as {
    title?: string;
    slug?: string;
    type?: string;
    pageKind?: string;
    parentId?: string | null;
    treeSort?: number;
    summary?: string;
    coverUrl?: string;
    props?: Record<string, unknown>;
    tags?: unknown;
    body?: unknown;
    draft?: boolean;
  };

  const pageKind = typeof rawKind === "string" && isPageKind(rawKind) ? rawKind : undefined;
  const resolvedType = type?.trim() || (pageKind ? defaultTypeForKind(pageKind) : defaultTypeForKind("article"));

  if (!title?.trim()) {
    return { ok: false, error: "INVALID_INPUT" };
  }
  const doc = readBody(body);
  if (!doc) {
    return { ok: false, error: "INVALID_BODY" };
  }

  return {
    ok: true,
    value: {
      title: title.trim(),
      slug,
      type: resolvedType || defaultTypeForKind(pageKind ?? "article"),
      pageKind,
      parentId: parentId === undefined ? undefined : parentId,
      treeSort: typeof treeSort === "number" ? treeSort : undefined,
      summary: summary?.trim() ?? "",
      coverUrl: coverUrl?.trim() ?? "",
      props: props && typeof props === "object" ? props : undefined,
      tags: tags === undefined ? undefined : normalizeTags(tags),
      body: doc,
      draft: draft ?? true,
    },
  };
}

postsRouter.get("/", optionalAuth, (req, res) => {
  if (req.query.tree === "1" || req.query.tree === "true") {
    if (!req.authed) {
      fail(res, "UNAUTHORIZED", 401);
      return;
    }
    const posts = listWorkspaceTree(true);
    ok(res, { posts, total: posts.length });
    return;
  }

  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const kind = req.query.kind === "article" ? req.query.kind : undefined;
  const pageKind =
    typeof req.query.pageKind === "string" && isPageKind(req.query.pageKind)
      ? req.query.pageKind
      : undefined;
  const parentId =
    req.query.parentId === "null"
      ? null
      : typeof req.query.parentId === "string"
        ? req.query.parentId
        : undefined;
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
  const parsedPage = Number(req.query.page);
  const parsedPageSize = Number(req.query.pageSize);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : undefined;
  const pageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : undefined;
  const { posts, total } = listPosts({
    type,
    kind,
    pageKind,
    parentId,
    limit,
    page,
    pageSize,
    includeDrafts: Boolean(req.authed),
    treeOrder: Boolean(pageKind || parentId !== undefined),
  });
  if (!req.authed) {
    res.set("Cache-Control", "public, max-age=30");
  }
  ok(res, { posts, total, page: page ?? 1, pageSize: pageSize ?? posts.length });
});

postsRouter.get("/workspace/specials", requireAuth, (_req, res) => {
  ok(res, {
    about: getPageByKind("about") ?? null,
  });
});

postsRouter.get("/tags", optionalAuth, (_req, res) => {
  ok(res, { tags: listAllTags() });
});

postsRouter.post("/reorder", requireAuth, (req, res) => {
  const ids = (req.body as { ids?: unknown })?.ids;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    fail(res, "INVALID_INPUT");
    return;
  }
  reorderPages(ids);
  ok(res, null);
});

postsRouter.get("/id/:id", requireAuth, (req, res) => {
  const post = getPostById(req.params.id);
  if (!post) {
    fail(res, "NOT_FOUND", 404);
    return;
  }
  ok(res, { post });
});

postsRouter.get("/:slug", optionalAuth, (req, res) => {
  const includeDrafts = Boolean(req.authed);
  const post = getPostBySlug(req.params.slug, includeDrafts);
  // 前台 /post/:slug 只服务普通文章；about 走工作区
  if (!post || post.pageKind !== "article") {
    fail(res, "NOT_FOUND", 404);
    return;
  }
  if (!req.authed) {
    res.set("Cache-Control", "public, max-age=60");
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
  ok(res, {
    post,
    ancestors,
    siblings,
    children: includeDrafts ? children : children.filter((item) => !item.draft),
  });
});

postsRouter.post("/", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed.ok) {
    fail(res, parsed.error);
    return;
  }
  try {
    const post = createPost(parsed.value);
    if (post.pageKind === "about") {
      syncSiteFromAboutPage(post);
    }
    ok(res, { post }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (
      message === "PAGE_EXISTS" ||
      message === "INVALID_PARENT" ||
      message === "INVALID_CATEGORY" ||
      message === "PAGE_KIND_FIXED"
    ) {
      fail(res, message);
      return;
    }
    throw err;
  }
});

/** 侧栏建子页：创建子页 + 父文 pageLink，避免与打开中的编辑器竞态冲掉链接 */
postsRouter.post("/id/:id/children", requireAuth, (req, res) => {
  try {
    const { child, parent } = createLinkedChild(req.params.id);
    ok(res, { post: child, parent }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "INVALID_PARENT" || message === "INVALID_CATEGORY" || message === "PAGE_EXISTS") {
      fail(res, message);
      return;
    }
    throw err;
  }
});

postsRouter.put("/:id", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed.ok) {
    fail(res, parsed.error);
    return;
  }
  try {
    const post = updatePost(req.params.id, parsed.value);
    if (!post) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    if (post.pageKind === "about") {
      syncSiteFromAboutPage(post);
    }
    ok(res, { post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "INVALID_CATEGORY" || message === "PAGE_KIND_FIXED" || message === "EMPTY_BODY") {
      fail(res, message);
      return;
    }
    throw err;
  }
});

postsRouter.delete("/:id", requireAuth, (req, res) => {
  try {
    if (!deletePost(req.params.id)) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "PAGE_FIXED") {
      fail(res, message);
      return;
    }
    throw err;
  }
});
