import fs from "node:fs";
import path from "node:path";
import compression from "compression";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { ensureDataDirs, env, repoRoot } from "./env.js";
import "./db.js";
import "./categories.js";
import { authRouter } from "./routes/auth.js";
import { aiRouter } from "./routes/ai.js";
import { categoriesRouter } from "./routes/categories.js";
import { postsRouter } from "./routes/posts.js";
import { siteRouter } from "./routes/site.js";
import { uploadRouter } from "./routes/upload.js";
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
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
app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").set("Cache-Control", "public, max-age=300").send(sitemapXml(publicOrigin(req)));
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
  app.get("*", (req, res) => {
    const origin = publicOrigin(req);
    const meta = metaForRequest(req);
    res.status(meta.status);
    res.setHeader("Cache-Control", "no-cache");
    res.type("html").send(applyHtmlMeta(indexHtml, origin, meta));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "SERVER_ERROR";
  if (message === "UNSUPPORTED_TYPE" || message === "INVALID_CATEGORY") {
    res.status(400).json({ error: message });
    return;
  }
  if (message === "OSS_NOT_CONFIGURED") {
    res.status(500).json({ error: message });
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
    res.status(status).json({ error: message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "SERVER_ERROR" });
});

app.listen(env.port, env.host, () => {
  console.log(`myblog server http://${env.host}:${env.port} (${env.nodeEnv})`);
});
