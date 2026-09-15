import type { PostListItem } from "@myblog/shared";
import { PageLinkIcon } from "@/lib/iconPark";
import { pageTitle } from "@/lib/pageTree";

type Props = {
  pages: PostListItem[];
  onOpen: (id: string) => void;
};

/** 正文里还没有 pageLink 的子页列表 */
export function LooseChildPages({ pages, onOpen }: Props) {
  if (pages.length === 0) {
    return null;
  }
  return (
    <section className="workspace-child-pages mt-8 border-t border-border/70 pt-5" aria-label="未出现在正文的子页面">
      <p className="mb-3 text-xs text-muted-foreground">这些子页面还没在正文里（例如旧数据）</p>
      <ul className="space-y-2">
        {pages.map((child) => (
          <li key={child.id}>
            <button
              type="button"
              className="cdx-page-link is-clickable w-full text-left"
              onClick={() => onOpen(child.id)}
            >
              <span className="cdx-page-link__icon" aria-hidden>
                <PageLinkIcon size={16} />
              </span>
              <span className="cdx-page-link__title">{pageTitle(child)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
