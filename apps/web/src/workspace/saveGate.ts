/** 工作区打开页的 autosave 闸门：侧栏改父文前先挂起，避免冲掉 pageLink */

type SaveGate = {
  /** 取消定时 autosave、作废进行中的保存，并等到当前写入结束（若已作废则不会再写库） */
  suspend: () => Promise<void>;
};

let gate: SaveGate | null = null;

export function registerWorkspaceSaveGate(next: SaveGate | null): void {
  gate = next;
}

export async function suspendWorkspaceAutosave(): Promise<void> {
  await gate?.suspend();
}
