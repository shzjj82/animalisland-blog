import type { Metadata } from "next";
import { NotesPage } from "@/views/Notes";
import { fetchPublishedArticles } from "@/lib/server-api";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "笔记",
  description: "小岛上写下的文章",
  alternates: { canonical: "/notes" },
};

export default async function NotesRoute() {
  const posts = await fetchPublishedArticles();
  return <NotesPage initialPosts={posts} />;
}
