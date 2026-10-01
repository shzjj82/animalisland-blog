import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  canWriteTeam,
  createTeam,
  joinTeam,
  leaveTeam,
  loadTeam,
  setTeamRole,
  teamCodeOf,
  type TeamInfo,
  type TeamMember,
  type TeamRole,
} from "@/store/teamStore";
import type { RemoteSession } from "@/store/remoteStore";

type Props = {
  open: boolean;
  session: RemoteSession;
  teams: TeamInfo[];
  activeTeamId: string | null;
  pageTeamId?: string | null;
  onActiveTeam: (id: string | null) => void;
  onAssignPage?: (teamId: string | null) => void;
  onChange: () => Promise<void> | void;
  onClose: () => void;
  panel: "create" | "join";
};

const ROLES: TeamRole[] = ["owner", "developer", "user"];

function roleLabel(role: TeamRole): "team.roleOwner" | "team.roleDeveloper" | "team.roleUser" {
  if (role === "owner") {
    return "team.roleOwner";
  }
  if (role === "developer") {
    return "team.roleDeveloper";
  }
  return "team.roleUser";
}

export function TeamDialog({
  open,
  session,
  teams,
  activeTeamId,
  pageTeamId,
  onActiveTeam,
  onAssignPage,
  onChange,
  onClose,
  panel,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = teams.find((team) => team.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) {
      return;
    }
    setError("");
    setSelectedId((current) => current ?? teams[0]?.id ?? null);
  }, [open, teams]);

  useEffect(() => {
    if (!open || !selectedId) {
      setMembers([]);
      return;
    }
    let alive = true;
    void loadTeam(session, selectedId)
      .then((detail) => {
        if (alive) {
          setMembers(detail.members);
        }
      })
      .catch((err: unknown) => {
        if (alive) {
          setError(err instanceof Error ? err.message : t("team.loadFailed"));
        }
      });
    return () => {
      alive = false;
    };
  }, [open, selectedId, session, t]);

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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{panel === "create" ? t("team.createTeam") : t("team.joinTeam")}</DialogTitle>
          <DialogDescription>{t("team.description")}</DialogDescription>
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
              setName("");
              setSelectedId(created.id);
              onActiveTeam(created.id);
              onClose();
            });
          }}
        >
          <Label htmlFor="team-name">{t("team.createTeam")}</Label>
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
              const joined = await joinTeam(session, teams, code);
              setCode("");
              setSelectedId(joined.id);
              onActiveTeam(joined.id);
              onClose();
            });
          }}
        >
          <Label htmlFor="team-code">{t("team.joinTeam")}</Label>
          <div className="flex gap-2">
            <Input id="team-code" value={code} onChange={(event) => setCode(event.target.value)} placeholder={t("team.joinPlaceholder")} />
            <Button type="submit" variant="outline" disabled={busy || !code.trim()}>
              {t("team.join")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("team.joinHint")}</p>
        </form>
        )}

        {teams.length === 0 ? <p className="text-sm text-muted-foreground">{t("team.empty")}</p> : null}
        <ul className="grid gap-2">
          {teams.map((team) => {
            const invite = teamCodeOf(team);
            const openDetail = selectedId === team.id;
            return (
              <li key={team.id} className="rounded-lg border border-border p-3">
                <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setSelectedId(openDetail ? null : team.id)}>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{team.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {t(roleLabel(team.role))}
                      {invite ? ` · ${invite}` : ""}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">{openDetail ? t("team.collapse") : t("team.members")}</span>
                </button>
                {openDetail && selected ? (
                  <div className="mt-3 grid gap-2">
                    {invite ? <p className="font-mono text-lg tracking-[0.3em]">{invite}</p> : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void navigator.clipboard.writeText(team.id)}
                      >
                        {t("team.copyId")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={activeTeamId === team.id ? "default" : "outline"}
                        disabled={!canWriteTeam(team.role)}
                        onClick={() => onActiveTeam(activeTeamId === team.id ? null : team.id)}
                      >
                        {activeTeamId === team.id ? t("team.writingHere") : t("team.writeHere")}
                      </Button>
                      {onAssignPage ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canWriteTeam(team.role)}
                          onClick={() => onAssignPage(pageTeamId === team.id ? null : team.id)}
                        >
                          {pageTeamId === team.id ? t("team.unassignPage") : t("team.assignPage")}
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run(() => leaveTeam(session, team.id))}>
                        {t("team.leave")}
                      </Button>
                    </div>
                    <ul className="grid gap-1">
                      {members.map((member) => (
                        <li key={member.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="truncate">{member.identifier}</span>
                          {team.role === "owner" ? (
                            <select
                              className="h-8 rounded-md border border-input bg-background px-2"
                              value={member.role}
                              disabled={busy}
                              onChange={(event) => {
                                const role = event.target.value as TeamRole;
                                void run(async () => {
                                  await setTeamRole(session, team.id, member.accountId, role);
                                  setMembers((prev) => prev.map((item) => (item.accountId === member.accountId ? { ...item, role } : item)));
                                });
                              }}
                            >
                              {ROLES.map((role) => (
                                <option key={role} value={role}>
                                  {t(roleLabel(role))}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-muted-foreground">{t(roleLabel(member.role))}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
