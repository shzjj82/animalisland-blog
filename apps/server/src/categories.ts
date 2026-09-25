/**
 * 分类后端门面：按 CONTENT_BACKEND 选择本地 SQLite 或远程 docs API。
 */
import type { Category, CategoryKind, UpsertCategoryInput } from "@myblog/shared";
import { loadCategories } from "./content-backend.js";

export async function listCategories(): Promise<Category[]> {
  return (await loadCategories()).listCategories();
}

export async function listCategorySlugs(kind: CategoryKind): Promise<string[]> {
  return (await loadCategories()).listCategorySlugs(kind);
}

export async function getCategoryBySlug(slug: string): Promise<Category | undefined> {
  return (await loadCategories()).getCategoryBySlug(slug);
}

export async function createCategory(input: UpsertCategoryInput): Promise<Category> {
  return (await loadCategories()).createCategory(input);
}

export async function updateCategory(
  id: string,
  input: UpsertCategoryInput,
): Promise<Category | undefined> {
  return (await loadCategories()).updateCategory(id, input);
}

export async function deleteCategory(id: string): Promise<boolean> {
  return (await loadCategories()).deleteCategory(id);
}

export async function ensureDefaultCategories(): Promise<void> {
  (await loadCategories()).ensureDefaultCategories();
}
