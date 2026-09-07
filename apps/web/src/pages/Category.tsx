import { useParams } from "react-router-dom";
import { BlogShell } from "@/components/BlogShell";
import { useCategories } from "@/lib/categories";
import { NotFoundPage } from "@/pages/NotFound";
import { PhotosPage } from "@/pages/Photos";
import { PostListPage } from "@/pages/PostList";

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

  if (!category) {
    return <NotFoundPage />;
  }

  if (category.kind === "photos") {
    return <PhotosPage category={category} />;
  }

  return <PostListPage category={category} />;
}
