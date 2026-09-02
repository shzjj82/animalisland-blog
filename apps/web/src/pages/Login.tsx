import { Button, Card, Input, Switch } from "animal-island-ui";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

export function LoginPage() {
  const { login, username } = useAuth();
  const { dark, setDark } = useTheme();
  const navigate = useNavigate();
  const [user, setUser] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (username) {
      navigate("/admin", { replace: true });
    }
  }, [username, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await login(user, password);
      navigate("/admin");
    } catch {
      setError("账号或密码不对。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`login-page ${dark ? "login-page--dark" : ""}`}>
      <div className="login-glow" aria-hidden />
      <main className="login-main">
        <Card className="login-card">
          <div className="login-card-top">
            <h1 className="login-title">登岛</h1>
            <Switch
              size="small"
              checked={dark}
              onChange={setDark}
              checkedChildren="夜"
              unCheckedChildren="日"
              aria-label="夜间模式"
            />
          </div>
          <p className="login-lead">写作台只给自己用。输入账号，把今天想留下的写下来。</p>
          <form className="login-form" onSubmit={(e) => void onSubmit(e)}>
            <label className="login-field">
              <span>用户名</span>
              <Input
                size="large"
                value={user}
                autoComplete="username"
                onChange={(e) => setUser(e.currentTarget.value)}
                placeholder="你的名字"
              />
            </label>
            <label className="login-field">
              <span>密码</span>
              <Input
                size="large"
                type="password"
                value={password}
                autoComplete="current-password"
                status={error ? "error" : undefined}
                onChange={(e) => setPassword(e.currentTarget.value)}
                placeholder="岛上的口令"
              />
            </label>
            {error ? <p className="error">{error}</p> : null}
            <Button type="primary" htmlType="submit" size="large" block loading={busy}>
              进入写作台
            </Button>
          </form>
          <button type="button" className="login-home" onClick={() => navigate("/")}>
            ← 回到小岛日记
          </button>
        </Card>
      </main>
    </div>
  );
}
