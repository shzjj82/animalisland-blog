import { SITE_NAME, siteTitle } from "@myblog/shared";
import { useEffect } from "react";

type SeoProps = {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: "website" | "article";
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
};

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function upsertJsonLd(data?: SeoProps["jsonLd"]) {
  const id = "seo-jsonld";
  const existing = document.getElementById(id);
  if (!data) {
    existing?.remove();
    return;
  }
  const el = existing ?? document.createElement("script");
  el.id = id;
  el.setAttribute("type", "application/ld+json");
  el.textContent = JSON.stringify(data);
  if (!existing) {
    document.head.appendChild(el);
  }
}

export function Seo({ title, description, path, image, type = "website", noindex, jsonLd }: SeoProps) {
  const json = jsonLd ? JSON.stringify(jsonLd) : "";

  useEffect(() => {
    const fullTitle = siteTitle(title);
    const origin = window.location.origin;
    const url = `${origin}${path}`;
    const ogImage = image
      ? image.startsWith("http")
        ? image
        : `${origin}${image}`
      : undefined;

    document.title = fullTitle;
    upsertMeta("name", "description", description);
    upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");
    upsertLink("canonical", url);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:locale", "zh_CN");
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", url);
    upsertMeta("name", "twitter:card", ogImage ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", description);
    if (ogImage) {
      upsertMeta("property", "og:image", ogImage);
      upsertMeta("name", "twitter:image", ogImage);
    }
    upsertJsonLd(json ? (JSON.parse(json) as SeoProps["jsonLd"]) : undefined);
  }, [title, description, path, image, type, noindex, json]);

  return null;
}
