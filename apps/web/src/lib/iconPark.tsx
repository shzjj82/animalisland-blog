import { Notes } from "@icon-park/react";
import type { CSSProperties } from "react";

/** 工作区统一 IconPark 描边风格 */
export const iconParkOutline = {
  theme: "outline" as const,
  strokeWidth: 3,
};

export function iconParkSize(size: number) {
  return { ...iconParkOutline, size };
}

/** IconPark Notes：文章 / 子页面（Editor.js / 纯 DOM） */
export const NOTES_ICON_SVG = `<svg width="1em" height="1em" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M8 6C8 4.89543 8.89543 4 10 4H30L40 14V42C40 43.1046 39.1046 44 38 44H10C8.89543 44 8 43.1046 8 42V6Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16 20H32" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M16 28H32" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** @deprecated 兼容旧名，同 NOTES_ICON_SVG */
export const PAGE_LINK_ICON_SVG = NOTES_ICON_SVG;

export const PAGE_LINK_TOOLBOX_SVG = NOTES_ICON_SVG.replace('width="1em"', 'width="18"').replace(
  'height="1em"',
  'height="18"',
);

/** IconPark Magic 图标，写作助手 / 命令 */
export const AI_ASSIST_TOOLBOX_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M20.1005 8.1005L24.3431 12.3431M30 4V10M39.8995 8.1005L35.6569 12.3431M44 18H38M39.8995 27.8995L35.6569 23.6569M30 32V26M20.1005 27.8995L24.3431 23.6569M16 18H22" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M29.5856 18.4143L5.54395 42.4559" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

type PageLinkIconProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
};

/** 文章 / 子页面统一 Notes 图标 */
export function PageLinkIcon({ size = 18, className, style }: PageLinkIconProps) {
  return <Notes {...iconParkOutline} size={size} className={className} style={style} />;
}
