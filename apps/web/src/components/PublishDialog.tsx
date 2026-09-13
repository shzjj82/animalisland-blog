import {
  SITE_SKILL_COLORS,
  normalizeTags,
  type Category,
  type SiteSkillColor,
} from "@myblog/shared";
import { Close, Plus } from "@icon-park/react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 当前文章已选分类 slug */
  initialTags: string[];
  mode: "publish" | "edit";
  busy?: boolean;
  /** 回传分类 slug 列表 */
  onConfirm: (categorySlugs: string[]) => void | Promise<void>;
};

function pickColor(index: number): SiteSkillColor {
  return SITE_SKILL_COLORS[index % SITE_SKILL_COLORS.length] ?? "app-yellow";
}

export function PublishDialog({
  open,
  onOpenChange,
  initialTags,
  mode,
  busy,
  onConfirm,
}: Props) {
  const { reload: reloadGlobalCategories } = useCategories();
  const [categories, setCategories] = useState<Category[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    const data = await api.listCategories();
    setCategories(
      data.categories
        .filter((item) => item.kind === "article")
        .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-CN")),
    );
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelected(normalizeTags(initialTags));
    setDraft("");
    setError("");
    setLoading(true);
    void reload()
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [open, initialTags]);

  const bySlug = useMemo(() => {
    const map = new Map<string, Category>();
    for (const item of categories) {
      map.set(item.slug, item);
    }
    return map;
  }, [categories]);

  const options = categories;

  const toggle = (slug: string) => {
    setSelected((prev) => {
      const exists = prev.includes(slug);
      if (exists) {
        return prev.filter((item) => item !== slug);
      }
      return normalizeTags([...prev, slug]);
    });
  };

  const addDraft = async () => {
    const name = draft.trim();
    if (!name) {
      return;
    }
    const existing = categories.find(
      (item) => item.name === name || item.slug === name.toLocaleLowerCase(),
    );
    if (existing) {
      setSelected((prev) => normalizeTags([...prev, existing.slug]));
      setDraft("");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const { category } = await api.createCategory({
        name,
        hint: "",
        color: pickColor(categories.length),
        kind: "article",
        nav: true,
      });
      await reload();
      await reloadGlobalCategories().catch(() => undefined);
      setSelected((prev) => normalizeTags([...prev, category.slug]));
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建标签失败");
    } finally {
      setCreating(false);
    }
  };

  const labelOf = (slug: string) => bySlug.get(slug)?.name ?? slug;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>{mode === "publish" ? "发布文章" : "编辑标签"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            选择标签（可多选）。输入新名字后回车或点添加，会创建标签并出现在导航。
          </p>

          {selected.length ? (
            <div className="flex flex-wrap gap-1.5">
              {selected.map((slug) => (
                <button
                  key={slug}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-foreground/15 bg-foreground px-2.5 py-1 text-xs text-background"
                  onClick={() => toggle(slug)}
                >
                  {labelOf(slug)}
                  <Close {...iconParkOutline} size={12} aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">还没选标签，也可以直接发布。</p>
          )}

          <div className="flex gap-2">
            <Input
              value={draft}
              placeholder="新建标签…"
              className="h-9"
              disabled={creating}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addDraft();
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={creating || !draft.trim()}
              onClick={() => void addDraft()}
            >
              <Plus {...iconParkOutline} size={14} className="mr-1" />
              {creating ? "创建中…" : "添加"}
            </Button>
          </div>

          <div className="max-h-48 space-y-1 overflow-auto rounded-lg border border-border/70 p-2">
            {loading ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">加载标签…</p>
            ) : options.length === 0 ? (
              <p className="px-1 py-2 text-xs text-muted-foreground">暂无标签，先在上面创建一个。</p>
            ) : (
              options.map((item) => {
                const active = selected.includes(item.slug);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "text-foreground hover:bg-muted",
                    )}
                    onClick={() => toggle(item.slug)}
                  >
                    <span>{item.name}</span>
                    <span className="text-[11px] opacity-70">{active ? "已选" : "选择"}</span>
                  </button>
                );
              })
            )}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy || creating} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={busy || creating}
            onClick={() => {
              void (async () => {
                try {
                  setError("");
                  await onConfirm(selected);
                  onOpenChange(false);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "操作失败");
                }
              })();
            }}
          >
            {busy ? "处理中…" : mode === "publish" ? "确认发布" : "保存标签"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
