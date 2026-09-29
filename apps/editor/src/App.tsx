import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type EditorJS from "@editorjs/editorjs";
import { useTranslation } from "react-i18next";
import { CloudStorage, Delete, Download, Export, HardDisk, People, Plus, Search } from "@icon-park/react";
import type { EditorJsDocument } from "@myblog/shared";
import { BlockEditor } from "@/components/block-editor";
import type { PageLinkData } from "@/components/block-editor/tools/PageLinkTool";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { EditorSpotlight, type SpotlightAction } from "@/components/editor-spotlight";
import { EmptyState } from "@/components/empty-state";
import { FileTypeIcon } from "@/components/file-type-icon";
import { ImportDialog } from "@/components/import-dialog";
import { LanguageSwitch } from "@/components/language-switch";
import { PageTree } from "@/components/page-tree";
import { SettingsMenu } from "@/components/settings-menu";
import { SyncChecklistDialog, SyncSummaryDialog } from "@/components/sync-dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  createLocal,
  ensureLocalPages,
  listLocal,
  loadLocal,
  removeLocal,
  reparentLocal,
  saveLocal,
  titleFromBody,
  type EditorPage,
  type PageNode,
} from "@/store/localStore";
import {
  buildSyncPlan,
  pickSyncPlan,
  requiredSyncKeys,
  runSyncPlan,
  syncItems,
  syncPlanSize,
  type SyncPlan,
} from "@/store/localSync";
import {
  changePasswordRemote,
  clearSession,
  createRemote,
  listRemote,
  loadRemote,
  loadSession,
  loginRemote,
  registerRemote,
  removeRemote,
  reparentRemote,
  saveRemote,
  type RemoteSession,
} from "@/store/remoteStore";
import { readSyncSettings, writeSyncSettings, type SyncSettings } from "@/store/syncSettings";
import { pageTitle, setAppLocale, type AppLocale } from "@/i18n";
import { exportDocument, type ExportFormat } from "@/lib/document/export";
import { importWord, mergeImported, WORD_ACCEPT, type ImportedWord, type ImportMode } from "@/lib/document/import";
import { loadSearchDocs } from "@/lib/document/search";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const SIDEBAR_WIDTH_KEY = "editor:sidebar-width";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;

function readSidebarWidth(): number {
  const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  if (!Number.isFinite(raw)) {
    return 260;
  }
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw));
}

export function App() {
  const { t, i18n } = useTranslation();
  const [session, setSession] = useState<RemoteSession | null>(() => loadSession());
  const [nodes, setNodes] = useState<PageNode[]>([]);
  const [page, setPage] = useState<EditorPage | null>(null);
  const [hint, setHint] = useState("");
  const [error, setError] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const [query, setQuery] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [syncPlan, setSyncPlan] = useState<SyncPlan | null>(null);
  const [syncStep, setSyncStep] = useState<"summary" | "checklist" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [syncSettings, setSyncSettings] = useState<SyncSettings>(readSyncSettings);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [reveal, setReveal] = useState<{ text: string; nonce: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<ImportedWord | null>(null);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [spotlightLaunch, setSpotlightLaunch] = useState<{
    actionId?: string;
    insertIndex: number;
    selection?: string;
  } | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const editorRef = useRef<EditorJS | null>(null);
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;
  const saveTimer = useRef(0);
  const pageRef = useRef<EditorPage | null>(null);
  pageRef.current = page;
  const remote = session !== null;

  const refreshLocal = useCallback((selectId?: string | null) => {
    const list = listLocal();
    setNodes(list);
    const id = selectId === undefined ? (pageRef.current?.id ?? list[0]?.id) : (selectId ?? list[0]?.id);
    setPage(id ? (loadLocal(id) ?? null) : null);
  }, []);

  const refreshRemote = useCallback(async (nextSession: RemoteSession, selectId?: string | null) => {
    const list = await listRemote(nextSession);
    setNodes(list);
    const id = selectId === undefined ? (pageRef.current?.id ?? list[0]?.id) : (selectId ?? list[0]?.id);
    if (!id) {
      setPage(null);
      return;
    }
    setPage(await loadRemote(nextSession, id));
  }, []);

  const openSpotlight = useCallback((opts?: { actionId?: string; insertIndex?: number; selection?: string }) => {
    const editor = editorRef.current;
    let index = opts?.insertIndex;
    if (typeof index !== "number" || index < 0) {
      const current = editor?.blocks.getCurrentBlockIndex();
      index = typeof current === "number" && current >= 0 ? current : 0;
    }
    setSpotlightLaunch({
      actionId: opts?.actionId,
      insertIndex: index,
      selection: opts?.selection,
    });
    setSpotlightOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k" || event.isComposing) {
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
  }, [openSpotlight, spotlightOpen]);

  useEffect(() => {
    setError("");
    setHint("");
    setPage(null);
    setNodes([]);
    setSyncPlan(null);
    setSyncStep(null);
    setSyncError("");
    setDontAskAgain(false);
    if (!session) {
      ensureLocalPages();
      refreshLocal(null);
      return;
    }
    const settings = readSyncSettings();
    const plan = settings.enabled ? buildSyncPlan(session.username) : null;
    if (plan && syncPlanSize(plan) > 0) {
      setSyncPlan(plan);
      setSyncStep("summary");
    }
    void refreshRemote(session, null).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t("app.failedToLoadRemotePages"));
    });
  }, [session, refreshLocal, refreshRemote]);

  function updateSyncSettings(next: SyncSettings) {
    writeSyncSettings(next);
    setSyncSettings(next);
    if (!next.enabled) {
      setSyncStep(null);
      setSyncPlan(null);
      return;
    }
    if (session) {
      const plan = buildSyncPlan(session.username);
      setSyncPlan(syncPlanSize(plan) > 0 ? plan : null);
    }
  }

  function applyDontAskAgain() {
    if (dontAskAgain && syncSettings.enabled) {
      writeSyncSettings({ enabled: false });
      setSyncSettings({ enabled: false });
    }
  }

  function closeSync() {
    if (syncing) {
      return;
    }
    applyDontAskAgain();
    setSyncStep(null);
    setSyncError("");
  }

  function openChecklist() {
    if (!syncPlan) {
      return;
    }
    applyDontAskAgain();
    setPicked(new Set(syncItems(syncPlan).map((item) => item.key)));
    setSyncError("");
    setSyncStep("checklist");
  }

  function togglePicked(key: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  async function confirmSync() {
    if (!session || !syncPlan) {
      return;
    }
    const chosen = pickSyncPlan(syncPlan, picked);
    if (syncPlanSize(chosen) === 0) {
      return;
    }
    setSyncing(true);
    setSyncError("");
    try {
      await runSyncPlan(session, chosen);
      const rest = buildSyncPlan(session.username);
      setSyncPlan(syncPlanSize(rest) > 0 ? rest : null);
      setSyncStep(null);
      setHint(t("app.syncedItems", { count: syncPlanSize(chosen) }));
      await refreshRemote(session, null);
    } catch (err) {
      const rest = buildSyncPlan(session.username);
      setSyncPlan(syncPlanSize(rest) > 0 ? rest : null);
      if (syncPlanSize(rest) === 0) {
        setSyncStep(null);
      }
      setSyncError(err instanceof Error ? err.message : t("app.syncFailed"));
    } finally {
      setSyncing(false);
    }
  }

  function resetAuthFields() {
    setPassword("");
    setConfirm("");
    setNickname("");
    setError("");
  }

  function logout() {
    clearSession();
    setSession(null);
    setAuthOpen(false);
    resetAuthFields();
  }

  async function exportPage(id: string, format: ExportFormat) {
    setError("");
    try {
      let body: EditorJsDocument | undefined;
      if (page?.id === id && editorRef.current) {
        body = (await editorRef.current.save()) as EditorJsDocument;
      } else if (session) {
        body = (await loadRemote(session, id)).body;
      } else {
        body = loadLocal(id)?.body;
      }
      if (!body) {
        throw new Error(t("app.pageNotFound"));
      }
      exportDocument(format, titleFromBody(body), body);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.exportFailed"));
    }
  }

  async function revealPage(id: string, query: string) {
    if (pageRef.current?.id !== id) {
      await openPage(id);
    }
    setReveal({ text: query, nonce: Date.now() });
  }

  async function openPage(id: string) {
    setError("");
    setReveal(null);
    if (!session) {
      setPage(loadLocal(id) ?? null);
      return;
    }
    setPage(await loadRemote(session, id));
  }

  async function createChildLink(): Promise<PageLinkData> {
    const parentId = pageRef.current?.id ?? null;
    if (!session) {
      const created = createLocal(parentId);
      setNodes(listLocal());
      return { pageId: created.id, slug: created.id, title: created.title };
    }
    const created = await createRemote(session, parentId);
    setNodes(await listRemote(session));
    return { pageId: created.id, slug: created.id, title: created.title };
  }

  /** 在父页面正文末尾补一个子页面链接；父页面正打开时先取编辑器里未保存的内容 */
  async function appendChildLink(parentId: string, link: PageLinkData) {
    const current = pageRef.current?.id === parentId ? pageRef.current : null;
    let body: EditorJsDocument | undefined;
    if (current && editorRef.current) {
      window.clearTimeout(saveTimer.current);
      body = (await editorRef.current.save()) as EditorJsDocument;
    }
    const block = { type: "pageLink", data: link };
    if (!session) {
      const parent = current ?? loadLocal(parentId);
      if (parent) {
        saveLocal({ ...parent, body: { ...(body ?? parent.body), blocks: [...(body ?? parent.body).blocks, block] } });
      }
      return;
    }
    const parent = current ?? (await loadRemote(session, parentId));
    await saveRemote(session, { ...parent, body: { ...(body ?? parent.body), blocks: [...(body ?? parent.body).blocks, block] } });
  }

  async function createPage(parentId: string | null) {
    setError("");
    try {
      const created = session ? await createRemote(session, parentId) : createLocal(parentId);
      if (parentId) {
        await appendChildLink(parentId, { pageId: created.id, slug: created.id, title: created.title });
      }
      if (session) {
        await refreshRemote(session, created.id);
      } else {
        refreshLocal(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.failedToCreatePage"));
    }
  }

  async function readImport(file: File) {
    setError("");
    try {
      setPendingImport(await importWord(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.importFailed"));
    }
  }

  async function applyImport(mode: ImportMode) {
    const current = pageRef.current;
    if (!pendingImport || !current) {
      return;
    }
    const body = editorRef.current ? ((await editorRef.current.save()) as EditorJsDocument) : current.body;
    onEdit(mergeImported(mode, body, pendingImport));
    setEditorEpoch((value) => value + 1);
    setPendingImport(null);
  }

  function onEdit(body: EditorJsDocument) {
    const current = pageRef.current;
    if (!current) {
      return;
    }
    const next = { ...current, body, title: titleFromBody(body) };
    setPage(next);
    setNodes((prev) => prev.map((node) => (node.id === next.id ? { ...node, title: next.title } : node)));
    window.clearTimeout(saveTimer.current);
    setHint(t("app.saving"));
    saveTimer.current = window.setTimeout(() => void persist(next), 700);
  }

  async function persist(next: EditorPage): Promise<boolean> {
    try {
      if (!session) {
        const saved = saveLocal(next);
        setPage(saved);
        setNodes(listLocal());
      } else {
        const saved = await saveRemote(session, next);
        setPage(saved);
        setNodes(await listRemote(session));
      }
      setHint(t("app.saved"));
      setError("");
      return true;
    } catch (err) {
      setHint("");
      setError(err instanceof Error ? err.message : t("app.failedToSave"));
      return false;
    }
  }

  /** 编辑器会按新语言重建，先把编辑器里的最新内容存下来 */
  async function switchLocale(locale: AppLocale) {
    const current = pageRef.current;
    if (current && editorRef.current) {
      window.clearTimeout(saveTimer.current);
      const body = (await editorRef.current.save()) as EditorJsDocument;
      if (!(await persist({ ...current, body, title: titleFromBody(body) }))) {
        return;
      }
    }
    await setAppLocale(locale);
    setHint("");
    setError("");
  }

  function descendantIds(rootId: string): string[] {
    const drop = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const node of nodes) {
        if (node.parentId && drop.has(node.parentId) && !drop.has(node.id)) {
          drop.add(node.id);
          grew = true;
        }
      }
    }
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const depthOf = (id: string) => {
      let depth = 0;
      let current = byId.get(id);
      const seen = new Set<string>();
      while (current?.parentId && !seen.has(current.id)) {
        seen.add(current.id);
        depth += 1;
        current = byId.get(current.parentId);
      }
      return depth;
    };
    return [...drop].sort((a, b) => depthOf(b) - depthOf(a));
  }

  async function movePage(id: string, parentId: string | null) {
    const currentId = pageRef.current?.id ?? null;
    const source = nodes.find((node) => node.id === id);
    const touched = new Set([id, parentId, source?.parentId ?? null]);
    setError("");
    try {
      if (!session) {
        reparentLocal(id, parentId);
        if (currentId && currentId !== id && touched.has(currentId)) {
          setEditorEpoch((value) => value + 1);
        }
        refreshLocal(currentId);
        return;
      }
      await reparentRemote(session, id, parentId);
      if (currentId && currentId !== id && touched.has(currentId)) {
        setEditorEpoch((value) => value + 1);
      }
      await refreshRemote(session, currentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.failedToMovePage"));
    }
  }

  function removePage(id: string) {
    setPendingDeleteId(id);
  }

  async function confirmRemove() {
    const id = pendingDeleteId;
    if (!id) {
      return;
    }
    setPendingDeleteId(null);
    setError("");
    try {
      if (!session) {
        removeLocal(id);
        setPage(null);
        refreshLocal(null);
        return;
      }
      for (const targetId of descendantIds(id)) {
        await removeRemote(session, targetId);
      }
      setPage(null);
      await refreshRemote(session, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.failedToDelete"));
    }
  }

  async function submitAuth() {
    const user = username.trim();
    if (!user || !password) {
      setError(t("app.credentialsRequired"));
      return;
    }
    if (joining && password !== confirm) {
      setError(t("app.passwordsMismatch"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const next = joining
        ? await registerRemote(user, password, nickname.trim() || undefined)
        : await loginRemote(user, password);
      resetAuthFields();
      setUsername("");
      setAuthOpen(false);
      setSession(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : joining ? t("common.signUpFailed") : t("common.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (authOpen && !session) {
    return (
      <div className="relative flex min-h-svh items-center justify-center bg-muted p-6">
        <div className="absolute top-3 right-6">
          <LanguageSwitch onChange={(locale) => void switchLocale(locale)} />
        </div>
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <img src="/logo.png" alt="" className="size-7 rounded-md" />
              {joining ? t("app.signUp") : t("app.logIn")}
            </CardTitle>
            <CardDescription>
              {joining ? t("app.signUpHint") : t("app.loginHint")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submitAuth();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="username">{t("app.username")}</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder={t("app.usernameHint")}
                />
              </div>
              {joining ? (
                <div className="grid gap-2">
                  <Label htmlFor="nickname">{t("app.nicknameOptional")}</Label>
                  <Input
                    id="nickname"
                    value={nickname}
                    onChange={(event) => setNickname(event.target.value)}
                    autoComplete="nickname"
                    placeholder={t("app.defaultsToYourUsername")}
                  />
                </div>
              ) : null}
              <div className="grid gap-2">
                <Label htmlFor="password">{t("app.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={joining ? "new-password" : "current-password"}
                  placeholder={joining ? t("common.atLeast6Characters") : undefined}
                />
              </div>
              {joining ? (
                <div className="grid gap-2">
                  <Label htmlFor="confirm">{t("app.confirmPassword")}</Label>
                  <Input
                    id="confirm"
                    type="password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy
                  ? joining
                    ? t("app.signingUp")
                    : t("app.loggingIn")
                  : joining
                    ? t("app.signUp")
                    : t("app.logIn")}
              </Button>
            </form>
            <Button
              type="button"
              variant="ghost"
              className="mt-2 w-full"
              onClick={() => {
                setJoining((value) => !value);
                setError("");
              }}
            >
              {joining ? t("app.haveAnAccountLogIn") : t("app.noAccountSignUp")}
            </Button>
            <Button
              type="button"
              variant="link"
              className="w-full"
              onClick={() => {
                setAuthOpen(false);
                resetAuthFields();
              }}
            >
              {t("app.keepEditingLocally")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function startSidebarResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidthRef.current;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (ev: PointerEvent) => {
      const next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + ev.clientX - startX));
      sidebarWidthRef.current = next;
      setSidebarWidth(next);
    };
    const stop = (ev: PointerEvent) => {
      if (target.hasPointerCapture(ev.pointerId)) {
        target.releasePointerCapture(ev.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidthRef.current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  return (
    <div
      className="grid h-svh overflow-hidden bg-background"
      style={{ gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)` }}
    >
      <aside className="relative flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar px-3 py-4 text-sidebar-foreground">
        <div className="mb-3 flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search
              {...iconProps}
              size={14}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("app.search")}
              aria-label={t("app.search")}
              className="h-8 bg-background pl-7"
            />
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label={t("common.newPage")} onClick={() => void createPage(null)}>
            <Plus {...iconProps} />
          </Button>
        </div>
        <PageTree
          nodes={nodes}
          query={query}
          selectedId={page?.id}
          onOpen={(id) => void openPage(id)}
          onCreateChild={(parentId) => void createPage(parentId)}
          onDelete={(id) => void removePage(id)}
          onReparent={(id, parentId) => void movePage(id, parentId)}
          onExport={(id, format) => void exportPage(id, format)}
        />
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-sidebar-border px-1 pt-3 text-xs text-muted-foreground">
          {session ? (
            <span className="min-w-0 flex-1 truncate px-2">{session.username}</span>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => setAuthOpen(true)}>
              <People {...iconProps} />
              {t("app.logIn")}
            </Button>
          )}
          <SettingsMenu
            settings={syncSettings}
            onChange={updateSyncSettings}
            loggedIn={Boolean(session)}
            onLogout={logout}
            onChangePassword={() => setPasswordOpen(true)}
          />
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("app.resizeSidebar")}
          className="absolute top-0 -right-1 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-foreground/15"
          onPointerDown={startSidebarResize}
        />
      </aside>
      <main className="flex h-full min-h-0 min-w-0 flex-col bg-background">
        <header className="flex shrink-0 items-center justify-between gap-4 px-6 pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              {remote ? <CloudStorage {...iconProps} size={14} /> : <HardDisk {...iconProps} size={14} />}
              {remote ? t("app.remote") : t("app.local")}
            </span>
            <span className={error ? "text-destructive" : undefined}>{error || hint}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            {session && syncSettings.enabled && syncPlan && !syncStep ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setSyncStep("summary")}>
                <CloudStorage {...iconProps} />
                {t("common.syncLocalPages")} · {syncPlanSize(syncPlan)}
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" disabled={!page} onClick={() => importInputRef.current?.click()}>
              <Download {...iconProps} />
              {t("common.import")}
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept={WORD_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) {
                  void readImport(file);
                }
              }}
            />
            <Popover open={exportOpen} onOpenChange={setExportOpen}>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={!page}>
                  <Export {...iconProps} />
                  {t("app.export")}
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                {(["pdf", "word"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
                    onClick={() => {
                      setExportOpen(false);
                      if (page) {
                        void exportPage(page.id, format);
                      }
                    }}
                  >
                    <FileTypeIcon type={format} />
                    {format === "pdf" ? t("common.exportPdf") : t("common.exportWord")}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
            <Button type="button" variant="outline" size="sm" disabled={!page} onClick={() => page && void removePage(page.id)}>
              <Delete {...iconProps} />
              {t("common.delete")}
            </Button>
            <LanguageSwitch onChange={(locale) => void switchLocale(locale)} />
          </span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">
          {page ? (
            <BlockEditor
              key={`${remote ? "remote" : "local"}:${page.id}:${editorEpoch}:${i18n.language}`}
              doc={page.body}
              onChange={onEdit}
              onOpenPage={(id) => void openPage(id)}
              onCreateChild={createChildLink}
              onReady={(editor) => {
                editorRef.current = editor;
                setEditorReady(Boolean(editor));
              }}
              onAi={(index) => openSpotlight({ actionId: "ai-chat", insertIndex: index })}
              onAskSelection={(text) => openSpotlight({ actionId: "ai-chat", selection: text })}
              reveal={reveal}
            />
          ) : (
            <EmptyState hasPages={nodes.length > 0} onCreate={() => void createPage(null)} />
          )}
        </div>
      </main>
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
              title: t("app.aiChatTitle"),
              chip: t("app.aiChatChip"),
              subtitle: t("app.aiChatSubtitle"),
              keywords: "ai 写作 助手 聊天 chat gpt 智能 bubble",
              icon: "robot",
            },
          ] satisfies SpotlightAction[]
        }
        editor={editorReady ? editorRef.current : null}
        insertIndex={spotlightLaunch?.insertIndex ?? 0}
        launchActionId={spotlightLaunch?.actionId}
        selection={spotlightLaunch?.selection}
        loadPages={() => loadSearchDocs(session, nodes)}
        onOpenPage={(id, query) => void revealPage(id, query)}
      />
      <Dialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("app.deletePage")}</DialogTitle>
            <DialogDescription>
              {(() => {
                const title = pageTitle(nodes.find((node) => node.id === pendingDeleteId)?.title);
                return t("app.deletePageConfirm", { title });
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPendingDeleteId(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={() => void confirmRemove()}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImportDialog
        open={pendingImport !== null}
        fileName={pendingImport?.name ?? ""}
        onCancel={() => setPendingImport(null)}
        onConfirm={(mode) => void applyImport(mode)}
      />
      <ChangePasswordDialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        onSubmit={async (oldPassword, newPassword) => {
          if (!session) {
            throw new Error(t("app.pleaseLogInFirst"));
          }
          await changePasswordRemote(session, oldPassword, newPassword);
          setHint(t("app.passwordChanged"));
        }}
      />
      <SyncSummaryDialog
        open={syncStep === "summary" && syncPlan !== null}
        username={session?.username ?? ""}
        items={syncPlan ? syncItems(syncPlan) : []}
        dontAskAgain={dontAskAgain}
        onDontAskAgainChange={setDontAskAgain}
        onLater={closeSync}
        onContinue={openChecklist}
      />
      <SyncChecklistDialog
        open={syncStep === "checklist" && syncPlan !== null}
        items={syncPlan ? syncItems(syncPlan) : []}
        picked={picked}
        required={syncPlan ? requiredSyncKeys(syncPlan, picked) : new Set()}
        syncing={syncing}
        error={syncError}
        onToggle={togglePicked}
        onToggleAll={(on) => setPicked(on && syncPlan ? new Set(syncItems(syncPlan).map((item) => item.key)) : new Set())}
        onBack={() => {
          setSyncError("");
          setSyncStep("summary");
        }}
        onClose={closeSync}
        onConfirm={() => void confirmSync()}
      />
    </div>
  );
}
