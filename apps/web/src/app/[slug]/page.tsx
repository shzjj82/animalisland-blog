import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, siteTitle } from "@myblog/shared";
import { notFound, redirect } from "next/navigation";
import { PostListPage } from "@/views/PostList";
import { fetchCategories, fetchPublishedArticles } from "@/lib/server-api";

export const revalidate = 30;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const categories = await fetchCategories();
  const category = categories.find((item) => item.slug === slug);
  if (!category || category.kind !== "article") {
    return {
      title: "没有找到这个页面",
      description: SITE_DESCRIPTION,
      robots: { index: false, follow: false },
    };
  }
  const description = category.hint || `${category.name}相关笔记`;
  return {
    title: category.name,
    description,
    alternates: { canonical: `/${category.slug}` },
    openGraph: {
      title: siteTitle(category.name),
      description,
      url: `/${category.slug}`,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "website",
    },
  };
}

export default async function CategoryRoute({ params }: Props) {
  const { slug } = await params;
  const categories = await fetchCategories();
  const category = categories.find((item) => item.slug === slug);

  if (!category) {
    notFound();
  }
  if (category.kind !== "article") {
    redirect("/notes");
  }

  const posts = await fetchPublishedArticles({ type: category.slug });
  return <PostListPage category={category} initialPosts={posts} />;
}
