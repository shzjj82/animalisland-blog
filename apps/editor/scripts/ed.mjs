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

  step("服务器 downloads");
  const ls = sshCapture(`ls -l ${CONFIG.remoteDir}/downloads 2>/dev/null`);
  if (ls.ok && ls.out) {
    for (const line of ls.out.split("\n").filter((l) => /\.(dmg|zip|exe)$/i.test(l))) {
      const parts = line.trim().split(/\s+/);
      info(`${String(fmtSize(Number(parts[4]))).padStart(8)}  ${parts.slice(8).join(" ")}`);
    }
  } else {
    info(dim("读取失败（ssh 不通或目录为空）"));
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

/* ----------------------------------------------------------------- sync */

const REMOTE_SYNC = String.raw`
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const [ver, repo, remoteDir, keepOld] = process.argv.slice(2);
const dir = path.join(remoteDir, "downloads");

function apiGet(url) {
  return JSON.parse(
    execFileSync(
      "curl",
      ["-sSL", "--fail", "--retry", "3", "--retry-delay", "2",
       "-H", "Accept: application/vnd.github+json",
       "-H", "User-Agent: wiki-agent-cli", url],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    ),
  );
}

let release;
try {
  release = apiGet("https://api.github.com/repos/" + repo + "/releases/tags/v" + ver);
} catch {
  console.error("读不到 Release v" + ver + "（curl 已在上方说明原因）");
  console.error("确认 CI 已跑完：https://github.com/" + repo + "/releases/tag/v" + ver);
  process.exit(1);
}

const assets = (release.assets || []).filter((a) => /\.(dmg|zip|exe)$/i.test(a.name));
if (!assets.length) {
  console.error("Release v" + ver + " 里没有 dmg/zip/exe 产物");
  process.exit(1);
}

fs.mkdirSync(dir, { recursive: true });
const wanted = new Set();

for (const a of assets) {
  const dest = path.join(dir, a.name);
  wanted.add(a.name);
  const exists = fs.existsSync(dest) ? fs.statSync(dest).size : -1;
  if (exists === a.size) {
    console.log("= " + a.name + "  已是最新（" + a.size + " B）");
    continue;
  }
  console.log("↓ " + a.name + "  " + a.size + " B");
  execFileSync(
    "curl",
    ["-sSL", "--fail", "--retry", "3", "--retry-delay", "2",
     "-H", "Accept: application/octet-stream",
     "-H", "User-Agent: wiki-agent-cli",
     "-o", dest + ".part",
     "https://api.github.com/repos/" + repo + "/releases/assets/" + a.id],
    { stdio: "inherit" },
  );
  fs.renameSync(dest + ".part", dest);
  const got = fs.statSync(dest).size;
  if (got !== a.size) {
    console.error(a.name + " 大小不符：期望 " + a.size + "，实际 " + got);
    process.exit(1);
  }
}

if (keepOld !== "1") {
  for (const f of fs.readdirSync(dir)) {
    if (!wanted.has(f) && /\.(dmg|zip|exe)$/i.test(f)) {
      fs.unlinkSync(path.join(dir, f));
      console.log("- 清理旧产物 " + f);
    }
  }
}

console.log("--- 当前 downloads:");
for (const f of fs.readdirSync(dir).sort()) {
  console.log("  " + String(fs.statSync(path.join(dir, f)).size).padStart(10) + "  " + f);
}
`;

function cmdSync(ver, flags) {
  const v = normalizeVersion(ver || localVersion());
  assertVersion(v);

  step(`从 GitHub Release v${v} 同步安装包 → ${CONFIG.host}:${CONFIG.remoteDir}/downloads`);
  const remoteCmd = `node - ${[v, CONFIG.repo, CONFIG.remoteDir, flags.keepOld ? "1" : "0"].map(shellQuote).join(" ")}`;
  const r = spawnSync("ssh", sshArgs(remoteCmd), {
    cwd: ROOT,
    stdio: ["pipe", "inherit", "inherit"],
    input: REMOTE_SYNC,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    console.error(`${red("✗")} 同步失败：Release v${v} 不存在，或 CI 还没产出安装包`);
    info(`看 ${cyan(`https://github.com/${CONFIG.repo}/releases/tag/v${v}`)}`);
    process.exit(1);
  }
  ok("安装包已就位");
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
  cmdDeploy(flags);
  // deploy 脚本会 restart frpc，公网入口会短暂断开；等回来再做后续 ssh / 校验
  waitForLive();
  cmdSync(v, flags);
  const good = await verifyLive(v);
  if (good) {
    ok(`完成：${liveBase()}/ 已是 v${v}`);
  } else {
    warn("产物或版本号仍不对，检查上面缺失项后再跑一次 pnpm ed sync");
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

  step("GitHub 可达性（服务器侧，CI 产物由它拉取）");
  const gh = sshCapture(`curl -s -o /dev/null -w '%{http_code}' https://api.github.com`);
  info(gh.out === "200" ? green("api.github.com 200") : yellow(`api.github.com ${gh.out || "无响应"}`));

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
  ${cyan("ship")} [x.y.z]           部署 web + 同步安装包 + 校验（发版后一条命令收尾）
                     ${dim("--skip-build 复用已有 dist；--keep-old 保留旧版本安装包")}
  ${cyan("deploy")}                 只部署 web 端
                     ${dim("--skip-build 跳过 vite build")}
  ${cyan("sync")} [x.y.z]           只从 Release 同步安装包到服务器 downloads
                     ${dim("版本号默认取 apps/editor/package.json，下载在服务器侧执行")}
  ${cyan("logs")}                   服务器 pm2 日志
                     ${dim("--lines 200 指定行数")}
  ${cyan("doctor")}                 环境与连通性自检

${bold("环境变量")}
  DEPLOY_SSH_HOST / DEPLOY_SSH_USER / DEPLOY_SSH_PORT / DEPLOY_SSH_KEY
  EDITOR_REMOTE_DIR / EDITOR_REMOTE_PORT / GH_REPO

${bold("典型流程")}
  pnpm ed release 0.0.3     ${dim("# 改版本号并推 tag，CI 开始构建")}
  pnpm ed ship              ${dim("# 等 CI 完成后：部署 web + 拉产物 + 校验")}
`);
}

/* ----------------------------------------------------------------- main */

function parseArgs(argv) {
  const flags = { force: false, dryRun: false, skipBuild: false, keepOld: false, lines: 0 };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--force" || a === "-f") flags.force = true;
    else if (a === "--dry-run") flags.dryRun = true;
    else if (a === "--skip-build") flags.skipBuild = true;
    else if (a === "--keep-old") flags.keepOld = true;
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
