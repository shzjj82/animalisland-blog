(() => {
  const ATTR = "data-wiki-work-id";

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return false;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function label(el) {
    return (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.value ||
      (el.innerText || "").replace(/\s+/g, " ")
    )
      .trim()
      .slice(0, 80);
  }

  function collect() {
    document.querySelectorAll(`[${ATTR}]`).forEach((el) => el.removeAttribute(ATTR));
    const nodes = [
      ...document.querySelectorAll('a, button, input, textarea, select, [role="button"], [contenteditable="true"]'),
    ];
    const items = [];
    let id = 1;
    for (const el of nodes) {
      if (!visible(el)) continue;
      el.setAttribute(ATTR, String(id));
      items.push({
        id,
        tag: el.tagName.toLowerCase(),
        text: label(el),
        href: el.href || "",
      });
      id += 1;
      if (id > 80) break;
    }
    return {
      url: location.href,
      title: document.title,
      text: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 5000),
      items,
      at: Date.now(),
    };
  }

  function byId(id) {
    return document.querySelector(`[${ATTR}="${id}"]`);
  }

  async function run(action) {
    if (!action || typeof action.action !== "string") {
      return "NO_ACTION";
    }
    if (action.action === "snapshot") {
      return "ok";
    }
    if (action.action === "scroll") {
      window.scrollBy({ top: action.dir === "up" ? -innerHeight * 0.8 : innerHeight * 0.8, behavior: "smooth" });
      return "scrolled";
    }
    if (action.action === "navigate" && action.url) {
      location.href = action.url;
      return `navigated ${action.url}`;
    }
    const el = byId(action.id);
    if (!el) {
      return `missing #${action.id}`;
    }
    el.scrollIntoView({ block: "center", inline: "nearest" });
    if (action.action === "click") {
      el.click();
      return `clicked #${action.id}`;
    }
    if (action.action === "type") {
      el.focus();
      const text = String(action.text ?? "");
      if ("value" in el) {
        el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        el.innerText = text;
      }
      return `typed #${action.id}`;
    }
    return "ignored";
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "wiki-work-snapshot") {
      sendResponse(collect());
      return true;
    }
    if (message?.type === "wiki-work-run") {
      Promise.resolve(run(message.action))
        .then((result) => sendResponse({ result }))
        .catch((err) => sendResponse({ result: String(err) }));
      return true;
    }
    return false;
  });
})();
