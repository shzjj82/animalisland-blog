import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type ThemeContextValue = {
  dark: boolean;
  setDark: (value: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialDark() {
  const saved = localStorage.getItem("blog-theme");
  if (saved === "dark") {
    return true;
  }
  if (saved === "light") {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(() => {
    const next = readInitialDark();
    document.documentElement.classList.toggle("blog-dark-root", next);
    document.documentElement.style.colorScheme = next ? "dark" : "light";
    return next;
  });

  useEffect(() => {
    localStorage.setItem("blog-theme", dark ? "dark" : "light");
    document.documentElement.classList.toggle("blog-dark-root", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);

  const value = useMemo(() => ({ dark, setDark }), [dark]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
