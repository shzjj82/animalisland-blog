import { useLocation, useNavigate } from "react-router-dom";
import { Card, Drawer, Switch } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useTheme } from "@/lib/theme";
import type { BlogColor } from "@/pages/Home/posts";

const nav: {
  to: string;
  icon: string;
  label: string;
  hint: string;
  color: BlogColor;
  hash?: string;
}[] = [
  { to: "/life", icon: "🌿", label: "生活", hint: "日常里留下的事", color: "app-blue" },
  { to: "/coding", icon: "⌨️", label: "编程", hint: "代码里踩过的坑", color: "app-green" },
  { to: "/chat", icon: "💬", label: "闲聊", hint: "想到就记一笔", color: "purple" },
  { to: "/photos", icon: "📷", label: "照片", hint: "路上拍下的画面", color: "warm-peach-pink" },
  { to: "/", icon: "🌱", label: "关于", hint: "这座岛从哪来", color: "app-yellow", hash: "about" },
];

export function BlogHeader() {
  const { dark, setDark } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

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

  const goNav = (item: (typeof nav)[number]) => {
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

  const isActive = (item: (typeof nav)[number]) => {
    if (item.hash) {
      return location.pathname === "/" && location.hash === `#${item.hash}`;
    }
    return location.pathname === item.to;
  };

  return (
    <header className="blog-header">
      <button type="button" className="blog-header-brand" onClick={goHome}>
        <span className="blog-logo-mark">🌿</span>
        <span className="blog-logo-text">
          <span className="blog-logo-title">小岛日记</span>
          <span className="blog-logo-sub">生活 / 编程 / 闲聊 / 照片</span>
        </span>
      </button>
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
            <span className="blog-nav-icon" aria-hidden>
              {item.icon}
            </span>
            <span className="blog-nav-label">{item.label}</span>
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
      <Drawer
        className="blog-drawer"
        open={menuOpen}
        placement="left"
        width={300}
        onClose={() => setMenuOpen(false)}
        title={
          <div className="blog-drawer-brand">
            <span className="blog-logo-mark">🌿</span>
            <span className="blog-drawer-brand-text">
              <strong>小岛日记</strong>
              <em>慢慢写，不赶路</em>
            </span>
          </div>
        }
        footer={<p className="blog-drawer-foot">生活 · 编程 · 闲聊 · 照片</p>}
      >
        <nav className="blog-drawer-nav" aria-label="侧边导航">
          {nav.map((item) => (
            <Card
              key={item.label}
              color={item.color}
              hoverable
              className={`blog-drawer-card${isActive(item) ? " is-active" : ""}`}
              onClick={() => goNav(item)}
            >
              <span className="blog-drawer-item-text">
                <strong>{item.label}</strong>
                <span>{item.hint}</span>
              </span>
              <span className="blog-drawer-item-go" aria-hidden>
                →
              </span>
            </Card>
          ))}
        </nav>
      </Drawer>
    </header>
  );
}
