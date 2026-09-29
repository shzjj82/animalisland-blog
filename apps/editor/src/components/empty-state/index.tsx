import { Plus } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

type Props = {
  /** 一篇页面都没有时文案不同 */
  hasPages: boolean;
  onCreate: () => void;
};

function Illustration() {
  return (
    <svg width="220" height="164" viewBox="0 0 220 164" fill="none" aria-hidden="true">
      <ellipse cx="110" cy="146" rx="78" ry="10" fill="#f1f1ef" />
      <g stroke="#191919" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M58 26h72l22 22v86a6 6 0 0 1-6 6H58a6 6 0 0 1-6-6V32a6 6 0 0 1 6-6Z" fill="#fff" />
        <path d="M130 26v16a6 6 0 0 0 6 6h16" fill="#f7f7f5" />
        <path d="M68 58h40M68 72h62M68 86h54M68 100h36" />
        <path d="m150 118 30-30a6.4 6.4 0 0 1 9 9l-30 30-13 4 4-13Z" fill="#fff" />
        <path d="m174 94 9 9" />
        <path d="M34 50v10M29 55h10M180 34v8M176 38h8M166 146h0" />
      </g>
      <circle cx="44" cy="112" r="4" fill="#191919" />
      <circle cx="196" cy="66" r="3" fill="#191919" />
    </svg>
  );
}

export function EmptyState({ hasPages, onCreate }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 pt-10 pb-[12vh] text-center">
      <button
        type="button"
        className="rounded-2xl p-2 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-foreground"
        aria-label={t("common.newPage")}
        onClick={onCreate}
      >
        <Illustration />
      </button>
      <div className="grid gap-1">
        <p className="text-base font-medium">
          {hasPages ? t("emptyState.pickPage") : t("emptyState.noPagesYet")}
        </p>
        <p className="text-sm text-muted-foreground">
          {hasPages
            ? t("emptyState.createHint")
            : t("emptyState.createFirstHint")}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onCreate}>
        <Plus theme="outline" strokeWidth={3} size={16} />
        {t("common.newPage")}
      </Button>
    </div>
  );
}
