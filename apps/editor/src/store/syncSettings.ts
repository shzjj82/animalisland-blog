export type SyncSettings = {
  /** 登录后有待同步内容时弹出同步提示；与提示里的「下次不再弹出」互为反向 */
  enabled: boolean;
};

const SETTINGS_KEY = "editor:sync-settings";

export function readSyncSettings(): SyncSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { enabled?: boolean; prompt?: boolean };
    return { enabled: parsed.enabled !== false && parsed.prompt !== false };
  } catch {
    return { enabled: true };
  }
}

export function writeSyncSettings(settings: SyncSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
