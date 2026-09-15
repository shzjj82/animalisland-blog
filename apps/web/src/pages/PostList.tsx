import type { Category } from "@myblog/shared";
import { useEffect } from "react";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { Seo } from "@/components/Seo";
import { usePublishedArticles } from "@/lib/usePublishedArticles";

export function PostListPage({ category }: { category: Category }) {
  const { posts, error } = usePublishedArticles({ type: category.slug });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [category.slug]);

  return (
    <BlogShell>
      <Seo title={category.name} description={category.hint || `${category.name}相关笔记`} path={`/${category.slug}`} />
      <section className="blog-section post-list">
        <h1 className="blog-section-title">{category.name}</h1>
        <p className="blog-section-sub">{category.hint || "这一分类下的笔记。"}</p>
        {error ? <p className="blog-section-sub">{error}</p> : null}
        {!error ? (
          <PostCards posts={posts} empty={`还没有归到「${category.name}」的笔记。`} />
        ) : null}
      </section>
    </BlogShell>
  );
}
