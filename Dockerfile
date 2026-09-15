ARG NODE_VERSION=20
ARG PNPM_VERSION=9.12.2
# 预编译不可用时再设 --build-arg SQLITE_FROM_SOURCE=1（会 apt 装 python3/make/g++，很慢）
ARG SQLITE_FROM_SOURCE=0

# ---------- base：Node + pnpm ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------- deps：装依赖（默认用 better-sqlite3 预编译包，跳过本机编译） ----------
FROM base AS deps
ARG SQLITE_FROM_SOURCE=0
# 禁止强制源码编译；需要时用 SQLITE_FROM_SOURCE=1
ENV npm_config_build_from_source=false
RUN --mount=type=cache,id=myblog-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=myblog-apt-lists,target=/var/lib/apt,sharing=locked \
    if [ "$SQLITE_FROM_SOURCE" = "1" ]; then \
      rm -f /etc/apt/apt.conf.d/docker-clean \
      && apt-get update \
      && apt-get install -y --no-install-recommends python3 make g++; \
    fi
ENV NODE_ENV=development
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
# 加速拉取 better-sqlite3 预编译包（npmmirror）；失败时 prebuild-install 会回退默认源
RUN printf '%s\n' \
      'better_sqlite3_binary_host=https://npmmirror.com/mirrors/better-sqlite3' \
      > .npmrc
RUN --mount=type=cache,id=myblog-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

# ---------- build：编译并整理运行目录 ----------
FROM deps AS build
COPY . .
RUN pnpm build \
  && pnpm prune --prod \
  && mkdir -p /out/apps/server /out/apps/web /out/packages/shared /out/data/uploads /out/data/logs \
  && cp package.json pnpm-lock.yaml pnpm-workspace.yaml /out/ \
  && cp -a node_modules /out/ \
  && cp apps/server/package.json /out/apps/server/ \
  && cp -a apps/server/dist /out/apps/server/ \
  && if [ -e apps/server/node_modules ]; then cp -a apps/server/node_modules /out/apps/server/; fi \
  && cp apps/web/package.json /out/apps/web/ \
  && cp -a apps/web/dist /out/apps/web/ \
  && cp packages/shared/package.json /out/packages/shared/ \
  && cp -a packages/shared/dist /out/packages/shared/ \
  && if [ -e packages/shared/node_modules ]; then cp -a packages/shared/node_modules /out/packages/shared/; fi

# ---------- runner：精简运行镜像 ----------
FROM base AS runner
RUN --mount=type=cache,id=myblog-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=myblog-apt-lists,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends tini gosu \
    && groupadd --system --gid 1001 blog \
    && useradd --system --uid 1001 --gid blog --home-dir /app --shell /usr/sbin/nologin blog

ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    REPO_ROOT=/app \
    DATABASE_PATH=/app/data/blog.db \
    UPLOAD_DIR=/app/data/uploads

COPY --from=build --chown=blog:blog /out /app
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# entrypoint 需 root 才能 chown 数据卷，随后 gosu 降权
USER root
WORKDIR /app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
CMD ["node", "apps/server/dist/index.js"]
