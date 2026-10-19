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

/** 带上状态和日期，提问「待办 / 未完成 / todo」时才能命中条目本身 */
function todoLine(item: { text?: string; done?: boolean; start?: string; end?: string }): string {
  const text = plain(item.text).trim();
  const start = String(item.start ?? "").trim();
  const end = String(item.end ?? "").trim();
  if (!text && !start && !end) {
    return "";
  }
  const state = item.done ? "已完成" : "未完成";
  const range = start || end ? ` ${start || "?"}至${end || "?"}` : "";
  return `${state} 待办任务 todo ${text}${range}`.trim();
}

const TODO_MARK = /(?=未完成 待办任务 todo |已完成 待办任务 todo )/;

export type PageTodo = {
  done: boolean;
  text: string;
  start: string;
  end: string;
};

/** 从检索正文里抽出待办，避免问答只拿到网关检索到的别的材料 */
export function pageTodos(docs: SearchDoc[]): { title: string; items: PageTodo[] }[] {
  const pages: { title: string; items: PageTodo[] }[] = [];
  for (const doc of docs) {
    const items: PageTodo[] = [];
    for (const part of doc.text.split(TODO_MARK)) {
      const match = part.trim().match(/^(未完成|已完成) 待办任务 todo ([\s\S]*)$/);
      if (!match) {
        continue;
      }
      let text = match[2].trim();
      let start = "";
      let end = "";
      const range = text.match(/^(.*?) (\d{4}-\d{2}-\d{2}|\?)至(\d{4}-\d{2}-\d{2}|\?)$/);
      if (range) {
        text = range[1].trim();
        start = range[2] === "?" ? "" : range[2];
        end = range[3] === "?" ? "" : range[3];
      }
      if (!text && !start && !end) {
        continue;
      }
      items.push({ done: match[1] === "已完成", text, start, end });
    }
    if (items.length) {
      pages.push({ title: doc.title, items });
    }
  }
  return pages;
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
      case "attachment":
        parts.push(plain(data.name));
        break;
      case "todo":
        parts.push(
          ...((data.items as { text?: string; done?: boolean; start?: string; end?: string }[] | undefined) ?? []).map(
            (item) => todoLine(item),
          ),
        );
        break;
    }
  }
  return parts.map((part) => part.trim()).filter(Boolean).join(" ");
}

async function toDoc(session: RemoteSession | null, id: string, updatedAt: string, body: EditorJsDocument): Promise<SearchDoc> {
  const text = documentText(body);
  const { attachmentBodyText } = await import("./fileText");
  const files = await attachmentBodyText(session, body);
  return { id, title: titleFromBody(body), text: files ? `${text}\n${files}` : text, updatedAt };
}

const remoteCache = new Map<string, SearchDoc>();

async function loadRemoteDocs(session: RemoteSession, nodes: PageNode[]): Promise<SearchDoc[]> {
  const key = (id: string) => `${session.username}:${id}:files`;
  const stale = nodes.filter((node) => remoteCache.get(key(node.id))?.updatedAt !== node.updatedAt);
  let cursor = 0;
  const worker = async () => {
    while (cursor < stale.length) {
      const node = stale[cursor++];
      try {
        const page = await loadRemote(session, node.id);
        remoteCache.set(key(node.id), await toDoc(session, node.id, node.updatedAt, page.body));
      } catch {
        remoteCache.set(key(node.id), { id: node.id, title: node.title, text: "", updatedAt: node.updatedAt });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, stale.length) }, worker));
  return nodes.map((node) => remoteCache.get(key(node.id))).filter((doc): doc is SearchDoc => Boolean(doc));
}

/** 远程页面第一次检索时逐篇拉正文和附件文本，之后按 updatedAt 只刷新改过的。未登录不检索远程。 */
export function loadSearchDocs(session: RemoteSession | null, nodes: PageNode[]): Promise<SearchDoc[]> {
  if (!session) {
    return Promise.all(readAllLocal().map((page) => toDoc(null, page.id, page.updatedAt ?? "", page.body)));
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

const WIKI_STOP = new Set([
  "的", "了", "是", "在", "和", "与", "或", "我", "你", "吗", "呢", "吧", "啊", "请", "什么", "怎么", "如何", "哪些",
  "一个", "这个", "那个", "the", "a", "an", "of", "to", "and", "or", "is", "what", "how", "for",
]);

function isTodoTerm(term: string): boolean {
  return term === "待办" || term === "未完成" || term === "已完成" || term === "todo" || term === "任务";
}

function wikiTerms(query: string): string[] {
  const parts = query
    .trim()
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((part) => part.length >= 2 && !WIKI_STOP.has(part));
  const terms: string[] = [];
  for (const part of parts) {
    if (/[\u4e00-\u9fff]/.test(part) && part.length > 4) {
      for (let i = 0; i < part.length - 1 && terms.length < 24; i += 1) {
        const gram = part.slice(i, i + 2);
        if (!WIKI_STOP.has(gram)) {
          terms.push(gram);
        }
      }
    } else {
      terms.push(part);
    }
  }
  return [...new Set(terms)].slice(0, 24);
}

function excerptAround(text: string, term: string): string {
  const lower = text.toLocaleLowerCase();
  const index = term ? lower.indexOf(term) : 0;
  const start = Math.max(0, (index < 0 ? 0 : index) - 180);
  const slice = text.slice(start, start + 1200).trim();
  return `${start > 0 ? "…" : ""}${slice}${start + 1200 < text.length ? "…" : ""}`;
}

function withAttachmentText(text: string, excerpt: string): string {
  const marker = text.indexOf("\n附件 ");
  if (marker < 0) {
    return excerpt;
  }
  const files = text.slice(marker, marker + 4000).trim();
  if (!files || excerpt.includes(files.slice(0, 48))) {
    return excerpt;
  }
  return `${excerpt}\n${files}`.slice(0, 5000);
}

export type WikiHit = { id: string; title: string; excerpt: string };

/** 整句提问：按词命中打分，不要求每个词都出现 */
export function retrieveWiki(docs: SearchDoc[], query: string, limit = 6): WikiHit[] {
  const terms = wikiTerms(query);
  if (terms.length === 0) {
    return [];
  }
  const scored: { hit: WikiHit; score: number }[] = [];
  for (const doc of docs) {
    const title = doc.title.toLocaleLowerCase();
    const text = doc.text.toLocaleLowerCase();
    let score = 0;
    let first = "";
    for (const term of terms) {
      const inTitle = title.includes(term);
      const inText = text.includes(term);
      if (inTitle) {
        score += 8;
      }
      if (inText) {
        score += 1;
        if (!first || !text.includes(first) || (isTodoTerm(term) && !isTodoTerm(first))) {
          first = term;
        }
      } else if (!first && inTitle) {
        first = term;
      }
    }
    if (score <= 0) {
      continue;
    }
    scored.push({
      hit: {
        id: doc.id,
        title: doc.title,
        excerpt: withAttachmentText(doc.text, excerptAround(doc.text, first)),
      },
      score,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((item) => item.hit);
}

/** 用编辑器里尚未保存的正文盖住同一页的索引，避免刚写的待办检索不到 */
export function withLiveDocument(
  docs: SearchDoc[],
  live: { id: string; title: string; body: EditorJsDocument; updatedAt?: string } | null,
): SearchDoc[] {
  if (!live) {
    return docs;
  }
  const text = documentText(live.body);
  const index = docs.findIndex((doc) => doc.id === live.id);
  const previous = index >= 0 ? docs[index] : undefined;
  const marker = previous?.text.indexOf("\n附件 ") ?? -1;
  const files = previous && marker >= 0 ? previous.text.slice(marker) : "";
  const next: SearchDoc = {
    id: live.id,
    title: live.title || previous?.title || "",
    text: `${text}${files}`,
    updatedAt: live.updatedAt || previous?.updatedAt || "",
  };
  if (index < 0) {
    return [next, ...docs];
  }
  const copy = docs.slice();
  copy[index] = next;
  return copy;
}
