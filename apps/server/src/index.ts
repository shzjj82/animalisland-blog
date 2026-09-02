import path from "node:path";
import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import { ensureDataDirs, env, repoRoot } from "./env.js";
import "./db.js";
import { authRouter } from "./routes/auth.js";
import { postsRouter } from "./routes/posts.js";
import { siteRouter } from "./routes/site.js";
import { uploadRouter } from "./routes/upload.js";

ensureDataDirs();

const app = express();

app.use(
  cors({
    origin: env.isProd ? false : env.corsOrigin,
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(env.uploadDir));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/posts", postsRouter);
app.use("/api/site", siteRouter);
app.use("/api/upload", uploadRouter);

const webDist = path.join(repoRoot, "apps/web/dist");
if (env.isProd) {
  app.use(express.static(webDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "SERVER_ERROR";
  if (message === "UNSUPPORTED_TYPE") {
    res.status(400).json({ error: message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "SERVER_ERROR" });
});

app.listen(env.port, env.host, () => {
  console.log(`myblog server http://${env.host}:${env.port} (${env.nodeEnv})`);
});
