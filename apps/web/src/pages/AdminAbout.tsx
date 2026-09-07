import {
  DEFAULT_ABOUT,
  SITE_SKILL_COLORS,
  emptyEditorDocument,
  type SiteAbout,
  type SiteSkillColor,
} from "@myblog/shared";
import EditorJS from "@editorjs/editorjs";
import { FormEvent, useEffect, useRef, useState } from "react";
import { PostEditor, saveEditor } from "@/components/PostEditor";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export function AdminAboutPage() {
  const editorRef = useRef<EditorJS | null>(null);
  const [about, setAbout] = useState<SiteAbout>(DEFAULT_ABOUT);
  const [loaded, setLoaded] = useState(false);
  const [skillName, setSkillName] = useState("");
  const [skillColor, setSkillColor] = useState<SiteSkillColor>("app-yellow");
  const [saving, setSaving] = useState(false);
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

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setOk(false);
    try {
      const body = await saveEditor(editorRef.current);
      const saved = await api.saveSite({
        ...about,
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

  return (
    <section className="flex min-h-full flex-1 flex-col">
      <AdminPageHeader title="关于" description="介绍正文用 Editor.js，和文章一样可排版。" />
      <Card className="write-card about-edit-card">
        <CardContent className="pt-6">
        <form className="write-form" onSubmit={(e) => void onSubmit(e)}>
          <div className="login-field">
            <Label htmlFor="about-avatar">头像（一个表情就好）</Label>
            <Input
              id="about-avatar"
              value={about.avatar}
              onChange={(e) => setAbout((prev) => ({ ...prev, avatar: e.currentTarget.value }))}
              placeholder="🦊"
            />
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
            <Button type="submit" disabled={saving}>
              {saving ? "保存中…" : "保存关于"}
            </Button>
          </div>
        </form>
        </CardContent>
      </Card>
    </section>
  );
}
