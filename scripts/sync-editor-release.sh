#!/usr/bin/env bash
# 兼容旧入口：真正的实现已收到 apps/editor/scripts/ed.mjs（pnpm ed sync）
# 用法：bash scripts/sync-editor-release.sh [版本号]
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$REPO_ROOT/apps/editor/scripts/ed.mjs" sync "$@"
