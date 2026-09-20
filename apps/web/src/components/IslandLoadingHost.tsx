import { useEffect, useState } from "react";
import "./IslandLoadingHost.less";

type Listener = (active: boolean) => void;

let visible = false;
const listeners = new Set<Listener>();

function emitVisible(next: boolean) {
  if (visible === next) {
    return;
  }
  visible = next;
  listeners.forEach((listener) => listener(visible));
}

function subscribeVisible(listener: Listener) {
  listeners.add(listener);
  listener(visible);
  return () => {
    listeners.delete(listener);
  };
}

export function showIslandLoading() {
  emitVisible(true);
}

export function hideIslandLoading() {
  emitVisible(false);
}

/** pending 延迟显示，短请求不闪；关闭立刻 */
export function useDeferredIslandLoading(pending: boolean, delayMs = 120) {
  useEffect(() => {
    if (!pending) {
      hideIslandLoading();
      return;
    }
    const timer = window.setTimeout(() => {
      showIslandLoading();
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
      hideIslandLoading();
    };
  }, [pending, delayMs]);
}

/** 轻量 CSS loading，替代 animal-island-ui 的 GSAP 小岛 */
export function IslandLoadingHost() {
  const [active, setActive] = useState(false);

  useEffect(() => subscribeVisible(setActive), []);

  return (
    <div
      className={`island-loading-host${active ? " is-active" : ""}`}
      aria-hidden={!active}
      aria-busy={active}
      role="status"
    >
      <div className="island-loading-panel">
        <span className="island-loading-dot" aria-hidden />
        <span className="island-loading-dot" aria-hidden />
        <span className="island-loading-dot" aria-hidden />
        <span className="island-loading-label">加载中</span>
      </div>
    </div>
  );
}
