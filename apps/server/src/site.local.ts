import {
  DEFAULT_ABOUT,
  normalizeEditorDocument,
  isSiteSkillColor,
  type SiteAbout,
  type SiteSkill,
} from "@myblog/shared";
import { db } from "./db.js";

type SiteRow = {
  id: number;
  about_name: string;
  about_body: string;
  about_avatar: string;
  skills: string;
};

type AboutPageRow = {
  id: string;
  title: string;
  body: string;
  props: string;
};

function parseSkills(raw: unknown): SiteSkill[] {
  if (typeof raw === "string") {
    try {
      return parseSkills(JSON.parse(raw));
    } catch {
      return DEFAULT_ABOUT.skills;
    }
  }
  if (!Array.isArray(raw)) {
    return DEFAULT_ABOUT.skills;
  }
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as { name?: unknown; color?: unknown };
    if (typeof row.name !== "string" || typeof row.color !== "string") {
      return [];
    }
    const name = row.name.trim();
    if (!name || !isSiteSkillColor(row.color)) {
      return [];
    }
    return [{ name, color: row.color }];
  });
}

function parseProps(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

function aboutFromPage(row: AboutPageRow): SiteAbout {
  const props = parseProps(row.props ?? "{}");
  return {
    name: row.title || DEFAULT_ABOUT.name,
    body: normalizeEditorDocument(row.body),
    avatar: typeof props.avatar === "string" && props.avatar.trim() ? props.avatar : DEFAULT_ABOUT.avatar,
    skills: parseSkills(props.skills ?? DEFAULT_ABOUT.skills),
  };
}

function toAbout(row: SiteRow): SiteAbout {
  return {
    name: row.about_name,
    body: normalizeEditorDocument(row.about_body),
    avatar: row.about_avatar,
    skills: parseSkills(row.skills),
  };
}

function seedSiteIfEmpty() {
  const existing = db.prepare("SELECT id FROM site WHERE id = 1").get() as { id: number } | undefined;
  if (existing) {
    return;
  }
  db.prepare(
    `INSERT INTO site (id, about_name, about_body, about_avatar, skills)
     VALUES (1, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_ABOUT.name,
    JSON.stringify(DEFAULT_ABOUT.body),
    DEFAULT_ABOUT.avatar,
    JSON.stringify(DEFAULT_ABOUT.skills),
  );
}

seedSiteIfEmpty();

function getAboutPageRow(): AboutPageRow | undefined {
  return db
    .prepare("SELECT id, title, body, props FROM posts WHERE page_kind = 'about' LIMIT 1")
    .get() as AboutPageRow | undefined;
}

/** 唯一读源：about 页；仅在页尚未创建时回落 site（启动迁移前） */
export function getAbout(): SiteAbout {
  const page = getAboutPageRow();
  if (page) {
    return aboutFromPage(page);
  }
  const row = db.prepare("SELECT * FROM site WHERE id = 1").get() as SiteRow | undefined;
  return row ? toAbout(row) : DEFAULT_ABOUT;
}

function mirrorSite(about: SiteAbout): void {
  db.prepare(
    `UPDATE site SET about_name = ?, about_body = ?, about_avatar = ?, skills = ?
     WHERE id = 1`,
  ).run(about.name, JSON.stringify(about.body), about.avatar, JSON.stringify(about.skills));
}

/** 写入 about 页为权威源，并镜像到 site（兼容旧备份） */
export function saveAbout(input: SiteAbout): SiteAbout {
  const page = getAboutPageRow();
  const now = new Date().toISOString();
  if (page) {
    const props = {
      ...parseProps(page.props),
      avatar: input.avatar,
      skills: input.skills,
    };
    db.prepare(
      `UPDATE posts SET title = ?, body = ?, props = ?, draft = 0, updated_at = ?,
        published_at = COALESCE(published_at, ?)
       WHERE id = ?`,
    ).run(input.name, JSON.stringify(input.body), JSON.stringify(props), now, now, page.id);
  }
  mirrorSite(input);
  return getAbout();
}

/** 工作区保存 about 页后：镜像到 site，不再反向覆盖页正文 */
export function syncSiteFromAboutPage(page: {
  title: string;
  body: unknown;
  props: Record<string, unknown>;
}): void {
  const about: SiteAbout = {
    name: page.title || DEFAULT_ABOUT.name,
    body: normalizeEditorDocument(page.body),
    avatar:
      typeof page.props.avatar === "string" && page.props.avatar.trim()
        ? page.props.avatar
        : DEFAULT_ABOUT.avatar,
    skills: parseSkills(page.props.skills ?? DEFAULT_ABOUT.skills),
  };
  mirrorSite(about);
}
