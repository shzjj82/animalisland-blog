import { ARTICLE_TYPES, DEFAULT_ABOUT, isArticleType, type PostListItem } from "@myblog/shared";
import { Button, Card, Divider, Modal, Typewriter } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { api } from "@/lib/api";
import type { BlogColor } from "./posts";

function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const [introOpen, setIntroOpen] = useState(() => !localStorage.getItem("hasSeenWelcomeModal"));
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [about, setAbout] = useState(DEFAULT_ABOUT);

  useEffect(() => {
    if (!introOpen) {
      localStorage.setItem("hasSeenWelcomeModal", "true");
    }
  }, [introOpen]);

  useEffect(() => {
    void api
      .listPosts()
      .then((data) => setPosts(data.posts.filter((post) => isArticleType(post.type))))
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
    { label: "分类", value: String(ARTICLE_TYPES.length), color: "app-orange" },
    { label: "岛民", value: "1", color: "app-teal" },
    { label: "更新节奏", value: "慢", color: "yellow-green" },
  ];

  return (
    <BlogShell>
      <section className="blog-hero">
        <div className="blog-hero-text">
          <div className="blog-hero-title">
            <Typewriter speed={70} trigger={0}>
              你好，这里是小岛日记。一座慢慢写的小岛。
            </Typewriter>
          </div>
          <div className="blog-hero-copy">
            <p>
              用来记 <b>生活</b> 里碰到的小事、<b>编程</b> 时踩过的坑、<b>闲聊</b> 时冒出来的念头，以及路上顺手拍下的 <b>照片</b>。
              白天写代码，其余时间看看路；有些话当时说不清，过几天写下来才明白。
            </p>
            <p>
              这里不赶热点，也不为更新而更新。写完、自己觉得值得留下，才拿出来。
              可以从生活、编程或闲聊读起，也可以去照片页逛逛。
            </p>
          </div>
          <div className="blog-hero-actions">
            <Button type="primary" size="large" onClick={() => navigate("/life")}>
              开始阅读
            </Button>
            <Button
              type="text"
              size="large"
              onClick={() => document.getElementById("about")?.scrollIntoView({ behavior: "smooth" })}
            >
              关于小岛 →
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
        <p className="blog-section-sub">点进去看全文。生活、编程、闲聊在顶栏分流。</p>
        <PostCards posts={posts} empty="还没有文章。去写作台写一篇吧。" />
      </section>

      <Divider type="dashed-brown" />

      <section id="about" className="blog-section">
        <h2 className="blog-section-title">关于</h2>
        <Card color="app-yellow">
          <div className="blog-about-inner">
            <div className="blog-avatar">{about.avatar}</div>
            <div>
              <h3>{about.name}</h3>
              <p>{about.body}</p>
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
        onClose={() => setIntroOpen(false)}
        onOk={() => setIntroOpen(false)}
        typewriter
        typeSpeed={60}
        footer={
          <>
            <Button onClick={() => setIntroOpen(false)}>稍后再看</Button>
            <Button type="primary" onClick={() => setIntroOpen(false)}>
              开始逛
            </Button>
          </>
        }
      >
        你好。这里记录生活、编程、闲聊和照片。一张卡片是一件事，一条分隔线后面是另一段路。
      </Modal>
    </BlogShell>
  );
}

export default Home;
