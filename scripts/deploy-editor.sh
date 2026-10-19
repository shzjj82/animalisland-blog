#!/usr/bin/env bash
# 部署 apps/editor（wiki-agent 网页版）到 frp 内网机器
#
# 端口约定（可环境变量覆盖）：
#   服务器本机监听 EDITOR_LOCAL_PORT=5174（只绑 127.0.0.1）
#   frp 公网侧暴露 EDITOR_REMOTE_PORT=8082 → 访问 http://106.15.235.175:8082/
#
# 用法：
#   pnpm deploy:editor                 # 重新构建 + 上传 + 重启
#   pnpm deploy:editor --skip-build    # 沿用已有的 apps/editor/release/wiki-agent-web
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EDITOR_DIR="$REPO_ROOT/apps/editor"
BUNDLE="$EDITOR_DIR/release/wiki-agent-web"

SSH_HOST="${DEPLOY_SSH_HOST:-106.15.235.175}"
SSH_USER="${DEPLOY_SSH_USER:-root}"
SSH_PORT="${DEPLOY_SSH_PORT:-1022}"
SSH_KEY="${DEPLOY_SSH_KEY:-}"

REMOTE_DIR="${EDITOR_REMOTE_DIR:-/opt/apps/editor}"
EDITOR_PORT="${EDITOR_LOCAL_PORT:-5174}"
REMOTE_PORT="${EDITOR_REMOTE_PORT:-8082}"
GATEWAY="${GATEWAY_BASE_URL:-https://api.championsea.online}"

BUILD=1
if [[ "${1:-}" == "--skip-build" ]]; then
  BUILD=0
fi

SSH_OPTS=(-o StrictHostKeyChecking=no -o ConnectTimeout=10)
[[ -n "$SSH_KEY" ]] && SSH_OPTS+=(-i "$SSH_KEY")

if [[ "$BUILD" == "1" ]]; then
  echo "▶ 构建 editor web 产物（gateway → $GATEWAY）"
  (cd "$REPO_ROOT" && GATEWAY_BASE_URL="$GATEWAY" pnpm pack:web)
fi

if [[ ! -f "$BUNDLE/server.mjs" || ! -d "$BUNDLE/dist" ]]; then
  echo "✗ 缺少产物：$BUNDLE（server.mjs / dist）" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$BUNDLE/dist" "$STAGE/dist"
cp "$BUNDLE/server.mjs" "$STAGE/server.mjs"

cat > "$STAGE/ecosystem.config.cjs" <<EOF
module.exports = {
  apps: [
    {
      name: 'editor',
      script: '${REMOTE_DIR}/current/server.mjs',
      args: '${REMOTE_DIR}/current/dist',
      interpreter: 'node',
      cwd: '${REMOTE_DIR}',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        EDITOR_PORT: '${EDITOR_PORT}',
        GATEWAY_BASE_URL: '${GATEWAY}',
      },
      out_file: '${REMOTE_DIR}/logs/editor-out.log',
      error_file: '${REMOTE_DIR}/logs/editor-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
EOF

TARBALL="editor-web-$(date +%Y%m%d-%H%M%S).tar.gz"
TARBALL_PATH="/tmp/$TARBALL"
tar -czf "$TARBALL_PATH" -C "$STAGE" dist server.mjs ecosystem.config.cjs

echo "▶ 上传 $TARBALL_PATH → $SSH_USER@$SSH_HOST:$SSH_PORT"
scp "${SSH_OPTS[@]}" -P "$SSH_PORT" "$TARBALL_PATH" "$SSH_USER@$SSH_HOST:/tmp/$TARBALL"

echo "▶ 服务器安装 / 重启服务"
ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
  "bash -s '$REMOTE_DIR' '$EDITOR_PORT' '$REMOTE_PORT' '$GATEWAY' '$TARBALL'" <<'REMOTE'
set -e

REMOTE_DIR="$1"
EDITOR_PORT="$2"
REMOTE_PORT="$3"
GATEWAY="$4"
TARBALL="$5"

mkdir -p "$REMOTE_DIR/logs"
rm -rf "$REMOTE_DIR/current"
mkdir -p "$REMOTE_DIR/current"
tar -xzf "/tmp/$TARBALL" -C "$REMOTE_DIR/current"
rm -f "/tmp/$TARBALL"
cp "$REMOTE_DIR/current/ecosystem.config.cjs" "$REMOTE_DIR/ecosystem.config.cjs"

if command -v pm2 >/dev/null 2>&1; then
  pm2 delete editor >/dev/null 2>&1 || true
  pm2 start "$REMOTE_DIR/ecosystem.config.cjs" --update-env >/dev/null
  pm2 save >/dev/null 2>&1 || true
else
  echo "✗ 服务器缺少 pm2" >&2
  exit 1
fi

TOML=/etc/frp/frpc.toml
if [ -f "$TOML" ]; then
  if ! grep -q 'name = "editor"' "$TOML"; then
    cp "$TOML" "$TOML.bak.$(date +%Y%m%d%H%M%S)"
    cat >> "$TOML" <<EOF

[[proxies]]
name = "editor"
type = "tcp"
localIP = "127.0.0.1"
localPort = $EDITOR_PORT
remotePort = $REMOTE_PORT
EOF
  fi
# 注意：SSH 本身就走 frp 隧道（remote 1022 → 本机 22），
# 下面 restart frpc 会短暂断开本次连接，属正常现象；等 5~10s 隧道自动恢复。
  systemctl restart frpc || true
else
  echo "⚠ 未找到 $TOML，跳过 frpc 配置" >&2
fi

for i in $(seq 1 20); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$EDITOR_PORT/" || true)"
  if [ "$code" = "200" ]; then
    echo "✓ 本机 http://127.0.0.1:$EDITOR_PORT/ → $code"
    break
  fi
  sleep 1
done

sleep 2
systemctl is-active frpc || true
pm2 list | grep -E '^\|? *[0-9]+ *\| *editor' || pm2 describe editor | head -5
REMOTE

rm -f "$TARBALL_PATH"
echo "▶ 完成：公网访问 http://$SSH_HOST:$REMOTE_PORT/"
