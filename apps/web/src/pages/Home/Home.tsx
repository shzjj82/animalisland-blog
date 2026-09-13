import { DEFAULT_ABOUT, SITE_DESCRIPTION, SITE_NAME, type PostListItem } from "@myblog/shared";
import { ArrowRight } from "@icon-park/react";
import { Button, Card, Divider, Modal, Typewriter } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { AboutAvatar } from "@/components/AboutAvatar";
import { BlogShell } from "@/components/BlogShell";
import { BlogContent } from "@/content";
import { PostCards } from "@/components/PostCards";
import { Seo } from "@/components/Seo";
import { api } from "@/lib/api";
import { iconParkOutline } from "@/lib/iconPark";
import type { BlogColor } from "./posts";

function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [introOpen, setIntroOpen] = useState(false);
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [about, setAbout] = useState(DEFAULT_ABOUT);

  useEffect(() => {
    if (localStorage.getItem("hasSeenWelcomeModal")) {
      return;
    }
    const timer = window.setTimeout(() => setIntroOpen(true), 400);
    return () => window.clearTimeout(timer);
  }, []);

  const closeIntro = () => {
    localStorage.setItem("hasSeenWelcomeModal", "true");
    setIntroOpen(false);
  };

  useEffect(() => {
    // 前台只列顶层文章；子文从主文里的页面链接进入（Notion 同款）
    void api
      .listPosts({ pageKind: "article", parentId: null })
      .then((data) => setPosts(data.posts.filter((item) => !item.draft)))
      .catch(() => setPosts([]));
    void api
      .getSite()
      .then((data) => setAbout(data.about))
      .catch(() => setAbout(DEFAULT_ABOUT));
  }, []);

  useEffect(() => {
    const id = location.hash.replace("#", "");
    if (!id) {
      return;
    }
    const timer = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [location.hash]);

  const stats: { label: string; value: string; color: BlogColor }[] = [
    { label: "文章", value: String(posts.length), color: "app-yellow" },
    { label: "岛民", value: "1", color: "app-teal" },
    { label: "更新节奏", value: "慢", color: "yellow-green" },
  ];

  return (
    <BlogShell>
      <Seo
        title={SITE_NAME}
        description={SITE_DESCRIPTION}
        path="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: SITE_NAME,
          url: window.location.origin,
          description: SITE_DESCRIPTION,
          inLanguage: "zh-CN",
          author: { "@type": "Person", name: about.name },
        }}
      />
      <section className="blog-hero">
        <div className="blog-hero-text">
          <h1 className="blog-hero-title">
            <Typewriter speed={70} trigger={0}>
              你好，这里是小岛日记。一座慢慢写的小岛。
            </Typewriter>
          </h1>
          <div className="blog-hero-copy">
            <p>
              用来记生活里碰到的小事，以及写代码时踩过的坑。
              白天写代码，其余时间看看路。
            </p>
            <p>这里不赶热点。写完、自己觉得值得留下，才拿出来。</p>
          </div>
          <div className="blog-hero-actions">
            <Button type="primary" size="large" onClick={() => navigate("/notes")}>
              开始阅读
            </Button>
            <Button
              type="text"
              size="large"
              onClick={() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth" })}
            >
              <span className="blog-inline-icon">
                关于小岛
                <ArrowRight {...iconParkOutline} size={16} aria-hidden />
              </span>
            </Button>
          </div>
        </div>
      </section>

      <Divider type="wave-yellow" />

      <section className="blog-section">
        <div className="blog-stats">
          {stats.map((s) => (
            <Card key={s.label} color={s.color}>
              <div className="blog-stat">
                <div className="blog-stat-value">{s.value}</div>
                <div className="blog-stat-label">{s.label}</div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <Divider type="line-teal" />

      <section className="blog-section">
        <h2 className="blog-section-title">最近写下的</h2>
        <p className="blog-section-sub">点进去看全文。有子页面时会出现在文末。</p>
        <PostCards posts={posts} empty="还没有文章。去工作区写一篇吧。" />
      </section>

      <Divider type="dashed-brown" />

      <section id="about" className="blog-section">
        <h2 className="blog-section-title">关于</h2>
        <Card color="app-yellow">
          <div className="blog-about-inner">
            <div className="blog-avatar">
              <AboutAvatar value={about.avatar} iconSize={36} />
            </div>
            <div>
              <h3>{about.name}</h3>
              <div className="blog-about-body">
                <BlogContent document={about.body} />
              </div>
              <div className="blog-skills">
                {about.skills.map((s, index) => (
                  <Card key={`${s.name}-${index}`} color={s.color}>
                    {s.name}
                  </Card>
                ))}
              </div>
            </div>
          </div>
        </Card>
      </section>

      <Modal
        open={introOpen}
        title="欢迎来到小岛日记"
        onClose={closeIntro}
        onOk={closeIntro}
        typewriter
        typeSpeed={60}
        footer={
          <>
            <Button onClick={closeIntro}>稍后再看</Button>
            <Button type="primary" onClick={closeIntro}>
              开始逛
            </Button>
          </>
        }
      >
        你好。这里记录生活与想法。一张卡片是一件事，一条分隔线后面是另一段路。
      </Modal>
    </BlogShell>
  );
}

export default Home;
