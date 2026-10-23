import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * 版本号统一入口：只改 package.json 与 src-tauri/tauri.conf.json 两个地方，
 * 打包产物名、下载页展示的版本号都由它们推导。
 *
 * 用法：
 *   node scripts/set-version.mjs patch            # 0.0.1 -> 0.0.2
 *   node scripts/set-version.mjs minor            # 0.1.0
 *   node scripts/set-version.mjs major            # 1.0.0
 *   node scripts/set-version.mjs 0.2.0            # 指定版本
 *   node scripts/set-version.mjs patch --tag      # 顺带打 git tag v0.0.2
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgFile = path.join(root, "package.json");
const tauriConfFile = path.join(root, "src-tauri/tauri.conf.json");
// 下载页里 JS 没跑起来时的兜底内容（文件名、OSS 直链、页脚版本）是写死的，
// 跟着版本号一起换，不然发完新版页面还挂着上个版本的链接
const downloadPageFile = path.join(root, "public/download.html");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function bump(current, part) {
  const [major, minor, patch] = current.split(".").map((n) => Number(n) || 0);
  if (part === "major") return `${major + 1}.0.0`;
  if (part === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const arg = process.argv[2] || "patch";
const wantTag = process.argv.includes("--tag");

const pkg = readJson(pkgFile);
const current = String(pkg.version || "0.0.0");
const next = /^\d+\.\d+\.\d+/.test(arg) ? arg : bump(current, arg);

if (!/^\d+\.\d+\.\d+/.test(next)) {
  console.error(`版本号不合法：${next}`);
  process.exit(1);
}

pkg.version = next;
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

const confText = fs.readFileSync(tauriConfFile, "utf8");
fs.writeFileSync(tauriConfFile, confText.replace(/"version":\s*"[^"]+"/, `"version": "${next}"`));

if (fs.existsSync(downloadPageFile)) {
  const html = fs.readFileSync(downloadPageFile, "utf8");
  if (html.includes(current)) {
    fs.writeFileSync(downloadPageFile, html.replaceAll(current, next));
    console.log(`public/download.html 里的 ${current} 已同步为 ${next}`);
  }
}

console.log(`${current} → ${next}`);
if (wantTag) {
  const tag = `v${next}`;
  const result = spawnSync("git", ["tag", "-a", tag, "-m", `release ${tag}`], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log(`tag ${tag} 已创建，git push origin ${tag} 触发打包`);
} else {
  console.log(`git tag v${next} && git push origin v${next} 触发 GitHub 打包`);
}
