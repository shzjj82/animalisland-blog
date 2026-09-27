/**
 * 轻量契约校验：CONTENT_BACKEND 别名 + 内容门面导出齐全。
 * 用法：pnpm check:backend
 */
import assert from "node:assert/strict";
import { resolveContentBackend } from "../src/env.js";
import * as categories from "../src/categories.js";
import * as posts from "../src/posts.js";
import { loadCategories, loadPosts } from "../src/content-backend.js";

const aliasCases: Array<[string, "local" | "docs"]> = [
  ["local", "local"],
  ["express", "local"],
  ["sqlite", "local"],
  ["docs", "docs"],
  ["api", "docs"],
  ["remote", "docs"],
  ["LOCAL", "local"],
  [" Docs ", "docs"],
];

for (const [raw, expected] of aliasCases) {
  assert.equal(resolveContentBackend(raw), expected, `resolveContentBackend(${JSON.stringify(raw)})`);
}

const postFns = [
  "listPosts",
  "listWorkspaceTree",
  "getPostBySlug",
  "getPostPage",
  "getPostById",
  "listAncestors",
  "createPost",
  "updatePost",
  "createLinkedChild",
  "reparentArticle",
  "deletePost",
  "ensureWorkspacePages",
] as const;

const categoryFns = [
  "listCategories",
  "listCategorySlugs",
  "getCategoryBySlug",
  "createCategory",
  "updateCategory",
  "deleteCategory",
  "ensureDefaultCategories",
] as const;

for (const name of postFns) {
  assert.equal(typeof posts[name], "function", `posts.${name}`);
}
for (const name of categoryFns) {
  assert.equal(typeof categories[name], "function", `categories.${name}`);
}

assert.equal(typeof loadPosts, "function");
assert.equal(typeof loadCategories, "function");

console.log("check-content-backend: ok");
