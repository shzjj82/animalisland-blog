import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outfile = path.join(root, "src-tauri/resources/desktop-server.mjs");

await build({
  entryPoints: [path.join(root, "server/desktopMain.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  logLevel: "info",
});
