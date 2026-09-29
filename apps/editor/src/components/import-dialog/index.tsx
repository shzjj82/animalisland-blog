import { useEffect, useState } from "react";
import { Attention, FileText, Paperclip } from "@icon-park/react";
import { FileTypeIcon } from "@/components/file-type-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatFileSize } from "@/lib/document/fileKinds";
import type { ImportMode } from "@/lib/document/import";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type ImportChoice = ImportMode | "attach";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 20 };

const PLACEMENTS = [
  { mode: "append", title: "importDialog.append" },
  { mode: "prepend", title: "importDialog.prepend" },
  { mode: "replace", title: "importDialog.replace" },
] as const satisfies readonly { mode: ImportMode; title: string }[];

type Props = {
  open: boolean;
  fileName: string;
  fileSize?: number;
  busy?: boolean;
  /** 拖入的 Word：先选「作为附件 / 导入正文」，默认附件 */
  allowAttach?: boolean;
  kind?: "word" | "excel";
  onCancel: () => void;
  onConfirm: (mode: ImportChoice) => void;
};

export function ImportDialog({ open, fileName, fileSize, busy, allowAttach, kind = "word", onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [attach, setAttach] = useState(false);
  const [placement, setPlacement] = useState<ImportMode>("append");

  useEffect(() => {
    if (open) {
      setAttach(Boolean(allowAttach));
      setPlacement("append");
    }
  }, [open, allowAttach]);

  const mode: ImportChoice = attach ? "attach" : placement;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent className="gap-5 sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {allowAttach ? t("importDialog.dropTitle", { kind: kind === "excel" ? "Excel" : "Word" }) : t("importDialog.title")}
          </DialogTitle>
          <DialogDescription>{t(allowAttach ? "importDialog.dropDescription" : "importDialog.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
          <FileTypeIcon type={kind} size={32} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium" title={fileName}>
              {fileName}
            </span>
            {fileSize !== undefined ? <span className="block text-xs text-muted-foreground">{formatFileSize(fileSize)}</span> : null}
          </span>
        </div>

        {allowAttach ? (
          <div role="radiogroup" aria-label={t("importDialog.importMode")} className="grid grid-cols-2 gap-2.5">
            {(
              [
                { value: true, icon: Paperclip, title: "importDialog.asAttachment", hint: "importDialog.asAttachmentHint" },
                { value: false, icon: FileText, title: "importDialog.asContent", hint: kind === "excel" ? "importDialog.asTableHint" : "importDialog.asContentHint" },
              ] as const
            ).map((option) => {
              const Icon = option.icon;
              const selected = attach === option.value;
              return (
                <button
                  key={option.title}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border px-3.5 py-5 text-center transition-colors",
                    selected ? "border-foreground bg-muted/40 ring-1 ring-foreground" : "border-border hover:bg-muted/50",
                  )}
                  onClick={() => setAttach(option.value)}
                >
                  <span className={cn("mb-1 grid size-10 place-items-center rounded-xl", selected ? "bg-foreground text-background" : "bg-muted text-foreground")}>
                    <Icon {...iconProps} size={18} />
                  </span>
                  <span className="text-sm font-semibold">{t(option.title)}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{t(option.hint)}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {!attach ? (
          <div className="grid gap-2">
            <div role="radiogroup" aria-label={t("importDialog.placement")} className="grid grid-cols-3 gap-1 rounded-lg border p-1">
              {PLACEMENTS.map((item) => {
                const selected = placement === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(
                      "h-8 rounded-md text-sm transition-colors",
                      selected
                        ? item.mode === "replace"
                          ? "bg-destructive/10 font-medium text-destructive"
                          : "bg-muted font-medium"
                        : "text-muted-foreground hover:bg-muted/60",
                    )}
                    onClick={() => setPlacement(item.mode)}
                  >
                    {t(item.title)}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <DialogFooter className="items-center">
          {mode === "replace" ? (
            <p className="mr-auto flex items-center gap-1.5 text-xs text-destructive">
              <Attention theme="outline" strokeWidth={3} size={13} />
              {t("importDialog.replaceHint")}
            </p>
          ) : null}
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className={mode === "replace" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={() => onConfirm(mode)}
          >
            {mode === "replace" ? t("importDialog.replaceAndImport") : mode === "attach" ? t("importDialog.insert") : t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
