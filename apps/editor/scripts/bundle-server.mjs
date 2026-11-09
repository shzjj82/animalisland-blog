import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "../..");
const outfile = path.join(root, "src-tauri/resources/desktop-server.mjs");
const DEFAULT_GATEWAY = "https://api.championsea.online";

function readGatewayFromEnvFile(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
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
      if (key !== "GATEWAY_BASE_URL" && key !== "NEST_BASE_URL" && key !== "DESKTOP_GATEWAY_BASE") {
        continue;
      }
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return value.replace(/\/$/, "");
    }
  } catch {
    // ignore
  }
  return "";
}

function isLocalGateway(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local")
    );
  } catch {
    return false;
  }
}

const allowLocal = process.env.DESKTOP_ALLOW_LOCAL_GATEWAY === "1";
const rawGateway = (
  process.env.DESKTOP_GATEWAY_BASE ||
  process.env.GATEWAY_BASE_URL ||
  process.env.NEST_BASE_URL ||
  readGatewayFromEnvFile(path.join(repoRoot, ".env")) ||
  DEFAULT_GATEWAY
).replace(/\/$/, "");

let gatewayBase = rawGateway;
if (isLocalGateway(gatewayBase) && !allowLocal) {
  console.warn(
    `[bundle-server] 拒绝把本机网关烤进桌面包：${gatewayBase}\n` +
      `  将改用 ${DEFAULT_GATEWAY}（本地调试可设 DESKTOP_ALLOW_LOCAL_GATEWAY=1）`,
  );
  gatewayBase = DEFAULT_GATEWAY;
}

await build({
  entryPoints: [path.join(root, "server/desktopMain.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "info",
  define: {
    "process.env.DESKTOP_GATEWAY_BASE": JSON.stringify(gatewayBase),
  },
});

console.log(`desktop-server gateway → ${gatewayBase}`);
