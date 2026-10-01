import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Logout, More } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverSeparator, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { SyncSettings } from "@/store/syncSettings";

const iconProps = { theme: "outline" as const, strokeWidth: 3, size: 16 };

type Props = {
  settings: SyncSettings;
  onChange: (settings: SyncSettings) => void;
  onLogout: () => void;
  onChangePassword: () => void;
  onCreateTeam: () => void;
  onJoinTeam: () => void;
  onToggleTeamMode: () => void;
  teamMode: boolean;
  canSwitchTeam: boolean;
  canManageTeam: boolean;
  onManageTeam: () => void;
};

/** 只在登录后出现：创建/加入团队、切换团队模式、同步、改密码、退出 */
export function SettingsMenu({
  settings,
  onChange,
  onLogout,
  onChangePassword,
  onCreateTeam,
  onJoinTeam,
  onToggleTeamMode,
  teamMode,
  canSwitchTeam,
  canManageTeam,
  onManageTeam,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={t("settingsMenu.settings")}>
          <More {...iconProps} />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-48">
        <Label className="flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 font-normal hover:bg-muted">
          {t("settingsMenu.allowSync")}
          <Switch checked={settings.enabled} onCheckedChange={(enabled) => onChange({ enabled })} />
        </Label>
        <PopoverSeparator />
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
          onClick={() => {
            setOpen(false);
            onCreateTeam();
          }}
        >
          {t("team.createTeam")}
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
          onClick={() => {
            setOpen(false);
            onJoinTeam();
          }}
        >
          {t("team.joinTeam")}
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canSwitchTeam}
          title={canSwitchTeam ? undefined : t("team.switchDisabled")}
          onClick={() => {
            setOpen(false);
            onToggleTeamMode();
          }}
        >
          {teamMode ? t("team.personalMode") : t("team.switchMode")}
        </button>
        {canManageTeam ? (
          <button
            type="button"
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
            onClick={() => {
              setOpen(false);
              onManageTeam();
            }}
          >
            {t("team.manageTeam")}
          </button>
        ) : null}
        <PopoverSeparator />
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-muted"
          onClick={() => {
            setOpen(false);
            onChangePassword();
          }}
        >
          <Lock {...iconProps} size={14} />
          {t("common.changePassword")}
        </button>
        <button
          type="button"
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-destructive hover:bg-muted"
          onClick={() => {
            setOpen(false);
            onLogout();
          }}
        >
          <Logout {...iconProps} size={14} />
          {t("settingsMenu.logOut")}
        </button>
      </PopoverContent>
    </Popover>
  );
}
