import type { EditorJsDocument } from "@myblog/shared";
import { readAllLocal, titleFromBody, type PageNode } from "@/store/localStore";
import { loadRemote, type RemoteSession } from "@/store/remoteStore";

export type SearchDoc = { id: string; title: string; text: string; updatedAt: string };

export type SearchHit = {
  id: string;
  title: string;
  /** 命中正文时的上下文片段，match 是命中的原文 */
  snippet?: { before: string; match: string; after: string };
};

type ListItem = { content?: string; items?: ListItem[] };

function plain(value: unknown): string {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function listText(items: ListItem[] = []): string[] {
  return items.flatMap((item) => [plain(item.content), ...listText(item.items)]);
}

export function documentText(body: EditorJsDocument): string {
  const parts: string[] = [];
  for (const block of body.blocks ?? []) {
    const data = (block.data ?? {}) as Record<string, unknown>;
    switch (block.type) {
      case "header":
      case "paragraph":
        parts.push(plain(data.text));
        break;
      case "list":
        parts.push(...listText(data.items as ListItem[] | undefined));
        break;
      case "quote":
        parts.push(plain(data.text), plain(data.caption));
        break;
      case "table":
        parts.push(...((data.content as string[][] | undefined) ?? []).flat().map(plain));
        break;
      case "pageLink":
        parts.push(plain(data.title));
        break;
    }
  }
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

function toDoc(id: string, updatedAt: string, body: EditorJsDocument): SearchDoc {
  return { id, title: titleFromBody(body), text: documentText(body), updatedAt };
}

const remoteCache = new Map<string, SearchDoc>();

async function loadRemoteDocs(session: RemoteSession, nodes: PageNode[]): Promise<SearchDoc[]> {
  const key = (id: string) => `${session.username}:${id}`;
  const stale = nodes.filter((node) => remoteCache.get(key(node.id))?.updatedAt !== node.updatedAt);
  let cursor = 0;
  const worker = async () => {
    while (cursor < stale.length) {
      const node = stale[cursor++];
      try {
        const page = await loadRemote(session, node.id);
        remoteCache.set(key(node.id), toDoc(node.id, node.updatedAt, page.body));
      } catch {
        remoteCache.set(key(node.id), { id: node.id, title: node.title, text: "", updatedAt: node.updatedAt });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, stale.length) }, worker));
  return nodes.map((node) => remoteCache.get(key(node.id))).filter((doc): doc is SearchDoc => Boolean(doc));
}

/** 远程页面第一次检索时逐篇拉正文，之后按 updatedAt 只刷新改过的 */
export function loadSearchDocs(session: RemoteSession | null, nodes: PageNode[]): Promise<SearchDoc[]> {
  if (!session) {
    return Promise.resolve(readAllLocal().map((page) => toDoc(page.id, page.updatedAt ?? "", page.body)));
  }
  return loadRemoteDocs(session, nodes);
}

function snippetAt(text: string, index: number, length: number): SearchHit["snippet"] {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 48);
  return {
    before: `${start > 0 ? "…" : ""}${text.slice(start, index)}`,
    match: text.slice(index, index + length),
    after: `${text.slice(index + length, end)}${end < text.length ? "…" : ""}`,
  };
}

export function searchDocs(docs: SearchDoc[], query: string, limit = 8): SearchHit[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }
  const scored: { hit: SearchHit; score: number; updatedAt: string }[] = [];
  for (const doc of docs) {
    const title = doc.title.toLocaleLowerCase();
    const text = doc.text.toLocaleLowerCase();
    if (!terms.every((term) => title.includes(term) || text.includes(term))) {
      continue;
    }
    const inTitle = terms.filter((term) => title.includes(term)).length;
    const bodyTerm = terms.find((term) => text.includes(term));
    const index = bodyTerm ? text.indexOf(bodyTerm) : -1;
    scored.push({
      hit: {
        id: doc.id,
        title: doc.title,
        snippet: index >= 0 && inTitle < terms.length ? snippetAt(doc.text, index, bodyTerm!.length) : undefined,
      },
      score: inTitle * 10 + (index >= 0 ? 1 : 0),
      updatedAt: doc.updatedAt,
    });
  }
  scored.sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  return scored.slice(0, limit).map((item) => item.hit);
}
