# 小岛日记（myblog）

个人向博客与写作台：前台是小岛风的公开站点，后台是 Notion 式块编辑工作区。单用户、同源部署、SQLite 落库，适合自己写、自己发布。

---

## 它是什么

这不是通用 CMS，而是给一个人用的「小岛」：

- **前台**：首页、分类页、笔记列表、文章页；卡片颜色跟分类走，摘要从正文抽取。
- **写作台**（`/admin`）：页面树、子页、分类管理、发布；正文用 Editor.js，公开页再套成博客排版。
- **关于页**：工作区里的 `about` 页是权威源，会镜像到 `site` 表做兼容。
- **写作助手**：`/` 唤起，在光标处生成块并预览确认；走 OpenAI 兼容接口。

生产环境由 Express 托管 Vite 构建产物，并注入 SEO meta、`sitemap.xml`、`robots.txt`。

---

## 仓库结构

pnpm workspace，三包：

```
apps/web          前台 + 工作区（React / Vite / Tailwind）
apps/server       API、SQLite、上传、SEO、生产静态托管
packages/shared   类型、校验、Editor.js 文档结构、站点常量
```

| 路径 | 作用 |
|------|------|
| `apps/web/src/pages` | 公开页：Home、分类、笔记、文章、登录 |
| `apps/web/src/workspace` | 写作台布局、页面树、编辑与自动保存 |
| `apps/web/src/content` | 编辑器写入 / 前台只读渲染 |
| `apps/server/src/routes` | `auth` `posts` `categories` `site` `upload` `ai` |
| `apps/server/src/posts.ts` | 文章与工作区树、列表过滤、删除子树 |
| `apps/server/src/env.ts` | 环境变量；生产强制强 `JWT_SECRET` / 密码 |

数据默认在仓库根 `data/`（库、上传、日志）。Docker 用卷挂到 `/app/data`。

---

## 怎么跑

需要 **Node ≥ 20**、**pnpm 9.12.2**（可用 Corepack）。

```bash
cp .env.example .env   # 改登录、JWT、可选 OSS / AI
pnpm install
pnpm dev
```

- 前台开发：<http://localhost:5173>（Vite 把 `/api`、`/uploads` 代理到 3001）
- API：<http://localhost:3001>
- 工作区：<http://localhost:5173/admin>（先 `/login`）

生产构建后由服务端托管静态文件：

```bash
pnpm build
NODE_ENV=production pnpm start
```

Docker：

```bash
pnpm docker:up      # compose 构建并后台启动
pnpm docker:logs
pnpm docker:down
```

Apple Silicon 要给 x86 服务器用时，在本机构建 amd64 再导入，避免在小机器上跑 Vite：

```bash
docker buildx build --platform linux/amd64 -t myblog:latest --load .
docker save myblog:latest | gzip > myblog-amd64.tar.gz
```

服务器 `docker load` 后用 `docker compose up -d --no-build`，不要在 VPS 上再 `build`。

---

## 环境变量（要点）

完整列表见 `.env.example`。生产务必：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | ≥ 24 位随机串，禁止示例弱值 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 单用户登录；密码 ≥ 8 且勿用常见弱口令 |
| `SITE_URL` | 对外地址，sitemap / OG 用 |
| `CORS_ORIGIN` | 开发填 Vite 源；生产同源可留空 |
| `OSS_*` | 可选；未配或失败则落到本地 `/uploads` |
| `AI_API_*` | 可选；OpenAI 兼容 Chat Completions |

登录 cookie 在生产带 `Secure`，**纯 HTTP 域名/IP 下浏览器不会保存**，需要 HTTPS 才能在网页里登录。

健康检查：`GET /api/health`（会探 SQLite）。

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

- 生产 `JWT_SECRET` / 密码校验会直接拒绝弱配置。
- HTTP + `Secure` cookie 会导致「接口登录成功、页面仍未登录」。
- 小内存机器上 Docker 内 `vite build` 容易卡在 `transforming...`，优先本机构建镜像。
- `ali-oss` 在服务端懒加载，避免没配 OSS 时拖垮启动。

---

## 常用脚本

```bash
pnpm dev              # 三包并行开发
pnpm build            # shared → web → server
pnpm start            # 跑编译后的 server
pnpm docker:build
pnpm pm2:start        # 本机 pm2，见 ecosystem.config.cjs
```

许可证未声明；个人站点代码，按自己的使用习惯处理即可。
