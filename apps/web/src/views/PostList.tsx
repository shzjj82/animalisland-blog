"use client";

import type { Category, PostListItem } from "@myblog/shared";
import { useEffect } from "react";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { Seo } from "@/components/Seo";

export function PostListPage({
  category,
  initialPosts,
}: {
  category: Category;
  initialPosts: PostListItem[];
}) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [category.slug]);

  return (
    <BlogShell>
      <Seo title={category.name} description={category.hint || `${category.name}相关笔记`} path={`/${category.slug}`} />
      <section className="blog-section post-list">
        <h1 className="blog-section-title">{category.name}</h1>
        <p className="blog-section-sub">{category.hint || "这一分类下的笔记。"}</p>
        <PostCards posts={initialPosts} empty={`还没有归到「${category.name}」的笔记。`} />
      </section>
    </BlogShell>
  );
}
