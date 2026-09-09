import { Router } from "express";
import { isCategoryKind, isSiteSkillColor, type UpsertCategoryInput } from "@myblog/shared";
import { requireAuth } from "../auth.js";
import {
  createCategory,
  deleteCategory,
  getCategoryBySlug,
  listCategories,
  updateCategory,
} from "../categories.js";

export const categoriesRouter = Router();

function parseUpsert(raw: unknown): UpsertCategoryInput | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const body = raw as {
    slug?: unknown;
    name?: unknown;
    hint?: unknown;
    color?: unknown;
    kind?: unknown;
    nav?: unknown;
    sort?: unknown;
  };
  if (typeof body.name !== "string" || !body.name.trim()) {
    return null;
  }
  if (typeof body.color !== "string" || !isSiteSkillColor(body.color)) {
    return null;
  }
  if (typeof body.kind !== "string" || !isCategoryKind(body.kind)) {
    return null;
  }
  return {
    name: body.name,
    slug: typeof body.slug === "string" ? body.slug : undefined,
    hint: typeof body.hint === "string" ? body.hint : "",
    color: body.color,
    kind: body.kind,
    nav: body.nav === false ? false : true,
    sort: typeof body.sort === "number" ? body.sort : undefined,
  };
}

categoriesRouter.get("/", (_req, res) => {
  // 管理端会改排序/显隐，不能公共缓存，否则上移下移后仍读到旧列表
  res.set("Cache-Control", "private, no-store");
  res.json({ categories: listCategories() });
});

categoriesRouter.get("/:slug", (req, res) => {
  const category = getCategoryBySlug(req.params.slug);
  if (!category) {
    res.status(404).json({ error: "NOT_FOUND" });
    return;
  }
  res.set("Cache-Control", "private, no-store");
  res.json({ category });
});

categoriesRouter.post("/", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed) {
    res.status(400).json({ error: "INVALID_INPUT" });
    return;
  }
  try {
    res.status(201).json({ category: createCategory(parsed) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "PHOTOS_EXISTS") {
      res.status(400).json({ error: message });
      return;
    }
    throw err;
  }
});

categoriesRouter.put("/:id", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed) {
    res.status(400).json({ error: "INVALID_INPUT" });
    return;
  }
  try {
    const category = updateCategory(req.params.id, parsed);
    if (!category) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.json({ category });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "PHOTOS_EXISTS") {
      res.status(400).json({ error: message });
      return;
    }
    throw err;
  }
});

categoriesRouter.delete("/:id", requireAuth, (req, res) => {
  try {
    if (!deleteCategory(req.params.id)) {
      res.status(404).json({ error: "NOT_FOUND" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (message === "CATEGORY_IN_USE" || message === "LAST_ARTICLE_CATEGORY" || message === "PHOTOS_FIXED") {
      res.status(400).json({ error: message });
      return;
    }
    throw err;
  }
});
