import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "src-tauri/resources");
const target = process.argv[2] || (process.platform === "win32" ? "win32" : "darwin");

fs.mkdirSync(destDir, { recursive: true });

if (target === "darwin") {
  if (process.platform !== "darwin") {
    console.error("macOS 安装包需要在 macOS 上打包");
    process.exit(1);
  }
  const dest = path.join(destDir, "node");
  fs.copyFileSync(process.execPath, dest);
  fs.chmodSync(dest, 0o755);
} else if (target === "win32") {
  const dest = path.join(destDir, "node.exe");
  if (process.platform === "win32") {
    fs.copyFileSync(process.execPath, dest);
  } else {
    const version = process.version.replace(/^v/, "");
    const url = `https://nodejs.org/dist/v${version}/win-x64/node.exe`;
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
    const args = ["-fsSL", "-o", dest, url];
    if (proxy) {
      args.unshift("-x", proxy);
    }
    execFileSync("curl", args, { stdio: "inherit" });
  }
} else {
  console.error(`不支持的打包目标: ${target}`);
  process.exit(1);
}
