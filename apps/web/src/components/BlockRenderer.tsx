import type { EditorJsBlock, EditorJsDocument } from "@myblog/shared";
import { Card, Divider, Image } from "animal-island-ui";
import DOMPurify from "dompurify";
import { codeLanguageLabel } from "@/components/editor/CodeTool";
import { highlightCode } from "@/lib/highlight";

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
    return (
      <div className="block-code">
        <span className="block-code-lang">{codeLanguageLabel(language)}</span>
        <pre className="block-code-pre">
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }} />
        </pre>
      </div>
    );
  }

  if (type === "delimiter") {
    return <Divider type="dashed-brown" />;
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

export function BlockRenderer({ document }: { document: EditorJsDocument }) {
  if (!document.blocks?.length) {
    return <p className="muted">这篇还没有内容。</p>;
  }
  return (
    <article className="block-article">
      {document.blocks.map((block, index) => (
        <BlockView key={block.id ?? index} block={block} />
      ))}
    </article>
  );
}
