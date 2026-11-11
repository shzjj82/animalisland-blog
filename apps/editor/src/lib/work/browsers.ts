import { isDesktopApp } from "@/lib/ai/skills";

export type InstalledBrowser = {
  id: string;
  name: string;
  installed: boolean;
  supported: boolean;
};

type TauriInternals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const internals = (window as Window & { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    return Promise.reject(new Error("DESKTOP_ONLY"));
  }
  return internals.invoke(cmd, args) as Promise<T>;
}

export async function listInstalledBrowsers(): Promise<InstalledBrowser[]> {
  if (!isDesktopApp()) {
    return [];
  }
  try {
    return await invoke<InstalledBrowser[]>("list_installed_browsers");
  } catch {
    return [];
  }
}

export async function openInstalledBrowser(id: string, url?: string): Promise<void> {
  await invoke("open_installed_browser", { id, url });
}

export async function revealWorkExtension(): Promise<string> {
  return invoke<string>("reveal_work_extension");
}
