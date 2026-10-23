/**
 * 极小的 OSS 辅助层，给发版脚本用。
 *
 * 复用 apps/server 已装的 ali-oss（不新增依赖），配置沿用博客那套 OSS_* 环境变量，
 * 安装包统一放在 `<OSS_DOWNLOAD_PREFIX>/<版本>/<文件名>`，路径里带版本号 →
 * 对象内容不可变，可以放心给长缓存（浏览器 / CDN 都不会拿到过期的包）。
 *
 * 环境变量（进程环境优先，其次读仓库根目录 .env）：
 *   OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION / OSS_BUCKET  必需
 *   OSS_DOWNLOAD_PREFIX  安装包目录前缀，默认 wiki-agent
 *   OSS_PUBLIC_BASE      对外访问域名（自定义域名/ CDN），留空则用 bucket.region.aliyuncs.com
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "../../../..");

const MIME = {
  ".dmg": "application/x-apple-diskimage",
  ".zip": "application/zip",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi",
  ".pkg": "application/octet-stream",
};

/* ------------------------------------------------------------ 配置加载 */

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/** 进程环境优先；只有未设置时才用 .env 兜底，避免覆盖 CI 注入的密钥 */
export function loadEnvFiles(files = [".env", ".env.local"]) {
  for (const name of files) {
    const file = path.join(REPO_ROOT, name);
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(parseEnvFile(fs.readFileSync(file, "utf8")))) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function ossConfig() {
  return {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
    region: process.env.OSS_REGION || "",
    bucket: process.env.OSS_BUCKET || "",
    prefix: (process.env.OSS_DOWNLOAD_PREFIX || "wiki-agent").replace(/^\/+|\/+$/g, ""),
    publicBase: (process.env.OSS_PUBLIC_BASE || "").replace(/\/+$/, ""),
  };
}

export function ossReady(cfg = ossConfig()) {
  return Boolean(cfg.accessKeyId && cfg.accessKeySecret && cfg.region && cfg.bucket);
}

export function ossMissing(cfg = ossConfig()) {
  const need = [
    ["OSS_ACCESS_KEY_ID", cfg.accessKeyId],
    ["OSS_ACCESS_KEY_SECRET", cfg.accessKeySecret],
    ["OSS_REGION", cfg.region],
    ["OSS_BUCKET", cfg.bucket],
  ];
  return need.filter(([, v]) => !v).map(([k]) => k);
}

export function publicBase(cfg = ossConfig()) {
  return cfg.publicBase || `https://${cfg.bucket}.${cfg.region}.aliyuncs.com`;
}

const encodeKey = (key) => key.split("/").map(encodeURIComponent).join("/");

export function objectKey(cfg, version, name) {
  return `${cfg.prefix}/${version}/${name}`;
}

/** 安装包的对外直链（页面上的 href 就是这个） */
export function publicUrl(cfg, version, name) {
  return `${publicBase(cfg)}/${encodeKey(objectKey(cfg, version, name))}`;
}

/** 某个版本目录的对外地址（写进 EDITOR_DOWNLOAD_BASE 的就是它） */
export function versionBase(cfg = ossConfig()) {
  return `${publicBase(cfg)}/${encodeKey(cfg.prefix)}`;
}

/* -------------------------------------------------------------- 客户端 */

let client = null;
let Ctor = null;

function loadCtor() {
  if (!Ctor) {
    // ali-oss 装在 apps/server 下（CJS），从那里解析，避免给 editor 加依赖
    const require = createRequire(path.join(REPO_ROOT, "apps/server/package.json"));
    Ctor = require("ali-oss");
  }
  return Ctor;
}

export function ossClient(cfg = ossConfig()) {
  if (!ossReady(cfg)) throw new Error(`OSS 未配置：缺少 ${ossMissing(cfg).join(", ")}`);
  if (!client) {
    const Oss = loadCtor();
    client = new Oss({
      region: cfg.region,
      accessKeyId: cfg.accessKeyId,
      accessKeySecret: cfg.accessKeySecret,
      bucket: cfg.bucket,
      secure: true,
      authorizationV4: true,
    });
  }
  return client;
}

/* ------------------------------------------------------------ 读写对象 */

export function contentTypeOf(name) {
  return MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 上传单个文件。公共读 + 长缓存 + attachment：
 * 跨域链接上的 download 属性浏览器会忽略，靠 Content-Disposition 才是真的「点了就下载」。
 */
export async function putFile(client, key, file, name, onProgress) {
  return client.put(key, file, {
    mime: contentTypeOf(name),
    headers: {
      "x-oss-object-acl": "public-read",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"`,
    },
    progress: onProgress ? (pct) => onProgress(pct) : undefined,
  });
}

export async function headObject(client, key) {
  try {
    const res = await client.head(key);
    const size = Number(res.res.headers["content-length"] ?? 0);
    return { size, exists: true };
  } catch (err) {
    if (String(err?.code || err?.status || "").includes("404") || err?.status === 404) {
      return { size: 0, exists: false };
    }
    throw err;
  }
}

export async function deleteObject(client, key) {
  await client.delete(key);
}

/** 列出所有版本目录（<prefix>/0.0.2/ 这种） */
export async function listVersions(client, cfg = ossConfig()) {
  const versions = new Set();
  let marker = "";
  for (let page = 0; page < 20; page += 1) {
    const query = { prefix: `${cfg.prefix}/`, delimiter: "/", "max-keys": 1000 };
    // 有下一页才带 marker：空字符串会让 ali-oss 拼出 `marker=`，
    // V4 签名对这种空参数算不出一致结果，直接 SignatureDoesNotMatchError。
    if (marker) query.marker = marker;
    const res = await client.list(query);
    for (const p of res.prefixes || []) {
      const m = p.match(new RegExp(`^${cfg.prefix}/([^/]+)/$`));
      if (m) versions.add(m[1]);
    }
    if (!res.isTruncated) break;
    marker = res.nextMarker || "";
    if (!marker) break;
  }
  return [...versions];
}

export async function listObjects(client, prefix) {
  const res = await client.list({ prefix, "max-keys": 1000 });
  return (res.objects || []).map((o) => ({ name: o.name, size: o.size }));
}
