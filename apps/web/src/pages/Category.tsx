import { Navigate, useParams } from "react-router-dom";
import { BlogShell } from "@/components/BlogShell";
import { useCategories } from "@/lib/categories";
import { NotFoundPage } from "@/pages/NotFound";
import { PostListPage } from "@/pages/PostList";

/** 分类路径：按发布时选的分类筛选顶层文章 */
export function CategoryPage() {
  const { slug = "" } = useParams();
  const { categories, loading } = useCategories();
  const category = categories.find((item) => item.slug === slug);

  if (loading) {
    return (
      <BlogShell>
        <div className="route-fallback" />
      </BlogShell>
    );
  }

  if (category?.kind === "article") {
    return <PostListPage category={category} />;
  }

  if (!category) {
    return <NotFoundPage />;
  }

  return <Navigate to="/notes" replace />;
}
