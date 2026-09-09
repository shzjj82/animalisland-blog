import { SITE_DESCRIPTION, type Post as BlogPost, type PostListItem } from "@myblog/shared";
import { Button, Card, Loading } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BlockRenderer } from "@/components/BlockRenderer";
import { BlogShell } from "@/components/BlogShell";
import { Seo } from "@/components/Seo";
import { api } from "@/lib/api";
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
    setSiblings([]);
    let cancelled = false;
    void api
      .getBySlug(slug)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        setPost(detail.post);
        setLoading(false);
        return api.listPosts(detail.post.type).then((list) => {
          if (!cancelled) {
            setSiblings(list.posts);
          }
        });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setPost(null);
        setMissing(true);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const currentIndex = post ? siblings.findIndex((item) => item.slug === post.slug) : -1;
  const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;
  const published = post ? (post.publishedAt ?? post.updatedAt).slice(0, 10) : "";

  return (
    <BlogShell>
      {missing || (!loading && !post) ? (
        <Seo title="没有找到这篇文章" description={SITE_DESCRIPTION} path={`/post/${slug}`} noindex />
      ) : post ? (
        <Seo
          title={post.title}
          description={post.summary || SITE_DESCRIPTION}
          path={`/post/${post.slug}`}
          image={post.coverUrl || undefined}
          type="article"
          jsonLd={{
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: post.title,
            description: post.summary || SITE_DESCRIPTION,
            image: post.coverUrl || undefined,
            datePublished: post.publishedAt ?? post.createdAt,
            dateModified: post.updatedAt,
            inLanguage: "zh-CN",
            mainEntityOfPage: `${window.location.origin}/post/${post.slug}`,
            publisher: { "@type": "Organization", name: "小岛日记" },
          }}
        />
      ) : null}

      {/* Loading 脱离文档流；仅加载中接收点击，结束后绝不能挡住返回/导航 */}
      <div className={`post-loading${loading ? " is-active" : ""}`} aria-hidden={!loading}>
        <Loading active={loading} />
      </div>

      {missing || (!loading && !post) ? (
        <div className="post-page">
          <Button onClick={() => navigate("/")}>← 返回首页</Button>
          <Card color="app-pink">
            <h1>没有找到这篇文章</h1>
            <p>可能已经删掉了，或者链接写错了。</p>
          </Card>
        </div>
      ) : post ? (
        <article className="post-page">
          <div className="post-back">
            <Button type="text" onClick={() => navigate("/")}>
              ← 返回文章列表
            </Button>
          </div>

          <header className="post-head">
            <div className="post-head-meta">
              <span className="post-tag">#{post.categoryName}</span>
              <time dateTime={published}>{published}</time>
            </div>
            <h1 className="post-title">{post.title}</h1>
          </header>

          <div className="post-body">
            <BlockRenderer document={post.body} skipLeadingTitle={post.title} />
          </div>

          <nav className="post-nav" aria-label="相邻文章">
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
          </nav>
        </article>
      ) : (
        <div className="post-page" />
      )}
    </BlogShell>
  );
}

export default Post;
