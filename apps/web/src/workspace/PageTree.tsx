import type { PageKind, PostListItem } from "@myblog/shared";
import { Delete, Down, Info, Notes, Plus, Right } from "@icon-park/react";
import { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { SoftScrollbar } from "@/components/SoftScrollbar";
import { Button } from "@/components/ui/button";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

type TreeNode = PostListItem & { children: TreeNode[] };

type Props = {
  pages: PostListItem[];
  selectedId?: string;
  collapsed?: boolean;
  onCreateArticle: (parentId?: string | null) => void;
  onDelete: (page: PostListItem) => void;
  onCloseMobile?: () => void;
};

function kindIcon(kind: PageKind) {
  return kind === "about" ? Info : Notes;
}

function buildArticleForest(articles: PostListItem[]): TreeNode[] {
  const ids = new Set(articles.map((item) => item.id));
  const byParent = new Map<string | null, PostListItem[]>();
  for (const item of articles) {
    const key = item.parentId && ids.has(item.parentId) ? item.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(item);
    byParent.set(key, list);
  }
  const sortSiblings = (list: PostListItem[]) =>
    [...list].sort((a, b) => a.treeSort - b.treeSort || a.createdAt.localeCompare(b.createdAt));

  const walk = (parentId: string | null): TreeNode[] =>
    sortSiblings(byParent.get(parentId) ?? []).map((item) => ({
      ...item,
      children: walk(item.id),
    }));

  return walk(null);
}

function pageLabel(page: PostListItem) {
  if (page.pageKind === "about") {
    return "关于";
  }
  if (page.title && page.title !== "无标题" && page.title !== "未命名") {
    return page.title;
  }
  return "无标题";
}

export function PageTree({
  pages,
  selectedId,
  collapsed,
  onCreateArticle,
  onDelete,
  onCloseMobile,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { about, articleForest } = useMemo(() => {
    const about = pages.find((p) => p.pageKind === "about");
    const articles = pages.filter((p) => p.pageKind === "article");
    return {
      about,
      articleForest: buildArticleForest(articles),
    };
  }, [pages]);

  const isExpanded = (id: string) => expanded[id] !== false;

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  };

  const renderRow = (page: PostListItem, opts: { depth: number; hasChildren?: boolean }) => {
    const Icon = kindIcon(page.pageKind);
    const canDelete = page.pageKind === "article";
    const canAddChild = page.pageKind === "article";
    const depthPad = collapsed ? 0 : Math.min(opts.depth, 6) * 12;

    return (
      <div
        key={page.id}
        className="group flex items-center gap-0.5 rounded-lg"
        style={{ marginLeft: depthPad }}
      >
        {!collapsed && opts.hasChildren ? (
          <button
            type="button"
            className="inline-grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label={isExpanded(page.id) ? "收起" : "展开"}
            onClick={() => toggle(page.id)}
          >
            {isExpanded(page.id) ? (
              <Down {...iconParkOutline} size={14} />
            ) : (
              <Right {...iconParkOutline} size={14} />
            )}
          </button>
        ) : (
          <span className={cn("inline-block size-6 shrink-0", collapsed && "hidden")} aria-hidden />
        )}
        <NavLink
          to={`/admin/p/${page.id}`}
          title={page.pageKind === "about" ? page.title || "关于" : pageLabel(page)}
          onClick={onCloseMobile}
          className={({ isActive }) =>
            cn(
              "flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              collapsed && "justify-center px-0",
              isActive || selectedId === page.id
                ? "bg-sidebar-accent font-medium text-sidebar-primary"
                : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
            )
          }
        >
          <Icon {...iconParkOutline} size={16} className="shrink-0 opacity-80" />
          {!collapsed ? (
            <span className="min-w-0 truncate">
              {pageLabel(page)}
              {!page.parentId && page.draft ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">草稿</span>
              ) : null}
            </span>
          ) : null}
        </NavLink>
        {!collapsed && canAddChild ? (
          <button
            type="button"
            className="inline-grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100"
            title="新建子页面"
            aria-label={`在 ${pageLabel(page)} 下新建子页面`}
            onClick={() => {
              setExpanded((prev) => ({ ...prev, [page.id]: true }));
              onCreateArticle(page.id);
            }}
          >
            <Plus {...iconParkOutline} size={14} />
          </button>
        ) : null}
        {!collapsed && canDelete ? (
          <button
            type="button"
            className="inline-grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="删除"
            aria-label={`删除 ${pageLabel(page)}`}
            onClick={() => onDelete(page)}
          >
            <Delete {...iconParkOutline} size={14} />
          </button>
        ) : null}
      </div>
    );
  };

  const renderArticleNode = (node: TreeNode, depth: number) => (
    <div key={node.id} className="space-y-0.5">
      {renderRow(node, { depth, hasChildren: node.children.length > 0 })}
      {node.children.length > 0 && isExpanded(node.id) && !collapsed
        ? node.children.map((child) => renderArticleNode(child, depth + 1))
        : null}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <SoftScrollbar className="min-h-0 flex-1" contentClassName="space-y-4 pb-4">
        <nav className="space-y-4" aria-label="页面树">
          <div className="space-y-0.5">
            {!collapsed ? (
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                站点
              </p>
            ) : null}
            {about ? renderRow(about, { depth: 0 }) : null}
          </div>

          <div className="space-y-0.5">
            {!collapsed ? (
              <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                页面
              </p>
            ) : null}
            {articleForest.length === 0 && !collapsed ? (
              <p className="px-2.5 text-xs text-muted-foreground">还没有页面，点下方新建</p>
            ) : (
              articleForest.map((node) => renderArticleNode(node, 0))
            )}
          </div>
        </nav>
      </SoftScrollbar>

      {!collapsed ? (
        <div className="mt-auto shrink-0 border-t border-sidebar-border pt-3">
          <Button type="button" size="sm" className="h-8 w-full" onClick={() => onCreateArticle(null)}>
            <Plus {...iconParkOutline} size={14} className="mr-1" />
            页面
          </Button>
        </div>
      ) : (
        <div className="mt-auto flex shrink-0 flex-col items-center border-t border-sidebar-border pt-3">
          <Button
            type="button"
            size="icon"
            className="size-9"
            title="新页面"
            onClick={() => onCreateArticle(null)}
          >
            <Plus {...iconParkOutline} size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
