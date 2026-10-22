import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 兜底生成 dmg：tauri 自带的 create-dmg 脚本偶尔会因为脚本权限失败
 * （Failed to bundle project: error running bundle_dmg.sh: Permission denied）。
 * 这里直接用 hdiutil 打一个：镜像里放 app + /Applications 快捷方式，压缩成只读镜像。
 *
 * 产物路径与 tauri 一致，收集步骤不用改。
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0");
const bundleDir = path.join(root, "src-tauri/target/universal-apple-darwin/release/bundle");
const app = path.join(bundleDir, "macos/wiki-agent.app");
const outDir = path.join(bundleDir, "dmg");
const out = path.join(outDir, `wiki-agent_${version}_universal.dmg`);

if (!fs.existsSync(app)) {
  console.error(`没有找到 ${app}，先跑 tauri build --target universal-apple-darwin --bundles app`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe" });
  if (result.status !== 0) {
    const detail = `${result.stderr?.toString() || ""}${result.stdout?.toString() || ""}`.trim();
    throw new Error(`${command} 失败（${result.status}）${detail ? `：${detail}` : ""}`);
  }
}

/** app 体积再加 60m 余量给文件系统元数据 */
function imageSize(dir) {
  const result = spawnSync("du", ["-sm", dir], { stdio: "pipe" });
  const mb = Number.parseInt(result.stdout?.toString().trim().split(/\s+/)[0] ?? "0", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 300) + 60;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dmg-"));
const raw = path.join(tmpDir, "raw.dmg");
const mount = path.join(tmpDir, "mnt");

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.rmSync(out, { force: true });
  fs.mkdirSync(mount, { recursive: true });
  run("hdiutil", ["create", "-size", `${imageSize(app)}m`, "-fs", "HFS+J", "-volname", `wiki-agent ${version}`, "-o", raw]);
  run("hdiutil", ["attach", "-mountpoint", mount, raw]);
  try {
    fs.cpSync(app, path.join(mount, "wiki-agent.app"), { recursive: true });
    fs.symlinkSync("/Applications", path.join(mount, "Applications"));
  } finally {
    run("hdiutil", ["detach", mount]);
  }
  run("hdiutil", ["convert", raw, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", out]);
  console.log(out);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
