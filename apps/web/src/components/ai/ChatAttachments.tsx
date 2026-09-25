import { Close, FileText, Pic } from "@icon-park/react";
import {
  downloadTextAttachment,
  type LocalAttachment,
} from "@/lib/aiChat";
import { iconParkOutline } from "@/lib/iconPark";

type PendingProps = {
  items: LocalAttachment[];
  onRemove: (id: string) => void;
};

/** 发送前的待发附件条 */
export function PendingAttachments({ items, onRemove }: PendingProps) {
  if (!items.length) {
    return null;
  }
  return (
    <div className="editor-spotlight-attach">
      {items.map((item) => (
        <span key={item.id} className="editor-spotlight-attach-chip">
          <span className="editor-spotlight-attach-icon" aria-hidden>
            {item.kind === "image" ? (
              <Pic {...iconParkOutline} size={14} />
            ) : (
              <FileText {...iconParkOutline} size={14} />
            )}
          </span>
          <span className="truncate">{item.name}</span>
          <button type="button" aria-label={`移除 ${item.name}`} onClick={() => onRemove(item.id)}>
            <Close {...iconParkOutline} size={12} />
          </button>
        </span>
      ))}
    </div>
  );
}

type BubbleProps = {
  items: LocalAttachment[];
};

/** 气泡内附件：文字下方，可点击下载 */
export function BubbleAttachments({ items }: BubbleProps) {
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
            title={`下载 ${file.name}`}
          >
            <span className="editor-spotlight-bubble-attach-icon" aria-hidden>
              <Pic {...iconParkOutline} size={16} />
            </span>
            <span className="truncate">{file.name}</span>
          </a>
        ) : (
          <button
            key={file.id}
            type="button"
            className="editor-spotlight-bubble-attach-item"
            title={`下载 ${file.name}`}
            onClick={() => downloadTextAttachment(file)}
          >
            <span className="editor-spotlight-bubble-attach-icon" aria-hidden>
              <FileText {...iconParkOutline} size={16} />
            </span>
            <span className="truncate">{file.name}</span>
          </button>
        ),
      )}
    </div>
  );
}
