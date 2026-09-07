import type { Category } from "@myblog/shared";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

type CategoriesContextValue = {
  categories: Category[];
  articleCategories: Category[];
  navCategories: Category[];
  loading: boolean;
  reload: () => Promise<void>;
};

const CategoriesContext = createContext<CategoriesContextValue | null>(null);

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
      articleCategories: categories.filter((item) => item.kind === "article"),
      navCategories: categories.filter((item) => item.nav),
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
