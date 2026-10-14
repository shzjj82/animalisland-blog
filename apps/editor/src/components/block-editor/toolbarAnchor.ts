function caretBlock(holder: HTMLElement): HTMLElement | null {
  const node = document.getSelection()?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  const block = element?.closest<HTMLElement>(".ce-block");
  return block && holder.contains(block) ? block : null;
}

function visibleText(node: Node): string {
  return (node.textContent ?? "").replace(/[\u200b\ufeff]/g, "").trim();
}

/** 有文字时取第一行字形盒子。 */
function textLineBox(host: HTMLElement): DOMRect | null {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node && !visibleText(node)) {
    node = walker.nextNode();
  }
  if (!node?.textContent) {
    return null;
  }
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, node.textContent.length);
  const rect = range.getClientRects()[0];
  return rect && rect.height > 0 ? rect : null;
}

/**
 * 空行没有字形，按同一套行高把盒子放进内边距之后。
 * 这样中心和有文字时的第一行重合，而不是贴着含 padding 的盒子顶部。
 */
function emptyTextLineBox(host: HTMLElement): DOMRect | null {
  const rect = host.getBoundingClientRect();
  if (rect.height <= 0) {
    return null;
  }
  const style = getComputedStyle(host);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const parsedLine = Number.parseFloat(style.lineHeight);
  const lineHeight = Number.isFinite(parsedLine) ? parsedLine : fontSize * 1.4;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  return new DOMRect(rect.x, rect.y + borderTop + paddingTop, rect.width, lineHeight);
}

/** 第一行文字的实际盒子。没有文字时仍按这一行的中心对齐；图片等内容则对齐整块中心。 */
function firstLineBox(block: HTMLElement): DOMRect | null {
  const editable = block.querySelector<HTMLElement>("[contenteditable='true']");
  if (editable) {
    return textLineBox(editable) ?? emptyTextLineBox(editable);
  }
  const host = block.querySelector<HTMLElement>(".ce-block__content");
  if (!host) {
    return null;
  }
  const rect = host.getBoundingClientRect();
  return rect.height > 0 ? rect : null;
}

const stroke = (paths: string[]) =>
  `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true" data-block-icon="1">${paths
    .map((d) => `<path d="${d}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join("")}</svg>`;

const BLOCK_ICONS: Record<string, string> = {
  T: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" data-block-icon="T"><text x="12" y="17" text-anchor="middle" font-size="14" font-weight="700" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor">T</text></svg>`,
  H1: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" data-block-icon="H1"><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="750" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor">H1</text></svg>`,
  H2: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" data-block-icon="H2"><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="750" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor">H2</text></svg>`,
  H3: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" data-block-icon="H3"><text x="12" y="16.5" text-anchor="middle" font-size="11" font-weight="750" font-family="ui-sans-serif,system-ui,sans-serif" fill="currentColor">H3</text></svg>`,
  ul: `<svg width="16" height="16" viewBox="0 0 48 48" fill="none" aria-hidden="true" data-block-icon="ul"><circle cx="10" cy="12" r="3" fill="currentColor"/><circle cx="10" cy="24" r="3" fill="currentColor"/><circle cx="10" cy="36" r="3" fill="currentColor"/><path d="M20 12h20M20 24h20M20 36h20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  ol: stroke(["M8 8h2v8H8", "M7 28h6", "M10 20v8", "M18 12h22", "M18 24h22", "M18 36h22"]),
  todo: stroke(["M8 12h32v24H8z", "M16 24l5 5 11-12"]),
  quote: stroke(["M14 16h-2a6 6 0 0 0 6 8", "M30 16h-2a6 6 0 0 0 6 8"]),
  line: stroke(["M8 24h32"]),
  table: stroke(["M8 10h32v28H8z", "M8 20h32", "M8 30h32", "M20 10v28"]),
  image: stroke(["M8 12h32v24H8z", "M16 20h.01", "M8 30l8-6 6 5 4-3 14 8"]),
  file: stroke(["M28 8H14v32h20V16z", "M28 8v8h8"]),
  page: stroke(["M12 8h16l8 8v24H12z", "M18 22h12", "M18 30h12"]),
  video: stroke(["M8 12h24v24H8z", "M32 20l8-4v16l-8-4z"]),
};

function blockIconKey(block: HTMLElement): string {
  const header = block.querySelector("h1.ce-header, h2.ce-header, h3.ce-header");
  if (header) {
    return header.tagName === "H1" ? "H1" : header.tagName === "H2" ? "H2" : "H3";
  }
  if (block.querySelector(".cdx-list-ordered")) {
    return "ol";
  }
  if (block.querySelector(".cdx-list-checklist")) {
    return "todo";
  }
  if (block.querySelector(".cdx-list")) {
    return "ul";
  }
  if (block.querySelector(".cdx-quote")) {
    return "quote";
  }
  if (block.querySelector(".ce-delimiter")) {
    return "line";
  }
  if (block.querySelector(".tc-wrap, .tc-table")) {
    return "table";
  }
  if (block.querySelector(".cdx-image:not(.is-empty)")) {
    return "image";
  }
  if (block.querySelector(".cdx-attachment")) {
    return "file";
  }
  if (block.querySelector(".cdx-page-link")) {
    return "page";
  }
  if (block.querySelector(".cdx-video")) {
    return "video";
  }
  return "T";
}

/** 加号换成当前块的图标，点击行为仍是打开块菜单。 */
function showBlockIcon(holder: HTMLElement, block: HTMLElement) {
  const plus = holder.querySelector<HTMLElement>(".ce-toolbar__plus");
  if (!plus) {
    return;
  }
  const key = blockIconKey(block);
  if (plus.querySelector("svg")?.getAttribute("data-block-icon") === key) {
    return;
  }
  plus.innerHTML = BLOCK_ICONS[key] ?? BLOCK_ICONS.T;
}

/** 把加号和拖拽手柄的中心，对齐到当前块第一行文字的中心。 */
function placeToolbar(holder: HTMLElement, block: HTMLElement) {
  const root = holder.querySelector<HTMLElement>(".codex-editor");
  const toolbar = holder.querySelector<HTMLElement>(".ce-toolbar");
  const actions = toolbar?.querySelector<HTMLElement>(".ce-toolbar__actions");
  if (!root || !toolbar || !actions || !toolbar.classList.contains("ce-toolbar--opened") || !block.isConnected) {
    return;
  }
  showBlockIcon(holder, block);
  const line = firstLineBox(block);
  if (!line) {
    return;
  }
  const button = actions.getBoundingClientRect();
  if (button.height <= 0) {
    return;
  }
  const delta = line.top + line.height / 2 - (button.top + button.height / 2);
  if (Math.abs(delta) < 1) {
    return;
  }
  const current = Number.parseFloat(toolbar.style.top);
  const base = Number.isFinite(current) ? current : toolbar.getBoundingClientRect().top - root.getBoundingClientRect().top;
  toolbar.style.top = `${Math.round(base + delta)}px`;
}

export function bindToolbarAnchor(holder: HTMLElement): () => void {
  let pointerBlock: HTMLElement | null = null;
  let frame = 0;

  const align = () => {
    frame = 0;
    const block = pointerBlock?.isConnected ? pointerBlock : caretBlock(holder);
    if (block) {
      placeToolbar(holder, block);
    }
  };
  const schedule = () => {
    if (frame) {
      return;
    }
    frame = window.requestAnimationFrame(align);
  };

  const onMove = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const block = target?.closest<HTMLElement>(".ce-block");
    if (block && holder.contains(block)) {
      pointerBlock = block;
    }
    schedule();
  };
  const onLeave = (event: MouseEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && holder.contains(next)) {
      return;
    }
    pointerBlock = null;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Enter" || event.key === "Backspace" || event.key === "Delete") {
      pointerBlock = null;
    }
  };
  const onKeyUp = () => {
    schedule();
  };

  holder.addEventListener("mousemove", onMove);
  holder.addEventListener("mouseleave", onLeave);
  holder.addEventListener("keydown", onKeyDown);
  holder.addEventListener("keyup", onKeyUp);

  const toolbar = holder.querySelector(".ce-toolbar");
  const observer = new MutationObserver(schedule);
  const observe = (node: Element) => observer.observe(node, { attributes: true, attributeFilter: ["style", "class"] });
  if (toolbar) {
    observe(toolbar);
  }
  const wait = new MutationObserver(() => {
    const node = holder.querySelector(".ce-toolbar");
    if (!node) {
      return;
    }
    observe(node);
    wait.disconnect();
  });
  if (!toolbar) {
    wait.observe(holder, { childList: true, subtree: true });
  }

  return () => {
    if (frame) {
      window.cancelAnimationFrame(frame);
    }
    observer.disconnect();
    wait.disconnect();
    holder.removeEventListener("mousemove", onMove);
    holder.removeEventListener("mouseleave", onLeave);
    holder.removeEventListener("keydown", onKeyDown);
    holder.removeEventListener("keyup", onKeyUp);
  };
}
