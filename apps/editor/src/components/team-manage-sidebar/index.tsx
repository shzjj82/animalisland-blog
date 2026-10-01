import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Close } from "@icon-park/react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { loadTeam, setTeamRole, teamCodeOf, type TeamInfo, type TeamMember, type TeamRole } from "@/store/teamStore";
import type { RemoteSession } from "@/store/remoteStore";

type Props = {
  session: RemoteSession;
  team: TeamInfo;
  onClose: () => void;
  onChanged: () => void;
};

type DetailRow = {
  field: string;
  value: string;
};

function formatTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const ROLES: TeamRole[] = ["owner", "developer", "user"];

function roleLabel(role: TeamRole): "team.roleOwner" | "team.roleDeveloper" | "team.roleUser" {
  if (role === "owner") return "team.roleOwner";
  if (role === "developer") return "team.roleDeveloper";
  return "team.roleUser";
}

export function TeamManageSidebar({ session, team, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [shown, setShown] = useState(team);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const code = teamCodeOf(shown);

  useEffect(() => {
    setShown(team);
    let alive = true;
    void loadTeam(session, team.id)
      .then((detail) => {
        if (!alive) return;
        setShown(detail.team);
        setMembers(detail.members);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : t("team.loadFailed"));
      });
    return () => {
      alive = false;
    };
  }, [session, team, t]);

  const detailRows = useMemo<DetailRow[]>(
    () => [
      { field: t("team.name"), value: shown.name },
      { field: t("team.code"), value: code ?? "—" },
      { field: t("team.id"), value: shown.id },
      { field: t("team.registeredAt"), value: formatTime(shown.createdAt) },
      { field: t("team.updatedAt"), value: formatTime(shown.updatedAt) },
    ],
    [code, shown.createdAt, shown.id, shown.name, shown.updatedAt, t],
  );

  const detailColumns = useMemo<ColumnDef<DetailRow, unknown>[]>(
    () => [
      { accessorKey: "field", header: t("team.field") },
      {
        accessorKey: "value",
        header: t("team.value"),
        cell: ({ row }) =>
          row.original.field === t("team.id") ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate font-mono text-xs">{row.original.value}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(shown.id)}>
                {t("team.copyId")}
              </Button>
            </span>
          ) : (
            <span className={row.original.field === t("team.code") ? "font-mono tracking-[0.2em]" : undefined}>
              {row.original.value}
            </span>
          ),
      },
    ],
    [t, shown.id],
  );

  const memberColumns = useMemo<ColumnDef<TeamMember, unknown>[]>(
    () => [
      { accessorKey: "identifier", header: t("team.member") },
      {
        accessorKey: "createdAt",
        header: t("team.registeredAt"),
        cell: ({ row }) => formatTime(row.original.createdAt),
      },
      {
        accessorKey: "role",
        header: t("team.role"),
        cell: ({ row }) => (
          <select
            className="h-8 rounded-md border border-input bg-background px-2"
            value={row.original.role}
            disabled={busy}
            onChange={(event) => {
              const role = event.target.value as TeamRole;
              const accountId = row.original.accountId;
              setBusy(true);
              setError("");
              void setTeamRole(session, team.id, accountId, role)
                .then(() => {
                  setMembers((prev) => prev.map((item) => (item.accountId === accountId ? { ...item, role } : item)));
                  onChanged();
                })
                .catch((err: unknown) => setError(err instanceof Error ? err.message : t("team.roleFailed")))
                .finally(() => setBusy(false));
            }}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {t(roleLabel(role))}
              </option>
            ))}
          </select>
        ),
      },
    ],
    [busy, onChanged, session, t, team.id],
  );

  return (
    <aside className="fixed top-0 right-0 bottom-0 z-50 flex w-[min(720px,100vw)] flex-col border-l border-border bg-background shadow-[-12px_0_32px_rgb(0_0_0/0.08)]">
      <header className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
        <p className="text-sm font-medium">{team.name}</p>
        <Button type="button" variant="ghost" size="icon" aria-label={t("team.close")} onClick={onClose}>
          <Close theme="outline" strokeWidth={3} size={16} />
        </Button>
      </header>
      <Tabs defaultValue="details" className="min-h-0 flex-1 gap-4 p-5">
        <TabsList>
          <TabsTrigger value="details">{t("team.manageTeam")}</TabsTrigger>
          <TabsTrigger value="members">{t("team.members")}</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <DataTable columns={detailColumns} data={detailRows} />
        </TabsContent>
        <TabsContent value="members" className="grid gap-3">
          <DataTable columns={memberColumns} data={members} empty={t("team.noMembers")} />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </TabsContent>
      </Tabs>
    </aside>
  );
}
