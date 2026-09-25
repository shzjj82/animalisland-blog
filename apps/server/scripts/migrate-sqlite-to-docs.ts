/**
 * 把本地 SQLite 里的分类和文档灌进文档服务。
 *
 * 用法（仓库根）：
 *   pnpm migrate:docs
 *   pnpm migrate:docs -- --dry-run
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const dryRun = process.argv.includes("--dry-run");
const docsBaseUrl = (process.env.DOCS_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const docsServiceKey = process.env.DOCS_SERVICE_KEY ?? "dev-docs-key";
const docsAppCode = process.env.DOCS_APP_CODE ?? "blog";
const docsTimeoutMs = Number(process.env.DOCS_TIMEOUT_MS ?? 15_000);
const databasePath = path.isAbsolute(process.env.DATABASE_PATH ?? "")
  ? (process.env.DATABASE_PATH as string)
  : path.resolve(repoRoot, process.env.DATABASE_PATH ?? "./data/blog.db");

type Envelope<T> = { success?: boolean; code?: number; message?: string; data?: T };

async function request<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  const url = new URL(`${docsBaseUrl}${pathname}`);
  url.searchParams.set("appCode", docsAppCode);
  const payload =
    body && typeof body === "object"
      ? { ...(body as Record<string, unknown>), appCode: docsAppCode }
      : body;
  const timeoutMs = Number.isFinite(docsTimeoutMs) && docsTimeoutMs > 0 ? docsTimeoutMs : 15_000;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-docs-key": docsServiceKey,
      },
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`${method} ${pathname} -> DOCS_TIMEOUT`);
    }
    throw err;
  }
  const json = (await res.json()) as Envelope<T>;
  if (!json?.success) {
    throw new Error(`${method} ${pathname} -> ${json?.code ?? res.status} ${json?.message ?? "FAIL"}`);
  }
  return json.data as T;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parentFirst<T extends { id: string; parent_id: string | null }>(rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const seen = new Set<string>();
  const out: T[] = [];
  const visit = (row: T) => {
    if (seen.has(row.id)) {
      return;
    }
    if (row.parent_id && byId.has(row.parent_id)) {
      visit(byId.get(row.parent_id) as T);
    }
    seen.add(row.id);
    out.push(row);
  };
  for (const row of rows) {
    visit(row);
  }
  return out;
}

function logOp(kind: string, action: "create" | "update", slug: string) {
  const prefix = dryRun ? "[dry-run] " : "";
  console.log(`${prefix}${kind} ${action} ${slug}`);
}

async function main() {
  console.log(`SQLite: ${databasePath}`);
  console.log(`Docs:   ${docsBaseUrl}`);
  if (dryRun) {
    console.log("Mode:   dry-run（只打印将 create/update 的项，不发写请求）");
  }
  const db = new Database(databasePath, { readonly: true });

  const categories = db
    .prepare(
      `SELECT id, slug, name, hint, color, kind, nav, sort FROM categories ORDER BY sort ASC, created_at ASC`,
    )
    .all() as Array<{
    id: string;
    slug: string;
    name: string;
    hint: string;
    color: string;
    kind: string;
    nav: number;
    sort: number;
  }>;

  const existingCats = (
    await request<{ categories: Array<{ id: string; slug: string }> }>("GET", "/docs/categories")
  ).categories;
  const catBySlug = new Map(existingCats.map((item) => [item.slug, item]));

  for (const cat of categories) {
    const body = {
      id: cat.id,
      slug: cat.slug,
      name: cat.name,
      hint: cat.hint,
      color: cat.color,
      kind: cat.kind,
      nav: Boolean(cat.nav),
      sort: cat.sort,
    };
    const found = catBySlug.get(cat.slug);
    if (found) {
      if (!dryRun) {
        await request("PUT", `/docs/categories/${found.id}`, body);
      }
      logOp("category", "update", cat.slug);
    } else {
      if (!dryRun) {
        await request("POST", "/docs/categories", body);
      }
      logOp("category", "create", cat.slug);
    }
  }

  const posts = db
    .prepare(
      `SELECT id, slug, title, type, page_kind, parent_id, tree_sort, summary, cover_url, props, body, draft
       FROM posts`,
    )
    .all() as Array<{
    id: string;
    slug: string;
    title: string;
    type: string;
    page_kind: string;
    parent_id: string | null;
    tree_sort: number;
    summary: string;
    cover_url: string;
    props: string;
    body: string;
    draft: number;
  }>;

  const aboutExisting = (
    await request<{ about: { id: string } | null }>("GET", "/docs/posts/workspace/specials")
  ).about;

  for (const post of parentFirst(posts)) {
    const body = {
      id: post.page_kind === "about" && aboutExisting ? aboutExisting.id : post.id,
      slug: post.slug,
      title: post.title,
      type: post.type,
      pageKind: post.page_kind,
      parentId: post.parent_id,
      treeSort: post.tree_sort,
      summary: post.summary,
      coverUrl: post.cover_url,
      props: parseJson<Record<string, unknown>>(post.props, {}),
      body: parseJson(post.body, { time: Date.now(), version: "2.30.7", blocks: [] }),
      draft: Boolean(post.draft),
    };

    if (post.page_kind === "about" && aboutExisting) {
      if (!dryRun) {
        await request("PUT", `/docs/posts/${aboutExisting.id}`, body);
      }
      logOp("about", "update", post.slug);
      continue;
    }

    let exists = false;
    try {
      await request("GET", `/docs/posts/id/${post.id}`);
      exists = true;
    } catch {
      exists = false;
    }
    if (exists) {
      if (!dryRun) {
        await request("PUT", `/docs/posts/${post.id}`, body);
      }
      logOp("post", "update", post.slug);
    } else {
      if (!dryRun) {
        await request("POST", "/docs/posts", body);
      }
      logOp("post", "create", post.slug);
    }
  }

  const site = db
    .prepare(`SELECT about_name, about_body, about_avatar, skills FROM site WHERE id = 1`)
    .get() as
    | { about_name: string; about_body: string; about_avatar: string; skills: string }
    | undefined;
  if (site) {
    if (!dryRun) {
      await request("PUT", "/docs/site", {
        name: site.about_name,
        avatar: site.about_avatar,
        body: parseJson(site.about_body, { time: Date.now(), version: "2.30.7", blocks: [] }),
        skills: parseJson(site.skills, []),
      });
    }
    logOp("site", "update", "about");
  }

  db.close();
  console.log(dryRun ? "dry-run 完成（未写入）" : "导入完成");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
