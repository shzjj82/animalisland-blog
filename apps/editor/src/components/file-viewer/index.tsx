import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Close, Download } from "@icon-park/react";
import { FileTypeIcon } from "@/components/file-type-icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { codeLanguage, fileExtension, fileKind, formatFileSize } from "@/lib/document/fileKinds";
import { loadAttachment, type AttachmentData } from "@/store/fileStore";
import type { RemoteSession } from "@/store/remoteStore";
import "./fileViewer.css";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };
const MAX_CODE_CHARS = 1_000_000;
const MAX_SHEET_ROWS = 1000;
const MAX_SHEET_COLS = 100;
const WIDTH_KEY = "editor:file-viewer-width";
const MIN_WIDTH = 380;

function maxWidth(): number {
  return Math.max(MIN_WIDTH, window.innerWidth - 240);
}

function clampWidth(value: number): number {
  return Math.min(maxWidth(), Math.max(MIN_WIDTH, value));
}

function readWidth(): number {
  const saved = Number(localStorage.getItem(WIDTH_KEY));
  return clampWidth(Number.isFinite(saved) && saved > 0 ? saved : Math.min(640, window.innerWidth / 2));
}

type Props = {
  file: AttachmentData;
  session: RemoteSession | null;
  className?: string;
  onClose: () => void;
  onLoaded?: (blob: Blob) => void;
};

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; blob: Blob };

export function FileViewer({ file, session, className, onClose, onLoaded }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [width, setWidth] = useState(readWidth);
  const [resizing, setResizing] = useState(false);
  const kind = fileKind(file.name);

  function startResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let next = startWidth;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    setResizing(true);
    const move = (ev: PointerEvent) => {
      next = clampWidth(startWidth + startX - ev.clientX);
      setWidth(next);
    };
    const stop = (ev: PointerEvent) => {
      if (target.hasPointerCapture(ev.pointerId)) {
        target.releasePointerCapture(ev.pointerId);
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setResizing(false);
      localStorage.setItem(WIDTH_KEY, String(next));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    loadAttachment(session, file)
      .then((blob) => {
        if (alive) {
          setState({ status: "ready", blob });
          onLoaded?.(blob);
        }
      })
      .catch((error: unknown) => {
        if (alive) {
          setState({ status: "error", message: error instanceof Error ? error.message : t("attachment.loadFailed") });
        }
      });
    return () => {
      alive = false;
    };
  }, [file.fileId, file.source, session?.token]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function download() {
    if (state.status !== "ready") {
      return;
    }
    const url = URL.createObjectURL(state.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <aside className={cn("flex h-full min-h-0 min-w-0 flex-col border-l border-border bg-background", className)} style={{ width }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("attachment.resize")}
        className={cn("absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize touch-none hover:bg-foreground/15", resizing && "bg-foreground/15")}
        onPointerDown={startResize}
      />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        {kind ? <FileTypeIcon type={kind} size={20} /> : null}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold" title={file.name}>
            {file.name}
          </span>
          <span className="block text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
        </span>
        <Button type="button" variant="ghost" size="icon" aria-label={t("attachment.download")} disabled={state.status !== "ready"} onClick={download}>
          <Download {...iconProps} />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label={t("attachment.close")} onClick={onClose}>
          <Close {...iconProps} />
        </Button>
      </header>
      <div className={cn("relative min-h-0 flex-1", resizing && "pointer-events-none select-none")}>
        {state.status === "loading" ? <Notice>{t("attachment.loading")}</Notice> : null}
        {state.status === "error" ? <Notice tone="error">{state.message}</Notice> : null}
        {state.status === "ready" ? <Preview blob={state.blob} name={file.name} /> : null}
      </div>
    </aside>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone?: "error" }) {
  return (
    <div className={cn("flex h-full items-center justify-center px-8 text-center text-sm", tone === "error" ? "text-destructive" : "text-muted-foreground")}>
      {children}
    </div>
  );
}

function Preview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useTranslation();
  switch (fileKind(name)) {
    case "pdf":
      return <PdfPreview blob={blob} name={name} />;
    case "word":
      return fileExtension(name) === "docx" ? <WordPreview blob={blob} /> : <Notice>{t("attachment.legacyWord")}</Notice>;
    case "excel":
      return <SheetPreview blob={blob} name={name} />;
    case "code":
      return <CodePreview blob={blob} name={name} />;
    default:
      return <Notice>{t("attachment.noPreview")}</Notice>;
  }
}

function useFailure() {
  const { t } = useTranslation();
  const [failed, setFailed] = useState("");
  const fail = (error: unknown) => setFailed(error instanceof Error && error.message ? error.message : t("attachment.previewFailed"));
  return [failed, fail] as const;
}

function PdfPreview({ blob, name }: { blob: Blob; name: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url ? <iframe src={url} title={name} className="absolute inset-0 h-full w-full border-0" /> : null;
}

function WordPreview({ blob }: { blob: Blob }) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, fail] = useFailure();

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    let alive = true;
    setReady(false);
    body.replaceChildren();
    import("docx-preview")
      .then(({ renderAsync }) =>
        renderAsync(blob, body, undefined, {
          className: "docx",
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
          experimental: true,
        }),
      )
      .then(() => alive && setReady(true))
      .catch((error: unknown) => alive && fail(error));
    return () => {
      alive = false;
    };
  }, [blob]);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    const body = bodyRef.current;
    if (!ready || !scroll || !body) {
      return;
    }
    const fit = () => {
      const page = body.querySelector<HTMLElement>("section.docx");
      if (!page) {
        return;
      }
      body.style.zoom = "1";
      const zoom = Math.min(1, (scroll.clientWidth - 32) / page.offsetWidth);
      body.style.zoom = String(Math.max(0.3, zoom));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={scrollRef} className="file-viewer-docx absolute inset-0 overflow-auto bg-muted">
      {failed ? <Notice tone="error">{failed}</Notice> : null}
      {!ready && !failed ? <Notice>{t("attachment.rendering")}</Notice> : null}
      <div ref={bodyRef} className={ready ? undefined : "hidden"} />
    </div>
  );
}

type Sheet = { name: string; rows: string[][]; truncated: boolean };

function columnLabel(index: number): string {
  let label = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    label = String.fromCharCode(65 + ((n - 1) % 26)) + label;
  }
  return label;
}

function SheetPreview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useTranslation();
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [failed, fail] = useFailure();

  useEffect(() => {
    let alive = true;
    setSheets(null);
    setActive(0);
    (async () => {
      const XLSX = await import("xlsx");
      const workbook =
        fileExtension(name) === "csv"
          ? XLSX.read(await blob.text(), { type: "string" })
          : XLSX.read(await blob.arrayBuffer(), { type: "array" });
      return workbook.SheetNames.map((sheetName) => {
        const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "", blankrows: false });
        const truncated = rows.length > MAX_SHEET_ROWS || rows.some((row) => row.length > MAX_SHEET_COLS);
        return { name: sheetName, rows: rows.slice(0, MAX_SHEET_ROWS).map((row) => row.slice(0, MAX_SHEET_COLS)), truncated };
      });
    })()
      .then((next) => alive && setSheets(next))
      .catch((error: unknown) => alive && fail(error));
    return () => {
      alive = false;
    };
  }, [blob, name]);

  if (failed) {
    return <Notice tone="error">{failed}</Notice>;
  }
  if (!sheets) {
    return <Notice>{t("attachment.rendering")}</Notice>;
  }
  const sheet = sheets[active];
  const width = Math.max(1, ...(sheet?.rows.map((row) => row.length) ?? [1]));

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {sheet && sheet.rows.length > 0 ? (
          <table className="file-viewer-sheet">
            <thead>
              <tr>
                <th />
                {Array.from({ length: width }, (_, index) => (
                  <th key={index}>{columnLabel(index)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th>{rowIndex + 1}</th>
                  {Array.from({ length: width }, (_, colIndex) => (
                    <td key={colIndex}>{row[colIndex] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Notice>{t("attachment.emptySheet")}</Notice>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-border px-2 py-1.5">
        {sheets.map((item, index) => (
          <button
            key={item.name}
            type="button"
            className={cn("h-7 shrink-0 rounded-md px-2.5 text-xs", index === active ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted")}
            onClick={() => setActive(index)}
          >
            {item.name}
          </button>
        ))}
        {sheet?.truncated ? (
          <span className="ml-auto shrink-0 px-2 text-xs text-muted-foreground">
            {t("attachment.sheetTruncated", { rows: MAX_SHEET_ROWS, cols: MAX_SHEET_COLS })}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CodePreview({ blob, name }: { blob: Blob; name: string }) {
  const { t } = useTranslation();
  const [code, setCode] = useState<{ html: string; lines: number; truncated: boolean } | null>(null);
  const [failed, fail] = useFailure();

  useEffect(() => {
    let alive = true;
    setCode(null);
    (async () => {
      const text = await blob.text();
      const source = text.slice(0, MAX_CODE_CHARS).replace(/\r\n?/g, "\n");
      const { highlightCode } = await import("@/lib/document/highlight");
      return { html: highlightCode(source, codeLanguage(name)), lines: source.split("\n").length, truncated: text.length > MAX_CODE_CHARS };
    })()
      .then((next) => alive && setCode(next))
      .catch((error: unknown) => alive && fail(error));
    return () => {
      alive = false;
    };
  }, [blob, name]);

  if (failed) {
    return <Notice tone="error">{failed}</Notice>;
  }
  if (!code) {
    return <Notice>{t("attachment.rendering")}</Notice>;
  }
  return (
    <div className="absolute inset-0 overflow-auto">
      {code.truncated ? <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">{t("attachment.codeTruncated")}</p> : null}
      <div className="file-viewer-code">
        <pre className="file-viewer-code__gutter" aria-hidden="true">
          {Array.from({ length: code.lines }, (_, index) => index + 1).join("\n")}
        </pre>
        <pre className="file-viewer-code__body hljs">
          <code dangerouslySetInnerHTML={{ __html: code.html }} />
        </pre>
      </div>
    </div>
  );
}
