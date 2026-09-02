import { DEFAULT_ABOUT, isSiteSkillColor, type SiteAbout, type SiteSkill } from "@myblog/shared";
import { db } from "./db.js";

type SiteRow = {
  id: number;
  about_name: string;
  about_body: string;
  about_avatar: string;
  skills: string;
};

function parseSkills(raw: string): SiteSkill[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return DEFAULT_ABOUT.skills;
    }
    return parsed.flatMap((item) => {
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
  } catch {
    return DEFAULT_ABOUT.skills;
  }
}

function toAbout(row: SiteRow): SiteAbout {
  return {
    name: row.about_name,
    body: row.about_body,
    avatar: row.about_avatar,
    skills: parseSkills(row.skills),
  };
}

function seedIfEmpty() {
  const existing = db.prepare("SELECT id FROM site WHERE id = 1").get() as { id: number } | undefined;
  if (existing) {
    return;
  }
  db.prepare(
    `INSERT INTO site (id, about_name, about_body, about_avatar, skills)
     VALUES (1, ?, ?, ?, ?)`,
  ).run(
    DEFAULT_ABOUT.name,
    DEFAULT_ABOUT.body,
    DEFAULT_ABOUT.avatar,
    JSON.stringify(DEFAULT_ABOUT.skills),
  );
}

seedIfEmpty();

export function getAbout(): SiteAbout {
  const row = db.prepare("SELECT * FROM site WHERE id = 1").get() as SiteRow | undefined;
  return row ? toAbout(row) : DEFAULT_ABOUT;
}

export function saveAbout(input: SiteAbout): SiteAbout {
  db.prepare(
    `UPDATE site SET about_name = ?, about_body = ?, about_avatar = ?, skills = ?
     WHERE id = 1`,
  ).run(input.name, input.body, input.avatar, JSON.stringify(input.skills));
  return getAbout();
}
