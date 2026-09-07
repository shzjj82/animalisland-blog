import { Footer } from "animal-island-ui";
import type { ReactNode } from "react";
import { BlogHeader } from "@/components/BlogHeader";
import { useTheme } from "@/lib/theme";
import "@/pages/Home/Home.less";

export function BlogShell({ children }: { children: ReactNode }) {
  const { dark } = useTheme();

  return (
    <div className={`blog ${dark ? "blog--dark" : ""}`}>
      <BlogHeader />
      <div className="blog-frame">{children}</div>
      <div className="blog-sea">
        <Footer type="sea" />
      </div>
    </div>
  );
}
