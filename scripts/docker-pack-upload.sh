#!/usr/bin/env bash
# 本机构建 Docker 镜像 → gzip 压缩 → 上传到服务器
# 变量来自：环境变量 / .env.deploy（默认）/ CLI，与项目 .env 无关
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT/.env.deploy}"

usage() {
  cat <<'EOF'
用法: scripts/docker-pack-upload.sh [选项]

构建（默认 amd64）镜像，gzip 打包并 scp 到服务器。

选项:
  --image NAME       镜像名:标签          (DEPLOY_IMAGE)
  --platform PLAT    buildx 平台          (DEPLOY_PLATFORM)
  --archive FILE     压缩包文件名         (DEPLOY_ARCHIVE)
  --out-dir DIR      本机输出目录         (DEPLOY_OUT_DIR)
  --host HOST        SSH 主机             (DEPLOY_SSH_HOST)
  --user USER        SSH 用户             (DEPLOY_SSH_USER)
  --port PORT        SSH 端口             (DEPLOY_SSH_PORT)
  --key PATH         SSH 私钥             (DEPLOY_SSH_KEY)
  --remote-dir DIR   远端目录             (DEPLOY_REMOTE_DIR)
  --env-file PATH    部署变量文件（非 .env）(DEPLOY_ENV_FILE)
  --no-build         跳过构建，只 save 已有镜像
  --no-upload        只打包，不上传
  -h, --help         帮助

环境变量也可直接 export；CLI 优先于文件与环境变量。
示例:
  cp .env.deploy.example .env.deploy   # 填 DEPLOY_SSH_HOST 等
  ./scripts/docker-pack-upload.sh
  ./scripts/docker-pack-upload.sh --host 1.2.3.4 --user ubuntu --no-upload
EOF
}

load_deploy_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # 只读 KEY=VALUE，忽略空行与 # 注释；不执行任意代码
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^(DEPLOY_[A-Z0-9_]+)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local val="${BASH_REMATCH[2]}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      # 已在环境里显式设置的不覆盖，便于 export 优先于文件
      if [[ -z "${!key+x}" ]]; then
        export "$key=$val"
      fi
    fi
  done <"$file"
}

NO_BUILD=0
NO_UPLOAD=0
CLI_IMAGE=""
CLI_PLATFORM=""
CLI_ARCHIVE=""
CLI_OUT_DIR=""
CLI_HOST=""
CLI_USER=""
CLI_PORT=""
CLI_KEY=""
CLI_REMOTE_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --image) CLI_IMAGE="$2"; shift 2 ;;
    --platform) CLI_PLATFORM="$2"; shift 2 ;;
    --archive) CLI_ARCHIVE="$2"; shift 2 ;;
    --out-dir) CLI_OUT_DIR="$2"; shift 2 ;;
    --host) CLI_HOST="$2"; shift 2 ;;
    --user) CLI_USER="$2"; shift 2 ;;
    --port) CLI_PORT="$2"; shift 2 ;;
    --key) CLI_KEY="$2"; shift 2 ;;
    --remote-dir) CLI_REMOTE_DIR="$2"; shift 2 ;;
    --env-file) DEPLOY_ENV_FILE="$2"; shift 2 ;;
    --no-build) NO_BUILD=1; shift ;;
    --no-upload) NO_UPLOAD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

load_deploy_env "$DEPLOY_ENV_FILE"

IMAGE="${CLI_IMAGE:-${DEPLOY_IMAGE:-myblog:latest}}"
PLATFORM="${CLI_PLATFORM:-${DEPLOY_PLATFORM:-linux/amd64}}"
ARCHIVE="${CLI_ARCHIVE:-${DEPLOY_ARCHIVE:-myblog-amd64.tar.gz}}"
OUT_DIR="${CLI_OUT_DIR:-${DEPLOY_OUT_DIR:-.}}"
SSH_HOST="${CLI_HOST:-${DEPLOY_SSH_HOST:-}}"
SSH_USER="${CLI_USER:-${DEPLOY_SSH_USER:-root}}"
SSH_PORT="${CLI_PORT:-${DEPLOY_SSH_PORT:-22}}"
SSH_KEY="${CLI_KEY:-${DEPLOY_SSH_KEY:-}}"
REMOTE_DIR="${CLI_REMOTE_DIR:-${DEPLOY_REMOTE_DIR:-/opt/myblog}}"

# 相对路径相对仓库根
[[ "$OUT_DIR" = /* ]] || OUT_DIR="$ROOT/$OUT_DIR"
mkdir -p "$OUT_DIR"
ARCHIVE_PATH="$OUT_DIR/$ARCHIVE"

echo "==> 镜像: $IMAGE"
echo "==> 平台: $PLATFORM"
echo "==> 产物: $ARCHIVE_PATH"

if [[ "$NO_BUILD" -eq 0 ]]; then
  echo "==> 构建镜像…"
  docker buildx build --platform "$PLATFORM" -t "$IMAGE" --load "$ROOT"
else
  echo "==> 跳过构建（--no-build）"
fi

echo "==> 导出并压缩…"
docker save "$IMAGE" | gzip -c >"$ARCHIVE_PATH"
SIZE="$(du -h "$ARCHIVE_PATH" | awk '{print $1}')"
echo "==> 完成: $ARCHIVE_PATH ($SIZE)"

if [[ "$NO_UPLOAD" -eq 1 ]]; then
  echo "==> 跳过上传（--no-upload）"
  exit 0
fi

if [[ -z "$SSH_HOST" ]]; then
  echo "错误: 未设置 DEPLOY_SSH_HOST / --host，无法上传。可用 --no-upload 只打包。" >&2
  exit 1
fi

SSH_TARGET="${SSH_USER}@${SSH_HOST}"
SSH_OPTS=(-p "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
SCP_OPTS=(-P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS+=(-i "$SSH_KEY")
  SCP_OPTS+=(-i "$SSH_KEY")
fi

echo "==> 远端目录: $SSH_TARGET:$REMOTE_DIR"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p $(printf '%q' "$REMOTE_DIR")"
scp "${SCP_OPTS[@]}" "$ARCHIVE_PATH" "${SSH_TARGET}:${REMOTE_DIR}/${ARCHIVE}"
echo "==> 上传完成"
echo "    服务器执行: cd $(printf '%q' "$REMOTE_DIR") && ./scripts/docker-load.sh"
echo "    或: DEPLOY_ARCHIVE=$(printf '%q' "$ARCHIVE") ./scripts/docker-load.sh"
