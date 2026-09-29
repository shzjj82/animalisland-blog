import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const out = path.join(releaseDir, "wiki-agent-web");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(out, "dist"), { recursive: true });
fs.copyFileSync(path.join(root, "src-tauri/resources/desktop-server.mjs"), path.join(out, "server.mjs"));
fs.writeFileSync(
  path.join(out, "start.mjs"),
  `import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [path.join(root, "server.mjs"), path.join(root, "dist")], {
  stdio: ["ignore", "pipe", "inherit"],
});
let announced = false;
child.stdout.on("data", (chunk) => {
  if (announced) {
    return;
  }
  const match = chunk.toString().match(/PORT (\\d+)/);
  if (match) {
    announced = true;
    console.log(\`http://127.0.0.1:\${match[1]}/\`);
  }
});
const stop = () => child.kill();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
`,
);

const zipPath = path.join(releaseDir, "wiki-agent-web.zip");
fs.rmSync(zipPath, { force: true });
const zip = spawnSync("zip", ["-r", "-q", zipPath, "wiki-agent-web"], { cwd: releaseDir, stdio: "inherit" });
if (zip.status !== 0) {
  console.error("web 目录已生成，但没有打成 zip");
  process.exit(zip.status ?? 1);
}
console.log(zipPath);
