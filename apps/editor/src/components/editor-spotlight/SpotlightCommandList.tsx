import type { ReactNode } from "react";
import { Comment, Notes } from "@icon-park/react";
import { iconParkOutline } from "@/lib/iconPark";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export type SpotlightCommandItem = {
  id: string;
  kind: "action" | "page";
  title: string;
  subtitle?: ReactNode;
};

type Props = {
  items: SpotlightCommandItem[];
  active: number;
  loading?: boolean;
  onActiveChange: (index: number) => void;
  onSelect: (item: SpotlightCommandItem) => void;
};

const GROUP_LABEL = { action: "spotlight.commands", page: "spotlight.pages" } as const;

export function SpotlightCommandList({ items, active, loading, onActiveChange, onSelect }: Props) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="editor-spotlight-list" role="listbox">
        {items.length === 0 ? (
          <li className="editor-spotlight-empty">
            {loading ? t("spotlight.searchingPages") : t("spotlight.noMatchingCommandsOrPages")}
          </li>
        ) : (
          items.map((item, index) => (
            <li key={`${item.kind}:${item.id}`}>
              {index === 0 || items[index - 1].kind !== item.kind ? (
                <p className="editor-spotlight-group">{t(GROUP_LABEL[item.kind])}</p>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={cn("editor-spotlight-item", item.kind === "page" && "is-page", index === active && "is-active")}
                onMouseEnter={() => onActiveChange(index)}
                onClick={() => onSelect(item)}
              >
                <span className="editor-spotlight-item-icon" aria-hidden>
                  {item.kind === "page" ? <Notes {...iconParkOutline} size={18} /> : <Comment {...iconParkOutline} size={28} />}
                </span>
                <span className="editor-spotlight-item-copy">
                  <span className="editor-spotlight-item-title">{item.title}</span>
                  {item.subtitle ? <span className="editor-spotlight-item-sub">{item.subtitle}</span> : null}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
      <p className="editor-spotlight-foot">{t("spotlight.keyboardHint")}</p>
    </>
  );
}
