/**
 * 只请求文档服务：分类和文档的存查。
 * x-docs-key 只放服务端，不要下发到浏览器。
 */
import { env } from "./env.js";

export class DocsError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
    this.name = "DocsError";
  }
}

type DocsEnvelope<T> = {
  success?: boolean;
  code?: number;
  message?: string;
  data?: T | null;
};

function queryString(query?: Record<string, unknown>): string {
  if (!query) {
    return "";
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export async function docsRequest<T>(
  method: string,
  path: string,
  opts?: {
    query?: Record<string, unknown>;
    body?: unknown;
  },
): Promise<T> {
  const query = { ...opts?.query, appCode: env.docsAppCode };
  const url = `${env.docsBaseUrl}${path}${queryString(query)}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-docs-key": env.docsServiceKey,
  };
  const init: RequestInit = { method, headers };
  if (opts?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    const body =
      opts.body && typeof opts.body === "object" && !Array.isArray(opts.body)
        ? { ...(opts.body as Record<string, unknown>), appCode: env.docsAppCode }
        : opts.body;
    init.body = JSON.stringify(body);
  }

  const timeoutMs = Number.isFinite(env.docsTimeoutMs) && env.docsTimeoutMs > 0 ? env.docsTimeoutMs : 15_000;
  init.signal = AbortSignal.timeout(timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new DocsError("DOCS_TIMEOUT", 504);
    }
    throw new DocsError("DOCS_UNAVAILABLE", 503);
  }

  const json = (await response.json().catch(() => null)) as DocsEnvelope<T> | null;
  if (!json || typeof json !== "object") {
    throw new DocsError("SERVER_ERROR", response.status || 502);
  }
  if (json.success === false || response.status >= 400) {
    throw new DocsError(String(json.message || "SERVER_ERROR"), Number(json.code || response.status));
  }
  return json.data as T;
}

export async function docsHealth(): Promise<{ status: string }> {
  return docsRequest<{ status: string }>("GET", "/docs/health");
}
