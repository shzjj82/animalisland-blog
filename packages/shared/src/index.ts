export const POST_TYPES = ["life", "coding", "chat", "photo"] as const;

export type PostType = (typeof POST_TYPES)[number];

export const ARTICLE_TYPES = ["life", "coding", "chat"] as const;

export type ArticleType = (typeof ARTICLE_TYPES)[number];

export type EditorJsBlock = {
  id?: string;
  type: string;
  data: Record<string, unknown>;
};

export type EditorJsDocument = {
  time?: number;
  version?: string;
  blocks: EditorJsBlock[];
};

export type Post = {
  id: string;
  slug: string;
  title: string;
  type: PostType;
  summary: string;
  coverUrl: string;
  body: EditorJsDocument;
  draft: boolean;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PostListItem = Omit<Post, "body">;

export type UpsertPostInput = {
  title: string;
  slug?: string;
  type: PostType;
  summary?: string;
  coverUrl?: string;
  body: EditorJsDocument;
  draft?: boolean;
};

export const POST_TYPE_LABEL: Record<PostType, string> = {
  life: "生活",
  coding: "编程",
  chat: "闲聊",
  photo: "照片",
};

export const ARTICLE_PATH: Record<ArticleType, string> = {
  life: "/life",
  coding: "/coding",
  chat: "/chat",
};

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

export type SiteSkill = {
  name: string;
  color: SiteSkillColor;
};

export type SiteAbout = {
  name: string;
  body: string;
  avatar: string;
  skills: SiteSkill[];
};

export const DEFAULT_ABOUT: SiteAbout = {
  name: "小岛日记 · 生活 / 编程 / 闲聊 / 照片",
  body: "这是我的个人博客。白天写代码，其余时间看看路、拍拍照，偶尔把卡住的问题和想清楚的事情记下来。喜欢能摸到质感的软件，也喜欢把话写明白。",
  avatar: "🦊",
  skills: [
    { name: "React / TS", color: "app-blue" },
    { name: "Node.js", color: "app-green" },
    { name: "生活记录", color: "app-pink" },
    { name: "摄影", color: "purple" },
    { name: "咖啡", color: "brown" },
    { name: "散步", color: "app-teal" },
  ],
};

export const emptyEditorDocument = (): EditorJsDocument => ({
  time: Date.now(),
  version: "2.30.7",
  blocks: [],
});

export function isPostType(value: string): value is PostType {
  return (POST_TYPES as readonly string[]).includes(value);
}

export function isArticleType(value: string): value is ArticleType {
  return (ARTICLE_TYPES as readonly string[]).includes(value);
}

export function isSiteSkillColor(value: string): value is SiteSkillColor {
  return (SITE_SKILL_COLORS as readonly string[]).includes(value);
}
