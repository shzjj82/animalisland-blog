import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";
import { pageTitle } from "@/i18n";
import type { SyncItem, SyncItemKind } from "@/store/localSync";

const KIND_LABEL = { create: "syncDialogs.new", update: "syncDialogs.update", delete: "common.delete" } as const;

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString(undefined, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function KindTag({ kind }: { kind: SyncItemKind }) {
  const { t } = useTranslation();
  return (
    <span
      className={
        kind === "delete"
          ? "shrink-0 rounded border border-destructive/40 px-1.5 py-px text-[11px] text-destructive"
          : "shrink-0 rounded border border-border px-1.5 py-px text-[11px] text-muted-foreground"
      }
    >
      {t(KIND_LABEL[kind])}
    </span>
  );
}

type SummaryProps = {
  open: boolean;
  username: string;
  items: SyncItem[];
  dontAskAgain: boolean;
  onDontAskAgainChange: (value: boolean) => void;
  onLater: () => void;
  onContinue: () => void;
};

export function SyncSummaryDialog({
  open,
  username,
  items,
  dontAskAgain,
  onDontAskAgainChange,
  onLater,
  onContinue,
}: SummaryProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onLater()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("common.syncLocalPages")}</DialogTitle>
          <DialogDescription>
            {t("syncDialogs.summaryDescription", { count: items.length, username })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="items-center justify-between">
          <Label className="font-normal text-muted-foreground">
            <Checkbox checked={dontAskAgain} onCheckedChange={(value) => onDontAskAgainChange(value === true)} />
            {t("syncDialogs.dontAskAgain")}
          </Label>
          <span className="inline-flex gap-2">
            <Button type="button" variant="outline" onClick={onLater}>
              {t("syncDialogs.notNow")}
            </Button>
            <Button type="button" onClick={onContinue}>
              {t("syncDialogs.sync")}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ChecklistProps = {
  open: boolean;
  items: SyncItem[];
  picked: Set<string>;
  required: Set<string>;
  syncing: boolean;
  error: string;
  onToggle: (key: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
  onBack: () => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function SyncChecklistDialog({
  open,
  items,
  picked,
  required,
  syncing,
  error,
  onToggle,
  onToggleAll,
  onBack,
  onClose,
  onConfirm,
}: ChecklistProps) {
  const { t } = useTranslation();
  const total = items.filter((item) => picked.has(item.key) || required.has(item.key)).length;
  const allOn = items.length > 0 && items.every((item) => picked.has(item.key) || required.has(item.key));
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("syncDialogs.checklistTitle")}</DialogTitle>
          <DialogDescription>
            {t("syncDialogs.checklistDescription")}
          </DialogDescription>
        </DialogHeader>
        <Label className="font-normal">
          <Checkbox checked={allOn} disabled={syncing} onCheckedChange={(value) => onToggleAll(value === true)} />
          {t("syncDialogs.selectAll")}
        </Label>
        <ul className="grid max-h-72 gap-1 overflow-y-auto rounded-md border border-border p-1">
          {items.map((item) => {
            const forced = required.has(item.key);
            const on = forced || picked.has(item.key);
            return (
              <li key={item.key}>
                <label className="flex cursor-pointer items-center gap-3 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox
                    checked={on}
                    disabled={syncing || forced}
                    onCheckedChange={(value) => onToggle(item.key, value === true)}
                  />
                  <KindTag kind={item.kind} />
                  <span className="min-w-0 flex-1 truncate">{pageTitle(item.title)}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {forced ? t("syncDialogs.usedByAnotherPage") : formatTime(item.updatedAt)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {error ? (
          <p className="text-sm text-destructive">
            {t("syncDialogs.retryHint", { error })}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={syncing} onClick={onBack}>
            {t("syncDialogs.back")}
          </Button>
          <Button type="button" disabled={syncing || total === 0} onClick={onConfirm}>
            {syncing ? t("syncDialogs.syncing") : t("syncDialogs.confirm", { total })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
