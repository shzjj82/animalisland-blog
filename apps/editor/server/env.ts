import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AI_KEYS = ["AI_API_BASE", "AI_API_KEY", "AI_MODEL", "AI_TIMEOUT_MS"] as const;

function applyEnvFile(file: string): void {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    if (!AI_KEYS.includes(key as (typeof AI_KEYS)[number])) {
      continue;
    }
    if (process.env[key]) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function findEnvFile(start: string): string | null {
  let dir = path.resolve(start);
  for (let i = 0; i < 14; i += 1) {
    const candidate = path.join(dir, ".env");
    try {
      if (fs.statSync(candidate).isFile() && fs.readFileSync(candidate, "utf8").includes("AI_API_KEY")) {
        return candidate;
      }
    } catch {
      // 这一层没有配置文件
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

function loadAiEnv(): void {
  const explicit = process.env.EDITOR_ENV_FILE;
  if (explicit) {
    applyEnvFile(explicit);
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const argvDir = process.argv[1] ? path.dirname(path.resolve(process.argv[1])) : "";
  const starts = [scriptDir, path.dirname(process.execPath), argvDir];
  for (const start of starts) {
    if (!start) {
      continue;
    }
    const file = findEnvFile(start);
    if (file) {
      applyEnvFile(file);
      return;
    }
  }
}

loadAiEnv();

export const env = {
  aiApiBase: (process.env.AI_API_BASE ?? "https://api.openai.com/v1").replace(/\/$/, ""),
  aiApiKey: process.env.AI_API_KEY ?? "",
  aiModel: process.env.AI_MODEL ?? "gpt-4o-mini",
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS ?? 90_000),
};

export function aiConfigured(): boolean {
  return Boolean(env.aiApiKey.trim());
}
