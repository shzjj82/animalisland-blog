import {
  DEFAULT_ABOUT,
  emptyEditorDocument,
  isSiteSkillColor,
  type EditorJsDocument,
  type Post,
  type PostListItem,
  type SiteSkill,
} from "@myblog/shared";
import { Notes } from "@icon-park/react";
import EditorJS from "@editorjs/editorjs";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router-dom";
import { isAvatarUrl } from "@/components/AboutAvatar";
import { AboutSkillsDialog } from "@/components/AboutSkillsDialog";
import { SoftScrollbar } from "@/components/SoftScrollbar";
import type { PageLinkData } from "@/components/editor/PageLinkTool";
import { InlineAiAssist } from "@/components/InlineAiAssist";
import { PublishDialog } from "@/components/PublishDialog";
import { Button } from "@/components/ui/button";
import { NotionEditor, saveEditor } from "@/content";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { ensureTitleHeader, metaFromEditorDocument } from "@/lib/editorMeta";
import { appendPageLink } from "@/lib/pageLinks";
import { iconParkOutline } from "@/lib/iconPark";
import { ancestorsOf, pageTitle } from "@/lib/pageTree";
import { AboutEditorPanel } from "@/workspace/AboutEditorPanel";
import { LooseChildPages } from "@/workspace/LooseChildPages";
import { usePagePersist, type PageLiveSnap } from "@/workspace/usePagePersist";

type WorkspaceOutlet = {
  reloadTree: () => Promise<PostListItem[]>;
  pages: PostListItem[];
  previewTreeTitle: (pageId: string, title: string) => void;
};

type Props = {
  onSaved?: (post: Post) => void;
};

export function PageEditor({ onSaved }: Props) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pages, previewTreeTitle } = useOutletContext<WorkspaceOutlet>();
  const editorRef = useRef<EditorJS | null>(null);
  const editorReadyRef = useRef(false);
  const draftBodyRef = useRef<EditorJsDocument | null>(null);

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
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [initial, setInitial] = useState(emptyEditorDocument());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pendingLinkIds, setPendingLinkIds] = useState<string[]>([]);
  const [editorEpoch, setEditorEpoch] = useState(0);

  const liveRef = useRef<PageLiveSnap>({
    post: null,
    title: "",
    slug: "",
    draft: true,
    tags: [],
    avatar: DEFAULT_ABOUT.avatar,
    skills: DEFAULT_ABOUT.skills,
  });
  liveRef.current = { post, title, slug, draft, tags, avatar, skills };

  const { persist, scheduleAutosave, suspendAutosave, autosaveTimerRef, saveSeqRef } = usePagePersist({
    liveRef,
    editorRef,
    editorReadyRef,
    draftBodyRef,
    previewTreeTitle,
    onSaved,
    setPost,
    setDraft,
    setTags,
    setSlug,
    setTitle,
    setSaving,
    setSaveHint,
    setError,
    setPendingLinkIds,
  });

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
    editorReadyRef.current = false;
    draftBodyRef.current = null;
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
        previewTreeTitle(p.id, p.title);
        if (p.pageKind === "about") {
          const rawAvatar = typeof p.props.avatar === "string" ? p.props.avatar : DEFAULT_ABOUT.avatar;
          setAvatar(isAvatarUrl(rawAvatar) ? rawAvatar.trim() : "");
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
      editorReadyRef.current = false;
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, [id, autosaveTimerRef, previewTreeTitle, saveSeqRef]);

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

  const createChildForLinkBlock = async (): Promise<PageLinkData> => {
    if (post.pageKind !== "article") {
      throw new Error("只有文章可以建子页面");
    }
    await suspendAutosave();
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

  const createChildAndOpen = async () => {
    if (post.pageKind !== "article") {
      return;
    }
    await suspendAutosave();
    setSaving(true);
    setError("");
    try {
      let body = draftBodyRef.current ?? post.body;
      try {
        body = await saveEditor(editorRef.current);
        draftBodyRef.current = body;
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
      draftBodyRef.current = saved.body;
      onSaved?.(saved);
      navigate(`/admin/p/${child.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新建子页面失败");
    } finally {
      setSaving(false);
    }
  };

  const statusLabel =
    saveHint === "saving" || saving ? "保存中…" : saveHint === "saved" ? "已保存" : null;

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
          ) : kind === "about" ? (
            <div className="flex max-w-xl flex-col gap-1.5">
              <Label htmlFor="page-title" className="text-xs text-muted-foreground">
                首页署名
              </Label>
              <Input
                id="page-title"
                value={title}
                onChange={(e) => {
                  const next = e.currentTarget.value;
                  setTitle(next);
                  liveRef.current.title = next;
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
                  分类{tags.length ? ` · ${tags.length}` : ""}
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
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={() => void createChildAndOpen()}>
              <Notes {...iconParkOutline} size={14} className="mr-1" />
              子页面
            </Button>
          ) : null}
        </div>
      </div>

      {kind === "about" ? (
        <AboutEditorPanel
          avatar={avatar}
          skills={skills}
          uploading={uploading}
          onPickAvatar={(file) => void onPickAvatar(file)}
          onClearAvatar={() => {
            setAvatar("");
            liveRef.current.avatar = "";
            scheduleAutosave();
          }}
          onManageSkills={() => setSkillsOpen(true)}
        />
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
                showEditor
                  ? {
                      onInvoke: ({ blockIndex }) => {
                        setInlineAi({ insertIndex: blockIndex });
                      },
                    }
                  : undefined
              }
              onChange={(document) => {
                draftBodyRef.current = document;
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
                editorReadyRef.current = true;
                setEditorReady(true);
              }}
            />
            {kind === "article" ? (
              <LooseChildPages pages={looseChildren} onOpen={(pageId) => navigate(`/admin/p/${pageId}`)} />
            ) : null}
          </SoftScrollbar>
        ) : null}
        {showEditor && inlineAi && editorReady ? (
          <InlineAiAssist
            editor={editorRef.current}
            insertIndex={inlineAi.insertIndex}
            onClose={() => setInlineAi(null)}
            onAccepted={() => {
              setInlineAi(null);
              draftBodyRef.current = null;
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

      {kind === "about" ? (
        <AboutSkillsDialog
          open={skillsOpen}
          onOpenChange={setSkillsOpen}
          skills={skills}
          onSave={(next) => {
            setSkills(next);
            liveRef.current.skills = next;
            scheduleAutosave();
          }}
        />
      ) : null}
    </div>
  );
}
