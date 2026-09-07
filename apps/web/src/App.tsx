import { Cursor } from "animal-island-ui";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { CategoriesProvider } from "@/lib/categories";
import { ThemeProvider } from "@/lib/theme";
import Home from "@/pages/Home/Home";
import { CategoryPage } from "@/pages/Category";
import { NotFoundPage } from "@/pages/NotFound";

const Post = lazy(() => import("@/pages/Post/Post"));
const LoginPage = lazy(() => import("@/pages/Login").then((mod) => ({ default: mod.LoginPage })));
const AdminLayout = lazy(() =>
  import("@/components/AdminLayout").then((mod) => ({ default: mod.AdminLayout })),
);
const AdminPage = lazy(() => import("@/pages/Admin").then((mod) => ({ default: mod.AdminPage })));
const AdminPhotosPage = lazy(() =>
  import("@/pages/AdminPhotos").then((mod) => ({ default: mod.AdminPhotosPage })),
);
const AdminAboutPage = lazy(() =>
  import("@/pages/AdminAbout").then((mod) => ({ default: mod.AdminAboutPage })),
);
const AdminCategoriesPage = lazy(() =>
  import("@/pages/AdminCategories").then((mod) => ({ default: mod.AdminCategoriesPage })),
);
const WritePage = lazy(() => import("@/pages/Write").then((mod) => ({ default: mod.WritePage })));

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
                  <Route path="/post/:slug" element={<Post />} />
                  <Route path="/login" element={<LoginPage />} />
                  <Route element={<AdminLayout />}>
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/admin/photos" element={<AdminPhotosPage />} />
                    <Route path="/admin/categories" element={<AdminCategoriesPage />} />
                    <Route path="/admin/about" element={<AdminAboutPage />} />
                    <Route path="/admin/write" element={<WritePage />} />
                    <Route path="/admin/write/:id" element={<WritePage />} />
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
