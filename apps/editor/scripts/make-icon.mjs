import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icons = path.join(root, "src-tauri/icons");
const source = path.resolve(process.argv[2] ?? path.join(root, "public/logo.png"));
const keep = new Set(["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "icon.icns"]);

/** tauri icon 生成的图标带透明通道，打包要求 RGBA；只保留桌面端用到的几个 */
execFileSync("pnpm", ["exec", "tauri", "icon", source, "-o", icons], { cwd: root, stdio: "inherit" });
for (const name of readdirSync(icons)) {
  if (!keep.has(name)) {
    rmSync(path.join(icons, name), { recursive: true, force: true });
  }
}

execFileSync("sips", ["-s", "format", "png", "-z", "64", "64", source, "--out", path.join(root, "public/favicon.png")], {
  stdio: "ignore",
});
