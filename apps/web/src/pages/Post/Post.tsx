import { POST_TYPE_LABEL, type Post as BlogPost, type PostListItem } from "@myblog/shared";
import { Button, Card, Divider, Loading } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BlockRenderer } from "@/components/BlockRenderer";
import { BlogShell } from "@/components/BlogShell";
import { api } from "@/lib/api";
import { postColor, postCover } from "../Home/posts";
import "./Post.less";

function Post() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [siblings, setSiblings] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setLoading(true);
    setMissing(false);
    void api
      .getBySlug(slug)
      .then(async (detail) => {
        setPost(detail.post);
        const list = await api.listPosts(detail.post.type);
        setSiblings(list.posts);
      })
      .catch(() => {
        setPost(null);
        setMissing(true);
      })
      .finally(() => setLoading(false));
  }, [slug]);

  const currentIndex = post ? siblings.findIndex((item) => item.slug === post.slug) : -1;
  const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  return (
    <BlogShell>
      <Loading
        active={loading}
        style={{ position: "fixed", left: 0, top: 0, zIndex: 9999999, height: "100vh", width: "100vw" }}
      />

      {missing || (!loading && !post) ? (
        <div className="post-page">
          <Button onClick={() => navigate("/")}>← 返回首页</Button>
          <Card color="app-pink">
            <h2>没有找到这篇文章</h2>
            <p>可能已经删掉了，或者链接写错了。</p>
          </Card>
        </div>
      ) : post ? (
        <div className="post-page">
          <div className="post-back">
            <Button type="text" onClick={() => navigate("/")}>
              ← 返回文章列表
            </Button>
          </div>

          <Card color={postColor[post.type]} className="post-hero">
            {post.coverUrl ? (
              <img src={post.coverUrl} alt="" className="post-hero-photo" />
            ) : (
              <div className="post-hero-cover">{postCover[post.type]}</div>
            )}
            <div className="post-hero-text">
              <span className="post-tag">#{POST_TYPE_LABEL[post.type]}</span>
              <h1>{post.title}</h1>
              <div className="post-meta">
                <span>🗓 {(post.publishedAt ?? post.updatedAt).slice(0, 10)}</span>
              </div>
            </div>
          </Card>

          {post.summary ? <p className="post-excerpt">{post.summary}</p> : null}

          <Divider type="line-teal" />

          <div className="post-body">
            <BlockRenderer document={post.body} />
          </div>

          <Divider type="wave-yellow" />

          <div className="post-nav">
            {prev ? (
              <Button onClick={() => navigate(`/post/${prev.slug}`)}>← {prev.title}</Button>
            ) : (
              <span />
            )}
            {next ? (
              <Button type="primary" onClick={() => navigate(`/post/${next.slug}`)}>
                {next.title} →
              </Button>
            ) : (
              <span />
            )}
          </div>
        </div>
      ) : (
        <div className="post-page" />
      )}
    </BlogShell>
  );
}

export default Post;
