import EditorJS from "@editorjs/editorjs";
import { emptyEditorDocument, type Post, type UpsertPostInput } from "@myblog/shared";
import { useEffect, useRef, useState } from "react";
import { AiAssistPanel } from "@/components/AiAssistPanel";
import { PostEditor, saveEditor } from "@/components/PostEditor";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";
import { ensureTitleHeader, metaFromEditorDocument } from "@/lib/editorMeta";
import { cn } from "@/lib/utils";

type Props = {
  postId?: string | null;
  defaultType?: string | null;
  onClose: () => void;
  onSaved: (post: Post) => void;
};

export function WriteEditor({ postId, defaultType, onClose, onSaved }: Props) {
  const { articleCategories, reload } = useCategories();
  const editorRef = useRef<EditorJS | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const [slug, setSlug] = useState("");
  const [type, setType] = useState("");
  const [initial, setInitial] = useState(emptyEditorDocument());
  const [loaded, setLoaded] = useState(!postId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [post, setPost] = useState<Post | null>(null);

  useEffect(() => {
    if (type || articleCategories.length === 0) {
      return;
    }
    const match = articleCategories.find((item) => item.slug === defaultType);
    setType(match?.slug ?? articleCategories[0].slug);
  }, [articleCategories, defaultType, type]);

  useEffect(() => {
    if (!postId) {
      setLoaded(true);
      return;
    }
    let alive = true;
    void api
      .getById(postId)
      .then((data) => {
        if (!alive) {
          return;
        }
        if (data.post.categoryKind === "photos") {
          setError("照片请去照片墙管理。");
          return;
        }
        setPost(data.post);
        setSlug(data.post.slug);
        setType(data.post.type);
        setInitial(ensureTitleHeader(data.post.body, data.post.title));
        setLoaded(true);
      })
      .catch((err) => {
        if (!alive) {
          return;
        }
        setError(err instanceof Error ? err.message : "加载失败");
      });
    return () => {
      alive = false;
    };
  }, [postId]);

  if (!loaded) {
    return <p className="px-6 py-8 text-sm text-muted-foreground">加载中…</p>;
  }

  const persist = async (draft: boolean) => {
    if (!type) {
      setError("先选一个分类。");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = await saveEditor(editorRef.current);
      const meta = metaFromEditorDocument(body, {
        title: post?.title,
        summary: post?.summary,
        coverUrl: post?.coverUrl,
      });
      const payload: UpsertPostInput = {
        title: meta.title,
        slug: slug.trim() || undefined,
        type,
        summary: meta.summary,
        coverUrl: meta.coverUrl,
        body,
        draft,
      };
      const saved = post
        ? await api.updatePost(post.id, payload)
        : await api.createPost(payload);
      await reload();
      onSaved(saved.post);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const selected = articleCategories.find((item) => item.slug === type);

  return (
    <div className="write-editor flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/70 bg-background px-5 py-3">
        <div className="mr-auto min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">发布到分类</p>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="文章分类">
            {articleCategories.map((item) => {
              const active = type === item.slug;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={item.hint || item.name}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3 text-sm font-medium transition-colors",
                    active
                      ? "border-foreground/80 bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => setType(item.slug)}
                >
                  {item.name}
                </button>
              );
            })}
          </div>
          {selected?.hint ? (
            <p className="text-xs text-muted-foreground">{selected.hint}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {error ? <p className="mr-1 text-sm font-medium text-destructive">{error}</p> : null}
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={saving}
            onClick={() => void persist(true)}
          >
            {saving ? "保存中…" : "存草稿"}
          </Button>
          <Button type="button" size="sm" disabled={saving} onClick={() => void persist(false)}>
            {saving ? "发布中…" : "发布"}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 bg-background">
        <div className="write-paper min-h-0 min-w-0 flex-1 overflow-y-auto bg-background px-3 py-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:px-5">
          <PostEditor
            key={post?.id ?? `new-${defaultType ?? "blank"}`}
            initial={initial}
            onReady={(instance) => {
              editorRef.current = instance;
              setEditorReady(true);
            }}
          />
        </div>
        <AiAssistPanel editor={editorReady ? editorRef.current : null} />
      </div>
    </div>
  );
}
