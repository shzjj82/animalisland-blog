import { Button, Switch } from "animal-island-ui";
import { Link, NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const deskNav = [
  { to: "/admin", label: "文章", end: true },
  { to: "/admin/photos", label: "照片墙" },
  { to: "/admin/about", label: "关于" },
];

export function AdminLayout() {
  const { dark, setDark } = useTheme();
  const { username, loading, logout } = useAuth();
  const navigate = useNavigate();

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
    <div className={`desk ${dark ? "desk--dark" : ""}`}>
      <header className="desk-header">
        <Link to="/admin" className="desk-brand">
          <span className="desk-brand-mark" aria-hidden>
            🌿
          </span>
          <span className="desk-brand-text">
            <strong>写作台</strong>
            <em>小岛日记</em>
          </span>
        </Link>
        <nav className="desk-nav" aria-label="后台栏目">
          {deskNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? "is-active" : undefined)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="desk-header-right">
          <span className="desk-user">{username}</span>
          <Link to="/" className="desk-link">
            看小岛
          </Link>
          <Switch
            size="small"
            checked={dark}
            onChange={setDark}
            checkedChildren="夜"
            unCheckedChildren="日"
            aria-label="夜间模式"
          />
          <Button size="small" onClick={() => void leave()}>
            离开
          </Button>
        </div>
      </header>
      <main className="desk-main">
        <Outlet />
      </main>
    </div>
  );
}
