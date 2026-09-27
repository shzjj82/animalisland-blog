"use client";

import { SITE_DESCRIPTION } from "@myblog/shared";
import { ArrowLeft } from "@icon-park/react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Seo } from "@/components/Seo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { iconParkOutline } from "@/lib/iconPark";
import { useTheme } from "@/lib/theme";
import "@/admin.css";

export function LoginPage() {
  const { login, register, username } = useAuth();
  const { dark, setDark } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (searchParams.get("join") === "1") {
      setMode("register");
    }
  }, [searchParams]);

  useEffect(() => {
    if (username) {
      router.replace("/admin");
    }
  }, [username, router]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (mode === "register") {
      if (user.trim().length < 2 || user.trim().length > 32) {
        setError("用户名长度需为 2-32。");
        return;
      }
      if (password.length < 6 || password.length > 64) {
        setError("密码长度需为 6-64。");
        return;
      }
      if (password !== confirm) {
        setError("两次输入的密码不一致。");
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === "register") {
        await register(user, password, nickname.trim() || undefined);
      } else {
        await login(user, password);
      }
      router.push("/admin");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (mode === "register") {
        if (message === "USERNAME_TAKEN" || /已存在|占用/.test(message)) {
          setError("这个名字已经有人用了。");
        } else if (message === "INVALID_INPUT" || /长度|不完整/.test(message)) {
          setError(message.includes("密码") ? "密码长度需为 6-64。" : "请检查用户名和密码。");
        } else {
          setError("注册暂时没成功，稍后再试。");
        }
      } else {
        setError("账号或密码不对。");
      }
    } finally {
      setBusy(false);
    }
  };

  const joining = mode === "register";

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-4 py-10">
      <Seo
        title={joining ? "注册" : "登录"}
        description={SITE_DESCRIPTION}
        path="/login"
        noindex
      />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--muted)_0%,_transparent_55%)]"
        aria-hidden
      />
      <main className="relative z-10 w-full max-w-md">
        <Card className="shadow-lg ring-1 ring-foreground/10">
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <CardTitle className="text-2xl font-bold tracking-tight">
                {joining ? "上岛" : "登岛"}
              </CardTitle>
              <div className="flex items-center gap-2" title={dark ? "夜间" : "日间"}>
                <span className="text-xs font-medium text-muted-foreground">{dark ? "夜" : "日"}</span>
                <Switch checked={dark} onCheckedChange={setDark} aria-label="夜间模式" />
              </div>
            </div>
            <CardDescription className="text-sm leading-relaxed">
              {joining
                ? "注册一个小岛日记账号，写你的生活与代码，一起参与建设。"
                : "登录后进入写作台，继续写下你的生活与想法。"}
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
                  placeholder="2-32 个字符"
                />
              </div>
              {joining ? (
                <div className="space-y-2">
                  <Label htmlFor="login-nick">昵称（可选）</Label>
                  <Input
                    id="login-nick"
                    value={nickname}
                    autoComplete="nickname"
                    onChange={(e) => setNickname(e.currentTarget.value)}
                    placeholder="不填则与用户名相同"
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="login-pass">密码</Label>
                <Input
                  id="login-pass"
                  type="password"
                  value={password}
                  autoComplete={joining ? "new-password" : "current-password"}
                  aria-invalid={Boolean(error)}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  placeholder={joining ? "至少 6 位" : "岛上的口令"}
                />
              </div>
              {joining ? (
                <div className="space-y-2">
                  <Label htmlFor="login-confirm">确认密码</Label>
                  <Input
                    id="login-confirm"
                    type="password"
                    value={confirm}
                    autoComplete="new-password"
                    onChange={(e) => setConfirm(e.currentTarget.value)}
                    placeholder="再输入一次"
                  />
                </div>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" size="lg" disabled={busy}>
                {busy ? (joining ? "注册中…" : "进入中…") : joining ? "注册并进入写作台" : "进入写作台"}
              </Button>
            </form>
            <button
              type="button"
              className="mt-3 w-full text-center text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => {
                setError("");
                setMode(joining ? "login" : "register");
              }}
            >
              {joining ? "已有账号？去登录" : "还没有账号？注册上岛"}
            </button>
            <a
              href="/"
              className="mt-4 flex items-center justify-center gap-1.5 text-center text-sm font-medium text-muted-foreground no-underline transition-colors hover:text-foreground"
            >
              <ArrowLeft {...iconParkOutline} size={14} aria-hidden />
              回到小岛日记
            </a>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
