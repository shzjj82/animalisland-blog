import { runSkill, skillPreview, type SkillCall } from "@/lib/ai/skills";

export type SkillObservation = {
  ok: boolean;
  needsUser: boolean;
  detail: string;
};

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function clip(text: string, max = 500): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

/** 截当前屏幕。调用方决定什么时候需要看画面，这里不判断任务。 */
export async function captureLook(): Promise<string> {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    throw new Error("DESKTOP_ONLY");
  }
  const url = await internals.invoke("capture_screen");
  if (typeof url !== "string" || !url.startsWith("data:image/")) {
    throw new Error("SCREEN_CAPTURE_FAILED");
  }
  return url;
}

/** 执行一次技能。打开页面只记录系统是否接受，画面是否符合预期交给截图核对。 */
export async function observeSkill(call: SkillCall): Promise<SkillObservation> {
  try {
    const output = await runSkill(call);
    if (call.name === "open") {
      return {
        ok: true,
        needsUser: false,
        detail: `已交给系统打开 ${call.args.target ?? ""}。页面内容这次不截图。`,
      };
    }
    if (call.name === "read_file") {
      const text = output.trim();
      if (!text) {
        return { ok: false, needsUser: false, detail: `已读取 ${call.args.path ?? ""}，内容是空的。` };
      }
      return { ok: true, needsUser: false, detail: `已读取 ${call.args.path ?? ""}，${text.length} 字：\n${clip(text, 400)}` };
    }
    const text = clip(output);
    if (/^exit /.test(text)) {
      return { ok: false, needsUser: false, detail: text || "命令失败，没有输出。" };
    }
    return { ok: true, needsUser: false, detail: text || "命令已执行，没有输出。" };
  } catch (err) {
    return { ok: false, needsUser: false, detail: err instanceof Error ? err.message : "执行失败" };
  }
}

export function skillKey(call: SkillCall): string {
  return `${call.name}\u0000${skillPreview(call)}`;
}
