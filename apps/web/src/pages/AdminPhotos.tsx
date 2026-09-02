import { emptyEditorDocument, type PostListItem } from "@myblog/shared";
import { Button, Card, Input } from "animal-island-ui";
import { FormEvent, useEffect, useState } from "react";
import { FilePick } from "@/components/FilePick";
import { api } from "@/lib/api";

export function AdminPhotosPage() {
  const [photos, setPhotos] = useState<PostListItem[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const reload = () =>
    api.listPosts("photo").then((data) => setPhotos(data.posts)).catch(() => setPhotos([]));

  useEffect(() => {
    void reload();
  }, []);

  const addPhoto = async (e: FormEvent) => {
    e.preventDefault();
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
        type: "photo",
        coverUrl: url,
        body: emptyEditorDocument(),
        draft: false,
      });
      setTitle("");
      setFile(null);
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
    await api.patchPost(photo.id, { title: name });
    await reload();
  };

  const replaceCover = async (photo: PostListItem, next: File | undefined) => {
    if (!next) {
      return;
    }
    const { url } = await api.upload(next);
    await api.patchPost(photo.id, { coverUrl: url, draft: false });
    await reload();
  };

  const remove = async (id: string) => {
    if (!confirm("从照片墙拿掉这张？")) {
      return;
    }
    await api.deletePost(id);
    setPhotos((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <section className="admin-page">
      <div className="admin-head">
        <div>
          <h1 className="page-title">照片墙</h1>
          <p className="section-copy">上传后会出现在前台「照片」。标题会写在图下面。</p>
        </div>
      </div>
      <Card color="default" className="write-card">
        <form className="photo-upload" onSubmit={(e) => void addPhoto(e)}>
          <FilePick
            label={file ? "换一张" : "选择照片"}
            hint="JPG / PNG / WebP，可拖进来"
            fileName={file?.name}
            onFile={setFile}
          />
          <div className="photo-upload-row">
            <Input
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              placeholder="说明（可空，默认用文件名）"
            />
            <Button type="primary" htmlType="submit" loading={saving}>
              放到墙上
            </Button>
          </div>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </Card>
      {photos.length === 0 ? (
        <Card color="warm-peach-pink" className="empty-card">
          <p className="muted">墙上还是空的。选一张图放上去。</p>
        </Card>
      ) : (
        <ul className="admin-photo-grid">
          {photos.map((photo) => (
            <li key={photo.id}>
              <Card color="default" className="admin-photo-card">
                {photo.coverUrl ? (
                  <img src={photo.coverUrl} alt={photo.title} className="admin-photo-thumb" />
                ) : (
                  <div className="admin-photo-thumb admin-photo-thumb--empty">没有封面</div>
                )}
                <Input
                  key={`${photo.id}-${photo.updatedAt}`}
                  defaultValue={photo.title}
                  onBlur={(e) => void rename(photo, e.currentTarget.value)}
                />
                <div className="admin-row-actions">
                  <FilePick
                    compact
                    label="换图"
                    onFile={(next) => void replaceCover(photo, next)}
                  />
                  <Button size="small" danger onClick={() => void remove(photo.id)}>
                    删除
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
