export const SITE_NAME = "小岛日记";

export const SITE_DESCRIPTION = "一座大家一起慢慢写的小岛。记录生活、编程和闲聊，欢迎一起建设。";

export function siteTitle(pageTitle: string): string {
  return pageTitle === SITE_NAME ? SITE_NAME : `${pageTitle} · ${SITE_NAME}`;
}

export const SITE_SKILL_COLORS = [
  "app-pink",
  "purple",
  "app-blue",
  "app-yellow",
  "app-orange",
  "app-teal",
  "app-green",
  "app-red",
  "lime-green",
  "yellow-green",
  "brown",
  "warm-peach-pink",
] as const;

export type SiteSkillColor = (typeof SITE_SKILL_COLORS)[number];

export function isSiteSkillColor(value: string): value is SiteSkillColor {
  return (SITE_SKILL_COLORS as readonly string[]).includes(value);
}
