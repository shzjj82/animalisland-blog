import type { PostListItem } from "@myblog/shared";

export function pageTitle(page: Pick<PostListItem, "title"> & { pageKind?: PostListItem["pageKind"] }) {
  if (page.pageKind === "about") {
    return "关于";
  }
  if (page.title && page.title !== "无标题" && page.title !== "未命名") {
    return page.title;
  }
  return "无标题";
}

/** 从全量列表里追溯祖先链（根 → 父 → …），不含自身 */
export function ancestorsOf(pageId: string, pages: PostListItem[]): PostListItem[] {
  const byId = new Map(pages.map((item) => [item.id, item]));
  const chain: PostListItem[] = [];
  let current = byId.get(pageId);
  const seen = new Set<string>();
  while (current?.parentId) {
    if (seen.has(current.parentId)) {
      break;
    }
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) {
      break;
    }
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

/** 自身 + 全部子孙 id（挂父页时排除，避免成环） */
export function selfAndDescendantIds(pageId: string, pages: PostListItem[]): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const page of pages) {
    if (!page.parentId) {
      continue;
    }
    const list = childrenByParent.get(page.parentId) ?? [];
    list.push(page.id);
    childrenByParent.set(page.parentId, list);
  }
  const ids = new Set<string>();
  const stack = [pageId];
  while (stack.length) {
    const current = stack.pop()!;
    if (ids.has(current)) {
      continue;
    }
    ids.add(current);
    const kids = childrenByParent.get(current);
    if (kids) {
      stack.push(...kids);
    }
  }
  return ids;
}
