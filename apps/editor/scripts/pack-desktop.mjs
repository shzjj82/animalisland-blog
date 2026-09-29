import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2];

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function assembleWindowsPortable() {
  const exe = path.join(root, "src-tauri/target/x86_64-pc-windows-msvc/release/wiki-agent.exe");
  if (!fs.existsSync(exe)) {
    console.error("没有找到 wiki-agent.exe");
    process.exit(1);
  }
  const releaseDir = path.join(root, "release");
  const out = path.join(releaseDir, "wiki-agent-windows");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(exe, path.join(out, "wiki-agent.exe"));
  fs.copyFileSync(path.join(root, "src-tauri/resources/node.exe"), path.join(out, "node.exe"));
  fs.copyFileSync(path.join(root, "src-tauri/resources/desktop-server.mjs"), path.join(out, "desktop-server.mjs"));
  fs.cpSync(path.join(root, "dist"), path.join(out, "dist"), { recursive: true });
  const zipPath = path.join(releaseDir, "wiki-agent-windows.zip");
  fs.rmSync(zipPath, { force: true });
  const zip = spawnSync("zip", ["-r", "-q", zipPath, "wiki-agent-windows"], { cwd: releaseDir, stdio: "inherit" });
  if (zip.status !== 0) {
    process.exit(zip.status ?? 1);
  }
  console.log(zipPath);
}

if (mode === "macos") {
  run(process.execPath, ["scripts/copy-node.mjs", "darwin"]);
  run("pnpm", ["exec", "tauri", "build", "--bundles", "app,dmg"]);
} else if (mode === "windows") {
  run(process.execPath, ["scripts/copy-node.mjs", "win32"]);
  if (process.platform === "win32") {
    run("pnpm", ["exec", "tauri", "build", "--bundles", "nsis"]);
  } else {
    run("pnpm", [
      "exec",
      "tauri",
      "build",
      "--runner",
      "cargo-xwin",
      "--target",
      "x86_64-pc-windows-msvc",
      "--no-bundle",
    ]);
    assembleWindowsPortable();
  }
} else {
  console.error("用法: node scripts/pack-desktop.mjs macos|windows");
  process.exit(1);
}
