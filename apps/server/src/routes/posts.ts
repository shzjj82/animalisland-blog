import { Router } from "express";
import { isPostType, type EditorJsDocument, type PostType } from "@myblog/shared";
import { optionalAuth, requireAuth } from "../auth.js";
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
        type: PostType;
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

  if (!title?.trim() || !type || !isPostType(type)) {
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
  const posts = listPosts({
    type,
    includeDrafts: Boolean(req.authed),
  });
  res.json({ posts });
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
