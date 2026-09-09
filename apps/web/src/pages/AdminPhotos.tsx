import { emptyEditorDocument, type PostListItem } from "@myblog/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FilePick } from "@/components/FilePick";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";

export function AdminPhotosPage() {
  const { photosCategory } = useCategories();
  const [photos, setPhotos] = useState<PostListItem[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const reload = () =>
    api.listPosts({ kind: "photos" }).then((data) => setPhotos(data.posts)).catch(() => setPhotos([]));

  useEffect(() => {
    void reload();
  }, []);

  const clearPick = () => {
    setFile(null);
    setTitle("");
  };

  const addPhoto = async (e: FormEvent) => {
    e.preventDefault();
    if (!photosCategory) {
      setError("还没有照片墙分类，请检查数据库种子数据。");
      return;
    }
    if (!file) {
      setError("先选一张照片。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const { url } = await api.upload(file);
      await api.createPost({
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        type: photosCategory.slug,
        coverUrl: url,
        body: emptyEditorDocument(),
        draft: false,
      });
      clearPick();
      await reload();
    } catch {
      setError("没放上去，再试一次。");
    } finally {
      setSaving(false);
    }
  };

  const rename = async (photo: PostListItem, nextTitle: string) => {
    const name = nextTitle.trim();
    if (!name || name === photo.title) {
      return;
    }
    setBusyId(photo.id);
    try {
      await api.patchPost(photo.id, { title: name });
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const replaceCover = async (photo: PostListItem, next: File | undefined) => {
    if (!next) {
      return;
    }
    setBusyId(photo.id);
    try {
      const { url } = await api.upload(next);
      await api.patchPost(photo.id, { coverUrl: url, draft: false });
      await reload();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("从照片墙拿掉这张？")) {
      return;
    }
    setBusyId(id);
    try {
      await api.deletePost(id);
      setPhotos((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="admin-photos flex min-h-full flex-1 flex-col">
      <AdminPageHeader
        title="照片墙"
        description={`上传后会出现在前台。墙上已有 ${photos.length} 张。`}
        actions={
          photosCategory ? (
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/${photosCategory.slug}`}>看前台墙 →</Link>
            </Button>
          ) : null
        }
      />

      {!photosCategory ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center gap-3 py-5">
            <p className="m-0 text-sm text-muted-foreground">
              还没有照片墙分类。先去「分类」建一个「照片墙」。
            </p>
            <Button asChild size="sm">
              <Link to="/admin/categories">去建分类</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="admin-photos-upload">
          <CardContent className="pt-6">
          <form className="photo-upload" onSubmit={(e) => void addPhoto(e)}>
            <div className={`photo-upload-stage${previewUrl ? " has-preview" : ""}`}>
              {previewUrl ? (
                <img src={previewUrl} alt="" className="photo-upload-preview" />
              ) : (
                <div className="photo-upload-placeholder" aria-hidden>
                  <span>📷</span>
                  <strong>把照片放上墙</strong>
                  <em>JPG / PNG / WebP / GIF</em>
                </div>
              )}
              <div className="photo-upload-overlay">
                <FilePick
                  label={file ? "换一张" : "选择或拖入照片"}
                  hint={file?.name || "也可以直接拖到这里"}
                  onFile={setFile}
                />
              </div>
            </div>
            <div className="photo-upload-row">
              <Input
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                placeholder="说明（可空，默认用文件名）"
              />
              <div className="photo-upload-actions">
                {file ? (
                  <Button type="button" variant="outline" onClick={clearPick}>
                    清空
                  </Button>
                ) : null}
                <Button type="submit" disabled={saving || !file}>
                  {saving ? "上传中…" : "放到墙上"}
                </Button>
              </div>
            </div>
          </form>
          {error ? <p className="error">{error}</p> : null}
          </CardContent>
        </Card>
      )}

      {photos.length === 0 ? (
        <Card className="mt-4 border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">墙上还是空的。选一张图放上去。</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="admin-photo-grid">
          {photos.map((photo) => (
            <li key={photo.id} className={busyId === photo.id ? "is-busy" : undefined}>
              <article className="admin-photo-tile">
                <div className="admin-photo-media">
                  {photo.coverUrl ? (
                    <img src={photo.coverUrl} alt={photo.title} loading="lazy" decoding="async" />
                  ) : (
                    <div className="admin-photo-thumb--empty">没有封面</div>
                  )}
                  <div className="admin-photo-actions">
                    <FilePick
                      compact
                      label="换图"
                      onFile={(next) => void replaceCover(photo, next)}
                    />
                    <Button size="sm" variant="destructive" onClick={() => void remove(photo.id)}>
                      删除
                    </Button>
                  </div>
                </div>
                <label className="admin-photo-caption">
                  <span className="admin-photo-caption-label">标题</span>
                  <Input
                    key={`${photo.id}-${photo.updatedAt}`}
                    defaultValue={photo.title}
                    onBlur={(e) => void rename(photo, e.currentTarget.value)}
                    placeholder="给这张图起个名字"
                  />
                </label>
                <time className="admin-photo-date" dateTime={(photo.publishedAt ?? photo.updatedAt).slice(0, 10)}>
                  {(photo.publishedAt ?? photo.updatedAt).slice(0, 10)}
                </time>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
