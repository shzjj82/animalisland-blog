import { t } from "@/i18n";
import { request, type RemoteSession } from "./remoteStore";

export type TeamRole = "owner" | "developer" | "user";

export type TeamInfo = {
  id: string;
  name: string;
  /** 接口返回的团队码，用来邀请别人加入 */
  code: string | null;
  description: string | null;
  role: TeamRole;
  createdAt: string;
  updatedAt: string;
};

export type TeamMember = {
  id: string;
  accountId: string;
  identifier: string;
  role: TeamRole;
  createdAt: string;
};

const CODE_RE = /^[A-Z0-9]{6}$/;
const ACTIVE_KEY = "editor:active-team";

/** 旧数据把团队码写在 description 里；新数据以接口的 code 为准 */
function legacyCode(description: string | null): string | null {
  const text = description?.trim().toUpperCase() ?? "";
  return CODE_RE.test(text) ? text : null;
}

export function canWriteTeam(role: TeamRole | undefined): boolean {
  return role === "owner" || role === "developer";
}

/** 只有拥有者能管理成员角色 */
export function canManageTeam(role: TeamRole | undefined): boolean {
  return role === "owner";
}

export function readActiveTeamId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function writeActiveTeamId(id: string | null): void {
  if (id) {
    localStorage.setItem(ACTIVE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isRole(value: unknown): value is TeamRole {
  return value === "owner" || value === "developer" || value === "user";
}

function toTeam(raw: unknown): TeamInfo | null {
  const row = asRecord(raw);
  const id = typeof row.id === "string" ? row.id : "";
  if (!id || !isRole(row.role)) {
    return null;
  }
  const description = typeof row.description === "string" ? row.description : null;
  const rawCode = row.code ?? row.teamCode ?? row.inviteCode;
  const code = typeof rawCode === "string" && rawCode.trim() ? rawCode.trim() : legacyCode(description);
  return {
    id,
    name: typeof row.name === "string" && row.name.trim() ? row.name : t("team.untitled"),
    code,
    description,
    role: row.role,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : "",
  };
}

function toMember(raw: unknown): TeamMember | null {
  const row = asRecord(raw);
  const id = typeof row.id === "string" ? row.id : "";
  const accountId = typeof row.accountId === "string" ? row.accountId : "";
  if (!id || !accountId || !isRole(row.role)) {
    return null;
  }
  return {
    id,
    accountId,
    identifier: typeof row.identifier === "string" && row.identifier ? row.identifier : accountId.slice(0, 8),
    role: row.role,
    createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
  };
}

export async function listTeams(session: RemoteSession): Promise<TeamInfo[]> {
  const data = await request<unknown>(session, "GET", "/teams");
  const rows = Array.isArray(data) ? data : (asRecord(data).teams ?? asRecord(data).items ?? []);
  return (Array.isArray(rows) ? rows : []).map(toTeam).filter((item): item is TeamInfo => item !== null);
}

function readTeam(data: unknown): TeamInfo | null {
  return toTeam(data) ?? toTeam(asRecord(data).team);
}

export async function createTeam(session: RemoteSession, name: string): Promise<TeamInfo> {
  const data = await request<unknown>(session, "POST", "/teams", {
    name: name.trim(),
  });
  const team = readTeam(data);
  if (!team) {
    throw new Error(t("team.createFailed"));
  }
  return team;
}

/** 用接口下发的团队码加入，不在本地团队列表里反查 id */
export async function joinTeam(session: RemoteSession, raw: string): Promise<TeamInfo> {
  const code = raw.trim();
  if (!code) {
    throw new Error(t("team.badCode"));
  }
  const data = await request<unknown>(session, "POST", `/teams/${encodeURIComponent(code)}/join`);
  const team = readTeam(data);
  if (!team) {
    throw new Error(t("team.joinFailed"));
  }
  return team;
}

export async function leaveTeam(session: RemoteSession, id: string): Promise<void> {
  await request(session, "POST", `/teams/${id}/leave`);
}

export async function loadTeam(session: RemoteSession, id: string): Promise<{ team: TeamInfo; members: TeamMember[] }> {
  const data = asRecord(await request<unknown>(session, "GET", `/teams/${id}`));
  const team = toTeam(data.team);
  if (!team) {
    throw new Error(t("team.loadFailed"));
  }
  const members = (Array.isArray(data.members) ? data.members : []).map(toMember).filter((item): item is TeamMember => item !== null);
  return { team, members };
}

export async function setTeamRole(
  session: RemoteSession,
  teamId: string,
  accountId: string,
  role: TeamRole,
): Promise<TeamMember> {
  const member = toMember(await request<unknown>(session, "PATCH", `/teams/${teamId}/members/${accountId}`, { role }));
  if (!member) {
    throw new Error(t("team.roleFailed"));
  }
  return member;
}
