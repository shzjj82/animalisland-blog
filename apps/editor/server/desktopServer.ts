import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { apiFail } from "@myblog/shared";
import { handleAiRequest } from "./plugin.ts";

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

function sendFile(res: http.ServerResponse, file: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}

function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): void {
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

/** 本机页面和写作接口。只监听回环地址，密钥留在这个进程里。 */
export function startDesktopServer(distDir: string): Promise<number> {
  const root = path.resolve(distDir);
  const server = http.createServer((req, res) => {
    void handleAiRequest(req, res)
      .then((done) => {
        if (!done) {
          serveStatic(root, req, res);
        }
      })
      .catch((err: unknown) => {
        const code = err instanceof Error ? err.message : "AI_FAILED";
        res.statusCode = 400;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(apiFail(code)));
      });
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
