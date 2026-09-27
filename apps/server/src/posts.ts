/**
 * 内容后端门面：按 CONTENT_BACKEND 选择本地 SQLite 或远程 docs API。
 */
import type { CategoryKind, EditorJsDocument, PageKind, Post, PostListItem, PostVisibility } from "@myblog/shared";
import { loadPosts } from "./content-backend.js";

export type PostListScope = "public" | "feed" | "mine" | "all";
export type PostReadAccess = "public" | "feed";

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
  visibility: PostVisibility;
};

export async function listPosts(opts: {
  type?: string;
  kind?: CategoryKind;
  pageKind?: PageKind;
  parentId?: string | null;
  limit?: number;
  page?: number;
  pageSize?: number;
  scope?: PostListScope;
  treeOrder?: boolean;
}): Promise<{ posts: PostListItem[]; total: number }> {
  return (await loadPosts()).listPosts(opts);
}

export async function listWorkspaceTree(): Promise<PostListItem[]> {
  return (await loadPosts()).listWorkspaceTree();
}

export async function getPostBySlug(
  slug: string,
  access: PostReadAccess = "public",
): Promise<Post | undefined> {
  return (await loadPosts()).getPostBySlug(slug, access);
}

export async function getPostPage(
  slug: string,
  access: PostReadAccess = "public",
): Promise<
  | {
      post: Post;
      ancestors: PostListItem[];
      siblings: PostListItem[];
      children: PostListItem[];
    }
  | undefined
> {
  return (await loadPosts()).getPostPage(slug, access);
}

export async function getPostById(id: string): Promise<Post | undefined> {
  return (await loadPosts()).getPostById(id);
}

export async function listAncestors(
  postId: string,
  access: PostReadAccess = "public",
): Promise<PostListItem[]> {
  return (await loadPosts()).listAncestors(postId, access);
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
