#!/bin/sh
set -e
# 数据卷常为 root 属主；入口以 root 修正后再降权到 blog
mkdir -p /app/data/uploads /app/data/logs
chown -R blog:blog /app/data
exec gosu blog "$@"
