import type { EditorJsDocument, Post } from "@myblog/shared";

export function makePageLinkBlock(child: Pick<Post, "id" | "slug" | "title">) {
  return {
    type: "pageLink",
    data: {
      pageId: child.id,
      slug: child.slug,
      title: child.title?.trim() && child.title !== "无标题" ? child.title : "无标题",
    },
  };
}

/** Notion：新建子页后，主文里会出现一条可点的页面链接 */
export function appendPageLink(
  body: EditorJsDocument,
  child: Pick<Post, "id" | "slug" | "title">,
): EditorJsDocument {
  const blocks = [...(body.blocks ?? [])];
  const exists = blocks.some(
    (block) =>
      block.type === "pageLink" &&
      String((block.data as { pageId?: string }).pageId ?? "") === child.id,
  );
  if (exists) {
    return body;
  }
  return {
    ...body,
    time: Date.now(),
    blocks: [...blocks, makePageLinkBlock(child)],
  };
}

export function syncPageLinkTitle(
  body: EditorJsDocument,
  pageId: string,
  title: string,
  slug?: string,
): EditorJsDocument | null {
  let changed = false;
  const blocks = (body.blocks ?? []).map((block) => {
    if (block.type !== "pageLink") {
      return block;
    }
    if (String((block.data as { pageId?: string }).pageId ?? "") !== pageId) {
      return block;
    }
    changed = true;
    return {
      ...block,
      data: {
        ...block.data,
        title: title.trim() || "无标题",
        ...(slug ? { slug } : {}),
      },
    };
  });
  return changed ? { ...body, blocks } : null;
}

/** 侧栏删除子页后，从父文去掉对应 pageLink 块 */
export function removePageLink(body: EditorJsDocument, pageId: string): EditorJsDocument | null {
  const blocks = body.blocks ?? [];
  const next = blocks.filter(
    (block) =>
      !(
        block.type === "pageLink" &&
        String((block.data as { pageId?: string }).pageId ?? "") === pageId
      ),
  );
  if (next.length === blocks.length) {
    return null;
  }
  return { ...body, time: Date.now(), blocks: next };
}
