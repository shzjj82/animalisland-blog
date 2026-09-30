import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type ProxyOptions } from "vite";

const editorRoot = path.dirname(fileURLToPath(import.meta.url));
/** 与 blog server 共用仓库根 `.env`（GATEWAY_BASE_URL 等） */
const repoRoot = path.resolve(editorRoot, "../..");

function gatewayProxy(target: string): Record<string, ProxyOptions> {
  const common: ProxyOptions = {
    target,
    changeOrigin: true,
    secure: true,
  };
  return {
    "/auth": common,
    "/docs": common,
    "/agents": common,
    "/upload": common,
  };
}

export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, repoRoot, "");
  const gatewayBase = (
    rootEnv.GATEWAY_BASE_URL ||
    rootEnv.NEST_BASE_URL ||
    rootEnv.VITE_GATEWAY_BASE_URL ||
    "https://api.championsea.online"
  ).replace(/\/$/, "");

  /**
   * 浏览器一律同源（空串），避免跨域。
   * 真实 Nest 地址只给 Vite / 桌面本地服务做代理目标。
   * 若必须直连，可设 VITE_GATEWAY_PUBLIC_BASE。
   */
  const browserBase = (rootEnv.VITE_GATEWAY_PUBLIC_BASE ?? "").replace(/\/$/, "");

  return {
    clearScreen: false,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    envDir: repoRoot,
    envPrefix: ["VITE_", "TAURI_"],
    define: {
      "import.meta.env.VITE_GATEWAY_BASE_URL": JSON.stringify(browserBase),
    },
    server: {
      host: "0.0.0.0",
      port: 5174,
      strictPort: true,
      proxy: gatewayProxy(gatewayBase),
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 5174,
      strictPort: true,
      proxy: gatewayProxy(gatewayBase),
    },
  };
});
