import { DEFAULT_ABOUT, SITE_SKILL_COLORS, type SiteAbout, type SiteSkillColor } from "@myblog/shared";
import { Button, Card, Input } from "animal-island-ui";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

export function AdminAboutPage() {
  const [about, setAbout] = useState<SiteAbout>(DEFAULT_ABOUT);
  const [skillName, setSkillName] = useState("");
  const [skillColor, setSkillColor] = useState<SiteSkillColor>("app-yellow");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  useEffect(() => {
    void api
      .getSite()
      .then((data) => setAbout(data.about))
      .catch(() => setAbout(DEFAULT_ABOUT));
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
      const saved = await api.saveSite(about);
      setAbout(saved.about);
      setOk(true);
    } catch {
      setError("没存上，再试一次。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-page">
      <div className="admin-head">
        <div>
          <h1 className="page-title">关于</h1>
          <p className="section-copy">改的是首页「关于」那一块：名字、自我介绍和标签。</p>
        </div>
      </div>
      <Card color="default" className="write-card">
        <form className="write-form" onSubmit={(e) => void onSubmit(e)}>
          <label className="login-field">
            <span>头像（一个表情就好）</span>
            <Input
              value={about.avatar}
              onChange={(e) => setAbout((prev) => ({ ...prev, avatar: e.currentTarget.value }))}
              placeholder="🦊"
            />
          </label>
          <label className="login-field">
            <span>标题</span>
            <Input
              value={about.name}
              onChange={(e) => setAbout((prev) => ({ ...prev, name: e.currentTarget.value }))}
              placeholder="小岛日记"
            />
          </label>
          <label className="login-field">
            <span>介绍</span>
            <textarea
              className="about-body"
              rows={6}
              value={about.body}
              onChange={(e) => setAbout((prev) => ({ ...prev, body: e.currentTarget.value }))}
              placeholder="用几句话介绍这座岛。"
            />
          </label>
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
              <Button htmlType="button" onClick={addSkill}>
                加上
              </Button>
            </div>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {ok ? <p className="muted">已写上首页。</p> : null}
          <div className="write-actions">
            <Button type="primary" htmlType="submit" loading={saving}>
              保存关于
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
