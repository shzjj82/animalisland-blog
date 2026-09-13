import type { Category, PostListItem } from "@myblog/shared";
import { useEffect, useState } from "react";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { Seo } from "@/components/Seo";
import { api } from "@/lib/api";

export function PostListPage({ category }: { category: Category }) {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setError("");
    void api
      .listPosts({ type: category.slug, pageKind: "article", parentId: null })
      .then((data) => setPosts(data.posts.filter((item) => !item.draft)))
      .catch(() => {
        setPosts([]);
        setError("文章暂时读不出来。");
      });
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
