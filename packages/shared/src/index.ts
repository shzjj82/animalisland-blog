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

export const CATEGORY_KINDS = ["article", "photos"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const RESERVED_PATHS = ["admin", "login", "post", "api", "uploads"] as const;

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

export type Post = {
  id: string;
  slug: string;
  title: string;
  type: string;
  categoryName: string;
  categoryColor: SiteSkillColor;
  categoryKind: CategoryKind;
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
  type: string;
  summary?: string;
  coverUrl?: string;
  body: EditorJsDocument;
  draft?: boolean;
};

export const SITE_NAME = "小岛日记";

export const SITE_DESCRIPTION = "一座慢慢写的小岛。记录生活、编程、闲聊和照片。";

export function siteTitle(pageTitle: string): string {
  return pageTitle === SITE_NAME ? SITE_NAME : `${pageTitle} · ${SITE_NAME}`;
}

export type SiteSkill = {
  name: string;
  color: SiteSkillColor;
};

export type SiteAbout = {
  name: string;
  body: EditorJsDocument;
  avatar: string;
  skills: SiteSkill[];
};

export const emptyEditorDocument = (): EditorJsDocument => ({
  time: Date.now(),
  version: "2.30.7",
  blocks: [],
});

export function isEditorJsDocument(value: unknown): value is EditorJsDocument {
  return Boolean(value && typeof value === "object" && Array.isArray((value as EditorJsDocument).blocks));
}

export function editorDocumentFromPlainText(text: string): EditorJsDocument {
  const trimmed = text.trim();
  return {
    time: Date.now(),
    version: "2.30.7",
    blocks: trimmed
      ? [
          {
            type: "paragraph",
            data: { text: trimmed },
          },
        ]
      : [],
  };
}

export function normalizeEditorDocument(value: unknown): EditorJsDocument {
  if (isEditorJsDocument(value)) {
    return {
      time: typeof (value as EditorJsDocument).time === "number" ? value.time : Date.now(),
      version: typeof value.version === "string" ? value.version : "2.30.7",
      blocks: value.blocks,
    };
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isEditorJsDocument(parsed)) {
        return normalizeEditorDocument(parsed);
      }
    } catch {
      /* plain text */
    }
    return editorDocumentFromPlainText(value);
  }
  return emptyEditorDocument();
}

export const DEFAULT_ABOUT: SiteAbout = {
  name: "小岛日记 · 生活 / 编程 / 闲聊 / 照片",
  body: editorDocumentFromPlainText(
    "这是我的个人博客。白天写代码，其余时间看看路、拍拍照，偶尔把卡住的问题和想清楚的事情记下来。喜欢能摸到质感的软件，也喜欢把话写明白。",
  ),
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

export const DEFAULT_CATEGORIES: Array<
  Pick<Category, "slug" | "name" | "hint" | "color" | "kind" | "nav" | "sort">
> = [
  { slug: "life", name: "生活", hint: "日常里留下的事", color: "app-blue", kind: "article", nav: true, sort: 0 },
  { slug: "coding", name: "编程", hint: "代码里踩过的坑", color: "app-green", kind: "article", nav: true, sort: 1 },
  { slug: "chat", name: "闲聊", hint: "想到就记一笔", color: "purple", kind: "article", nav: true, sort: 2 },
  {
    slug: "photos",
    name: "照片",
    hint: "路上拍下的画面",
    color: "warm-peach-pink",
    kind: "photos",
    nav: true,
    sort: 1000,
  },
];

export type AiAttachment =
  | { kind: "image"; name: string; url: string }
  | { kind: "text"; name: string; text: string };

export type AiChatRole = "user" | "assistant";

export type AiChatMessage = {
  role: AiChatRole;
  content: string;
};

export type AiChatInput = {
  messages: AiChatMessage[];
  attachments?: AiAttachment[];
  document?: EditorJsDocument;
};

export type AiChatResult = {
  reply: string;
};

export type AiToEditorInput = {
  messages: AiChatMessage[];
  attachments?: AiAttachment[];
  document?: EditorJsDocument;
  apply?: "append" | "replace";
};

export type AiToEditorResult = {
  blocks: EditorJsBlock[];
  apply: "append" | "replace";
  note?: string;
};

/** @deprecated 旧单次协助接口，保留类型兼容 */
export const AI_ASSIST_MODES = ["draft", "continue", "revise", "chat"] as const;
export type AiAssistMode = (typeof AI_ASSIST_MODES)[number];
export type AiAssistInput = {
  mode: AiAssistMode;
  prompt: string;
  document?: EditorJsDocument;
  attachments?: AiAttachment[];
  apply?: "append" | "replace";
};
export type AiAssistResult = AiToEditorResult;

export function isAiAssistMode(value: string): value is AiAssistMode {
  return (AI_ASSIST_MODES as readonly string[]).includes(value);
}

export function isAiChatRole(value: string): value is AiChatRole {
  return value === "user" || value === "assistant";
}

export function isCategoryKind(value: string): value is CategoryKind {
  return (CATEGORY_KINDS as readonly string[]).includes(value);
}

export function isReservedPath(slug: string): boolean {
  return (RESERVED_PATHS as readonly string[]).includes(slug);
}

export function isSiteSkillColor(value: string): value is SiteSkillColor {
  return (SITE_SKILL_COLORS as readonly string[]).includes(value);
}
