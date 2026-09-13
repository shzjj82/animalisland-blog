import { SITE_DESCRIPTION, SITE_NAME, emptyEditorDocument, type PostListItem } from "@myblog/shared";
import { ExpandLeft, Home, Logout, MenuFold, MenuUnfold } from "@icon-park/react";
import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { api } from "@/lib/api";
import { iconParkOutline } from "@/lib/iconPark";
import { appendPageLink } from "@/lib/pageLinks";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { PageTree } from "@/workspace/PageTree";
import "@/admin.css";

const SIDE_KEY = "myblog.workspace.sideCollapsed";
const LAST_PAGE_KEY = "myblog.workspace.lastPage";

export function WorkspaceLayout() {
  const { dark, setDark } = useTheme();
  const { username, loading, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { id: routePageId } = useParams();
  const [pages, setPages] = useState<PostListItem[]>([]);
  const [treeLoading, setTreeLoading] = useState(true);
  const [mobileTreeOpen, setMobileTreeOpen] = useState(false);
  /** 侧栏删了当前打开页的子页时，强制重载编辑器以同步正文里的 pageLink */
  const [editorNonce, setEditorNonce] = useState(0);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const reloadTree = useCallback(async () => {
    const data = await api.workspaceTree();
    setPages(data.posts);
    return data.posts;
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
    setTreeLoading(true);
    void reloadTree()
      .catch(() => setPages([]))
      .finally(() => setTreeLoading(false));
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
    navigate("/login");
  };

  const createArticle = async (parentId?: string | null) => {
    const parent = parentId ? pages.find((p) => p.id === parentId) : undefined;
    const { post } = await api.createPost({
      title: "无标题",
      type: parent?.type || "life",
      pageKind: "article",
      parentId: parentId ?? null,
      summary: "",
      coverUrl: "",
      body: emptyEditorDocument(),
      // 子页无独立草稿；顶层文章默认草稿
      draft: parentId ? false : true,
    });
    if (parentId) {
      try {
        const { post: parentPost } = await api.getById(parentId);
        await api.updatePost(parentId, {
          title: parentPost.title,
          slug: parentPost.slug,
          type: parentPost.type,
          pageKind: "article",
          parentId: parentPost.parentId,
          summary: parentPost.summary,
          coverUrl: parentPost.coverUrl,
          props: parentPost.props,
          body: appendPageLink(parentPost.body, post),
          draft: parentPost.draft,
        });
      } catch {
        /* 子页已建好，父文链接写入失败时可从侧栏进入 */
      }
    }
    await reloadTree();
    navigate(`/admin/p/${post.id}`);
    setMobileTreeOpen(false);
  };

  const removePage = async (page: PostListItem) => {
    if (page.pageKind === "about") {
      return;
    }
    const label = pages.some((p) => p.parentId === page.id) ? "这篇文章及其子页面" : "这篇文章";
    if (!confirm(`确定删除${label}？`)) {
      return;
    }
    const parentId = page.parentId;
    const viewingParent = Boolean(parentId && routePageId === parentId);
    await api.deletePost(page.id);
    const next = await reloadTree();
    if (routePageId && !next.some((p) => p.id === routePageId)) {
      const fallback =
        next.find((p) => p.pageKind === "about") ??
        next.find((p) => p.pageKind === "article") ??
        next[0];
      navigate(fallback ? `/admin/p/${fallback.id}` : "/admin");
    } else if (viewingParent) {
      setEditorNonce((n) => n + 1);
    }
  };

  if (loading) {
    return null;
  }
  if (!username) {
    return <Navigate to="/login" replace />;
  }

  const selectedId = routePageId ?? (pathname.match(/^\/admin\/p\/([^/]+)/)?.[1] ?? undefined);

  return (
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
                to="/admin"
                className="order-1 min-w-0 truncate text-[17px] font-extrabold tracking-wide text-sidebar-foreground no-underline"
                title={SITE_NAME}
              >
                {SITE_NAME}
              </Link>
            ) : null}
          </div>

          {treeLoading && pages.length === 0 ? (
            <p className="px-2 text-xs text-muted-foreground">加载页面树…</p>
          ) : (
            <PageTree
              pages={pages}
              selectedId={selectedId}
              collapsed={collapsed}
              onCreateArticle={(parentId) => void createArticle(parentId)}
              onDelete={(page) => void removePage(page)}
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
            <Button variant="ghost" size="sm" asChild>
              <Link to="/" title="回前台">
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

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet context={{ reloadTree, pages, previewTreeTitle, editorNonce }} />
        </main>
      </div>
    </div>
  );
}

export function WorkspaceIndex() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const { posts } = await api.workspaceTree();
        if (!alive) {
          return;
        }
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_PAGE_KEY);
        } catch {
          last = null;
        }
        const byLast = last ? posts.find((p) => p.id === last) : undefined;
        const about = posts.find((p) => p.pageKind === "about");
        const target = byLast ?? about ?? posts.find((p) => p.pageKind === "article") ?? posts[0];
        if (target) {
          navigate(`/admin/p/${target.id}`, { replace: true });
        } else {
          setReady(true);
        }
      } catch {
        if (alive) {
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  if (!ready) {
    return <p className="px-6 py-10 text-sm text-muted-foreground">打开工作区…</p>;
  }

  return (
    <div className="px-6 py-10">
      <p className="text-sm text-muted-foreground">还没有页面。请刷新或检查服务端迁移。</p>
    </div>
  );
}

export function RedirectToSpecial({ kind }: { kind: "about" }) {
  const navigate = useNavigate();
  useEffect(() => {
    void api.workspaceSpecials().then((data) => {
      const page = data[kind];
      if (page) {
        navigate(`/admin/p/${page.id}`, { replace: true });
      } else {
        navigate("/admin", { replace: true });
      }
    });
  }, [kind, navigate]);
  return <p className="px-6 py-10 text-sm text-muted-foreground">跳转中…</p>;
}

export function RedirectWrite() {
  const { id } = useParams();
  if (id) {
    return <Navigate to={`/admin/p/${id}`} replace />;
  }
  return <Navigate to="/admin" replace />;
}
