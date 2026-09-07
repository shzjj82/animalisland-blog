import type { Post, PostListItem } from "@myblog/shared";
import { FileText, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AdminPageHeader } from "@/components/AdminPageHeader";
import { TypeChips } from "@/components/TypeChips";
import { WriteEditor } from "@/components/WriteEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/categories";

type WriteTarget = { mode: "create"; type?: string } | { mode: "edit"; id: string };

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = ["10", "20", "50"] as const;

export function AdminPage() {
  const { articleCategories } = useCategories();
  const [posts, setPosts] = useState<PostListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<string | "all">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [writeTarget, setWriteTarget] = useState<WriteTarget | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const reloadPosts = useCallback(() => {
    setLoading(true);
    void api
      .listPosts({
        kind: "article",
        type: filter === "all" ? undefined : filter,
        page,
        pageSize,
      })
      .then((data) => {
        setPosts(data.posts);
        setTotal(data.total);
      })
      .finally(() => setLoading(false));
  }, [filter, page, pageSize]);

  useEffect(() => {
    reloadPosts();
  }, [reloadPosts]);

  useEffect(() => {
    const editId = searchParams.get("edit");
    const write = searchParams.get("write");
    const type = searchParams.get("type") ?? undefined;
    if (editId) {
      setWriteTarget({ mode: "edit", id: editId });
      return;
    }
    if (write === "1" || write === "new") {
      setWriteTarget({ mode: "create", type });
    }
  }, [searchParams]);

  const closeWrite = () => {
    setWriteTarget(null);
    if (searchParams.has("edit") || searchParams.has("write") || searchParams.has("type")) {
      const next = new URLSearchParams(searchParams);
      next.delete("edit");
      next.delete("write");
      next.delete("type");
      setSearchParams(next, { replace: true });
    }
  };

  const openCreate = (type?: string) => {
    setWriteTarget({ mode: "create", type });
  };

  const openEdit = (id: string) => {
    setWriteTarget({ mode: "edit", id });
  };

  const onSaved = (_post: Post) => {
    closeWrite();
    reloadPosts();
  };

  const remove = async (id: string) => {
    if (!confirm("确定删除这篇文章？")) {
      return;
    }
    await api.deletePost(id);
    if (posts.length <= 1 && page > 1) {
      setPage((prev) => prev - 1);
      return;
    }
    reloadPosts();
  };

  const onFilterChange = (value: string | "all") => {
    setFilter(value);
    setPage(1);
  };

  const modalOpen = Boolean(writeTarget);
  const modalTitle = writeTarget?.mode === "edit" ? "编辑文章" : "新文章";

  return (
    <section className="flex min-h-full flex-1 flex-col">
      <AdminPageHeader
        title="文章"
        description="管理已发布和草稿。点「新文章」或「编辑」会弹出写作窗。"
        actions={
          <Button onClick={() => openCreate()}>
            <Plus className="size-4" />
            新文章
          </Button>
        }
      />

      <TypeChips
        includeAll
        className="mb-5"
        categories={articleCategories}
        value={filter}
        onChange={onFilterChange}
      />

      {loading && posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">加载中…</p>
      ) : posts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
              <FileText className="size-5" />
            </div>
            <p className="text-sm text-muted-foreground">
              {total === 0 && filter === "all" ? "还没有文章，先写一篇吧。" : "这一类还是空的。"}
            </p>
            {total === 0 && filter === "all" ? (
              <Button onClick={() => openCreate()}>写第一篇</Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <>
          <ul className="space-y-3">
            {posts.map((post) => (
              <li key={post.id}>
                <Card className="border border-border bg-card shadow-sm transition-colors hover:bg-muted/20">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0 space-y-2">
                      <h2 className="truncate text-base font-semibold tracking-tight text-foreground">{post.title}</h2>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="secondary">{post.categoryName}</Badge>
                        {post.draft ? (
                          <Badge variant="outline">草稿</Badge>
                        ) : (
                          <Badge>已发布</Badge>
                        )}
                        <span>{post.updatedAt.slice(0, 10)}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {!post.draft ? (
                        <Button size="sm" variant="ghost" onClick={() => navigate(`/post/${post.slug}`)}>
                          查看
                        </Button>
                      ) : null}
                      <Button size="sm" variant="outline" onClick={() => openEdit(post.id)}>
                        编辑
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => void remove(post.id)}>
                        删除
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <Separator className="my-5" />

          <div className="mt-auto flex flex-wrap items-center justify-end gap-3">
            <span className="mr-auto text-sm text-muted-foreground">
              共 {total} 篇 · 第 {page}/{totalPages} 页
            </span>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => {
                setPage(1);
                setPageSize(Number(value));
              }}
            >
              <SelectTrigger size="sm" aria-label="每页条数" className="w-[96px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <SelectItem key={size} value={size}>
                    {size} / 页
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={modalOpen}
        onOpenChange={(open) => {
          if (!open) closeWrite();
        }}
      >
        <DialogContent
          className="flex h-[min(92vh,900px)] w-[calc(100vw-32px)] max-w-[1240px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1240px]"
          showCloseButton
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader className="shrink-0 space-y-0 border-b border-border px-6 py-4 pr-12 text-left">
            <DialogTitle className="text-lg">{modalTitle}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-hidden">
            {writeTarget ? (
              <WriteEditor
                key={writeTarget.mode === "edit" ? writeTarget.id : `new-${writeTarget.type ?? "x"}`}
                postId={writeTarget.mode === "edit" ? writeTarget.id : null}
                defaultType={writeTarget.mode === "create" ? writeTarget.type : null}
                onClose={closeWrite}
                onSaved={onSaved}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
