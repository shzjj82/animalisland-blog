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
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/** 打包时由 esbuild define 写入 process.env.DESKTOP_GATEWAY_BASE */
const PROXY_ROOTS = ["/auth", "/docs", "/agents", "/upload"] as const;

function resolveGatewayBase(): string {
  const fromBake = (process.env.DESKTOP_GATEWAY_BASE || "").trim();
  const fromEnv = (process.env.GATEWAY_BASE_URL || process.env.NEST_BASE_URL || "").trim();
  return (fromBake || fromEnv || "https://api.championsea.online").replace(/\/$/, "");
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

function sendFile(res: ServerResponse, file: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }
  const file = path.resolve(root, `.${pathname}`);
  const inside = file === root || file.startsWith(`${root}${path.sep}`);
  if (!inside) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    sendFile(res, file);
    return;
  }
  const index = path.join(root, "index.html");
  if (fs.existsSync(index)) {
    sendFile(res, index);
    return;
  }
  res.statusCode = 404;
  res.end("Not found");
}

/** 本机静态页 + 同源代理 Nest（/auth /docs /agents /upload），避免 WebView CORS。 */
export function startDesktopServer(distDir: string): Promise<number> {
  const root = path.resolve(distDir);
  const gatewayBase = resolveGatewayBase();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (shouldProxy(pathname)) {
      proxyToGateway(req, res, gatewayBase);
      return;
    }
    serveStatic(root, req, res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("DESKTOP_PORT"));
        return;
      }
      resolve(address.port);
    });
  });
}
