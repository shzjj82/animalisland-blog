"use client";

import { SITE_DESCRIPTION, SITE_NAME, starterArticleDocument, type PostListItem } from "@myblog/shared";
import { ExpandLeft, Home, Logout, MenuFold, MenuUnfold, TagOne } from "@icon-park/react";
import Link from "next/link";
import { usePathname, useRouter, useParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { CategoryManagerDialog } from "@/components/CategoryManagerDialog";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { iconParkOutline } from "@/lib/iconPark";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { PageTree } from "@/workspace/PageTree";
import { suspendWorkspaceAutosave } from "@/workspace/saveGate";
import "@/admin.css";

const SIDE_KEY = "myblog.workspace.sideCollapsed";
const LAST_PAGE_KEY = "myblog.workspace.lastPage";

export type WorkspaceOutlet = {
  reloadTree: () => Promise<PostListItem[]>;
  pages: PostListItem[];
  /** 侧栏树是否已完成首次加载（成功或失败） */
  treeReady: boolean;
  previewTreeTitle: (pageId: string, nextTitle: string) => void;
  editorNonce: number;
};

const WorkspaceContext = createContext<WorkspaceOutlet | null>(null);

function LoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/login");
  }, [router]);
  return null;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace 必须在 WorkspaceLayout 内使用");
  }
  return ctx;
}

export function WorkspaceLayout({ children }: { children: ReactNode }) {
  const { dark, setDark } = useTheme();
  const { username, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams<{ id?: string }>();
  const routePageId = params.id;
  const [pages, setPages] = useState<PostListItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState("");
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  /** 侧栏删了当前打开页的子页时，强制重载编辑器以同步正文里的 pageLink */
  const [editorNonce, setEditorNonce] = useState(0);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDE_KEY) === "1");
    } catch {
      setCollapsed(false);
    }
  }, []);

  const reloadTree = useCallback(async (signal?: AbortSignal) => {
    const data = await api.workspaceTree(signal);
    const next = Array.isArray(data.posts) ? data.posts : [];
    if (signal?.aborted) {
      return next;
    }
    setPages(next);
    setTreeError("");
    return next;
  }, []);

  /** 仅更新侧栏展示用标题，不写库（改正文大标题时即时预览） */
  const previewTreeTitle = useCallback((pageId: string, nextTitle: string) => {
    const title = nextTitle.trim() || "无标题";
    setPages((prev) => {
      const current = prev.find((p) => p.id === pageId);
      if (!current || current.title === title) {
        return prev;
      }
      return prev.map((p) => (p.id === pageId ? { ...p, title } : p));
    });
  }, []);

  useEffect(() => {
    if (!username) {
      return;
    }
    const controller = new AbortController();
    let attempt = 0;

    const isRetryable = (message: string) =>
      /API_PROXY_DOWN|502|ECONNREFUSED|Failed to fetch|fetch failed|NetworkError|不是 JSON|格式异常|HTTP_200|aborted/i.test(
        message,
      );

    const load = async () => {
      if (controller.signal.aborted) {
        return;
      }
      setTreeLoading(true);
      setTreeError("");
      try {
        const next = await reloadTree(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (next.length === 0) {
          attempt += 1;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, 800));
            if (!controller.signal.aborted) {
              await reloadTree(controller.signal);
            }
          }
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          return;
        }
        attempt += 1;
        const message = err instanceof Error ? err.message : "加载页面树失败";
        // API 热重启 / Next 编译阻塞 / 浏览器 Failed to fetch 时自动重试
        if (attempt < 5 && isRetryable(message)) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
          if (!controller.signal.aborted) {
            return load();
          }
          return;
        }
        setPages([]);
        setTreeError(message);
      } finally {
        if (!controller.signal.aborted) {
          setTreeLoading(false);
        }
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [username, reloadTree]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    if (routePageId) {
      try {
        localStorage.setItem(LAST_PAGE_KEY, routePageId);
      } catch {
        /* ignore */
      }
    }
  }, [routePageId]);

  const leave = async () => {
    await logout();
    router.push("/login");
  };

  const createArticle = async (parentId?: string | null) => {
    if (parentId) {
      await suspendWorkspaceAutosave();
      const { post } = await api.createChildPage(parentId);
      await reloadTree();
      if (routePageId === parentId) {
        setEditorNonce((n) => n + 1);
      }
      router.push(`/admin/p/${post.id}`);
      setMobileTreeOpen(false);
      return;
    }
    const { post } = await api.createPost({
      title: "无标题",
      type: "life",
      pageKind: "article",
      parentId: null,
      summary: "",
      coverUrl: "",
      body: starterArticleDocument(),
      visibility: "private",
    });
    await reloadTree();
    router.push(`/admin/p/${post.id}`);
    setMobileTreeOpen(false);
  };

  const reparentPage = async (pageId: string, parentId: string | null) => {
    const current = pages.find((p) => p.id === pageId);
    if (!current || current.pageKind !== "article") {
      return;
    }
    if ((current.parentId ?? null) === parentId) {
      return;
    }
    await suspendWorkspaceAutosave();
    const oldParentId = current.parentId;
    try {
      await api.reparentPage(pageId, parentId);
      await reloadTree();
      if (
        routePageId &&
        (routePageId === oldParentId || routePageId === parentId || routePageId === pageId)
      ) {
        setEditorNonce((n) => n + 1);
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "调整页面层级失败");
    }
  };

  const removePage = async (page: PostListItem) => {
    const label = pages.some((p) => p.parentId === page.id) ? "这篇文章及其子页面" : "这篇文章";
    if (!confirm(`确定删除${label}？`)) {
      return;
    }
    const parentId = page.parentId;
    const viewingParent = Boolean(parentId && routePageId === parentId);
    await api.deletePost(page.id);
    const next = await reloadTree();
    if (routePageId && !next.some((p) => p.id === routePageId)) {
      const fallback = next.find((p) => p.pageKind === "article") ?? next[0];
      router.push(fallback ? `/admin/p/${fallback.id}` : "/admin");
    } else if (viewingParent) {
      setEditorNonce((n) => n + 1);
    }
  };

  if (loading) {
    return null;
  }
  if (!username) {
    return <LoginRedirect />;
  }

  const selectedId = routePageId ?? (pathname.match(/^\/admin\/p\/([^/]+)/)?.[1] ?? undefined);

  const workspaceValue: WorkspaceOutlet = {
    reloadTree,
    pages,
    treeReady: Boolean(username) && !treeLoading,
    previewTreeTitle,
    editorNonce,
  };

  return (
    <WorkspaceContext.Provider value={workspaceValue}>
      <div
        className={cn(
          "desk workspace flex h-dvh overflow-hidden bg-background text-foreground",
          collapsed && "desk--side-collapsed",
          dark && "desk--dark",
        )}
      >
        <Seo title="工作区" description={SITE_DESCRIPTION} path={pathname} noindex />

        {mobileTreeOpen ? (
          <button
            type="button"
            className="workspace-backdrop fixed inset-0 z-30 bg-black/30 md:hidden"
            aria-label="关闭页面树"
            onClick={() => setMobileTreeOpen(false)}
          />
        ) : null}

        <aside
          className={cn(
            "workspace-side sticky top-0 z-40 flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,padding,transform] duration-200 ease-out",
            collapsed ? "w-[72px] px-2.5 py-3.5" : "w-64 px-3 py-4",
            "max-md:fixed max-md:inset-y-0 max-md:left-0",
            mobileTreeOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full",
            "md:translate-x-0",
          )}
          aria-label="页面树"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div
              className={cn(
                "grid min-h-9 items-center gap-1",
                collapsed ? "grid-cols-1 justify-items-center" : "grid-cols-[minmax(0,1fr)_auto]",
              )}
            >
              <button
                type="button"
                className={cn(
                  "inline-grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  collapsed ? "order-1" : "order-2 col-start-2",
                )}
                onClick={() => setCollapsed((v) => !v)}
                aria-expanded={!collapsed}
                aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
                title={collapsed ? "展开" : "收起"}
              >
                {collapsed ? <MenuUnfold {...iconParkOutline} size={18} /> : <MenuFold {...iconParkOutline} size={18} />}
              </button>
              {!collapsed ? (
                <Link
                  href="/admin"
                  className="order-1 min-w-0 truncate text-[17px] font-extrabold tracking-wide text-sidebar-foreground no-underline"
                  title={SITE_NAME}
                >
                  {SITE_NAME}
                </Link>
              ) : null}
            </div>

            {treeLoading && pages.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">加载页面树…</p>
            ) : treeError && pages.length === 0 ? (
              <div className="space-y-2 px-2">
                <p className="text-xs text-destructive">页面树加载失败：{treeError}</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 w-full"
                  onClick={() => {
                    setTreeLoading(true);
                    setTreeError("");
                    void reloadTree()
                      .then((next) => {
                        if (next.length === 0) {
                          setTreeError("暂时没有页面，可点下方新建");
                        }
                      })
                      .catch((err) => {
                        if (err instanceof DOMException && err.name === "AbortError") {
                          return;
                        }
                        setPages([]);
                        setTreeError(err instanceof Error ? err.message : "加载页面树失败");
                      })
                      .finally(() => setTreeLoading(false));
                  }}
                >
                  重试
                </Button>
              </div>
            ) : (
              <PageTree
                pages={pages}
                selectedId={selectedId}
                collapsed={collapsed}
                onCreateArticle={(parentId) => void createArticle(parentId)}
                onDelete={(page) => void removePage(page)}
                onReparent={(pageId, parentId) => void reparentPage(pageId, parentId)}
                onCloseMobile={() => setMobileTreeOpen(false)}
              />
            )}
          </div>
        </aside>

        <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          <header className="z-[15] flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:px-6">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="md:hidden"
              onClick={() => setMobileTreeOpen(true)}
            >
              <ExpandLeft {...iconParkOutline} size={16} />
              页面
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex max-w-[160px] items-center gap-2 rounded-full bg-muted/60 px-3 py-1.5">
                <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="truncate text-sm font-medium text-foreground" title={username}>
                  {username}
                </span>
              </div>
              <Separator orientation="vertical" className="h-5" />
              <div className="flex items-center gap-2" title={dark ? "夜间" : "日间"}>
                <span className="text-xs font-medium text-muted-foreground">{dark ? "夜" : "日"}</span>
                <Switch checked={dark} onCheckedChange={setDark} aria-label="夜间模式" />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setTagManagerOpen(true)}
                title="标签管理"
              >
                <TagOne {...iconParkOutline} size={16} />
                标签
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/" title="回前台">
                  <Home {...iconParkOutline} size={16} />
                  前台
                </Link>
              </Button>
              <Button variant="outline" size="sm" onClick={() => void leave()} title="退出">
                <Logout {...iconParkOutline} size={15} />
                退出
              </Button>
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</main>
        </div>

        <CategoryManagerDialog open={tagManagerOpen} onOpenChange={setTagManagerOpen} />
      </div>
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceIndex() {
  const router = useRouter();
  const { pages, treeReady } = useWorkspace();

  useEffect(() => {
    if (!treeReady) {
      return;
    }
    if (pages.length === 0) {
      return;
    }
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_PAGE_KEY);
    } catch {
      last = null;
    }
    // about 已删除：localStorage 里旧 id 若不在树中则忽略
    const byLast = last ? pages.find((p) => p.id === last) : undefined;
    const target = byLast ?? pages.find((p) => p.pageKind === "article") ?? pages[0];
    if (target) {
      router.replace(`/admin/p/${target.id}`);
    }
  }, [treeReady, pages, router]);

  if (!treeReady) {
    return <p className="px-6 py-10 text-sm text-muted-foreground">打开工作区…</p>;
  }

  if (pages.length === 0) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-muted-foreground">
          还没有页面。点左侧「页面」新建，或刷新后重试。
        </p>
      </div>
    );
  }

  return <p className="px-6 py-10 text-sm text-muted-foreground">打开工作区…</p>;
}
