import Database from "better-sqlite3";
import { ensureDataDirs, env } from "./env.js";

ensureDataDirs();

export const db = new Database(env.databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    cover_url TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    draft INTEGER NOT NULL DEFAULT 1,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_type_published
    ON posts (type, draft, published_at);

  CREATE TABLE IF NOT EXISTS site (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    about_name TEXT NOT NULL,
    about_body TEXT NOT NULL,
    about_avatar TEXT NOT NULL,
    skills TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    hint TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL,
    kind TEXT NOT NULL,
    nav INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_categories_sort
    ON categories (sort, created_at);
`);

db.prepare("UPDATE posts SET type = 'life' WHERE type = 'photo' OR type = 'photos'").run();

function hasColumn(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

if (!hasColumn("posts", "page_kind")) {
  db.exec(`ALTER TABLE posts ADD COLUMN page_kind TEXT NOT NULL DEFAULT 'article'`);
}
if (!hasColumn("posts", "parent_id")) {
  db.exec(`ALTER TABLE posts ADD COLUMN parent_id TEXT`);
}
if (!hasColumn("posts", "tree_sort")) {
  db.exec(`ALTER TABLE posts ADD COLUMN tree_sort INTEGER NOT NULL DEFAULT 0`);
}
if (!hasColumn("posts", "props")) {
  db.exec(`ALTER TABLE posts ADD COLUMN props TEXT NOT NULL DEFAULT '{}'`);
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_page_kind ON posts (page_kind, tree_sort);
  CREATE INDEX IF NOT EXISTS idx_posts_parent ON posts (parent_id, tree_sort);
`);
