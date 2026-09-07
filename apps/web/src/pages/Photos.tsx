import type { Category, PostListItem } from "@myblog/shared";
import { Card } from "animal-island-ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BlogShell } from "@/components/BlogShell";
import { Seo } from "@/components/Seo";
import { api } from "@/lib/api";

function columnCountForWidth(width: number): number {
  if (width >= 1100) {
    return 4;
  }
  if (width >= 720) {
    return 3;
  }
  if (width >= 420) {
    return 2;
  }
  return 1;
}

function splitMasonry(photos: PostListItem[], ratios: Record<string, number>, columns: number): PostListItem[][] {
  const cols: PostListItem[][] = Array.from({ length: columns }, () => []);
  const heights = Array.from({ length: columns }, () => 0);
  for (const photo of photos) {
    let shortest = 0;
    for (let index = 1; index < columns; index += 1) {
      if (heights[index] < heights[shortest]) {
        shortest = index;
      }
    }
    cols[shortest].push(photo);
    heights[shortest] += ratios[photo.id] ?? 1.2;
  }
  return cols;
}

function useWallColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(() =>
    typeof window === "undefined" ? 3 : columnCountForWidth(Math.min(window.innerWidth - 56, 1120)),
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const apply = (width: number) => setCount(columnCountForWidth(width));
    apply(el.clientWidth);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth;
      apply(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, count };
}

export function PhotosPage({ category }: { category: Category }) {
  const [photos, setPhotos] = useState<PostListItem[]>([]);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<PostListItem | null>(null);
  const { ref, count } = useWallColumns();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    void api
      .listPosts({ kind: "photos" })
      .then((data) => setPhotos(data.posts.filter((post) => post.coverUrl)))
      .catch(() => setPhotos([]));
  }, [category.slug]);

  useEffect(() => {
    if (photos.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      photos.map(
        (photo) =>
          new Promise<[string, number]>((resolve) => {
            const img = new window.Image();
            img.onload = () => resolve([photo.id, img.naturalHeight / Math.max(img.naturalWidth, 1)]);
            img.onerror = () => resolve([photo.id, 1.2]);
            img.src = photo.coverUrl;
          }),
      ),
    ).then((entries) => {
      if (!cancelled) {
        setRatios(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [photos]);

  useEffect(() => {
    if (!preview) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreview(null);
      }
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [preview]);

  const columns = useMemo(() => splitMasonry(photos, ratios, count), [photos, ratios, count]);

  return (
    <BlogShell>
      <Seo title={category.name} description={category.hint} path={`/${category.slug}`} />
      <section className="blog-section post-list">
        <h1 className="blog-section-title">{category.name}</h1>
        <p className="blog-section-sub">{category.hint}</p>
        {photos.length === 0 ? (
          <Card color="warm-peach-pink">
            <p className="blog-section-sub" style={{ marginBottom: 0 }}>
              还没有照片。登录写作台，在「照片墙」放一张上去。
            </p>
          </Card>
        ) : (
          <div ref={ref} className="blog-photo-wall">
            {columns.map((column, columnIndex) => (
              <div key={columnIndex} className="blog-photo-col">
                {column.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className="blog-photo-tile"
                    onClick={() => setPreview(post)}
                  >
                    <img src={post.coverUrl} alt={post.title} loading="lazy" decoding="async" />
                    <span className="blog-photo-caption">{post.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      {preview ? (
        <div className="blog-photo-lightbox" onClick={() => setPreview(null)}>
          <img
            src={preview.coverUrl}
            alt={preview.title}
            onClick={(event) => event.stopPropagation()}
          />
          <Link to={`/post/${preview.slug}`} onClick={(event) => event.stopPropagation()}>
            {preview.title}
          </Link>
        </div>
      ) : null}
    </BlogShell>
  );
}
