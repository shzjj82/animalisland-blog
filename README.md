# 小岛日记（myblog）

个人向博客与写作台：前台是小岛风的公开站点，后台是 Notion 式块编辑工作区。单用户、同源部署、SQLite 落库，适合自己写、自己发布。

---

## 它是什么

这不是通用 CMS，而是给一个人用的「小岛」：

- **前台**：首页、分类页、笔记列表、文章页；卡片颜色跟分类走，摘要从正文抽取。
- **写作台**（`/admin`）：页面树、子页、分类管理、发布；正文用 Editor.js，公开页再套成博客排版。
- **关于页**：工作区里的 `about` 页是权威源，会镜像到 `site` 表做兼容。
- **写作助手**：`/` 唤起，在光标处生成块并预览确认；走 OpenAI 兼容接口。

生产环境由 **Next.js** 提供页面（含公开页 SSR），**Express** 只提供 API、上传与 `sitemap.xml` / `robots.txt`；Next 经运行时 `/api` 代理与 build-time rewrite 把 `/uploads` 等转到 Express。

---

## 仓库结构

pnpm workspace，三包：

```
apps/web          前台 + 工作区（Next.js App Router / React / Tailwind）
apps/server       API、SQLite、上传、SEO 文件（不再托管 SPA）
packages/shared   类型、校验、Editor.js 文档结构、站点常量
```

| 路径 | 作用 |
|------|------|
| `apps/web/src/app` | Next App Router 路由（公开 SSR + 登录/工作区 client） |
| `apps/web/src/views` | 页面视图组件（Home、分类、笔记、文章、登录） |
| `apps/web/src/workspace` | 写作台布局、页面树、编辑与自动保存 |
| `apps/web/src/content` | 编辑器写入 / 前台只读渲染 |
| `apps/web/src/lib/server-api.ts` | 公开页 SSR 拉 Express 的服务端助手 |
| `apps/server/src/routes` | `auth` `posts` `categories` `site` `upload` `ai` |
| `apps/server/src/posts.ts` | 文章与工作区树、列表过滤、删除子树 |
| `apps/server/src/env.ts` | 环境变量；`GATEWAY_BASE_URL`；生产强制强 `DOCS_SERVICE_KEY` |

数据默认在仓库根 `data/`（库、上传、日志）。Docker 用卷挂到 `/app/data`。

---

## 怎么跑

需要 **Node ≥ 20**、**pnpm 9.12.2**（可用 Corepack）。

```bash
cp .env.example .env   # 改登录、JWT、可选 OSS / AI
pnpm install
pnpm dev
```

- 前台开发：<http://localhost:5173>（Next rewrite `/api`、`/uploads` → 3001）
- API：<http://localhost:3001>
- 工作区：<http://localhost:5173/admin>（先 `/login`）

生产构建后同时启动 Next 与 Express：

```bash
pnpm build
NODE_ENV=production pnpm start
```

Docker（两个服务：`web`=Next、`api`=Express）：

```bash
pnpm docker:up      # compose 构建并后台启动
pnpm docker:logs
pnpm docker:down
```

Apple Silicon 要给 x86 服务器用时，在本机构建 amd64 再导入，避免在小机器上跑 `next build`：

```bash
# 推荐：部署脚本（变量用 .env.deploy / DEPLOY_*，与应用 .env 分开）
cp .env.deploy.example .env.deploy   # 填写 DEPLOY_SSH_HOST 等
./scripts/docker-pack-upload.sh      # 构建 → gzip → scp
# 服务器上（仓库目录内，已有 docker-compose.yml 与 .env）：
./scripts/docker-load.sh             # gunzip | docker load，默认再 compose up --no-build

# 或手动（需分别打 api / web 两个 target；web rewrites 依赖 INTERNAL_API_URL）：
docker buildx build --platform linux/amd64 --build-arg INTERNAL_API_URL=http://api:3001 --target api -t myblog-api:latest --load .
docker buildx build --platform linux/amd64 --build-arg INTERNAL_API_URL=http://api:3001 --target web -t myblog-web:latest --load .
```

服务器 `docker load` 后用 `docker compose up -d --no-build`，不要在 VPS 上再 `build`。

---

## 环境变量（要点）

完整列表见 `.env.example`。生产务必：

| 变量 | 说明 |
|------|------|
| `API_PORT` / `WEB_PORT` | 宿主机端口：Express / Next（勿再用笼统 `PORT`） |
| `GATEWAY_BASE_URL` | Nest 单一网关（配了即走 Nest；别名 `NEST_BASE_URL`） |
| `GATEWAY_SERVICE_KEY` | Nest `x-docs-key`（别名 `DOCS_SERVICE_KEY`） |
| `SITE_URL` | 对外地址，sitemap / OG 用；以 `https://` 开头时登录 cookie 带 `Secure` |
| `OSS_*` | 可选；未配或失败则落到本地 `/uploads` |
| `AI_API_*` | 可选；OpenAI 兼容 Chat Completions |

登录走 **Nest usercenter**（`POST /auth/login`），写作台 cookie 存 Nest access / refresh token；写 docs 时透传用户 JWT。种子账号见 nestjs 仓库 README（默认 `admin` / `admin123`）。

登录 cookie 在 `SITE_URL` 为 HTTPS（或 `COOKIE_SECURE=1`）时带 `Secure`，**纯 HTTP 域名/IP 下需保持 SITE_URL 非 https**，否则浏览器不会保存。

健康检查：`GET /api/health`（返回 `backend: "local" | "docs"`；local 探 SQLite，docs 探文档服务）。启动日志也会打印当前后端。

---

## 前台路由

| 路径 | 含义 |
|------|------|
| `/` | 首页 |
| `/notes` | 笔记列表 |
| `/post/:slug` | 文章（含子页链接） |
| `/:slug` | 分类（`kind=article` 且进导航的分类） |
| `/login` | 登录 |
| `/admin`、`/admin/p/:id` | 工作区 |

公开列表会排除「自身或祖先为草稿」的子树，保证分页 `total` 与 SQL 过滤一致。

---

## 写作与内容模型

- 文章顶层绑定**已有分类**（slug），不会在保存时隐式建类；新建分类走分类管理或发布弹窗。
- 工作区树：`about` + 文章（含子页）。删页会先剥父文 pageLink，再按子树删除。
- 前台 `BlogContent` 只读渲染块文档，不加载 Editor.js。
- 列表卡片颜色用 `post.categoryColor`；摘要来自正文有实质内容的段落/列表，过短或纯符号会显示「点进去看全文。」

AI 助手产物会清洗：去掉表单标签，不插入 `quote` / `code` / `delimiter`（这三类在编辑器里会变成输入框或分隔线）。

---

## 设计取舍（分析）

**适合**

- 一个人写博客，要块编辑、分类导航、子页、一点 AI 续写。
- 想少运维：SQLite + 单容器，备份拷 `data` 即可。

**刻意做小的地方**

- 没有多用户、评论、插件市场。
- 分类与标签已收束成「分类」；标签不再自动变导航类。
- 图片可走 OSS，但站点本身仍是自托管。

**部署时注意**

- 生产 `DOCS_SERVICE_KEY` 校验会直接拒绝弱配置；登录账号在 Nest usercenter。
- HTTP + `Secure` cookie 会导致「接口登录成功、页面仍未登录」。
- 小内存机器上 Docker 内 `next build` 容易吃紧，优先本机构建镜像。
- `ali-oss` 在服务端懒加载，避免没配 OSS 时拖垮启动。

---

## 常用脚本

```bash
pnpm dev              # 三包并行开发
pnpm build            # shared → web → server
pnpm start            # 并行启动 Express API + Next web
pnpm check:backend    # 内容后端别名与门面导出契约
pnpm migrate:docs     # SQLite → 文档服务（可加 -- --dry-run）
pnpm docker:build
pnpm pm2:start        # 本机 pm2（api + web），见 ecosystem.config.cjs
```

许可证未声明；个人站点代码，按自己的使用习惯处理即可。
