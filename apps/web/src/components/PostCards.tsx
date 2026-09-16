import type { PostListItem } from "@myblog/shared";
import { isSiteSkillColor } from "@myblog/shared";
import { ArrowRight } from "@icon-park/react";
import { Card } from "animal-island-ui";
import { Link } from "react-router-dom";
import { iconParkOutline } from "@/lib/iconPark";
import { pageTitle } from "@/lib/pageTree";

function prefetchPostPage() {
  void import("@/pages/Post/Post");
}

/** 过短或纯符号的摘要不当正文描述 */
function cardExcerpt(summary: string | undefined): string {
  const text = (summary ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 8) {
    return "点进去看全文。";
  }
  if (/^[\/\\|#*\-_=.。，,!！?？…·\s]+$/.test(text)) {
    return "点进去看全文。";
  }
  return text;
}

/** 空列表插图：摊开的空白笔记本 */
function EmptyNotesArt() {
  return (
    <svg
      className="blog-empty-art"
      viewBox="0 0 160 120"
      width="160"
      height="120"
      aria-hidden
    >
      <ellipse cx="80" cy="102" rx="54" ry="8" fill="currentColor" opacity="0.08" />
      <path
        d="M42 28c0-4 3-7 7-7h62c4 0 7 3 7 7v62c0 4-3 7-7 7H49c-4 0-7-3-7-7V28z"
        fill="#fffdf5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinejoin="round"
        opacity="0.92"
      />
      <path d="M56 21v76" stroke="currentColor" strokeWidth="2" opacity="0.2" />
      <path d="M68 44h40M68 56h34M68 68h28" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.18" />
      <circle cx="118" cy="34" r="14" fill="#ffd089" opacity="0.55" />
      <path
        d="M112 34h12M118 28v12"
        stroke="#d98c3b"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.85"
      />
    </svg>
  );
}

export function PostCards({ posts, empty }: { posts: PostListItem[]; empty: string }) {
  if (posts.length === 0) {
    return (
      <div className="blog-empty" role="status">
        <Card color="app-yellow" className="blog-empty-card">
          <div className="blog-empty-inner">
            <EmptyNotesArt />
            <p className="blog-empty-title">暂时还是空的</p>
            <p className="blog-empty-desc">{empty}</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="blog-posts-grid">
      {posts.map((post) => (
        <Link
          key={post.id}
          to={`/post/${post.slug}`}
          className="blog-post-card-link"
          onMouseEnter={prefetchPostPage}
          onFocus={prefetchPostPage}
        >
          <Card
            color={isSiteSkillColor(post.categoryColor) ? post.categoryColor : "app-yellow"}
            hoverable
            className="blog-post-card"
          >
            <h3 className="blog-post-title">{pageTitle(post)}</h3>
            <p className="blog-post-excerpt">{cardExcerpt(post.summary)}</p>
            <div className="blog-post-meta">
              <time dateTime={(post.publishedAt ?? post.updatedAt).slice(0, 10)}>
                {(post.publishedAt ?? post.updatedAt).slice(0, 10)}
              </time>
              <span className="blog-post-more blog-inline-icon">
                阅读
                <ArrowRight {...iconParkOutline} size={14} aria-hidden />
              </span>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
