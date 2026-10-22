import { useCallback, useRef, useState } from "react";
import type { EditorJsDocument } from "@myblog/shared";

/** 连续输入停下手 700ms 就落一个撤销点；结构变化（增删块 / 换块类型）立刻落点 */
const COMMIT_GAP = 700;
/** 最多保留多少个撤销点，超出从头丢 */
const LIMIT = 60;

function signature(doc: EditorJsDocument | null | undefined): string {
  if (!doc) {
    return "";
  }
  return (doc.blocks ?? [])
    .map((block) => `${block.id ?? ""}:${block.type}`)
    .join("|");
}

function same(a: EditorJsDocument | null, b: EditorJsDocument | null): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return JSON.stringify(a.blocks) === JSON.stringify(b.blocks);
}

export type DocHistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  /** 打开页面 / 切换页面时清掉历史：撤销不该跨页 */
  reset: (doc: EditorJsDocument) => void;
  /** 收到编辑器最新内容：决定是并入当前撤销点，还是新开一个 */
  commit: (doc: EditorJsDocument) => void;
  /** 返回要渲染回去的内容；没有可撤销的步骤时返回 null */
  undo: () => EditorJsDocument | null;
  redo: () => EditorJsDocument | null;
};

/**
 * 文档级撤销栈。Editor.js 自己没有 undo，DOM 层的原生 undo 又不会通知 onChange，
 * 删掉一个块之后浏览器撤不回来（就算撤回来存的还是旧数据）。
 * 所以自己按「保存出来的整份文档」做快照：
 *   - 打字：700ms 内的连续输入并成一个点，不会一个字一个撤销点
 *   - 增删块 / 换块类型：立刻落点，误删一个块按一次撤销就能回来
 */
export function useDocHistory(): DocHistoryState {
  const pastRef = useRef<EditorJsDocument[]>([]);
  const futureRef = useRef<EditorJsDocument[]>([]);
  const currentRef = useRef<EditorJsDocument | null>(null);
  const lastAtRef = useRef(0);
  const [state, setState] = useState({ canUndo: false, canRedo: false });

  const sync = useCallback(() => {
    const canUndo = pastRef.current.length > 0;
    const canRedo = futureRef.current.length > 0;
    setState((prev) => (prev.canUndo === canUndo && prev.canRedo === canRedo ? prev : { canUndo, canRedo }));
  }, []);

  const reset = useCallback(
    (doc: EditorJsDocument) => {
      pastRef.current = [];
      futureRef.current = [];
      currentRef.current = doc;
      lastAtRef.current = 0;
      sync();
    },
    [sync],
  );

  const commit = useCallback(
    (doc: EditorJsDocument) => {
      const current = currentRef.current;
      if (!current) {
        currentRef.current = doc;
        sync();
        return;
      }
      if (same(current, doc)) {
        return;
      }
      const structural = signature(current) !== signature(doc);
      const now = Date.now();
      // 结构变了必须立刻落点（删块 / 插块 / 转换块类型）；
      // 只是打字就等静默 700ms 再落点，避免一个字一个点
      if (structural || now - lastAtRef.current > COMMIT_GAP) {
        pastRef.current.push(current);
        if (pastRef.current.length > LIMIT) {
          pastRef.current.shift();
        }
        futureRef.current = [];
        lastAtRef.current = now;
      }
      currentRef.current = doc;
      sync();
    },
    [sync],
  );

  const undo = useCallback(() => {
    const current = currentRef.current;
    const prev = pastRef.current.pop();
    if (!current || !prev) {
      return null;
    }
    futureRef.current.push(current);
    currentRef.current = prev;
    lastAtRef.current = 0;
    sync();
    return prev;
  }, [sync]);

  const redo = useCallback(() => {
    const current = currentRef.current;
    const next = futureRef.current.pop();
    if (!current || !next) {
      return null;
    }
    pastRef.current.push(current);
    currentRef.current = next;
    lastAtRef.current = 0;
    sync();
    return next;
  }, [sync]);

  return { ...state, reset, commit, undo, redo };
}
