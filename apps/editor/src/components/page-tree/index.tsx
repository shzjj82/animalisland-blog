import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Delete, Down, More, Notes, Plus, Right, ToTop } from "@icon-park/react";
import { FileTypeIcon } from "@/components/file-type-icon";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverSeparator, PopoverTrigger } from "@/components/ui/popover";
import { pageTitle } from "@/i18n";
import type { ExportFormat } from "@/lib/document/export";
import { useTranslation } from "react-i18next";
import type { PageNode } from "@/store/localStore";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const DRAG_MIME = "application/x-editor-page-id";

type TreeNode = PageNode & { children: TreeNode[] };

type Props = {
  nodes: PageNode[];
  query?: string;
  selectedId?: string;
  onOpen: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onDelete: (id: string) => void;
  onReparent: (id: string, parentId: string | null) => void;
  onExport: (id: string, format: ExportFormat) => void;
};

function buildTree(nodes: PageNode[]): TreeNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const byParent = new Map<string | null, PageNode[]>();
  for (const node of nodes) {
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(node);
    byParent.set(key, list);
  }
  const walk = (parentId: string | null): TreeNode[] =>
    (byParent.get(parentId) ?? []).map((node) => ({ ...node, children: walk(node.id) }));
  return walk(null);
}

function blockedIds(nodes: PageNode[], rootId: string): Set<string> {
  const drop = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && drop.has(node.parentId) && !drop.has(node.id)) {
        drop.add(node.id);
        grew = true;
      }
    }
  }
  return drop;
}

function filterTree(items: TreeNode[], query: string): TreeNode[] {
  const keyword = query.trim().toLocaleLowerCase();
  if (!keyword) {
    return items;
  }
  const walk = (list: TreeNode[]): TreeNode[] => {
    const out: TreeNode[] = [];
    for (const node of list) {
      const children = walk(node.children);
      const self = pageTitle(node.title).toLocaleLowerCase().includes(keyword);
      if (self || children.length > 0) {
        out.push({ ...node, children: self ? node.children : children });
      }
    }
    return out;
  };
  return walk(items);
}

export function PageTree({ nodes, query = "", selectedId, onOpen, onCreateChild, onDelete, onReparent, onExport }: Props) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null | "root">(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const draggingRef = useRef<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const tree = useMemo(() => filterTree(buildTree(nodes), query), [nodes, query]);
  const searching = query.trim().length > 0;

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    const byId = new Map(nodesRef.current.map((node) => [node.id, node]));
    setCollapsed((prev) => {
      const next = { ...prev };
      let current = byId.get(selectedId);
      let changed = false;
      const seen = new Set<string>();
      while (current?.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        if (next[current.parentId]) {
          next[current.parentId] = false;
          changed = true;
        }
        current = byId.get(current.parentId);
      }
      return changed ? next : prev;
    });
  }, [selectedId]);

  function toggle(id: string) {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function clearDrag() {
    draggingRef.current = null;
    setDraggingId(null);
    setDropId(null);
  }

  function canDrop(targetId: string, sourceId: string) {
    if (sourceId === targetId) {
      return false;
    }
    const source = nodes.find((node) => node.id === sourceId);
    if (!source || source.parentId === targetId) {
      return false;
    }
    return !blockedIds(nodes, sourceId).has(targetId);
  }

  function beginDrag(event: DragEvent, id: string) {
    event.dataTransfer.setData(DRAG_MIME, id);
    event.dataTransfer.setData("text/plain", id);
    event.dataTransfer.effectAllowed = "move";
    draggingRef.current = id;
    window.requestAnimationFrame(() => {
      if (draggingRef.current === id) {
        setDraggingId(id);
      }
    });
  }

  function readDragId(event: DragEvent) {
    return event.dataTransfer.getData(DRAG_MIME) || event.dataTransfer.getData("text/plain") || draggingRef.current;
  }

  function acceptDrop(event: DragEvent, parentId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    const id = readDragId(event);
    clearDrag();
    if (!id) {
      return;
    }
    if (parentId && !canDrop(parentId, id)) {
      return;
    }
    const source = nodes.find((node) => node.id === id);
    if (!source || source.parentId === parentId) {
      return;
    }
    if (parentId) {
      setCollapsed((prev) => ({ ...prev, [parentId]: false }));
    }
    onReparent(id, parentId);
  }

  const dragging = draggingId ? nodes.find((node) => node.id === draggingId) : undefined;

  function renderNodes(items: TreeNode[], depth: number) {
    return items.map((node) => {
      const open = searching || !collapsed[node.id];
      const isDrop = dropId === node.id;
      return (
        <li key={node.id}>
          <div
            className={
              draggingId === node.id
                ? "flex items-center gap-0.5 rounded-md opacity-40"
                : isDrop
                  ? "flex items-center gap-0.5 rounded-md bg-sidebar-accent"
                  : "flex items-center gap-0.5"
            }
            style={{ paddingLeft: depth * 14 }}
            onDragOver={(event) => {
              const sourceId = draggingRef.current;
              if (!sourceId || !canDrop(node.id, sourceId)) {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              event.dataTransfer.dropEffect = "move";
              setDropId(node.id);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropId((prev) => (prev === node.id ? null : prev));
              }
            }}
            onDrop={(event) => acceptDrop(event, node.id)}
          >
            {node.children.length > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={open ? t("pageTree.collapse") : t("pageTree.expand")}
                onClick={() => toggle(node.id)}
              >
                {open ? <Down {...iconProps} size={14} /> : <Right {...iconProps} size={14} />}
              </Button>
            ) : (
              <span className="size-6 shrink-0" aria-hidden />
            )}
            <Button
              type="button"
              variant="ghost"
              draggable
              title={t("pageTree.dragToMove")}
              className={
                selectedId === node.id
                  ? "h-8 min-w-0 flex-1 cursor-grab justify-start bg-sidebar-accent px-2 font-medium active:cursor-grabbing"
                  : "h-8 min-w-0 flex-1 cursor-grab justify-start px-2 font-medium active:cursor-grabbing"
              }
              onClick={() => onOpen(node.id)}
              onDragStart={(event) => beginDrag(event, node.id)}
              onDragEnd={clearDrag}
            >
              <Notes {...iconProps} />
              <span className="truncate">{pageTitle(node.title)}</span>
            </Button>
            {selectedId === node.id ? (
              <Popover open={menuId === node.id} onOpenChange={(open) => setMenuId(open ? node.id : null)}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="relative z-20"
                    aria-label={t("pageTree.more")}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <More {...iconProps} size={14} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent>
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
                    onClick={() => {
                      setMenuId(null);
                      setCollapsed((prev) => ({ ...prev, [node.id]: false }));
                      onCreateChild(node.id);
                    }}
                  >
                    <Plus {...iconProps} size={14} />
                    {t("pageTree.addSubpage")}
                  </button>
                  <PopoverSeparator />
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
                    onClick={() => {
                      setMenuId(null);
                      onExport(node.id, "pdf");
                    }}
                  >
                    <FileTypeIcon type="pdf" />
                    {t("common.exportPdf")}
                  </button>
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
                    onClick={() => {
                      setMenuId(null);
                      onExport(node.id, "word");
                    }}
                  >
                    <FileTypeIcon type="word" />
                    {t("common.exportWord")}
                  </button>
                  <PopoverSeparator />
                  <button
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-destructive hover:bg-muted"
                    onClick={() => {
                      setMenuId(null);
                      onDelete(node.id);
                    }}
                  >
                    <Delete {...iconProps} size={14} />
                    {t("common.delete")}
                  </button>
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
          {node.children.length > 0 && open ? <ul className="flex flex-col gap-0.5">{renderNodes(node.children, depth + 1)}</ul> : null}
          {draggingId === node.id ? <span className="sr-only">{t("pageTree.dragging")}</span> : null}
        </li>
      );
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      {dragging?.parentId ? (
        <div
          className={
            dropId === "root"
              ? "mx-1 flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-2 text-xs"
              : "mx-1 flex items-center gap-2 rounded-md px-2 py-2 text-xs text-muted-foreground"
          }
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropId("root");
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropId((prev) => (prev === "root" ? null : prev));
            }
          }}
          onDrop={(event) => acceptDrop(event, null)}
        >
          <ToTop {...iconProps} size={14} />
          {t("pageTree.moveToTopLevel")}
        </div>
      ) : null}
      {searching && tree.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">{t("pageTree.noMatchingPages")}</p>
      ) : (
        <ul className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-y-contain">
          {renderNodes(tree, 0)}
        </ul>
      )}
    </div>
  );
}
