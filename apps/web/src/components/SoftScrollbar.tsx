import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type CSSProperties,
  type ReactNode,
  type UIEventHandler,
} from "react";
import { cn } from "@/lib/utils";

type Props = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
  onScroll?: UIEventHandler<HTMLDivElement>;
};

/** 类似 Element Plus el-scrollbar：容器内滚动，悬停 / 滚动时显示细滚动条 */
export const SoftScrollbar = forwardRef<HTMLDivElement, Props>(function SoftScrollbar(
  { children, className, contentClassName, style, onScroll },
  ref,
) {
  const localRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  useImperativeHandle(ref, () => localRef.current as HTMLDivElement);

  useEffect(() => {
    return () => {
      if (timer.current != null) {
        window.clearTimeout(timer.current);
      }
    };
  }, []);

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
    onScroll?.(event);
  };

  return (
    <div ref={localRef} className={cn("ws-scrollbar", className)} style={style} onScroll={handleScroll}>
      <div className={cn("ws-scrollbar__view", contentClassName)}>{children}</div>
    </div>
  );
});
