import Link from "next/link";
import { SITE_DESCRIPTION, SITE_NAME } from "@myblog/shared";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "没有找到这个页面",
  description: SITE_DESCRIPTION,
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main
      style={{
        minHeight: "70dvh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily:
          '"M PLUS Rounded 1c", "Geist Variable", "PingFang SC", "Microsoft YaHei", sans-serif',
      }}
    >
      <div style={{ maxWidth: 420, textAlign: "center" }}>
        <p style={{ margin: 0, opacity: 0.7, fontSize: 14 }}>{SITE_NAME}</p>
        <h1 style={{ margin: "0.75rem 0", fontSize: "1.75rem" }}>没有找到这个页面</h1>
        <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, opacity: 0.8 }}>
          可能是链接写错了，或者这页已经搬走了。
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "0.65rem 1.1rem",
            borderRadius: 10,
            background: "#3b2f22",
            color: "#fff8e8",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          回小岛
        </Link>
      </div>
    </main>
  );
}
