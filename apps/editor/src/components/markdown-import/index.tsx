import { useCallback, useMemo, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { FileAddition, Left, UploadOne } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { documentFromMarkdown, titleFromMarkdown } from "@/lib/document/fromMarkdown";
import { goAppHome, markdownPath, setPendingPageId } from "@/lib/route";
import { cn } from "@/lib/utils";
import { createLocal, titleFromBody } from "@/store/localStore";
import {
  canWriteTeam,
  listTeams,
  readActiveTeamId,
} from "@/store/teamStore";
import { createRemote, loadSession } from "@/store/remoteStore";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const MD_ACCEPT = ".md,.markdown,text/markdown,text/plain";

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

export function MarkdownImportPage() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      return { title: "", blocks: 0 };
    }
    const body = documentFromMarkdown(trimmed);
    return {
      title: titleFromBody(body),
      blocks: body.blocks.length,
    };
  }, [text]);

  const ingestFile = useCallback(
    async (file: File) => {
      setError("");
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".md") && !lower.endsWith(".markdown") && file.type && !file.type.includes("text") && !file.type.includes("markdown")) {
        setError(t("markdown.onlyMd"));
        return;
      }
      setText(await file.text());
      setFileName(file.name);
    },
    [t],
  );

  async function onPick(files: FileList | null) {
    const file = files?.[0];
    if (file) {
      await ingestFile(file);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void ingestFile(file);
    }
  }

  async function onCreate() {
    const source = text.trim();
    if (!source) {
      setError(t("markdown.empty"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = documentFromMarkdown(source);
      const fallback = fileName ? fileBaseName(fileName) : t("markdown.imported");
      const title = titleFromMarkdown(source, fallback);
      const session = loadSession();
      let pageId: string;
      if (session) {
        const teams = await listTeams(session).catch(() => []);
        const activeTeamId = readActiveTeamId();
        const writingTeam =
          activeTeamId && canWriteTeam(teams.find((team) => team.id === activeTeamId)?.role) ? activeTeamId : null;
        const created = await createRemote(session, null, writingTeam, {
          title,
          body,
          props: { importedFrom: "markdown", ...(fileName ? { sourceFile: fileName } : {}) },
        });
        pageId = created.id;
      } else {
        const created = createLocal(null, { title, body });
        pageId = created.id;
      }
      setPendingPageId(pageId);
      goAppHome();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("markdown.createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Button type="button" variant="ghost" size="icon" aria-label={t("markdown.back")} onClick={() => goAppHome()}>
          <Left {...iconProps} />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{t("markdown.title")}</div>
          <div className="truncate text-xs text-muted-foreground">{t("markdown.subtitle")}</div>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={busy || !text.trim()} onClick={() => void onCreate()}>
          <FileAddition {...iconProps} />
          {busy ? t("markdown.creating") : t("markdown.create")}
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 sm:p-6">
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors",
            dragging ? "border-foreground bg-muted" : "border-border bg-muted/30",
          )}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <UploadOne {...iconProps} size={22} />
          <p className="text-sm text-foreground">{t("markdown.dropHint")}</p>
          <p className="text-xs text-muted-foreground">{t("markdown.dropTypes")}</p>
          <label className="mt-1">
            <input
              type="file"
              accept={MD_ACCEPT}
              className="sr-only"
              onChange={(event) => void onPick(event.target.files)}
            />
            <span className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border bg-background px-3 text-xs hover:bg-muted">
              {t("markdown.chooseFile")}
            </span>
          </label>
          {fileName ? <p className="text-xs text-muted-foreground">{fileName}</p> : null}
        </div>

        <label className="grid gap-2">
          <span className="text-xs font-medium text-muted-foreground">{t("markdown.pasteLabel")}</span>
          <textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setFileName(null);
            }}
            placeholder={t("markdown.placeholder")}
            spellCheck={false}
            className="min-h-[18rem] w-full resize-y rounded-xl border border-border bg-background px-3 py-2 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {text.trim() ? (
          <div className="text-xs text-muted-foreground">
            {t("markdown.preview", { title: preview.title || t("common.untitled"), count: preview.blocks })}
          </div>
        ) : null}

        {error ? <div className="text-sm text-destructive">{error}</div> : null}

        <p className="text-xs text-muted-foreground">
          {t("markdown.pathHint", { path: markdownPath() })}
        </p>
      </main>
    </div>
  );
}
