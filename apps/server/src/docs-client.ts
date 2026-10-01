/**
 * 只请求文档服务：分类和文档的存查。
 * - 业务码 X-Biz-Code、应用码 X-App-Code 都用 docsAppCode（默认 blog）；不要再放进 query / body
 * - 公开读：可不带凭证
 * - 写 / 工作区：用户 Nest JWT
 * - feed：有 JWT 则带，否则无凭证（绝不回退 service key）
 * - auto：JWT → service key → none
 * x-docs-key 只放服务端，不要下发到浏览器。
 * 与 auth 共用 GATEWAY_BASE_URL；文档路径用 /docs/documents（勿用已移除的 /docs/posts）。
 */
import { env } from "./env.js";
import { gatewayFetch, readGatewayJson, type GatewayEnvelope } from "./gateway-client.js";
import { getAccessToken } from "./request-context.js";

export class DocsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "DocsError";
  }
}

export type DocsCredential = "none" | "user" | "service" | "auto" | "prefer-user-or-none";

export async function docsRequest<T>(
  method: string,
  path: string,
  opts?: {
    query?: Record<string, unknown>;
    body?: unknown;
    /**
     * none: 无 Authorization / x-docs-key
     * user: 必须有 JWT，否则 UNAUTHORIZED
     * service: 仅 x-docs-key
     * prefer-user-or-none: 有 JWT 则带，否则不带（绝不发 service key；用于 feed/public）
     * auto（默认）: JWT → service key → none
     */
    credential?: DocsCredential;
    /** @deprecated 使用 credential: 'service' */
    serviceKeyOnly?: boolean;
  },
): Promise<T> {
  const query = opts?.query;
  const headers: Record<string, string> = {
    "X-Biz-Code": env.docsAppCode,
    "X-App-Code": env.docsAppCode,
  };

  const credential: DocsCredential = opts?.serviceKeyOnly
    ? "service"
    : (opts?.credential ?? "auto");

  if (credential === "none") {
    /* no auth headers */
  } else if (credential === "user") {
    const userToken = getAccessToken();
    if (!userToken) {
      throw new DocsError("UNAUTHORIZED", 401);
    }
    headers.Authorization = `Bearer ${userToken}`;
  } else if (credential === "service") {
    if (env.docsServiceKey) {
      headers["x-docs-key"] = env.docsServiceKey;
    }
  } else if (credential === "prefer-user-or-none") {
    const userToken = getAccessToken();
    if (userToken) {
      headers.Authorization = `Bearer ${userToken}`;
    }
  } else {
    // auto
    const userToken = getAccessToken();
    if (userToken) {
      headers.Authorization = `Bearer ${userToken}`;
    } else if (env.docsServiceKey) {
      headers["x-docs-key"] = env.docsServiceKey;
    }
  }

  let body: string | undefined;
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }

  let response: Response;
  try {
    response = await gatewayFetch(path, { method, headers, query, body });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "GATEWAY_TIMEOUT") {
      throw new DocsError("DOCS_TIMEOUT", 504);
    }
    throw new DocsError("DOCS_UNAVAILABLE", 503);
  }

  const json = (await readGatewayJson<T>(response)) as GatewayEnvelope<T> | null;
  if (!json || typeof json !== "object") {
    throw new DocsError("SERVER_ERROR", response.status || 502);
  }
  if (json.success === false || response.status >= 400) {
    const status = typeof json.code === "number" ? json.code : response.status;
    throw new DocsError(String(json.message || "SERVER_ERROR"), status >= 400 ? status : 502);
  }
  return json.data as T;
}

export async function docsHealth(): Promise<{ status: string }> {
  return docsRequest<{ status: string }>("GET", "/docs/health", { credential: "service" });
}
