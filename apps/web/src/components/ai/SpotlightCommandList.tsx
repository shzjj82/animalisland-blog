import { Robot } from "@icon-park/react";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";

export type SpotlightCommandItem = {
  id: string;
  title: string;
  subtitle?: string;
};

type Props = {
  items: SpotlightCommandItem[];
  active: number;
  onActiveChange: (index: number) => void;
  onSelect: (item: SpotlightCommandItem) => void;
};

export function SpotlightCommandList({ items, active, onActiveChange, onSelect }: Props) {
  return (
    <>
      <ul className="editor-spotlight-list" role="listbox">
        {items.length === 0 ? (
          <li className="editor-spotlight-empty">没有匹配的命令</li>
        ) : (
          items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                className={cn("editor-spotlight-item", index === active && "is-active")}
                onMouseEnter={() => onActiveChange(index)}
                onClick={() => onSelect(item)}
              >
                <span className="editor-spotlight-item-icon" aria-hidden>
                  <Robot {...iconParkOutline} size={28} />
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
      <p className="editor-spotlight-foot">↑↓ 选择 · Enter 进入 · Esc 关闭</p>
    </>
  );
}
