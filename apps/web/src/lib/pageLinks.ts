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

/** 用侧栏里的页面标题替换正文子页面块上的旧名称；对不上的块保持原样 */
export function withLivePageLinkTitles(
  body: EditorJsDocument,
  pages: Iterable<{ id: string; title: string }>,
): EditorJsDocument {
  const titles = new Map(Array.from(pages, (page) => [page.id, page.title.trim() || "无标题"]));
  let changed = false;
  const blocks = (body.blocks ?? []).map((block) => {
    if (block.type !== "pageLink") {
      return block;
    }
    const pageId = String((block.data as { pageId?: string }).pageId ?? "");
    const live = titles.get(pageId);
    if (!live || String((block.data as { title?: string }).title ?? "") === live) {
      return block;
    }
    changed = true;
    return { ...block, data: { ...block.data, title: live } };
  });
  return changed ? { ...body, time: Date.now(), blocks } : body;
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
