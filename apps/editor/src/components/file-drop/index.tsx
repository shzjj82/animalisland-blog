import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Upload } from "@icon-park/react";
import { cn } from "@/lib/utils";

type Props = {
  /** 没有打开的页面时，松手会新建页面 */
  hasPage: boolean;
  className?: string;
  children: ReactNode;
  onDrop: (files: File[], point: { x: number; y: number }) => void;
};

function carriesFiles(event: DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/** 只接管从系统拖进来的文件；页面树、块排序这些内部拖拽照常放行 */
export function FileDropZone({ hasPage, className, children, onDrop }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  function reset() {
    depth.current = 0;
    setActive(false);
  }

  return (
    <div
      className={cn("relative flex min-h-0 flex-1 flex-col", className)}
      onDragEnterCapture={(event) => {
        if (!carriesFiles(event)) {
          return;
        }
        depth.current += 1;
        setActive(true);
      }}
      onDragLeaveCapture={(event) => {
        if (!carriesFiles(event)) {
          return;
        }
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setActive(false);
        }
      }}
      onDragOverCapture={(event) => {
        if (!carriesFiles(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(event) => {
        if (!carriesFiles(event)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        reset();
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
          onDrop(files, { x: event.clientX, y: event.clientY });
        }
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">{children}</div>
      {active ? (
        <div className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-foreground/30 bg-background/85">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Upload theme="outline" strokeWidth={3} size={18} />
            {hasPage ? t("fileDrop.hint") : t("fileDrop.hintNoPage")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
