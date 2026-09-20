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

/** 统一 HTTP JSON 响应壳 */
export type ApiResponse<T = unknown> = {
  success: boolean;
  code: string;
  message: string;
  data: T;
};

export function apiOk<T>(data: T, message = "ok", code = "OK"): ApiResponse<T> {
  return { success: true, code, message, data };
}

export function apiFail(code: string, message?: string, data: unknown = null): ApiResponse<null> {
  return {
    success: false,
    code,
    message: message ?? code,
    data: null,
  };
}

export const CATEGORY_KINDS = ["article"] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const PAGE_KINDS = ["article", "about"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

export const RESERVED_PATHS = ["admin", "login", "post", "api", "uploads", "notes", "about"] as const;

/** 标签展示名也禁止占用的词 */
export const RESERVED_TAG_NAMES = [
  "admin",
  "login",
  "post",
  "api",
  "uploads",
  "notes",
  "about",
  "笔记",
  "关于",
  "全部",
  "标签",
] as const;

export const TAG_NAME_MIN = 2;
export const TAG_NAME_MAX = 16;
export const TAG_SLUG_MAX = 40;

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
  pageKind: PageKind;
  parentId: string | null;
  treeSort: number;
  categoryName: string;
  categoryColor: SiteSkillColor;
  categoryKind: CategoryKind;
  summary: string;
  coverUrl: string;
  /** about 页：avatar / skills；文章：tags = 分类 slug 列表（可多选） */
  props: Record<string, unknown>;
  /** 文章所属分类（多选），存的是 category.slug */
  tags: string[];
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
  pageKind?: PageKind;
  parentId?: string | null;
  treeSort?: number;
  summary?: string;
  coverUrl?: string;
  props?: Record<string, unknown>;
  /** 发布时可带分类 slug 列表；写入 props.tags，并可用作筛选 */
  tags?: string[];
  body: EditorJsDocument;
  draft?: boolean;
};

export const SITE_NAME = "小岛日记";

export const SITE_DESCRIPTION = "一座慢慢写的小岛。记录生活、编程和闲聊。";

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

/** 新建文章默认：一个空的一级标题块（打开编辑器时焦点在标题，而不是正文段落） */
export const starterArticleDocument = (): EditorJsDocument => ({
  time: Date.now(),
  version: "2.30.7",
  blocks: [
    {
      type: "header",
      data: { text: "", level: 1 },
    },
  ],
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
  name: "小岛日记 · 生活 / 编程 / 闲聊",
  body: editorDocumentFromPlainText(
    "这是我的个人博客。白天写代码，其余时间看看路、拍拍照，偶尔把卡住的问题和想清楚的事情记下来。喜欢能摸到质感的软件，也喜欢把话写明白。",
  ),
  avatar: "",
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

export function isPageKind(value: string): value is PageKind {
  return (PAGE_KINDS as readonly string[]).includes(value);
}

export function isReservedPath(slug: string): boolean {
  return (RESERVED_PATHS as readonly string[]).includes(slug);
}

export function isReservedTagName(name: string): boolean {
  const key = name.trim().toLocaleLowerCase();
  return (RESERVED_TAG_NAMES as readonly string[]).some((item) => item.toLocaleLowerCase() === key);
}

export type TagValidationResult = { ok: true; value: string } | { ok: false; error: string };

/** 标签名称：2–16 字，需含文字，禁止纯数字/保留名 */
export function validateTagName(raw: string): TagValidationResult {
  const name = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[\u200B-\u200D\uFEFF]/g, "");
  if (!name) {
    return { ok: false, error: "先写标签名。" };
  }
  if (name.length < TAG_NAME_MIN) {
    return { ok: false, error: `标签名至少 ${TAG_NAME_MIN} 个字。` };
  }
  if (name.length > TAG_NAME_MAX) {
    return { ok: false, error: `标签名最多 ${TAG_NAME_MAX} 个字。` };
  }
  if (/^[\d\s._\-]+$/.test(name)) {
    return { ok: false, error: "标签名不能全是数字或符号。" };
  }
  if (!/\p{Letter}/u.test(name)) {
    return { ok: false, error: "标签名至少包含一个文字。" };
  }
  if (isReservedTagName(name) || isReservedPath(name.toLocaleLowerCase())) {
    return { ok: false, error: "这个名字是系统保留的，换一个吧。" };
  }
  return { ok: true, value: name };
}

/** 路径别名：可空（空则跟名称走）；禁止保留路径与纯数字 */
export function validateTagSlug(raw: string, opts?: { allowEmpty?: boolean }): TagValidationResult {
  const allowEmpty = opts?.allowEmpty !== false;
  const slug = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-\p{Letter}\p{Number}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_SLUG_MAX);
  if (!slug) {
    if (allowEmpty) {
      return { ok: true, value: "" };
    }
    return { ok: false, error: "路径别名不能为空。" };
  }
  if (slug.length < 2) {
    return { ok: false, error: "路径别名至少 2 个字符。" };
  }
  if (isReservedPath(slug) || isReservedTagName(slug)) {
    return { ok: false, error: "这个路径是系统保留的，换一个吧。" };
  }
  if (/^\d+$/.test(slug)) {
    return { ok: false, error: "路径别名不能全是数字。" };
  }
  return { ok: true, value: slug };
}

export function isSiteSkillColor(value: string): value is SiteSkillColor {
  return (SITE_SKILL_COLORS as readonly string[]).includes(value);
}

/** 规范化文章标签：去空、去重（忽略大小写）、上限 */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const name = String(item ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, TAG_NAME_MAX);
    if (!name) {
      continue;
    }
    const key = name.toLocaleLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name);
    if (out.length >= 20) {
      break;
    }
  }
  return out;
}

export function tagsFromProps(props: Record<string, unknown> | undefined): string[] {
  return normalizeTags(props?.tags);
}

export function propsWithTags(
  props: Record<string, unknown> | undefined,
  tags: string[],
): Record<string, unknown> {
  return { ...(props ?? {}), tags: normalizeTags(tags) };
}
