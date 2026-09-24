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
import { DocsError } from "../docs-client.js";
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

function failDocs(res: Parameters<typeof fail>[0], err: unknown): boolean {
  if (!(err instanceof DocsError)) {
    return false;
  }
  fail(res, err.code, err.status || 400);
  return true;
}

categoriesRouter.get("/", async (_req, res, next) => {
  try {
    res.set("Cache-Control", "private, no-store");
    ok(res, { categories: await listCategories() });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});

categoriesRouter.get("/:slug", async (req, res, next) => {
  try {
    const category = await getCategoryBySlug(req.params.slug);
    if (!category) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    res.set("Cache-Control", "private, no-store");
    ok(res, { category });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});

categoriesRouter.post("/", requireAuth, async (req, res, next) => {
  const parsed = parseUpsert(req.body);
  if (!parsed) {
    fail(res, "INVALID_INPUT");
    return;
  }
  try {
    ok(res, { category: await createCategory(parsed) }, 201);
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (
      message.startsWith("TAG_NAME_INVALID:") ||
      message.startsWith("TAG_SLUG_INVALID:") ||
      message === "TAG_NAME_EXISTS"
    ) {
      fail(res, message);
      return;
    }
    next(err);
  }
});

categoriesRouter.put("/:id", requireAuth, async (req, res, next) => {
  const parsed = parseUpsert(req.body);
  if (!parsed) {
    fail(res, "INVALID_INPUT");
    return;
  }
  try {
    const category = await updateCategory(req.params.id, parsed);
    if (!category) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, { category });
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : "SERVER_ERROR";
    if (
      message.startsWith("TAG_NAME_INVALID:") ||
      message.startsWith("TAG_SLUG_INVALID:") ||
      message === "TAG_NAME_EXISTS"
    ) {
      fail(res, message);
      return;
    }
    next(err);
  }
});

categoriesRouter.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    if (!(await deleteCategory(req.params.id))) {
      fail(res, "NOT_FOUND", 404);
      return;
    }
    ok(res, null);
  } catch (err) {
    if (failDocs(res, err)) {
      return;
    }
    next(err);
  }
});
