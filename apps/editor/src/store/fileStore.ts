import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";
import { t } from "@/i18n";
import { MAX_ATTACHMENT_BYTES } from "@/lib/document/fileKinds";
<<<<<<< HEAD
import { GATEWAY_BASE_URL, listRemote, loadRemote, saveRemote, type RemoteSession } from "./remoteStore";
=======
import { gatewayUrl, WIKI_APP_CODE, type RemoteSession } from "./remoteStore";
>>>>>>> 3aaec46 (Update environment configuration and enhance editor functionality)

/** 附件块里保存的数据；文件本体不进文档。远程文件的 fileId 是对象键，url 是公开地址 */
export type AttachmentData = {
  fileId: string;
  name: string;
  size: number;
  mime: string;
  source: "local" | "remote";
  url?: string;
};

type StoredFile = { id: string; name: string; mime: string; blob: Blob };

const DB_NAME = "editor-files";
const STORE = "files";
const UPLOAD_PREFIX = "wiki/attachments";
/** 上传服务默认上限（UPLOAD_MAX_BYTES） */
const MAX_REMOTE_BYTES = 15 * 1024 * 1024;
/** 这些状态说明上传服务暂时不可用，退回本机保存 */
const UNAVAILABLE = new Set([404, 502, 503, 504]);
/** 本机 fileId → 已补传的云端数据。编辑器里的旧块数据再存一次时直接换成云端，不重复上传 */
const PROMOTED_KEY = "editor:promoted-attachments";
/** 登录状态下没传上去、还等着补传的本机 fileId */
const PENDING_KEY = "editor:pending-attachments";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function readPromoted(): Record<string, AttachmentData> {
  return readJson<Record<string, AttachmentData>>(PROMOTED_KEY, {});
}

function rememberPromoted(localId: string, data: AttachmentData): void {
  localStorage.setItem(PROMOTED_KEY, JSON.stringify({ ...readPromoted(), [localId]: data }));
  const pending = readPendingAttachments().filter((id) => id !== localId);
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

export function readPendingAttachments(): string[] {
  return readJson<string[]>(PENDING_KEY, []);
}

function addPending(localId: string): void {
  const pending = readPendingAttachments();
  if (!pending.includes(localId)) {
    localStorage.setItem(PENDING_KEY, JSON.stringify([...pending, localId]));
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putLocal(file: File): Promise<string> {
  const id = crypto.randomUUID();
  await withStore("readwrite", (store) => store.put({ id, name: file.name, mime: file.type, blob: file } satisfies StoredFile));
  return id;
}

async function getLocal(id: string): Promise<Blob | null> {
  const stored = (await withStore("readonly", (store) => store.get(id))) as StoredFile | undefined;
  return stored?.blob ?? null;
}

type Uploaded = { key: string; url: string; size: number; contentType: string };

/** POST /upload；返回 null 表示上传服务暂不可用 */
async function uploadRemote(session: RemoteSession, file: File): Promise<Uploaded | null> {
  const form = new FormData();
  form.append("file", file);
  form.append("prefix", UPLOAD_PREFIX);
  let response: Response;
  try {
    response = await fetch(gatewayUrl("/upload"), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${session.token}`,
        "X-Biz-Code": WIKI_APP_CODE,
      },
      body: form,
    });
  } catch {
    return null;
  }
  if (UNAVAILABLE.has(response.status)) {
    return null;
  }
  const json = (await response.json().catch(() => null)) as { success?: boolean; message?: string; data?: Partial<Uploaded> } | null;
  if (!json?.success || !json.data?.key || !json.data.url) {
    throw new Error(json?.message || t("common.requestFailed", { status: response.status }));
  }
  return json.data as Uploaded;
}

export async function saveAttachment(session: RemoteSession | null, file: File): Promise<{ data: AttachmentData; localOnly: boolean }> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(t("attachment.tooLarge", { name: file.name }));
  }
  const base = { name: file.name, size: file.size, mime: file.type };
  if (session && file.size <= MAX_REMOTE_BYTES) {
    const uploaded = await uploadRemote(session, file);
    if (uploaded) {
      return {
        data: { ...base, mime: uploaded.contentType || file.type, fileId: uploaded.key, url: uploaded.url, source: "remote" },
        localOnly: false,
      };
    }
  }
  const fileId = await putLocal(file);
  if (session) {
    addPending(fileId);
  }
  return { data: { ...base, fileId, source: "local" }, localOnly: Boolean(session) };
}

/** 把只存在本机的附件补传到云端；上传服务仍不可用或文件过大时返回 null */
export async function promoteAttachment(session: RemoteSession, data: AttachmentData, blob: Blob): Promise<AttachmentData | null> {
  if (data.source !== "local") {
    return null;
  }
  const known = readPromoted()[data.fileId];
  if (known) {
    return known;
  }
  if (blob.size > MAX_REMOTE_BYTES) {
    return null;
  }
  const uploaded = await uploadRemote(session, new File([blob], data.name, { type: data.mime || blob.type }));
  if (!uploaded) {
    return null;
  }
  const next: AttachmentData = { ...data, mime: uploaded.contentType || data.mime, fileId: uploaded.key, url: uploaded.url, source: "remote" };
  rememberPromoted(data.fileId, next);
  return next;
}

/** 文档里是否还有指向本机的附件 */
export function hasLocalAttachments(body: EditorJsDocument): boolean {
  return (body.blocks ?? []).some((block) => block.type === "attachment" && block.data?.source === "local");
}

/**
 * 同步 / 保存到云端前调用：把文档里的本机附件补传并改指向云端。
 * 本机找不到文件（别的设备传的）或上传服务仍不可用的块原样保留，下次再试。
 */
export async function promoteDocument(session: RemoteSession, body: EditorJsDocument): Promise<{ body: EditorJsDocument; changed: boolean }> {
  if (!hasLocalAttachments(body)) {
    return { body, changed: false };
  }
  let changed = false;
  const blocks: EditorJsBlock[] = [];
  for (const block of body.blocks ?? []) {
    const data = block.data as unknown as AttachmentData | undefined;
    if (block.type !== "attachment" || data?.source !== "local") {
      blocks.push(block);
      continue;
    }
    let next: AttachmentData | null = readPromoted()[data.fileId] ?? null;
    if (!next) {
      const blob = await getLocal(data.fileId).catch(() => null);
      next = blob ? await promoteAttachment(session, data, blob).catch(() => null) : null;
    }
    if (next) {
      changed = true;
      blocks.push({ ...block, data: { ...next } });
    } else {
      blocks.push(block);
    }
  }
  return { body: changed ? { ...body, blocks } : body, changed };
}

let flushing: Promise<string[]> | null = null;

/**
 * 登录 / 联网时调用：本机还有没传上去的附件，就扫一遍账号里的页面补传并写回。
 * 返回写回过的页面 id；同一时间只跑一轮。
 */
export function flushPendingAttachments(session: RemoteSession): Promise<string[]> {
  flushing ??= (async () => {
    if (readPendingAttachments().length === 0) {
      return [];
    }
    const touched: string[] = [];
    const stillUsed = new Set<string>();
    let complete = true;
    for (const node of await listRemote(session)) {
      if (readPendingAttachments().length === 0) {
        break;
      }
      const page = await loadRemote(session, node.id).catch(() => null);
      if (!page) {
        complete = false;
        continue;
      }
      const { body, changed } = await promoteDocument(session, page.body);
      for (const block of body.blocks ?? []) {
        if (block.type === "attachment" && block.data?.source === "local") {
          stillUsed.add(String(block.data.fileId));
        }
      }
      if (changed) {
        await saveRemote(session, { ...page, body });
        touched.push(page.id);
      }
    }
    if (complete) {
      /** 整轮扫完都没被任何页面引用的（附件已删），不再排队 */
      const rest = readPendingAttachments().filter((id) => stillUsed.has(id));
      localStorage.setItem(PENDING_KEY, JSON.stringify(rest));
    }
    return touched;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export async function loadAttachment(session: RemoteSession | null, data: AttachmentData): Promise<Blob> {
  if (data.source === "local") {
    const blob = await getLocal(data.fileId);
    if (!blob) {
      throw new Error(t("attachment.missingLocal"));
    }
    return blob;
  }
  if (!data.url) {
    throw new Error(session ? t("attachment.loadFailed") : t("attachment.loginRequired"));
  }
  const response = await fetch(data.url).catch(() => null);
  if (!response?.ok) {
    throw new Error(response ? t("common.requestFailed", { status: response.status }) : t("attachment.loadFailed"));
  }
  return response.blob();
}
