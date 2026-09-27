import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME, decodeSlugParam, siteTitle } from "@myblog/shared";
import Post from "@/views/Post/Post";
import { fetchPostBySlug, publicSiteOrigin } from "@/lib/server-api";

/** 公开文章页 ISR */
export const revalidate = 60;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = decodeSlugParam((await params).slug);
  const detail = await fetchPostBySlug(slug);
  if (!detail) {
    return {
      title: "没有找到这篇文章",
      description: SITE_DESCRIPTION,
      robots: { index: false, follow: false },
    };
  }
  const { post } = detail;
  const title = siteTitle(post.title);
  const description = post.summary || SITE_DESCRIPTION;
  const origin = publicSiteOrigin();
  const url = `${origin}/post/${post.slug}`;
  const image = post.coverUrl
    ? post.coverUrl.startsWith("http")
      ? post.coverUrl
      : `${origin}${post.coverUrl}`
    : undefined;

  return {
    title: post.title,
    description,
    alternates: { canonical: `/post/${post.slug}` },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: "zh_CN",
      type: "article",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function PostRoute({ params }: Props) {
  const slug = decodeSlugParam((await params).slug);
  const detail = await fetchPostBySlug(slug);
  const origin = publicSiteOrigin();
  return (
    <Post
      key={slug}
      slug={slug}
      initialDetail={detail}
      jsonLd={
        detail
          ? {
              "@context": "https://schema.org",
              "@type": "BlogPosting",
              headline: detail.post.title,
              description: detail.post.summary || SITE_DESCRIPTION,
              image: detail.post.coverUrl || undefined,
              datePublished: detail.post.publishedAt ?? detail.post.createdAt,
              dateModified: detail.post.updatedAt,
              inLanguage: "zh-CN",
              mainEntityOfPage: `${origin}/post/${detail.post.slug}`,
              publisher: { "@type": "Organization", name: SITE_NAME },
            }
          : undefined
      }
    />
  );
}
