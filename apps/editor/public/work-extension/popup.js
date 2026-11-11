const status = document.getElementById("status");
const button = document.getElementById("connect");

function show(result) {
  if (result?.ok) {
    status.textContent = `已连接 ${result.origin || result.bridge || ""}`.trim();
    return;
  }
  if (result?.token) {
    status.textContent = `已连接 ${result.bridge || ""}`.trim();
    return;
  }
  status.textContent = result?.error || "未连接。请先打开工作台。";
}

chrome.runtime.sendMessage({ type: "wiki-work-status" }, show);

button.addEventListener("click", () => {
  status.textContent = "连接中…";
  chrome.runtime.sendMessage({ type: "wiki-work-connect" }, show);
});
