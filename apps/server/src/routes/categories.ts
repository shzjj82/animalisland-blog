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
import { fail, ok } from "../http.js";

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
  ok(res, { categories: listCategories() });
});

categoriesRouter.get("/:slug", (req, res) => {
  const category = getCategoryBySlug(req.params.slug);
  if (!category) {
    fail(res, "NOT_FOUND", 404);
    return;
  }
  res.set("Cache-Control", "private, no-store");
  ok(res, { category });
});

categoriesRouter.post("/", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed) {
    fail(res, "INVALID_INPUT");
    return;
  }
  try {
    ok(res, { category: createCategory(parsed) }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (
      message.startsWith("TAG_NAME_INVALID:") ||
      message.startsWith("TAG_SLUG_INVALID:") ||
      message === "TAG_NAME_EXISTS"
    ) {
      fail(res, message);
      return;
    }
    throw err;
  }
});

categoriesRouter.put("/:id", requireAuth, (req, res) => {
  const parsed = parseUpsert(req.body);
  if (!parsed) {
    fail(res, "INVALID_INPUT");
    return;
  }
  try {
    const category = updateCategory(req.params.id, parsed);
    if (!category) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, { category });
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (
      message.startsWith("TAG_NAME_INVALID:") ||
      message.startsWith("TAG_SLUG_INVALID:") ||
      message === "TAG_NAME_EXISTS"
    ) {
      fail(res, message);
      return;
    }
    throw err;
  }
});

categoriesRouter.delete("/:id", requireAuth, (req, res) => {
  try {
    if (!deleteCategory(req.params.id)) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, null);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    fail(res, message);
  }
});
