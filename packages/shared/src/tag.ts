import { isReservedPath } from "./slug.js";

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
