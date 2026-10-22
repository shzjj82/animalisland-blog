#!/usr/bin/env bash
# 把 GitHub Release 里的桌面安装包同步到线上服务器的 downloads 目录
#
# 背景：CI 只负责产出安装包并挂到 Release，服务器上的 /downloads 需要单独拉取。
# 本机直连 GitHub 下载很慢（曾有 16/56 错误、20 KB/s 量级），而服务器到 GitHub 是 6 MB/s，
# 所以这里的下载动作全部在服务器侧执行，本机只发一条 ssh。
#
# 用法：
#   bash scripts/sync-editor-release.sh              # 版本号取 apps/editor/package.json
#   bash scripts/sync-editor-release.sh 0.0.2        # 指定版本
#   KEEP_OLD=1 bash scripts/sync-editor-release.sh   # 不清理旧版本安装包
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GH_REPO="${GH_REPO:-shzjj82/animalisland-blog}"

SSH_HOST="${DEPLOY_SSH_HOST:-106.15.235.175}"
SSH_USER="${DEPLOY_SSH_USER:-root}"
SSH_PORT="${DEPLOY_SSH_PORT:-1022}"
SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"

REMOTE_DIR="${EDITOR_REMOTE_DIR:-/opt/apps/editor}"
REMOTE_PORT="${EDITOR_REMOTE_PORT:-8082}"

VER="${1:-}"
if [[ -z "$VER" ]]; then
  VER="$(node -p "require('$REPO_ROOT/apps/editor/package.json').version")"
fi
VER="${VER#v}"

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=15)
[[ -f "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")

echo "▶ 从 GitHub Release v$VER 同步安装包到 $SSH_HOST:$REMOTE_DIR/downloads"

ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
  "node - '$VER' '$GH_REPO' '$REMOTE_DIR' '${KEEP_OLD:-0}'" <<'REMOTE_NODE'
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [ver, repo, remoteDir, keepOld] = process.argv.slice(2);
const dir = path.join(remoteDir, "downloads");
const api = `https://api.github.com/repos/${repo}/releases/tags/v${ver}`;

function apiGet(url) {
  const out = execFileSync(
    "curl",
    ["-sSL", "--fail", "--retry", "3", "--retry-delay", "2",
     "-H", "Accept: application/vnd.github+json",
     "-H", "User-Agent: editor-release-sync", url],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

let release;
try {
  release = apiGet(api);
} catch (err) {
  console.error(`✗ 读不到 Release v${ver}：${String(err.message).split("\n")[0]}`);
  console.error(`  先确认 CI 已跑完：https://github.com/${repo}/releases/tag/v${ver}`);
  process.exit(1);
}

const assets = (release.assets || []).filter((a) => /\.(dmg|zip|exe)$/i.test(a.name));
if (!assets.length) {
  console.error(`✗ Release v${ver} 里没有 dmg/zip/exe 产物`);
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });
const wanted = new Set();

for (const a of assets) {
  const dest = path.join(dir, a.name);
  wanted.add(a.name);
  const exists = fs.existsSync(dest) ? fs.statSync(dest).size : -1;
  if (exists === a.size) {
    console.log(`= ${a.name}  已是最新（${a.size} B）`);
    continue;
  }
  console.log(`↓ ${a.name}  ${a.size} B`);
  execFileSync(
    "curl",
    ["-sSL", "--fail", "--retry", "3", "--retry-delay", "2",
     "-H", "Accept: application/octet-stream",
     "-H", "User-Agent: editor-release-sync",
     "-o", `${dest}.part`, `https://api.github.com/repos/${repo}/releases/assets/${a.id}`],
    { stdio: "inherit" },
  );
  fs.renameSync(`${dest}.part`, dest);
  const got = fs.statSync(dest).size;
  if (got !== a.size) {
    console.error(`✗ ${a.name} 大小不符：期望 ${a.size}，实际 ${got}`);
    process.exit(1);
  }
}

if (keepOld !== "1") {
  for (const f of fs.readdirSync(dir)) {
    if (!wanted.has(f) && /\.(dmg|zip|exe)$/i.test(f)) {
      fs.unlinkSync(path.join(dir, f));
      console.log(`- 清理旧产物 ${f}`);
    }
  }
}

console.log("--- 当前 downloads:");
for (const f of fs.readdirSync(dir).sort()) {
  console.log(`  ${String(fs.statSync(path.join(dir, f)).size).padStart(10)}  ${f}`);
}
REMOTE_NODE

echo "▶ 校验线上 /version.json"
curl -s "http://$SSH_HOST:$REMOTE_PORT/version.json" | node -e '
let s = "";
process.stdin.on("data", (c) => (s += c));
process.stdin.on("end", () => {
  const j = JSON.parse(s);
  console.log(`  version = ${j.version}`);
  for (const f of j.files || []) {
    console.log(`  ${f.available ? "✓" : "✗"} ${f.name}  ${f.size ?? "-"}`);
  }
  const missing = (j.files || []).filter((f) => !f.available && !f.optional);
  if (missing.length) {
    console.log("  ⚠ 有必需产物未就位。若版本号与刚同步的不一致，执行 pnpm deploy:editor 重新发布页面。");
  }
});
'

echo "▶ 完成"
