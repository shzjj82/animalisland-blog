import { useEffect, useRef, useState } from "react";

/**
 * 可视视口（visual viewport）在布局视口里的位置和高度。
 *
 * - height：键盘上方的可视高度（键盘弹出时 = 屏幕顶到键盘上沿）
 * - top：可视视口相对布局视口的偏移。文档不可滚动时，iOS 露出光标靠的是
 *   平移可视视口（offsetTop > 0），此时 fixed 元素必须跟着 top 走，
 *   否则外壳整体上移、底部露出一条空白（表现为“键盘不占高度”）。
 *
 * 外壳定位 = top + height，永远精确覆盖用户看到的那块区域。
 */
export interface ViewportBox {
  top: number;
  height: number;
  /** 键盘是否在屏幕上。用「当前可视高度 vs 见过的最大可视高度」判定，
      不受 iOS 平移可视视口（offsetTop）影响 */
  keyboardOpen: boolean;
}

function readViewportBox(): { top: number; height: number } {
  const vp = window.visualViewport;
  if (!vp) {
    return { top: 0, height: Math.round(window.innerHeight) };
  }
  return { top: Math.round(vp.offsetTop), height: Math.round(vp.height) };
}

export function useVisualViewport(): ViewportBox {
  const first = readViewportBox();
  const [box, setBox] = useState<ViewportBox>({ top: 0, height: first.height, keyboardOpen: false });
  /** 键盘收起时的可视高度（见过的最大值）；横竖屏切换时重设 */
  const fullRef = useRef(first.height);
  const widthRef = useRef(window.innerWidth);
  const frameRef = useRef(0);

  useEffect(() => {
    const measure = () => {
      frameRef.current = 0;
      const next = readViewportBox();
      if (window.innerWidth !== widthRef.current) {
        widthRef.current = window.innerWidth;
        fullRef.current = next.height;
      }
      fullRef.current = Math.max(fullRef.current, next.height);
      const keyboardOpen = next.height < fullRef.current - 60;
      /**
       * 只有键盘在屏幕上时才跟着 offsetTop 走。
       * 键盘收着时可视视口不该有偏移，iOS 的橡皮筋/回弹会把 offsetTop 抖个几像素出来，
       * 外壳跟着抖就是整屏上下不停晃（用户看到的就是“滚动时一直抖”）。
       */
      const top = keyboardOpen ? next.top : 0;
      setBox((prev) => {
        // 1px 的来回跳直接吃掉，只认真实位移（键盘平移 / 收起都是 ≥ 10px 的连续变化）
        const settled = keyboardOpen ? (Math.abs(top - prev.top) >= 2 ? top : prev.top) : 0;
        const height = Math.abs(next.height - prev.height) >= 2 ? next.height : prev.height;
        if (prev.top === settled && prev.height === height && prev.keyboardOpen === keyboardOpen) {
          return prev;
        }
        return { top: settled, height, keyboardOpen };
      });
    };
    /** 合并到一帧里算一次：visualViewport 的 scroll 在惯性滚动时是逐帧连发的 */
    const update = () => {
      if (frameRef.current) {
        return;
      }
      frameRef.current = window.requestAnimationFrame(measure);
    };
    measure();
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return box;
}
