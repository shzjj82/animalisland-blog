import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "@/i18n";
import { App } from "./App";
import { MarkdownImportPage } from "@/components/markdown-import";
import { isMarkdownRoute } from "@/lib/route";
import "./styles/index.css";

function Root() {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const sync = () => setPath(window.location.pathname);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  if (isMarkdownRoute(path)) {
    return <MarkdownImportPage />;
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
