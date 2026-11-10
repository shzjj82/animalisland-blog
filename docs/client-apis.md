# 客户端接口清单

只记录编辑器和博客代码里真正发出的请求，用来做权限控制。编辑器直连网关 `GATEWAY_BASE_URL`，请求头 `X-Biz-Code` 与 `X-App-Code` 都是 `wiki`。博客浏览器只打本机 `/api/*`，由 `apps/server` 再转发到同一网关；文档与账号默认业务码是 `blog`（`DOCS_APP_CODE`），账号应用码默认是 `web`（`AUTH_APP_CODE`），智能体默认是 `blog`（`AGENTS_BIZ_CODE`）。

编辑器除登录、注册外都带用户 JWT。博客用 Cookie 会话：写接口、`/api/ai/*`、`/api/upload`、按 id 读文章、工作区树需要登录；公开读文章和分类不需要。

## 编辑器（apps/editor）

### 账号

| 方法 | 路径 | 调用处 | 登录 |
| --- | --- | --- | --- |
| POST | `/auth/login` | `remoteStore.ts` 登录 | 否 |
| POST | `/auth/register` | `remoteStore.ts` 注册 | 否 |
| POST | `/auth/refresh` | `remoteStore.ts` access token 过期时，body 带 `refreshToken` | 刷新令牌，不带 access JWT |
| POST | `/auth/logout` | `remoteStore.ts` 退出，作废 refresh token | 有登录态时带 JWT |
| POST | `/auth/change-password` | `remoteStore.ts` 修改密码，body `{ oldPassword, newPassword }` | 用户 JWT |

### 文档

| 方法 | 路径 | 调用处 | 登录 |
| --- | --- | --- | --- |
| GET | `/docs/documents?scope=mine&tree=1` | `remoteStore.ts` 侧栏列表、同步时对照本地 id | 用户 JWT |
| GET | `/docs/documents/id/:id` | `remoteStore.ts` 打开页面；`search.ts` 检索时补正文 | 用户 JWT |
| POST | `/docs/documents` | `remoteStore.ts` 新建页面、把本地页推到远程 | 用户 JWT |
| PUT | `/docs/documents/:id` | `remoteStore.ts` 保存正文 | 用户 JWT |
| PUT | `/docs/documents/id/:id/parent` | `remoteStore.ts` 调整父页面，body `{ parentId }` | 用户 JWT |
| DELETE | `/docs/documents/:id` | `remoteStore.ts` 删除页面 | 用户 JWT |

### 团队

| 方法 | 路径 | 调用处 | 登录 |
| --- | --- | --- | --- |
| GET | `/teams` | `teamStore.ts` 团队列表 | 用户 JWT |
| POST | `/teams` | `teamStore.ts` 创建团队，body `{ name }` | 用户 JWT |
| POST | `/teams/:code/join` | `teamStore.ts` 用团队码加入 | 用户 JWT |
| POST | `/teams/:id/leave` | `teamStore.ts` 退出团队 | 用户 JWT |
| GET | `/teams/:id` | `teamStore.ts` 团队详情和成员 | 用户 JWT |
| PATCH | `/teams/:id/members/:accountId` | `teamStore.ts` 修改成员角色，body `{ role }` | 用户 JWT |

### 待办与通知

| 方法 | 路径 | 调用处 | 登录 |
| --- | --- | --- | --- |
| GET | `/todos/open-count` | `notifyStore.ts` 未完成数量 | 用户 JWT |
| GET | `/todos?status=open&page=1&pageSize=30` | `notifyStore.ts` 未完成列表 | 用户 JWT |
| POST | `/todos` | `notifyStore.ts`、待办块同步新建 | 用户 JWT |
| PATCH | `/todos/:id` | `notifyStore.ts`、待办块同步更新 | 用户 JWT |
| POST | `/todos/:id/done` | `notifyStore.ts` 标为完成 | 用户 JWT |
| GET | `/notifications/unread-count` | `notifyStore.ts` 未读数量 | 用户 JWT |
| GET | `/notifications?unread=1&page=1&pageSize=20` | `notifyStore.ts` 未读列表 | 用户 JWT |
| POST | `/notifications/:id/read` | `notifyStore.ts` 单条已读 | 用户 JWT |
| POST | `/notifications/read-all` | `notifyStore.ts` 全部已读 | 用户 JWT |
| WebSocket | `/notifications/socket?token=:jwt&bizCode=wiki` | `notifySocket.ts` 登录后订阅，断线重连 | query 里的用户 JWT |

### 文件

| 方法 | 路径 | 调用处 | 登录 |
| --- | --- | --- | --- |
| POST | `/upload` | `fileStore.ts` 附件、图片。`multipart`，字段 `file` 和 `prefix` | 用户 JWT |

### 智能体

| 方法 | 路径 | 调用处 | 登录 |
| --- | --- | --- | --- |
| GET | `/agents/chat/status` | `lib/ai/client.ts` 写作和问知识库入口是否可用 | 用户 JWT |
| POST | `/agents/chat` | 聚光灯写作（`useSpotlightChat.ts`）不传 `rag`。问知识库（`wiki-chat`）在非待办问题时传 `rag: true` | 用户 JWT |

问知识库带 `rag: true` 时，网关内部再调 `POST /agents/rag/search`。编辑器自己不请求这个地址。这条能力要同时开通 `agents.chat` 和 `agents.rag`。待办类问题会关掉 `rag`，只根据本机页面回答。

## 博客（apps/web + apps/server）

浏览器路径在前，网关路径是服务端实际转发的地址。

### 账号

| 方法 | 浏览器路径 | 网关路径 | 调用处 | 登录 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | `POST /auth/register` | `api.ts` / `auth.tsx` | 否 |
| POST | `/api/auth/login` | `POST /auth/login` | `api.ts` / `auth.tsx` | 否 |
| POST | `/api/auth/logout` | `POST /auth/logout` | `api.ts` / `auth.tsx` | 有 Cookie 时转发；没有也能清本地会话 |
| GET | `/api/auth/me` | `GET /auth/me` | `api.ts` / `auth.tsx` | Cookie 登录 |
| — | 浏览器不调用 | `POST /auth/refresh` | `auth.ts` 在 access token 过期时用 refresh cookie 轮换 | 刷新令牌 |

### 文章

公开列表固定 `scope=public`，不带用户凭证。工作区树和按 id 读写使用用户 JWT。

| 方法 | 浏览器路径 | 网关路径 | 调用处 | 登录 |
| --- | --- | --- | --- | --- |
| GET | `/api/posts` | `GET /docs/documents`（`scope=public`，可带 `type`、`kind`、`pageKind`、`parentId`、`limit`、`page`、`pageSize`） | 首页、列表、`server-api.ts` | 否 |
| GET | `/api/posts?tree=1` | `GET /docs/documents?scope=mine&tree=1` | `WorkspaceLayout` 工作区侧栏 | Cookie 登录。未登录返回 401 |
| GET | `/api/posts/:slug` | `GET /docs/documents/:slug` | 文章页、`server-api.ts` | 否。公开读不带凭证；feed 有 JWT 则带上 |
| GET | `/api/posts/id/:id` | `GET /docs/documents/id/:id` | `PageEditor`、保存后回写父页 | Cookie 登录 |
| POST | `/api/posts` | `POST /docs/documents` | 工作区新建页面 | Cookie 登录 |
| POST | `/api/posts/id/:id/children` | `POST /docs/documents/id/:id/children` | 侧栏建子页 | Cookie 登录 |
| PUT | `/api/posts/id/:id/parent` | `PUT /docs/documents/id/:id/parent` | 拖拽改父级，body `{ parentId }` | Cookie 登录 |
| PUT | `/api/posts/:id` | `PUT /docs/documents/:id` | 保存正文、发布 | Cookie 登录 |
| DELETE | `/api/posts/:id` | `DELETE /docs/documents/:id` | 删除页面 | Cookie 登录 |

### 分类

读接口路由不要求登录。写接口要求登录。转发文档服务时默认 `credential=auto`：请求上下文里有用户 JWT 就带上，否则才考虑服务密钥。

| 方法 | 浏览器路径 | 网关路径 | 调用处 | 登录 |
| --- | --- | --- | --- | --- |
| GET | `/api/categories` | `GET /docs/categories` | 导航、发布对话框、`server-api.ts` | 否 |
| GET | `/api/categories/:slug` | `GET /docs/categories/:slug` | 服务端按 slug 取栏目，页面不直接调 | 否 |
| POST | `/api/categories` | `POST /docs/categories` | 发布对话框、栏目管理 | Cookie 登录 |
| PUT | `/api/categories/:id` | `PUT /docs/categories/:id` | 栏目管理 | Cookie 登录 |
| DELETE | `/api/categories/:id` | `DELETE /docs/categories/:id` | 栏目管理 | Cookie 登录 |

### 上传

| 方法 | 浏览器路径 | 网关路径 | 调用处 | 登录 |
| --- | --- | --- | --- | --- |
| POST | `/api/upload` | 不走网关。文件写到本机 `UPLOAD_DIR`，返回 `/uploads/...` | 编辑器图片、对话附件 | Cookie 登录 |

### 智能体

博客这条链路不传 `rag`，也不会触发 `POST /agents/rag/search`。

| 方法 | 浏览器路径 | 网关路径 | 调用处 | 登录 |
| --- | --- | --- | --- | --- |
| GET | `/api/ai/status` | `GET /agents/chat/status` | 写作入口是否可用 | Cookie 登录 |
| POST | `/api/ai/chat` | `POST /agents/chat`（`sync: true`） | 聚光灯写作 `useSpotlightChat.ts` | Cookie 登录 |

### 探活

页面不调用。`GET /api/health` 在文档后端开启时，由 `apps/server` 用服务密钥请求 `GET /docs/health`。
