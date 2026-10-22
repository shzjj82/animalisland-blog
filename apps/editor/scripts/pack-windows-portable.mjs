import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Windows 便携版压缩包：exe + node.exe + 本地服务脚本 + 前端产物，解压即用。
 * 本地打包和 GitHub Actions 都跑这个脚本，保证文件名一致：wiki-agent-<version>-windows.zip
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const version = String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0");

/** 交叉编译放在 target/<triple>/release，Windows 本机编译放在 target/release */
const exe =
  [
    path.join(root, "src-tauri/target/x86_64-pc-windows-msvc/release/wiki-agent.exe"),
    path.join(root, "src-tauri/target/release/wiki-agent.exe"),
  ].find((file) => fs.existsSync(file)) ?? path.join(root, "src-tauri/target/x86_64-pc-windows-msvc/release/wiki-agent.exe");
if (!fs.existsSync(exe)) {
  console.error(`没有找到 wiki-agent.exe，先跑 tauri build（Windows 或 --target x86_64-pc-windows-msvc）`);
  process.exit(1);
}

const out = path.join(releaseDir, "wiki-agent-windows");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(exe, path.join(out, "wiki-agent.exe"));

const runtime = path.join(out, "runtime");
fs.mkdirSync(runtime, { recursive: true });
fs.copyFileSync(path.join(root, "src-tauri/resources/node.exe"), path.join(runtime, "wiki-agent-service.exe"));
fs.copyFileSync(path.join(root, "src-tauri/resources/desktop-server.mjs"), path.join(runtime, "desktop-server.mjs"));
fs.cpSync(path.join(root, "dist"), path.join(runtime, "dist"), { recursive: true });

const zipName = `wiki-agent-${version}-windows.zip`;
const zipPath = path.join(releaseDir, zipName);
fs.rmSync(zipPath, { force: true });

/** macOS 用 ditto（最稳），有 zip 就用 zip，Windows Runner 落到 tar / 7z */
const attempts = [
  ["ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", "wiki-agent-windows", zipPath]],
  ["zip", ["-r", "-q", zipPath, "wiki-agent-windows"]],
  ["tar", ["-a", "-c", "-f", zipPath, "wiki-agent-windows"]],
  ["7z", ["a", "-bso0", zipPath, "wiki-agent-windows"]],
];
for (const [command, args] of attempts) {
  const result = spawnSync(command, args, { cwd: releaseDir, stdio: "pipe" });
  if (result.status === 0 && fs.existsSync(zipPath)) {
    console.log(zipPath);
    process.exit(0);
  }
}
console.error("目录已生成，但没有打成 zip");
process.exit(1);
