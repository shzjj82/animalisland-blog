/** 生产与本地统一回到 /app（Vite / 桌面服务都对 /app 做 SPA 回落） */
export function appHomePath(): string {
  return "/app";
}

/** `/markdown` 或 `/app/markdown`（含尾斜杠） */
export function isMarkdownRoute(pathname = window.location.pathname): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === "/markdown" || path === "/app/markdown";
}

export function markdownPath(): string {
  return "/markdown";
}

const PENDING_PAGE_KEY = "editor:pending-page-id";

export function setPendingPageId(id: string): void {
  sessionStorage.setItem(PENDING_PAGE_KEY, id);
}

export function takePendingPageId(): string | null {
  const id = sessionStorage.getItem(PENDING_PAGE_KEY);
  if (id) {
    sessionStorage.removeItem(PENDING_PAGE_KEY);
  }
  return id;
}

export function goAppHome(): void {
  const home = appHomePath();
  if (window.location.pathname === home) {
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  window.history.pushState({}, "", home);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
