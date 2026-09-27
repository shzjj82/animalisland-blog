"use client";

import { SITE_DESCRIPTION, SITE_NAME, type SiteSkillColor } from "@myblog/shared";
import type { PostListItem } from "@myblog/shared";
import { Button, Card, Divider, Modal, Typewriter } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BlogShell } from "@/components/BlogShell";
import { PostCards } from "@/components/PostCards";
import { Seo } from "@/components/Seo";
import { usePublishedArticles } from "@/lib/usePublishedArticles";

type HomeProps = {
  initialPosts: PostListItem[];
  jsonLd?: Record<string, unknown>;
};

function Home({ initialPosts, jsonLd }: HomeProps) {
  const router = useRouter();
  const [introOpen, setIntroOpen] = useState(false);
  const { posts } = usePublishedArticles();
  const displayPosts = posts.length ? posts : initialPosts;

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

  const stats: { label: string; value: string; color: SiteSkillColor }[] = [
    { label: "文章", value: String(displayPosts.length), color: "app-yellow" },
    { label: "岛民", value: "1", color: "app-teal" },
    { label: "更新节奏", value: "慢", color: "yellow-green" },
  ];

  return (
    <BlogShell>
      <Seo
        title={SITE_NAME}
        description={SITE_DESCRIPTION}
        path="/"
        jsonLd={jsonLd}
      />
      <section className="blog-hero">
        <div className="blog-hero-text">
          <h1 className="blog-hero-title">
            <Typewriter speed={70} trigger={0}>
              你好，这里是小岛日记。一座大家一起慢慢写的小岛。
            </Typewriter>
          </h1>
          <div className="blog-hero-copy">
            <p>
              用来记生活里碰到的小事，以及写代码时踩过的坑。
              白天写代码，其余时间看看路。
            </p>
            <p>这里不赶热点。写完、自己觉得值得留下，就拿出来。这座岛是大家的，欢迎一起参与建设。</p>
          </div>
          <div className="blog-hero-actions">
            <Button type="primary" size="large" onClick={() => router.push("/notes")}>
              开始阅读
            </Button>
            <Button type="text" size="large" onClick={() => router.push("/login?join=1")}>
              一起上岛
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
        <PostCards posts={displayPosts} empty="还没有文章。去工作区写一篇吧。" />
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
        你好。这座岛是大家的。一张卡片是一件事，欢迎你也留下一笔。
      </Modal>
    </BlogShell>
  );
}

export default Home;
