import { Router, type Request } from "express";
import { destroySession, requireAuth, setAuthCookies } from "../auth.js";
import { fail, ok } from "../http.js";
import { localLogin, localRegister, usesLocalAuth } from "../local-auth.js";
import { UcError, displayUsername, ucLogin, ucRegister } from "../uc-client.js";

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

function failAuth(res: Parameters<typeof fail>[0], err: unknown, fallbackStatus = 401): boolean {
  if (err instanceof UcError) {
    if (err.status === 401 || err.status === 403) {
      fail(res, "INVALID_CREDENTIALS", err.status === 403 ? 403 : 401, err.message);
      return true;
    }
    if (err.status === 409) {
      fail(res, "USERNAME_TAKEN", 409, err.message || "用户名已被占用");
      return true;
    }
    if (err.status === 400) {
      fail(res, "INVALID_INPUT", 400, err.message || "注册信息不完整");
      return true;
    }
    if (err.status === 503 || err.status === 504) {
      fail(res, err.code, err.status, err.message);
      return true;
    }
    fail(res, err.code || "AUTH_ERROR", fallbackStatus, err.message);
    return true;
  }
  if (err && typeof err === "object" && "status" in err) {
    const status = Number((err as { status: number }).status);
    const message = err instanceof Error ? err.message : "AUTH_ERROR";
    const code = "code" in err ? String((err as { code: string }).code) : "";
    if (status === 409 || code === "USERNAME_TAKEN") {
      fail(res, "USERNAME_TAKEN", 409, message || "用户名已被占用");
      return true;
    }
    if (status === 401 || code === "INVALID_CREDENTIALS") {
      fail(res, "INVALID_CREDENTIALS", 401, message);
      return true;
    }
    if (status === 400) {
      fail(res, "INVALID_INPUT", 400, message);
      return true;
    }
  }
  return false;
}

authRouter.post("/register", async (req, res) => {
  const { username, password, nickname } = req.body as {
    username?: string;
    password?: string;
    nickname?: string;
  };
  const name = typeof username === "string" ? username.trim() : "";
  const nick = typeof nickname === "string" ? nickname.trim() : "";
  if (!name || typeof password !== "string" || !password) {
    fail(res, "INVALID_INPUT", 400, "请填写用户名和密码");
    return;
  }
  if (name.length < 2 || name.length > 32) {
    fail(res, "INVALID_INPUT", 400, "用户名长度需为 2-32");
    return;
  }
  if (password.length < 6 || password.length > 64) {
    fail(res, "INVALID_INPUT", 400, "密码长度需为 6-64");
    return;
  }

  try {
    const auth = usesLocalAuth()
      ? await localRegister({ username: name, password, nickname: nick || name })
      : await ucRegister({ username: name, password, nickname: nick || name });
    setAuthCookies(res, auth);
    ok(res, { username: displayUsername(auth.user) }, 201);
  } catch (err) {
    if (failAuth(res, err, 400)) {
      return;
    }
    fail(res, "AUTH_ERROR", 400, "注册失败");
  }
});

authRouter.post("/login", async (req, res) => {
  const key = clientKey(req);
  const slot = takeLoginSlot(key);
  if (!slot.ok) {
    res.setHeader("Retry-After", String(slot.retryAfterSec));
    fail(res, "TOO_MANY_ATTEMPTS", 429, "尝试过多，请稍后再试");
    return;
  }

  const { username, password } = req.body as { username?: string; password?: string };
  if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
    fail(res, "INVALID_CREDENTIALS", 401);
    return;
  }

  try {
    const auth = usesLocalAuth()
      ? await localLogin(username.trim(), password)
      : await ucLogin(username.trim(), password);
    clearLoginSlot(key);
    setAuthCookies(res, auth);
    ok(res, { username: displayUsername(auth.user) });
  } catch (err) {
    if (failAuth(res, err, 401)) {
      return;
    }
    fail(res, "INVALID_CREDENTIALS", 401);
  }
});

authRouter.post("/logout", async (req, res) => {
  await destroySession(req, res);
  ok(res, null);
});

authRouter.get("/me", requireAuth, (req, res) => {
  ok(res, { username: req.authUser?.username || "" });
});
