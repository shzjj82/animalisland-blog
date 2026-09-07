import { SITE_DESCRIPTION } from "@myblog/shared";
import { Button, Card } from "animal-island-ui";
import { useLocation, useNavigate } from "react-router-dom";
import { BlogShell } from "@/components/BlogShell";
import { Seo } from "@/components/Seo";

export function NotFoundPage() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <BlogShell>
      <Seo title="没有找到这个页面" description={SITE_DESCRIPTION} path={pathname} noindex />
      <section className="blog-section post-list">
        <Card color="app-pink">
          <h2 className="blog-section-title">没有找到这个页面</h2>
          <p className="blog-section-sub">可能是链接写错了，或者这页已经搬走了。</p>
          <Button type="primary" onClick={() => navigate("/")}>
            ← 回小岛
          </Button>
        </Card>
      </section>
    </BlogShell>
  );
}
