import { t } from "@/i18n";
import { MAX_ATTACHMENT_BYTES } from "@/lib/document/fileKinds";
import { GATEWAY_BASE_URL, type RemoteSession } from "./remoteStore";

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
const UPLOAD_PREFIX = "editor/attachments";
/** 上传服务默认上限（UPLOAD_MAX_BYTES） */
const MAX_REMOTE_BYTES = 15 * 1024 * 1024;
/** 这些状态说明上传服务暂时不可用，退回本机保存 */
const UNAVAILABLE = new Set([404, 502, 503, 504]);

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
    response = await fetch(`${GATEWAY_BASE_URL}/upload`, {
      method: "POST",
      headers: { Accept: "application/json", Authorization: `Bearer ${session.token}` },
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
  return { data: { ...base, fileId: await putLocal(file), source: "local" }, localOnly: Boolean(session) };
}

/** 把只存在本机的附件补传到云端；上传服务仍不可用或文件过大时返回 null */
export async function promoteAttachment(session: RemoteSession, data: AttachmentData, blob: Blob): Promise<AttachmentData | null> {
  if (data.source !== "local" || blob.size > MAX_REMOTE_BYTES) {
    return null;
  }
  const uploaded = await uploadRemote(session, new File([blob], data.name, { type: data.mime || blob.type }));
  return uploaded ? { ...data, mime: uploaded.contentType || data.mime, fileId: uploaded.key, url: uploaded.url, source: "remote" } : null;
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
