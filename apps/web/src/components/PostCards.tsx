import type { PostListItem } from "@myblog/shared";
import { Card } from "animal-island-ui";
import { Link } from "react-router-dom";

function prefetchPostPage() {
  void import("@/pages/Post/Post");
}

export function PostCards({ posts, empty }: { posts: PostListItem[]; empty: string }) {
  if (posts.length === 0) {
    return (
      <Card color="app-yellow">
        <p className="blog-section-sub" style={{ marginBottom: 0 }}>
          {empty}
        </p>
      </Card>
    );
  }

  return (
    <div className="blog-posts-grid">
      {posts.map((post) => (
        <Link
          key={post.id}
          to={`/post/${post.slug}`}
          className="blog-post-card-link"
          onMouseEnter={prefetchPostPage}
          onFocus={prefetchPostPage}
        >
          <Card color={post.categoryColor} hoverable className="blog-post-card">
            <div className="blog-post-tag">#{post.categoryName}</div>
            <h3 className="blog-post-title">{post.title}</h3>
            <p className="blog-post-excerpt">{post.summary || "点进去看全文。"}</p>
            <div className="blog-post-meta">
              <time dateTime={(post.publishedAt ?? post.updatedAt).slice(0, 10)}>
                {(post.publishedAt ?? post.updatedAt).slice(0, 10)}
              </time>
              <span className="blog-post-more">阅读 →</span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
