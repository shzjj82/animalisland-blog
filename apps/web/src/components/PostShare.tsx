import { Check, Copy, ShareOne } from "@icon-park/react";
import { useEffect, useId, useRef, useState } from "react";
import { iconParkOutline } from "@/lib/iconPark";

type Props = {
  title: string;
  summary?: string;
  url: string;
};

export function PostShare({ title, summary, url }: Props) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setOpen(false);
    } catch {
      // 旧浏览器：选中临时输入框
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      setCopied(true);
      setOpen(false);
    }
  };

  const shareNative = async () => {
    try {
      await navigator.share({
        title,
        text: summary?.trim() || title,
        url,
      });
      setOpen(false);
    } catch (err) {
      // 用户取消不算失败
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      await copyLink();
    }
  };

  return (
    <div className="post-share" ref={rootRef}>
      <button
        type="button"
        className="post-share-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <ShareOne {...iconParkOutline} size={14} aria-hidden />
        <span>{copied ? "已复制链接" : "分享"}</span>
        {copied ? <Check {...iconParkOutline} size={13} aria-hidden /> : null}
      </button>

      {open ? (
        <div className="post-share-menu" id={menuId} role="menu">
          <button type="button" className="post-share-item" role="menuitem" onClick={() => void copyLink()}>
            <Copy {...iconParkOutline} size={14} aria-hidden />
            复制链接
          </button>
          {canNativeShare ? (
            <button
              type="button"
              className="post-share-item"
              role="menuitem"
              onClick={() => void shareNative()}
            >
              <ShareOne {...iconParkOutline} size={14} aria-hidden />
              系统分享
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
