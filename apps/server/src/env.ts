import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根：可用 REPO_ROOT 覆盖（Docker / 非标准布局） */
export const repoRoot = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(here, "../../..");

dotenv.config({ path: path.join(repoRoot, ".env") });

const isProd = (process.env.NODE_ENV ?? "development") === "production";

const WEAK_JWT = new Set(["dev-only-change-me", "please-change-this-to-a-long-random-string", "secret", "change-me"]);
const WEAK_PASSWORD = new Set(["changeme", "password", "admin", "123456"]);
const WEAK_DOCS_KEY = new Set(["dev-docs-key", "changeme", "secret", "docs-key"]);

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? (isProd ? undefined : fallback);
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function requireSecret(name: string, fallback: string, weak: Set<string>, minLen: number): string {
  const value = required(name, fallback);
  if (isProd && (weak.has(value) || value.length < minLen)) {
    throw new Error(`生产环境请设置足够强的 ${name}（勿用默认值，长度 ≥ ${minLen}）`);
  }
  return value;
}

function resolveDocsServiceKey(): string {
  const fallback = "dev-docs-key";
  // 仅 docs 后端在生产强制强密钥；local 模式可保留弱默认
  if (resolveContentBackend() === "docs") {
    return requireSecret("DOCS_SERVICE_KEY", fallback, WEAK_DOCS_KEY, 16);
  }
  return process.env.DOCS_SERVICE_KEY ?? fallback;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

/**
 * 内容存储后端：
 * - local / express / sqlite → 本机 Express + SQLite（默认）
 * - docs / api / remote → 远程文档服务 API
 */
export function resolveContentBackend(
  raw = process.env.CONTENT_BACKEND ?? process.env.DATA_BACKEND ?? "local",
): "local" | "docs" {
  const value = String(raw).trim().toLowerCase();
  if (value === "docs" || value === "api" || value === "remote") {
    return "docs";
  }
  return "local";
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  /** local=本机 SQLite；docs=远程文档 API */
  contentBackend: resolveContentBackend(),
  databasePath: resolveFromRoot(process.env.DATABASE_PATH ?? "./data/blog.db"),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR ?? "./data/uploads"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  jwtSecret: requireSecret("JWT_SECRET", "dev-only-change-me", WEAK_JWT, 24),
  adminUsername: required("ADMIN_USERNAME", "admin"),
  adminPassword: requireSecret("ADMIN_PASSWORD", "changeme", WEAK_PASSWORD, 8),
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS ?? 7),
  isProd,
  ossAccessKeyId: process.env.OSS_ACCESS_KEY_ID ?? "",
  ossAccessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? "",
  ossRegion: process.env.OSS_REGION ?? "",
  ossBucket: process.env.OSS_BUCKET ?? "",
  ossPrefix: (process.env.OSS_PREFIX ?? "blog").replace(/^\/+|\/+$/g, ""),
  ossPublicBase: (process.env.OSS_PUBLIC_BASE ?? "").replace(/\/$/, ""),
  siteUrl: (process.env.SITE_URL ?? "").replace(/\/$/, ""),
  docsBaseUrl: (process.env.DOCS_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""),
  docsServiceKey: resolveDocsServiceKey(),
  docsAppCode: process.env.DOCS_APP_CODE ?? "blog",
  docsTimeoutMs: Number(process.env.DOCS_TIMEOUT_MS ?? 15_000),
  /** OpenAI 兼容接口（也可填 DeepSeek / 通义 / 本地代理等） */
  aiApiBase: (process.env.AI_API_BASE ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
};

export function isDocsBackend(): boolean {
  return env.contentBackend === "docs";
}

export function isLocalBackend(): boolean {
  return env.contentBackend === "local";
}

export function ossConfigured(): boolean {
  return Boolean(env.ossAccessKeyId && env.ossAccessKeySecret && env.ossRegion && env.ossBucket);
}

export function aiConfigured(): boolean {
  return Boolean(env.aiApiKey.trim());
}

export function ensureDataDirs(): void {
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "data/logs"), { recursive: true });
}
