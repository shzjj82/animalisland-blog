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

export function ensureLocalPages(): EditorPage[] {
  const existing = readPages();
  if (existing.length > 0) {
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

export function saveLocal(page: EditorPage): EditorPage {
  const pages = ensureLocalPages();
  const next: EditorPage = {
    ...page,
    title: titleFromBody(page.body),
    updatedAt: new Date().toISOString(),
  };
  const index = pages.findIndex((item) => item.id === page.id);
  if (index === -1) {
    writePages([next, ...pages]);
  } else {
    const copy = pages.slice();
    copy[index] = { ...next, remote: pages[index].remote };
    writePages(copy);
  }
  markDirty([page.id]);
  return next;
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
  const blocks = body.blocks ?? [];
  if (blocks.some((block) => block.type === "pageLink" && String(block.data.pageId ?? "") === pageId)) {
    return body;
  }
  return {
    ...body,
    blocks: [...blocks, { type: "pageLink", data: { pageId, slug: pageId, title: title.trim() || t("common.untitled") } }],
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
