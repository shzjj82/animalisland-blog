import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const icons = path.join(root, "src-tauri/icons");
const source = path.resolve(process.argv[2] ?? path.join(root, "public/logo.png"));
const keep = new Set(["32x32.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico", "icon.icns"]);
const work = mkdtempSync(path.join(tmpdir(), "wiki-agent-icon-"));
const composed = path.join(work, "app-icon.png");

try {
  /** 按 macOS 图标模板加圆角底板和留边，Dock 里才和其他应用一样大 */
  execFileSync("swift", [path.join(root, "scripts/app-icon.swift"), source, composed], { stdio: "inherit" });
  /** tauri icon 生成的图标带透明通道，打包要求 RGBA；只保留桌面端用到的几个 */
  execFileSync("pnpm", ["exec", "tauri", "icon", composed, "-o", icons], { cwd: root, stdio: "inherit" });
  for (const name of readdirSync(icons)) {
    if (!keep.has(name)) {
      rmSync(path.join(icons, name), { recursive: true, force: true });
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

execFileSync("sips", ["-s", "format", "png", "-z", "64", "64", source, "--out", path.join(root, "public/favicon.png")], {
  stdio: "ignore",
});
