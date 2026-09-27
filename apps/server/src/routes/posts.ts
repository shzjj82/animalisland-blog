import { Router } from "express";
import type { EditorJsDocument, PageKind, PostVisibility } from "@myblog/shared";
import { decodeSlugParam, isPageKind, isVisibility, normalizeTags } from "@myblog/shared";
import { optionalAuth, requireAuth } from "../auth.js";
import { DocsError } from "../docs-client.js";
import { fail, ok } from "../http.js";
import {
  createLinkedChild,
  createPost,
  deletePost,
  getPostById,
  getPostPage,
  listPosts,
  listWorkspaceTree,
  reparentArticle,
  updatePost,
} from "../posts.js";

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
        visibility: PostVisibility;
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

function parseVisibility(raw: {
  visibility?: unknown;
  draft?: unknown;
}): PostVisibility {
  if (typeof raw.visibility === "string" && isVisibility(raw.visibility)) {
    return raw.visibility;
  }
  // 兼容旧客户端：draft true → private，false → public
  if (typeof raw.draft === "boolean") {
    return raw.draft ? "private" : "public";
  }
  return "private";
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
    visibility: rawVisibility,
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
    visibility?: string;
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
      visibility: parseVisibility({ visibility: rawVisibility, draft }),
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
      const posts = await listWorkspaceTree();
      res.set("Cache-Control", "private, no-store");
      ok(res, { posts, total: posts.length });
      return;
    }

    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const kind = req.query.kind === "article" ? ("article" as const) : undefined;
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

    const listOpts = {
      type,
      kind,
      pageKind,
      parentId,
      limit,
      page,
      pageSize,
      treeOrder: Boolean(pageKind || parentId !== undefined),
    };

    // 前台列表永远只出公开文；私有文只在工作区 / 作者打开详情时可见
    const { posts, total } = await listPosts({ ...listOpts, scope: "public" });
    res.set("Cache-Control", "public, max-age=30");
    ok(res, { posts, total, page: page ?? 1, pageSize: pageSize ?? posts.length });
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
    // 仅作者可进工作区编辑
    if (post.authorId && req.authUser?.id && post.authorId !== req.authUser.id) {
      fail(res, "FORBIDDEN", 403, "只能编辑自己的文章");
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
    const slug = decodeSlugParam(req.params.slug);
    const page = await getPostPage(slug, req.authed ? "feed" : "public");
    const post = page?.post;
    if (!post || post.pageKind !== "article") {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    // 私有文仅作者可见（feed 可能混入，再兜底）
    if (
      post.visibility === "private" &&
      (!req.authUser?.id || (post.authorId && post.authorId !== req.authUser.id))
    ) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    if (!req.authed) {
      res.set("Cache-Control", "public, max-age=60");
    }
    const viewerId = req.authUser?.id;
    ok(res, {
      post,
      ancestors: page.ancestors,
      siblings: page.siblings,
      children: page.children.filter(
        (item) =>
          item.visibility === "public" ||
          (viewerId != null && item.authorId === viewerId),
      ),
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
