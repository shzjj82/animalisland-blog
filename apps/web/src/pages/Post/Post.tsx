import { SITE_DESCRIPTION, type Post as BlogPost, type PostListItem } from "@myblog/shared";
import { ArrowLeft, ArrowRight } from "@icon-park/react";
import { Button, Card } from "animal-island-ui";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { BlogContent } from "@/content";
import { BlogShell } from "@/components/BlogShell";
import { useDeferredIslandLoading } from "@/components/IslandLoadingHost";
import { PostShare } from "@/components/PostShare";
import { SoftScrollbar } from "@/components/SoftScrollbar";
import { Seo } from "@/components/Seo";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";
import { iconParkOutline, PageLinkIcon } from "@/lib/iconPark";
import { pageTitle } from "@/lib/pageTree";
import "./Post.less";

function Post() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { categories } = useCategories();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [post, setPost] = useState<BlogPost | null>(null);
  const [crumbs, setCrumbs] = useState<PostListItem[]>([]);
  const [siblings, setSiblings] = useState<PostListItem[]>([]);
  const [children, setChildren] = useState<PostListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useDeferredIslandLoading(loading);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setLoading(true);
    setMissing(false);
    setSiblings([]);
    setChildren([]);
    setCrumbs([]);
    let cancelled = false;
    void api
      .getBySlug(slug)
      .then((detail) => {
        if (cancelled) {
          return;
        }
        if (detail.post.pageKind !== "article") {
          setPost(null);
          setMissing(true);
          setLoading(false);
          return;
        }
        setPost(detail.post);
        setCrumbs(detail.ancestors ?? []);
        setSiblings(detail.siblings ?? []);
        setChildren((detail.children ?? []).filter((item) => !item.draft));
        setLoading(false);
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
  const linkedChildIds = new Set(
    (post?.body.blocks ?? [])
      .filter((block) => block.type === "pageLink")
      .map((block) => String((block.data as { pageId?: string }).pageId ?? ""))
      .filter(Boolean),
  );
  const looseChildren = children.filter((child) => !linkedChildIds.has(child.id));

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

      {missing || (!loading && !post) ? (
        <div className="post-page">
          <Button onClick={() => navigate("/notes")}>
            <span className="blog-inline-icon">
              <ArrowLeft {...iconParkOutline} size={14} aria-hidden />
              返回笔记
            </span>
          </Button>
          <Card color="app-pink">
            <h1>没有找到这篇文章</h1>
            <p>可能已经删掉了，或者链接写错了。</p>
          </Card>
        </div>
      ) : post ? (
        <article className="post-page">
          <SoftScrollbar ref={scrollRef} className="post-scroll" contentClassName="post-scroll-view">
            <div className="post-back">
              <Button type="text" onClick={() => navigate("/notes")}>
                <span className="blog-inline-icon">
                  <ArrowLeft {...iconParkOutline} size={14} aria-hidden />
                  返回笔记
                </span>
              </Button>
            </div>

            <header className="post-head">
              {crumbs.length > 0 ? (
                <nav className="post-breadcrumb" aria-label="页面路径">
                  {crumbs.map((item, index) => (
                    <span key={item.id} className="post-crumb-wrap">
                      {index > 0 ? (
                        <span className="post-crumb-sep" aria-hidden>
                          /
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="post-crumb"
                        onClick={() => navigate(`/post/${item.slug}`)}
                      >
                        {pageTitle(item)}
                      </button>
                    </span>
                  ))}
                  <span className="post-crumb-wrap">
                    <span className="post-crumb-sep" aria-hidden>
                      /
                    </span>
                    <span className="post-crumb is-current">{pageTitle(post)}</span>
                  </span>
                </nav>
              ) : null}
              <div className="post-head-meta">
                <time dateTime={published}>{published}</time>
                {post.tags?.length ? (
                  <ul className="post-tags" aria-label="分类">
                    {post.tags.map((tag) => {
                      const name =
                        categories.find((item) => item.slug === tag)?.name ??
                        (tag === post.type ? post.categoryName : tag);
                      return (
                        <li key={tag}>
                          <button type="button" className="post-tag" onClick={() => navigate(`/${tag}`)}>
                            {name}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <PostShare
                  title={post.title}
                  summary={post.summary}
                  url={typeof window !== "undefined" ? window.location.href : `/post/${post.slug}`}
                />
              </div>
              <h1 className="post-title">{post.title}</h1>
            </header>

            <div className="post-body">
              <BlogContent document={post.body} skipLeadingTitle={post.title} />
            </div>

            {looseChildren.length > 0 ? (
              <section className="post-children" aria-label="子页面">
                <p className="post-children-label">子页面</p>
                <ul className="post-children-list">
                  {looseChildren.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="block-page-link"
                        onClick={() => navigate(`/post/${child.slug}`)}
                      >
                        <span className="block-page-link-icon" aria-hidden>
                          <PageLinkIcon size={18} />
                        </span>
                        <span className="block-page-link-title">{pageTitle(child)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </SoftScrollbar>

          <nav className="post-nav" aria-label="相邻页面">
            {prev ? (
              <Button onClick={() => navigate(`/post/${prev.slug}`)}>
                <span className="blog-inline-icon">
                  <ArrowLeft {...iconParkOutline} size={14} aria-hidden />
                  {pageTitle(prev)}
                </span>
              </Button>
            ) : (
              <span />
            )}
            {next ? (
              <Button type="primary" onClick={() => navigate(`/post/${next.slug}`)}>
                <span className="blog-inline-icon">
                  {pageTitle(next)}
                  <ArrowRight {...iconParkOutline} size={14} aria-hidden />
                </span>
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
