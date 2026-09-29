// 发布版窗口加载的是本机 http 页面，WebView 自带的刷新、前进后退、右键菜单都要关掉
(() => {
  if (window.__wikiAgentGuard) {
    return;
  }
  window.__wikiAgentGuard = true;

  const blocked = (event) => {
    const key = event.key.toLowerCase();
    const mod = event.metaKey || event.ctrlKey;
    if (key === "f5" || key === "f12" || key === "browserback" || key === "browserforward" || key === "browserrefresh") {
      return true;
    }
    if (mod && key === "r") {
      return true;
    }
    if (mod && event.shiftKey && (key === "i" || key === "j" || key === "c")) {
      return true;
    }
    return event.altKey && (key === "arrowleft" || key === "arrowright");
  };

  window.addEventListener(
    "keydown",
    (event) => {
      if (blocked(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  const editable = (target) =>
    target instanceof Element && target.closest("input, textarea, [contenteditable='true'], [contenteditable='']");

  window.addEventListener(
    "contextmenu",
    (event) => {
      if (!editable(event.target)) {
        event.preventDefault();
      }
    },
    true,
  );

  const mouseNav = (event) => {
    if (event.button === 3 || event.button === 4) {
      event.preventDefault();
    }
  };
  window.addEventListener("mouseup", mouseNav, true);
  window.addEventListener("auxclick", mouseNav, true);
})();
