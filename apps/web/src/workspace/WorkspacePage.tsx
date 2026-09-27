"use client";

import { useParams } from "next/navigation";
import { PageEditor } from "@/workspace/PageEditor";
import { useWorkspace } from "@/workspace/WorkspaceLayout";

export function WorkspacePage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";
  const { reloadTree, editorNonce } = useWorkspace();
  // 按页面 id 卸载重建，避免切页时残留上一篇的 body / 编辑器状态
  return <PageEditor key={`${id}:${editorNonce}`} onSaved={() => void reloadTree()} />;
}
