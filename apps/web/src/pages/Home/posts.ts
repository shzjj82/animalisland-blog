import type { PostType, SiteSkillColor } from "@myblog/shared";

export type BlogColor = SiteSkillColor;

export const postCover: Record<PostType, string> = {
  life: "🌿",
  coding: "⌨️",
  chat: "💬",
  photo: "📷",
};

export const postColor: Record<PostType, BlogColor> = {
  life: "app-blue",
  coding: "app-green",
  chat: "purple",
  photo: "warm-peach-pink",
};
