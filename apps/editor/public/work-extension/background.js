const DEFAULTS = ["http://127.0.0.1:47321", "http://127.0.0.1:5174", "http://127.0.0.1:8082"];

async function settings() {
  const stored = await chrome.storage.local.get(["bridge", "token"]);
  return {
    bridge: String(stored.bridge || "").replace(/\/$/, ""),
    token: String(stored.token || ""),
  };
}

async function probe(origin) {
  try {
    const res = await fetch(`${origin}/work-bridge/health`, { cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveBridge(preferred) {
  const list = [preferred, ...DEFAULTS].filter(Boolean);
  for (const origin of list) {
    if (await probe(origin)) {
      return origin;
    }
  }
  return preferred || DEFAULTS[0];
}

async function connect(bridge) {
  const origin = await resolveBridge(bridge);
  const res = await fetch(`${origin}/work-bridge/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ browserName: navigator.userAgent }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || "CONNECT_FAILED");
  }
  await chrome.storage.local.set({ bridge: origin, token: body.token });
  return { origin, token: body.token };
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs.find((tab) => tab.id && /^https?:/.test(tab.url || "")) || null;
}

async function sendTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function tick() {
  let { bridge, token } = await settings();
  if (!bridge || !token) {
    try {
      const linked = await connect("");
      bridge = linked.origin;
      token = linked.token;
    } catch {
      return;
    }
  }
  const tab = await activeTab();
  if (tab?.id) {
    const snapshot = await sendTab(tab.id, { type: "wiki-work-snapshot" }).catch(() => null);
    if (snapshot?.url) {
      await fetch(`${bridge}/work-bridge/snapshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Work-Token": token },
        body: JSON.stringify({ token, snapshot }),
      }).catch(() => undefined);
    }
  }
  const sessionRes = await fetch(`${bridge}/work-bridge/session?token=${encodeURIComponent(token)}`).catch(() => null);
  if (!sessionRes || !sessionRes.ok) {
    return;
  }
  const session = await sessionRes.json();
  if (!session.pending || session.pending.action === "done" || session.pending.action === "snapshot") {
    if (session.pending?.action === "snapshot") {
      await fetch(`${bridge}/work-bridge/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Work-Token": token },
        body: JSON.stringify({ token, result: "snapshot" }),
      }).catch(() => undefined);
    }
    return;
  }
  if (!tab?.id) {
    return;
  }
  const ran = await sendTab(tab.id, { type: "wiki-work-run", action: session.pending }).catch((err) => ({
    result: String(err),
  }));
  await fetch(`${bridge}/work-bridge/result`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Work-Token": token },
    body: JSON.stringify({ token, result: ran?.result || "ok" }),
  }).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "wiki-work-connect") {
    connect(message.bridge)
      .then((ok) => sendResponse({ ok: true, ...ok }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }
  if (message?.type === "wiki-work-status") {
    settings()
      .then((value) => sendResponse(value))
      .catch(() => sendResponse({}));
    return true;
  }
  return false;
});

setInterval(() => {
  void tick();
}, 1200);
chrome.tabs.onActivated.addListener(() => {
  void tick();
});
chrome.tabs.onUpdated.addListener((_id, change) => {
  if (change.status === "complete" || change.url) {
    void tick();
  }
});
