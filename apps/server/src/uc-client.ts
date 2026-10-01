/**
 * Nest 网关（usercenter）客户端：登录 / 刷新 / me / 登出。
 * 与 docs 共用 GATEWAY_BASE_URL；路径仅 /auth/*。
 */
import { env } from "./env.js";
import { gatewayFetch, readGatewayJson, type GatewayEnvelope } from "./gateway-client.js";

export class UcError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message || code);
    this.name = "UcError";
  }
}

export type UcUser = {
  id: string;
  username: string | null;
  nickname: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  [key: string]: unknown;
};

export type UcAuthResult = {
  token: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresIn: number;
  user: UcUser;
};

async function authRequest<T>(
  method: string,
  path: string,
  opts?: {
    body?: unknown;
    token?: string;
  },
): Promise<T> {
  const headers: Record<string, string> = {
    "X-Biz-Code": env.docsAppCode,
    "X-App-Code": env.authAppCode,
  };
  if (opts?.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await gatewayFetch(path, {
      method,
      headers,
      body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "GATEWAY_TIMEOUT") {
      throw new UcError("AUTH_TIMEOUT", 504, "用户中心超时");
    }
    throw new UcError("AUTH_UNAVAILABLE", 503, "用户中心不可用");
  }

  const json = (await readGatewayJson<T>(response)) as GatewayEnvelope<T> | null;
  if (!json || typeof json !== "object") {
    throw new UcError("SERVER_ERROR", response.status || 502, "用户中心响应异常");
  }
  if (json.success === false || response.status >= 400) {
    const status = typeof json.code === "number" ? json.code : response.status;
    throw new UcError(String(json.message || "AUTH_ERROR"), status >= 400 ? status : 400, json.message);
  }
  return json.data as T;
}

export async function ucLogin(username: string, password: string): Promise<UcAuthResult> {
  return authRequest<UcAuthResult>("POST", "/auth/login", {
    body: { username, password },
  });
}

export async function ucRegister(input: {
  username: string;
  password: string;
  nickname?: string;
}): Promise<UcAuthResult> {
  return authRequest<UcAuthResult>("POST", "/auth/register", {
    body: {
      username: input.username,
      password: input.password,
      nickname: input.nickname,
    },
  });
}

export async function ucRefresh(refreshToken: string): Promise<UcAuthResult> {
  return authRequest<UcAuthResult>("POST", "/auth/refresh", {
    body: { refreshToken },
  });
}

export async function ucMe(accessToken: string): Promise<UcUser> {
  return authRequest<UcUser>("GET", "/auth/me", { token: accessToken });
}

export async function ucLogout(accessToken: string | undefined, refreshToken: string | undefined): Promise<void> {
  try {
    await authRequest<null>("POST", "/auth/logout", {
      token: accessToken,
      body: refreshToken ? { refreshToken } : {},
    });
  } catch {
    // 登出以清本地 cookie 为准；远端失败忽略
  }
}

export function displayUsername(user: UcUser): string {
  return (user.username || user.nickname || user.id || "").trim() || "user";
}
