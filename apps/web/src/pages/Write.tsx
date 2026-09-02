import EditorJS from "@editorjs/editorjs";
import { emptyEditorDocument, isArticleType, type ArticleType, type Post, type UpsertPostInput } from "@myblog/shared";
import { Button, Card, Icon, Input } from "animal-island-ui";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FilePick } from "@/components/FilePick";
import { PostEditor, saveEditor } from "@/components/PostEditor";
import { TypeChips } from "@/components/TypeChips";
import { api } from "@/lib/api";

export function WritePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editorRef = useRef<EditorJS | null>(null);
  const requestedType = searchParams.get("type");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [type, setType] = useState<ArticleType>(
    requestedType && isArticleType(requestedType) ? requestedType : "life",
  );
  const [summary, setSummary] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [initial, setInitial] = useState(emptyEditorDocument());
  const [loaded, setLoaded] = useState(!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [post, setPost] = useState<Post | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }
    void api.getById(id).then((data) => {
      if (!isArticleType(data.post.type)) {
        navigate("/admin/photos", { replace: true });
        return;
      }
      setPost(data.post);
      setTitle(data.post.title);
      setSlug(data.post.slug);
      setType(data.post.type);
      setSummary(data.post.summary);
      setCoverUrl(data.post.coverUrl);
      setInitial(data.post.body);
      setLoaded(true);
    });
  }, [id, navigate]);

  if (!loaded) {
    return <p className="muted">加载中…</p>;
  }

  const persist = async (draft: boolean) => {
    setSaving(true);
    setError("");
    try {
      const body = await saveEditor(editorRef.current);
      const payload: UpsertPostInput = {
        title,
        slug: slug || undefined,
        type,
        summary,
        coverUrl,
        body,
        draft,
      };
      const saved = post
        ? await api.updatePost(post.id, payload)
        : await api.createPost(payload);
      navigate(`/post/${saved.post.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const onCover = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const { url } = await api.upload(file);
    setCoverUrl(url);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void persist(false);
  };

  return (
    <section className="write-page">
      <div className="section-head">
        <Icon name="icon-diy" size={36} />
        <h1 className="page-title">{post ? "编辑文章" : "新文章"}</h1>
      </div>
      <Card color="default" className="write-card">
        <form className="write-form" onSubmit={onSubmit}>
          <label className="login-field">
            <span>类型</span>
            <TypeChips value={type} onChange={setType} />
          </label>
          <Input value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder="标题" />
          <Input value={slug} onChange={(e) => setSlug(e.currentTarget.value)} placeholder="链接别名（可空）" />
          <Input value={summary} onChange={(e) => setSummary(e.currentTarget.value)} placeholder="摘要" />
          <FilePick
            label={coverUrl ? "换一张封面" : "选择封面"}
            hint="JPG / PNG / WebP，可拖进来"
            previewUrl={coverUrl || undefined}
            onFile={(file) => void onCover(file)}
          />
          <PostEditor
            key={post?.id ?? "new"}
            initial={initial}
            onReady={(instance) => {
              editorRef.current = instance;
            }}
          />
          {error ? <p className="error">{error}</p> : null}
          <div className="write-actions">
            <Button htmlType="button" loading={saving} onClick={() => void persist(true)}>
              保存草稿
            </Button>
            <Button type="primary" htmlType="submit" loading={saving}>
              发布
            </Button>
          </div>
        </form>
      </Card>
    </section>
  );
}
