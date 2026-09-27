"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { api } from "./api";

type AuthState = {
  username: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, nickname?: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function needsSession(pathname: string) {
  return pathname.startsWith("/admin") || pathname === "/login";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const sessionPage = needsSession(pathname);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const me = await api.me();
      setUsername(me.username);
    } catch {
      setUsername(null);
    } finally {
      setLoading(false);
    }
  };

  // 前台也探测一次，表头才能显示登录态；进 admin/login 再刷新
  useEffect(() => {
    void refresh();
  }, [sessionPage ? pathname : "public"]);

  const value = useMemo<AuthState>(
    () => ({
      username,
      loading,
      refresh,
      login: async (user, password) => {
        await api.login(user, password);
        await refresh();
      },
      register: async (user, password, nickname) => {
        await api.register(user, password, nickname);
        await refresh();
      },
      logout: async () => {
        await api.logout();
        setUsername(null);
      },
    }),
    [username, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth 必须在 AuthProvider 内使用");
  }
  return ctx;
}
