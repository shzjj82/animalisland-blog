#!/usr/bin/env node
/**
 * wiki-agent 发版 / 部署命令行
 *
 * 把散在 scripts 里的动作收成一入口：版本号、tag、CI、产物流转、web 部署、线上体检。
 * 不引入依赖，只用 node 内置模块；ssh/scp 走 DEPLOY_* 环境变量（默认值见 CONFIG）。
 *
 * 用法（在仓库根目录）：
 *   pnpm ed                     # 等价于 pnpm ed help
 *   pnpm ed status              # 本地版本 / 线上版本 / 产物可用性 / 最近一次 CI
 *   pnpm ed release 0.0.3       # 改版本号 → commit → tag → push（触发 GitHub 打包）
 *   pnpm ed ship                # 部署 web + 从 Release 同步安装包 + 校验
 *   pnpm ed deploy              # 只部署 web（加 --skip-build 复用已有产物）
 *   pnpm ed sync [0.0.3]        # 只把 Release 里的安装包同步到服务器 downloads
 *   pnpm ed logs                # 看服务器上 pm2 的 editor 日志
 *   pnpm ed doctor              # 连通性自检
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteObject,
  getJson,
  headObject,
  indexKey,
  listObjects,
  listVersions,
  loadEnvFiles,
  objectKey,
  ossClient,
  ossConfig,
  ossMissing,
  ossReady,
  publicBase,
  publicUrl,
  putFile,
  putJson,
} from "./lib/oss.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = path.resolve(HERE, "..");
const ROOT = path.resolve(EDITOR_DIR, "../..");

const CONFIG = {
  repo: process.env.GH_REPO || "shzjj82/animalisland-blog",
  host: process.env.DEPLOY_SSH_HOST || "106.15.235.175",
  user: process.env.DEPLOY_SSH_USER || "root",
  port: process.env.DEPLOY_SSH_PORT || "1022",
  key: process.env.DEPLOY_SSH_KEY || path.join(process.env.HOME || "~", ".ssh/id_ed25519"),
  remoteDir: process.env.EDITOR_REMOTE_DIR || "/opt/apps/editor",
  livePort: process.env.EDITOR_REMOTE_PORT || "8082",
};

const liveBase = () => `http://${CONFIG.host}:${CONFIG.livePort}`;

/* ------------------------------------------------------------------ 输出 */

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (COLOR ? `\u001b[${code}m${s}\u001b[0m` : String(s));
const dim = paint("2");
const bold = paint("1");
const green = paint("32");
const yellow = paint("33");
const red = paint("31");
const cyan = paint("36");

const step = (msg) => console.log(`${cyan("▶")} ${msg}`);
const ok = (msg) => console.log(`${green("✓")} ${msg}`);
const warn = (msg) => console.log(`${yellow("⚠")} ${msg}`);
const info = (msg) => console.log(`  ${msg}`);

function die(msg) {
  console.error(`${red("✗")} ${msg}`);
  process.exit(1);
}

function row(label, value) {
  console.log(`  ${(label + " ").padEnd(24, ".")} ${value}`);
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "-";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

/* ------------------------------------------------------------- 进程执行 */

function run(cmd, args, opts = {}) {
  // 传了 input 就必须把 stdin 做成管道，否则 stdio:inherit 下 input 被忽略，
  // 远端 `node -` 会一直等 stdin（表现为卡住直到被杀）。
  const stdio = opts.stdio || (opts.input != null ? ["pipe", "inherit", "inherit"] : "inherit");
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio,
    input: opts.input,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (r.error) die(`${cmd} 执行失败：${r.error.message}`);
  if (r.status !== 0 && !opts.allowFail) {
    die(`${cmd} ${args.join(" ")} 退出码 ${r.status}`);
  }
  return r;
}

function capture(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(opts.env || {}) },
  });
  return {
    ok: !r.error && r.status === 0,
    out: (r.stdout || "").trim(),
    err: (r.stderr || "").trim(),
    status: r.status,
  };
}

/* ------------------------------------------------------------------ ssh */

function sshArgs(remoteCmd) {
  const args = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15"];
  if (fs.existsSync(CONFIG.key)) args.push("-i", CONFIG.key);
  args.push("-p", CONFIG.port, `${CONFIG.user}@${CONFIG.host}`, remoteCmd);
  return args;
}

function ssh(remoteCmd, opts = {}) {
  return run("ssh", sshArgs(remoteCmd), opts);
}

function sshCapture(remoteCmd, opts = {}) {
  return capture("ssh", sshArgs(remoteCmd), opts);
}

const shellQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/* --------------------------------------------------------------- 版本号 */

function localVersion() {
  return JSON.parse(fs.readFileSync(path.join(EDITOR_DIR, "package.json"), "utf8")).version;
}

function tauriVersion() {
  return JSON.parse(fs.readFileSync(path.join(EDITOR_DIR, "src-tauri/tauri.conf.json"), "utf8")).version;
}

function assertVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v || "")) die(`版本号要是 x.y.z 形式，收到：${v ?? "(空)"}`);
  return v;
}

function normalizeVersion(v) {
  return String(v || "").replace(/^v/, "").trim();
}

async function readJson(url, timeout = 8000, token) {
  const headers = { accept: "application/vnd.github+json", "user-agent": "wiki-agent-cli" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const ghToken = () => process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";

async function repoApi(pathname) {
  return readJson(`https://api.github.com/repos/${CONFIG.repo}${pathname}`, 10000, ghToken());
}

/** 优先 gh CLI（有登录态、不受限流），否则退回 REST API。返回归一化结构。 */
async function fetchRelease(version) {
  if (hasGithubCli()) {
    const r = capture("gh", ["release", "view", `v${version}`, "--json", "tagName,assets"]);
    if (r.ok) {
      const j = JSON.parse(r.out);
      return { tag: j.tagName, assets: (j.assets || []).map((a) => ({ name: a.name, size: a.size })) };
    }
    return null;
  }
  try {
    const j = await repoApi(`/releases/tags/v${version}`);
    return { tag: j.tag_name, assets: (j.assets || []).map((a) => ({ name: a.name, size: a.size })) };
  } catch {
    return null;
  }
}

async function fetchRuns(limit = 3) {
  if (hasGithubCli()) {
    const r = capture("gh", [
      "run", "list", "--workflow=desktop-release.yml", "--limit", String(limit),
      "--json", "displayTitle,status,conclusion,createdAt,headSha",
    ]);
    if (r.ok) {
      return JSON.parse(r.out).map((x) => ({
        title: x.displayTitle, status: x.status, conclusion: x.conclusion,
        at: x.createdAt, sha: x.headSha,
      }));
    }
    return [];
  }
  try {
    const j = await repoApi(`/actions/workflows/desktop-release.yml/runs?per_page=${limit}`);
    return (j.workflow_runs || []).map((x) => ({
      title: x.display_title, status: x.status, conclusion: x.conclusion,
      at: x.created_at, sha: x.head_sha,
    }));
  } catch {
    return [];
  }
}

/* --------------------------------------------------------------- status */

async function cmdStatus() {
  step("本地");
  const local = localVersion();
  const tauri = tauriVersion();
  row("package.json", local);
  row("tauri.conf.json", tauri === local ? local : `${tauri} ${yellow("（与 package.json 不一致）")}`);

  const dirty = capture("git", ["status", "--porcelain"]).out;
  row("git", dirty ? `${yellow(`${dirty.split("\n").length} 个文件未提交`)}` : green("干净"));

  step(`线上 ${liveBase()}/version.json`);
  let live = null;
  try {
    live = await readJson(`${liveBase()}/version.json`);
    const same = live.version === local;
    row("版本", `${live.version} ${same ? green("✓ 与本地一致") : yellow("≠ 本地")}`);
    row("构建时间", live.builtAt ? new Date(live.builtAt).toLocaleString("zh-CN") : "-");
    for (const f of live.files || []) fileRow(f);
  } catch (err) {
    row("版本", red(`不可达（${err.message}）`));
  }

  step(`GitHub Release v${local}`);
  const rel = await fetchRelease(local);
  if (rel) {
    row("产物", "");
    for (const a of rel.assets) info(`  ${green("✓")} ${a.name.padEnd(NAME_WIDTH)} ${dim(fmtSize(a.size))}`);
  } else {
    row("产物", yellow("该版本还没有 Release（CI 可能仍在跑）"));
  }

  const runs = await fetchRuns(3);
  if (runs.length) {
    step("最近 CI");
    for (const it of runs) {
      const raw = it.status !== "completed" ? it.status : it.conclusion || "failed";
      const state =
        it.status !== "completed" ? cyan(raw.padEnd(10)) : it.conclusion === "success" ? green(raw.padEnd(10)) : red(raw.padEnd(10));
      info(`${new Date(it.at).toLocaleString("zh-CN")}  ${state}  ${it.title?.trim()}  ${dim(it.sha?.slice(0, 7) || "")}`);
    }
  }

  step("OSS 上的安装包");
  loadEnvFiles();
  const cfg = ossConfig();
  if (!ossReady(cfg)) {
    info(red(`未配置 OSS（缺 ${ossMissing(cfg).join(", ")}）`));
  } else {
    try {
      const client = ossClient(cfg);
      const versions = (await listVersions(client, cfg)).sort(compareDesc);
      if (!versions.length) {
        info(dim("还没有上传过任何版本"));
      }
      for (const v of versions) {
        const objs = await listObjects(client, `${cfg.prefix}/${v}/`);
        const total = objs.reduce((sum, o) => sum + o.size, 0);
        info(`${v === local ? green("→") : " "} ${v.padEnd(10)} ${String(objs.length).padStart(2)} 个文件  ${fmtSize(total)}`);
      }
    } catch (err) {
      info(red(`列不出对象：${err.message}`));
    }
  }
}

const NAME_WIDTH = 34;

function fileRow(f) {
  const mark = f.available ? green("✓") : f.optional ? dim("·") : red("✗");
  const state = f.available ? green(fmtSize(f.size)) : f.optional ? dim("未提供（可选）") : red("缺失");
  info(`${mark} ${f.name.padEnd(NAME_WIDTH)} ${state}`);
}

function hasGithubCli() {
  return capture("gh", ["--version"]).ok;
}

/* -------------------------------------------------------------- release */

function cmdRelease(ver, flags) {
  const next = assertVersion(ver);
  const cur = localVersion();
  if (next === cur && !flags.force) die(`当前已经是 ${cur}，换个版本号或用 --force`);

  const dirty = capture("git", ["status", "--porcelain"]).out
    .split("\n")
    .filter(Boolean)
    .filter((l) => !/apps\/editor\/(package\.json|src-tauri\/tauri\.conf\.json)$/.test(l));
  if (dirty.length && !flags.force) {
    warn("工作区有未提交改动，先处理掉（或用 --force 跳过检查）：");
    for (const l of dirty) info(l);
    process.exit(1);
  }

  step(`版本号 ${cur} → ${next}`);
  run("node", [path.join(EDITOR_DIR, "scripts/set-version.mjs"), next], { stdio: "inherit" });

  const changed = capture("git", ["status", "--porcelain", "apps/editor/package.json", "apps/editor/src-tauri/tauri.conf.json"]).out;
  if (changed) {
    run("git", ["add", "apps/editor/package.json", "apps/editor/src-tauri/tauri.conf.json"]);
    run("git", ["commit", "-m", `chore(editor): 版本号升到 ${next}`]);
  } else {
    info(dim("版本号文件无变化，跳过 commit"));
  }

  const tag = `v${next}`;
  const exists = capture("git", ["tag", "-l", tag]).out;
  if (exists) {
    if (!flags.force) die(`tag ${tag} 已存在，换个版本号或用 --force 覆盖`);
    run("git", ["tag", "-f", "-a", tag, "-m", `release ${tag}`]);
  } else {
    run("git", ["tag", "-a", tag, "-m", `release ${tag}`]);
  }

  if (flags.dryRun) {
    warn("--dry-run：已改版本号并打 tag，但未 push");
    info(`确认无误后执行：git push origin HEAD && git push origin ${tag}`);
    return;
  }

  step(`推送 main 与 ${tag}`);
  run("git", ["push", "origin", "HEAD"]);
  run("git", ["push", ...(flags.force ? ["--force"] : []), "origin", tag]);

  ok(`已触发打包：https://github.com/${CONFIG.repo}/actions/workflows/desktop-release.yml`);
  info(`等 CI 跑完（约 8~15 分钟）后执行 ${bold("pnpm ed ship")} 同步产物并部署`);
  if (hasGithubCli()) info(`盯进度：${dim(`gh run watch --workflow=desktop-release.yml`)}`);
}

/* ------------------------------------------------------------------ oss */

/** 下载缓存：同一个版本的产物只从 GitHub 拉一次 */
const ASSET_CACHE = path.join(EDITOR_DIR, "release", "assets");

const compareDesc = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
  }
  return 0;
};

function requireOss() {
  loadEnvFiles();
  const cfg = ossConfig();
  if (!ossReady(cfg)) {
    die(`OSS 未配置：缺少 ${ossMissing(cfg).join(", ")}\n  本地写进仓库根 .env，CI 里用 Secrets 注入`);
  }
  return cfg;
}

async function fetchReleaseAssets(version) {
  const clean = (assets) =>
    (assets || [])
      .filter((a) => /\.(dmg|zip|exe)$/i.test(a.name))
      .map((a) => ({ id: a.id, name: a.name, size: a.size, url: a.browser_download_url || a.url }));

  if (hasGithubCli()) {
    const r = capture("gh", ["release", "view", `v${version}`, "--json", "assets"]);
    if (r.ok) {
      const list = clean(JSON.parse(r.out).assets);
      if (list.length) return list;
    }
  }
  try {
    const rel = await repoApi(`/releases/tags/v${version}`);
    const list = clean(rel.assets);
    if (list.length) return list;
    die(`Release v${version} 里没有 dmg/zip/exe 产物`);
  } catch (err) {
    die(`读不到 Release v${version}（${err.message}）：先确认 CI 已跑完 → https://github.com/${CONFIG.repo}/releases/tag/v${version}`);
  }
}

async function download(url, dest, expect) {
  const res = await fetch(url, {
    headers: { accept: "application/octet-stream", "user-agent": "wiki-agent-cli" },
    redirect: "follow",
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

  const total = Number(res.headers.get("content-length") || expect || 0);
  const tmp = `${dest}.part`;
  const fd = fs.openSync(tmp, "w");
  let got = 0;
  let lastPct = -1;
  try {
    for await (const chunk of res.body) {
      fs.writeSync(fd, chunk);
      got += chunk.length;
      if (total) {
        const pct = Math.floor((got / total) * 100);
        if (pct >= lastPct + 20) {
          lastPct = pct;
          info(`${String(pct).padStart(3)}%  ${fmtSize(got)} / ${fmtSize(total)}`);
        }
      }
    }
  } finally {
    fs.closeSync(fd);
  }
  if (expect && got !== expect) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`大小不符：期望 ${expect}，实际 ${got}`);
  }
  fs.renameSync(tmp, dest);
  return got;
}

function scpArgs(from, to) {
  const args = ["-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15"];
  if (fs.existsSync(CONFIG.key)) args.push("-i", CONFIG.key);
  args.push("-P", CONFIG.port, from, to);
  return args;
}

/**
 * 从服务器捞一份已在 downloads 里的包。
 * 本机直连 GitHub 只有几十 KB/s（实测 65 KB/s，92MB 的 dmg 要 40 分钟），
 * 走 ssh 回传能到 2 MB/s 以上 —— 迁移期的包基本都在服务器上，优先用它。
 */
function copyFromServer(version, asset) {
  const dir = path.join(ASSET_CACHE, version);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, asset.name);
  const remote = `${CONFIG.user}@${CONFIG.host}:${CONFIG.remoteDir}/downloads/${asset.name}`;
  const r = spawnSync("scp", scpArgs(remote, dest), { stdio: ["ignore", "ignore", "ignore"], encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(dest)) return null;
  if (fs.statSync(dest).size !== asset.size) {
    fs.rmSync(dest, { force: true });
    return null;
  }
  return dest;
}

async function ensureLocalAsset(version, asset, flags) {
  const dir = path.join(ASSET_CACHE, version);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, asset.name);
  if (fs.existsSync(dest) && fs.statSync(dest).size === asset.size) {
    info(`${dim("本地已有")} ${asset.name}`);
    return dest;
  }
  if (!flags.fromGithub) {
    const fromServer = copyFromServer(version, asset);
    if (fromServer) {
      info(`${dim("取自服务器")} ${asset.name}`);
      return fromServer;
    }
  }
  step(`取包 ${asset.name}  ${fmtSize(asset.size)}  ${dim("(GitHub，可能很慢)")}`);
  const url = asset.id
    ? `https://api.github.com/repos/${CONFIG.repo}/releases/assets/${asset.id}`
    : asset.url;
  await download(url, dest, asset.size);
  return dest;
}

/** 传完立刻用公共域名验一次：HEAD 拿大小、Range 拿前 1KB，确认真的能下 */
async function verifyPublic(url, expect) {
  const head = await fetch(url, { method: "HEAD" });
  if (!head.ok) return { ok: false, why: `HEAD ${head.status}` };
  const size = Number(head.headers.get("content-length") || 0);
  if (expect && size !== expect) return { ok: false, why: `大小 ${size} ≠ ${expect}` };
  const range = await fetch(url, { headers: { range: "bytes=0-1023" } });
  if (range.status !== 206) return { ok: false, why: `Range ${range.status}（不支持断点续传）` };
  await range.arrayBuffer();
  return { ok: true, size };
}

/** 核心上传流程：items = [{ name, size, ensure(): Promise<path> }] */
async function uploadMany(cfg, version, items, flags) {
  const client = ossClient(cfg);
  step(`v${version} → OSS ${publicBase(cfg)}/${encodeURIComponent(cfg.prefix)}/${version}/`);
  const uploaded = [];

  for (const item of items) {
    const key = objectKey(cfg, version, item.name);
    const url = publicUrl(cfg, version, item.name);
    const already = await headObject(client, key);

    if (already.exists && already.size === item.size) {
      info(`${dim("OSS 已有，跳过上传")} ${item.name}`);
    } else {
      const local = await item.ensure();
      step(`上传 ${item.name}  ${fmtSize(item.size)}`);
      let lastPct = -1;
      await putFile(client, key, local, item.name, (pct) => {
        const p = Math.floor(pct * 100);
        if (p >= lastPct + 20 || p === 100) {
          lastPct = p;
          info(`${String(p).padStart(3)}%`);
        }
      });
      const head = await headObject(client, key);
      if (head.size !== item.size) die(`上传后大小不符：OSS ${head.size}，期望 ${item.size}`);
    }

    const check = await verifyPublic(url, item.size);
    if (!check.ok) {
      die(`公共访问校验失败（${check.why}）：${url}\n  检查 bucket 读权限与 OSS_PUBLIC_BASE 域名绑定`);
    }
    uploaded.push({ name: item.name, url, size: item.size });
    ok(`${item.name}  ${dim(url)}`);
  }

  // 清旧版本：路径里带版本号，留着既占空间也容易误点
  const keepN = Math.max(flags.keep ?? 2, 1);
  const versions = (await listVersions(client, cfg)).sort(compareDesc);
  const keep = new Set(versions.slice(0, keepN));
  keep.add(version);
  for (const old of versions) {
    if (keep.has(old)) continue;
    for (const obj of await listObjects(client, `${cfg.prefix}/${old}/`)) {
      await deleteObject(client, obj.name);
    }
    ok(`清理旧版本 ${old}`);
  }

  // 版本索引：页面靠它列出可下载的历史版本，服务端只读这一个对象，不需要 OSS 凭据
  const remaining = (await listVersions(client, cfg)).sort(compareDesc);
  await writeIndex(client, cfg, version, remaining);

  step("当前 OSS 上的版本");
  for (const v of remaining) {
    const objs = await listObjects(client, `${cfg.prefix}/${v}/`);
    const total = objs.reduce((sum, o) => sum + o.size, 0);
    info(`${v === version ? green("→") : " "} ${v.padEnd(10)} ${String(objs.length).padStart(2)} 个文件  ${fmtSize(total)}`);
  }
  return uploaded;
}

/**
 * 维护 <prefix>/index.json：{ versions: [{ version, uploadedAt, files: [{ name, size, os, optional }] }] }
 * 每次都按 OSS 上真实存在的版本重写，避免索引和对象不同步。
 */
async function writeIndex(client, cfg, currentVersion, versions) {
  const entries = [];
  for (const v of versions) {
    const objs = (await listObjects(client, `${cfg.prefix}/${v}/`)).filter((o) => /\.(dmg|zip|exe)$/i.test(o.name));
    if (!objs.length) continue;
    entries.push({
      version: v,
      uploadedAt: new Date().toISOString(),
      files: objs.map((o) => ({
        name: o.name.split("/").pop(),
        size: o.size,
        os: /\.(dmg|pkg)$/i.test(o.name) ? "mac" : "win",
        // 和 gen-version.mjs 的约定一致：便携 zip 解压即用是主推，NSIS 安装版是备选
        optional: /setup\.exe$/i.test(o.name),
      })),
    });
  }
  entries.sort((a, b) => compareDesc(a.version, b.version));
  await putJson(client, indexKey(cfg), { updatedAt: new Date().toISOString(), current: currentVersion, versions: entries });
  ok(`版本索引已更新（${entries.length} 个版本）`);
}

/** 从 GitHub Release 取包再上传（本机补传用） */
async function cmdOssPush(ver, flags) {
  const cfg = requireOss();
  const v = assertVersion(normalizeVersion(ver || localVersion()));
  const assets = await fetchReleaseAssets(v);
  return uploadMany(
    cfg,
    v,
    assets.map((a) => ({ name: a.name, size: a.size, ensure: () => ensureLocalAsset(v, a, flags) })),
    flags,
  );
}

/** 直接把本地目录里的产物传上去（CI 用，不需要再回 GitHub 拉一遍） */
async function cmdOssUpload(ver, dir, flags) {
  const cfg = requireOss();
  const v = assertVersion(normalizeVersion(ver || localVersion()));
  if (!dir) die("用法：pnpm ed oss upload <x.y.z> <目录>");
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) die(`目录不存在：${dir}`);

  // rw.*.dmg 是 create-dmg 留下的中间镜像，几百 MB，别传上去
  const items = fs
    .readdirSync(dir)
    .filter((n) => /\.(dmg|zip|exe)$/i.test(n) && !n.startsWith("rw."))
    .map((n) => {
      const file = path.join(dir, n);
      return { name: n, size: fs.statSync(file).size, ensure: async () => file };
    });
  if (!items.length) die(`目录里没有 dmg/zip/exe：${dir}`);
  return uploadMany(cfg, v, items, flags);
}

async function cmdOssLs() {
  const cfg = requireOss();
  const client = ossClient(cfg);
  step(`${publicBase(cfg)}/${encodeURIComponent(cfg.prefix)}/`);
  const versions = (await listVersions(client, cfg)).sort(compareDesc);
  if (!versions.length) {
    info(dim("还没有上传过任何版本"));
    return;
  }
  for (const v of versions) {
    const objs = await listObjects(client, `${cfg.prefix}/${v}/`);
    const total = objs.reduce((sum, o) => sum + o.size, 0);
    info(`${v.padEnd(10)} ${String(objs.length).padStart(2)} 个文件  ${fmtSize(total).padStart(8)}`);
    for (const o of objs) info(`  ${dim(fmtSize(o.size).padStart(8))}  ${o.name.split("/").pop()}`);
  }

  const index = await getJson(client, indexKey(cfg)).catch(() => null);
  if (!index) {
    warn("OSS 上没有版本索引（index.json），页面列不出历史版本；跑一次 oss push / upload 会补上");
    return;
  }
  const indexed = (index.versions || []).map((x) => x.version);
  const drift = versions.filter((v) => !indexed.includes(v));
  info(`索引：${indexed.join(", ") || "(空)"}${drift.length ? yellow(`，缺 ${drift.join(", ")}`) : ""}`);
}

/** 只按 OSS 上真实存在的对象重算 index.json（改了主推/可选约定时用），不动任何对象 */
async function cmdOssReindex(ver) {
  const cfg = requireOss();
  const client = ossClient(cfg);
  const versions = (await listVersions(client, cfg)).sort(compareDesc);
  if (!versions.length) die("OSS 上还没有任何版本，先跑 oss push / oss upload");

  const index = await getJson(client, indexKey(cfg)).catch(() => null);
  const wanted = ver ? normalizeVersion(ver) : index?.current || versions[0];
  const current = versions.includes(wanted) ? wanted : versions[0];
  if (wanted !== current) warn(`OSS 上没有 ${wanted}，索引 current 用 ${current}`);
  await writeIndex(client, cfg, current, versions);
}

function cmdSync(ver, flags) {
  return cmdOssPush(ver, flags);
}


async function verifyLive(expectVersion) {
  step("校验线上 /version.json");
  let live;
  try {
    live = await readJson(`${liveBase()}/version.json`);
  } catch (err) {
    warn(`读不到 /version.json（${err.message}）`);
    return false;
  }
  row("版本", live.version + (expectVersion && live.version !== expectVersion ? yellow(` ≠ ${expectVersion}`) : ""));
  let allOk = true;
  for (const f of live.files || []) {
    fileRow(f);
    if (!f.available && !f.optional) allOk = false;
  }
  return allOk;
}

/* --------------------------------------------------------------- deploy */

function cmdDeploy(flags) {
  step("构建并部署 web 端");
  const args = [path.join(ROOT, "scripts/deploy-editor.sh")];
  if (flags.skipBuild) args.push("--skip-build");
  run("bash", args);
  ok(`已部署：${liveBase()}/`);
}

/* ----------------------------------------------------------------- ship */

async function cmdShip(ver, flags) {
  const v = normalizeVersion(ver || localVersion());
  // 先把包传到 OSS 再切页面：否则部署完的那一瞬间页面上的下载链接是死的
  await cmdOssPush(v, flags);
  cmdDeploy(flags);
  // deploy 脚本可能重启 frpc，公网入口会短暂断开；等回来再做校验
  waitForLive();
  const good = await verifyLive(v);
  if (good) {
    ok(`完成：${liveBase()}/ 已是 v${v}`);
  } else {
    warn("产物或版本号仍不对，检查上面缺失项后再跑一次 pnpm ed oss push");
    process.exitCode = 1;
  }
}

function waitForLive(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const r = capture("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "-m", "5", `${liveBase()}/`]);
    last = r.out || "无响应";
    if (last === "200") {
      ok(`服务已恢复：${liveBase()}/ 200`);
      return true;
    }
    spawnSync("sleep", ["2"]);
  }
  warn(`服务在 ${Math.round(timeoutMs / 1000)}s 内未恢复（最后状态 ${last}），检查 pm2 status editor`);
  return false;
}

/* ----------------------------------------------------------------- logs */

function cmdLogs(flags) {
  const n = flags.lines || 120;
  step(`服务器 pm2 日志（editor，最近 ${n} 行）`);
  ssh(`pm2 logs editor --lines ${n} --nostream`);
}

/* --------------------------------------------------------------- doctor */

async function cmdDoctor() {
  step("环境");
  row("node", `${process.version} ${dim(process.execPath)}`);
  row("仓库", ROOT);
  row("ssh key", fs.existsSync(CONFIG.key) ? green(CONFIG.key) : red(`不存在 ${CONFIG.key}`));
  row("gh cli", hasGithubCli() ? green("已安装") : dim("未安装（可选，用于看 CI 与 Release）"));
  row("git", capture("git", ["status", "--porcelain"]).out ? yellow("有未提交改动") : green("干净"));

  step(`SSH ${CONFIG.user}@${CONFIG.host}:${CONFIG.port}`);
  const probe = sshCapture('echo ok; node -v; pm2 -v 2>/dev/null | tail -1; ls -d ' + CONFIG.remoteDir);
  if (probe.ok) {
    for (const line of probe.out.split("\n").filter(Boolean)) info(line);
  } else {
    row("连接", red(probe.err || "失败"));
  }

  step("GitHub 可达性（服务器侧）");
  const gh = sshCapture(`curl -s -o /dev/null -w '%{http_code}' https://api.github.com`);
  info(gh.out === "200" ? green("api.github.com 200") : yellow(`api.github.com ${gh.out || "无响应"}`));

  step("OSS");
  loadEnvFiles();
  const cfg = ossConfig();
  if (!ossReady(cfg)) {
    row("配置", red(`缺少 ${ossMissing(cfg).join(", ")}`));
  } else {
    row("bucket", `${cfg.bucket} @ ${cfg.region}`);
    row("安装包前缀", cfg.prefix);
    row("对外域名", cfg.publicBase || dim(`未设 OSS_PUBLIC_BASE，用 ${cfg.bucket}.${cfg.region}.aliyuncs.com`));
    try {
      // 探 bucket 根：403（不许列举）也算通，只要不是 5xx/超时
      const res = await fetch(`${publicBase(cfg)}/`, { method: "HEAD" });
      info(res.status < 500 ? green(`公共域名可达（HTTP ${res.status}）`) : red(`公共域名异常（HTTP ${res.status}）`));
    } catch (err) {
      info(red(`公共域名不可达：${err.message}`));
    }
    try {
      const versions = (await listVersions(ossClient(cfg), cfg)).sort(compareDesc);
      info(versions.length ? `已上传版本：${versions.join(", ")}` : dim("还没有上传过版本"));
    } catch (err) {
      info(red(`列不出对象：${err.message}`));
    }
  }

  step(`线上 ${liveBase()}`);
  const code = capture("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", `${liveBase()}/`]).out;
  info(code === "200" ? green("200") : red(code || "无响应"));
  await verifyLive(localVersion());
}

/* ----------------------------------------------------------------- help */

function cmdHelp() {
  console.log(`${bold("wiki-agent 发版 / 部署命令行")}

${bold("用法")}  pnpm ed <命令> [参数]

${bold("命令")}
  ${cyan("status")}                 本地版本 / 线上版本 / 产物可用性 / 最近 CI
  ${cyan("release")} <x.y.z>        改版本号 → commit → tag → push（触发 GitHub 打包）
                     ${dim("--dry-run 只改不推；--force 允许重复版本号或脏工作区")}
  ${cyan("ship")} [x.y.z]           传 OSS + 部署 web + 校验（发版后一条命令收尾）
                     ${dim("--skip-build 复用已有 dist；--keep N 保留几个旧版本（默认 2）")}
  ${cyan("deploy")}                 只部署 web 端
                     ${dim("--skip-build 跳过 vite build")}
  ${cyan("oss push")} [x.y.z]       把 Release 里的安装包传到 OSS（公共读，带版本路径）
                     ${dim("--keep N 保留几个旧版本；--from-github 强制回 GitHub 取包")}
  ${cyan("oss upload")} <x.y.z> <目录>  直接上传本地目录里的 dmg/zip/exe（CI 用）
  ${cyan("oss ls")}                 看 OSS 上已有哪些版本
  ${cyan("oss reindex")} [x.y.z]    按 OSS 上真实对象重算 index.json（改了主推包时用它）
  ${cyan("sync")}                   同 oss push（旧名字，保留兼容）
  ${cyan("logs")}                   服务器 pm2 日志
                     ${dim("--lines 200 指定行数")}
  ${cyan("doctor")}                 环境与连通性自检（含 OSS 读写）

${bold("环境变量")}
  OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_REGION / OSS_BUCKET   安装包存放
  OSS_DOWNLOAD_PREFIX（默认 wiki-agent）/ OSS_PUBLIC_BASE（自定义域名，留空用 OSS 默认域名）
  DEPLOY_SSH_HOST / DEPLOY_SSH_USER / DEPLOY_SSH_PORT / DEPLOY_SSH_KEY
  EDITOR_REMOTE_DIR / EDITOR_REMOTE_PORT / GH_REPO
  ${dim("本地从仓库根 .env 读取；CI 里用 Secrets 注入，进程环境优先")}

${bold("典型流程")}
  pnpm ed release 0.0.3     ${dim("# 改版本号并推 tag，CI 开始构建并上传 OSS")}
  pnpm ed ship              ${dim("# 等 CI 完成后：传 OSS + 部署 web + 校验")}
`);
}

/* ----------------------------------------------------------------- main */

function parseArgs(argv) {
  const flags = { force: false, dryRun: false, skipBuild: false, fromGithub: false, keep: 2, lines: 0 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force" || a === "-f") flags.force = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--skip-build") flags.skipBuild = true;
    else if (a === "--from-github") flags.fromGithub = true;
    else if (a === "--keep") flags.keep = Number(argv[++i]) || 2;
    else if (a.startsWith("--keep=")) flags.keep = Number(a.split("=")[1]) || 2;
    else if (a === "--lines") flags.lines = Number(argv[++i]) || 0;
    else if (a.startsWith("--lines=")) flags.lines = Number(a.split("=")[1]) || 0;
    else if (a === "--help" || a === "-h") flags.help = true;
    else if (!a.startsWith("-")) positional.push(a);
  }
  return { flags, positional };
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const cmd = positional[0] || "help";
  const arg = positional[1];
  const arg2 = positional[2];

  if (flags.help || cmd === "help" || cmd === "--help") return cmdHelp();

  switch (cmd) {
    case "status":
    case "st":
      return cmdStatus();
    case "release":
    case "rel":
      if (!arg) die("用法：pnpm ed release <x.y.z>");
      return cmdRelease(assertVersion(normalizeVersion(arg)), flags);
    case "ship":
      return cmdShip(arg, flags);
    case "deploy":
      return cmdDeploy(flags);
    case "oss": {
      const sub = arg || "ls";
      if (sub === "push") return cmdOssPush(arg2, flags);
      if (sub === "upload") return cmdOssUpload(arg2, positional[3], flags);
      if (sub === "ls" || sub === "list") return cmdOssLs();
      if (sub === "reindex") return cmdOssReindex(arg2);
      die(`用法：pnpm ed oss push [x.y.z] | oss upload <x.y.z> <目录> | oss ls | oss reindex [x.y.z]`);
      break;
    }
    case "sync":
      return cmdSync(arg, flags);
    case "logs":
      return cmdLogs(flags);
    case "doctor":
      return cmdDoctor();
    default:
      warn(`未知命令：${cmd}`);
      return cmdHelp();
  }
}

main().catch((err) => die(err?.stack || String(err)));
