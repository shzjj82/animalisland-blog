import { SITE_DESCRIPTION } from "@myblog/shared";
import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import "@/admin.css";

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
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <Seo title="登录" description={SITE_DESCRIPTION} path="/login" noindex />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--muted)_0%,_transparent_55%)]"
        aria-hidden
      />
      <main className="relative z-10 w-full max-w-md">
        <Card className="shadow-lg ring-1 ring-foreground/10">
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-2xl font-bold tracking-tight">登岛</CardTitle>
              <div className="flex items-center gap-2" title={dark ? "夜间" : "日间"}>
                <span className="text-xs font-medium text-muted-foreground">{dark ? "夜" : "日"}</span>
                <Switch checked={dark} onCheckedChange={setDark} aria-label="夜间模式" />
              </div>
            </div>
            <CardDescription className="text-sm leading-relaxed">
              写作台只给自己用。输入账号，把今天想留下的写下来。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
              <div className="space-y-2">
                <Label htmlFor="login-user">用户名</Label>
                <Input
                  id="login-user"
                  value={user}
                  autoComplete="username"
                  onChange={(e) => setUser(e.currentTarget.value)}
                  placeholder="你的名字"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-pass">密码</Label>
                <Input
                  id="login-pass"
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  aria-invalid={Boolean(error)}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  placeholder="岛上的口令"
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? "进入中…" : "进入写作台"}
              </Button>
            </form>
            <a
              href="/"
              className="mt-4 block text-center text-sm font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
            >
              ← 回到小岛日记
            </a>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
