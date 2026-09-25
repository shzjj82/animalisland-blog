import type { Category, CategoryKind, UpsertCategoryInput } from "@myblog/shared";
import { DocsError, docsRequest } from "./docs-client.js";

export async function listCategories(): Promise<Category[]> {
  const data = await docsRequest<{ categories: Category[] }>("GET", "/docs/categories");
  return data.categories;
}

export async function listCategorySlugs(kind: CategoryKind): Promise<string[]> {
  return (await listCategories())
    .filter((item) => item.kind === kind)
    .map((item) => item.slug);
}

export async function getCategoryBySlug(slug: string): Promise<Category | undefined> {
  try {
    const data = await docsRequest<{ category: Category }>(
      "GET",
      `/docs/categories/${encodeURIComponent(slug)}`,
    );
    return data.category;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function createCategory(input: UpsertCategoryInput): Promise<Category> {
  const data = await docsRequest<{ category: Category }>("POST", "/docs/categories", { body: input });
  return data.category;
}

export async function updateCategory(
  id: string,
  input: UpsertCategoryInput,
): Promise<Category | undefined> {
  try {
    const data = await docsRequest<{ category: Category }>(
      "PUT",
      `/docs/categories/${encodeURIComponent(id)}`,
      { body: input },
    );
    return data.category;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return undefined;
    }
    throw err;
  }
}

export async function deleteCategory(id: string): Promise<boolean> {
  try {
    await docsRequest<null>("DELETE", `/docs/categories/${encodeURIComponent(id)}`);
    return true;
  } catch (err) {
    if (err instanceof DocsError && err.status === 404) {
      return false;
    }
    throw err;
  }
}

export function ensureDefaultCategories(): void {}
