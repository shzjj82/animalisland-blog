import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 打 dmg：app + /Applications 快捷方式，并把「拖拽窗口」的排版写进镜像。
 *
 * 为什么不用 tauri 自带的 create-dmg：它那段排版是靠 AppleScript 驱动 Finder 完成的，
 * 只有带图形会话的机器才跑得动。GitHub Actions 的 macOS runner 没有 Finder 会话，
 * osascript 会以「Not authorized to send Apple events」失败，镜像里就没有 .DS_Store
 * 也没有 .VolumeIcon.icns，挂载出来是默认的未排版窗口 —— 就是「拖拽页面变了」的现象。
 *
 * 现在改成：窗口尺寸、图标位置、图标大小、卷图标都来自仓库里的一份 .DS_Store 模板
 * （scripts/assets/dmg-window.bin，取自 create-dmg 默认的排版：
 *   窗口 660x400、图标 128、文字 16、app 在 (180,170)、Applications 在 (480,170)），
 * 直接复制进镜像。本地和 CI 走完全相同的代码路径，产物一致，也不再依赖 Finder。
 *
 * 产物路径与 tauri 一致，收集步骤不用改。
 *
 * 用法：
 *   node scripts/pack-macos-dmg.mjs                  打 dmg
 *   node scripts/pack-macos-dmg.mjs --regen-template 用 create-dmg 重新生成窗口模板
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0");
const bundleDir = path.join(root, "src-tauri/target/universal-apple-darwin/release/bundle");
const app = path.join(bundleDir, "macos/wiki-agent.app");
const outDir = path.join(bundleDir, "dmg");
const out = path.join(outDir, `wiki-agent_${version}_universal.dmg`);
const template = path.join(root, "scripts/assets/dmg-window.bin");
const createDmg = path.join(outDir, "bundle_dmg.sh");
const iconCandidates = [path.join(root, "src-tauri/icons/icon.icns"), path.join(outDir, "icon.icns")];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe" });
  if (result.status !== 0) {
    const detail = `${result.stderr?.toString() || ""}${result.stdout?.toString() || ""}`.trim();
    throw new Error(`${command} 失败（${result.status}）${detail ? `：${detail}` : ""}`);
  }
  return result;
}

/** SetFile 属于 Xcode 命令行工具，缺了只是没有卷图标，窗口排版照旧 */
function tryRun(command, args) {
  const result = spawnSync(command, args, { stdio: "pipe" });
  return result.status === 0;
}

/** app 体积再加 60m 余量给文件系统元数据 */
function imageSize(dir) {
  const result = spawnSync("du", ["-sm", dir], { stdio: "pipe" });
  const mb = Number.parseInt(result.stdout?.toString().trim().split(/\s+/)[0] ?? "0", 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 300) + 60;
}

/** create-dmg 会在输出目录留一份 rw.<pid>.xxx.dmg 中间镜像，失败了就一直是垃圾 */
function cleanInterstitial() {
  if (!fs.existsSync(outDir)) {
    return;
  }
  for (const name of fs.readdirSync(outDir)) {
    if (name.startsWith("rw.") && name.endsWith(".dmg")) {
      fs.rmSync(path.join(outDir, name), { force: true });
      console.log(`清掉中间镜像 ${name}`);
    }
  }
}

/**
 * 挂载镜像并返回挂载点。
 * 不用 -mountpoint 指定固定目录：那个目录一旦被占用 hdiutil 直接报「资源忙」，
 * CI 上更难排查；-mountrandom + -plist 让系统自己挑目录，再把路径解析出来。
 */
function attach(image, readonly = false) {
  const args = ["attach", "-plist", "-noverify", "-noautoopen", "-mountrandom", os.tmpdir()];
  if (readonly) {
    args.push("-readonly");
  }
  args.push(image);
  const result = spawnSync("hdiutil", args, { stdio: "pipe" });
  if (result.status !== 0) {
    const detail = `${result.stderr?.toString() || ""}${result.stdout?.toString() || ""}`.trim();
    throw new Error(`hdiutil attach 失败（${result.status}）${detail ? `：${detail}` : ""}`);
  }
  // plist 里可能有多条记录（分区方案 + 真正的卷），取最后一个才是卷的挂载点
  const points = [...result.stdout.toString().matchAll(/<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/g)].map(
    (match) => match[1],
  );
  const mountPoint = points.at(-1);
  if (!mountPoint) {
    throw new Error("解析不到挂载点");
  }
  return mountPoint;
}

function detach(mountPoint) {
  const result = spawnSync("hdiutil", ["detach", mountPoint], { stdio: "pipe" });
  if (result.status !== 0) {
    const detail = `${result.stderr?.toString() || ""}${result.stdout?.toString() || ""}`.trim();
    throw new Error(`hdiutil detach 失败（${result.status}）${detail ? `：${detail}` : ""}`);
  }
}

/** 校验镜像里确实带上了窗口排版，没带上就直接失败，别等用户挂载才发现 */
function assertWindow(image) {
  const mountPoint = attach(image, true);
  let size = 0;
  try {
    const dsStore = path.join(mountPoint, ".DS_Store");
    const volumeIcon = path.join(mountPoint, ".VolumeIcon.icns");
    const problems = [];
    if (!fs.existsSync(dsStore) || fs.statSync(dsStore).size === 0) {
      problems.push("缺 .DS_Store（窗口不会排版）");
    } else {
      size = fs.statSync(dsStore).size;
      // 文件头是 4 字节版本号 + "Bud1"
      const magic = fs.readFileSync(dsStore).subarray(4, 8).toString("latin1");
      if (magic !== "Bud1") {
        problems.push(".DS_Store 格式不对（不是 Bud1）");
      }
    }
    if (!fs.existsSync(volumeIcon)) {
      problems.push("缺 .VolumeIcon.icns（没有卷图标）");
    }
    if (!fs.existsSync(path.join(mountPoint, "Applications"))) {
      problems.push("缺 Applications 快捷方式（没法拖拽安装）");
    }
    if (problems.length > 0) {
      throw new Error(`镜像缺少拖拽窗口所需的排版：${problems.join("、")}`);
    }
    return { dsStore: size };
  } finally {
    spawnSync("hdiutil", ["detach", mountPoint], { stdio: "ignore" });
  }
}

/**
 * 重新生成窗口模板：只有本机有 Finder 会话才跑得通，
 * 生成的 .DS_Store 会被存成 scripts/assets/dmg-window.bin 供 CI 使用。
 */
function regenerateTemplate() {
  if (!fs.existsSync(createDmg)) {
    console.error(`没有找到 ${createDmg}，先跑一次 tauri build --bundles app`);
    process.exit(1);
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-cdmg-"));
  const stage = path.join(tmpDir, "stage");
  fs.mkdirSync(stage, { recursive: true });
  run("ditto", [app, path.join(stage, "wiki-agent.app")]);
  const image = path.join(tmpDir, "template.dmg");
  const result = spawnSync(
    "bash",
    [
      createDmg,
      "--volname",
      `wiki-agent ${version}`,
      "--volicon",
      iconCandidates.find((item) => fs.existsSync(item)),
      "--window-pos",
      "10",
      "60",
      "--window-size",
      "660",
      "400",
      "--text-size",
      "16",
      "--icon-size",
      "128",
      "--icon",
      "wiki-agent.app",
      "180",
      "170",
      "--app-drop-link",
      "480",
      "170",
      "--hide-extension",
      "wiki-agent.app",
      image,
      stage,
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0 || !fs.existsSync(image)) {
    console.error("create-dmg 没跑成功：本机需要能控制 Finder（有图形会话、已授权自动化）");
    process.exit(result.status ?? 1);
  }
  const mountPoint = attach(image, true);
  fs.copyFileSync(path.join(mountPoint, ".DS_Store"), template);
  detach(mountPoint);
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`已更新窗口模板 ${template}`);
}

function build() {
  if (!fs.existsSync(app)) {
    console.error(`没有找到 ${app}，先跑 tauri build --target universal-apple-darwin --bundles app`);
    process.exit(1);
  }
  for (const required of [template]) {
    if (!fs.existsSync(required)) {
      console.error(`没有找到 ${required}：窗口排版模板，丢了就打不出带排版的拖拽窗口`);
      process.exit(1);
    }
  }
  const icon = iconCandidates.find((item) => fs.existsSync(item));

  fs.mkdirSync(outDir, { recursive: true });
  cleanInterstitial();
  fs.rmSync(out, { force: true });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wa-dmg-"));
  const raw = path.join(tmpDir, "raw.dmg");

  try {
    run("hdiutil", [
      "create",
      "-size",
      `${imageSize(app)}m`,
      "-fs",
      "HFS+J",
      "-volname",
      `wiki-agent ${version}`,
      "-o",
      raw,
    ]);
    const mount = attach(raw);
    try {
      fs.cpSync(app, path.join(mount, "wiki-agent.app"), { recursive: true });
      fs.symlinkSync("/Applications", path.join(mount, "Applications"));
      // 窗口排版：图标视图、图标位置、窗口大小都在这一份 .DS_Store 里
      fs.copyFileSync(template, path.join(mount, ".DS_Store"));
      if (icon) {
        fs.copyFileSync(icon, path.join(mount, ".VolumeIcon.icns"));
        tryRun("SetFile", ["-c", "icnC", path.join(mount, ".VolumeIcon.icns")]);
        // 告诉卷「我有自定义图标」，否则 Finder 还是画默认的磁盘图标
        if (!tryRun("SetFile", ["-a", "C", mount])) {
          console.warn("SetFile 不可用，卷图标不会生效（窗口排版不受影响）");
        }
      }
      spawnSync("chmod", ["-Rf", "go-w", mount], { stdio: "ignore" });
      fs.rmSync(path.join(mount, ".fseventsd"), { recursive: true, force: true });
    } finally {
      detach(mount);
    }
    run("hdiutil", ["convert", raw, "-format", "UDZO", "-imagekey", "zlib-level=9", "-o", out]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const { dsStore } = assertWindow(out);
  console.log(`✓ ${out}（窗口排版 ${dsStore}B + 卷图标）`);
}

if (process.argv.includes("--regen-template")) {
  regenerateTemplate();
} else {
  build();
}
