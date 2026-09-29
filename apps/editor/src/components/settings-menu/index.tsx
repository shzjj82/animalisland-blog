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
  loggedIn: boolean;
  onLogout: () => void;
  onChangePassword: () => void;
};

export function SettingsMenu({ settings, onChange, loggedIn, onLogout, onChangePassword }: Props) {
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
        {loggedIn ? <PopoverSeparator /> : null}
        {loggedIn ? (
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
        ) : null}
        {loggedIn ? (
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
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
