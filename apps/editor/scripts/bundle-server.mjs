import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "../..");
const outfile = path.join(root, "src-tauri/resources/desktop-server.mjs");

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
      if (key !== "GATEWAY_BASE_URL" && key !== "NEST_BASE_URL") {
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

const gatewayBase = (
  process.env.GATEWAY_BASE_URL ||
  process.env.NEST_BASE_URL ||
  readGatewayFromEnvFile(path.join(repoRoot, ".env")) ||
  "https://api.championsea.online"
).replace(/\/$/, "");

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
