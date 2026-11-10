#!/usr/bin/env node
/**
 * 根据目录里的 .sig 生成 Tauri 更新清单 latest.json。
 * 应用启动后请求的就是这份文件，地址写在 tauri.conf.json 的 plugins.updater.endpoints。
 *
 *   node scripts/gen-update-manifest.mjs <目录> <版本号>
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] || "");
const version = String(process.argv[3] || "").replace(/^v/, "");
const bucket = process.env.OSS_BUCKET || "championsea";
const region = process.env.OSS_REGION || "oss-cn-shanghai";
const prefix = (process.env.OSS_DOWNLOAD_PREFIX || "wiki-agent").replace(/^\/+|\/+$/g, "");
const base = (process.env.OSS_PUBLIC_BASE || `https://${bucket}.${region}.aliyuncs.com`).replace(/\/+$/, "");

if (!dir || !fs.existsSync(dir) || !version) {
  console.error("用法：node scripts/gen-update-manifest.mjs <目录> <版本号>");
  process.exit(1);
}

const names = fs.readdirSync(dir);
const outFile = path.join(dir, "latest.json");
let platforms = {};
if (fs.existsSync(outFile)) {
  try {
    platforms = JSON.parse(fs.readFileSync(outFile, "utf8")).platforms || {};
  } catch {
    platforms = {};
  }
}

function urlOf(name) {
  const parts = [prefix, version, name].map((part) => encodeURIComponent(part)).join("/");
  return `${base}/${parts}`;
}

let found = 0;
for (const sigName of names.filter((name) => name.endsWith(".sig"))) {
  const artifact = sigName.slice(0, -".sig".length);
  if (!names.includes(artifact)) {
    continue;
  }
  const signature = fs.readFileSync(path.join(dir, sigName), "utf8").trim();
  const url = urlOf(artifact);
  const entry = { signature, url };
  if (artifact.endsWith(".app.tar.gz")) {
    platforms["darwin-aarch64"] = entry;
    platforms["darwin-x86_64"] = entry;
    found += 1;
  } else if (/setup\.exe$/i.test(artifact) || artifact.endsWith(".nsis.zip")) {
    platforms["windows-x86_64"] = entry;
    found += 1;
  }
}

if (!found) {
  console.warn(`没有找到更新包签名，跳过 latest.json：${dir}`);
  process.exit(0);
}

const payload = {
  version,
  notes: `wiki-agent ${version}`,
  pub_date: new Date().toISOString(),
  platforms,
};
fs.writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`latest.json → v${version}（${Object.keys(platforms).join(", ")}）`);
