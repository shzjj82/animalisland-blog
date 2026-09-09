import { SITE_DESCRIPTION, SITE_NAME } from "@myblog/shared";
import {
  Home,
  Info,
  Logout,
  MenuFold,
  MenuUnfold,
  Notebook,
  Picture,
} from "@icon-park/react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";
import "@/admin.css";

const SIDE_KEY = "myblog.desk.sideCollapsed";

type DeskNavItem = {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
  match?: (pathname: string) => boolean;
};

const iconProps = {
  theme: "outline" as const,
  size: 18,
  strokeWidth: 3,
};

const navItems: DeskNavItem[] = [
  {
    to: "/admin",
    label: "文章",
    icon: <Notebook {...iconProps} />,
    end: true,
    match: (pathname) => pathname === "/admin" || pathname.startsWith("/admin/write"),
  },
  {
    to: "/admin/photos",
    label: "照片",
    icon: <Picture {...iconProps} />,
  },
  {
    to: "/admin/about",
    label: "关于",
    icon: <Info {...iconProps} />,
  },
];

export function AdminLayout() {
  const { dark, setDark } = useTheme();
  const { username, loading, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const leave = async () => {
    await logout();
    navigate("/login");
  };

  if (loading) {
    return null;
  }
  if (!username) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div
      className={cn(
        "desk flex min-h-dvh min-w-[1080px] bg-background text-foreground",
        collapsed && "desk--side-collapsed",
        dark && "desk--dark",
      )}
    >
      <Seo title="后台" description={SITE_DESCRIPTION} path={pathname} noindex />

      <aside
        className={cn(
          "sticky top-0 z-20 flex h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,padding] duration-200 ease-out",
          collapsed ? "w-[72px] px-2.5 py-3.5" : "w-64 px-4 py-5",
        )}
        aria-label="后台侧栏"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-6">
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
              {collapsed ? <MenuUnfold {...iconProps} size={18} /> : <MenuFold {...iconProps} size={18} />}
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

          <nav className="flex flex-col gap-1" aria-label="后台栏目">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                title={item.label}
                className={({ isActive }) => {
                  const active = item.match ? item.match(pathname) : isActive;
                  return cn(
                    "flex items-center rounded-lg text-sm font-medium transition-colors",
                    collapsed ? "justify-center px-0 py-3" : "gap-3 px-3 py-2.5",
                    active
                      ? "bg-sidebar-accent text-sidebar-primary"
                      : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                  );
                }}
              >
                <span className="inline-grid size-5 shrink-0 place-items-center" aria-hidden>
                  {item.icon}
                </span>
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-1 flex-col bg-background">
        <header className="sticky top-0 z-[15] flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border/80 bg-background/90 px-10 backdrop-blur-md">
          <div className="flex items-center gap-3">
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
                <Home {...iconProps} size={16} />
                前台
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void leave()} title="退出">
              <Logout {...iconProps} size={15} />
              退出
            </Button>
          </div>
        </header>

        <main className="flex flex-1 flex-col px-10 py-7 pb-16">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
