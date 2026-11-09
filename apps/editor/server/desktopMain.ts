import { startDesktopServer } from "./desktopServer.ts";

const distDir = process.argv[2];
if (!distDir) {
  console.error("缺少页面目录");
  process.exit(1);
}

try {
  const port = await startDesktopServer(distDir);
  // 必须是 stdout 首行有效内容：宿主进程靠它跳转 WebView
  console.log(`PORT ${port}`);
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
}
