import {
  SITE_SKILL_COLORS,
  type Category,
  type CategoryKind,
  type SiteSkillColor,
} from "@myblog/shared";
import { ArrowDownWideNarrow, ArrowUpWideNarrow, Pencil, Plus, Trash2 } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";
import { cn } from "@/lib/utils";

const kindLabel: Record<CategoryKind, string> = {
  article: "文章",
  photos: "照片墙",
};

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
    kind: "article" as CategoryKind,
    nav: true,
  };
}

export function AdminCategoriesPage() {
  const { categories, reload } = useCategories();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const ordered = useMemo(
    () => [...categories].sort((a, b) => a.sort - b.sort),
    [categories],
  );

  const reset = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setOpen(false);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError("");
    setOpen(true);
  };

  const startEdit = (category: Category) => {
    setEditing(category);
    setForm({
      name: category.name,
      slug: category.slug,
      hint: category.hint,
      color: category.color,
      kind: category.kind,
      nav: category.nav,
    });
    setError("");
    setOpen(true);
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
        await api.updateCategory(editing.id, { ...form, sort: editing.sort });
      } else {
        await api.createCategory(form);
      }
      await reload();
      reset();
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "PHOTOS_EXISTS") {
        setError("照片墙只能有一个。");
      } else {
        setError("没存上，再试一次。");
      }
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
        reset();
      }
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "CATEGORY_IN_USE") {
        setError("这个分类里还有文章或照片，先挪走再删。");
      } else if (code === "LAST_ARTICLE_CATEGORY") {
        setError("至少留一个文章分类。");
      } else {
        setError("没删掉。");
      }
    }
  };

  const move = async (category: Category, dir: -1 | 1) => {
    const index = ordered.findIndex((item) => item.id === category.id);
    const swap = ordered[index + dir];
    if (!swap) {
      return;
    }
    await Promise.all([
      api.updateCategory(category.id, {
        name: category.name,
        slug: category.slug,
        hint: category.hint,
        color: category.color,
        kind: category.kind,
        nav: category.nav,
        sort: swap.sort,
      }),
      api.updateCategory(swap.id, {
        name: swap.name,
        slug: swap.slug,
        hint: swap.hint,
        color: swap.color,
        kind: swap.kind,
        nav: swap.nav,
        sort: category.sort,
      }),
    ]);
    await reload();
  };

  return (
    <section className="flex min-h-full flex-1 flex-col">
      <AdminPageHeader
        title="分类"
        description="管理顶栏栏目。照片墙只能有一个。"
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" />
            新建分类
          </Button>
        }
      />

      {error && !open ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3.5">
        {ordered.map((category, index) => (
          <li key={category.id}>
            <Card className="overflow-hidden py-0 transition-shadow hover:shadow-md">
              <div className="flex min-h-[132px]">
                <span
                  className="w-1.5 shrink-0"
                  style={{ background: COLOR_HEX[category.color] }}
                  aria-hidden
                />
                <CardContent className="flex min-w-0 flex-1 flex-col gap-2.5 py-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-3 ring-background"
                        style={{ background: COLOR_HEX[category.color] }}
                        aria-hidden
                      />
                      <h2 className="truncate text-lg font-bold tracking-tight">{category.name}</h2>
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
                  </div>
                  <p className="min-h-5 text-sm text-muted-foreground">
                    {category.hint || "还没有短句"}
                  </p>
                  <div className="mt-auto flex flex-wrap items-center gap-2">
                    <code className="rounded-md bg-muted px-2 py-0.5 text-xs font-semibold opacity-70">
                      /{category.slug}
                    </code>
                    <Badge variant="secondary">{kindLabel[category.kind]}</Badge>
                    <Badge variant={category.nav ? "default" : "outline"}>
                      {category.nav ? "导航" : "隐藏"}
                    </Badge>
                  </div>
                </CardContent>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) reset();
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
              <Label>形态</Label>
              <Select
                value={form.kind}
                onValueChange={(key) => setForm((prev) => ({ ...prev, kind: key as CategoryKind }))}
              >
                <SelectTrigger className="w-full" aria-label="分类形态">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="article">文章栏</SelectItem>
                  <SelectItem value="photos">照片墙（全站仅一个）</SelectItem>
                </SelectContent>
              </Select>
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
              <Button type="button" variant="outline" onClick={reset}>
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "保存中…" : editing ? "保存" : "创建"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
