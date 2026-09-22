import {
  DEFAULT_ABOUT,
  emptyEditorDocument,
  type EditorJsDocument,
  type Post,
  type SiteSkill,
  type UpsertPostInput,
} from "@myblog/shared";
import type EditorJS from "@editorjs/editorjs";
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { saveEditor } from "@/content";
import { api } from "@/lib/api";
import { metaFromEditorDocument } from "@/lib/editorMeta";
import { syncPageLinkTitle } from "@/lib/pageLinks";
import { registerWorkspaceSaveGate } from "@/workspace/saveGate";

const AUTOSAVE_MS = 900;

export type PageLiveSnap = {
  post: Post | null;
  title: string;
  slug: string;
  draft: boolean;
  tags: string[];
  avatar: string;
  skills: SiteSkill[];
};

type PersistOpts = { draft?: boolean; tags?: string[] };

type Args = {
  liveRef: MutableRefObject<PageLiveSnap>;
  editorRef: MutableRefObject<EditorJS | null>;
  editorReadyRef: MutableRefObject<boolean>;
  draftBodyRef: MutableRefObject<EditorJsDocument | null>;
  previewTreeTitle: (pageId: string, title: string) => void;
  onSaved?: (post: Post) => void;
  setPost: Dispatch<SetStateAction<Post | null>>;
  setDraft: Dispatch<SetStateAction<boolean>>;
  setTags: Dispatch<SetStateAction<string[]>>;
  setSlug: Dispatch<SetStateAction<string>>;
  setTitle: Dispatch<SetStateAction<string>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setSaveHint: Dispatch<SetStateAction<"idle" | "saving" | "saved" | "error">>;
  setError: Dispatch<SetStateAction<string>>;
  setPendingLinkIds: Dispatch<SetStateAction<string[]>>;
};

/** 工作区自动保存：队列、序号作废、草稿 body 复用 */
export function usePagePersist({
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
}: Args) {
  const autosaveTimerRef = useRef(0);
  const saveSeqRef = useRef(0);
  const persistChainRef = useRef(Promise.resolve());
  const previewTreeTitleRef = useRef(previewTreeTitle);
  previewTreeTitleRef.current = previewTreeTitle;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const persist = useCallback(async (opts?: PersistOpts) => {
    const run = async () => {
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
        if (showEditor && editorReadyRef.current) {
          if (draftBodyRef.current) {
            body = draftBodyRef.current;
          } else if (editorRef.current) {
            try {
              body = await saveEditor(editorRef.current);
              draftBodyRef.current = body;
            } catch {
              body = current.body;
            }
          }
        }

        if (seq !== saveSeqRef.current) {
          return;
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
            draft: current.parentId ? false : asDraft,
          };
        }

        if (seq !== saveSeqRef.current) {
          return;
        }

        const { post: saved } = await api.updatePost(current.id, payload);
        if (seq !== saveSeqRef.current) {
          return;
        }
        // 切页后旧请求不得写回当前编辑器状态
        if (liveRef.current.post?.id !== saved.id) {
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

        if (seq !== saveSeqRef.current) {
          return;
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
    };

    const next = persistChainRef.current.then(run, run);
    persistChainRef.current = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }, [
    draftBodyRef,
    editorReadyRef,
    editorRef,
    liveRef,
    setDraft,
    setError,
    setPendingLinkIds,
    setPost,
    setSaveHint,
    setSaving,
    setSlug,
    setTags,
    setTitle,
  ]);

  const suspendAutosave = useCallback(async () => {
    window.clearTimeout(autosaveTimerRef.current);
    saveSeqRef.current += 1;
    await persistChainRef.current;
  }, []);

  const scheduleAutosave = useCallback(() => {
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void persist();
    }, AUTOSAVE_MS);
  }, [persist]);

  useEffect(() => {
    registerWorkspaceSaveGate({ suspend: suspendAutosave });
    return () => registerWorkspaceSaveGate(null);
  }, [suspendAutosave]);

  useEffect(() => {
    return () => {
      window.clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  return {
    persist,
    scheduleAutosave,
    suspendAutosave,
    autosaveTimerRef,
    saveSeqRef,
  };
}
