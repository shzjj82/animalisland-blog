import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 把版本号写进 dist，供下载页与服务端 /version.json 读取。
 * 文件名约定（CI 与本地打包都用这套）：
 *   macOS    wiki-agent_<version>_universal.dmg
 *   Windows  wiki-agent-<version>-windows.zip      便携版（解压即用）
 *            wiki-agent_<version>_x64-setup.exe    安装版（NSIS）
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = String(readJson(path.join(root, "package.json")).version || "0.0.0");

const distDir = path.join(root, "dist");
fs.mkdirSync(distDir, { recursive: true });

const payload = {
  version,
  builtAt: new Date().toISOString(),
  files: [
    {
      os: "mac",
      name: `wiki-agent_${version}_universal.dmg`,
      ext: ".dmg",
      label: "Apple 芯片与 Intel 通用包",
    },
    {
      os: "win",
      name: `wiki-agent-${version}-windows.zip`,
      ext: ".zip",
      label: "Windows 10 / 11，解压后运行",
    },
    {
      os: "win",
      name: `wiki-agent_${version}_x64-setup.exe`,
      ext: ".exe",
      label: "Windows 安装版（可选）",
      optional: true,
    },
  ],
};

fs.writeFileSync(path.join(distDir, "version.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`dist/version.json → v${version}`);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
