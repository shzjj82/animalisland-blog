import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type UIEventHandler,
} from "react";
import { Down } from "@icon-park/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { iconParkOutline } from "@/lib/iconPark";

type Props = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
  onScroll?: UIEventHandler<HTMLDivElement>;
  /** 在底部时内容增高会跟着滚；离开底部后显示回到底部按钮 */
  stickToBottom?: boolean;
  jumpToBottomLabel?: string;
};

const NEAR_BOTTOM = 56;

function nearBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
}

/** 类似 Element Plus el-scrollbar：容器内滚动，悬停 / 滚动时显示细滚动条 */
export const SoftScrollbar = forwardRef<HTMLDivElement, Props>(function SoftScrollbar(
  { children, className, contentClassName, style, onScroll, stickToBottom, jumpToBottomLabel },
  ref,
) {
  const localRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const atBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useImperativeHandle(ref, () => localRef.current as HTMLDivElement);

  const syncJump = useCallback(() => {
    const el = localRef.current;
    if (!el) {
      return;
    }
    const near = nearBottom(el);
    atBottom.current = near;
    setShowJump(Boolean(jumpToBottomLabel) && !near && el.scrollHeight > el.clientHeight + 8);
  }, [jumpToBottomLabel]);

  const follow = useCallback(() => {
    const el = localRef.current;
    if (!el) {
      return;
    }
    if (stickToBottom && atBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
    syncJump();
  }, [stickToBottom, syncJump]);

  useEffect(() => {
    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

  useEffect(() => {
    const el = localRef.current;
    if (!el || typeof ResizeObserver === "undefined") {
      return;
    }
    const ro = new ResizeObserver(() => follow());
    ro.observe(el);
    const view = el.firstElementChild;
    if (view) {
      ro.observe(view);
    }
    follow();
    return () => ro.disconnect();
  }, [follow]);

  const handleScroll: UIEventHandler<HTMLDivElement> = (event) => {
    const el = localRef.current;
    if (el) {
      el.classList.add("is-scrolling");
      if (timer.current != null) {
        window.clearTimeout(timer.current);
      }
      timer.current = window.setTimeout(() => {
        el.classList.remove("is-scrolling");
      }, 800);
    }
    syncJump();
    onScroll?.(event);
  };

  const scrollToBottom = () => {
    const el = localRef.current;
    if (!el) {
      return;
    }
    atBottom.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className={cn("relative min-h-0", className)}>
      <div ref={localRef} className="ws-scrollbar h-full" style={style} onScroll={handleScroll}>
        <div className={cn("ws-scrollbar__view", contentClassName)}>{children}</div>
      </div>
      {jumpToBottomLabel && showJump ? (
        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute bottom-3 left-1/2 z-10 size-8 -translate-x-1/2 rounded-full border border-border/50 shadow-md"
          aria-label={jumpToBottomLabel}
          onClick={scrollToBottom}
        >
          <Down {...iconParkOutline} size={16} />
        </Button>
      ) : null}
    </div>
  );
});
