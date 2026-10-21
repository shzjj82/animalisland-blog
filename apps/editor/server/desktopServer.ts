import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".exe": "application/vnd.microsoft.portable-executable",
};

/**
 * 路由约定（按优先级）：
 *
 *   1. /auth /docs /agents /upload /teams   → 反代到网关
 *   2. /downloads/<file>                    → downloadDir 里的安装包（支持 Range）
 *   3. 别名 308 跳转                         → /download、/download.html、/downloads
 *   4. /                                     → dist/download.html（下载宣传页 = 站点首页）
 *   5. /app、/app/*                          → index.html（编辑器 SPA，含深链回落）
 *   6. dist 里真实存在的文件                  → 直接返回（带缓存头）
 *   7. 其他                                  → 404
 *
 * 编辑器不再占用根路径：根是给人的落地页，工具在 /app 下面。
 * 桌面版 WebView 也加载 /app（见 src-tauri/src/lib.rs）。
 */
const HOME_PAGE = "download.html";
const APP_PREFIX = "/app";

/** 旧地址 / 常见手误 → canonical 路径 */
const REDIRECTS: Record<string, string> = {
  "/download": "/#download",
  "/download/": "/#download",
  "/download.html": "/#download",
  "/downloads": "/#download",
  "/downloads/": "/#download",
};

/** 打包后的资源名里带 hash，可以长缓存；其余给短缓存 */
const HASHED_ASSET = /\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|png|jpe?g|svg|webp)$/;

const PROXY_ROOTS = ["/auth", "/docs", "/agents", "/upload", "/teams"] as const;

function resolveGatewayBase(): string {
  const fromBake = (process.env.DESKTOP_GATEWAY_BASE || "").trim();
  const fromEnv = (process.env.GATEWAY_BASE_URL || process.env.NEST_BASE_URL || "").trim();
  return (fromBake || fromEnv || "https://api.championsea.online").replace(/\/$/, "");
}

/** 安装包目录：默认在部署目录（dist 的上一级的上一级），桌面版一般没有，404 即可 */
function resolveDownloadsDir(distRoot: string): string {
  const fromEnv = (process.env.EDITOR_DOWNLOADS_DIR || "").trim();
  return fromEnv ? path.resolve(fromEnv) : path.resolve(distRoot, "..", "..", "downloads");
}

function shouldProxy(pathname: string): boolean {
  return PROXY_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

function proxyToGateway(req: IncomingMessage, res: ServerResponse, gatewayBase: string): void {
  const incoming = new URL(req.url ?? "/", "http://127.0.0.1");
  const target = new URL(`${incoming.pathname}${incoming.search}`, `${gatewayBase}/`);
  const transport = target.protocol === "https:" ? https : http;
  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: target.host };
  delete headers["origin"];
  delete headers["referer"];

  const upstream = transport.request(
    target,
    { method: req.method, headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ success: false, message: "GATEWAY_UNAVAILABLE" }));
    } else {
      res.end();
    }
  });
  req.pipe(upstream);
}

function cacheControlFor(file: string): string {
  if (file.endsWith(".html")) {
    // 页面本身不缓存：部署后要立刻生效，资源是带 hash 的
    return "no-cache";
  }
  return HASHED_ASSET.test(file) ? "public, max-age=31536000, immutable" : "public, max-age=3600";
}

/** 静态文件；支持 HEAD，并给出 Content-Length（下载进度、CDN 探测都需要） */
function sendFile(req: IncomingMessage, res: ServerResponse, file: string): void {
  const stat = fs.statSync(file);
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(stat.size));
  res.setHeader("Cache-Control", cacheControlFor(file));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

/** 安装包：附 attachment、支持 Range（92MB 的 dmg 断点续传 / 暂停恢复都靠它） */
function sendDownload(req: IncomingMessage, res: ServerResponse, file: string): void {
  const stat = fs.statSync(file);
  const name = encodeURIComponent(path.basename(file));
  res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${name}`);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "public, max-age=86400");

  const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file, { start, end }).pipe(res);
    return;
  }

  res.statusCode = 200;
  res.setHeader("Content-Length", String(stat.size));
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  fs.createReadStream(file).pipe(res);
}

function serveDownload(distRoot: string, req: IncomingMessage, res: ServerResponse): boolean {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  // 只接 /downloads/<file>；/downloads 本身交给 REDIRECTS 去跳转
  if (!pathname.startsWith("/downloads/")) {
    return false;
  }
  const dir = resolveDownloadsDir(distRoot);
  const file = path.resolve(dir, pathname.slice("/downloads/".length));
  if (!file.startsWith(`${dir}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Not found");
    return true;
  }
  sendDownload(req, res, file);
  return true;
}

function redirect(res: ServerResponse, to: string): void {
  res.statusCode = 308;
  res.setHeader("Location", to);
  res.end();
}

function serveStatic(distRoot: string, req: IncomingMessage, res: ServerResponse): void {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);

  const to = REDIRECTS[pathname];
  if (to) {
    redirect(res, to);
    return;
  }

  // 目录请求补 index.html
  const asDir = pathname.endsWith("/") ? path.join(pathname, "index.html") : pathname;

  /** 读 dist 里的文件；越界返回 null */
  const pick = (relative: string): string | null => {
    const file = path.resolve(distRoot, `.${relative}`);
    if (file !== distRoot && !file.startsWith(`${distRoot}${path.sep}`)) {
      return null;
    }
    return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
  };

  // 1) 根路径 = 宣传页。必须先于 index.html 命中，否则 / 又回落到编辑器外壳
  if (asDir === "/" || asDir === "/index.html") {
    const home = pick(`/${HOME_PAGE}`);
    if (home) {
      sendFile(req, res, home);
      return;
    }
  }

  // 2) dist 里的真实文件（含 /download.html、/logo.png、/assets/*）
  const direct = pick(asDir);
  if (direct) {
    sendFile(req, res, direct);
    return;
  }

  // 3) 编辑器 SPA：/app 与 /app/... 一律回到入口，前端自己的深链刷新也能用
  if (pathname === APP_PREFIX || pathname.startsWith(`${APP_PREFIX}/`)) {
    const app = pick("/index.html");
    if (app) {
      sendFile(req, res, app);
      return;
    }
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
}

/**
 * 固定端口，保证 WebView 源一直是 http://127.0.0.1:47321。
 * 端口一变，localStorage（登录态、本地页）就对不上。被占用时才退回随机端口。
 */
const DESKTOP_PORT = Number(process.env.EDITOR_PORT || 47321);

/** 本机静态页 + 同源代理 Nest（/auth /docs /agents /upload /teams），避免 WebView CORS。 */
export function startDesktopServer(distDir: string): Promise<number> {
  const root = path.resolve(distDir);
  const gatewayBase = resolveGatewayBase();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;

    if (req.method !== "GET" && req.method !== "HEAD" && !shouldProxy(pathname)) {
      res.statusCode = 405;
      res.setHeader("Allow", "GET, HEAD");
      res.end();
      return;
    }
    if (shouldProxy(pathname)) {
      proxyToGateway(req, res, gatewayBase);
      return;
    }
    if (serveDownload(root, req, res)) {
      return;
    }
    serveStatic(root, req, res);
  });

  const listen = (port: number): Promise<number> =>
    new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        server.off("error", onError);
        if (err.code === "EADDRINUSE" && port !== 0) {
          resolve(listen(0));
          return;
        }
        reject(err);
      };
      server.once("error", onError);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onError);
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("DESKTOP_PORT"));
          return;
        }
        resolve(address.port);
      });
    });

  return listen(Number.isFinite(DESKTOP_PORT) && DESKTOP_PORT > 0 ? DESKTOP_PORT : 47321);
}
