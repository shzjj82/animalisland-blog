import type { PostListItem } from "@myblog/shared";
import { useEffect, useMemo, useState } from "react";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { Seo } from "@/components/Seo";
import { TypeChips } from "@/components/TypeChips";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";

/** 顶层文章列表；可用分类筛选；子文从主文链接进入 */
export function NotesPage() {
  const { articleCategories } = useCategories();
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [filter, setFilter] = useState<string | "all">("all");
  const [error, setError] = useState("");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setError("");
    void api
      .listPosts({ pageKind: "article", parentId: null })
      .then((data) => setPosts(data.posts.filter((item) => !item.draft)))
      .catch(() => {
        setPosts([]);
        setError("文章暂时读不出来。");
      });
  }, []);

  const visible = useMemo(() => {
    if (filter === "all") {
      return posts;
    }
    return posts.filter((item) => item.type === filter || item.tags.includes(filter));
  }, [posts, filter]);

  const usedCategories = useMemo(() => {
    const used = new Set<string>();
    for (const post of posts) {
      used.add(post.type);
      for (const tag of post.tags) {
        used.add(tag);
      }
    }
    return articleCategories.filter((item) => used.has(item.slug));
  }, [posts, articleCategories]);

  return (
    <BlogShell>
      <Seo title="笔记" description="小岛上写下的文章" path="/notes" />
      <section className="blog-section post-list">
        <h1 className="blog-section-title">笔记</h1>
        <p className="blog-section-sub">点开一篇慢慢读。有子页面时会在文末列出。</p>
        {usedCategories.length > 0 ? (
          <TypeChips
            className="mb-5"
            includeAll
            categories={usedCategories}
            value={filter}
            onChange={setFilter}
          />
        ) : null}
        {error ? <p className="blog-section-sub">{error}</p> : null}
        {!error ? <PostCards posts={visible} empty="还没有公开笔记。" /> : null}
      </section>
    </BlogShell>
  );
}
