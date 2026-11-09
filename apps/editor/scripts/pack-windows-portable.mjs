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

const nodeSrc = path.join(root, "src-tauri/resources/node.exe");
const serverSrc = path.join(root, "src-tauri/resources/desktop-server.mjs");
const distSrc = path.join(root, "dist");
for (const file of [nodeSrc, serverSrc]) {
  if (!fs.existsSync(file)) {
    console.error(`缺少 ${file}，先跑 pnpm build:desktop`);
    process.exit(1);
  }
}
if (!fs.existsSync(distSrc) || !fs.existsSync(path.join(distSrc, "index.html"))) {
  console.error(`缺少前端产物 ${distSrc}，先跑 pnpm build:desktop`);
  process.exit(1);
}

const baked = fs.readFileSync(serverSrc, "utf8");
if (
  baked.includes("DESKTOP_GATEWAY_BASE") &&
  (baked.includes("://127.0.0.1") || baked.includes("://localhost"))
) {
  console.error("desktop-server.mjs 烤进了本机网关，请用生产 GATEWAY 重新 bundle-server 后再打包");
  process.exit(1);
}

const out = path.join(releaseDir, "wiki-agent-windows");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(exe, path.join(out, "wiki-agent.exe"));

const runtime = path.join(out, "runtime");
fs.mkdirSync(runtime, { recursive: true });
fs.copyFileSync(nodeSrc, path.join(runtime, "wiki-agent-service.exe"));
fs.copyFileSync(serverSrc, path.join(runtime, "desktop-server.mjs"));
fs.cpSync(distSrc, path.join(runtime, "dist"), { recursive: true });

fs.writeFileSync(
  path.join(out, "请先阅读.txt"),
  [
    "wiki-agent 便携版使用说明",
    "",
    "1. 请解压整个文件夹后再使用，不要只拷贝 wiki-agent.exe。",
    "2. 正确结构：",
    "   wiki-agent-windows/",
    "     wiki-agent.exe",
    "     runtime/",
    "       wiki-agent-service.exe",
    "       desktop-server.mjs",
    "       dist/",
    "3. 双击 wiki-agent.exe 启动。联网依赖 runtime 里的本机服务。",
    "4. 若提示无法启动 / 无法联网：",
    "   - 确认 runtime 目录完整",
    "   - 把 wiki-agent-service.exe 加入杀软白名单并允许联网",
    "   - 查看同目录 wiki-agent-desktop.log / wiki-agent-service.log",
    "",
  ].join("\r\n"),
  "utf8",
);

const required = [
  path.join(out, "wiki-agent.exe"),
  path.join(runtime, "wiki-agent-service.exe"),
  path.join(runtime, "desktop-server.mjs"),
  path.join(runtime, "dist", "index.html"),
];
for (const file of required) {
  if (!fs.existsSync(file)) {
    console.error(`打包校验失败，缺少 ${file}`);
    process.exit(1);
  }
}

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
  try {
    const result = spawnSync(command, args, { cwd: releaseDir, stdio: "pipe" });
    if (result.status === 0 && fs.existsSync(zipPath)) {
      console.log(zipPath);
      process.exit(0);
    }
  } catch {
    // 该命令不存在，换下一个
  }
}
console.error("目录已生成，但没有打成 zip");
process.exit(1);
