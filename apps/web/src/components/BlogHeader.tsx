import type { Category } from "@myblog/shared";
import { Card, Drawer, Switch } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useCategories } from "@/lib/categories";
import { useTheme } from "@/lib/theme";

type NavItem = {
  to: string;
  label: string;
  hint: string;
  color: Category["color"];
  hash?: string;
};

function toNavItems(categories: Category[]): NavItem[] {
  return [
    ...categories.map((item) => ({
      to: `/${item.slug}`,
      label: item.name,
      hint: item.hint,
      color: item.color,
    })),
    { to: "/", label: "关于", hint: "这座岛从哪来", color: "app-yellow", hash: "about" },
  ];
}

export function BlogHeader() {
  const { dark, setDark } = useTheme();
  const { navCategories } = useCategories();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = toNavItems(navCategories);

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
    if (location.pathname === "/") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    navigate("/");
  };

  const goNav = (item: NavItem) => {
    setMenuOpen(false);
    if (item.hash) {
      if (location.pathname === "/") {
        document.getElementById(item.hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      navigate(`/#${item.hash}`);
      return;
    }
    navigate(item.to);
  };

  const isActive = (item: NavItem) => {
    if (item.hash) {
      return location.pathname === "/" && location.hash === `#${item.hash}`;
    }
    return location.pathname === item.to;
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
            <span className="blog-logo-sub">慢慢写，不赶路</span>
          </span>
        </a>
        <nav className="blog-nav" aria-label="页面导航">
          {nav.map((item) => (
            <a
              key={item.label}
              href={item.hash ? `/#${item.hash}` : item.to}
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
          <Switch
            size="small"
            checked={dark}
            onChange={setDark}
            checkedChildren="夜"
            unCheckedChildren="日"
            aria-label="夜间模式"
          />
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
      <Drawer
        className="blog-drawer"
        open={menuOpen}
        placement="left"
        width={300}
        onClose={() => setMenuOpen(false)}
        title={
          <div className="blog-drawer-brand">
            <span className="blog-drawer-brand-text">
              <strong>小岛日记</strong>
              <em>慢慢写，不赶路</em>
            </span>
          </div>
        }
        footer={
          <p className="blog-drawer-foot">
            {navCategories.map((item) => item.name).join(" · ") || "小岛日记"}
          </p>
        }
      >
        <nav className="blog-drawer-nav" aria-label="侧边导航">
          {nav.map((item) => (
            <a
              key={item.label}
              href={item.hash ? `/#${item.hash}` : item.to}
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
                <span className="blog-drawer-item-go" aria-hidden>
                  →
                </span>
              </Card>
            </a>
          ))}
        </nav>
      </Drawer>
    </header>
  );
}
