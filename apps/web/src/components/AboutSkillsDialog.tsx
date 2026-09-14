import { SITE_SKILL_COLORS, type SiteSkill, type SiteSkillColor } from "@myblog/shared";
import { Close, Plus } from "@icon-park/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { iconParkOutline } from "@/lib/iconPark";
import { skillColorHex } from "@/lib/skillColors";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skills: SiteSkill[];
  onSave: (skills: SiteSkill[]) => void;
};

/** 关于页首页技能标签（与文章分类标签不是同一套） */
export function AboutSkillsDialog({ open, onOpenChange, skills, onSave }: Props) {
  const [draft, setDraft] = useState<SiteSkill[]>(skills);
  const [name, setName] = useState("");
  const [color, setColor] = useState<SiteSkillColor>("app-yellow");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraft(skills);
          setName("");
          setColor("app-yellow");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>关于页标签</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          显示在首页「关于」卡片上，最多 12 个。点标签可移除。
        </p>

        <div className="flex min-h-10 flex-wrap gap-1.5">
          {draft.length ? (
            draft.map((skill, index) => (
              <button
                key={`${skill.name}-${index}`}
                type="button"
                className="inline-flex items-center gap-1 rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-foreground/90"
                style={{ background: skillColorHex(skill.color) }}
                onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              >
                {skill.name}
                <Close {...iconParkOutline} size={12} aria-hidden />
              </button>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">还没有标签。</p>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border/70 p-3">
          <Input
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="新标签名称"
            className="h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const trimmed = name.trim();
                if (!trimmed || draft.length >= 12) {
                  return;
                }
                setDraft((prev) => [...prev, { name: trimmed, color }]);
                setName("");
              }
            }}
          />
          <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="标签颜色">
            {SITE_SKILL_COLORS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                className={cn(
                  "size-6 shrink-0 rounded-full border border-black/10",
                  color === item && "ring-2 ring-ring ring-offset-2 ring-offset-background",
                )}
                style={{ background: skillColorHex(item) }}
                title={item}
                aria-label={item}
                aria-checked={color === item}
                onClick={() => setColor(item)}
              />
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!name.trim() || draft.length >= 12}
            onClick={() => {
              const trimmed = name.trim();
              if (!trimmed) {
                return;
              }
              setDraft((prev) => [...prev, { name: trimmed, color }].slice(0, 12));
              setName("");
            }}
          >
            <Plus {...iconParkOutline} size={14} className="mr-1" />
            添加
          </Button>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => {
              onSave(draft.slice(0, 12));
              onOpenChange(false);
            }}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
