import { Router } from "express";
import type { EditorJsDocument } from "@myblog/shared";
import { optionalAuth, requireAuth } from "../auth.js";
import { getCategoryBySlug } from "../categories.js";
import {
  createPost,
  deletePost,
  getPostById,
  getPostBySlug,
  listPosts,
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
        summary: string;
        coverUrl: string;
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
  const { title, slug, type, summary, coverUrl, body, draft } = (raw ?? {}) as {
    title?: string;
    slug?: string;
    type?: string;
    summary?: string;
    coverUrl?: string;
    body?: unknown;
    draft?: boolean;
  };

  if (!title?.trim() || !type || !getCategoryBySlug(type)) {
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
      type,
      summary: summary?.trim() ?? "",
      coverUrl: coverUrl?.trim() ?? "",
      body: doc,
      draft: draft ?? true,
    },
  };
}

postsRouter.get("/", optionalAuth, (req, res) => {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const kind = req.query.kind === "article" || req.query.kind === "photos" ? req.query.kind : undefined;
  const parsedLimit = Number(req.query.limit);
  const limit = Number.isFinite(parsedLimit) ? parsedLimit : undefined;
  const parsedPage = Number(req.query.page);
  const parsedPageSize = Number(req.query.pageSize);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : undefined;
  const pageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : undefined;
  const { posts, total } = listPosts({
    type,
    kind,
    limit,
    page,
    pageSize,
    includeDrafts: Boolean(req.authed),
  });
  if (!req.authed) {
    res.set("Cache-Control", "public, max-age=30");
  }
  res.json({ posts, total, page: page ?? 1, pageSize: pageSize ?? posts.length });
});

postsRouter.get("/id/:id", requireAuth, (req, res) => {
  const post = getPostById(req.params.id);
  if (!post) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.json({ post });
});

postsRouter.get("/:slug", optionalAuth, (req, res) => {
  const post = getPostBySlug(req.params.slug, Boolean(req.authed));
  if (!post) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  if (!req.authed) {
    res.set("Cache-Control", "public, max-age=60");
  }
  res.json({ post });
});

postsRouter.post("/", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const post = createPost(parsed.value);
  res.status(201).json({ post });
});

postsRouter.put("/:id", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  const post = updatePost(req.params.id, parsed.value);
  if (!post) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.json({ post });
});

postsRouter.delete("/:id", requireAuth, (req, res) => {
  if (!deletePost(req.params.id)) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.json({ ok: true });
});
