import { POST_TYPE_LABEL, type PostListItem } from "@myblog/shared";
import { Card } from "animal-island-ui";
import { useNavigate } from "react-router-dom";
import { postColor } from "@/pages/Home/posts";

export function PostCards({ posts, empty }: { posts: PostListItem[]; empty: string }) {
  const navigate = useNavigate();

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
        <Card
          key={post.id}
          color={postColor[post.type]}
          hoverable
          className="blog-post-card"
          onClick={() => navigate(`/post/${post.slug}`)}
        >
          <div className="blog-post-tag">#{POST_TYPE_LABEL[post.type]}</div>
          <h3 className="blog-post-title">{post.title}</h3>
          <p className="blog-post-excerpt">{post.summary || "点进去看全文。"}</p>
          <div className="blog-post-meta">
            <span>{(post.publishedAt ?? post.updatedAt).slice(0, 10)}</span>
            <span className="blog-post-more">阅读 →</span>
          </div>
        </Card>
      ))}
    </div>
  );
}
