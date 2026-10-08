import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTeam, joinTeam } from "@/store/teamStore";
import type { RemoteSession } from "@/store/remoteStore";

type Props = {
  open: boolean;
  session: RemoteSession;
  onActiveTeam: (id: string | null) => void;
  onChange: () => Promise<void> | void;
  onClose: () => void;
  panel: "create" | "join";
};

export function TeamDialog({ open, session, onActiveTeam, onChange, onClose, panel }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    setName("");
    setCode("");
  }, [open, panel]);

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
      await onChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("team.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{panel === "create" ? t("team.createTeam") : t("team.joinTeam")}</DialogTitle>
          <DialogDescription>{panel === "create" ? t("team.createHint") : t("team.joinHint")}</DialogDescription>
        </DialogHeader>

        {panel === "create" ? (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const next = name.trim();
              if (!next) {
                return;
              }
              void run(async () => {
                const created = await createTeam(session, next);
                onActiveTeam(created.id);
                onClose();
              });
            }}
          >
            <Label htmlFor="team-name">{t("team.name")}</Label>
            <div className="flex gap-2">
              <Input id="team-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t("team.namePlaceholder")} />
              <Button type="submit" disabled={busy || !name.trim()}>
                {t("team.create")}
              </Button>
            </div>
          </form>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const joined = await joinTeam(session, code);
                onActiveTeam(joined.id);
                onClose();
              });
            }}
          >
            <Label htmlFor="team-code">{t("team.code")}</Label>
            <div className="flex gap-2">
              <Input id="team-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("team.joinPlaceholder")} />
              <Button type="submit" variant="outline" disabled={busy || !code.trim()}>
                {t("team.join")}
              </Button>
            </div>
          </form>
        )}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
