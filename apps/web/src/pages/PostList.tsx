import { POST_TYPE_LABEL, type ArticleType, type PostListItem } from "@myblog/shared";
import { useEffect, useState } from "react";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { api } from "@/lib/api";

const copy: Record<ArticleType, { title: string; sub: string }> = {
  life: { title: "生活", sub: "日常里碰到的、想留下来的。" },
  coding: { title: "编程", sub: "卡住的问题、试过的办法。" },
  chat: { title: "闲聊", sub: "想到就记一笔，不必正经。" },
};

export function PostListPage({ type }: { type: ArticleType }) {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setError("");
    void api
      .listPosts(type)
      .then((data) => setPosts(data.posts))
      .catch(() => {
        setPosts([]);
        setError("文章暂时读不出来。");
      });
  }, [type]);

  return (
    <BlogShell>
      <section className="blog-section post-list">
        <h2 className="blog-section-title">{copy[type].title}</h2>
        <p className="blog-section-sub">{copy[type].sub}</p>
        {error ? <p className="blog-section-sub">{error}</p> : null}
        {!error ? (
          <PostCards posts={posts} empty={`这一栏还是空的。去写作台发一篇「${POST_TYPE_LABEL[type]}」吧。`} />
        ) : null}
      </section>
    </BlogShell>
  );
}
