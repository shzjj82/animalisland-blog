"use client";

import type { Category } from "@myblog/shared";
import { ArrowRight, Moon, Sun } from "@icon-park/react";
import { Card, Drawer } from "animal-island-ui";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useCategories } from "@/lib/categories";
import { useAuth } from "@/lib/auth";
import { iconParkOutline } from "@/lib/iconPark";
import { useTheme } from "@/lib/theme";

type NavItem = {
  to: string;
  label: string;
  hint: string;
  color: Category["color"];
};

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  const Icon = dark ? Moon : Sun;
  return (
    <button
      type="button"
      className="blog-theme-btn"
      aria-label={dark ? "切换到日间" : "切换到夜间"}
      title={dark ? "夜间" : "日间"}
      onClick={onToggle}
    >
      <Icon {...iconParkOutline} size={18} />
    </button>
  );
}

export function BlogHeader() {
  const { dark, setDark } = useTheme();
  const { username } = useAuth();
  const { navCategories } = useCategories();
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = useMemo<NavItem[]>(() => {
    const categoryItems: NavItem[] = navCategories.map((item) => ({
      to: `/${item.slug}`,
      label: item.name,
      hint: item.hint?.trim() || "标签笔记",
      color: item.color,
    }));
    return [
      { to: "/notes", label: "笔记", hint: "全部笔记", color: "app-blue" as const },
      ...categoryItems,
    ];
  }, [navCategories]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 769px)");
    const closeOnDesktop = () => {
      if (mq.matches) {
        setMenuOpen(false);
      }
    };
    mq.addEventListener("change", closeOnDesktop);
    return () => mq.removeEventListener("change", closeOnDesktop);
  }, []);

  const goHome = () => {
    setMenuOpen(false);
    if (pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    router.push("/");
  };

  const goNav = (item: NavItem) => {
    setMenuOpen(false);
    router.push(item.to);
  };

  const isActive = (item: NavItem) => {
    if (item.to === "/notes") {
      return pathname === "/notes";
    }
    return pathname === item.to || pathname.startsWith(`${item.to}/`);
  };

  return (
    <header className="blog-header">
      <div className="blog-header-inner">
        <a
          href="/"
          className="blog-header-brand"
          onClick={(event) => {
            event.preventDefault();
            goHome();
          }}
        >
          <span className="blog-logo-text">
            <span className="blog-logo-title">小岛日记</span>
            <span className="blog-logo-sub">慢慢写，一起建</span>
          </span>
        </a>
        <nav className="blog-nav" aria-label="页面导航">
          {nav.map((item) => (
            <a
              key={item.to}
              href={item.to}
              className={isActive(item) ? "is-active" : undefined}
              onClick={(e) => {
                e.preventDefault();
                goNav(item);
              }}
            >
              <span className="blog-nav-label">{item.label}</span>
              <span className="blog-nav-hint">{item.hint}</span>
            </a>
          ))}
        </nav>
        <div className="blog-header-right">
          <div className="blog-header-tools">
            {username ? (
              <a
                href="/admin"
                className="blog-header-user"
                title="进入写作台"
                onClick={(event) => {
                  event.preventDefault();
                  router.push("/admin");
                }}
              >
                <span className="blog-header-user-avatar" aria-hidden>
                  {username.slice(0, 1).toUpperCase()}
                </span>
                <span className="blog-header-user-meta">
                  <span className="blog-header-user-name">{username}</span>
                  <span className="blog-header-user-hint">写作台</span>
                </span>
              </a>
            ) : null}
            <ThemeToggle dark={dark} onToggle={() => setDark(!dark)} />
          </div>
          <button
            type="button"
            className={`blog-menu-btn${menuOpen ? " is-open" : ""}`}
            aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
      {/* 关闭时不挂载：库在 open=false 时会传 inert=""，React 会警告并当成 false */}
      {menuOpen ? (
        <Drawer
          className="blog-drawer"
          open
          placement="left"
          width={300}
          onClose={() => setMenuOpen(false)}
          title={
            <div className="blog-drawer-brand">
              <span className="blog-drawer-brand-text">
                <strong>小岛日记</strong>
                <em>慢慢写，一起建</em>
              </span>
            </div>
          }
          footer={
            <div className="blog-drawer-tools">
              {username ? (
                <a
                  href="/admin"
                  className="blog-drawer-user"
                  onClick={(event) => {
                    event.preventDefault();
                    setMenuOpen(false);
                    router.push("/admin");
                  }}
                >
                  <span className="blog-header-user-avatar" aria-hidden>
                    {username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="blog-drawer-user-meta">
                    <strong>{username}</strong>
                    <em>写作台</em>
                  </span>
                </a>
              ) : (
                <span />
              )}
              <ThemeToggle dark={dark} onToggle={() => setDark(!dark)} />
            </div>
          }
        >
          <nav className="blog-drawer-nav" aria-label="侧边导航">
            {nav.map((item) => (
              <a
                key={item.to}
                href={item.to}
                className="blog-drawer-link"
                onClick={(event) => {
                  event.preventDefault();
                  goNav(item);
                }}
              >
                <Card
                  color={item.color}
                  hoverable
                  className={`blog-drawer-card${isActive(item) ? " is-active" : ""}`}
                >
                  <span className="blog-drawer-item-text">
                    <strong>{item.label}</strong>
                    <span>{item.hint}</span>
                  </span>
                  <span className="blog-drawer-item-go blog-inline-icon" aria-hidden>
                    <ArrowRight {...iconParkOutline} size={16} />
                  </span>
                </Card>
              </a>
            ))}
          </nav>
        </Drawer>
      ) : null}
    </header>
  );
}
