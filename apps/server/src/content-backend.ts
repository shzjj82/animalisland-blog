/**
 * 按 CONTENT_BACKEND 懒加载并缓存 posts / categories 实现。
 */
import { env } from "./env.js";

type PostsMod = typeof import("./posts.local.js") | typeof import("./posts.docs.js");
type CategoriesMod = typeof import("./categories.local.js") | typeof import("./categories.docs.js");

const cache = {
  posts: null as Promise<PostsMod> | null,
  categories: null as Promise<CategoriesMod> | null,
};

export function loadPosts(): Promise<PostsMod> {
  if (!cache.posts) {
    cache.posts =
      env.contentBackend === "docs" ? import("./posts.docs.js") : import("./posts.local.js");
  }
  return cache.posts;
}

export function loadCategories(): Promise<CategoriesMod> {
  if (!cache.categories) {
    cache.categories =
      env.contentBackend === "docs"
        ? import("./categories.docs.js")
        : import("./categories.local.js");
  }
  return cache.categories;
}
