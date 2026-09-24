import fs from "node:fs";
import path from "node:path";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { docsHealth } from "./docs-client.js";
import { ensureDataDirs, env, repoRoot } from "./env.js";
import { authRouter } from "./routes/auth.js";
import { aiRouter } from "./routes/ai.js";
import { categoriesRouter } from "./routes/categories.js";
import { postsRouter } from "./routes/posts.js";
import { siteRouter } from "./routes/site.js";
import { uploadRouter } from "./routes/upload.js";
import { fail, ok } from "./http.js";
import { applyHtmlMeta, metaForRequest, publicOrigin, robotsTxt, sitemapXml } from "./seo.js";

ensureDataDirs();

const app = express();
app.set("trust proxy", 1);

app.use(compression());
app.use(
  cors({
    origin: env.isProd ? false : env.corsOrigin,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "8mb" }));
app.use(
  "/uploads",
  express.static(env.uploadDir, {
    maxAge: "1d",
    setHeaders(res) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    },
  }),
);

app.get("/api/health", async (_req, res) => {
  try {
    const docs = await docsHealth();
    ok(res, { status: "up", docs: docs.status ?? "up" });
  } catch {
    fail(res, "DOCS_DOWN", 503, "文档服务不可用");
  }
});

app.use("/api/auth", authRouter);
app.use("/api/ai", aiRouter);
app.use("/api/posts", postsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/site", siteRouter);
app.use("/api/upload", uploadRouter);

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").set("Cache-Control", "public, max-age=3600").send(robotsTxt(publicOrigin(req)));
});
app.get("/sitemap.xml", async (req, res, next) => {
  try {
    res.type("application/xml").set("Cache-Control", "public, max-age=300").send(await sitemapXml(publicOrigin(req)));
  } catch (err) {
    next(err);
  }
});

const webDist = path.join(repoRoot, "apps/web/dist");
const indexPath = path.join(webDist, "index.html");
if (env.isProd && fs.existsSync(indexPath)) {
  const indexHtml = fs.readFileSync(indexPath, "utf8");
  app.use(
    express.static(webDist, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  app.get("*", async (req, res, next) => {
    try {
      const origin = publicOrigin(req);
      const meta = await metaForRequest(req);
      res.status(meta.status);
      res.setHeader("Cache-Control", "no-cache");
      res.type("html").send(applyHtmlMeta(indexHtml, origin, meta));
    } catch (err) {
      next(err);
    }
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === "object" && "name" in err && err.name === "DocsError") {
    const docsErr = err as { code?: string; status?: number };
    fail(res, docsErr.code || "DOCS_UNAVAILABLE", docsErr.status || 503);
    return;
  }
  const message = err instanceof Error ? err.message : "SERVER_ERROR";
  if (message === "UNSUPPORTED_TYPE" || message === "INVALID_CATEGORY") {
    fail(res, message);
    return;
  }
  if (message === "OSS_NOT_CONFIGURED") {
    fail(res, message, 500);
    return;
  }
  if (
    message === "AI_NOT_CONFIGURED" ||
    message === "AI_EMPTY_PROMPT" ||
    message === "AI_EMPTY_BLOCKS" ||
    message === "AI_EMPTY_REPLY" ||
    message === "AI_BAD_JSON" ||
    message === "AI_TIMEOUT" ||
    message.startsWith("AI_UPSTREAM_")
  ) {
    const status = message === "AI_NOT_CONFIGURED" ? 503 : message === "AI_TIMEOUT" ? 504 : 502;
    fail(res, message, status);
    return;
  }
  console.error(err);
  fail(res, "SERVER_ERROR", 500);
});

app.listen(env.port, env.host, () => {
  console.log(`myblog server http://${env.host}:${env.port} (${env.nodeEnv})`);
});
