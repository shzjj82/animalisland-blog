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
RUN printf '%s\n' \
      'better_sqlite3_binary_host=https://npmmirror.com/mirrors/better-sqlite3' \
      > .npmrc
RUN --mount=type=cache,id=myblog-pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

# ---------- build：编译 shared / Next / Express ----------
FROM deps AS build
COPY . .
# deps 用 development 以便装上 typescript/less 等；next build 必须是 production，
# 否则会告警 non-standard NODE_ENV，并在预渲染 /404 时误报 Html/_document。
# Next rewrites 在 build 时固化 destination；必须用 compose 内网 hostname，
# 否则 web 容器会把 /api 代理到自身 127.0.0.1:3001 → ECONNREFUSED / 登录 500。
ARG INTERNAL_API_URL=http://api:3001
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    INTERNAL_API_URL=${INTERNAL_API_URL}
RUN echo "building Next with INTERNAL_API_URL=${INTERNAL_API_URL}" \
  && test -n "$INTERNAL_API_URL" \
  && pnpm build

# ---------- api runner ----------
FROM base AS api
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

COPY --from=build --chown=blog:blog /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/
COPY --from=build --chown=blog:blog /app/node_modules /app/node_modules
COPY --from=build --chown=blog:blog /app/apps/server/package.json /app/apps/server/
# pnpm 把 workspace 依赖挂在 apps/server/node_modules（软链到根 .pnpm）；缺了会 ERR_MODULE_NOT_FOUND
COPY --from=build --chown=blog:blog /app/apps/server/node_modules /app/apps/server/node_modules
COPY --from=build --chown=blog:blog /app/apps/server/dist /app/apps/server/dist
COPY --from=build --chown=blog:blog /app/packages/shared/package.json /app/packages/shared/
COPY --from=build --chown=blog:blog /app/packages/shared/dist /app/packages/shared/dist
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh \
  && mkdir -p /app/data/uploads /app/data/logs \
  && chown -R blog:blog /app/data

USER root
WORKDIR /app
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]
CMD ["node", "apps/server/dist/index.js"]

# ---------- web runner (Next standalone) ----------
FROM base AS web
RUN --mount=type=cache,id=myblog-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=myblog-apt-lists,target=/var/lib/apt,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
    && apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && groupadd --system --gid 1001 blog \
    && useradd --system --uid 1001 --gid blog --home-dir /app --shell /usr/sbin/nologin blog

ENV NODE_ENV=production \
    PORT=5173 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    INTERNAL_API_URL=http://api:3001

# Next standalone 在 monorepo 下输出为保持 apps/web 结构的 server.js
COPY --from=build --chown=blog:blog /app/apps/web/.next/standalone /app
COPY --from=build --chown=blog:blog /app/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=blog:blog /app/apps/web/public /app/apps/web/public

USER blog
WORKDIR /app
EXPOSE 5173

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5173)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/web/server.js"]
