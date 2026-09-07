import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { api } from "./api";

type AuthState = {
  username: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function needsSession(pathname: string) {
  return pathname.startsWith("/admin") || pathname === "/login";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const sessionPage = needsSession(pathname);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(sessionPage);

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

  useEffect(() => {
    if (!sessionPage) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [sessionPage]);

  const value = useMemo<AuthState>(
    () => ({
      username,
      loading,
      refresh,
      login: async (user, password) => {
        await api.login(user, password);
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
