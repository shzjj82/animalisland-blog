import { timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { requireAuth, signToken } from "../auth.js";
import { env } from "../env.js";
import { fail, ok } from "../http.js";

export const authRouter = Router();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

type Attempt = { count: number; resetAt: number };
const loginAttempts = new Map<string, Attempt>();

function clientKey(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return req.ip || "unknown";
}

function takeLoginSlot(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const row = loginAttempts.get(key);
  if (!row || row.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true };
  }
  if (row.count >= LOGIN_MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((row.resetAt - now) / 1000)) };
  }
  row.count += 1;
  return { ok: true };
}

function clearLoginSlot(key: string): void {
  loginAttempts.delete(key);
}

function safeEqualString(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // 仍做一次等长比较，降低长度侧信道；结果恒为 false
    timingSafeEqual(left, Buffer.alloc(left.length));
    return false;
  }
  return timingSafeEqual(left, right);
}

authRouter.post("/login", async (req, res) => {
  const key = clientKey(req);
  const slot = takeLoginSlot(key);
  if (!slot.ok) {
    res.setHeader("Retry-After", String(slot.retryAfterSec));
    fail(res, "TOO_MANY_ATTEMPTS", 429, "尝试过多，请稍后再试");
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  const userOk = typeof username === "string" && safeEqualString(username, env.adminUsername);
  const passOk = typeof password === "string" && safeEqualString(password, env.adminPassword);
  if (!userOk || !passOk) {
    fail(res, "INVALID_CREDENTIALS", 401);
    return;
  }

  clearLoginSlot(key);
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
  res.clearCookie("token", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProd,
  });
  ok(res, null);
});

authRouter.get("/me", requireAuth, (_req, res) => {
  ok(res, { username: env.adminUsername });
});
