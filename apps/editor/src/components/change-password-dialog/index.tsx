import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (oldPassword: string, newPassword: string) => Promise<void>;
};

export function ChangePasswordDialog({ open, onOpenChange, onSubmit }: Props) {
  const { t } = useTranslation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
      setError("");
    }
  }, [open]);

  async function submit() {
    if (!oldPassword || !newPassword) {
      setError(t("changePasswordDialog.required"));
      return;
    }
    if (newPassword.length < 6) {
      setError(t("changePasswordDialog.tooShort"));
      return;
    }
    if (newPassword !== confirm) {
      setError(t("changePasswordDialog.mismatch"));
      return;
    }
    if (newPassword === oldPassword) {
      setError(t("changePasswordDialog.sameAsOld"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(oldPassword, newPassword);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.failedToChangePassword"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("common.changePassword")}</DialogTitle>
          <DialogDescription>{t("changePasswordDialog.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="old-password">{t("changePasswordDialog.currentPassword")}</Label>
            <Input
              id="old-password"
              type="password"
              value={oldPassword}
              onChange={(event) => setOldPassword(event.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">{t("changePasswordDialog.newPassword")}</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              placeholder={t("common.atLeast6Characters")}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="confirm-password">{t("changePasswordDialog.confirmNewPassword")}</Label>
            <Input
              id="confirm-password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t("changePasswordDialog.saving") : t("changePasswordDialog.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
