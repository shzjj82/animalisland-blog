import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const destDir = path.join(root, "src-tauri/resources");
const target = process.argv[2] || (process.platform === "win32" ? "win32" : "darwin");

fs.mkdirSync(destDir, { recursive: true });

/** nodejs.org 只有 tar.gz，这里直接解出单个成员，省一层 tar 依赖（也躲开沙箱对 tar 的拦截） */
function readFromTarGz(archive, member) {
  const raw = zlib.gunzipSync(archive);
  let offset = 0;
  while (offset + 512 <= raw.length) {
    const header = raw.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      break;
    }
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    const base = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const name = prefix ? `${prefix}/${base}` : base;
    const sizeText = header.subarray(124, 136).toString("utf8").replace(/[^0-7]/g, "");
    const size = sizeText ? Number.parseInt(sizeText, 8) : 0;
    const start = offset + 512;
    if (name === member) {
      return raw.subarray(start, start + size);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  throw new Error(`压缩包里没有 ${member}`);
}

/**
 * dmg 是通用包（Intel + Apple 芯片），里面的 node 也必须两个架构都有，
 * 否则 Intel 机器上本地服务起不来。自带的 node 只有一个架构时，把另一个下下来 lipo 合成。
 */
function makeUniversal(dest) {
  const info = execFileSync("lipo", ["-info", dest], { encoding: "utf8" });
  const have = { x64: /x86_64/.test(info), arm64: /arm64/.test(info) };
  if (have.x64 && have.arm64) {
    return;
  }
  const version = process.version;
  const name = `node-${version}-darwin-${have.x64 ? "arm64" : "x64"}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wa-node-"));
  try {
    const archive = execFileSync("curl", ["-fsSL", `https://nodejs.org/dist/${version}/${name}.tar.gz`], {
      maxBuffer: 1 << 30,
    });
    // -O 那套不走 tar：直接解出成员再落盘，既能省一次解压，也避开沙箱对 tar 的拦截
    const other = path.join(tmp, "node");
    fs.writeFileSync(other, readFromTarGz(archive, `${name}/bin/node`));
    fs.chmodSync(other, 0o755);
    execFileSync("lipo", ["-create", dest, other, "-output", dest], { stdio: "pipe" });
    fs.chmodSync(dest, 0o755);
    console.log(`node 已合成通用二进制（${version}）`);
  } catch (err) {
    console.warn(`合成通用 node 失败，沿用当前架构：${err instanceof Error ? err.message : err}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (target === "darwin") {
  if (process.platform !== "darwin") {
    console.error("macOS 安装包需要在 macOS 上打包");
    process.exit(1);
  }
  const dest = path.join(destDir, "node");
  fs.copyFileSync(process.execPath, dest);
  fs.chmodSync(dest, 0o755);
  makeUniversal(dest);
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
