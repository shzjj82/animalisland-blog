import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type UpdateHandle = {
  version: string;
  currentVersion: string;
  body?: string;
  downloadAndInstall: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>;
  close: () => Promise<void>;
};

type Phase = "idle" | "checking" | "current" | "ready" | "downloading" | "installing" | "error";

function isDesktopApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function relaunchApp(): Promise<void> {
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

async function lookForUpdate(): Promise<UpdateHandle | null> {
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

const CheckContext = createContext<(() => void) | null>(null);

/**
 * 桌面安装包里检查 OSS 上的 latest.json。
 * 入口不画在页面上，由菜单栏和用户菜单调用 check。发现新版本时才弹出安装对话框。
 */
export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const desktop = isDesktopApp();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<UpdateHandle | null>(null);
  const updateRef = useRef<UpdateHandle | null>(null);
  const [percent, setPercent] = useState(0);
  const [gotBytes, setGotBytes] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [message, setMessage] = useState("");

  const remember = useCallback((next: UpdateHandle | null) => {
    updateRef.current = next;
    setUpdate(next);
  }, []);

  const closeUpdate = useCallback(async () => {
    const current = updateRef.current;
    remember(null);
    setOpen(false);
    setPhase("idle");
    if (current) {
      await current.close().catch(() => undefined);
    }
  }, [remember]);

  const checkNow = useCallback(async () => {
    setMessage("");
    setPhase("checking");
    setOpen(true);
    const previous = updateRef.current;
    remember(null);
    if (previous) {
      await previous.close().catch(() => undefined);
    }
    try {
      const found = await lookForUpdate();
      if (!found) {
        setPhase("current");
        return;
      }
      remember(found);
      setPhase("ready");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("appUpdate.failed"));
      setPhase("error");
    }
  }, [remember, t]);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let cancelled = false;
    void lookForUpdate()
      .then((found) => {
        if (cancelled || !found) {
          return;
        }
        remember(found);
        setPhase("ready");
        setOpen(true);
      })
      .catch(() => {
        // 启动时连不上更新清单就保持安静，手动检查再提示
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, remember]);

  useEffect(() => {
    if (!desktop) {
      return;
    }
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) => listen("app-update-check", () => void checkNow()))
      .then((stop) => {
        if (cancelled) {
          void stop();
          return;
        }
        unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [checkNow, desktop]);

  const install = async () => {
    if (!update) {
      return;
    }
    setPhase("downloading");
    setPercent(0);
    setGotBytes(0);
    setTotalBytes(0);
    try {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data?.contentLength ?? 0;
          setTotalBytes(total);
        }
        if (event.event === "Progress") {
          got += event.data?.chunkLength ?? 0;
          setGotBytes(got);
          setPercent(total > 0 ? Math.min(99, Math.round((got / total) * 100)) : 0);
        }
        if (event.event === "Finished") {
          setPercent(100);
          if (total > 0) setGotBytes(total);
        }
      });
      setPhase("installing");
      await relaunchApp();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("appUpdate.failed"));
      setPhase("error");
    }
  };

  return (
    <CheckContext.Provider value={desktop ? () => void checkNow() : null}>
      {children}
      {desktop ? (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next && phase !== "downloading" && phase !== "installing") {
              void closeUpdate();
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {phase === "checking" ? t("appUpdate.checking") : null}
                {phase === "current" ? t("appUpdate.upToDate") : null}
                {phase === "ready" && update ? t("appUpdate.available", { version: update.version }) : null}
                {phase === "downloading" ? t("appUpdate.downloading", { percent }) : null}
                {phase === "installing" ? t("appUpdate.installing") : null}
                {phase === "error" ? t("appUpdate.failedTitle") : null}
              </DialogTitle>
              <DialogDescription>
                {phase === "ready" ? update?.body || t("appUpdate.notes") : null}
                {phase === "error" ? message : null}
                {phase === "current" ? t("appUpdate.upToDateHint") : null}
                {phase === "downloading"
                  ? totalBytes > 0
                    ? t("appUpdate.downloadingHint", { got: formatBytes(gotBytes), total: formatBytes(totalBytes) })
                    : t("appUpdate.downloadingUnknown")
                  : null}
              </DialogDescription>
            </DialogHeader>
            {phase === "downloading" || phase === "installing" ? (
              <div
                className="bg-muted h-2 w-full overflow-hidden rounded-full"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={phase === "installing" ? 100 : percent}
              >
                {phase === "downloading" && totalBytes <= 0 && percent <= 0 ? (
                  <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
                ) : (
                  <div
                    className="bg-primary h-full rounded-full transition-[width] duration-200"
                    style={{ width: `${phase === "installing" ? 100 : Math.max(percent, 2)}%` }}
                  />
                )}
              </div>
            ) : null}
            <DialogFooter>
              {phase === "ready" ? (
                <>
                  <Button type="button" variant="outline" onClick={() => void closeUpdate()}>
                    {t("appUpdate.later")}
                  </Button>
                  <Button type="button" onClick={() => void install()}>
                    {t("appUpdate.install")}
                  </Button>
                </>
              ) : null}
              {phase === "current" || phase === "error" ? (
                <Button type="button" onClick={() => void closeUpdate()}>
                  {t("appUpdate.close")}
                </Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </CheckContext.Provider>
  );
}

/** 网页版没有更新通道，调用处什么都不渲染 */
export function CheckUpdateSlot({ children }: { children: (check: () => void) => ReactNode }) {
  const check = useContext(CheckContext);
  if (!check) {
    return null;
  }
  return children(check);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}
