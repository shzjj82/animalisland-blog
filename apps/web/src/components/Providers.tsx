"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { IslandLoadingHost } from "@/components/IslandLoadingHost";
import { AuthProvider } from "@/lib/auth";
import { CategoriesProvider } from "@/lib/categories";
import { ThemeProvider } from "@/lib/theme";
import "@/index.less";

const Cursor = dynamic(
  () => import("animal-island-ui").then((mod) => ({ default: mod.Cursor })),
  { ssr: false, loading: () => null },
);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider>
        <CategoriesProvider>
          <Cursor forceAll={false}>
            <IslandLoadingHost />
            {children}
          </Cursor>
        </CategoriesProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
