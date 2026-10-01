import type EditorJS from "@editorjs/editorjs";

const ENTER_GRACE_MS = 50;

function caretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !selection.isCollapsed) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) {
    return null;
  }
  const probe = range.cloneRange();
  probe.selectNodeContents(root);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
}

function restoreOffset(root: HTMLElement, offset: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = offset;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (left <= length) {
      const range = document.createRange();
      range.setStart(node, left);
      range.collapse(true);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    left -= length;
    node = walker.nextNode();
  }
}

/** 拼音组字有时会把文字包进 div，或在段首塞一个 br，看起来就像突然换行 */
function repairEditable(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return;
  }
  const editable = target.closest<HTMLElement>("[contenteditable='true']");
  if (!editable || editable.closest(".tc-table, .cdx-quote__caption")) {
    return;
  }
  const offset = caretOffset(editable);
  let changed = false;
  editable.querySelectorAll(":scope > div, :scope > p").forEach((block) => {
    const fragment = document.createDocumentFragment();
    while (block.firstChild) {
      fragment.appendChild(block.firstChild);
    }
    block.replaceWith(fragment);
    changed = true;
  });
  while (editable.firstChild?.nodeName === "BR" && editable.childNodes.length > 1) {
    editable.firstChild.remove();
    changed = true;
  }
  if (changed && offset !== null) {
    restoreOffset(editable, offset);
  }
}

function selectionCovers(redactor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const range = selection.getRangeAt(0);
  const host = range.commonAncestorContainer;
  if (host !== redactor && !redactor.contains(host)) {
    return false;
  }
  const selected = selection.toString().replace(/\s+/g, "");
  const all = (redactor.innerText ?? "").replace(/\s+/g, "");
  return all.length > 0 && selected === all;
}

function insideEditor(holder: HTMLElement, event: Event): boolean {
  return event.target instanceof Node && holder.contains(event.target);
}

function selectionInside(redactor: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return false;
  }
  const host = selection.getRangeAt(0).commonAncestorContainer;
  return host === redactor || redactor.contains(host);
}

/**
 * 拼音回车只用来确认候选字，不拆块。
 * 全选后的删除清掉整篇，而不是只留下浏览器选区。
 */
export function bindEditingGuards(holder: HTMLElement, editor: EditorJS): () => void {
  let composing = false;
  let ignoreEnterUntil = 0;
  let documentSelected = false;

  const swallowEnter = (event: KeyboardEvent) =>
    composing || event.isComposing || event.keyCode === 229 || performance.now() < ignoreEnterUntil;

  const onCompositionStart = () => {
    composing = true;
  };
  const onCompositionEnd = (event: Event) => {
    composing = false;
    ignoreEnterUntil = performance.now() + ENTER_GRACE_MS;
    window.setTimeout(() => repairEditable(event.target), 0);
  };
  const onBeforeInput = (event: Event) => {
    if (!insideEditor(holder, event)) {
      return;
    }
    const input = event as InputEvent;
    if (input.inputType !== "insertParagraph" && input.inputType !== "insertLineBreak") {
      return;
    }
    if (!composing && !input.isComposing && performance.now() >= ignoreEnterUntil) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!insideEditor(holder, event)) {
      documentSelected = false;
      return;
    }
    if (event.key === "Enter" && swallowEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && !swallowEnter(event)) {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, .tc-table, .cdx-quote__caption")) {
        return;
      }
      const redactor = holder.querySelector<HTMLElement>(".codex-editor__redactor");
      if (!redactor) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(redactor);
      selection.removeAllRanges();
      selection.addRange(range);
      documentSelected = true;
      return;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && !swallowEnter(event)) {
      const redactor = holder.querySelector<HTMLElement>(".codex-editor__redactor");
      const coversDocument = Boolean(redactor && (selectionCovers(redactor) || (documentSelected && selectionInside(redactor))));
      if (!redactor || !coversDocument) {
        documentSelected = false;
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      documentSelected = false;
      void editor.blocks.clear().then(() => {
        editor.caret.setToFirstBlock("start");
      });
      return;
    }
    if (documentSelected && event.key.length === 1) {
      documentSelected = false;
    }
  };

  holder.addEventListener("compositionstart", onCompositionStart, true);
  holder.addEventListener("compositionend", onCompositionEnd, true);
  holder.addEventListener("beforeinput", onBeforeInput, true);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    holder.removeEventListener("compositionstart", onCompositionStart, true);
    holder.removeEventListener("compositionend", onCompositionEnd, true);
    holder.removeEventListener("beforeinput", onBeforeInput, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
