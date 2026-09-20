import type { PageKind, PostListItem } from "@myblog/shared";
import { Delete, Down, Info, Notes, Plus, Right, ToTop } from "@icon-park/react";
import { useMemo, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { SoftScrollbar } from "@/components/SoftScrollbar";
import { Button } from "@/components/ui/button";
import { iconParkOutline } from "@/lib/iconPark";
import { pageTitle, selfAndDescendantIds } from "@/lib/pageTree";
import { cn } from "@/lib/utils";

type TreeNode = PostListItem & { children: TreeNode[] };

type DropTarget = { kind: "page"; id: string } | { kind: "root" } | null;

type Props = {
  pages: PostListItem[];
  selectedId?: string;
  collapsed?: boolean;
  onCreateArticle: (parentId?: string | null) => void;
  onDelete: (page: PostListItem) => void;
  /** 拖拽挂入：parentId=null 表示回到顶层（外部） */
  onReparent: (pageId: string, parentId: string | null) => void | Promise<void>;
  onCloseMobile?: () => void;
};

const DRAG_MIME = "application/x-myblog-page-id";

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

function readDragPageId(event: React.DragEvent): string | null {
  const raw = event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain");
  return raw.trim() || null;
}

export function PageTree({
  pages,
  selectedId,
  collapsed,
  onCreateArticle,
  onDelete,
  onReparent,
  onCloseMobile,
}: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const draggingIdRef = useRef<string | null>(null);

  const { about, articleForest, articles } = useMemo(() => {
    const about = pages.find((p) => p.pageKind === "about");
    const articles = pages.filter((p) => p.pageKind === "article");
    return {
      about,
      articles,
      articleForest: buildArticleForest(articles),
    };
  }, [pages]);

  const blockedIds = useMemo(
    () => (draggingId ? selfAndDescendantIds(draggingId, articles) : new Set<string>()),
    [draggingId, articles],
  );

  const draggingPage = draggingId ? articles.find((item) => item.id === draggingId) : undefined;
  const showRootDrop = Boolean(draggingId && draggingPage?.parentId);

  const isExpanded = (id: string) => expanded[id] !== false;

  const toggle = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] !== false) }));
  };

  const clearDrag = () => {
    draggingIdRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  };

  const canDropOnPage = (targetId: string, sourceId: string | null = draggingId) => {
    if (!sourceId) {
      return false;
    }
    const blocked = sourceId === draggingId ? blockedIds : selfAndDescendantIds(sourceId, articles);
    if (blocked.has(targetId)) {
      return false;
    }
    const current = articles.find((item) => item.id === sourceId);
    return (current?.parentId ?? null) !== targetId;
  };

  const acceptDrop = (event: React.DragEvent, target: DropTarget) => {
    event.preventDefault();
    event.stopPropagation();
    const pageId = readDragPageId(event) || draggingIdRef.current || draggingId;
    clearDrag();
    if (!pageId || !target) {
      return;
    }
    if (target.kind === "root") {
      void onReparent(pageId, null);
      return;
    }
    if (selfAndDescendantIds(pageId, articles).has(target.id)) {
      return;
    }
    void onReparent(pageId, target.id);
  };

  const beginDrag = (event: React.DragEvent, page: PostListItem) => {
    event.stopPropagation();
    event.dataTransfer.setData(DRAG_MIME, page.id);
    event.dataTransfer.setData("text/plain", page.id);
    event.dataTransfer.effectAllowed = "move";
    draggingIdRef.current = page.id;
    // 延后更新 UI，避免 React 重绘打断 HTML5 拖拽（子页尤其容易被取消）
    window.requestAnimationFrame(() => {
      if (draggingIdRef.current === page.id) {
        setDraggingId(page.id);
      }
    });
  };

  const renderRow = (
    page: PostListItem,
    opts: { depth: number; hasChildren?: boolean; draggable?: boolean },
  ) => {
    const Icon = kindIcon(page.pageKind);
    const canDelete = page.pageKind === "article";
    const canAddChild = page.pageKind === "article";
    const depthPad = collapsed ? 0 : Math.min(opts.depth, 6) * 12;
    const isDragging = draggingId === page.id;
    const isDropTarget =
      dropTarget?.kind === "page" && dropTarget.id === page.id && canDropOnPage(page.id);

    return (
      <div
        key={page.id}
        className={cn(
          "workspace-tree-row group relative flex items-center gap-0.5 rounded-lg transition-colors duration-150",
          isDragging && "workspace-tree-row--dragging",
          isDropTarget && "workspace-tree-row--drop-into",
        )}
        style={{ marginLeft: depthPad }}
        onDragOver={(event) => {
          const sourceId = draggingIdRef.current || draggingId;
          if (!opts.draggable || !sourceId || !canDropOnPage(page.id, sourceId)) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ kind: "page", id: page.id });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget((prev) => (prev?.kind === "page" && prev.id === page.id ? null : prev));
          }
        }}
        onDrop={(event) => {
          if (!opts.draggable) {
            return;
          }
          event.stopPropagation();
          acceptDrop(event, { kind: "page", id: page.id });
          setExpanded((prev) => ({ ...prev, [page.id]: true }));
        }}
      >
        {!collapsed && opts.hasChildren ? (
          <button
            type="button"
            className="relative z-[2] inline-grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
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
          title={opts.draggable ? `${pageTitle(page)}（拖拽可调整层级）` : pageTitle(page)}
          onClick={onCloseMobile}
          draggable={Boolean(opts.draggable)}
          onDragStart={(event) => {
            if (!opts.draggable) {
              event.preventDefault();
              return;
            }
            beginDrag(event, page);
          }}
          onDragEnd={clearDrag}
          className={({ isActive }) =>
            cn(
              "relative z-[2] flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
              opts.draggable && "cursor-grab active:cursor-grabbing",
              collapsed && "justify-center px-0",
              isActive || selectedId === page.id
                ? "bg-sidebar-accent/80 font-medium text-sidebar-primary"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )
          }
        >
          <Icon {...iconParkOutline} size={16} className="shrink-0 opacity-80" />
          {!collapsed ? (
            <span className="min-w-0 truncate">
              {pageTitle(page)}
              {!page.parentId && page.draft ? (
                <span className="ml-1 text-[10px] font-normal text-muted-foreground">草稿</span>
              ) : null}
            </span>
          ) : null}
        </NavLink>
        {!collapsed && canAddChild ? (
          <button
            type="button"
            className="relative z-[2] inline-grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-sidebar-accent hover:text-sidebar-foreground group-hover:opacity-100"
            title="新建子页面"
            aria-label={`在 ${pageTitle(page)} 下新建子页面`}
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
            className="relative z-[2] inline-grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="删除"
            aria-label={`删除 ${pageTitle(page)}`}
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
      {renderRow(node, { depth, hasChildren: node.children.length > 0, draggable: true })}
      {node.children.length > 0 && isExpanded(node.id) && !collapsed
        ? node.children.map((child) => renderArticleNode(child, depth + 1))
        : null}
    </div>
  );

  const rootDropActive = dropTarget?.kind === "root";

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

          <div className="space-y-1.5">
            {!collapsed ? (
              <p className="px-2.5 pb-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                页面
              </p>
            ) : null}

            {showRootDrop && !collapsed ? (
              <div
                className={cn(
                  "workspace-tree-root-drop mx-0.5 flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors duration-150",
                  rootDropActive
                    ? "workspace-tree-root-drop--active"
                    : "bg-sidebar-accent/35 text-muted-foreground",
                )}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget({ kind: "root" });
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropTarget((prev) => (prev?.kind === "root" ? null : prev));
                  }
                }}
                onDrop={(event) => {
                  event.stopPropagation();
                  acceptDrop(event, { kind: "root" });
                }}
              >
                <ToTop {...iconParkOutline} size={14} className="shrink-0 opacity-80" />
                <div className="min-w-0 leading-snug">
                  <p className="font-medium text-sidebar-foreground">移出到顶层</p>
                  <p className="text-[10px] text-muted-foreground">把子页面从当前父页下拖出来</p>
                </div>
              </div>
            ) : null}

            {articleForest.length === 0 && !collapsed ? (
              <p className="px-2.5 text-xs text-muted-foreground">还没有页面，点下方新建</p>
            ) : (
              <div className="space-y-0.5">
                {articleForest.map((node) => renderArticleNode(node, 0))}
              </div>
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
