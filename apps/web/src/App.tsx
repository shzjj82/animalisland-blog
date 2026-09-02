import { ARTICLE_PATH, ARTICLE_TYPES } from "@myblog/shared";
import { Cursor } from "animal-island-ui";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AdminLayout } from "@/components/AdminLayout";
import { AuthProvider } from "@/lib/auth";
import { ThemeProvider } from "@/lib/theme";
import { AdminPage } from "@/pages/Admin";
import { AdminAboutPage } from "@/pages/AdminAbout";
import { AdminPhotosPage } from "@/pages/AdminPhotos";
import Home from "@/pages/Home/Home";
import { LoginPage } from "@/pages/Login";
import { PhotosPage } from "@/pages/Photos";
import Post from "@/pages/Post/Post";
import { PostListPage } from "@/pages/PostList";
import { WritePage } from "@/pages/Write";

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <Cursor>
            <Routes>
              <Route path="/" element={<Home />} />
              {ARTICLE_TYPES.map((type) => (
                <Route key={type} path={ARTICLE_PATH[type]} element={<PostListPage type={type} />} />
              ))}
              <Route path="/photos" element={<PhotosPage />} />
              <Route path="/post/:slug" element={<Post />} />
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AdminLayout />}>
                <Route path="/admin" element={<AdminPage />} />
                <Route path="/admin/photos" element={<AdminPhotosPage />} />
                <Route path="/admin/about" element={<AdminAboutPage />} />
                <Route path="/admin/write" element={<WritePage />} />
                <Route path="/admin/write/:id" element={<WritePage />} />
              </Route>
            </Routes>
          </Cursor>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
