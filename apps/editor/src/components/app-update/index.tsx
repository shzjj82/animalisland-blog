import { useEffect, useState } from "react";
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

/** 桌面安装包里检查 OSS 上的 latest.json，下载签名包并安装 */
export function AppUpdate() {
  const { t } = useTranslation();
  const desktop = isDesktopApp();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [update, setUpdate] = useState<UpdateHandle | null>(null);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState("");

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
        setUpdate(found);
        setPhase("ready");
        setOpen(true);
      })
      .catch(() => {
        // 启动时连不上更新清单就保持安静，手动检查再提示
      });
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  if (!desktop) {
    return null;
  }

  const closeUpdate = async () => {
    const current = update;
    setUpdate(null);
    setOpen(false);
    setPhase("idle");
    if (current) {
      await current.close().catch(() => undefined);
    }
  };

  const checkNow = async () => {
    setMessage("");
    setPhase("checking");
    setOpen(true);
    try {
      if (update) {
        await update.close().catch(() => undefined);
        setUpdate(null);
      }
      const found = await lookForUpdate();
      if (!found) {
        setPhase("current");
        return;
      }
      setUpdate(found);
      setPhase("ready");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : t("appUpdate.failed"));
      setPhase("error");
    }
  };

  const install = async () => {
    if (!update) {
      return;
    }
    setPhase("downloading");
    setPercent(0);
    try {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data?.contentLength ?? 0;
        }
        if (event.event === "Progress") {
          got += event.data?.chunkLength ?? 0;
          setPercent(total > 0 ? Math.min(99, Math.round((got / total) * 100)) : 0);
        }
        if (event.event === "Finished") {
          setPercent(100);
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
    <>
      <Button type="button" variant="ghost" size="sm" className="h-7 w-full justify-start px-2 text-xs" onClick={() => void checkNow()}>
        {t("appUpdate.check")}
      </Button>
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
            </DialogDescription>
          </DialogHeader>
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
    </>
  );
}
