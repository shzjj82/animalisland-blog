import { useEffect, useState } from "react";
import { codeLanguageLabel } from "@/lib/codeLanguages";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 代码块：按需加载 highlight.js，避免进首页主包 */
export function LazyCodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState(() => escapeHtml(code));

  useEffect(() => {
    let alive = true;
    void import("@/lib/highlight")
      .then((mod) => {
        if (alive) {
          setHtml(mod.highlightCode(code, language));
        }
      })
      .catch(() => {
        if (alive) {
          setHtml(escapeHtml(code));
        }
      });
    return () => {
      alive = false;
    };
  }, [code, language]);

  return (
    <div className="block-code">
      <span className="block-code-lang">{codeLanguageLabel(language)}</span>
      <pre className="block-code-pre">
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
