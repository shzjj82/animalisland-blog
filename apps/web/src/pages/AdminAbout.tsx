import {
  DEFAULT_ABOUT,
  SITE_SKILL_COLORS,
  emptyEditorDocument,
  type SiteAbout,
  type SiteSkillColor,
} from "@myblog/shared";
import EditorJS from "@editorjs/editorjs";
import { FormEvent, useEffect, useRef, useState } from "react";
import { FilePick } from "@/components/FilePick";
import { PostEditor, saveEditor } from "@/components/PostEditor";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

function isAvatarUrl(value: string) {
  const v = value.trim();
  return /^(https?:\/\/|\/|data:)/i.test(v);
}

export function AdminAboutPage() {
  const editorRef = useRef<EditorJS | null>(null);
  const [about, setAbout] = useState<SiteAbout>(DEFAULT_ABOUT);
  const [loaded, setLoaded] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillColor, setSkillColor] = useState<SiteSkillColor>("app-yellow");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    void api
      .getSite()
      .then((data) => {
        setAbout(data.about);
        setLoaded(true);
      })
      .catch(() => {
        setAbout(DEFAULT_ABOUT);
        setLoaded(true);
      });
  }, []);

  const addSkill = () => {
    const name = skillName.trim();
    if (!name) {
      return;
    }
    setAbout((prev) => ({
      ...prev,
      skills: [...prev.skills, { name, color: skillColor }].slice(0, 12),
    }));
    setSkillName("");
  };

  const removeSkill = (index: number) => {
    setAbout((prev) => ({
      ...prev,
      skills: prev.skills.filter((_, i) => i !== index),
    }));
  };

  const onPickAvatar = async (file: File) => {
    setUploading(true);
    setError("");
    setOk(false);
    try {
      const { url } = await api.upload(file);
      setAbout((prev) => ({ ...prev, avatar: url }));
    } catch {
      setError("头像没传上去，再试一次。");
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setOk(false);
    try {
      const body = await saveEditor(editorRef.current);
      const saved = await api.saveSite({
        ...about,
        avatar: about.avatar.trim() || DEFAULT_ABOUT.avatar,
        body: body.blocks.length ? body : emptyEditorDocument(),
      });
      setAbout(saved.about);
      setOk(true);
    } catch {
      setError("没存上，再试一次。");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) {
    return <p className="muted">加载中…</p>;
  }

  const avatarPreview = isAvatarUrl(about.avatar) ? about.avatar : "";

  return (
    <section className="flex min-h-full flex-1 flex-col">
      <AdminPageHeader title="关于" description="介绍正文用 Editor.js，和文章一样可排版。" />
      <Card className="write-card about-edit-card">
        <CardContent className="pt-6">
          <form className="write-form" onSubmit={(e) => void onSubmit(e)}>
            <div className="login-field space-y-3">
              <Label>头像</Label>
              <div className="flex flex-wrap items-start gap-4">
                <div
                  className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted text-3xl"
                  aria-hidden
                >
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="" className="size-full object-cover" />
                  ) : (
                    <span>{about.avatar.trim() || "🦊"}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <FilePick
                    compact
                    label={uploading ? "上传中…" : "上传图片"}
                    hint="jpg / png / webp"
                    accept="image/*"
                    onFile={(file) => void onPickAvatar(file)}
                  />
                  <div className="space-y-1.5">
                    <Label htmlFor="about-avatar-url" className="text-muted-foreground">
                      或填写图片地址
                    </Label>
                    <Input
                      id="about-avatar-url"
                      value={about.avatar}
                      onChange={(e) =>
                        setAbout((prev) => ({ ...prev, avatar: e.currentTarget.value }))
                      }
                      placeholder="https://… 或 /uploads/…"
                    />
                  </div>
                </div>
              </div>
            </div>
            <div className="login-field">
              <Label htmlFor="about-name">标题</Label>
              <Input
                id="about-name"
                value={about.name}
                onChange={(e) => setAbout((prev) => ({ ...prev, name: e.currentTarget.value }))}
                placeholder="小岛日记"
              />
            </div>
            <div className="login-field">
              <Label>介绍</Label>
              <div className="about-editor">
                <PostEditor
                  key="about-editor"
                  initial={about.body}
                  onReady={(instance) => {
                    editorRef.current = instance;
                  }}
                />
              </div>
            </div>
            <div>
              <p className="section-copy" style={{ marginBottom: 8 }}>
                标签
              </p>
              <div className="about-skill-list">
                {about.skills.map((skill, index) => (
                  <button
                    key={`${skill.name}-${index}`}
                    type="button"
                    className="about-skill-chip"
                    onClick={() => removeSkill(index)}
                  >
                    {skill.name} ×
                  </button>
                ))}
              </div>
              <div className="about-skill-add">
                <Input
                  value={skillName}
                  onChange={(e) => setSkillName(e.currentTarget.value)}
                  placeholder="新标签"
                />
                <select
                  className="about-color"
                  value={skillColor}
                  onChange={(e) => setSkillColor(e.currentTarget.value as SiteSkillColor)}
                >
                  {SITE_SKILL_COLORS.map((color) => (
                    <option key={color} value={color}>
                      {color}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" onClick={addSkill}>
                  加上
                </Button>
              </div>
            </div>
            {error ? <p className="error">{error}</p> : null}
            {ok ? <p className="muted">已写上首页。</p> : null}
            <div className="write-actions">
              <Button type="submit" disabled={saving || uploading}>
                {saving ? "保存中…" : "保存关于"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
