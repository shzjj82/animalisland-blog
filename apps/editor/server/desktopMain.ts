import fs from "node:fs";
import path from "node:path";
import { startDesktopServer } from "./desktopServer.ts";

const distDir = process.argv[2];
if (!distDir) {
  console.error("缺少页面目录");
  process.exit(1);
}

try {
  const port = await startDesktopServer(distDir);
  // Windows 下 stdout 接到管道时 console.log 会整块缓冲，宿主永远等不到 PORT。
  // writeSync 立刻落盘；同时写旁路文件，宿主可轮询兜底。
  const line = `PORT ${port}\n`;
  try {
    fs.writeSync(1, line);
  } catch {
    // ignore
  }
  try {
    const marker = path.join(path.dirname(path.resolve(distDir)), ".desktop-port");
    fs.writeFileSync(marker, String(port), "utf8");
  } catch (err) {
    console.error(`[desktop-server] 写端口标记失败: ${err instanceof Error ? err.message : err}`);
  }
  console.error(`[desktop-server] ready on 127.0.0.1:${port}`);
} catch (err) {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
}
