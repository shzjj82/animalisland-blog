export type FileKind = "word" | "pdf" | "excel" | "code" | "video";

/** 扩展名 → highlight.js 语言名 */
const CODE_LANGUAGES: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  kts: "kotlin",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  html: "xml",
  htm: "xml",
  vue: "xml",
  svg: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  toml: "ini",
  ini: "ini",
  conf: "ini",
};

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  doc: "word",
  docx: "word",
  pdf: "pdf",
  xls: "excel",
  xlsx: "excel",
  csv: "excel",
  mp4: "video",
  webm: "video",
  ogg: "video",
  ogv: "video",
  mov: "video",
  m4v: "video",
  ...Object.fromEntries(Object.keys(CODE_LANGUAGES).map((ext) => [ext, "code" as const])),
};

export const ATTACHMENT_ACCEPT = Object.keys(KIND_BY_EXTENSION)
  .map((ext) => `.${ext}`)
  .join(",");

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

/** 文件选择框接受的图片。和 Word 导入里能嵌进来的格式一致 */
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg";

export function isImageFile(file: { name: string; type: string }): boolean {
  return /^image\/(png|jpeg|gif|webp|bmp|svg\+xml)$/.test(file.type) || IMAGE_EXTENSIONS.has(fileExtension(file.name));
}

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export function fileExtension(name: string): string {
  return name.toLowerCase().match(/\.([^./]+)$/)?.[1] ?? "";
}

export function fileKind(name: string): FileKind | null {
  return KIND_BY_EXTENSION[fileExtension(name)] ?? null;
}

export function videoMime(name: string): string {
  switch (fileExtension(name)) {
    case "webm":
      return "video/webm";
    case "ogg":
    case "ogv":
      return "video/ogg";
    case "mov":
      return "video/quicktime";
    default:
      return "video/mp4";
  }
}

export function codeLanguage(name: string): string | undefined {
  return CODE_LANGUAGES[fileExtension(name)];
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
