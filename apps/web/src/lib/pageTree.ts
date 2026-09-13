import type { PostListItem } from "@myblog/shared";

export type PageTreeNode = PostListItem & { children: PageTreeNode[] };

export function buildPageForest(pages: PostListItem[]): PageTreeNode[] {
  const articles = pages.filter((item) => item.pageKind === "article");
  const ids = new Set(articles.map((item) => item.id));
  const byParent = new Map<string | null, PostListItem[]>();

  for (const item of articles) {
    const key = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }

  const sortSiblings = (list: PostListItem[]) =>
    [...list].sort((a, b) => a.treeSort - b.treeSort || a.createdAt.localeCompare(b.createdAt));

  const walk = (parentId: string | null): PageTreeNode[] =>
    sortSiblings(byParent.get(parentId) ?? []).map((item) => ({
      ...item,
      children: walk(item.id),
    }));

  return walk(null);
}

export function pageTitle(page: Pick<PostListItem, "title">) {
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
