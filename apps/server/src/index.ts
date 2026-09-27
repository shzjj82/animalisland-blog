import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { ensureDataDirs, env, isDocsBackend, isLocalBackend } from "./env.js";
import { authRouter } from "./routes/auth.js";
import { aiRouter } from "./routes/ai.js";
import { categoriesRouter } from "./routes/categories.js";
import { postsRouter } from "./routes/posts.js";
import { uploadRouter } from "./routes/upload.js";
import { fail, ok } from "./http.js";
import { publicOrigin, robotsTxt, sitemapXml } from "./seo.js";

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
    if (isDocsBackend()) {
      const { docsHealth } = await import("./docs-client.js");
      const docs = await docsHealth();
      ok(res, { status: "up", backend: "docs", docs: docs.status ?? "up" });
      return;
    }
    const { db } = await import("./db.js");
    db.prepare("SELECT 1 AS ok").get();
    ok(res, { status: "up", backend: "local", db: "up" });
  } catch {
    fail(res, isDocsBackend() ? "DOCS_DOWN" : "DB_DOWN", 503, isDocsBackend() ? "文档服务不可用" : "数据库不可用");
  }
});

app.use("/api/auth", authRouter);
app.use("/api/ai", aiRouter);
app.use("/api/posts", postsRouter);
app.use("/api/categories", categoriesRouter);
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

// 页面由 Next.js 提供；Express 只负责 API / 上传 / SEO 文件

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err && typeof err === "object" && "name" in err && err.name === "DocsError") {
    const docsErr = err as { code?: string; status?: number };
    fail(res, docsErr.code || "DOCS_UNAVAILABLE", docsErr.status || 503);
    return;
  }
  if (err && typeof err === "object" && "name" in err && err.name === "UcError") {
    const ucErr = err as { code?: string; status?: number; message?: string };
    fail(res, ucErr.code || "AUTH_ERROR", ucErr.status || 503, ucErr.message);
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

async function start() {
  if (isLocalBackend()) {
    const { ensureLocalAdmin } = await import("./local-auth.js");
    ensureLocalAdmin();
    const { ensureWorkspacePages } = await import("./posts.js");
    await ensureWorkspacePages();
  }

  // 默认分类在博客侧种子（Nest docs 不内置产品文案）
  try {
    const { ensureDefaultCategories } = await import("./categories.js");
    await ensureDefaultCategories();
  } catch (err) {
    const code = err instanceof Error ? err.message : String(err);
    console.warn(`ensureDefaultCategories skipped (${code})`);
  }

  if (isDocsBackend()) {
    try {
      const { docsHealth } = await import("./docs-client.js");
      const docs = await docsHealth();
      console.log(`docs health: ${docs.status ?? "up"} (${env.gatewayBaseUrl})`);
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      console.warn(`docs health check failed (${code}); continuing listen → ${env.gatewayBaseUrl}`);
    }
  }

  app.listen(env.port, env.host, () => {
    const mode = isDocsBackend() ? `nest → ${env.gatewayBaseUrl}` : `local sqlite → ${env.databasePath}`;
    console.log(`myblog server http://${env.host}:${env.port} (${env.nodeEnv}, ${mode})`);
  });
}

void start().catch((err) => {
  console.error("server failed to start:", err);
  process.exit(1);
});
