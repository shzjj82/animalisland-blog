import type { EditorJsDocument } from "@myblog/shared";
import { starterArticleDocument } from "@myblog/shared";
import { t } from "@/i18n";

export type RemoteLink = {
  user: string;
  id: string;
  syncedAt: string;
};

export type EditorPage = {
  id: string;
  title: string;
  parentId: string | null;
  body: EditorJsDocument;
  updatedAt: string;
  remote?: RemoteLink;
};

export type PageNode = Pick<EditorPage, "id" | "title" | "parentId" | "updatedAt">;

export type LocalTombstone = {
  localId: string;
  title?: string;
  remote: RemoteLink;
  deletedAt: string;
};

export type SyncQueue = {
  dirty: string[];
  deleted: LocalTombstone[];
};

const LOCAL_KEY = "editor:pages";
const SYNC_KEY = "editor:sync";

export function readSyncQueue(): SyncQueue {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SyncQueue>) : {};
    return {
      dirty: Array.isArray(parsed.dirty) ? parsed.dirty.filter((id) => typeof id === "string") : [],
      deleted: Array.isArray(parsed.deleted) ? parsed.deleted.filter((item) => item?.localId && item.remote?.id) : [],
    };
  } catch {
    return { dirty: [], deleted: [] };
  }
}

function writeSyncQueue(queue: SyncQueue): void {
  localStorage.setItem(SYNC_KEY, JSON.stringify(queue));
}

function markDirty(ids: Iterable<string>): void {
  const queue = readSyncQueue();
  const dirty = new Set(queue.dirty);
  for (const id of ids) {
    dirty.add(id);
  }
  writeSyncQueue({ ...queue, dirty: [...dirty] });
}

/** 某页已写到账号里：清掉待同步标记，记下服务端 id */
export function markSynced(localId: string, link: RemoteLink): void {
  const pages = readPages();
  writePages(pages.map((page) => (page.id === localId ? { ...page, remote: link } : page)));
  const queue = readSyncQueue();
  writeSyncQueue({ ...queue, dirty: queue.dirty.filter((id) => id !== localId) });
}

/** 只记服务端 id，不清待同步标记。新建成功后先落这一步，避免重复新建 */
export function linkRemote(localId: string, link: RemoteLink): void {
  const pages = readPages();
  writePages(pages.map((page) => (page.id === localId ? { ...page, remote: link } : page)));
}

export function dropTombstone(localId: string): void {
  const queue = readSyncQueue();
  writeSyncQueue({ ...queue, deleted: queue.deleted.filter((item) => item.localId !== localId) });
}

export function readAllLocal(): EditorPage[] {
  return readPages();
}

function readPages(): EditorPage[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as EditorPage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePages(pages: EditorPage[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(pages));
}

export function titleFromBody(body: EditorJsDocument): string {
  for (const block of body.blocks ?? []) {
    if (block.type !== "header") {
      continue;
    }
    const text = String(block.data.text ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .trim();
    if (text) {
      return text;
    }
  }
  return t("common.untitled");
}

/** 只在第一次用时建一篇空白页；用户自己删光后保持为空，由空状态引导新建 */
export function ensureLocalPages(): EditorPage[] {
  const existing = readPages();
  if (existing.length > 0 || localStorage.getItem(LOCAL_KEY) !== null) {
    return existing;
  }
  const page: EditorPage = {
    id: crypto.randomUUID(),
    title: t("common.untitled"),
    parentId: null,
    body: starterArticleDocument(),
    updatedAt: new Date().toISOString(),
  };
  writePages([page]);
  return [page];
}

export function listLocal(): PageNode[] {
  return ensureLocalPages().map(({ id, title, parentId, updatedAt }) => ({
    id,
    title,
    parentId,
    updatedAt,
  }));
}

export function loadLocal(id: string): EditorPage | undefined {
  return ensureLocalPages().find((page) => page.id === id);
}

export function createLocal(parentId: string | null): EditorPage {
  const pages = ensureLocalPages();
  const page: EditorPage = {
    id: crypto.randomUUID(),
    title: t("common.untitled"),
    parentId,
    body: starterArticleDocument(),
    updatedAt: new Date().toISOString(),
  };
  writePages([page, ...pages]);
  return page;
}

/** 把父页面正文里的子页面块标题改成侧栏正在用的标题；没有对应块时不新增 */
export function retitlePageLink(body: EditorJsDocument, pageId: string, title: string): EditorJsDocument | null {
  const nextTitle = title.trim() || t("common.untitled");
  let changed = false;
  const blocks = (body.blocks ?? []).map((block) => {
    if (block.type !== "pageLink" || String(block.data.pageId ?? "") !== pageId) {
      return block;
    }
    if (String(block.data.title ?? "") === nextTitle) {
      return block;
    }
    changed = true;
    return { ...block, data: { ...block.data, title: nextTitle } };
  });
  return changed ? { ...body, blocks } : null;
}

/** 打开父页面时，用侧栏标题覆盖正文里过期的子页面名称 */
export function withLivePageLinks<T extends { body: EditorJsDocument }>(page: T, titles: Iterable<{ id: string; title: string }>): T {
  const byId = new Map(Array.from(titles, (item) => [item.id, item.title]));
  let changed = false;
  const blocks = (page.body.blocks ?? []).map((block) => {
    if (block.type !== "pageLink") {
      return block;
    }
    const live = byId.get(String(block.data.pageId ?? ""))?.trim();
    if (!live || String(block.data.title ?? "") === live) {
      return block;
    }
    changed = true;
    return { ...block, data: { ...block.data, title: live } };
  });
  return changed ? { ...page, body: { ...page.body, blocks } } : page;
}

export function saveLocal(page: EditorPage): EditorPage {
  const pages = ensureLocalPages();
  const next: EditorPage = {
    ...page,
    title: titleFromBody(page.body),
    updatedAt: new Date().toISOString(),
  };
  const index = pages.findIndex((item) => item.id === page.id);
  const copy = pages.slice();
  if (index === -1) {
    copy.unshift(next);
  } else {
    copy[index] = { ...next, remote: pages[index].remote };
  }
  const saved = index === -1 ? copy[0] : copy[index];
  const dirty = [page.id];
  if (saved.parentId) {
    const parentIndex = copy.findIndex((item) => item.id === saved.parentId);
    const parent = parentIndex === -1 ? undefined : copy[parentIndex];
    const patched = parent ? retitlePageLink(parent.body, saved.id, saved.title) : null;
    if (parent && patched) {
      copy[parentIndex] = { ...parent, body: patched, updatedAt: saved.updatedAt };
      dirty.push(saved.parentId);
    }
  }
  writePages(copy);
  markDirty(dirty);
  return saved;
}

function descendantIds(pages: EditorPage[], rootId: string): Set<string> {
  const drop = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of pages) {
      if (page.parentId && drop.has(page.parentId) && !drop.has(page.id)) {
        drop.add(page.id);
        grew = true;
      }
    }
  }
  return drop;
}

function withoutPageLink(body: EditorJsDocument, pageId: string): EditorJsDocument {
  return {
    ...body,
    blocks: (body.blocks ?? []).filter(
      (block) => !(block.type === "pageLink" && String(block.data.pageId ?? "") === pageId),
    ),
  };
}

function withPageLink(body: EditorJsDocument, pageId: string, title: string): EditorJsDocument {
  const nextTitle = title.trim() || t("common.untitled");
  const blocks = [...(body.blocks ?? [])];
  const index = blocks.findIndex((block) => block.type === "pageLink" && String(block.data.pageId ?? "") === pageId);
  if (index !== -1) {
    if (String(blocks[index].data.title ?? "") === nextTitle) {
      return body;
    }
    blocks[index] = { ...blocks[index], data: { ...blocks[index].data, title: nextTitle } };
    return { ...body, blocks };
  }
  return {
    ...body,
    blocks: [...blocks, { type: "pageLink", data: { pageId, slug: pageId, title: nextTitle } }],
  };
}

/** 调整父子层级，并同步父页面正文里的子页面链接 */
export function reparentLocal(id: string, parentId: string | null): void {
  const pages = ensureLocalPages();
  const page = pages.find((item) => item.id === id);
  if (!page || page.parentId === parentId) {
    return;
  }
  if (parentId && descendantIds(pages, id).has(parentId)) {
    return;
  }
  const oldParentId = page.parentId;
  const now = new Date().toISOString();
  const moved = pages.map((item) => (item.id === id ? { ...item, parentId, updatedAt: now } : item));
  writePages(
    moved.map((item) => {
      if (item.id === oldParentId) {
        return { ...item, body: withoutPageLink(item.body, id), updatedAt: now };
      }
      if (item.id === parentId) {
        return { ...item, body: withPageLink(item.body, id, page.title), updatedAt: now };
      }
      return item;
    }),
  );
  markDirty([id, oldParentId, parentId].filter((item): item is string => Boolean(item)));
}

export function removeLocal(id: string): void {
  const pages = ensureLocalPages();
  const drop = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const page of pages) {
      if (page.parentId && drop.has(page.parentId) && !drop.has(page.id)) {
        drop.add(page.id);
        grew = true;
      }
    }
  }
  writePages(pages.filter((page) => !drop.has(page.id)));
  const queue = readSyncQueue();
  const now = new Date().toISOString();
  const tombstones = pages
    .filter((page) => drop.has(page.id) && page.remote)
    .map((page) => ({ localId: page.id, title: page.title, remote: page.remote as RemoteLink, deletedAt: now }));
  writeSyncQueue({
    dirty: queue.dirty.filter((item) => !drop.has(item)),
    deleted: [...queue.deleted.filter((item) => !drop.has(item.localId)), ...tombstones],
  });
}
