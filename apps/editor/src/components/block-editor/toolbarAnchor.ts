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

/** 把加号和拖拽手柄的中心，对齐到当前块第一行文字的中心。 */
function placeToolbar(holder: HTMLElement, block: HTMLElement) {
  const root = holder.querySelector<HTMLElement>(".codex-editor");
  const toolbar = holder.querySelector<HTMLElement>(".ce-toolbar");
  const actions = toolbar?.querySelector<HTMLElement>(".ce-toolbar__actions");
  if (!root || !toolbar || !actions || !toolbar.classList.contains("ce-toolbar--opened") || !block.isConnected) {
    return;
  }
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
