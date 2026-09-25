import crypto from "node:crypto";
import type { EditorJsDocument } from "@myblog/shared";
import { emptyEditorDocument, propsWithTags, tagsFromProps } from "@myblog/shared";
import { ensureCategoriesFromLabels, getCategoryBySlug, listCategories } from "./categories.local.js";
import { db, getSchemaMeta, setSchemaMeta } from "./db.js";
import type { PostRow } from "./posts.local.shared.js";
import { getPageByKind, listPosts } from "./posts.local.read.js";
import { createPost, updatePost } from "./posts.local.write.js";

/** 将旧数据迁成工作区页面模型（重活只跑一次） */
export function ensureWorkspacePages(): void {
  const articleCat = listCategories().find((c) => c.kind === "article");
  const defaultType = articleCat?.slug ?? "life";
  const migrated = getSchemaMeta("workspace_migrated_v2") === "1";

  if (!migrated) {
    // 旧文章默认 article；清掉已废弃的 photo/photos 页
    db.prepare("DELETE FROM posts WHERE page_kind IN ('photos', 'photo')").run();
    db.prepare(
      `UPDATE posts SET page_kind = 'article'
       WHERE page_kind IS NULL OR page_kind = '' OR page_kind NOT IN ('article', 'about')`,
    ).run();
    db.prepare(
      `UPDATE posts SET type = ?
       WHERE type NOT IN (SELECT slug FROM categories)`,
    ).run(defaultType);

    // 子页面不能是草稿：旧数据一并纠正
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
  }

  if (!getPageByKind("about")) {
    const siteRow = db.prepare("SELECT * FROM site WHERE id = 1").get() as
      | {
          about_name: string;
          about_body: string;
          about_avatar: string;
          skills: string;
        }
      | undefined;
    let body = emptyEditorDocument();
    let avatar = "";
    let skills: unknown[] = [];
    let name = "关于";
    if (siteRow) {
      name = siteRow.about_name || name;
      avatar = siteRow.about_avatar || avatar;
      try {
        skills = JSON.parse(siteRow.skills) as unknown[];
      } catch {
        skills = [];
      }
      try {
        const parsed = JSON.parse(siteRow.about_body) as EditorJsDocument;
        if (parsed?.blocks) {
          body = parsed;
        }
      } catch {
        /* keep empty */
      }
    }
    createPost({
      title: name,
      slug: `sys-about-${crypto.randomUUID().slice(0, 8)}`,
      type: defaultType,
      pageKind: "about",
      summary: "",
      coverUrl: "",
      body,
      draft: false,
      treeSort: -1,
      props: { avatar, skills },
    });
  } else if (!migrated) {
    const about = getPageByKind("about");
    if (about && (about.slug === "workspace-about" || about.slug.startsWith("workspace-"))) {
      db.prepare("UPDATE posts SET slug = ? WHERE id = ?").run(
        `sys-about-${about.id.slice(0, 8)}`,
        about.id,
      );
    }
  }

  if (!migrated) {
    const articles = listPosts({
      pageKind: "article",
      includeDrafts: true,
      treeOrder: true,
    }).posts;
    articles.forEach((item, index) => {
      if (item.treeSort !== index) {
        db.prepare("UPDATE posts SET tree_sort = ? WHERE id = ?").run(index, item.id);
      }
    });

    // about 正文若仍为空，从 site 回填一次
    const aboutPage = getPageByKind("about");
    if (aboutPage && (!aboutPage.body.blocks || aboutPage.body.blocks.length === 0)) {
      const siteRow = db.prepare("SELECT * FROM site WHERE id = 1").get() as
        | {
            about_name: string;
            about_body: string;
            about_avatar: string;
            skills: string;
          }
        | undefined;
      if (siteRow) {
        try {
          const parsed = JSON.parse(siteRow.about_body) as EditorJsDocument;
          if (parsed?.blocks?.length) {
            const props = {
              ...aboutPage.props,
              avatar: siteRow.about_avatar || aboutPage.props.avatar,
              skills: JSON.parse(siteRow.skills),
            };
            db.prepare("UPDATE posts SET title = ?, body = ?, props = ? WHERE id = ?").run(
              siteRow.about_name || aboutPage.title,
              JSON.stringify(parsed),
              JSON.stringify(props),
              aboutPage.id,
            );
          }
        } catch {
          /* ignore */
        }
      }
    }

    setSchemaMeta("workspace_migrated_v2", "1");
  }
}
