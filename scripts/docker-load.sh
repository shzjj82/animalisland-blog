#!/usr/bin/env bash
# 解压镜像包并 docker load；可选 compose 启动
# 变量来自：环境变量 / .env.deploy（默认）/ CLI，与项目 .env 无关
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT/.env.deploy}"

usage() {
  cat <<'EOF'
用法: scripts/docker-load.sh [选项] [ARCHIVE]

将 gzip 的 docker save 包解压加载进本机 Docker。
默认在仓库根目录找 DEPLOY_ARCHIVE；也可传绝对/相对路径。

选项:
  --archive FILE     压缩包路径或文件名   (DEPLOY_ARCHIVE)
  --image NAME       期望镜像名（仅提示） (DEPLOY_IMAGE)
  --env-file PATH    部署变量文件（非 .env）(DEPLOY_ENV_FILE)
  --compose / --up   加载后 compose up -d --no-build
  --no-compose       只 load，不启动
  -h, --help         帮助

环境变量也可直接 export；CLI 优先。
示例:
  ./scripts/docker-load.sh
  ./scripts/docker-load.sh myblog-amd64.tar.gz --up
  DEPLOY_COMPOSE_UP=0 ./scripts/docker-load.sh --archive /opt/myblog/myblog-amd64.tar.gz
EOF
}

load_deploy_env() {
  local file="$1"
  [[ -f "$file" ]] || return 0
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
      if [[ -z "${!key+x}" ]]; then
        export "$key=$val"
      fi
    fi
  done <"$file"
}

CLI_ARCHIVE=""
CLI_IMAGE=""
CLI_COMPOSE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive) CLI_ARCHIVE="$2"; shift 2 ;;
    --image) CLI_IMAGE="$2"; shift 2 ;;
    --env-file) DEPLOY_ENV_FILE="$2"; shift 2 ;;
    --compose|--up) CLI_COMPOSE=1; shift ;;
    --no-compose) CLI_COMPOSE=0; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
    *)
      if [[ -n "$CLI_ARCHIVE" ]]; then
        echo "多余参数: $1" >&2
        exit 1
      fi
      CLI_ARCHIVE="$1"
      shift
      ;;
  esac
done

load_deploy_env "$DEPLOY_ENV_FILE"

IMAGE="${CLI_IMAGE:-${DEPLOY_IMAGE:-myblog:latest}}"
ARCHIVE="${CLI_ARCHIVE:-${DEPLOY_ARCHIVE:-myblog-amd64.tar.gz}}"
if [[ -n "$CLI_COMPOSE" ]]; then
  COMPOSE_UP="$CLI_COMPOSE"
else
  COMPOSE_UP="${DEPLOY_COMPOSE_UP:-1}"
fi

# 相对路径：先相对当前目录，再相对仓库根
resolve_archive() {
  local p="$1"
  if [[ -f "$p" ]]; then
    printf '%s\n' "$(cd "$(dirname "$p")" && pwd)/$(basename "$p")"
    return 0
  fi
  if [[ -f "$ROOT/$p" ]]; then
    printf '%s\n' "$ROOT/$p"
    return 0
  fi
  return 1
}

if ! ARCHIVE_PATH="$(resolve_archive "$ARCHIVE")"; then
  echo "错误: 找不到压缩包: $ARCHIVE" >&2
  exit 1
fi

echo "==> 加载: $ARCHIVE_PATH"
echo "==> 期望镜像: $IMAGE"

case "$ARCHIVE_PATH" in
  *.tar.gz|*.tgz)
    gzip -dc "$ARCHIVE_PATH" | docker load
    ;;
  *.tar)
    docker load -i "$ARCHIVE_PATH"
    ;;
  *)
    echo "错误: 仅支持 .tar / .tar.gz / .tgz" >&2
    exit 1
    ;;
esac

echo "==> docker load 完成"
docker image ls "$IMAGE" || true

if [[ "$COMPOSE_UP" == "1" || "$COMPOSE_UP" == "true" || "$COMPOSE_UP" == "yes" ]]; then
  if [[ ! -f "$ROOT/docker-compose.yml" ]]; then
    echo "警告: 未找到 docker-compose.yml，跳过启动" >&2
    exit 0
  fi
  echo "==> docker compose up -d --no-build"
  # 应用运行时仍读项目 .env；此处不读 .env.deploy
  docker compose -f "$ROOT/docker-compose.yml" up -d --no-build
  echo "==> 已启动"
else
  echo "==> 跳过 compose（--no-compose / DEPLOY_COMPOSE_UP=0）"
fi
