import type { SiteSkillColor } from "@myblog/shared";

/** 与前台 Card / 导航色板一致 */
export const SKILL_COLOR_HEX: Record<SiteSkillColor, string> = {
  "app-pink": "#f8a6b2",
  purple: "#b77dee",
  "app-blue": "#889df0",
  "app-yellow": "#f7cd67",
  "app-orange": "#e59266",
  "app-teal": "#82d5bb",
  "app-green": "#8ac68a",
  "app-red": "#fc736d",
  "lime-green": "#d1da49",
  "yellow-green": "#ecdf52",
  brown: "#9a835a",
  "warm-peach-pink": "#e18c6f",
};

export function skillColorHex(color: string | undefined): string {
  if (color && color in SKILL_COLOR_HEX) {
    return SKILL_COLOR_HEX[color as SiteSkillColor];
  }
  return SKILL_COLOR_HEX["app-yellow"];
}
