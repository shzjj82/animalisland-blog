import type { SiteSkill } from "@myblog/shared";
import { AboutAvatar } from "@/components/AboutAvatar";
import { FilePick } from "@/components/FilePick";
import { Button } from "@/components/ui/button";
import { skillColorHex } from "@/lib/skillColors";

type Props = {
  avatar: string;
  skills: SiteSkill[];
  uploading: boolean;
  onPickAvatar: (file: File) => void;
  onClearAvatar: () => void;
  onManageSkills: () => void;
};

/** 关于页：头像与首页技能标签 */
export function AboutEditorPanel({
  avatar,
  skills,
  uploading,
  onPickAvatar,
  onClearAvatar,
  onManageSkills,
}: Props) {
  return (
    <div className="shrink-0 space-y-4 border-b border-border/60 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted"
          aria-hidden
        >
          <AboutAvatar value={avatar} iconSize={28} />
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <FilePick
            compact
            label={uploading ? "上传中…" : "上传头像"}
            hint="jpg / png / webp"
            accept="image/*"
            onFile={onPickAvatar}
          />
          {avatar ? (
            <Button type="button" size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={onClearAvatar}>
              清除
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">首页标签</p>
          <Button type="button" size="sm" variant="outline" className="h-7" onClick={onManageSkills}>
            管理标签
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {skills.length ? (
            skills.map((skill, index) => (
              <span
                key={`${skill.name}-${index}`}
                className="inline-flex items-center rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-foreground/90"
                style={{ background: skillColorHex(skill.color) }}
              >
                {skill.name}
              </span>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">还没有标签，点「管理标签」添加。</p>
          )}
        </div>
      </div>
    </div>
  );
}
