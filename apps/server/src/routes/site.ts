import { Router } from "express";
import {
  isEditorJsDocument,
  isSiteSkillColor,
  type SiteAbout,
  type SiteSkill,
} from "@myblog/shared";
import { requireAuth } from "../auth.js";
import { getAbout, saveAbout } from "../site.js";

export const siteRouter = Router();

function readAbout(input: unknown): SiteAbout | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const raw = input as {
    name?: unknown;
    body?: unknown;
    avatar?: unknown;
    skills?: unknown;
  };
  if (typeof raw.name !== "string" || typeof raw.avatar !== "string" || !isEditorJsDocument(raw.body)) {
    return null;
  }
  if (!Array.isArray(raw.skills)) {
    return null;
  }
  const skills: SiteSkill[] = [];
  for (const item of raw.skills.slice(0, 12)) {
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
    name: raw.name.trim(),
    body: {
      time: typeof raw.body.time === "number" ? raw.body.time : Date.now(),
      version: typeof raw.body.version === "string" ? raw.body.version : "2.30.7",
      blocks: raw.body.blocks,
    },
    avatar: raw.avatar.trim() || "🦊",
    skills,
  };
}

siteRouter.get("/", (_req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  res.json({ about: getAbout() });
});

siteRouter.put("/", requireAuth, (req, res) => {
  const about = readAbout(req.body);
  if (!about || !about.name) {
    res.status(400).json({ error: "INVALID_INPUT" });
    return;
  }
  res.json({ about: saveAbout(about) });
});
