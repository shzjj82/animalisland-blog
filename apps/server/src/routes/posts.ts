import { Router } from "express";
import type { EditorJsDocument, PageKind } from "@myblog/shared";
import { isPageKind, normalizeTags } from "@myblog/shared";
import { optionalAuth, requireAuth } from "../auth.js";
import { DocsError } from "../docs-client.js";
import { fail, ok } from "../http.js";
import {
  createLinkedChild,
  createPost,
  deletePost,
  getPageByKind,
  getPostById,
  getPostPage,
  listPosts,
  listWorkspaceTree,
  reparentArticle,
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
  const resolvedType = type?.trim() || "life";

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
      type: resolvedType,
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

function failDocs(res: Parameters<typeof fail>[0], err: unknown, fallback = "SERVER_ERROR"): boolean {
  if (!(err instanceof DocsError)) {
    return false;
  }
  fail(res, err.code || fallback, err.status || 400);
  return true;
}

postsRouter.get("/", optionalAuth, async (req, res, next) => {
  try {
    if (req.query.tree === "1" || req.query.tree === "true") {
      if (!req.authed) {
        fail(res, "UNAUTHORIZED", 401);
        return;
      }
      const posts = await listWorkspaceTree(true);
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
    const { posts, total } = await listPosts({
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
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});

postsRouter.get("/workspace/specials", requireAuth, async (_req, res, next) => {
  try {
    ok(res, {
      about: (await getPageByKind("about")) ?? null,
    });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});

postsRouter.get("/id/:id", requireAuth, async (req, res, next) => {
  try {
    const post = await getPostById(req.params.id);
    if (!post) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, { post });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});

postsRouter.get("/:slug", optionalAuth, async (req, res, next) => {
  try {
    const includeDrafts = Boolean(req.authed);
    const page = await getPostPage(req.params.slug, includeDrafts);
    const post = page?.post;
    if (!post || post.pageKind !== "article") {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    if (!req.authed) {
      res.set("Cache-Control", "public, max-age=60");
    }
    ok(res, {
      post,
      ancestors: page.ancestors,
      siblings: page.siblings,
      children: includeDrafts ? page.children : page.children.filter((item) => !item.draft),
    });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});

postsRouter.post("/", requireAuth, async (req, res, next) => {
  const parsed = parseUpsert(req.body);
  if (!parsed.ok) {
    fail(res, parsed.error);
    return;
  }
  try {
    const post = await createPost(parsed.value);
    if (post.pageKind === "about") {
      await syncSiteFromAboutPage(post);
    }
    ok(res, { post }, 201);
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
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
    next(err);
  }
});

/** 侧栏建子页：创建子页 + 父文 pageLink，避免与打开中的编辑器竞态冲掉链接 */
postsRouter.post("/id/:id/children", requireAuth, async (req, res, next) => {
  try {
    const { child, parent } = await createLinkedChild(req.params.id);
    ok(res, { post: child, parent }, 201);
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "INVALID_PARENT" || message === "INVALID_CATEGORY" || message === "PAGE_EXISTS") {
      fail(res, message);
      return;
    }
    next(err);
  }
});

/** 把任意文章挂到当前文章下（或 body.parentId=null 移回顶层） */
postsRouter.put("/id/:id/parent", requireAuth, async (req, res, next) => {
  const raw = (req.body ?? {}) as { parentId?: string | null };
  const parentId = raw.parentId === undefined ? null : raw.parentId;
  if (parentId !== null && (typeof parentId !== "string" || !parentId.trim())) {
    fail(res, "INVALID_INPUT");
    return;
  }
  try {
    const result = await reparentArticle(req.params.id, parentId);
    ok(res, result);
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "INVALID_PARENT" || message === "NOT_FOUND") {
      fail(res, message, message === "NOT_FOUND" ? 404 : 400);
      return;
    }
    next(err);
  }
});

postsRouter.put("/:id", requireAuth, async (req, res, next) => {
  const parsed = parseUpsert(req.body);
  if (!parsed.ok) {
    fail(res, parsed.error);
    return;
  }
  try {
    const post = await updatePost(req.params.id, parsed.value);
    if (!post) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    if (post.pageKind === "about") {
      await syncSiteFromAboutPage(post);
    }
    ok(res, { post });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "INVALID_CATEGORY" || message === "PAGE_KIND_FIXED" || message === "EMPTY_BODY" || message === "INVALID_PARENT") {
      fail(res, message);
      return;
    }
    next(err);
  }
});

postsRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!(await deletePost(req.params.id))) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, null);
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "PAGE_FIXED") {
      fail(res, message);
      return;
    }
    next(err);
  }
});
