import type { SiteSkillColor } from "./site.js";

export const CATEGORY_KINDS = ["article"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export function isCategoryKind(value: string): value is CategoryKind {
  return (CATEGORY_KINDS as readonly string[]).includes(value);
}

export type Category = {
  id: string;
  slug: string;
  name: string;
  hint: string;
  color: SiteSkillColor;
  kind: CategoryKind;
  nav: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
};

export type UpsertCategoryInput = {
  slug?: string;
  name: string;
  hint?: string;
  color: SiteSkillColor;
  kind: CategoryKind;
  nav?: boolean;
  sort?: number;
};

export const DEFAULT_CATEGORIES: Array<
  Pick<Category, "slug" | "name" | "hint" | "color" | "kind" | "nav" | "sort">
> = [
  { slug: "life", name: "生活", hint: "日常里留下的事", color: "app-blue", kind: "article", nav: true, sort: 0 },
  { slug: "coding", name: "编程", hint: "代码里踩过的坑", color: "app-green", kind: "article", nav: true, sort: 1 },
  { slug: "chat", name: "闲聊", hint: "想到就记一笔", color: "purple", kind: "article", nav: true, sort: 2 },
];
