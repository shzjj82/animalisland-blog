import {
  SITE_SKILL_COLORS,
  type Category,
  type SiteSkillColor,
} from "@myblog/shared";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";
import { cn } from "@/lib/utils";

const COLOR_HEX: Record<SiteSkillColor, string> = {
  "app-pink": "#f8a6b2",
  purple: "#b77dee",
  "app-blue": "#889df0",
  "app-yellow": "#f7cd67",
  "app-orange": "#e59266",
  "app-teal": "#82d5bb",
  "app-green": "#8ac68a",
  "app-red": "#fc736d",
  "lime-green": "#d1da49",
  "yellow-green": "#ecdf52",
  brown: "#9a835a",
  "warm-peach-pink": "#e18c6f",
};

function emptyForm() {
  return {
    name: "",
    slug: "",
    hint: "",
    color: "app-blue" as SiteSkillColor,
    nav: true,
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** 文章分类管理（不含照片墙；照片墙固定由「照片」页使用） */
export function CategoryManagerDialog({ open, onOpenChange }: Props) {
  const { categories, reload } = useCategories();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ordered = useMemo(
    () =>
      [...categories]
        .filter((item) => item.kind === "article")
        .sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)),
    [categories],
  );

  const resetForm = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setFormOpen(false);
  };

  const closeAll = () => {
    resetForm();
    onOpenChange(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setFormOpen(true);
  };

  const startEdit = (category: Category) => {
    setEditing(category);
    setForm({
      name: category.name,
      slug: category.slug,
      hint: category.hint,
      color: category.color,
      nav: category.nav,
    });
    setError("");
    setFormOpen(true);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("先写分类名。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await api.updateCategory(editing.id, {
          ...form,
          kind: "article",
          sort: editing.sort,
        });
      } else {
        await api.createCategory({ ...form, kind: "article" });
      }
      await reload();
      resetForm();
    } catch {
      setError("没存上，再试一次。");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (category: Category) => {
    if (!confirm(`删掉分类「${category.name}」？里面还有文章的话删不掉。`)) {
      return;
    }
    try {
      await api.deleteCategory(category.id);
      await reload();
      if (editing?.id === category.id) {
        resetForm();
      }
      setError("");
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "CATEGORY_IN_USE") {
        setError("这个分类里还有文章，先挪走再删。");
      } else if (code === "LAST_ARTICLE_CATEGORY") {
        setError("至少留一个文章分类。");
      } else {
        setError("没删掉。");
      }
    }
  };

  const move = async (category: Category, dir: -1 | 1) => {
    const index = ordered.findIndex((item) => item.id === category.id);
    const swapIndex = index + dir;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) {
      return;
    }

    const next = [...ordered];
    const current = next[index];
    const swap = next[swapIndex];
    next[index] = swap;
    next[swapIndex] = current;

    try {
      for (let i = 0; i < next.length; i += 1) {
        const item = next[i];
        if (item.sort === i) {
          continue;
        }
        await api.updateCategory(item.id, {
          name: item.name,
          slug: item.slug,
          hint: item.hint,
          color: item.color,
          kind: "article",
          nav: item.nav,
          sort: i,
        });
      }
      await reload();
      setError("");
    } catch {
      setError("排序没改成功，再试一次。");
    }
  };

  return (
    <>
      <Dialog
        open={open && !formOpen}
        onOpenChange={(next) => {
          if (!next) closeAll();
        }}
      >
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>文章分类</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            用来给文章归类，也会出现在前台导航。照片墙不在这里，位置固定在「照片」页。
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <ul className="max-h-[min(52vh,420px)] space-y-2 overflow-y-auto pr-1">
            {ordered.map((category, index) => (
              <li
                key={category.id}
                className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: COLOR_HEX[category.color] }}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-semibold">{category.name}</span>
                    <Badge variant={category.nav ? "default" : "outline"} className="text-[10px]">
                      {category.nav ? "导航" : "隐藏"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    /{category.slug}
                    {category.hint ? ` · ${category.hint}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="上移"
                    disabled={index === 0}
                    onClick={() => void move(category, -1)}
                  >
                    <ArrowUpWideNarrow className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="下移"
                    disabled={index === ordered.length - 1}
                    onClick={() => void move(category, 1)}
                  >
                    <ArrowDownWideNarrow className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="编辑"
                    onClick={() => startEdit(category)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    title="删除"
                    onClick={() => void remove(category)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0">
            <Button type="button" variant="outline" onClick={closeAll}>
              完成
            </Button>
            <Button type="button" onClick={openCreate}>
              <Plus className="size-4" />
              新建分类
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={formOpen}
        onOpenChange={(next) => {
          if (!next) resetForm();
        }}
      >
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑分类" : "新建分类"}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-3.5" onSubmit={(event) => void onSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="cat-name">名称</Label>
              <Input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.currentTarget.value }))}
                placeholder="比如旅行"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-slug">链接别名</Label>
              <Input
                id="cat-slug"
                value={form.slug}
                onChange={(e) => setForm((prev) => ({ ...prev, slug: e.currentTarget.value }))}
                placeholder="可空，默认跟名称走"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat-hint">导航短句</Label>
              <Input
                id="cat-hint"
                value={form.hint}
                onChange={(e) => setForm((prev) => ({ ...prev, hint: e.currentTarget.value }))}
                placeholder="顶栏下一行的小字"
              />
            </div>
            <div className="space-y-2">
              <Label>颜色</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="分类颜色">
                {SITE_SKILL_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "size-7 rounded-full border-2 border-transparent shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-transform hover:scale-105",
                      form.color === color && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                    style={{ background: COLOR_HEX[color] }}
                    title={color}
                    aria-label={color}
                    aria-checked={form.color === color}
                    role="radio"
                    onClick={() => setForm((prev) => ({ ...prev, color }))}
                  />
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="cat-nav">出现在导航</Label>
              <Switch
                id="cat-nav"
                checked={form.nav}
                onCheckedChange={(nav) => setForm((prev) => ({ ...prev, nav }))}
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter className="mx-0 mb-0 rounded-none border-0 bg-transparent p-0 pt-1">
              <Button type="button" variant="outline" onClick={resetForm}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "保存中…" : editing ? "保存" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
