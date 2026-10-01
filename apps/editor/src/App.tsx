import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type EditorJS from "@editorjs/editorjs";
import { useTranslation } from "react-i18next";
import { CloudStorage, Delete, Download, Export, HardDisk, People, Plus, Robot, Search } from "@icon-park/react";
import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";
import { BlockEditor } from "@/components/block-editor";
import type { PageLinkData } from "@/components/block-editor/tools/PageLinkTool";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { EditorSpotlight, type SpotlightAction } from "@/components/editor-spotlight";
import { EmptyState } from "@/components/empty-state";
import { FileDropZone } from "@/components/file-drop";
import { FileTypeIcon } from "@/components/file-type-icon";
import { FileViewer } from "@/components/file-viewer";
import { WikiChat } from "@/components/wiki-chat";
import { ImportDialog, type ImportChoice } from "@/components/import-dialog";
import { LanguageSwitch } from "@/components/language-switch";
import { PageTree } from "@/components/page-tree";
import { SettingsMenu } from "@/components/settings-menu";
import { TeamDialog } from "@/components/team-dialog";
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
  createRemote,
  listRemote,
  loadRemote,
  loadSession,
  loginRemote,
  logoutRemote,
  registerRemote,
  removeRemote,
  reparentRemote,
  saveRemote,
  subscribeSession,
  type RemoteSession,
} from "@/store/remoteStore";
import { readSyncSettings, writeSyncSettings, type SyncSettings } from "@/store/syncSettings";
import {
  canManageTeam,
  canWriteTeam,
  listTeams,
  readActiveTeamId,
  writeActiveTeamId,
  type TeamInfo,
} from "@/store/teamStore";
import { TeamManageSidebar } from "@/components/team-manage-sidebar";
import { pageTitle, setAppLocale, type AppLocale } from "@/i18n";
import { exportDocument, type ExportFormat } from "@/lib/document/export";
import { fileKind } from "@/lib/document/fileKinds";
import { importSpreadsheet, importVideo, importWord, mergeImported, readInsertable, WORD_ACCEPT } from "@/lib/document/import";
import { insertEditorBlocksAt } from "@/lib/document/insertBlocks";
import { loadSearchDocs } from "@/lib/document/search";
import {
  flushPendingAttachments,
  promoteAttachment,
  promoteDocument,
  saveAttachment,
  type AttachmentData,
} from "@/store/fileStore";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const SIDEBAR_WIDTH_KEY = "editor:sidebar-width";
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 480;
const TEAM_COLORS = [
  { fill: "#f6c6c0", line: "#e07a72" },
  { fill: "#f7d98a", line: "#d7a322" },
  { fill: "#bfe8d4", line: "#3eae86" },
  { fill: "#c9d7fb", line: "#6d8eeb" },
  { fill: "#e4c8f5", line: "#b57ad6" },
  { fill: "#f6d0e4", line: "#d56aa3" },
  { fill: "#c8ebe6", line: "#3aafa3" },
  { fill: "#f3d2b8", line: "#d48955" },
];

function teamColor(id: string): { fill: string; line: string } {
  let hash = 0;
  for (const char of id) {
    hash = (hash + char.charCodeAt(0)) % TEAM_COLORS.length;
  }
  return TEAM_COLORS[hash];
}

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
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [teamsReady, setTeamsReady] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [teamManageOpen, setTeamManageOpen] = useState(false);
  const [teamPanel, setTeamPanel] = useState<"create" | "join">("create");
  const [activeTeamId, setActiveTeamId] = useState<string | null>(readActiveTeamId);
  const [exportOpen, setExportOpen] = useState(false);
  const [reveal, setReveal] = useState<{ text: string; nonce: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  /** 正在导入的 Word / Excel；index 只有拖入时才有，弹窗里选「作为附件」时插到这里 */
  const [pendingDrop, setPendingDrop] = useState<{ file: File; index: number | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [queuedDrop, setQueuedDrop] = useState<File[] | null>(null);
  const [viewing, setViewing] = useState<{ data: AttachmentData; replace: (next: AttachmentData) => void } | null>(null);
  const [fileDeleteAsk, setFileDeleteAsk] = useState<{ name: string; resolve: (ok: boolean) => void } | null>(null);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [wikiOpen, setWikiOpen] = useState(false);
  const [wikiFocus, setWikiFocus] = useState(0);
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
  const pageReadOnly = Boolean(
    teamsReady && page?.teamId && !canWriteTeam(teams.find((team) => team.id === page.teamId)?.role),
  );
  const readOnlyRef = useRef(pageReadOnly);
  readOnlyRef.current = pageReadOnly;
  const sessionRef = useRef<RemoteSession | null>(session);
  sessionRef.current = session;
  const remote = session !== null;

  useEffect(() => subscribeSession(setSession), []);

  const refreshLocal = useCallback((selectId?: string | null) => {
    const list = listLocal();
    setNodes(list);
    const id = selectId === undefined ? (pageRef.current?.id ?? list[0]?.id) : (selectId ?? list[0]?.id);
    setPage(id ? (loadLocal(id) ?? null) : null);
  }, []);

  /** 退出或换号后，还在路上的云端响应不能再写回界面 */
  const stale = (nextSession: RemoteSession) => sessionRef.current !== nextSession;

  const refreshRemote = useCallback(async (nextSession: RemoteSession, selectId?: string | null) => {
    const list = await listRemote(nextSession);
    if (stale(nextSession)) {
      return;
    }
    setNodes(list);
    const id = selectId === undefined ? (pageRef.current?.id ?? list[0]?.id) : (selectId ?? list[0]?.id);
    if (!id) {
      setPage(null);
      return;
    }
    const loaded = await loadRemote(nextSession, id);
    if (!stale(nextSession)) {
      setPage(loaded);
    }
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

  const openWiki = useCallback(() => {
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setViewing(null);
    setSpotlightOpen(false);
    setSpotlightLaunch(null);
    setWikiOpen(true);
    setWikiFocus((count) => count + 1);
  }, [session]);

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
      setTeams([]);
      setTeamsReady(false);
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
    void refreshRemote(session, null)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : t("app.failedToLoadRemotePages"));
      })
      .then(() => flushPendingAttachments(session))
      .then((touched) => {
        if (touched && touched.length > 0) {
          setHint(t("attachment.promotedMany", { count: touched.length }));
        }
      })
      .catch(() => undefined);
    void listTeams(session)
      .then((list) => {
        if (sessionRef.current !== session) {
          return;
        }
        setTeams(list);
        setActiveTeamId((current) => {
          const next = current && list.some((team) => team.id === current) ? current : null;
          writeActiveTeamId(next);
          return next;
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (sessionRef.current === session) {
          setTeamsReady(true);
        }
      });
  }, [session, refreshLocal, refreshRemote]);

  useEffect(() => {
    if (!session) {
      return;
    }
    const onOnline = () => {
      void flushPendingAttachments(session)
        .then((touched) => {
          if (touched.length > 0) {
            setHint(t("attachment.promotedMany", { count: touched.length }));
          }
        })
        .catch(() => undefined);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [session]);

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
    void logoutRemote(session);
    setSession(null);
    setWikiOpen(false);
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
      await exportDocument(format, titleFromBody(body), body);
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
      const inherited = parentId ? (nodes.find((node) => node.id === parentId)?.teamId ?? null) : null;
      const writingTeam = !parentId && activeTeamId && canWriteTeam(teams.find((team) => team.id === activeTeamId)?.role) ? activeTeamId : null;
      const created = session ? await createRemote(session, parentId, inherited || writingTeam) : createLocal(parentId);
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
    setPendingDrop({ file, index: null });
    setImportOpen(true);
  }

  function closeImport() {
    if (importBusy) {
      return;
    }
    setImportOpen(false);
    setPendingDrop(null);
  }

  async function applyImport(mode: ImportChoice) {
    const current = pageRef.current;
    const drop = pendingDrop;
    if (!drop || !current) {
      return;
    }
    setImportBusy(true);
    setError("");
    try {
      if (mode === "attach") {
        await insertDropped([drop.file], drop.index ?? dropIndex(null));
      } else {
        const kind = fileKind(drop.file.name);
        const imported =
          kind === "excel"
            ? await importSpreadsheet(drop.file)
            : kind === "video"
              ? await importVideo(drop.file, uploadFile)
              : await importWord(drop.file, uploadFile);
        const body = editorRef.current ? ((await editorRef.current.save()) as EditorJsDocument) : current.body;
        onEdit(mergeImported(mode, body, imported));
        setEditorEpoch((value) => value + 1);
      }
      setImportOpen(false);
      setPendingDrop(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("app.importFailed"));
    } finally {
      setImportBusy(false);
    }
  }

  async function uploadFile(file: File): Promise<AttachmentData> {
    const { data, localOnly } = await saveAttachment(session, file);
    if (localOnly) {
      setHint(t("attachment.savedLocally"));
    }
    return data;
  }

  function confirmDeleteFile(name: string): Promise<boolean> {
    return new Promise((resolve) => setFileDeleteAsk({ name, resolve }));
  }

  function answerDeleteFile(ok: boolean) {
    fileDeleteAsk?.resolve(ok);
    setFileDeleteAsk(null);
  }

  /** 上传服务当时不可用而存在本机的附件，打开时再补传一次，成功后块数据改指向云端 */
  async function promoteViewing(blob: Blob) {
    const current = viewing;
    if (!session || !current || current.data.source !== "local") {
      return;
    }
    const next = await promoteAttachment(session, current.data, blob).catch(() => null);
    if (next) {
      current.replace(next);
      setHint(t("attachment.promoted"));
    }
  }

  /** 按松手位置落在哪个块的上半或下半，算出插入下标；标题块始终在最前 */
  function dropIndex(point: { x: number; y: number } | null): number {
    const editor = editorRef.current;
    if (!editor) {
      return 0;
    }
    const total = editor.blocks.getBlocksCount();
    const floor = editor.blocks.getBlockByIndex(0)?.name === "header" ? 1 : 0;
    const target = point ? document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>(".ce-block") : null;
    const blocks = Array.from(document.querySelectorAll<HTMLElement>(".notion-editor .ce-block"));
    const at = target ? blocks.indexOf(target) : -1;
    if (at < 0) {
      return total;
    }
    const rect = target!.getBoundingClientRect();
    return Math.max(floor, point!.y > rect.top + rect.height / 2 ? at + 1 : at);
  }

  /** 拖入：Markdown / 文本转成正文，Word、PDF、Excel、代码作为附件，其他提示不支持 */
  async function insertDropped(files: File[], index: number) {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    const blocks: EditorJsBlock[] = [];
    const skipped: string[] = [];
    setHint(t("attachment.processing"));
    try {
      for (const file of files) {
        const content = await readInsertable(file);
        if (content) {
          blocks.push(...content);
        } else if (fileKind(file.name)) {
          blocks.push({ type: "attachment", data: await uploadFile(file) });
        } else {
          skipped.push(file.name);
        }
      }
      await insertEditorBlocksAt(editor, blocks, index);
      setHint("");
      if (skipped.length > 0) {
        setError(t("attachment.unsupported", { name: skipped.join(t("common.listSeparator")) }));
      }
    } catch (err) {
      setHint("");
      setError(err instanceof Error ? err.message : t("attachment.uploadFailed"));
    }
  }

  async function dropFiles(files: File[], point: { x: number; y: number } | null) {
    setError("");
    if (!pageRef.current || !editorRef.current) {
      setQueuedDrop(files);
      await createPage(null);
      return;
    }
    const index = dropIndex(point);
    const [single] = files;
    const kind = single && files.length === 1 ? fileKind(single.name) : null;
    if (single && (kind === "word" || kind === "excel" || kind === "video")) {
      setPendingDrop({ file: single, index });
      setImportOpen(true);
      return;
    }
    await insertDropped(files, index);
  }

  useEffect(() => {
    if (queuedDrop && editorReady && page) {
      setQueuedDrop(null);
      void dropFiles(queuedDrop, null);
    }
  }, [queuedDrop, editorReady, page?.id]);

  function onEdit(body: EditorJsDocument) {
    const current = pageRef.current;
    if (!current || readOnlyRef.current) {
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
        const { body } = await promoteDocument(session, next.body);
        const saved = await saveRemote(session, { ...next, body });
        const list = await listRemote(session);
        if (stale(session)) {
          return true;
        }
        setPage(saved);
        setNodes(list);
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
          nodes={session && activeTeamId ? nodes.filter((node) => node.teamId === activeTeamId) : nodes}
          query={query}
          selectedId={page?.id}
          onOpen={(id) => void openPage(id)}
          onCreateChild={(parentId) => void createPage(parentId)}
          onDelete={(id) => void removePage(id)}
          onReparent={(id, parentId) => void movePage(id, parentId)}
          onExport={(id, format) => void exportPage(id, format)}
        />
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-sidebar-border px-1 pt-3 text-xs text-muted-foreground">
          {session && activeTeamId ? (
            <div className="group/teams flex min-w-0 flex-1 items-center overflow-x-auto">
              {[...teams.filter((team) => team.id === activeTeamId), ...teams.filter((team) => team.id !== activeTeamId)].map((team, index) => (
                <button
                  key={team.id}
                  type="button"
                  title={team.name}
                  aria-label={team.name}
                  aria-pressed={activeTeamId === team.id}
                  className={`relative flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold text-sidebar-foreground transition-[margin,border-color] duration-200 ${
                    activeTeamId === team.id ? "z-30" : "z-0 border-sidebar hover:border-[var(--team-line)]"
                  } ${index > 0 ? "-ml-4 group-hover/teams:ml-1" : ""}`}
                  style={{
                    background: teamColor(team.id).fill,
                    ["--team-line" as string]: teamColor(team.id).line,
                    borderColor: activeTeamId === team.id ? teamColor(team.id).line : undefined,
                  }}
                  onClick={() => {
                    writeActiveTeamId(team.id);
                    setActiveTeamId(team.id);
                  }}
                >
                  {team.name.slice(0, 1)}
                </button>
              ))}
            </div>
          ) : session ? (
            <span className="min-w-0 flex-1 truncate px-2">{session.username}</span>
          ) : (
            <Button type="button" variant="ghost" size="sm" className="min-w-0 flex-1 justify-start" onClick={() => setAuthOpen(true)}>
              <People {...iconProps} />
              {t("app.logIn")}
            </Button>
          )}
          {session ? (
            <SettingsMenu
              settings={syncSettings}
              onChange={updateSyncSettings}
              onLogout={logout}
              onChangePassword={() => setPasswordOpen(true)}
              onCreateTeam={() => {
                setTeamPanel("create");
                setTeamOpen(true);
              }}
              onJoinTeam={() => {
                setTeamPanel("join");
                setTeamOpen(true);
              }}
              teamMode={activeTeamId !== null}
              canSwitchTeam={teams.length > 0}
              canManageTeam={canManageTeam(teams.find((team) => team.id === activeTeamId)?.role)}
              onManageTeam={() => setTeamManageOpen(true)}
              onToggleTeamMode={() => {
                if (teams.length === 0) {
                  return;
                }
                if (activeTeamId) {
                  writeActiveTeamId(null);
                  setActiveTeamId(null);
                  return;
                }
                const next = teams[0];
                writeActiveTeamId(next.id);
                setActiveTeamId(next.id);
              }}
            />
          ) : null}
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
            <Button type="button" variant="outline" size="sm" disabled={!page || pageReadOnly} onClick={() => page && void removePage(page.id)}>
              <Delete {...iconProps} />
              {t("common.delete")}
            </Button>
            <Button type="button" variant="outline" size="icon" aria-label={t("wikiAsk.title")} onClick={openWiki}>
              <Robot {...iconProps} />
            </Button>
            <LanguageSwitch onChange={(locale) => void switchLocale(locale)} />
          </span>
        </header>
        <FileDropZone
          hasPage={Boolean(page)}
          className="min-h-0 flex-1"
          onDrop={(files, point) => void dropFiles(files, point)}
        >
          {page ? (
            <BlockEditor
              key={`${remote ? "remote" : "local"}:${page.id}:${editorEpoch}:${i18n.language}:${pageReadOnly ? "ro" : "rw"}`}
              doc={page.body}
              readOnly={pageReadOnly}
              onChange={onEdit}
              onOpenPage={(id) => void openPage(id)}
              onCreateChild={createChildLink}
              onReady={(editor) => {
                editorRef.current = editor;
                setEditorReady(Boolean(editor));
              }}
              onAi={(index) => openSpotlight({ actionId: "ai-chat", insertIndex: index })}
              onAskSelection={(text) => openSpotlight({ actionId: "ai-chat", selection: text })}
              onUploadFile={uploadFile}
              onOpenFile={(data, replace) => {
                setWikiOpen(false);
                setViewing({ data, replace });
              }}
              onConfirmDeleteFile={confirmDeleteFile}
              reveal={reveal}
            />
          ) : (
            <EmptyState hasPages={nodes.length > 0} onCreate={() => void createPage(null)} />
          )}
        </FileDropZone>
      </main>
      {viewing ? (
        <FileViewer
          key={viewing.data.fileId}
          file={viewing.data}
          session={session}
          onLoaded={(blob) => void promoteViewing(blob)}
          className="file-viewer-drawer fixed top-0 right-0 bottom-0 z-40 shadow-[-12px_0_32px_rgb(0_0_0/0.08)]"
          onClose={() => setViewing(null)}
        />
      ) : null}
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
            {
              id: "wiki-ask",
              title: t("wikiAsk.title"),
              subtitle: t("wikiAsk.subtitle"),
              keywords: t("wikiAsk.keywords"),
              icon: "search",
            },
          ] satisfies SpotlightAction[]
        }
        editor={editorReady ? editorRef.current : null}
        insertIndex={spotlightLaunch?.insertIndex ?? 0}
        launchActionId={spotlightLaunch?.actionId}
        selection={spotlightLaunch?.selection}
        loadPages={() => loadSearchDocs(session, nodes)}
        onOpenPage={(id, query) => void revealPage(id, query)}
        onAskWiki={openWiki}
      />
      <WikiChat
        open={wikiOpen}
        focusToken={wikiFocus}
        loggedIn={Boolean(session)}
        loadDocs={() => loadSearchDocs(session, nodes)}
        onClose={() => setWikiOpen(false)}
        onLogin={() => {
          setWikiOpen(false);
          setAuthOpen(true);
        }}
      />
      <Dialog open={fileDeleteAsk !== null} onOpenChange={(open) => !open && answerDeleteFile(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("attachment.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("attachment.deleteConfirm", { name: fileDeleteAsk?.name ?? "" })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => answerDeleteFile(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={() => answerDeleteFile(true)}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        open={importOpen}
        busy={importBusy}
        fileName={pendingDrop?.file.name ?? ""}
        fileSize={pendingDrop?.file.size}
        allowAttach={pendingDrop?.index != null}
        kind={pendingDrop && fileKind(pendingDrop.file.name) === "excel" ? "excel" : pendingDrop && fileKind(pendingDrop.file.name) === "video" ? "video" : "word"}
        onCancel={closeImport}
        onConfirm={(mode) => void applyImport(mode)}
      />
      {session && teamManageOpen && teams.find((team) => team.id === activeTeamId && canManageTeam(team.role)) ? (
        <TeamManageSidebar
          session={session}
          team={teams.find((team) => team.id === activeTeamId)!}
          onClose={() => setTeamManageOpen(false)}
          onChanged={() => {
            void listTeams(session).then((list) => {
              if (sessionRef.current === session) setTeams(list);
            });
          }}
        />
      ) : null}
      {session ? (
        <TeamDialog
          open={teamOpen}
          session={session}
          teams={teams}
          activeTeamId={activeTeamId}
          pageTeamId={page?.teamId}
          onActiveTeam={(id) => {
            writeActiveTeamId(id);
            setActiveTeamId(id);
          }}
          onAssignPage={
            page
              ? (teamId) => {
                  const current = pageRef.current;
                  if (!current) {
                    return;
                  }
                  void persist({ ...current, teamId });
                }
              : undefined
          }
          onChange={() =>
            listTeams(session).then((list) => {
              setTeams(list);
              if (session) {
                void refreshRemote(session, pageRef.current?.id ?? null);
              }
            })
          }
          onClose={() => setTeamOpen(false)}
          panel={teamPanel}
        />
      ) : null}
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
