import type { Category } from "@myblog/shared";

const CATEGORIES_TTL_MS = 60_000;

let listCache: { at: number; data: Category[] } | null = null;
const bySlugCache = new Map<string, { at: number; data: Category | null }>();

export function invalidateCategoriesCache(): void {
  listCache = null;
  bySlugCache.clear();
}

export async function withCategoriesListCache(
  loader: () => Promise<Category[]>,
): Promise<Category[]> {
  const now = Date.now();
  if (listCache && now - listCache.at < CATEGORIES_TTL_MS) {
    return listCache.data;
  }
  const data = await loader();
  listCache = { at: now, data };
  return data;
}

export async function withCategorySlugCache(
  slug: string,
  loader: () => Promise<Category | null>,
): Promise<Category | null> {
  const now = Date.now();
  const hit = bySlugCache.get(slug);
  if (hit && now - hit.at < CATEGORIES_TTL_MS) {
    return hit.data;
  }
  const data = await loader();
  bySlugCache.set(slug, { at: now, data });
  return data;
}
