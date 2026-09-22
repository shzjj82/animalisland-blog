import { useOutletContext, useParams } from "react-router-dom";
import { PageEditor } from "@/workspace/PageEditor";
import type { PostListItem } from "@myblog/shared";

type WorkspaceOutlet = {
  reloadTree: () => Promise<PostListItem[]>;
  pages: PostListItem[];
  previewTreeTitle: (pageId: string, title: string) => void;
  editorNonce: number;
};

export function WorkspacePage() {
  const { id = "" } = useParams();
  const { reloadTree, editorNonce } = useOutletContext<WorkspaceOutlet>();
  // 按页面 id 卸载重建，避免切页时残留上一篇的 body / 编辑器状态
  return <PageEditor key={`${id}:${editorNonce}`} onSaved={() => void reloadTree()} />;
}
