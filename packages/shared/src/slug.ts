export const RESERVED_PATHS = ["admin", "login", "post", "api", "uploads", "notes", "about"] as const;

export function isReservedPath(slug: string): boolean {
  return (RESERVED_PATHS as readonly string[]).includes(slug);
}

/**
 * 路由 param 可能已是百分号编码（Next 对非 ASCII path 常见），也可能是明文。
 * 统一解成明文，避免再 encode 时变成 %25xx 双重编码。
 */
export function decodeSlugParam(slug: string): string {
  const raw = String(slug ?? "");
  if (!raw.includes("%")) {
    return raw;
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 拼进 URL path 段：先归一成明文再编码，幂等 */
export function encodeSlugParam(slug: string): string {
  return encodeURIComponent(decodeSlugParam(slug));
}
