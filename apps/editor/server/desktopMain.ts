import { startDesktopServer } from "./desktopServer.ts";

const distDir = process.argv[2];
if (!distDir) {
  console.error("缺少页面目录");
  process.exit(1);
}

const port = await startDesktopServer(distDir);
console.log(`PORT ${port}`);
