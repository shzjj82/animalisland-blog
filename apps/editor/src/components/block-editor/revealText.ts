const HIT_CLASS = "is-search-hit";

function findRange(root: HTMLElement, term: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = (node.textContent ?? "").toLocaleLowerCase().indexOf(term);
    if (index >= 0) {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + term.length);
      return range;
    }
  }
  return null;
}

function flash(block: HTMLElement): void {
  block.classList.remove(HIT_CLASS);
  void block.offsetWidth;
  block.classList.add(HIT_CLASS);
  window.setTimeout(() => block.classList.remove(HIT_CLASS), 1800);
}

/** 滚到第一处命中的块并选中命中文字；关键词被行内格式拆开时只闪烁整块 */
export function revealText(holder: HTMLElement, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const blocks = Array.from(holder.querySelectorAll<HTMLElement>(".ce-block"));
  for (const term of terms) {
    for (const block of blocks) {
      if (!(block.textContent ?? "").toLocaleLowerCase().includes(term)) {
        continue;
      }
      block.scrollIntoView({ block: "center", behavior: "smooth" });
      flash(block);
      const range = findRange(block, term);
      if (range) {
        const editable = range.startContainer.parentElement?.closest<HTMLElement>("[contenteditable=true]");
        editable?.focus({ preventScroll: true });
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      return true;
    }
  }
  return false;
}
