import {
  DEFAULT_ABOUT,
  SITE_SKILL_COLORS,
  emptyEditorDocument,
  isSiteSkillColor,
  type Post,
  type PostListItem,
  type SiteSkill,
  type SiteSkillColor,
  type UpsertPostInput,
} from "@myblog/shared";
import { Close, Notes } from "@icon-park/react";
import EditorJS from "@editorjs/editorjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { AboutAvatar } from "@/components/AboutAvatar";
import { SoftScrollbar } from "@/components/SoftScrollbar";
import { FilePick } from "@/components/FilePick";
import type { PageLinkData } from "@/components/editor/PageLinkTool";
import { InlineAiAssist } from "@/components/InlineAiAssist";
import { PublishDialog } from "@/components/PublishDialog";
import { Button } from "@/components/ui/button";
import { NotionEditor, saveEditor } from "@/content";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { ensureTitleHeader, metaFromEditorDocument } from "@/lib/editorMeta";
import { appendPageLink, syncPageLinkTitle } from "@/lib/pageLinks";
import { iconParkOutline, PageLinkIcon } from "@/lib/iconPark";
import { ancestorsOf, pageTitle } from "@/lib/pageTree";

type WorkspaceOutlet = {
  reloadTree: () => Promise<PostListItem[]>;
  pages: PostListItem[];
  previewTreeTitle: (pageId: string, title: string) => void;
};

type Props = {
  onSaved?: (post: Post) => void;
};

const AUTOSAVE_MS = 900;

export function PageEditor({ onSaved }: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pages, previewTreeTitle } = useOutletContext<WorkspaceOutlet>();
  const editorRef = useRef<EditorJS | null>(null);
  const previewTreeTitleRef = useRef(previewTreeTitle);
  previewTreeTitleRef.current = previewTreeTitle;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const autosaveTimerRef = useRef(0);
  const saveSeqRef = useRef(0);

  const [editorReady, setEditorReady] = useState(false);
  const [inlineAi, setInlineAi] = useState<{ insertIndex: number } | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [draft, setDraft] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishMode, setPublishMode] = useState<"publish" | "edit">("publish");
  const [avatar, setAvatar] = useState(DEFAULT_ABOUT.avatar);
  const [skills, setSkills] = useState<SiteSkill[]>(DEFAULT_ABOUT.skills);
  const [skillName, setSkillName] = useState("");
  const [skillColor, setSkillColor] = useState<SiteSkillColor>("app-yellow");
  const [initial, setInitial] = useState(emptyEditorDocument());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /** 斜杠刚建、尚在编辑器未入库 body 的子页 id */
  const [pendingLinkIds, setPendingLinkIds] = useState<string[]>([]);
  const [editorEpoch, setEditorEpoch] = useState(0);

  const liveRef = useRef({
    post: null as Post | null,
    title: "",
    slug: "",
    draft: true,
    tags: [] as string[],
    avatar: DEFAULT_ABOUT.avatar,
    skills: DEFAULT_ABOUT.skills as SiteSkill[],
  });
  liveRef.current = { post, title, slug, draft, tags, avatar, skills };

  const persist = useCallback(async (opts?: { draft?: boolean; tags?: string[] }) => {
    const snap = liveRef.current;
    const current = snap.post;
    if (!current) {
      return;
    }
    const kind = current.pageKind;
    const showEditor = kind === "article" || kind === "about";
    const asDraft = opts?.draft ?? snap.draft;
    const nextTags = opts?.tags ?? snap.tags;
    const seq = ++saveSeqRef.current;

    setSaving(true);
    setSaveHint("saving");
    setError("");
    try {
      let body = current.body;
      if (showEditor) {
        body = await saveEditor(editorRef.current);
      }

      let payload: UpsertPostInput;
      if (kind === "about") {
        payload = {
          title: snap.title.trim() || "关于",
          slug: snap.slug.trim() || undefined,
          type: current.type,
          pageKind: "about",
          summary: "",
          coverUrl: "",
          props: { avatar: snap.avatar.trim() || DEFAULT_ABOUT.avatar, skills: snap.skills },
          body: body.blocks.length ? body : emptyEditorDocument(),
          draft: false,
        };
      } else {
        const meta = metaFromEditorDocument(body, {
          title:
            current.title !== "无标题" && current.title !== "未命名" ? current.title : undefined,
          summary: current.summary,
          coverUrl: current.coverUrl,
        });
        payload = {
          title: meta.title,
          slug: snap.slug.trim() || undefined,
          type: current.type,
          pageKind: "article",
          parentId: current.parentId,
          summary: meta.summary,
          coverUrl: meta.coverUrl,
          props: current.props,
          tags: current.parentId ? [] : nextTags,
          body,
          // 子页永远不是草稿；顶层仅手动发布才改 draft
          draft: current.parentId ? false : asDraft,
        };
      }

      const { post: saved } = await api.updatePost(current.id, payload);
      if (seq !== saveSeqRef.current) {
        return;
      }

      if (kind === "article" && saved.parentId && saved.title !== current.title) {
        try {
          const { post: parentPost } = await api.getById(saved.parentId);
          const nextBody = syncPageLinkTitle(parentPost.body, saved.id, saved.title, saved.slug);
          if (nextBody) {
            await api.updatePost(parentPost.id, {
              title: parentPost.title,
              slug: parentPost.slug,
              type: parentPost.type,
              pageKind: "article",
              parentId: parentPost.parentId,
              summary: parentPost.summary,
              coverUrl: parentPost.coverUrl,
              props: parentPost.props,
              body: nextBody,
              draft: parentPost.draft,
            });
          }
        } catch {
          /* ignore */
        }
      }

      setPost(saved);
      setDraft(saved.draft);
      setTags(saved.tags ?? []);
      setSlug(saved.slug);
      setTitle(saved.title);
      previewTreeTitleRef.current(saved.id, saved.title);
      setPendingLinkIds([]);
      setSaveHint("saved");
      onSavedRef.current?.(saved);
    } catch (err) {
      if (seq !== saveSeqRef.current) {
        return;
      }
      setError(err instanceof Error ? err.message : "保存失败");
      setSaveHint("error");
    } finally {
      if (seq === saveSeqRef.current) {
        setSaving(false);
      }
    }
  }, []);

  const scheduleAutosave = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_MS);
  }, [persist]);

  useEffect(() => {
    if (!id) {
      return;
    }
    let alive = true;
    window.clearTimeout(autosaveTimerRef.current);
    saveSeqRef.current += 1;
    setLoaded(false);
    setEditorReady(false);
    setError("");
    setSaveHint("idle");
    setPendingLinkIds([]);
    setEditorEpoch(0);
    void api
      .getById(id)
      .then((data) => {
        if (!alive) {
          return;
        }
        const p = data.post;
        setPost(p);
        setTitle(p.title);
        setSlug(p.slug);
        setDraft(p.draft);
        setTags(p.tags ?? []);
        previewTreeTitleRef.current(p.id, p.title);
        if (p.pageKind === "about") {
          setAvatar(typeof p.props.avatar === "string" ? p.props.avatar : DEFAULT_ABOUT.avatar);
          const rawSkills = p.props.skills;
          if (Array.isArray(rawSkills)) {
            setSkills(
              rawSkills.flatMap((item) => {
                if (!item || typeof item !== "object") {
                  return [];
                }
                const row = item as { name?: unknown; color?: unknown };
                if (typeof row.name !== "string" || typeof row.color !== "string") {
                  return [];
                }
                if (!isSiteSkillColor(row.color)) {
                  return [];
                }
                return [{ name: row.name.trim(), color: row.color }];
              }),
            );
          } else {
            setSkills(DEFAULT_ABOUT.skills);
          }
          setInitial(p.body?.blocks?.length ? p.body : emptyEditorDocument());
        } else if (p.pageKind === "article") {
          const named = p.title.trim() && p.title !== "无标题" && p.title !== "未命名";
          setInitial(named ? ensureTitleHeader(p.body, p.title) : p.body?.blocks?.length ? p.body : emptyEditorDocument());
        } else {
          setInitial(p.body?.blocks?.length ? p.body : emptyEditorDocument());
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (!alive) {
          return;
        }
        setError(err instanceof Error ? err.message : "加载失败");
        setLoaded(true);
      });
    return () => {
      alive = false;
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [id]);

  if (!loaded) {
    return <p className="px-6 py-10 text-sm text-muted-foreground">加载中…</p>;
  }

  if (!post) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-destructive">{error || "页面不存在"}</p>
        <Button className="mt-4" variant="outline" onClick={() => navigate("/admin")}>
          回工作区
        </Button>
      </div>
    );
  }

  const kind = post.pageKind;
  const showEditor = kind === "article" || kind === "about";
  const showAi = kind === "article" || kind === "about";
  const needsNameField = kind === "about";
  const titlePlaceholder = "关于标题";
  const crumbs = kind === "article" ? ancestorsOf(post.id, pages) : [];
  const childPages = pages.filter((p) => p.pageKind === "article" && p.parentId === post.id);
  const linkedChildIds = new Set([
    ...(post.body.blocks ?? [])
      .filter((block) => block.type === "pageLink")
      .map((block) => String((block.data as { pageId?: string }).pageId ?? ""))
      .filter(Boolean),
    ...pendingLinkIds,
  ]);
  const looseChildren = childPages.filter((child) => !linkedChildIds.has(child.id));

  const onPickAvatar = async (file: File) => {
    setUploading(true);
    setError("");
    try {
      const { url } = await api.upload(file);
      setAvatar(url);
      liveRef.current.avatar = url;
      scheduleAutosave();
    } catch {
      setError("头像没传上去，再试一次。");
    } finally {
      setUploading(false);
    }
  };

  const addSkill = () => {
    const name = skillName.trim();
    if (!name) {
      return;
    }
    const next = [...skills, { name, color: skillColor }].slice(0, 12);
    setSkills(next);
    liveRef.current.skills = next;
    setSkillName("");
    scheduleAutosave();
  };

  const removeSkill = (index: number) => {
    const next = skills.filter((_, i) => i !== index);
    setSkills(next);
    liveRef.current.skills = next;
    scheduleAutosave();
  };

  /** / 插入「子页面」块：建子页，块本身就是入口 */
  const createChildForLinkBlock = async (): Promise<PageLinkData> => {
    if (!post || post.pageKind !== "article") {
      throw new Error("只有文章可以建子页面");
    }
    window.clearTimeout(autosaveTimerRef.current);
    await persist();
    const { post: child } = await api.createPost({
      title: "无标题",
      type: post.type,
      pageKind: "article",
      parentId: post.id,
      summary: "",
      coverUrl: "",
      body: emptyEditorDocument(),
      draft: false,
    });
    setPendingLinkIds((prev) => (prev.includes(child.id) ? prev : [...prev, child.id]));
    onSaved?.(child);
    return {
      pageId: child.id,
      slug: child.slug,
      title: child.title?.trim() || "无标题",
    };
  };

  /** 工具栏：写入子页入口块并打开子页 */
  const createChildAndOpen = async () => {
    if (!post || post.pageKind !== "article") {
      return;
    }
    window.clearTimeout(autosaveTimerRef.current);
    setSaving(true);
    setError("");
    try {
      let body = post.body;
      try {
        body = await saveEditor(editorRef.current);
      } catch {
        /* 用已有 body */
      }
      const meta = metaFromEditorDocument(body, {
        title: post.title !== "无标题" && post.title !== "未命名" ? post.title : undefined,
        summary: post.summary,
        coverUrl: post.coverUrl,
      });
      const { post: child } = await api.createPost({
        title: "无标题",
        type: post.type,
        pageKind: "article",
        parentId: post.id,
        summary: "",
        coverUrl: "",
        body: emptyEditorDocument(),
        draft: false,
      });
      const { post: saved } = await api.updatePost(post.id, {
        title: meta.title,
        slug: slug.trim() || undefined,
        type: post.type,
        pageKind: "article",
        parentId: post.parentId,
        summary: meta.summary,
        coverUrl: meta.coverUrl,
        props: post.props,
        body: appendPageLink(body, child),
        draft: post.parentId ? false : draft,
      });
      setPost(saved);
      setTitle(saved.title);
      onSaved?.(saved);
      navigate(`/admin/p/${child.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建子页面失败");
    } finally {
      setSaving(false);
    }
  };

  const statusLabel =
    saveHint === "saving" || saving
      ? "保存中…"
      : saveHint === "saved"
        ? "已保存"
        : saveHint === "error"
          ? null
          : null;

  return (
    <div className="workspace-editor flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/70 px-5 py-3">
        <div className="mr-auto min-w-0 flex-1 space-y-2">
          {kind === "article" ? (
            <div className="space-y-1.5">
              {crumbs.length > 0 ? (
                <nav className="workspace-crumbs flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="面包屑">
                  {crumbs.map((crumb, index) => (
                    <span key={crumb.id} className="inline-flex items-center gap-1">
                      {index > 0 ? <span aria-hidden>/</span> : null}
                      <button
                        type="button"
                        className="workspace-crumb-link max-w-[10rem] truncate hover:text-foreground"
                        onClick={() => navigate(`/admin/p/${crumb.id}`)}
                      >
                        {pageTitle(crumb)}
                      </button>
                    </span>
                  ))}
                  <span aria-hidden>/</span>
                  <span className="max-w-[10rem] truncate font-medium text-foreground">{pageTitle({ title })}</span>
                </nav>
              ) : (
                <p className="text-xs text-muted-foreground">
                  输入 / 选「子页面」或「写作助手」——正文会自动保存
                </p>
              )}
            </div>
          ) : needsNameField ? (
            <div className="flex max-w-xl flex-col gap-1.5">
              <Label htmlFor="page-title" className="text-xs text-muted-foreground">
                {titlePlaceholder}
              </Label>
              <Input
                id="page-title"
                value={title}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setTitle(next);
                  liveRef.current.title = next;
                  previewTreeTitle(post.id, next.trim() || "关于");
                  scheduleAutosave();
                }}
                className="h-9"
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">页面</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {kind === "article" && !post.parentId ? (
            draft ? (
              <Button
                type="button"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setPublishMode("publish");
                  setPublishOpen(true);
                }}
              >
                发布
              </Button>
            ) : (
              <>
                <span className="text-xs text-muted-foreground">已发布</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setPublishMode("edit");
                    setPublishOpen(true);
                  }}
                >
                  标签{tags.length ? ` · ${tags.length}` : ""}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setDraft(true);
                    liveRef.current.draft = true;
                    window.clearTimeout(autosaveTimerRef.current);
                    void persist({ draft: true });
                  }}
                >
                  撤回草稿
                </Button>
              </>
            )
          ) : null}
          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}
          {statusLabel ? <p className="text-sm text-muted-foreground">{statusLabel}</p> : null}
          {kind === "article" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={() => void createChildAndOpen()}
            >
              <Notes {...iconParkOutline} size={14} className="mr-1" />
              子页面
            </Button>
          ) : null}
        </div>
      </div>

      {kind === "about" ? (
        <div className="shrink-0 space-y-4 border-b border-border/60 px-5 py-4">
          <div className="flex flex-wrap items-start gap-4">
            <div
              className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-border bg-muted"
              aria-hidden
            >
              <AboutAvatar value={avatar} iconSize={28} className="size-full object-cover" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <FilePick
                compact
                label={uploading ? "上传中…" : "上传头像"}
                hint="jpg / png / webp"
                accept="image/*"
                onFile={(file) => void onPickAvatar(file)}
              />
              <Input
                value={avatar}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setAvatar(next);
                  liveRef.current.avatar = next;
                  scheduleAutosave();
                }}
                placeholder="或填写图片地址"
              />
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">标签</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {skills.map((skill, index) => (
                <button
                  key={`${skill.name}-${index}`}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs"
                  onClick={() => removeSkill(index)}
                >
                  {skill.name}
                  <Close {...iconParkOutline} size={12} aria-hidden />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                value={skillName}
                onChange={(e) => setSkillName(e.currentTarget.value)}
                placeholder="新标签"
                className="h-8 max-w-[160px]"
              />
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-sm"
                value={skillColor}
                onChange={(e) => setSkillColor(e.currentTarget.value as SiteSkillColor)}
              >
                {SITE_SKILL_COLORS.map((color) => (
                  <option key={color} value={color}>
                    {color}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="outline" onClick={addSkill}>
                加上
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        {showEditor ? (
          <SoftScrollbar
            className="write-paper min-h-0 min-w-0 flex-1 bg-background"
            contentClassName="workspace-doc-body px-4 pb-10 pt-5 sm:px-6"
          >
            <NotionEditor
              key={`${post.id}:${editorEpoch}`}
              initial={initial}
              pageLink={
                kind === "article"
                  ? {
                      onOpen: (page) => navigate(`/admin/p/${page.pageId}`),
                      createChild: () => createChildForLinkBlock(),
                    }
                  : undefined
              }
              aiAssist={
                showAi
                  ? {
                      onInvoke: ({ blockIndex }) => {
                        setInlineAi({ insertIndex: blockIndex });
                      },
                    }
                  : undefined
              }
              onChange={(document) => {
                if (kind === "article") {
                  const meta = metaFromEditorDocument(document, {
                    title: post.title !== "无标题" && post.title !== "未命名" ? post.title : undefined,
                  });
                  setTitle(meta.title);
                  liveRef.current.title = meta.title;
                  previewTreeTitle(post.id, meta.title);
                }
                scheduleAutosave();
              }}
              onReady={(instance) => {
                editorRef.current = instance;
                setEditorReady(true);
              }}
            />
            {kind === "article" && looseChildren.length > 0 ? (
              <section className="workspace-child-pages mt-8 border-t border-border/70 pt-5" aria-label="未出现在正文的子页面">
                <p className="mb-3 text-xs text-muted-foreground">这些子页面还没在正文里（例如旧数据）</p>
                <ul className="space-y-2">
                  {looseChildren.map((child) => (
                    <li key={child.id}>
                      <button
                        type="button"
                        className="cdx-page-link is-clickable w-full text-left"
                        onClick={() => navigate(`/admin/p/${child.id}`)}
                      >
                        <span className="cdx-page-link__icon" aria-hidden>
                          <PageLinkIcon size={16} />
                        </span>
                        <span className="cdx-page-link__title">{pageTitle(child)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </SoftScrollbar>
        ) : null}
        {showAi && inlineAi && editorReady ? (
          <InlineAiAssist
            editor={editorRef.current}
            insertIndex={inlineAi.insertIndex}
            onClose={() => setInlineAi(null)}
            onAccepted={() => {
              setInlineAi(null);
              scheduleAutosave();
            }}
          />
        ) : null}
      </div>

      {kind === "article" && !post.parentId ? (
        <PublishDialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          initialTags={tags}
          mode={publishMode}
          busy={saving}
          onConfirm={async (nextTags) => {
            setTags(nextTags);
            liveRef.current.tags = nextTags;
            liveRef.current.draft = false;
            setDraft(false);
            window.clearTimeout(autosaveTimerRef.current);
            await persist({ draft: false, tags: nextTags });
          }}
        />
      ) : null}
    </div>
  );
}
