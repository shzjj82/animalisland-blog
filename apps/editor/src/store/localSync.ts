import type { EditorJsDocument } from "@myblog/shared";
import {
  dropTombstone,
  linkRemote,
  markSynced,
  readAllLocal,
  readSyncQueue,
  type EditorPage,
  type LocalTombstone,
} from "./localStore";
import {
  createRemoteFromLocal,
  listRemoteClientIds,
  removeRemote,
  saveRemote,
  type RemoteSession,
} from "./remoteStore";
import { t } from "@/i18n";

export type SyncPlan = {
  user: string;
  creates: EditorPage[];
  updates: EditorPage[];
  deletes: LocalTombstone[];
};

export function syncPlanSize(plan: SyncPlan | null): number {
  return plan ? plan.creates.length + plan.updates.length + plan.deletes.length : 0;
}

export type SyncItemKind = "create" | "update" | "delete";

export type SyncItem = {
  key: string;
  kind: SyncItemKind;
  localId: string;
  title: string;
  updatedAt: string;
};

export function syncItems(plan: SyncPlan): SyncItem[] {
  const pageItem = (kind: SyncItemKind) => (page: EditorPage): SyncItem => ({
    key: `${kind}:${page.id}`,
    kind,
    localId: page.id,
    title: page.title || t("common.untitled"),
    updatedAt: page.updatedAt,
  });
  return [
    ...plan.creates.map(pageItem("create")),
    ...plan.updates.map(pageItem("update")),
    ...plan.deletes.map((item) => ({
      key: `delete:${item.localId}`,
      kind: "delete" as const,
      localId: item.localId,
      title: item.title || t("common.untitled"),
      updatedAt: item.deletedAt,
    })),
  ];
}

/** 勾了某页时必须一起同步的项：还没建过的父页，以及正文里链接到的子页面 */
export function requiredSyncKeys(plan: SyncPlan, selected: Set<string>): Set<string> {
  const byId = new Map(readAllLocal().map((page) => [page.id, page]));
  const creates = new Set(plan.creates.map((page) => page.id));
  const required = new Set<string>();
  const stack: string[] = [];
  for (const key of selected) {
    const [kind, localId] = key.split(":");
    if (kind !== "delete" && localId) {
      stack.push(localId);
    }
  }
  const visited = new Set<string>();
  while (stack.length) {
    const id = stack.pop() as string;
    if (visited.has(id)) {
      continue;
    }
    visited.add(id);
    const page = byId.get(id);
    if (!page) {
      continue;
    }
    const deps = [page.parentId, ...(page.body.blocks ?? []).map((block) => (block.type === "pageLink" ? String(block.data.pageId ?? "") : ""))];
    for (const dep of deps) {
      if (dep && creates.has(dep)) {
        const key = `create:${dep}`;
        if (!selected.has(key)) {
          required.add(key);
        }
        stack.push(dep);
      }
    }
  }
  return required;
}

export function pickSyncPlan(plan: SyncPlan, keys: Set<string>): SyncPlan {
  const all = new Set([...keys, ...requiredSyncKeys(plan, keys)]);
  return {
    user: plan.user,
    creates: plan.creates.filter((page) => all.has(`create:${page.id}`)),
    updates: plan.updates.filter((page) => all.has(`update:${page.id}`)),
    deletes: plan.deletes.filter((item) => all.has(`delete:${item.localId}`)),
  };
}

function linkedTo(page: EditorPage, user: string): string | null {
  return page.remote?.user === user ? page.remote.id : null;
}

/** 算出这次要写到账号里的内容，不发任何请求 */
export function buildSyncPlan(user: string): SyncPlan {
  const pages = readAllLocal();
  const byId = new Map(pages.map((page) => [page.id, page]));
  const queue = readSyncQueue();
  const creates = new Map<string, EditorPage>();
  const updates = new Map<string, EditorPage>();

  const needCreate = (page: EditorPage) => {
    const seen = new Set<string>();
    let current: EditorPage | undefined = page;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (!linkedTo(current, user)) {
        creates.set(current.id, current);
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  };

  for (const id of queue.dirty) {
    const page = byId.get(id);
    if (!page) {
      continue;
    }
    if (linkedTo(page, user)) {
      updates.set(page.id, page);
    }
    needCreate(page);
    for (const block of page.body.blocks ?? []) {
      const target = block.type === "pageLink" ? byId.get(String(block.data.pageId ?? "")) : undefined;
      if (target) {
        needCreate(target);
      }
    }
  }

  return {
    user,
    creates: [...creates.values()],
    updates: [...updates.values()],
    deletes: queue.deleted.filter((item) => item.remote.user === user),
  };
}

function depthOf(page: EditorPage, byId: Map<string, EditorPage>): number {
  let depth = 0;
  const seen = new Set<string>();
  let current: EditorPage | undefined = page;
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

function rewriteLinks(body: EditorJsDocument, idMap: Map<string, string>): EditorJsDocument {
  return {
    ...body,
    blocks: (body.blocks ?? []).map((block) => {
      if (block.type !== "pageLink") {
        return block;
      }
      const localId = String(block.data.pageId ?? "");
      const remoteId = idMap.get(localId);
      if (!remoteId) {
        return block;
      }
      return { ...block, data: { ...block.data, pageId: remoteId, slug: remoteId } };
    }),
  };
}

function isMissing(err: unknown): boolean {
  const message = err instanceof Error ? err.message : "";
  return message.includes("404") || message.includes("不存在") || message.includes("NOT_FOUND");
}

/** 按确认过的计划写到账号里。每成功一条就落本地记录，中断后重跑不会重复新建 */
export async function runSyncPlan(session: RemoteSession, plan: SyncPlan): Promise<void> {
  const user = plan.user;
  const pages = readAllLocal();
  const byId = new Map(pages.map((page) => [page.id, page]));
  const idMap = new Map<string, string>();
  for (const page of pages) {
    const remoteId = linkedTo(page, user);
    if (remoteId) {
      idMap.set(page.id, remoteId);
    }
  }

  let clientIds = new Map<string, string>();
  try {
    clientIds = await listRemoteClientIds(session);
  } catch {
    clientIds = new Map();
  }

  const createOne = async (page: EditorPage): Promise<string> => {
    const existing = clientIds.get(page.id);
    const remoteId =
      existing ??
      (await createRemoteFromLocal(session, {
        clientId: page.id,
        parentId: page.parentId ? (idMap.get(page.parentId) ?? null) : null,
        title: page.title,
      }));
    idMap.set(page.id, remoteId);
    linkRemote(page.id, { user, id: remoteId, syncedAt: new Date().toISOString() });
    return remoteId;
  };

  const creates = plan.creates
    .map((page) => byId.get(page.id) ?? page)
    .sort((a, b) => depthOf(a, byId) - depthOf(b, byId));
  for (const page of creates) {
    if (!idMap.has(page.id)) {
      await createOne(page);
    }
  }

  const writes = new Map<string, EditorPage>();
  for (const page of [...plan.creates, ...plan.updates]) {
    const latest = byId.get(page.id);
    if (latest) {
      writes.set(latest.id, latest);
    }
  }
  const ordered = [...writes.values()].sort((a, b) => depthOf(a, byId) - depthOf(b, byId));
  for (const page of ordered) {
    const toRemote = (remoteId: string): EditorPage => ({
      ...page,
      id: remoteId,
      parentId: page.parentId ? (idMap.get(page.parentId) ?? null) : null,
      body: rewriteLinks(page.body, idMap),
    });
    let remoteId = idMap.get(page.id) ?? (await createOne(page));
    try {
      await saveRemote(session, toRemote(remoteId), { clientId: page.id });
    } catch (err) {
      if (!isMissing(err)) {
        throw err;
      }
      clientIds.delete(page.id);
      idMap.delete(page.id);
      remoteId = await createOne(page);
      await saveRemote(session, toRemote(remoteId), { clientId: page.id });
    }
    markSynced(page.id, { user, id: remoteId, syncedAt: new Date().toISOString() });
  }

  for (const item of plan.deletes) {
    await removeRemote(session, item.remote.id);
    dropTombstone(item.localId);
  }
}
