const code = document.getElementById("code");
const bridge = document.getElementById("bridge");
const status = document.getElementById("status");
const button = document.getElementById("connect");

chrome.runtime.sendMessage({ type: "wiki-work-status" }, (info) => {
  if (info?.pairCode) code.value = info.pairCode;
  if (info?.bridge) bridge.value = info.bridge;
  if (info?.token) status.textContent = `已连接 ${info.bridge}`;
});

button.addEventListener("click", () => {
  status.textContent = "连接中…";
  chrome.runtime.sendMessage(
    { type: "wiki-work-connect", pairCode: code.value.trim(), bridge: bridge.value.trim() },
    (result) => {
      if (result?.ok) {
        status.textContent = `已连接 ${result.origin}`;
      } else {
        status.textContent = result?.error || "连接失败";
      }
    },
  );
});
