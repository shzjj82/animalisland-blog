export type SkillName = "shell" | "open" | "read_file";
export type SkillScope = "files" | "open" | "shell";

export type SkillCall = {
  name: SkillName;
  args: Record<string, string>;
};

export type SkillGrants = {
  files: boolean;
  open: boolean;
  shell: boolean;
};

const GRANT_KEY = "editor:ai-skill-grants";

export const EMPTY_GRANTS: SkillGrants = { files: false, open: false, shell: false };

export function skillScope(name: SkillName): SkillScope {
  if (name === "read_file") {
    return "files";
  }
  return name;
}

export function loadSkillGrants(): SkillGrants {
  try {
    const raw = localStorage.getItem(GRANT_KEY);
    if (!raw) {
      return { ...EMPTY_GRANTS };
    }
    const parsed = JSON.parse(raw) as Partial<SkillGrants>;
    return {
      files: Boolean(parsed.files),
      open: Boolean(parsed.open),
      shell: Boolean(parsed.shell),
    };
  } catch {
    return { ...EMPTY_GRANTS };
  }
}

export function saveSkillGrants(grants: SkillGrants) {
  localStorage.setItem(GRANT_KEY, JSON.stringify(grants));
}

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function desktopInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    return Promise.reject(new Error("DESKTOP_ONLY"));
  }
  return internals.invoke(cmd, args) as Promise<T>;
}

export function isDesktopApp(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  return Boolean(internals?.invoke);
}

/** 从模型回复里抽出 ```skill 代码块，正文里不再展示这段 JSON */
export function extractSkills(reply: string): { text: string; skills: SkillCall[] } {
  const skills: SkillCall[] = [];
  const text = reply.replace(/```skill\s*([\s\S]*?)```/gi, (_all, body: string) => {
    for (const item of parseSkillBody(String(body))) {
      skills.push(item);
    }
    return "";
  });
  return { text: text.trim(), skills };
}

function parseSkillBody(body: string): SkillCall[] {
  const raw = body.trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const skills: SkillCall[] = [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const row = item as { name?: unknown; command?: unknown; target?: unknown; path?: unknown };
      const name = String(row.name ?? "").trim();
      if (name === "shell" && typeof row.command === "string" && row.command.trim()) {
        skills.push({ name: "shell", args: { command: row.command.trim() } });
      } else if (name === "open" && typeof row.target === "string" && row.target.trim()) {
        skills.push({ name: "open", args: { target: row.target.trim() } });
      } else if (name === "read_file" && typeof row.path === "string" && row.path.trim()) {
        skills.push({ name: "read_file", args: { path: row.path.trim() } });
      }
    }
    return skills;
  } catch {
    return [];
  }
}

export function skillPreview(call: SkillCall): string {
  if (call.name === "shell") {
    return call.args.command ?? "";
  }
  if (call.name === "open") {
    return call.args.target ?? "";
  }
  return call.args.path ?? "";
}

export async function runSkill(call: SkillCall): Promise<string> {
  if (call.name === "shell") {
    return desktopInvoke<string>("run_ai_command", { command: call.args.command ?? "" });
  }
  if (call.name === "open") {
    await desktopInvoke("open_ai_target", { target: call.args.target ?? "" });
    return "opened";
  }
  return desktopInvoke<string>("read_ai_file", { path: call.args.path ?? "" });
}

export const SKILL_SYSTEM = `若用户明确要求操作本机（打开链接/文件、读取本地文件、执行命令），在回答末尾另起一个 skill 代码块，不要把 JSON 混进正文：
\`\`\`skill
{"name":"open","target":"https://example.com"}
\`\`\`
name 只能是 open（打开网址或本机路径）、read_file（读文本文件，path 为绝对路径）、shell（执行一条本机命令，command 为完整命令）。
不要主动执行危险命令。用户没要求操作本机时不要输出 skill 块。`;
