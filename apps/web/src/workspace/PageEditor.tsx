"use client";

import {
  starterArticleDocument,
  type EditorJsDocument,
  type Post,
  type PostVisibility,
} from "@myblog/shared";
import { Notes } from "@icon-park/react";
import EditorJS from "@editorjs/editorjs";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { SoftScrollbar } from "@/components/SoftScrollbar";
import type { PageLinkData } from "@/components/editor/PageLinkTool";
import { EditorSpotlight, type SpotlightAction } from "@/components/EditorSpotlight";
import { SelectionAskChip } from "@/components/SelectionAskChip";
import { PublishDialog } from "@/components/PublishDialog";
import { Button } from "@/components/ui/button";
import { NotionEditor, saveEditor } from "@/content";
import { api } from "@/lib/api";
import { ensureTitleHeader, metaFromEditorDocument } from "@/lib/editorMeta";
import { appendPageLink, withLivePageLinkTitles } from "@/lib/pageLinks";
import { iconParkOutline } from "@/lib/iconPark";
import { ancestorsOf, pageTitle } from "@/lib/pageTree";
import { LooseChildPages } from "@/workspace/LooseChildPages";
import { usePagePersist, type PageLiveSnap } from "@/workspace/usePagePersist";
import { useWorkspace } from "@/workspace/WorkspaceLayout";

type Props = {
  onSaved?: (post: Post) => void;
};

export function PageEditor({ onSaved }: Props) {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const router = useRouter();
  const { pages, previewTreeTitle } = useWorkspace();
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const leaveSaveRef = useRef(Promise.resolve());
  const acceptEditRef = useRef(true);
  const editorRef = useRef<EditorJS | null>(null);
  const editorReadyRef = useRef(false);
  const draftBodyRef = useRef<EditorJsDocument | null>(null);

  const [editorReady, setEditorReady] = useState(false);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [spotlightLaunch, setSpotlightLaunch] = useState<{
    actionId?: string;
    insertIndex: number;
    selection?: string;
  } | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("private");
  const [tags, setTags] = useState<string[]>([]);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishMode, setPublishMode] = useState<"publish" | "edit">("publish");
  const [initial, setInitial] = useState(starterArticleDocument());
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveHint, setSaveHint] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [pendingLinkIds, setPendingLinkIds] = useState<string[]>([]);
  const [editorEpoch, setEditorEpoch] = useState(0);

  const liveRef = useRef<PageLiveSnap>({
    post: null,
    title: "",
    slug: "",
    visibility: "private",
    tags: [],
  });
  liveRef.current = { post, title, slug, visibility, tags };

  const { persist, scheduleAutosave, suspendAutosave, autosaveTimerRef } = usePagePersist({
    liveRef,
    editorRef,
    editorReadyRef,
    draftBodyRef,
    previewTreeTitle,
    onSaved,
    setPost,
    setVisibility,
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
    void (async () => {
      await leaveSaveRef.current;
      if (!alive) {
        return;
      }
      window.clearTimeout(autosaveTimerRef.current);
      setLoaded(false);
      setEditorReady(false);
      setError("");
      setSaveHint("idle");
      setPendingLinkIds([]);
      setEditorEpoch(0);
      setSpotlightLaunch(null);
      setSpotlightOpen(false);
      editorReadyRef.current = false;
      draftBodyRef.current = null;
      try {
        const data = await api.getById(id);
        if (!alive) {
          return;
        }
        acceptEditRef.current = true;
        const loaded = data.post;
        const body =
          loaded.pageKind === "article" ? withLivePageLinkTitles(loaded.body, pagesRef.current) : loaded.body;
        const p = body === loaded.body ? loaded : { ...loaded, body };
        setPost(p);
        setTitle(p.title);
        setSlug(p.slug);
        setVisibility(p.visibility ?? "private");
        setTags(p.tags ?? []);
        previewTreeTitle(p.id, p.title);
        if (p.pageKind === "article") {
          const named = p.title.trim() && p.title !== "无标题" && p.title !== "未命名";
          if (named) {
            setInitial(ensureTitleHeader(p.body, p.title));
          } else if (p.body?.blocks?.length) {
            setInitial(ensureTitleHeader(p.body, ""));
          } else {
            setInitial(starterArticleDocument());
          }
        } else {
          setInitial(p.body?.blocks?.length ? p.body : starterArticleDocument());
        }
        setLoaded(true);
        if (body !== loaded.body) {
          window.setTimeout(() => {
            if (liveRef.current.post?.id === p.id) {
              void persist();
            }
          }, 0);
        }
      } catch (err) {
        if (!alive) {
          return;
        }
        setError(err instanceof Error ? err.message : "加载失败");
        setLoaded(true);
      }
    })();
    return () => {
      alive = false;
      acceptEditRef.current = false;
      window.clearTimeout(autosaveTimerRef.current);
      const editor = editorRef.current;
      leaveSaveRef.current = (async () => {
        if (editor && editorReadyRef.current) {
          try {
            draftBodyRef.current = (await editor.save()) as EditorJsDocument;
          } catch {
            /* 用已有草稿 */
          }
        }
        await persist();
      })();
    };
  }, [id, autosaveTimerRef, previewTreeTitle, persist]);

  const resolveInsertIndex = (fallback?: number) => {
    if (typeof fallback === "number" && fallback >= 0) {
      return fallback;
    }
    if (editorRef.current) {
      try {
        const idx = editorRef.current.blocks.getCurrentBlockIndex();
        if (typeof idx === "number" && idx >= 0) {
          return idx;
        }
      } catch {
        /* ignore */
      }
    }
    return 0;
  };

  const openSpotlight = (opts?: { actionId?: string; insertIndex?: number; selection?: string }) => {
    setSpotlightLaunch({
      actionId: opts?.actionId,
      insertIndex: resolveInsertIndex(opts?.insertIndex),
      selection: opts?.selection,
    });
    setSpotlightOpen(true);
  };

  useEffect(() => {
    if (!loaded || !editorReady) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return;
      }
      event.preventDefault();
      if (spotlightOpen) {
        setSpotlightOpen(false);
        setSpotlightLaunch(null);
        return;
      }
      openSpotlight();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, editorReady, spotlightOpen]);

  if (!loaded) {
    return <p className="px-6 py-10 text-sm text-muted-foreground">加载中…</p>;
  }

  if (!post) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-destructive">{error || "页面不存在"}</p>
        <Button className="mt-4" variant="outline" onClick={() => router.push("/admin")}>
          回工作区
        </Button>
      </div>
    );
  }

  const kind = post.pageKind;
  const showEditor = kind === "article";
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
      body: starterArticleDocument(),
      visibility: "public",
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
        body: starterArticleDocument(),
        visibility: "public",
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
        visibility: post.parentId ? "public" : visibility,
      });
      setPost(saved);
      setTitle(saved.title);
      draftBodyRef.current = saved.body;
      onSaved?.(saved);
      router.push(`/admin/p/${child.id}`);
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
                        onClick={() => router.push(`/admin/p/${crumb.id}`)}
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
          ) : (
            <p className="text-xs text-muted-foreground">页面</p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {kind === "article" && !post.parentId ? (
            visibility === "private" ? (
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
                <span className="text-xs text-muted-foreground">公开</span>
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
                    setVisibility("private");
                    liveRef.current.visibility = "private";
                    window.clearTimeout(autosaveTimerRef.current);
                    void persist({ visibility: "private" });
                  }}
                >
                  设为私有
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

      <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
        {showEditor ? (
          <SoftScrollbar
            className="write-paper min-h-0 min-w-0 flex-1 bg-background"
            contentClassName="workspace-doc-body px-4 pb-10 pt-5 sm:px-6"
          >
            <NotionEditor
              key={`${post.id}:${editorEpoch}`}
              initial={initial}
              pageLink={{
                onOpen: (page) => router.push(`/admin/p/${page.pageId}`),
                createChild: () => createChildForLinkBlock(),
                resolveTitle: (pageId) => pagesRef.current.find((item) => item.id === pageId)?.title,
              }}
              aiAssist={{
                onInvoke: ({ blockIndex }) => {
                  openSpotlight({ actionId: "ai-chat", insertIndex: blockIndex });
                },
              }}
              onChange={(document) => {
                if (!acceptEditRef.current) {
                  return;
                }
                draftBodyRef.current = document;
                const meta = metaFromEditorDocument(document, {
                  title: post.title !== "无标题" && post.title !== "未命名" ? post.title : undefined,
                });
                setTitle(meta.title);
                liveRef.current.title = meta.title;
                previewTreeTitle(post.id, meta.title);
                scheduleAutosave();
              }}
              onReady={(instance) => {
                editorRef.current = instance;
                editorReadyRef.current = true;
                setEditorReady(true);
              }}
            />
            <LooseChildPages pages={looseChildren} onOpen={(pageId) => router.push(`/admin/p/${pageId}`)} />
          </SoftScrollbar>
        ) : null}
        {showEditor && editorReady ? (
          <SelectionAskChip
            disabled={spotlightOpen}
            onAsk={(text) => openSpotlight({ actionId: "ai-chat", selection: text })}
          />
        ) : null}
        {showEditor ? (
          <EditorSpotlight
            open={spotlightOpen}
            onOpenChange={(open) => {
              setSpotlightOpen(open);
              if (!open) {
                setSpotlightLaunch(null);
              }
            }}
            actions={
              [
                {
                  id: "ai-chat",
                  title: "智能 AI 聊天",
                  chip: "AI智能聊天",
                  subtitle: "对话后点选回答再写入正文 · 支持划词提问",
                  keywords: "ai 写作 助手 聊天 chat gpt 智能",
                  icon: "robot",
                },
              ] satisfies SpotlightAction[]
            }
            editor={editorRef.current}
            insertIndex={spotlightLaunch?.insertIndex ?? 0}
            launchActionId={spotlightLaunch?.actionId}
            selection={spotlightLaunch?.selection}
            onInserted={() => {
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
          initialVisibility={visibility}
          mode={publishMode}
          busy={saving}
          onConfirm={async (nextTags, nextVisibility) => {
            setTags(nextTags);
            liveRef.current.tags = nextTags;
            liveRef.current.visibility = nextVisibility;
            setVisibility(nextVisibility);
            window.clearTimeout(autosaveTimerRef.current);
            await persist({ visibility: nextVisibility, tags: nextTags });
          }}
        />
      ) : null}
    </div>
  );
}
