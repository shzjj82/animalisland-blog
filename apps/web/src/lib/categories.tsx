import type { Category } from "@myblog/shared";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

type CategoriesContextValue = {
  categories: Category[];
  articleCategories: Category[];
  /** 前台导航：文章分类按 sort，照片墙固定在文章分类之后、「关于」之前 */
  navCategories: Category[];
  photosCategory: Category | undefined;
  loading: boolean;
  reload: () => Promise<void>;
};

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

function buildNavCategories(categories: Category[]): Category[] {
  const articles = categories
    .filter((item) => item.kind === "article" && item.nav)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-CN"));
  const photos = categories.find((item) => item.kind === "photos" && item.nav);
  return photos ? [...articles, photos] : articles;
}

export function CategoriesProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const data = await api.listCategories();
      setCategories(data.categories);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const value = useMemo<CategoriesContextValue>(
    () => ({
      categories,
      articleCategories: categories
        .filter((item) => item.kind === "article")
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-CN")),
      navCategories: buildNavCategories(categories),
      photosCategory: categories.find((item) => item.kind === "photos"),
      loading,
      reload,
    }),
    [categories, loading],
  );

  return <CategoriesContext.Provider value={value}>{children}</CategoriesContext.Provider>;
}

export function useCategories() {
  const ctx = useContext(CategoriesContext);
  if (!ctx) {
    throw new Error("useCategories 需要包在 CategoriesProvider 里");
  }
  return ctx;
}
