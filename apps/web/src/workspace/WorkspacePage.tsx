import { useOutletContext } from "react-router-dom";
import { PageEditor } from "@/workspace/PageEditor";
import type { PostListItem } from "@myblog/shared";

type WorkspaceOutlet = {
  reloadTree: () => Promise<PostListItem[]>;
  pages: PostListItem[];
  previewTreeTitle: (pageId: string, title: string) => void;
  editorNonce: number;
};

export function WorkspacePage() {
  const { reloadTree, editorNonce } = useOutletContext<WorkspaceOutlet>();
  return <PageEditor key={editorNonce} onSaved={() => void reloadTree()} />;
}
