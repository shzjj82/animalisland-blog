/**
 * 内容后端门面：按 CONTENT_BACKEND 选择本地 SQLite 或远程 docs API。
 */
import type { CategoryKind, EditorJsDocument, PageKind, Post, PostListItem } from "@myblog/shared";
import { loadPosts } from "./content-backend.js";

export type PostWriteInput = {
  title: string;
  slug?: string;
  type: string;
  pageKind?: PageKind;
  parentId?: string | null;
  treeSort?: number;
  summary: string;
  coverUrl: string;
  props?: Record<string, unknown>;
  tags?: string[];
  body: EditorJsDocument;
  draft: boolean;
};

export async function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  pageKind?: PageKind;
  parentId?: string | null;
  limit?: number;
  page?: number;
  pageSize?: number;
  includeDrafts: boolean;
  treeOrder?: boolean;
}): Promise<{ posts: PostListItem[]; total: number }> {
  return (await loadPosts()).listPosts(opts);
}

export async function listWorkspaceTree(includeDrafts: boolean): Promise<PostListItem[]> {
  return (await loadPosts()).listWorkspaceTree(includeDrafts);
}

export async function getPostBySlug(slug: string, includeDrafts: boolean): Promise<Post | undefined> {
  return (await loadPosts()).getPostBySlug(slug, includeDrafts);
}

export async function getPostPage(
  slug: string,
  includeDrafts: boolean,
): Promise<
  | {
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }
  | undefined
> {
  return (await loadPosts()).getPostPage(slug, includeDrafts);
}

export async function getPostById(id: string): Promise<Post | undefined> {
  return (await loadPosts()).getPostById(id);
}

export async function getPageByKind(pageKind: PageKind): Promise<Post | undefined> {
  return (await loadPosts()).getPageByKind(pageKind);
}

export async function listAncestors(postId: string, includeDrafts: boolean): Promise<PostListItem[]> {
  return (await loadPosts()).listAncestors(postId, includeDrafts);
}

export async function createPost(input: PostWriteInput): Promise<Post> {
  return (await loadPosts()).createPost(input);
}

export async function updatePost(id: string, input: PostWriteInput): Promise<Post | undefined> {
  return (await loadPosts()).updatePost(id, input);
}

export async function createLinkedChild(parentId: string): Promise<{ child: Post; parent: Post }> {
  return (await loadPosts()).createLinkedChild(parentId);
}

export async function reparentArticle(
  childId: string,
  parentId: string | null,
): Promise<{ child: Post; oldParent: Post | null; newParent: Post | null }> {
  return (await loadPosts()).reparentArticle(childId, parentId);
}

export async function deletePost(id: string): Promise<boolean> {
  return (await loadPosts()).deletePost(id);
}

export async function ensureWorkspacePages(): Promise<void> {
  (await loadPosts()).ensureWorkspacePages();
}
