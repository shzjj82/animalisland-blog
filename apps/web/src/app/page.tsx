import type { Metadata } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@myblog/shared";
import Home from "@/views/Home/Home";
import { fetchPublishedArticles, publicSiteOrigin } from "@/lib/server-api";

export const revalidate = 30;

export const metadata: Metadata = {
  title: SITE_NAME,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    siteName: SITE_NAME,
    locale: "zh_CN",
    type: "website",
  },
};

export default async function HomePage() {
  const posts = await fetchPublishedArticles();
  const origin = publicSiteOrigin();

  return (
    <Home
      initialPosts={posts}
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: origin,
        description: SITE_DESCRIPTION,
        inLanguage: "zh-CN",
        author: { "@type": "Person", name: SITE_NAME },
      }}
    />
  );
}
