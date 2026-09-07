import type { Request } from "express";
import { SITE_DESCRIPTION, SITE_NAME, siteTitle } from "@myblog/shared";
import { getCategoryBySlug, listCategories } from "./categories.js";
import { env } from "./env.js";
import { getPostBySlug, listPosts } from "./posts.js";
import { getAbout } from "./site.js";

export type PageMeta = {
  status: number;
  title: string;
  description: string;
  path: string;
  image?: string;
  type: "website" | "article";
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

export function publicOrigin(req: Request): string {
  if (env.siteUrl) {
    return env.siteUrl;
  }
  const proto = String(req.headers["x-forwarded-proto"] ?? req.protocol)
    .split(",")[0]
    .trim();
  const host = req.get("host") ?? "localhost";
  return `${proto}://${host}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absoluteUrl(origin: string, value?: string): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }
  return `${origin}${value.startsWith("/") ? value : `/${value}`}`;
}

function websiteJsonLd(origin: string) {
  const about = getAbout();
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: origin,
    description: SITE_DESCRIPTION,
    inLanguage: "zh-CN",
    author: {
      "@type": "Person",
      name: about.name,
    },
  };
}

export function metaForRequest(req: Request): PageMeta {
  const origin = publicOrigin(req);
  const path = req.path;

  if (path.startsWith("/admin") || path === "/login") {
    return {
      status: 200,
      title: path === "/login" ? "登录" : "写作台",
      description: SITE_DESCRIPTION,
      path,
      type: "website",
      noindex: true,
    };
  }

  if (path.startsWith("/post/")) {
    const slug = decodeURIComponent(path.slice("/post/".length)).split("/")[0] ?? "";
    const post = slug ? getPostBySlug(slug, false) : undefined;
    if (!post) {
      return {
        status: 404,
        title: "没有找到这篇文章",
        description: "这篇文章可能已经删掉了，或者链接写错了。",
        path,
        type: "website",
        noindex: true,
      };
    }
    const url = `${origin}/post/${post.slug}`;
    const about = getAbout();
    const image = absoluteUrl(origin, post.coverUrl);
    return {
      status: 200,
      title: post.title,
      description: post.summary || SITE_DESCRIPTION,
      path: `/post/${post.slug}`,
      image,
      type: "article",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title,
        description: post.summary || SITE_DESCRIPTION,
        image,
        datePublished: post.publishedAt ?? post.createdAt,
        dateModified: post.updatedAt,
        inLanguage: "zh-CN",
        mainEntityOfPage: url,
        author: { "@type": "Person", name: about.name },
        publisher: { "@type": "Organization", name: SITE_NAME },
      },
    };
  }

  if (path === "/") {
    return {
      status: 200,
      title: SITE_NAME,
      description: SITE_DESCRIPTION,
      path,
      type: "website",
      jsonLd: websiteJsonLd(origin),
    };
  }

  const category = getCategoryBySlug(path.replace(/^\//, ""));
  if (category) {
    return {
      status: 200,
      title: category.name,
      description: category.hint || SITE_DESCRIPTION,
      path: `/${category.slug}`,
      type: "website",
    };
  }

  return {
    status: 404,
    title: "没有找到这个页面",
    description: SITE_DESCRIPTION,
    path,
    type: "website",
    noindex: true,
  };
}

export function applyHtmlMeta(html: string, origin: string, meta: PageMeta): string {
  const title = siteTitle(meta.title);
  const url = `${origin}${meta.path}`;
  const image = absoluteUrl(origin, meta.image);
  const tags = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${meta.noindex ? "noindex, nofollow" : "index, follow"}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:locale" content="zh_CN" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
    image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : "",
    meta.jsonLd
      ? `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c")}</script>`
      : "",
  ]
    .filter(Boolean)
    .join("\n    ");

  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(/<meta name="description"[^>]*>/i, "")
    .replace(/<link rel="canonical"[^>]*>/i, "")
    .replace("</head>", `    ${tags}\n  </head>`);
}

export function robotsTxt(origin: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /login",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
}

export function sitemapXml(origin: string): string {
  const { posts } = listPosts({ includeDrafts: false });
  const staticPages = [
    { loc: "/", lastmod: undefined as string | undefined, changefreq: "daily", priority: "1.0" },
    ...listCategories().map((category) => ({
      loc: `/${category.slug}`,
      lastmod: undefined as string | undefined,
      changefreq: "weekly",
      priority: category.kind === "photos" ? "0.7" : "0.8",
    })),
  ];
  const urls = [
    ...staticPages.map((page) => urlEntry(`${origin}${page.loc}`, page.lastmod, page.changefreq, page.priority)),
    ...posts.map((post) =>
      urlEntry(`${origin}/post/${encodeURIComponent(post.slug)}`, post.updatedAt, "monthly", "0.6"),
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>
`;
}

function urlEntry(loc: string, lastmod: string | undefined, changefreq: string, priority: string): string {
  return [
    "  <url>",
    `    <loc>${escapeHtml(loc)}</loc>`,
    lastmod ? `    <lastmod>${escapeHtml(lastmod.slice(0, 10))}</lastmod>` : "",
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ]
    .filter(Boolean)
    .join("\n");
}
