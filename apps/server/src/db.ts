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
`);
