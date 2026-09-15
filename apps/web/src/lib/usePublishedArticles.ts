import type { PostListItem } from "@myblog/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

/** 前台已发布顶层文章列表（Home / Notes / 分类页共用） */
export function usePublishedArticles(opts?: { type?: string }) {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void api
      .listPosts({
        pageKind: "article",
        parentId: null,
        ...(opts?.type ? { type: opts.type } : {}),
      })
      .then((data) => {
        if (!cancelled) {
          setPosts(data.posts.filter((item) => !item.draft));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPosts([]);
          setError("文章暂时读不出来。");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [opts?.type]);

  return { posts, error, loading };
}
