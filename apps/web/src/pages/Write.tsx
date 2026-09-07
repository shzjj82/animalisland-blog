import { Navigate, useParams, useSearchParams } from "react-router-dom";

/** 兼容旧链接：/admin/write → 文章列表弹窗 */
export function WritePage() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type");

  if (id) {
    return <Navigate to={`/admin?edit=${encodeURIComponent(id)}`} replace />;
  }

  const qs = new URLSearchParams({ write: "1" });
  if (type) {
    qs.set("type", type);
  }
  return <Navigate to={`/admin?${qs.toString()}`} replace />;
}
