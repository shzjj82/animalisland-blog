import type { CategoryKind } from "./category.js";
import type { EditorJsDocument } from "./editor.js";
import type { SiteSkillColor } from "./site.js";

export const PAGE_KINDS = ["article"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const VISIBILITIES = ["private", "public"] as const;
export type PostVisibility = (typeof VISIBILITIES)[number];

export function isPageKind(value: string): value is PageKind {
  return (PAGE_KINDS as readonly string[]).includes(value);
}

export function isVisibility(value: string): value is PostVisibility {
  return (VISIBILITIES as readonly string[]).includes(value);
}

export type Post = {
  id: string;
  slug: string;
  title: string;
  type: string;
  pageKind: PageKind;
  parentId: string | null;
  treeSort: number;
  categoryName: string;
  categoryColor: SiteSkillColor;
  categoryKind: CategoryKind;
  summary: string;
  coverUrl: string;
  /** 文章：tags = 分类 slug 列表（可多选） */
  props: Record<string, unknown>;
  /** 文章所属分类（多选），存的是 category.slug */
  tags: string[];
  /** Nest 用户 id */
  authorId?: string | null;
  body: EditorJsDocument;
  visibility: PostVisibility;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostListItem = Omit<Post, "body">;

export type UpsertPostInput = {
  title: string;
  slug?: string;
  type: string;
  pageKind?: PageKind;
  parentId?: string | null;
  treeSort?: number;
  summary?: string;
  coverUrl?: string;
  props?: Record<string, unknown>;
  /** 发布时可带分类 slug 列表；写入 props.tags，并可用作筛选 */
  tags?: string[];
  body: EditorJsDocument;
  visibility?: PostVisibility;
};
