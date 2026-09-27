/**
 * Nest 网关共用请求：单基址 GATEWAY_BASE_URL，路径区分 /auth/* 与 /docs/*。
 */
import { env } from "./env.js";

export type GatewayEnvelope<T> = {
  success?: boolean;
  code?: number | string;
  message?: string;
  data?: T | null;
};

export function gatewayBaseUrl(): string {
  return env.gatewayBaseUrl;
}

export function gatewayUrl(path: string, query?: Record<string, unknown>): string {
  const base = `${gatewayBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
  if (!query) {
    return base;
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

export async function gatewayFetch(
  path: string,
  init?: RequestInit & {
    query?: Record<string, unknown>;
    timeoutMs?: number;
  },
): Promise<Response> {
  const { query, timeoutMs: overrideTimeout, ...rest } = init ?? {};
  const url = gatewayUrl(path, query);
  const timeoutMs =
    Number.isFinite(overrideTimeout) && (overrideTimeout as number) > 0
      ? (overrideTimeout as number)
      : Number.isFinite(env.docsTimeoutMs) && env.docsTimeoutMs > 0
        ? env.docsTimeoutMs
        : 15_000;

  const headers = new Headers(rest.headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  try {
    return await fetch(url, {
      ...rest,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw Object.assign(new Error("GATEWAY_TIMEOUT"), { code: "GATEWAY_TIMEOUT", cause: err });
    }
    throw Object.assign(new Error("GATEWAY_UNAVAILABLE"), { code: "GATEWAY_UNAVAILABLE", cause: err });
  }
}

export async function readGatewayJson<T>(response: Response): Promise<GatewayEnvelope<T> | null> {
  return (await response.json().catch(() => null)) as GatewayEnvelope<T> | null;
}
