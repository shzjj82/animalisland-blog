/**
 * 前台博客只读渲染：把后台 Notion 编辑器保存的块文档，套成小岛日记的 UI。
 * 不加载 Editor.js。
 */
import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";
import { Card, Divider, Image } from "animal-island-ui";
import DOMPurify from "dompurify";
import { Link } from "react-router-dom";
import { PageLinkIcon } from "@/lib/iconPark";
import { pageTitle } from "@/lib/pageTree";
import { LazyCodeBlock } from "@/content/render/LazyCodeBlock";

function html(text: unknown): string {
  return DOMPurify.sanitize(typeof text === "string" ? text : "");
}

function listItems(data: Record<string, unknown>): string[] {
  const items = data.items;
  if (!Array.isArray(items)) {
    return [];
  }
  return items.map((item) => {
    if (typeof item === "string") {
      return item;
    }
    if (item && typeof item === "object" && "content" in item) {
      return String((item as { content: unknown }).content ?? "");
    }
    return "";
  });
}

function BlockView({ block }: { block: EditorJsBlock }) {
  const { type, data } = block;

  if (type === "header") {
    const level = Number(data.level) || 2;
    const Tag = (`h${Math.min(Math.max(level, 1), 4)}` as unknown) as "h1";
    return <Tag className="block-h" dangerouslySetInnerHTML={{ __html: html(data.text) }} />;
  }

  if (type === "paragraph") {
    return <p className="block-p" dangerouslySetInnerHTML={{ __html: html(data.text) }} />;
  }

  if (type === "list") {
    const items = listItems(data);
    const ordered = data.style === "ordered";
    const List = ordered ? "ol" : "ul";
    return (
      <List className="block-list">
        {items.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: html(item) }} />
        ))}
      </List>
    );
  }

  if (type === "quote") {
    return (
      <Card color="app-yellow" className="block-quote">
        <blockquote dangerouslySetInnerHTML={{ __html: html(data.text) }} />
        {typeof data.caption === "string" && data.caption ? (
          <cite dangerouslySetInnerHTML={{ __html: html(data.caption) }} />
        ) : null}
      </Card>
    );
  }

  if (type === "code") {
    const language = typeof data.language === "string" ? data.language : "plaintext";
    const code = String(data.code ?? "");
    return <LazyCodeBlock code={code} language={language} />;
  }

  if (type === "delimiter") {
    return (
      <div className="block-delimiter">
        <Divider type="dashed-brown" />
      </div>
    );
  }

  if (type === "image") {
    const file = data.file as { url?: string } | undefined;
    const url = file?.url ?? "";
    if (!url) {
      return null;
    }
    return (
      <figure className="block-image">
        <Image src={url} alt={String(data.caption ?? "")} preview color="white" />
        {typeof data.caption === "string" && data.caption ? (
          <figcaption>{data.caption}</figcaption>
        ) : null}
      </figure>
    );
  }

  if (type === "pageLink") {
    const slug = typeof data.slug === "string" ? data.slug : "";
    const title = pageTitle({ title: typeof data.title === "string" ? data.title : "无标题" });
    if (!slug) {
      return null;
    }
    return (
      <Link to={`/post/${slug}`} className="block-page-link">
        <span className="block-page-link-icon" aria-hidden>
          <PageLinkIcon size={18} />
        </span>
        <span className="block-page-link-title">{title}</span>
      </Link>
    );
  }

  if (type === "embed") {
    const src = typeof data.embed === "string" ? data.embed : "";
    if (!src) {
      return null;
    }
    return (
      <figure className="block-embed">
        <iframe
          src={src}
          title={typeof data.caption === "string" && data.caption ? data.caption : "嵌入内容"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
        {typeof data.caption === "string" && data.caption ? <figcaption>{data.caption}</figcaption> : null}
      </figure>
    );
  }

  return null;
}

export type BlogContentProps = {
  document: EditorJsDocument;
  /** 页面已展示标题时，跳过正文里同名的首个标题块 */
  skipLeadingTitle?: string;
};

export function BlogContent({ document, skipLeadingTitle }: BlogContentProps) {
  if (!document.blocks?.length) {
    return <p className="muted">这篇还没有内容。</p>;
  }

  const titlePlain = skipLeadingTitle?.trim() ?? "";
  let skipped = false;
  const blocks = document.blocks.filter((block) => {
    if (skipped || !titlePlain || block.type !== "header") {
      return true;
    }
    const text = String(block.data.text ?? "")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (text === titlePlain) {
      skipped = true;
      return false;
    }
    return true;
  });

  if (!blocks.length) {
    return <p className="muted">这篇还没有内容。</p>;
  }

  return (
    <article className="block-article blog-content">
      {blocks.map((block, index) => (
        <BlockView key={block.id ?? index} block={block} />
      ))}
    </article>
  );
}
