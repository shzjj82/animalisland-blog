import { Robot } from "@icon-park/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { iconParkOutline } from "@/lib/iconPark";

type SelectionRect = {
  top: number;
  left: number;
  text: string;
};

type Props = {
  /** 编辑器 holder 选择器，默认工作区 Notion 编辑器 */
  editorSelector?: string;
  disabled?: boolean;
  onAsk: (text: string) => void;
};

function readEditorSelection(editorSelector: string): SelectionRect | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const text = selection.toString().replace(/\u200b/g, "").trim();
  if (text.length < 2 || text.length > 4000) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const editor = document.querySelector(editorSelector);
  if (!editor || !editor.contains(range.commonAncestorContainer)) {
    return null;
  }
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) {
    return null;
  }
  const width = 108;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.min(Math.max(12, left), window.innerWidth - width - 12);
  let top = rect.top - 40;
  if (top < 8) {
    top = rect.bottom + 8;
  }
  return { top, left, text };
}

/** 划词后浮出「问 AI」，把选中段落带进聊天 */
export function SelectionAskChip({
  editorSelector = ".notion-editor",
  disabled,
  onAsk,
}: Props) {
  const [chip, setChip] = useState<SelectionRect | null>(null);

  useEffect(() => {
    if (disabled) {
      setChip(null);
      return;
    }

    let timer = 0;
    const sync = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setChip(readEditorSelection(editorSelector));
      }, 80);
    };

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".selection-ask-chip")) {
        return;
      }
      // 点别处先藏，等 mouseup 再算
      setChip(null);
    };

    document.addEventListener("selectionchange", sync);
    document.addEventListener("mouseup", sync);
    document.addEventListener("keyup", sync);
    document.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", sync);
      document.removeEventListener("mouseup", sync);
      document.removeEventListener("keyup", sync);
      document.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [disabled, editorSelector]);

  if (!chip || disabled) {
    return null;
  }

  return createPortal(
    <button
      type="button"
      className="selection-ask-chip"
      style={{ top: chip.top, left: chip.left }}
      onMouseDown={(e) => {
        // 避免点按钮时清空选区
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onAsk(chip.text);
        setChip(null);
        window.getSelection()?.removeAllRanges();
      }}
    >
      <Robot {...iconParkOutline} size={14} aria-hidden />
      问 AI
    </button>,
    document.body,
  );
}
