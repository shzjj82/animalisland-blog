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
 *   2. /version.json                        → 版本号 + 安装包清单（链接指向 OSS 直链）
 *   3. /downloads/*                         → 410 Gone（安装包已迁到 OSS，不再由本机托管）
 *   4. 别名 308 跳转                         → /download、/download.html、/downloads
 *   5. /                                     → dist/download.html（下载宣传页 = 站点首页）
 *   6. /app、/app/*                          → index.html（编辑器 SPA，含深链回落）
 *   7. dist 里真实存在的文件                  → 直接返回（带缓存头）
 *   8. 其他                                  → 404
 *
 * 安装包不再落在这台机器上：92MB 的 dmg 走 OSS + CDN 才有像样的下载速度，
 * 服务器只负责发页面和 /version.json，机器上不存大文件。
 * 编辑器不再占用根路径：根是给人的落地页，工具在 /app 下面。
 * 桌面版 WebView 也加载 /app（见 src-tauri/src/lib.rs）。
 */
const HOME_PAGE = "download.html";
const APP_PREFIX = "/app";
const VERSION_PATH = "/version.json";

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

/**
 * 安装包对外基地址，形如 `https://championsea.oss-cn-shanghai.aliyuncs.com/wiki-agent`
 * （绑了自定义域名/CDN 就换成那个域名）。末尾不带斜杠。
 * 没配就说明这个部署还没接 OSS：/version.json 里所有文件标成不可用，页面显示「构建中」，
 * 而不是给一个点进去 404 的链接。
 */
function resolveDownloadBase(): string {
  return (process.env.EDITOR_DOWNLOAD_BASE || process.env.PUBLIC_DOWNLOAD_BASE || "").trim().replace(/\/+$/, "");
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

/**
 * 探测 OSS 上某个安装包是否存在。结果缓存 60s：
 * 页面每次刷新都打一次 HEAD 也扛得住，发版后最多 1 分钟就看到新包。
 */
type Probe = { size: number | null; available: boolean };
const probeCache = new Map<string, { at: number; value: Promise<Probe> }>();
const PROBE_TTL = 60_000;

function probeObject(url: string): Promise<Probe> {
  const now = Date.now();
  const hit = probeCache.get(url);
  if (hit && now - hit.at < PROBE_TTL) return hit.value;

  const value = (async (): Promise<Probe> => {
    try {
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2000) });
      if (!res.ok) return { size: null, available: false };
      const size = Number(res.headers.get("content-length") ?? 0);
      return { size: size > 0 ? size : null, available: true };
    } catch {
      // 探测超时/网络抖动：不武断判死，按「可用但大小未知」处理，免得页面闪一下「构建中」
      return { size: null, available: true };
    }
  })();

  probeCache.set(url, { at: now, value });
  return value;
}

/**
 * /version.json：下载页唯一的数据源。
 * 版本与文件名以 dist/version.json（构建时生成）为准，链接指向 OSS 直链，
 * 再用一次 HEAD 探测确认对象真的在 —— 没上传就显示「构建中」，不给 404 链接。
 */
async function serveVersionJson(distRoot: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (pathname !== VERSION_PATH) {
    return false;
  }

  let version = "";
  let builtAt: string | null = null;
  let declared: Array<{ os: string; name: string; label?: string; optional?: boolean }> = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(distRoot, "version.json"), "utf8"));
    version = String(manifest.version ?? "");
    builtAt = typeof manifest.builtAt === "string" ? manifest.builtAt : null;
    declared = Array.isArray(manifest.files) ? manifest.files : [];
  } catch {
    // 没有 manifest 就没有可信的清单；返回空列表，页面保留 HTML 里的兜底文案
  }

  const base = resolveDownloadBase();
  const files = await Promise.all(
    declared.map(async (file) => {
      const url = base ? `${base}/${encodeURIComponent(version)}/${encodeURIComponent(file.name)}` : "";
      const probe = url ? await probeObject(url) : { size: null, available: false };
      return {
        os: file.os,
        name: file.name,
        label: file.label ?? "",
        url,
        size: probe.size,
        available: probe.available,
        optional: Boolean(file.optional),
      };
    }),
  );

  const body = JSON.stringify({ version, builtAt, files }, null, 2);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

/** 安装包已迁到 OSS：这里只说明去哪拿，别再让旧链接默默 404 */
function serveLegacyDownload(req: IncomingMessage, res: ServerResponse): boolean {
  const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  if (!pathname.startsWith("/downloads/")) {
    return false;
  }
  res.statusCode = 410;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Gone：安装包已迁到对象存储，请用 /version.json 里的直链。\n");
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
    if (serveLegacyDownload(req, res)) {
      return;
    }
    // /version.json 要探一次 OSS，是异步的；其余路由都是同步的
    void serveVersionJson(root, req, res)
      .then((handled) => {
        if (!handled) serveStatic(root, req, res);
      })
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ version: "", files: [] }));
        }
      });
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
