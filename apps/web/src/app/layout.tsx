import type { Metadata, Viewport } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@myblog/shared";
import { Providers } from "@/components/Providers";
import "@fontsource/m-plus-rounded-1c/400.css";
import "@fontsource/m-plus-rounded-1c/700.css";
import "@fontsource/m-plus-rounded-1c/800.css";
import "@fontsource/m-plus-rounded-1c/900.css";
import "animal-island-ui/style";
import "../index.css";
// index.less 改由 client Providers 引入：App Router 服务端会对 .less 走 ignore-loader，否则暖色纸背景变量会丢失

export const metadata: Metadata = {
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  robots: { index: true, follow: true },
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48' fill='none'%3E%3Crect x='6' y='6' width='36' height='36' rx='3' stroke='%233b2f22' stroke-width='3' stroke-linejoin='round'/%3E%3Cpath d='M6 17H42' stroke='%233b2f22' stroke-width='3' stroke-linecap='round'/%3E%3Cpath d='M17 42V17' stroke='%233b2f22' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8e8" },
    { media: "(prefers-color-scheme: dark)", color: "#2a241a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        {/* 与旧 Vite index.html 对齐：大量 less/css 依赖 #root > .animal-cursor */}
        <div id="root">
          <Providers>{children}</Providers>
        </div>
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("blog-theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("blog-dark-root",d);document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}',
          }}
        />
      </body>
    </html>
  );
}
