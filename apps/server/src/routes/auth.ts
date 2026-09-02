import { Router } from "express";
import { requireAuth, signToken } from "../auth.js";
import { env } from "../env.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username !== env.adminUsername || password !== env.adminPassword) {
    res.status(401).json({ error: "INVALID_CREDENTIALS" });
    return;
  }

  const token = await signToken();
  res.cookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
    maxAge: env.jwtExpiresDays * 24 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ ok: true, username: env.adminUsername });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (_req, res) => {
  res.json({ username: env.adminUsername });
});
