import { propsWithTags, tagsFromProps } from "@myblog/shared";
import { ensureCategoriesFromLabels, getCategoryBySlug, listCategories } from "./categories.local.js";
import { db, getSchemaMeta, setSchemaMeta } from "./db.js";
import { listPosts } from "./posts.local.read.js";

/** 将旧数据迁成工作区页面模型（重活只跑一次） */
export function ensureWorkspacePages(): void {
  // 关于页已废弃：每次启动清掉残留 about 行
  db.prepare("DELETE FROM posts WHERE page_kind = 'about'").run();

  const articleCat = listCategories().find((c) => c.kind === "article");
  const defaultType = articleCat?.slug ?? "life";
  const migrated = getSchemaMeta("workspace_migrated_v2") === "1";

  if (!migrated) {
    // 旧文章默认 article；清掉已废弃的 photo/photos 页
    db.prepare("DELETE FROM posts WHERE page_kind IN ('photos', 'photo')").run();
    db.prepare(
      `UPDATE posts SET page_kind = 'article'
       WHERE page_kind IS NULL OR page_kind = '' OR page_kind <> 'article'`,
    ).run();
    db.prepare(
      `UPDATE posts SET type = ?
       WHERE type NOT IN (SELECT slug FROM categories)`,
    ).run(defaultType);

    // 子页面不参与私有：旧数据一并纠正
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE posts SET draft = 0, published_at = COALESCE(published_at, ?), updated_at = ?
       WHERE parent_id IS NOT NULL AND draft = 1`,
    ).run(now, now);

    // 文章上的自定义标签 → 分类，并回写 slug（仅迁移期允许建类）
    const articleRows = db
      .prepare(
        `SELECT id, type, props FROM posts WHERE page_kind = 'article' AND parent_id IS NULL`,
      )
      .all() as Array<{ id: string; type: string; props: string }>;
    const updateArticle = db.prepare(
      `UPDATE posts SET type = ?, props = ?, updated_at = ? WHERE id = ?`,
    );
    for (const row of articleRows) {
      let props: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.props || "{}") as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          props = parsed as Record<string, unknown>;
        }
      } catch {
        props = {};
      }
      const raw = tagsFromProps(props);
      const labels = raw.length > 0 ? raw : row.type ? [row.type] : [];
      if (labels.length === 0) {
        continue;
      }
      const slugs = ensureCategoriesFromLabels(labels);
      const nextType = slugs[0] && getCategoryBySlug(slugs[0]) ? slugs[0] : row.type;
      updateArticle.run(nextType, JSON.stringify(propsWithTags(props, slugs)), now, row.id);
    }

    const articles = listPosts({
      pageKind: "article",
      scope: "mine",
      treeOrder: true,
    }).posts;
    articles.forEach((item, index) => {
      if (item.treeSort !== index) {
        db.prepare("UPDATE posts SET tree_sort = ? WHERE id = ?").run(index, item.id);
      }
    });

    setSchemaMeta("workspace_migrated_v2", "1");
  }
}
