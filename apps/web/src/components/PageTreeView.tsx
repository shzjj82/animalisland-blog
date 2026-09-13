import type { PostListItem } from "@myblog/shared";
import { useState } from "react";
import { Link } from "react-router-dom";
import { buildPageForest, pageTitle, type PageTreeNode } from "@/lib/pageTree";
import { cn } from "@/lib/utils";

function prefetchPostPage() {
  void import("@/pages/Post/Post");
}

function TreeBranch({
  nodes,
  depth = 0,
}: {
  nodes: PageTreeNode[];
  depth?: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (nodes.length === 0) {
    return null;
  }

  return (
    <ul className={cn("page-tree-list", depth === 0 && "page-tree-list--root")}>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const expanded = open[node.id] !== false;
        return (
          <li key={node.id} className="page-tree-item">
            <div className="page-tree-row" style={{ paddingLeft: depth * 18 }}>
              {hasChildren ? (
                <button
                  type="button"
                  className="page-tree-toggle"
                  aria-label={expanded ? "收起" : "展开"}
                  onClick={() => setOpen((prev) => ({ ...prev, [node.id]: !expanded }))}
                >
                  {expanded ? "▾" : "▸"}
                </button>
              ) : (
                <span className="page-tree-toggle is-leaf" aria-hidden>
                  ·
                </span>
              )}
              <Link
                to={`/post/${node.slug}`}
                className="page-tree-link"
                onMouseEnter={prefetchPostPage}
                onFocus={prefetchPostPage}
              >
                <span className="page-tree-title">{pageTitle(node)}</span>
                <time dateTime={(node.publishedAt ?? node.updatedAt).slice(0, 10)}>
                  {(node.publishedAt ?? node.updatedAt).slice(0, 10)}
                </time>
              </Link>
            </div>
            {hasChildren && expanded ? <TreeBranch nodes={node.children} depth={depth + 1} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function PageTreeView({
  pages,
  empty = "还没有公开页面。",
}: {
  pages: PostListItem[];
  empty?: string;
}) {
  const forest = buildPageForest(pages.filter((item) => !item.draft && item.pageKind === "article"));
  if (forest.length === 0) {
    return <p className="blog-section-sub">{empty}</p>;
  }
  return (
    <nav className="page-tree" aria-label="页面层级">
      <TreeBranch nodes={forest} />
    </nav>
  );
}
