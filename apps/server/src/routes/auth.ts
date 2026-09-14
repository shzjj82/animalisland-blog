import { Router } from "express";
import { requireAuth, signToken } from "../auth.js";
import { env } from "../env.js";
import { fail, ok } from "../http.js";

export const authRouter = Router();

authRouter.post("/login", async (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (username !== env.adminUsername || password !== env.adminPassword) {
    fail(res, "INVALID_CREDENTIALS", 401);
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
  ok(res, { username: env.adminUsername });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie("token", { path: "/" });
  ok(res, null);
});

authRouter.get("/me", requireAuth, (_req, res) => {
  ok(res, { username: env.adminUsername });
});
