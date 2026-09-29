import { useTranslation } from "react-i18next";
import { appLocale, type AppLocale } from "@/i18n";
import { cn } from "@/lib/utils";

const LOCALES: { value: AppLocale; label: string }[] = [
  { value: "zh", label: "中" },
  { value: "en", label: "EN" },
];

type Props = {
  onChange: (locale: AppLocale) => void;
};

export function LanguageSwitch({ onChange }: Props) {
  const { t } = useTranslation();
  const locale = appLocale();
  return (
    <span role="radiogroup" aria-label={t("common.language")} className="inline-flex h-8 items-center rounded-md border border-border p-0.5 text-xs">
      {LOCALES.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={locale === item.value}
          className={cn(
            "h-full min-w-8 rounded px-2",
            locale === item.value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => locale !== item.value && onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </span>
  );
}
