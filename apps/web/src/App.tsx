import { Cursor } from "animal-island-ui";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { CategoriesProvider } from "@/lib/categories";
import { ThemeProvider } from "@/lib/theme";
import Home from "@/pages/Home/Home";
import { CategoryPage } from "@/pages/Category";
import { NotesPage } from "@/pages/Notes";
import { NotFoundPage } from "@/pages/NotFound";

const Post = lazy(() => import("@/pages/Post/Post"));
const LoginPage = lazy(() => import("@/pages/Login").then((mod) => ({ default: mod.LoginPage })));
const WorkspaceLayout = lazy(() =>
  import("@/workspace/WorkspaceLayout").then((mod) => ({ default: mod.WorkspaceLayout })),
);
const WorkspaceIndex = lazy(() =>
  import("@/workspace/WorkspaceLayout").then((mod) => ({ default: mod.WorkspaceIndex })),
);
const WorkspacePage = lazy(() =>
  import("@/workspace/WorkspacePage").then((mod) => ({ default: mod.WorkspacePage })),
);
const RedirectToSpecial = lazy(() =>
  import("@/workspace/WorkspaceLayout").then((mod) => ({ default: mod.RedirectToSpecial })),
);
const RedirectWrite = lazy(() =>
  import("@/workspace/WorkspaceLayout").then((mod) => ({ default: mod.RedirectWrite })),
);

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <CategoriesProvider>
            <Cursor forceAll={false}>
              <Suspense fallback={<div className="route-fallback" />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/notes" element={<NotesPage />} />
                  <Route path="/post/:slug" element={<Post />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route element={<WorkspaceLayout />}>
                    <Route path="/admin" element={<WorkspaceIndex />} />
                    <Route path="/admin/p/:id" element={<WorkspacePage />} />
                    <Route path="/admin/about" element={<RedirectToSpecial kind="about" />} />
                    <Route path="/admin/photos" element={<Navigate to="/admin" replace />} />
                    <Route path="/admin/categories" element={<Navigate to="/admin" replace />} />
                    <Route path="/admin/write" element={<RedirectWrite />} />
                    <Route path="/admin/write/:id" element={<RedirectWrite />} />
                  </Route>
                  <Route path="/:slug" element={<CategoryPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </Cursor>
          </CategoriesProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}

export default App;
