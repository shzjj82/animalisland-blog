import { POST_TYPE_LABEL, isArticleType, type ArticleType, type PostListItem } from "@myblog/shared";
import { Button, Card, Icon, Tag } from "animal-island-ui";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { TypeChips } from "@/components/TypeChips";
import { api } from "@/lib/api";

export function AdminPage() {
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [filter, setFilter] = useState<ArticleType | "all">("all");

  useEffect(() => {
    void api.listPosts().then((data) => setPosts(data.posts.filter((post) => isArticleType(post.type))));
  }, []);

  const remove = async (id: string) => {
    if (!confirm("确定删除这篇文章？")) {
      return;
    }
    await api.deletePost(id);
    setPosts((prev) => prev.filter((p) => p.id !== id));
  };

  const visible = filter === "all" ? posts : posts.filter((post) => post.type === filter);

  return (
    <section className="admin-page">
      <div className="admin-head">
        <div className="section-head">
          <Icon name="icon-design" size={36} />
          <div>
            <h1 className="page-title">文章</h1>
            <p className="section-copy">写之前先选类型：生活、编程或闲聊。</p>
          </div>
        </div>
        <Link to="/admin/write">
          <Button type="primary" icon={<Icon name="icon-diy" size={16} />}>
            新文章
          </Button>
        </Link>
      </div>
      <TypeChips includeAll className="admin-filter" value={filter} onChange={setFilter} />
      {visible.length === 0 ? (
        <Card color="app-yellow" className="empty-card">
          <Icon name="icon-map" size={48} />
          <p className="muted">
            {posts.length === 0 ? "还没有文章，先选一个类型写一篇。" : "这一类还是空的。"}
          </p>
        </Card>
      ) : (
        <ul className="admin-list">
          {visible.map((post) => (
            <li key={post.id}>
              <Card color="default" className="admin-row-card">
                <div>
                  <strong>{post.title}</strong>
                  <div className="admin-meta">
                    <Tag size="small">{POST_TYPE_LABEL[post.type]}</Tag>
                    {post.draft ? (
                      <Tag size="small" color="brown">
                        草稿
                      </Tag>
                    ) : (
                      <Tag size="small" color="app-green">
                        已发布
                      </Tag>
                    )}
                    <span>{post.updatedAt.slice(0, 10)}</span>
                  </div>
                </div>
                <div className="admin-row-actions">
                  <Link to={`/admin/write/${post.id}`}>
                    <Button size="small">编辑</Button>
                  </Link>
                  <Button size="small" danger onClick={() => void remove(post.id)}>
                    删除
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
