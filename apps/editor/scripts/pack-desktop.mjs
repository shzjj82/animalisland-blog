import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const mode = process.argv[2];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

/** 读 .env.signing 里的签名/公证变量；已经 export 的优先 */
function loadSigningEnv() {
  const file = path.join(root, ".env.signing");
  if (!fs.existsSync(file)) {
    return;
  }
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]]) {
      continue;
    }
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    if (value) {
      process.env[match[1]] = value;
    }
  }
}

/** 固定在 src-tauri/target，不跟随外部 CARGO_TARGET_DIR，产物始终留在项目里 */
process.env.CARGO_TARGET_DIR = path.join(root, "src-tauri/target");

function targetDir() {
  return process.env.CARGO_TARGET_DIR;
}

function copyInto(file) {
  fs.mkdirSync(releaseDir, { recursive: true });
  const dest = path.join(releaseDir, path.basename(file));
  fs.rmSync(dest, { recursive: true, force: true });
  if (fs.statSync(file).isDirectory()) {
    run("ditto", [file, dest]);
  } else {
    fs.copyFileSync(file, dest);
  }
  console.log(dest);
}

function packMacos() {
  loadSigningEnv();
  const identity = process.env.APPLE_SIGNING_IDENTITY;
  const signed = Boolean(identity && identity !== "-");
  const notarize = Boolean(
    (process.env.APPLE_API_ISSUER && process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_PATH) ||
      (process.env.APPLE_ID && process.env.APPLE_PASSWORD && process.env.APPLE_TEAM_ID),
  );
  if (signed && !identity.startsWith("Developer ID Application:")) {
    console.error(`APPLE_SIGNING_IDENTITY 必须是「Developer ID Application」证书，当前是：${identity}`);
    process.exit(1);
  }
  if (signed && !notarize) {
    console.error("已配置签名证书但缺少公证凭据，没公证的包别人照样打不开。见 .env.signing.example");
    process.exit(1);
  }
  if (!signed) {
    process.env.APPLE_SIGNING_IDENTITY = "-";
    console.warn("未配置 Developer ID 证书：使用临时签名，安装包只能自己用，不能分发。见 .env.signing.example");
  }

  run(process.execPath, ["scripts/copy-node.mjs", "darwin"]);
  if (signed) {
    /** 官方 node 带 get-task-allow，公证会拒；用自己的证书重签，只保留 V8 需要的权限 */
    run("codesign", [
      "--force",
      "--options",
      "runtime",
      "--timestamp",
      "--entitlements",
      "src-tauri/node.entitlements",
      "--sign",
      identity,
      "src-tauri/resources/node",
    ]);
  }
  // dmg 自己用 hdiutil 打：tauri 的 create-dmg 会去执行它生成的 bundle_dmg.sh，
  // 那个脚本没有执行权限时直接 Permission denied，整个打包白跑
  run("pnpm", ["exec", "tauri", "build", "--target", "universal-apple-darwin", "--bundles", "app"]);
  run(process.execPath, ["scripts/pack-macos-dmg.mjs"]);

  const bundle = path.join(targetDir(), "universal-apple-darwin/release/bundle");
  const app = path.join(bundle, "macos/wiki-agent.app");
  for (const name of fs.readdirSync(path.join(bundle, "dmg"))) {
    if (name.endsWith(".dmg")) {
      copyInto(path.join(bundle, "dmg", name));
    }
  }
  copyInto(app);
  if (signed) {
    run("spctl", ["--assess", "--type", "execute", "--verbose", path.join(releaseDir, "wiki-agent.app")]);
  }
}

/** Windows 便携包交给独立脚本，本地和 CI 共用同一份逻辑与文件名 */
function assembleWindowsPortable() {
  run(process.execPath, ["scripts/pack-windows-portable.mjs"]);
}

/** Homebrew 的 llvm / lld 是 keg-only，不进 PATH；交叉编译要用里面的 llvm-rc、lld-link */
function addHomebrewLlvmToPath() {
  const dirs = [
    "/opt/homebrew/opt/llvm/bin",
    "/opt/homebrew/opt/lld/bin",
    "/usr/local/opt/llvm/bin",
    "/usr/local/opt/lld/bin",
    path.join(process.env.HOME || "", ".cache/wiki-agent-tools/bin"),
  ];
  const found = dirs.filter((dir) => fs.existsSync(dir));
  if (found.length > 0) {
    process.env.PATH = [...found, process.env.PATH].join(path.delimiter);
  }
  if (spawnSync("llvm-rc", ["/?"], { stdio: "ignore" }).error) {
    console.error("没有找到 llvm-rc，交叉编译 Windows 需要：brew install llvm lld");
    process.exit(1);
  }
}

function packWindows() {
  if (process.platform !== "win32") {
    addHomebrewLlvmToPath();
  }
  run(process.execPath, ["scripts/copy-node.mjs", "win32"]);
  if (process.platform === "win32") {
    run("pnpm", ["exec", "tauri", "build", "--bundles", "nsis"]);
  } else {
    const hasNsis = spawnSync("makensis", ["-VERSION"], { stdio: "ignore" }).status === 0;
    if (!hasNsis) {
      console.warn("没有找到 makensis，只生成免安装压缩包；要安装程序请先装 NSIS");
    }
    run("pnpm", [
      "exec",
      "tauri",
      "build",
      "--runner",
      "cargo-xwin",
      "--target",
      "x86_64-pc-windows-msvc",
      ...(hasNsis ? ["--bundles", "nsis"] : ["--no-bundle"]),
    ]);
  }
  const nsisDir = path.join(targetDir(), "x86_64-pc-windows-msvc/release/bundle/nsis");
  if (fs.existsSync(nsisDir)) {
    for (const name of fs.readdirSync(nsisDir)) {
      if (name.endsWith(".exe")) {
        copyInto(path.join(nsisDir, name));
      }
    }
  }
  assembleWindowsPortable();
}

if (mode === "macos") {
  packMacos();
} else if (mode === "windows") {
  packWindows();
} else {
  console.error("用法: node scripts/pack-desktop.mjs macos|windows");
  process.exit(1);
}
