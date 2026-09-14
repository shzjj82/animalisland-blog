import {
  SITE_SKILL_COLORS,
  validateTagName,
  validateTagSlug,
  type Category,
  type SiteSkillColor,
} from "@myblog/shared";
import { ArrowDown, ArrowUp, Close, Plus, Edit } from "@icon-park/react";
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
import { iconParkOutline } from "@/lib/iconPark";
import { SKILL_COLOR_HEX } from "@/lib/skillColors";
import { cn } from "@/lib/utils";

function emptyForm() {
  return {
    name: "",
    slug: "",
    hint: "",
    color: "app-blue" as SiteSkillColor,
    nav: true,
  };
}

function mapApiError(message: string): string {
  if (message.startsWith("TAG_NAME_INVALID:")) {
    return message.slice("TAG_NAME_INVALID:".length);
  }
  if (message.startsWith("TAG_SLUG_INVALID:")) {
    return message.slice("TAG_SLUG_INVALID:".length);
  }
  if (message === "TAG_NAME_EXISTS") {
    return "已有同名标签。";
  }
  return "没存上，再试一次。";
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** 标签（=分类）管理：改名、改路径、是否进导航、删除 */
export function CategoryManagerDialog({ open, onOpenChange }: Props) {
  const { categories, reload } = useCategories();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
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
    setDeleteTarget(null);
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
    const nameCheck = validateTagName(form.name);
    if (!nameCheck.ok) {
      setError(nameCheck.error);
      return;
    }
    const slugCheck = validateTagSlug(form.slug, { allowEmpty: true });
    if (!slugCheck.ok) {
      setError(slugCheck.error);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: nameCheck.value,
        slug: slugCheck.value || undefined,
        hint: form.hint,
        color: form.color,
        nav: form.nav,
        kind: "article" as const,
      };
      if (editing) {
        await api.updateCategory(editing.id, { ...payload, sort: editing.sort });
      } else {
        await api.createCategory(payload);
      }
      await reload();
      resetForm();
    } catch (err) {
      setError(mapApiError(err instanceof Error ? err.message : ""));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await api.deleteCategory(deleteTarget.id);
      await reload();
      if (editing?.id === deleteTarget.id) {
        resetForm();
      }
      setDeleteTarget(null);
    } catch {
      setError("没删掉，再试一次。");
    } finally {
      setSaving(false);
    }
  };

  const move = async (category: Category, dir: -1 | 1) => {
    const index = ordered.findIndex((item) => item.id === category.id);
    const swapIndex = index + dir;
    if (index < 0 || swapIndex < 0 || swapIndex >= ordered.length) {
      return;
    }

    const next = [...ordered];
    const current = next[index]!;
    const swap = next[swapIndex]!;
    next[index] = swap;
    next[swapIndex] = current;

    try {
      for (let i = 0; i < next.length; i += 1) {
        const item = next[i]!;
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
        open={open && !formOpen && !deleteTarget}
        onOpenChange={(next) => {
          if (!next) closeAll();
        }}
      >
        <DialogContent className="max-w-lg sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>标签管理</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            标签就是分类：可改名称与路径（如 /travel），决定是否出现在导航，也可删除。
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
                  style={{ background: SKILL_COLOR_HEX[category.color] }}
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
                    <ArrowUp {...iconParkOutline} size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="下移"
                    disabled={index === ordered.length - 1}
                    onClick={() => void move(category, 1)}
                  >
                    <ArrowDown {...iconParkOutline} size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    title="编辑"
                    onClick={() => startEdit(category)}
                  >
                    <Edit {...iconParkOutline} size={14} />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    title="删除"
                    onClick={() => {
                      setError("");
                      setDeleteTarget(category);
                    }}
                  >
                    <Close {...iconParkOutline} size={14} />
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
              <Plus {...iconParkOutline} size={14} className="mr-1" />
              新建标签
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
            <DialogTitle>{editing ? "编辑标签" : "新建标签"}</DialogTitle>
          </DialogHeader>
          <form className="flex flex-col gap-3.5" onSubmit={(event) => void onSubmit(event)}>
            <div className="space-y-2">
              <Label htmlFor="tag-name">名称</Label>
              <Input
                id="tag-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.currentTarget.value }))}
                placeholder="比如旅行、读书（2–16 字）"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-slug">路径</Label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">/</span>
                <Input
                  id="tag-slug"
                  value={form.slug}
                  onChange={(e) => setForm((prev) => ({ ...prev, slug: e.currentTarget.value }))}
                  placeholder="可空，默认跟名称走"
                />
              </div>
              <p className="text-[11px] text-muted-foreground">前台地址形如 /travel，不能用保留路径或纯数字。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="tag-hint">导航短句</Label>
              <Input
                id="tag-hint"
                value={form.hint}
                onChange={(e) => setForm((prev) => ({ ...prev, hint: e.currentTarget.value }))}
                placeholder="顶栏下一行的小字"
              />
            </div>
            <div className="space-y-2">
              <Label>颜色</Label>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="标签颜色">
                {SITE_SKILL_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "size-7 rounded-full border-2 border-transparent shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] transition-transform hover:scale-105",
                      form.color === color && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                    )}
                    style={{ background: SKILL_COLOR_HEX[color] }}
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
              <Label htmlFor="tag-nav">出现在导航</Label>
              <Switch
                id="tag-nav"
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

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(next) => {
          if (!next) setDeleteTarget(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除标签「{deleteTarget?.name}」？</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            删除后：导航与筛选里不再出现；已挂这个标签的文章会自动去掉它。路径 /{deleteTarget?.slug}{" "}
            也会失效。
          </p>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0">
            <Button type="button" variant="outline" disabled={saving} onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button type="button" variant="destructive" disabled={saving} onClick={() => void confirmDelete()}>
              {saving ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

