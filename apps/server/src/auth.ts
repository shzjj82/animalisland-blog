import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { env, hasGatewayConfig } from "./env.js";
import { fail } from "./http.js";
import {
  localLogout,
  localMe,
  localRefresh,
  usesLocalAuth,
} from "./local-auth.js";
import { requestContext } from "./request-context.js";
import {
  displayUsername,
  ucLogout,
  ucMe,
  ucRefresh,
  type UcAuthResult,
  type UcUser,
} from "./uc-client.js";

export const ACCESS_COOKIE = "token";
export const REFRESH_COOKIE = "refresh_token";

export type AuthUser = {
  id: string;
  username: string;
  nickname: string;
  role: string;
  roles: string[];
};

declare global {
  namespace Express {
    interface Request {
      authed?: boolean;
      authUser?: AuthUser;
      accessToken?: string;
    }
  }
}

function cookieBase(): CookieOptions {
  // 仅在 HTTPS（SITE_URL）或显式 COOKIE_SECURE=1 时下发 Secure，避免本地 HTTP Docker 丢登录态
  const secure = process.env.COOKIE_SECURE === "1" || Boolean(env.siteUrl?.startsWith("https://"));
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
  };
}

export function setAuthCookies(res: Response, auth: UcAuthResult): void {
  const accessMs = Math.max(60, auth.expiresIn || 7200) * 1000;
  const refreshMs = Math.max(3600, auth.refreshExpiresIn || 30 * 24 * 3600) * 1000;
  res.cookie(ACCESS_COOKIE, auth.token, { ...cookieBase(), maxAge: accessMs });
  res.cookie(REFRESH_COOKIE, auth.refreshToken, { ...cookieBase(), maxAge: refreshMs });
}

export function clearAuthCookies(res: Response): void {
  const base = cookieBase();
  res.clearCookie(ACCESS_COOKIE, base);
  res.clearCookie(REFRESH_COOKIE, base);
}

function toAuthUser(user: UcUser): AuthUser {
  const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
  const role = String(user.role || (roles.includes("admin") ? "admin" : "user"));
  return {
    id: String(user.id),
    username: displayUsername(user),
    nickname: String(user.nickname || displayUsername(user)),
    role,
    roles,
  };
}

async function loadSession(req: Request, res: Response): Promise<{ token: string; user: AuthUser } | null> {
  const access = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  const refresh = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  const local = usesLocalAuth();

  if (access) {
    try {
      const me = local ? await localMe(access) : await ucMe(access);
      return { token: access, user: toAuthUser(me) };
    } catch {
      // try refresh below
    }
  }

  if (!refresh) {
    return null;
  }

  try {
    const next = local ? await localRefresh(refresh) : await ucRefresh(refresh);
    setAuthCookies(res, next);
    return { token: next.token, user: toAuthUser(next.user) };
  } catch {
    clearAuthCookies(res);
    return null;
  }
}

function runWithAuth(
  req: Request,
  session: { token: string; user: AuthUser },
  next: (err?: unknown) => void,
): void {
  req.authed = true;
  req.authUser = session.user;
  req.accessToken = session.token;
  requestContext.run({ accessToken: session.token, user: session.user }, () => next());
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const session = await loadSession(req, res);
    if (!session) {
      fail(res, "UNAUTHORIZED", 401);
      return;
    }
    runWithAuth(req, session, next);
  } catch {
    fail(res, "UNAUTHORIZED", 401);
  }
};

export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    const access = req.cookies?.[ACCESS_COOKIE] as string | undefined;
    const refresh = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!access && !refresh) {
      next();
      return;
    }
    const session = await loadSession(req, _res);
    if (session) {
      runWithAuth(req, session, next);
      return;
    }
  } catch {
    // ignore
  }
  next();
};

export async function destroySession(req: Request, res: Response): Promise<void> {
  const access = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  const refresh = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (usesLocalAuth()) {
    await localLogout();
  } else if (hasGatewayConfig()) {
    await ucLogout(access, refresh);
  }
  clearAuthCookies(res);
}
