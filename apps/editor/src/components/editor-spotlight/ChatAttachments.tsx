import { Close } from "@icon-park/react";
import { AttachFileIcon } from "@/components/file-type-icon";
import {
  downloadTextAttachment,
  type LocalAttachment,
} from "@/lib/ai/chat";
import { attachFileKind, attachFileLabel, fileExtension } from "@/lib/document/fileKinds";
import { iconParkOutline } from "@/lib/iconPark";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

type PendingProps = {
  items: LocalAttachment[];
  onRemove?: (id: string) => void;
  className?: string;
};

/** 发送前的待发附件：缩略图 / 按扩展名上色的文件图标 */
export function PendingAttachments({ items, onRemove, className }: PendingProps) {
  const { t } = useTranslation();
  if (!items.length) {
    return null;
  }
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) =>
        item.kind === "image" ? (
          <span key={item.id} className="relative size-[52px] overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
            <img src={item.url} alt={item.name} className="size-full object-cover" />
            <span className="absolute bottom-0.5 left-0.5 rounded bg-black/60 px-1 py-[1px] text-[9px] font-semibold tracking-wide text-white uppercase">
              {attachFileLabel(attachFileKind(item.name))}
            </span>
            {onRemove ? (
              <button
                type="button"
                className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-black/55 text-white"
                aria-label={t("spotlight.remove", { name: item.name })}
                onClick={() => onRemove(item.id)}
              >
                <Close {...iconParkOutline} size={10} />
              </button>
            ) : null}
          </span>
        ) : (
          <span key={item.id} className="relative flex max-w-[200px] items-center gap-2 rounded-xl border border-border bg-background py-1.5 pr-7 pl-1.5 shadow-sm">
            <AttachFileIcon name={item.name} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{displayName(item.name)}</span>
              <span className="text-muted-foreground block text-[10px] font-medium tracking-wide uppercase">{attachFileLabel(attachFileKind(item.name))}</span>
            </span>
            {onRemove ? (
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground absolute top-1 right-1 grid size-5 place-items-center rounded-full hover:bg-muted"
                aria-label={t("spotlight.remove", { name: item.name })}
                onClick={() => onRemove(item.id)}
              >
                <Close {...iconParkOutline} size={10} />
              </button>
            ) : null}
          </span>
        ),
      )}
    </div>
  );
}

function displayName(name: string): string {
  const ext = fileExtension(name);
  if (!ext) {
    return name;
  }
  const base = name.slice(0, name.length - ext.length - 1);
  return base || name;
}

type BubbleProps = {
  items: LocalAttachment[];
};

/** 气泡内附件：文字下方，可点击下载 */
export function BubbleAttachments({ items }: BubbleProps) {
  const { t } = useTranslation();
  if (!items.length) {
    return null;
  }
  return (
    <div className="editor-spotlight-bubble-attach">
      {items.map((file) =>
        file.kind === "image" ? (
          <a
            key={file.id}
            href={file.url}
            download={file.name}
            target="_blank"
            rel="noreferrer"
            className="editor-spotlight-bubble-attach-item"
            title={t("spotlight.download", { name: file.name })}
          >
            <img src={file.url} alt="" className="size-8 rounded-md object-cover" />
            <span className="min-w-0">
              <span className="block truncate">{displayName(file.name)}</span>
              <span className="text-[10px] uppercase opacity-70">{attachFileLabel(attachFileKind(file.name))}</span>
            </span>
          </a>
        ) : (
          <button
            key={file.id}
            type="button"
            className="editor-spotlight-bubble-attach-item"
            title={t("spotlight.download", { name: file.name })}
            onClick={() => downloadTextAttachment(file)}
          >
            <AttachFileIcon name={file.name} size={28} />
            <span className="min-w-0">
              <span className="block truncate">{displayName(file.name)}</span>
              <span className="text-[10px] uppercase opacity-70">{attachFileLabel(attachFileKind(file.name))}</span>
            </span>
          </button>
        ),
      )}
    </div>
  );
}
