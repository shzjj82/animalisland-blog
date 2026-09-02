import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "../../..");

dotenv.config({ path: path.join(repoRoot, ".env") });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`缺少环境变量 ${name}`);
  }
  return value;
}

function resolveFromRoot(p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  databasePath: resolveFromRoot(process.env.DATABASE_PATH ?? "./data/blog.db"),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR ?? "./data/uploads"),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  jwtSecret: required("JWT_SECRET", "dev-only-change-me"),
  adminUsername: required("ADMIN_USERNAME", "admin"),
  adminPassword: required("ADMIN_PASSWORD", "changeme"),
  jwtExpiresDays: Number(process.env.JWT_EXPIRES_DAYS ?? 7),
  isProd: (process.env.NODE_ENV ?? "development") === "production",
};

export function ensureDataDirs(): void {
  fs.mkdirSync(path.dirname(env.databasePath), { recursive: true });
  fs.mkdirSync(env.uploadDir, { recursive: true });
  fs.mkdirSync(path.join(repoRoot, "data/logs"), { recursive: true });
}
