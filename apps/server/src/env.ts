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

const WEAK_SERVICE_KEY = new Set(["dev-docs-key", "changeme", "secret", "docs-key"]);

/** 是否显式配置了 Nest 网关地址 */
export function hasGatewayConfig(): boolean {
  return Boolean(
    process.env.GATEWAY_BASE_URL?.trim() ||
      process.env.NEST_BASE_URL?.trim() ||
      process.env.AUTH_BASE_URL?.trim() ||
      process.env.DOCS_BASE_URL?.trim(),
  );
}

/**
 * 内容后端：
 * - 显式传入 raw（单测）时只解析别名
 * - 否则：配了 GATEWAY_* → Nest；CONTENT_BACKEND=docs|… → Nest；默认 local
 */
export function resolveContentBackend(raw?: string): "local" | "docs" {
  if (raw !== undefined) {
    const value = String(raw).trim().toLowerCase();
    if (
      value === "docs" ||
      value === "api" ||
      value === "remote" ||
      value === "nest" ||
      value === "gateway"
    ) {
      return "docs";
    }
    return "local";
  }
  if (hasGatewayConfig()) {
    return "docs";
  }
  const fromEnv = String(process.env.CONTENT_BACKEND ?? process.env.DATA_BACKEND ?? "local")
    .trim()
    .toLowerCase();
  if (
    fromEnv === "docs" ||
    fromEnv === "api" ||
    fromEnv === "remote" ||
    fromEnv === "nest" ||
    fromEnv === "gateway"
  ) {
    return "docs";
  }
  return "local";
}

function resolveGatewayBase(): string {
  const raw =
    process.env.GATEWAY_BASE_URL ||
    process.env.NEST_BASE_URL ||
    process.env.AUTH_BASE_URL ||
    process.env.DOCS_BASE_URL ||
    (resolveContentBackend() === "docs" ? "http://127.0.0.1:3000" : "");
  return raw.replace(/\/$/, "");
}

function resolveGatewayServiceKey(): string {
  const fallback = "dev-docs-key";
  const value = process.env.GATEWAY_SERVICE_KEY ?? process.env.DOCS_SERVICE_KEY ?? fallback;
  if (isProd && resolveContentBackend() === "docs" && (WEAK_SERVICE_KEY.has(value) || value.length < 16)) {
    throw new Error("生产环境请设置足够强的 GATEWAY_SERVICE_KEY（或 DOCS_SERVICE_KEY，勿用默认值，长度 ≥ 16）");
  }
  return value;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

const contentBackend = resolveContentBackend();
const gatewayBase = resolveGatewayBase();

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  /** local=本机 SQLite；docs=Nest 网关 */
  contentBackend,
  databasePath: resolveFromRoot(process.env.DATABASE_PATH ?? "./data/blog.db"),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR ?? "./data/uploads"),
  // 浏览器直连 API 才需要；经 Next 同源 /api 代理时可留空。开发默认对齐 WEB_PORT
  corsOrigin:
    process.env.CORS_ORIGIN ??
    (isProd ? "" : `http://localhost:${process.env.WEB_PORT ?? 5173}`),
  isProd,
  ossAccessKeyId: process.env.OSS_ACCESS_KEY_ID ?? "",
  ossAccessKeySecret: process.env.OSS_ACCESS_KEY_SECRET ?? "",
  ossRegion: process.env.OSS_REGION ?? "",
  ossBucket: process.env.OSS_BUCKET ?? "",
  ossPrefix: (process.env.OSS_PREFIX ?? "blog").replace(/^\/+|\/+$/g, ""),
  ossPublicBase: (process.env.OSS_PUBLIC_BASE ?? "").replace(/\/$/, ""),
  siteUrl: (process.env.SITE_URL ?? "").replace(/\/$/, ""),
  /** Nest 网关根地址（/auth/* + /docs/*） */
  gatewayBaseUrl: gatewayBase,
  /**
   * Nest 账密登录接入端编码（uc_clients.appCode），种子默认 web。
   * 一般不用配；仅多接入端时用 AUTH_APP_CODE 覆盖。
   */
  authAppCode: process.env.AUTH_APP_CODE ?? "web",
  /**
   * Nest 文档应用隔离码（doc_documents.app_code），本站固定 blog。
   * Nest 文档隔离编码（必填；服务端不再默认 blog）。多应用共库时用 DOCS_APP_CODE 覆盖。
   */
  docsAppCode: process.env.DOCS_APP_CODE ?? "blog",
  /** Nest 服务密钥（x-docs-key）；写操作优先用户 JWT。智能体聊天勿用此密钥。 */
  docsServiceKey: resolveGatewayServiceKey(),
  docsTimeoutMs: Number(process.env.GATEWAY_TIMEOUT_MS ?? process.env.DOCS_TIMEOUT_MS ?? 15_000),
  /** Nest 智能体业务码（X-Biz-Code）；聊天鉴权用用户 JWT，密钥只在 Nest agents */
  agentsBizCode: process.env.AGENTS_BIZ_CODE ?? process.env.DOCS_APP_CODE ?? "blog",
  agentsTimeoutMs: Number(process.env.AGENTS_TIMEOUT_MS ?? 90_000),
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

/** 智能体走 Nest 网关；未配 GATEWAY 则不可用（密钥不在 blog） */
export function aiConfigured(): boolean {
  return hasGatewayConfig() && Boolean(env.gatewayBaseUrl);
}

export function ensureDataDirs(): void {
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "data/logs"), { recursive: true });
}
