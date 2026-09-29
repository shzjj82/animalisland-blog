import { useEffect, useState } from "react";
import { Check } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ImportMode } from "@/lib/document/import";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { mode: "append", title: "importDialog.append", hint: "importDialog.appendHint" },
  { mode: "prepend", title: "importDialog.prepend", hint: "importDialog.prependHint" },
  { mode: "replace", title: "importDialog.replace", hint: "importDialog.replaceHint" },
] as const satisfies readonly { mode: ImportMode; title: string; hint: string }[];

type Props = {
  open: boolean;
  fileName: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (mode: ImportMode) => void;
};

export function ImportDialog({ open, fileName, busy, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ImportMode>("append");

  useEffect(() => {
    if (open) {
      setMode("append");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("importDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("importDialog.description", { fileName })}
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-label={t("importDialog.importMode")} className="grid gap-1.5">
          {OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              role="radio"
              aria-checked={mode === option.mode}
              className={cn(
                "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted",
                mode === option.mode ? "border-foreground" : "border-border",
              )}
              onClick={() => setMode(option.mode)}
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className={cn("text-sm font-medium", option.mode === "replace" && "text-destructive")}>{t(option.title)}</span>
                <span className="text-xs text-muted-foreground">{t(option.hint)}</span>
              </span>
              {mode === option.mode ? <Check theme="outline" strokeWidth={3} size={16} /> : null}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy}
            className={mode === "replace" ? "bg-destructive text-white hover:bg-destructive/90" : undefined}
            onClick={() => onConfirm(mode)}
          >
            {mode === "replace" ? t("importDialog.replaceAndImport") : t("common.import")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
