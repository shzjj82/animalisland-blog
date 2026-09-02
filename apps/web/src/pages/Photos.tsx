import type { PostListItem } from "@myblog/shared";
import { Card, Image } from "animal-island-ui";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BlogShell } from "@/components/BlogShell";
import { api } from "@/lib/api";
import type { BlogColor } from "@/pages/Home/posts";

const photoTileColors: BlogColor[] = [
  "warm-peach-pink",
  "app-yellow",
  "app-blue",
  "lime-green",
  "app-teal",
];

export function PhotosPage() {
  const navigate = useNavigate();
  const [photos, setPhotos] = useState<PostListItem[]>([]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    void api
      .listPosts("photo")
      .then((data) => setPhotos(data.posts.filter((post) => post.coverUrl)))
      .catch(() => setPhotos([]));
  }, []);

  return (
    <BlogShell>
      <section className="blog-section post-list">
        <h2 className="blog-section-title">照片</h2>
        <p className="blog-section-sub">路上、窗边、顺手拍下的画面。</p>
        {photos.length === 0 ? (
          <Card color="warm-peach-pink">
            <p className="blog-section-sub" style={{ marginBottom: 0 }}>
              还没有带封面的照片。登录写作台，在「照片墙」放一张上去。
            </p>
          </Card>
        ) : (
          <div className="blog-photo-wall">
            {photos.map((post, index) => (
              <Card
                key={post.id}
                color={photoTileColors[index % photoTileColors.length]}
                className="blog-photo-tile"
              >
                <div className="blog-photo-frame">
                  <Image src={post.coverUrl} alt={post.title} preview lazy color="white" />
                </div>
                <button
                  type="button"
                  className="blog-photo-caption"
                  onClick={() => navigate(`/post/${post.slug}`)}
                >
                  {post.title}
                </button>
              </Card>
            ))}
          </div>
        )}
      </section>
    </BlogShell>
  );
}
