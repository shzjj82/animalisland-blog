import { Router } from "express";
import { isSiteSkillColor, type SiteAbout, type SiteSkill } from "@myblog/shared";
import { requireAuth } from "../auth.js";
import { getAbout, saveAbout } from "../site.js";

export const siteRouter = Router();

function readAbout(input: unknown): SiteAbout | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const body = input as {
    name?: unknown;
    body?: unknown;
    avatar?: unknown;
    skills?: unknown;
  };
  if (typeof body.name !== "string" || typeof body.body !== "string" || typeof body.avatar !== "string") {
    return null;
  }
  if (!Array.isArray(body.skills)) {
    return null;
  }
  const skills: SiteSkill[] = [];
  for (const item of body.skills.slice(0, 12)) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { name?: unknown; color?: unknown };
    if (typeof row.name !== "string" || typeof row.color !== "string" || !isSiteSkillColor(row.color)) {
      continue;
    }
    const name = row.name.trim();
    if (!name) {
      continue;
    }
    skills.push({ name, color: row.color });
  }
  return {
    name: body.name.trim(),
    body: body.body.trim(),
    avatar: body.avatar.trim() || "🦊",
    skills,
  };
}

siteRouter.get("/", (_req, res) => {
  res.json({ about: getAbout() });
});

siteRouter.put("/", requireAuth, (req, res) => {
  const about = readAbout(req.body);
  if (!about || !about.name || !about.body) {
    res.status(400).json({ error: "INVALID_INPUT" });
    return;
  }
  res.json({ about: saveAbout(about) });
});
